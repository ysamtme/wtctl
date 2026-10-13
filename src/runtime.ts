import { operations, operationDefinition } from "./operations.js";
import { listHcmOperations, describeHcmOperation } from "./catalog.js";
import { NativeGateway, getEffectiveNativeEffect, WsHcmApiError } from "./native/index.js";
import { validate, prepare } from "./native/validation.js";
import { findXmlNode, escapeXml } from "./protocol/xml.js";
import { parsePhysicalDocumentId } from "./protocol/physical-documents.js";
import { HcmError, inputObject, requiredString, boundedInteger, scalar } from "./errors.js";
import { logFiles, logMatches, logNews, logText } from "./log-output.js";
import { SchemaReader, withRepeated, type SchemaInput, type SchemaTypesInput } from "./schema.js";
import {
  catalogQuery,
  identifier,
  looksLikeDate,
  hasStructure,
  looksLikeDecimalId,
  orderFields,
  queryPage,
  rowTag,
  withoutFalseOffset,
  xqueryNames,
} from "./query.js";
import { ResultStore } from "./results.js";
import { LogReader, type LogReadInput, type LogSearchInput, type LogFollowInput } from "./logs.js";
import { RpcCatalog } from "./rpc-catalog.js";
import { agentRun, agentRunResult, prepareScript, rpcValue, scriptResult } from "./scripts.js";
import { parseServerInfo, type ServerInfoData, type ServerInfoProfile } from "./server-info.js";
import { checkServer } from "./self-check.js";
import { ServerFiles } from "./files.js";
import { ServerObjects } from "./objects.js";
import { HcmServer, type ServerPort } from "./hcm-server.js";
import { WriteOutcome } from "./write-outcome.js";
import { ReplyPacker, type BatchRecovery } from "./reply.js";
import type { RuntimePort } from "./runtime-port.js";
import type {
  ConnectionConfig,
  OperationDefinition,
  OperationEffect,
  OperationFilter,
  OperationPage,
  OperationResult,
} from "./contracts.js";
import type { NativeOperation } from "./contracts.js";

interface ExecutionState {
  readonly outcome: WriteOutcome;
  effect: OperationEffect;
  /** The operation whose usual HTTP 500 cause the failure hint states, when not the called one. */
  refusal?: string;
  batchRecovery?: BatchRecovery;
}
/** A raw protocol answer carries XML formatting: indentation between elements and the namespace attribute. */
function withoutXmlFormatting(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutXmlFormatting);
  if (!value || typeof value !== "object" || value instanceof Uint8Array) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key, child]) =>
          key !== "@_xmlns" &&
          !(key === "#text" && typeof child === "string" && child.trim() === ""),
      )
      .map(([key, child]) => [
        key,
        // A line break and the indentation of the closing tag are formatting of an empty element.
        typeof child === "string" && /^\s*\n[ \t]+$/.test(child) ? "" : withoutXmlFormatting(child),
      ]),
  );
}

/**
 * A raw answer in the form a caller can use. The server names an uploaded file by its path inside
 * the uploads folder, breaks base64 into lines and gives the result of a background task as typed
 * XML; a caller needs the address of the file, the base64 as one piece and the value as plain JSON.
 */
function plainAnswer(id: string, answer: unknown): unknown {
  if (answer === null || typeof answer !== "object" || Array.isArray(answer)) return answer;
  const data = answer as Record<string, unknown>;
  if (id === "web.pages.uploadFile" && typeof data.Url === "string" && data.Url) {
    const url = `x-local://share/uploaded_files/${data.Url}`;
    const { Url: _, ...rest } = data;
    return { ...rest, url, folderUrl: url.slice(0, url.lastIndexOf("/")) };
  }
  if (id === "web.spxml.getAsyncMethodStatus" && data.ResultData !== undefined)
    try {
      const decoded = rpcValue(data);
      if (decoded !== data) {
        const { ResultData: _typed, ...state } = data;
        return { ...state, ...(decoded as Record<string, unknown>) };
      }
    } catch {
      // A result that has no plain form stays as the server gave it.
    }
  return answer;
}
/** One runtime owns sessions, serialization, local policy and artifacts for every frontend. */
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
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  private closePromise: Promise<void> | undefined;
  constructor(
    readonly config: ConnectionConfig,
    /** How to reach the server; the connection's gateway by default. */
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
  }
  listOperations(filter: OperationFilter = {}): OperationPage {
    return listHcmOperations(filter);
  }
  describe(id: string): OperationDefinition {
    return describeHcmOperation(id);
  }
  /** Resolve conditional side effects for the actual arguments; frontends must use this before routing. */
  getOperationEffect(id: string, args: Record<string, unknown> = {}): OperationEffect {
    return this.effect(this.describe(id), args);
  }
  call(id: string, args: Record<string, unknown> = {}): Promise<OperationResult> {
    const start = performance.now();
    if (this.closed)
      return Promise.resolve(
        this.failure(id, start, new HcmError("RUNTIME_CLOSED", "Подключение уже закрыто.")),
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
          { outcome: new WriteOutcome(), effect: operationDefinition(id)?.effect ?? "unknown" },
        ),
      );
    }
    const run = this.queue.then(() => this.perform(id, snapshot, start));
    this.queue = run.catch(() => undefined);
    return run;
  }
  private effect(operation: OperationDefinition, args: Record<string, unknown>): OperationEffect {
    if (operation.id === "runtime.query") {
      const deferredArguments = Object.keys(args).length === 1 && typeof args.$ref === "string";
      return deferredArguments || args.query !== undefined ? "execute" : "read";
    }
    if (operation.id === "objects.patch" && args.preview === true) return "read";
    if (operation.id === "runtime.batch") {
      const steps = args.steps;
      if (!Array.isArray(steps)) return "unknown";
      const effects = steps.map((raw) => {
        const step = inputObject(raw, "step");
        const id = requiredString(step.id, "step.id");
        if (id === "runtime.batch")
          throw new HcmError("NESTED_BATCH", "Пакет внутри пакета не поддерживается.");
        return this.effect(
          this.describe(id),
          step.args === undefined ? {} : inputObject(step.args),
        );
      });
      if (effects.includes("unknown") || (effects.includes("write") && effects.includes("execute")))
        return "unknown";
      return effects.includes("execute") ? "execute" : effects.includes("write") ? "write" : "read";
    }
    return operation.profile === undefined
      ? operation.effect
      : getEffectiveNativeEffect(operation as NativeOperation, args);
  }
  private authorize(effect: OperationEffect): void {
    if ((effect === "write" || effect === "unknown") && !this.config.permissions.write)
      throw new HcmError(
        "WRITE_DISABLED",
        "Подключение не разрешает запись.",
        "Нужно право write: его включает владелец подключения в настройках подключения (permissions.write).",
        undefined,
        "not_sent",
      );
    if ((effect === "execute" || effect === "unknown") && !this.config.permissions.execute)
      throw new HcmError(
        "EXECUTE_DISABLED",
        "Подключение не разрешает выполнять код, функции и запросы XQuery на сервере.",
        "Нужно право execute: его включает владелец подключения в настройках подключения (permissions.execute).",
        undefined,
        "not_sent",
      );
  }
  private async perform(
    id: string,
    args: Record<string, unknown>,
    start: number,
    boundOutput = true,
    state: ExecutionState = { outcome: new WriteOutcome(), effect: "read" },
  ): Promise<OperationResult> {
    try {
      const operation = this.describe(id);
      state.effect = operation.effect;
      validate(args, operation.inputSchema);
      state.effect = this.effect(operation, args);
      this.authorize(state.effect);
      if (operation.profile !== undefined) prepare(args, operation.inputSchema);
      const value = await this.dispatch(id, args, state);
      return await this.replies.success(id, start, value, boundOutput);
    } catch (error) {
      return this.failure(id, start, error, state);
    }
  }
  private failure(
    id: string,
    start: number,
    error: unknown,
    state: ExecutionState = { outcome: new WriteOutcome(), effect: "read" },
  ): OperationResult {
    // The server writes a refused request or a failed script to its log.
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
  private async serverInfo(profile: ServerInfoProfile): Promise<ServerInfoData> {
    return parseServerInfo(
      await this.server.read(`${profile}.rpc.call`, {
        target: "ms_tools.get_admin_init_server_data",
        args: [],
      }),
      profile,
    );
  }
  /**
   * Date and integer fields of the catalog, read only when a condition holds a value written as a
   * date or as a decimal ID: such a value must reach a date field as date('…') and an integer field
   * as a number, and the form is the only place that tells them from strings.
   */
  private async typedFields(
    catalog: unknown,
    where: unknown,
  ): Promise<{ dates: ReadonlySet<string>; integers: ReadonlySet<string> }> {
    const none = { dates: new Set<string>(), integers: new Set<string>() };
    if (typeof catalog !== "string" || !where || typeof where !== "object") return none;
    const values = Object.values(where).flatMap((condition) =>
      condition && typeof condition === "object" ? Object.values(condition).flat() : [condition],
    );
    if (!values.some((value) => looksLikeDate(value) || looksLikeDecimalId(value))) return none;
    const shape = await this.schemaReader.catalogShape({ catalog }).catch(() => undefined);
    return { dates: shape?.dates ?? none.dates, integers: shape?.integers ?? none.integers };
  }
  private async dispatch(
    id: string,
    args: Record<string, unknown>,
    state: ExecutionState,
  ): Promise<unknown> {
    switch (id) {
      case "runtime.check":
        return checkServer(this.config, (operation, input) =>
          this.dispatch(operation, input, { outcome: new WriteOutcome(), effect: "read" }),
        );
      case "files.exists":
        return this.files.exists(args);
      case "files.read":
        return this.files.read(args);
      case "files.list":
        return this.files.list(args, state);
      case "files.write":
        return this.files.write(args, state);
      case "files.delete":
        return this.files.delete(args, state);
      case "server.info": {
        const info = await this.serverInfo(args.profile === "web" ? "web" : "native");
        const folders = info.profile === "native" ? await this.files.folders() : undefined;
        return folders ? { ...info, dataFolders: folders.data, codeFolders: folders.code } : info;
      }
      case "runtime.status": {
        const version = await this.server.read("native.rpc.call", {
          target: "tools.get_version",
          args: [{ valueType: "string", lexicalValue: "wtv" }],
        });
        // The server names the document of the signed-in user; without it the answer just lacks userId.
        const info = await this.server.applicationInfo().catch(() => undefined);
        const userId =
          typeof info?.auth_object_url === "string"
            ? parsePhysicalDocumentId(info.auth_object_url)
            : undefined;
        const database = (await this.serverInfo("native").catch(() => undefined))?.database;
        return {
          connection: this.config.name,
          baseUrl: this.config.baseUrl,
          version: scalar(findXmlNode(version, "Result"), "версии"),
          ...(database ? { database } : {}),
          ...(userId ? { userId } : {}),
          operationCount: operations.length,
          permissions: this.config.permissions,
        };
      }
      case "runtime.query": {
        if (args.query !== undefined && args.catalog !== undefined)
          throw new HcmError("QUERY_ARGUMENT", "Нужно указать query или catalog, но не оба.");
        if (args.query !== undefined && args.order !== undefined)
          throw new HcmError(
            "QUERY_ARGUMENT",
            "order работает с catalog.",
            "В тексте XQuery сортировку пишут сами: order by $e/поле.",
          );
        if (typeof args.catalog === "string" && /^[A-Za-z_]\w*\.[\w.]+$/.test(args.catalog))
          throw new HcmError(
            "UNKNOWN_CATALOG",
            `${args.catalog} — общий список сервера, а не каталог.`,
            `Его элементы читает запрос XQuery: for $e in ${args.catalog} return $e.`,
          );
        const typed =
          args.query === undefined ? await this.typedFields(args.catalog, args.where) : undefined;
        const query = typed
          ? catalogQuery(args.catalog, args.where, typed.dates, args.order, typed.integers)
          : requiredString(args.query, "query");
        if (args.query === undefined && args.order !== undefined) {
          // MS SQL refuses to sort by a field of several values, PostgreSQL sorts somehow.
          const shape = await this.schemaReader
            .catalogShape({ catalog: requiredString(args.catalog, "catalog") })
            .catch(() => undefined);
          const repeated = orderFields(args.order)
            .map((item) => item.field)
            .filter((field) => shape?.repeated.has(field));
          if (repeated.length)
            throw new HcmError(
              "INVALID_ARGUMENT",
              `order: поле хранит несколько значений, сортировать по нему нельзя: ${repeated.join(", ")}.`,
              "Нужно выбрать поле с одним значением: у такого в schema.get нет multiple:true.",
              { fields: repeated },
            );
        }
        const limit = boundedInteger(args.limit, 20, 1000, "limit");
        if (limit === 0)
          throw new HcmError("INVALID_ARGUMENT", "limit: нужно целое число от 1 до 1000.");
        const startPos = boundedInteger(args.startPosition, 0, 1000000, "startPosition");
        // A query only reads, except one that hands SQL text to the database.
        const sql = args.query !== undefined && /^\s*sql\s*:/i.test(query);
        if (args.query !== undefined && !sql) state.effect = "read";
        let response: unknown;
        try {
          const request = {
            query,
            startPos,
            maxCount: limit,
            expectToReadAll: false,
            keepCursor: false,
          };
          response = await (sql
            ? this.server.call("native.lds.xQuery", request, state.outcome)
            : this.server.read("native.lds.xQuery", request));
        } catch (error) {
          const refused = error instanceof WsHcmApiError && error.kind === "soap-fault";
          let reason: HcmError | undefined;
          // The refusal is in the server log whatever name it gets here: a log read waits for it.
          if (refused) this.logs.serverWroteLog();
          if (refused)
            for (const [catalog, fields] of args.query === undefined
              ? [
                  [
                    requiredString(args.catalog, "catalog"),
                    [
                      ...Object.keys(inputObject(args.where ?? {}, "where")),
                      ...orderFields(args.order).map((item) => item.field),
                    ],
                  ] as const,
                ]
              : xqueryNames(query)) {
              reason = await this.schemaReader.explainQuery(catalog, fields).catch(() => undefined);
              if (reason) break;
            }
          throw reason ?? error;
        }
        const read = queryPage(response, startPos, limit, args.fields, args.query !== undefined);
        const page = { ...read, items: read.items.map(withoutFalseOffset) as typeof read.items };
        // An empty database table lets a wrong catalog name through: the answer is empty, not refused.
        if (!page.items.length && args.query === undefined) {
          const missing = await this.schemaReader
            .explainQuery(requiredString(args.catalog, "catalog"), [])
            .catch(() => undefined);
          if (missing) throw missing;
        }
        const requested = Array.isArray(args.fields) ? (args.fields as string[]) : [];
        // Asked for and present in no row: empty in these rows, or not a field of the catalog.
        // On an empty page of a catalog search every asked name is checked against the catalog.
        const absent = page.items.length
          ? requested.filter((field) => page.items.every((item) => !Object.hasOwn(item, field)))
          : args.query === undefined
            ? requested
            : [];
        const lacking = page.items.some((item) =>
          requested.some((field) => !Object.hasOwn(item, field)),
        );
        if (!absent.length && !lacking && !page.items.some(hasStructure)) return page;
        const shape = await this.schemaReader
          .catalogShape(
            args.query === undefined
              ? { catalog: requiredString(args.catalog, "catalog") }
              : { type: rowTag(response) ?? "" },
          )
          .catch(() => undefined);
        if (!shape) return page;
        const unknownFields = shape.fields.size
          ? absent.filter((field) => !shape.fields.has(field))
          : [];
        // The server leaves an empty field out of a row. A field asked by name comes back anyway,
        // empty: a row then has the same columns as the next one.
        // A field that holds a structure is left as the server gave it.
        const asked = requested.filter(
          (field) =>
            shape.fields.has(field) &&
            ![...shape.repeated].some((path) => path.startsWith(`${field}.`)),
        );
        return {
          ...page,
          items: page.items.map((item) => {
            const row = withRepeated(item, shape.repeated) as Record<string, unknown>;
            for (const field of asked)
              if (!Object.hasOwn(row, field)) row[field] = shape.repeated.has(field) ? [] : "";
            return row;
          }),
          ...(unknownFields.length
            ? {
                unknownFields,
                hint: [
                  page.hint,
                  "Полей из unknownFields нет в строке каталога. Поле документа читает objects.get.",
                ]
                  .filter(Boolean)
                  .join(" "),
              }
            : {}),
        };
      }
      case "objects.get": {
        if (args.ids === undefined) return this.objects.get(args);
        // Several objects in one call: each is read as a single one, a missing one does not stop the rest.
        const ids = args.ids;
        if (args.id !== undefined || args.url !== undefined)
          throw new HcmError("INVALID_ARGUMENT", "ids: вместе с id или url не задаётся.");
        if (
          !Array.isArray(ids) ||
          ids.length < 1 ||
          ids.length > 100 ||
          ids.some((id) => typeof id !== "string")
        )
          throw new HcmError("INVALID_ARGUMENT", "ids: список от 1 до 100 ID, каждый строкой.");
        const items: unknown[] = [];
        let failed = 0;
        for (const id of ids as string[]) {
          try {
            items.push(await this.objects.get({ type: args.type, fields: args.fields, id }));
          } catch (error) {
            const refusal = this.failure("objects.get", performance.now(), error).error!;
            // A server that does not answer or refuses the login is not about one object.
            if (/^PLATFORM_(?!SOAP-FAULT)/.test(refusal.code)) throw error;
            failed++;
            items.push({ id, error: { code: refusal.code, message: refusal.message } });
          }
        }
        return {
          items,
          total: items.length,
          ...(failed
            ? { failed, hint: "PLATFORM_SOAP-FAULT у элемента: обычно объекта с таким ID нет." }
            : {}),
        };
      }
      case "objects.create":
        return this.objects.create(args, state.outcome);
      case "objects.patch":
        return this.objects.patch(args, state.outcome);
      case "objects.delete":
        return this.objects.delete(args, state.outcome);
      case "schema.get":
        return this.schemaReader.get(args as SchemaInput);
      case "schema.types":
        return this.schemaReader.types(args as SchemaTypesInput);
      case "logs.list":
        return logFiles(await this.logs.list(args));
      case "logs.read": {
        // Without an explicit size the answer is the end of the file that fits one reply.
        const input = (args.tailBytes === undefined && args.full !== true
          ? { ...args, tailBytes: this.replies.pageBytes }
          : args) as unknown as LogReadInput;
        return logText(await this.logs.read(input));
      }
      case "logs.search":
        return logMatches(
          await this.logs.search(args as unknown as LogSearchInput),
          this.replies.pageBytes,
        );
      case "logs.follow":
        return logNews(
          await this.logs.follow(args as unknown as LogFollowInput),
          args.cursor === undefined,
          this.replies.pageBytes,
        );
      case "results.read":
        return this.results.read(
          requiredString(args.resultId, "resultId"),
          args.offset,
          args.limit,
          args.format,
        );
      case "results.export":
        return this.results.export(args as unknown as import("./results.js").ResultExportInput);
      case "rpc.list":
        return this.rpcCatalog.list(args);
      case "rpc.describe":
        return this.rpcCatalog.describe(requiredString(args.targetId, "targetId"), args);
      case "rpc.call": {
        const target = `${identifier(args.library, "library")}.${identifier(args.method, "method")}`;
        const supplied = args.arguments ?? [];
        if (!Array.isArray(supplied))
          throw new HcmError("INVALID_ARGUMENT", "arguments: нужен массив.");
        const encoded = supplied.map((value) => {
          if (value !== null && typeof value === "object")
            return inputObject(value, "аргумент функции");
          if (value === null) return { valueType: "null", lexicalValue: "" };
          if (typeof value === "string") return { valueType: "string", lexicalValue: value };
          if (typeof value === "boolean")
            return { valueType: "bool", lexicalValue: value ? "1" : "0" };
          if (typeof value === "number" && Number.isSafeInteger(value))
            return { valueType: "integer", lexicalValue: String(value) };
          throw new HcmError(
            "INVALID_RPC_ARGUMENT",
            "Такой аргумент функции задаётся явно: {valueType, lexicalValue}. Так передают дробные и большие числа, даты, объекты и XML.",
          );
        });
        const operationId = args.async === true ? "web.spxml.callMethodAsync" : "native.rpc.call";
        const nativeArgs = { target, args: encoded };
        try {
          prepare(nativeArgs, this.describe(operationId).inputSchema);
        } catch (error) {
          // The caller wrote arguments[i]; the wire name of the list is not theirs to know.
          const index = error instanceof TypeError && /^args\.args\[(\d+)\]/.exec(error.message);
          if (!index) throw error;
          throw new HcmError(
            "INVALID_RPC_ARGUMENT",
            `arguments[${index[1]}]: объект должен быть вида {valueType, lexicalValue}.`,
            "Строки, целые числа, true, false и null передаются как есть. Остальное — явно: {valueType:'date', lexicalValue:'2026-10-01T00:00:00'}, {valueType:'integer', lexicalValue:'6148914691236517121'}, {valueType:'real', lexicalValue:'1.5'}.",
          );
        }
        for (const argument of encoded)
          if (typeof argument.lexicalValue === "string") escapeXml(argument.lexicalValue);
        let response: unknown;
        try {
          response = await this.server.call(operationId, nativeArgs, state.outcome);
        } catch (error) {
          // The server gives no reason; a misspelt name or a function closed to clients is the usual one.
          if (error instanceof WsHcmApiError && error.status === 500) {
            this.logs.serverWroteLog();
            const reason = await this.rpcCatalog.refusal(target).catch(() => undefined);
            if (reason) throw reason;
          }
          throw error;
        }
        return args.async === true ? withoutXmlFormatting(response) : rpcValue(response);
      }
      case "execute.script":
      case "agents.run": {
        const agent = id === "agents.run" ? agentRun(args) : undefined;
        const { request, executionId } = agent
          ? prepareScript(agent.code, agent.params)
          : prepareScript(args.code, args.params);
        const data = await this.server.runCode({ request, executionId }, state.outcome);
        if (!agent) return data;
        // The agent has just written its lines: a log read that follows waits for the server.
        this.logs.serverWroteLog();
        return agentRunResult(data);
      }
      case "runtime.batch":
        return this.batch(args, state);
      default:
        return plainAnswer(
          id,
          withoutXmlFormatting(
            await this.server.call(id, args, state.effect === "read" ? undefined : state.outcome),
          ),
        );
    }
  }
  private async batch(args: Record<string, unknown>, state: ExecutionState): Promise<unknown> {
    if (!Array.isArray(args.steps) || args.steps.length === 0 || args.steps.length > 100)
      throw new HcmError("INVALID_BATCH", "steps: в пакете должно быть от 1 до 100 шагов.");
    const labels = new Set<string>();
    for (const [index, raw] of args.steps.entries()) {
      const at = `steps[${index}]`;
      const step = inputObject(raw, at);
      const stepId = requiredString(step.id, `${at}.id`);
      if (stepId === "runtime.batch")
        throw new HcmError("NESTED_BATCH", "Пакет внутри пакета не поддерживается.");
      this.describe(stepId);
      if (step.args !== undefined) inputObject(step.args, `${at}.args`);
      if (step.as !== undefined) {
        const label = identifier(step.as, `${at}.as`);
        if (labels.has(label))
          throw new HcmError(
            "DUPLICATE_STEP",
            `${at}.as: имя ${label} уже дано другому шагу; имена шагов пакета не повторяются.`,
            undefined,
            { path: `${at}.as` },
            "not_sent",
          );
        labels.add(label);
      }
    }
    const named = new Map<string, OperationResult>();
    const results: OperationResult[] = [];
    const recovery: BatchRecovery = {
      completed: 0,
      requested: args.steps.length,
      sentMutationSteps: 0,
      receipts: [],
    };
    state.batchRecovery = recovery;
    const resolveRefs = (value: unknown, depth = 0): unknown => {
      if (depth > 32)
        throw new HcmError("REFERENCE_DEPTH", "Аргументы шага вложены глубже 32 уровней.");
      if (Array.isArray(value)) return value.map((item) => resolveRefs(item, depth + 1));
      if (value === null || typeof value !== "object") return value;
      const record = inputObject(value);
      if (Object.keys(record).length === 1 && typeof record.$ref === "string") {
        const [stepName, ...path] = record.$ref.split(".");
        let result: unknown = named.get(stepName!);
        for (const key of path) {
          if (
            ["__proto__", "constructor", "prototype"].includes(key) ||
            result === null ||
            typeof result !== "object" ||
            !Object.hasOwn(result, key)
          )
            throw new HcmError(
              "INVALID_REFERENCE",
              "Ссылка $ref не находит значение: такого шага раньше не было, или в его результате нет такого поля.",
            );
          result = (result as Record<string, unknown>)[key];
        }
        if (result === undefined)
          throw new HcmError(
            "INVALID_REFERENCE",
            "Ссылка $ref называет шаг, которого раньше в пакете не было.",
          );
        return result;
      }
      return Object.fromEntries(
        Object.entries(record).map(([key, item]) => [key, resolveRefs(item, depth + 1)]),
      );
    };
    for (const raw of args.steps) {
      const step = inputObject(raw, "step");
      const stepId = requiredString(step.id, "step.id");
      let result: OperationResult;
      const childState: ExecutionState = { outcome: new WriteOutcome(), effect: "read" };
      try {
        const resolved =
          step.args === undefined ? {} : inputObject(resolveRefs(step.args), "step.args");
        result = await this.perform(stepId, resolved, performance.now(), false, childState);
      } catch (error) {
        result = this.failure(stepId, performance.now(), error);
      }
      const written = childState.outcome.verdict(childState.effect);
      if (written.sent) {
        state.outcome.sending();
        recovery.sentMutationSteps++;
      }
      // A named step carries its name: answers are matched to steps without counting positions.
      results.push(
        typeof step.as === "string" ? ({ as: step.as, ...result } as OperationResult) : result,
      );
      recovery.completed = results.length;
      const returned =
        result.data !== null && typeof result.data === "object"
          ? (result.data as Record<string, unknown>)
          : undefined;
      recovery.receipts.push({
        index: results.length - 1,
        operationId: stepId,
        ok: result.ok,
        ...(result.error === undefined
          ? {}
          : {
              errorCode: result.error.code,
              ...(result.error.mutationOutcome === undefined
                ? {}
                : { mutationOutcome: result.error.mutationOutcome }),
            }),
        ...(returned?.mutationOutcome === "confirmed" ? { mutationOutcome: "confirmed" } : {}),
        ...(written.ids.mutationId === undefined ? {} : { mutationId: written.ids.mutationId }),
        ...(written.ids.objectId === undefined ? {} : { objectId: written.ids.objectId }),
        ...(written.ids.executionId === undefined ? {} : { executionId: written.ids.executionId }),
        ...(written.ids.url === undefined ? {} : { url: written.ids.url }),
      });
      if (step.as !== undefined) named.set(identifier(step.as, "step.as"), result);
      if (!result.ok && args.stopOnError !== false) break;
    }
    return {
      results,
      completed: results.length,
      requested: args.steps.length,
      atomic: false,
      ok: results.every((result) => result.ok),
    };
  }
  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    return (this.closePromise = this.queue.then(() => this.gateway.close()).then(() => undefined));
  }
}
