import { operations, operationDefinition, operationSpec } from "./operations.js";
import type { Operation, OperationCall, OperationContext } from "./operation.js";
import { listHcmOperations, describeHcmOperation } from "./catalog.js";
import { NativeGateway, WsHcmApiError } from "./native/index.js";
import { validate } from "./native/validation.js";
import { HcmError, inputObject, requiredString } from "./errors.js";
import { SchemaReader } from "./schema.js";
import { ResultStore } from "./results.js";
import { LogReader } from "./logs.js";
import { RpcCatalog } from "./rpc-catalog.js";
import { ServerFiles } from "./files.js";
import { ServerObjects } from "./objects.js";
import { HcmServer, type ServerPort } from "./hcm-server.js";
import { WriteOutcome } from "./write-outcome.js";
import { ReplyPacker } from "./reply.js";
import type { RuntimePort } from "./runtime-port.js";
import type {
  ConnectionConfig,
  OperationDefinition,
  OperationEffect,
  OperationFilter,
  OperationPage,
  OperationResult,
} from "./contracts.js";

/** Единый runtime: сессии, сериализация, локальные права и артефакты для всех интерфейсов. */
export class HcmRuntime implements RuntimePort {
  readonly gateway: NativeGateway;
  readonly results: ResultStore;
  readonly logs: LogReader;
  private readonly replies: ReplyPacker;
  private readonly server: HcmServer;
  private readonly schemaReader: SchemaReader;
  private readonly files: ServerFiles;
  private readonly objects: ServerObjects;
  private readonly rpcCatalog: RpcCatalog;
  private readonly context: OperationContext;
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  private closePromise: Promise<void> | undefined;
  constructor(
    readonly config: ConnectionConfig,
    /** Как дойти до сервера; по умолчанию — шлюз подключения. */
    port?: ServerPort,
  ) {
    this.results = new ResultStore(config);
    this.replies = new ReplyPacker(config, this.results);
    this.gateway = new NativeGateway(config);
    this.server = new HcmServer(port ?? this.gateway);
    this.logs = new LogReader({ call: (id, args) => this.server.read(id, args) }, config);
    this.files = new ServerFiles(this.server, config.permissions);
    this.rpcCatalog = new RpcCatalog(
      () => this.server.applicationInfo(),
      (url) => this.server.call("native.lds.loadUrl", { url }),
    );
    this.schemaReader = new SchemaReader(
      () => this.server.applicationInfo(),
      async (url) =>
        requiredString(await this.server.call("native.spxml2.getForm", { url }), "ответ с формой"),
      async (url) => (await this.objects.load({ url })).document.snapshot().data,
    );
    this.objects = new ServerObjects(this.server, this.schemaReader, this.results.directory);
    this.context = {
      config,
      server: this.server,
      objects: this.objects,
      files: this.files,
      schema: this.schemaReader,
      logs: this.logs,
      results: this.results,
      rpcCatalog: this.rpcCatalog,
      pageBytes: this.replies.pageBytes,
      operationCount: operations.length,
      pipeline: {
        describe: (id) => this.describe(id),
        failure: (id, error) => this.failure(id, performance.now(), error),
        step: (id, args, call) => this.perform(id, args, performance.now(), false, call),
        // async: и отказ до первого запроса приходит отклонённым промисом, а не исключением.
        invoke: async (id, args) =>
          this.operation(id).run(this.context, args, {
            outcome: new WriteOutcome(),
            effect: "read",
          }),
      },
    };
  }
  listOperations(filter: OperationFilter = {}): OperationPage {
    return listHcmOperations(filter);
  }
  describe(id: string): OperationDefinition {
    return describeHcmOperation(id);
  }
  /**
   * Условные побочные эффекты по фактическим аргументам; MCP, CLI и SDK обязаны вызвать это
   * до маршрутизации.
   */
  getOperationEffect(id: string, args: Record<string, unknown> = {}): OperationEffect {
    return this.effect(this.operation(id), args);
  }
  /** Определение операции; отказ для неверного или неизвестного ID формулирует describe. */
  private operation(id: string): Operation {
    this.describe(id);
    return operationSpec(id)!;
  }
  call(id: string, args: Record<string, unknown> = {}): Promise<OperationResult> {
    const start = performance.now();
    // Отказ до очереди: запрос не ушёл, исход несут только запись и выполнение кода.
    const unsent = {
      outcome: new WriteOutcome(),
      effect: operationDefinition(id)?.effect ?? "unknown",
    };
    if (this.closed)
      return Promise.resolve(
        this.failure(id, start, new HcmError("RUNTIME_CLOSED", "Подключение уже закрыто."), unsent),
      );
    let snapshot: Record<string, unknown>;
    try {
      snapshot = inputObject(structuredClone(args));
    } catch {
      return Promise.resolve(
        this.failure(
          id,
          start,
          new HcmError(
            "INVALID_ARGUMENT",
            "Аргументы операции — не объект, или в них есть значение, которое нельзя скопировать.",
            "Нужно передать значения, совместимые с JSON; двоичные данные — как {base64: …}, XML — как {xml: …}.",
          ),
          unsent,
        ),
      );
    }
    const run = this.queue.then(() => this.perform(id, snapshot, start));
    this.queue = run.catch(() => undefined);
    return run;
  }
  private effect(operation: Operation, args: Record<string, unknown>): OperationEffect {
    return (
      operation.effectFor?.(args, (id) => {
        const other = this.operation(id);
        return (otherArgs) => this.effect(other, otherArgs);
      }) ?? operation.effect
    );
  }
  private authorize(effect: OperationEffect): void {
    if ((effect === "write" || effect === "unknown") && !this.config.permissions.write)
      throw new HcmError(
        "WRITE_DISABLED",
        "Подключение не разрешает запись.",
        "Нужно право write: его включает владелец подключения в настройках подключения (permissions.write).",
      );
    if ((effect === "execute" || effect === "unknown") && !this.config.permissions.execute)
      throw new HcmError(
        "EXECUTE_DISABLED",
        "Подключение не разрешает выполнять код, функции и запросы XQuery на сервере.",
        "Нужно право execute: его включает владелец подключения в настройках подключения (permissions.execute).",
      );
  }
  private async perform(
    id: string,
    args: Record<string, unknown>,
    start: number,
    boundOutput = true,
    state: OperationCall = { outcome: new WriteOutcome(), effect: "read" },
  ): Promise<OperationResult> {
    try {
      const operation = this.operation(id);
      state.effect = operation.effect;
      validate(args, operation.inputSchema);
      state.effect = this.effect(operation, args);
      this.authorize(state.effect);
      const value = await operation.run(this.context, args, state);
      return await this.replies.success(id, start, value, boundOutput);
    } catch (error) {
      return this.failure(id, start, error, state);
    }
  }
  private failure(
    id: string,
    start: number,
    error: unknown,
    state: OperationCall = { outcome: new WriteOutcome(), effect: "read" },
  ): OperationResult {
    // Сервер пишет отклонённый запрос или упавший скрипт в свой лог.
    if (
      (error instanceof WsHcmApiError && error.status === 500) ||
      (error instanceof HcmError && error.code === "SCRIPT_FAILED")
    )
      this.logs.serverWroteLog();
    return this.replies.failure(
      id,
      start,
      error,
      state.outcome.verdict(state.effect, error),
      state,
    );
  }
  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    return (this.closePromise = this.queue.then(() => this.gateway.close()).then(() => undefined));
  }
}
