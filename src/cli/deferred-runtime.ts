import { describeHcmOperation, listHcmOperations, operationEffect } from "../catalog.js";
import type {
  ConnectionConfig,
  OperationDefinition,
  OperationEffect,
  OperationFilter,
  OperationPage,
  OperationResult,
} from "../contracts.js";
import { HcmError } from "../errors.js";
import type { RuntimePort } from "../runtime-port.js";

/**
 * Runtime для MCP-сервера, который стартует до настройки подключения. Хост агента показывает
 * сервер, завершившийся при старте, как «failed» без причины; этот стартует, отдаёт список
 * инструментов и на каждый вызов отвечает, что настроить. Настройки читаются заново при каждом
 * вызове, поэтому после исправления перезапуск не нужен.
 */
export class DeferredRuntime implements RuntimePort {
  #runtime: RuntimePort | undefined;
  /** Чтение настроек, которое идёт сейчас: одновременные первые вызовы ждут одно, а не читают свои. */
  #opening: Promise<RuntimePort> | undefined;
  #error: HcmError;
  #closed = false;
  constructor(
    private readonly load: () => ConnectionConfig | Promise<ConnectionConfig>,
    private readonly create: (config: ConnectionConfig) => RuntimePort,
    firstError: HcmError,
    /** Как человек настраивает подключение на этом компьютере; добавляется к подсказке отказа. */
    private readonly setup?: string,
  ) {
    this.#error = firstError;
  }
  get results(): RuntimePort["results"] {
    return this.#runtime?.results;
  }
  private async ready(): Promise<RuntimePort | undefined> {
    if (this.#runtime || this.#closed) return this.#runtime;
    this.#opening ??= (async () => (this.#runtime = this.create(await this.load())))().finally(
      () => {
        this.#opening = undefined;
      },
    );
    try {
      return await this.#opening;
    } catch (error) {
      if (!(error instanceof HcmError)) throw error;
      this.#error = error;
      return undefined;
    }
  }
  listOperations(filter?: OperationFilter): OperationPage {
    return this.#runtime ? this.#runtime.listOperations(filter) : listHcmOperations(filter);
  }
  describe(id: string): OperationDefinition {
    return this.#runtime ? this.#runtime.describe(id) : describeHcmOperation(id);
  }
  getOperationEffect(id: string, args?: Record<string, unknown>): OperationEffect {
    return this.#runtime ? this.#runtime.getOperationEffect(id, args) : operationEffect(id, args);
  }
  async call(id: string, args?: Record<string, unknown>): Promise<OperationResult> {
    const runtime = await this.ready();
    if (runtime) return runtime.call(id, args);
    const error = this.#error.toJSON();
    return {
      ok: false,
      error:
        this.setup && error.code === "NOT_CONFIGURED"
          ? { ...error, hint: `${error.hint} ${this.setup}` }
          : error,
      meta: { operationId: id, connection: "unconfigured", durationMs: 0 },
    };
  }
  async close(): Promise<void> {
    // После закрытия runtime не создаётся; тот, что ещё создаётся, тоже закрывается.
    this.#closed = true;
    this.#error = new HcmError("RUNTIME_CLOSED", "Подключение уже закрыто.");
    await this.#opening?.catch(() => undefined);
    await this.#runtime?.close();
  }
}
