import type { NativeConfig, NativeOperation } from "../contracts.js";
import { WsHcmClient, type NativeSession, type WebSession } from "../protocol/client.js";
import { WsHcmBinaryResponse } from "../protocol/types.js";
import {
  ArgumentError,
  WsHcmApiError,
  attachCleanupError,
  isTransportFailure,
} from "../protocol/error.js";
import { rawXml } from "../protocol/xml.js";
import { NATIVE_ENTRIES, type NativeEntry } from "./generated.js";
import { validate, prepare } from "./validation.js";
import { freezeRegistry } from "../immutable.js";
import { getEffectiveNativeEffect, isInternalNative } from "./metadata.js";

const empty = { type: "object", properties: {}, required: [], additionalProperties: false };
// Замыкания явные и намеренно не дают доступа к произвольным полям и методам экземпляра.
const managed: NativeEntry[] = [];
managed.push({
  operation: {
    id: "anonymous.diagnostics.portal",
    profile: "anonymous",
    group: "diagnostics",
    method: "portal",
    title: "Portal status",
    description: "Прочитать статус стартовой страницы портала без перенаправлений и тела.",
    effect: "read",
    status: "implemented",
    inputSchema: empty,
  },
  invoke: async (gateway) => gateway.client.diagnostics.portal(),
});
managed.push({
  operation: {
    id: "web.websocket.heartbeat",
    profile: "web",
    group: "websocket",
    method: "heartbeat",
    title: "Stock WebSocket heartbeat",
    description:
      "Отправить один $hbt на /services/main_ws_service с ограничением по времени и дождаться $ok. Ответ различает закрытие со стороны сервера и отсутствие подтверждения; прикладные сообщения и браузерный /api/spxml2/ws не охвачены.",
    effect: "read",
    status: "implemented",
    inputSchema: {
      type: "object",
      properties: { timeoutMs: { type: "integer", minimum: 250, maximum: 10000 } },
      required: [],
      additionalProperties: false,
    },
  },
  invoke: async (gateway, args) => {
    gateway.client.assertWebSocketAvailable();
    return (await gateway.web()).heartbeat(args);
  },
});
const sessionDescriptions = {
  open: "Открыть сессию, которой владеет клиент; уже открытая используется повторно. Cookie и ID сессии LDS остаются внутри этого процесса.",
  close:
    "Закрыть сессию на сервере и убрать её из клиента; следующий вызов этого профиля откроет новую.",
};
for (const profile of ["native", "web"] as const) {
  for (const method of ["open", "close"] as const) {
    managed.push({
      operation: {
        id: `${profile}.session.${method}`,
        profile,
        group: "session",
        method,
        title: `${profile} session ${method}`,
        description: sessionDescriptions[method],
        effect: "read",
        status: "implemented",
        inputSchema: empty,
      },
      invoke:
        method === "open"
          ? async (gateway) => {
              if (profile === "native") await gateway.native();
              else await gateway.web();
              return { opened: true, profile };
            }
          : async (gateway) => {
              await gateway.closeProfile(profile);
              return { closed: true, profile };
            },
    });
  }
}
managed.push({
  operation: {
    id: "native.physicalDocuments.createFromXml",
    profile: "native",
    group: "physicalDocuments",
    method: "createFromXml",
    title: "Create a physical XML document",
    description:
      "Выделить ID, подставить его вместо {{objectId}} в documentXmlTemplate, сохранить через PutDoc и сверить ID корня через LoadDoc. Обработка XMD, как в клиенте администратора, не воспроизводится.",
    effect: "write",
    status: "implemented",
    inputSchema: {
      type: "object",
      properties: {
        documentXmlTemplate: { type: "string" },
        dbName: { type: "string" },
        writeDocInfo: { type: "boolean" },
        skipActions: { type: "boolean" },
        neverSaved: { type: "boolean" },
      },
      required: ["documentXmlTemplate"],
      additionalProperties: false,
    },
  },
  invoke: async (gateway, args) => {
    const session = await gateway.native();
    return session.physicalDocuments.createFromXml({
      ...(args.dbName === undefined ? {} : { dbName: args.dbName as string }),
      ...(args.writeDocInfo === undefined ? {} : { writeDocInfo: args.writeDocInfo as boolean }),
      ...(args.skipActions === undefined ? {} : { skipActions: args.skipActions as boolean }),
      ...(args.neverSaved === undefined ? {} : { neverSaved: args.neverSaved as boolean }),
      document: ({ objectId }) =>
        rawXml((args.documentXmlTemplate as string).replaceAll("{{objectId}}", objectId)),
    });
  },
});

const entries = freezeRegistry([...NATIVE_ENTRIES, ...managed]);
const byId = new Map(entries.map((entry) => [entry.operation.id, entry]));
if (byId.size !== entries.length) throw new Error("ID низкоуровневой операции повторяется");
export function getNativeOperations(): readonly NativeOperation[] {
  return entries.map((entry) => entry.operation).filter((item) => !isInternalNative(item.id));
}

/** Эффект операции реестра для этих аргументов (и внутренней); undefined для неизвестного ID. */
export function nativeEffect(
  id: string,
  args: Record<string, unknown>,
): NativeOperation["effect"] | undefined {
  const entry = byId.get(id);
  return entry && getEffectiveNativeEffect(entry.operation, args);
}

/** Любой сбой внутри ошибки очистки — HTTP 401 сервера: он больше не знает сессию. */
function sessionGone(error: unknown): boolean {
  if (!(error instanceof WsHcmApiError) || error.kind !== "cleanup") return false;
  const causes = error.cause instanceof AggregateError ? error.cause.errors : [error.cause];
  return causes.every((cause) => cause instanceof WsHcmApiError && cause.status === 401);
}

const failedLogins = new WeakSet<object>();
/** Сбой случился при открытии сессии: сама операция не отправлена. */
export function loginFailed(error: unknown): boolean {
  return typeof error === "object" && error !== null && failedLogins.has(error);
}

/** Владелец состояния для SDK, MCP и CLI. Вызовы идут по очереди: сессия и курсор не путаются. */
export class NativeGateway {
  readonly client: WsHcmClient;
  private nativeSession: Promise<NativeSession> | undefined;
  private webSession: Promise<WebSession> | undefined;
  private closed = false;
  private accepting = true;
  private queue: Promise<unknown> = Promise.resolve();
  private closePromise: Promise<void> | undefined;

  constructor(config: NativeConfig) {
    if ((config.username === undefined) !== (config.password === undefined))
      throw new ArgumentError("Имя пользователя и пароль задают вместе.");
    this.client = new WsHcmClient({
      baseUrl: config.baseUrl,
      timeoutMs: config.timeoutMs,
      maxResponseBytes: config.maxResponseBytes,
      ...(config.fetch ? { fetch: config.fetch } : {}),
      ...(config.webSocketFactory === undefined
        ? {}
        : { webSocketFactory: config.webSocketFactory }),
      ...(config.username === undefined
        ? {}
        : { auth: { username: config.username, password: config.password! } }),
    });
  }
  private assertOpen(): void {
    if (this.closed) throw new WsHcmApiError("protocol", "Шлюз закрыт");
  }
  native(): Promise<NativeSession> {
    this.assertOpen();
    return (this.nativeSession ??= this.client.openNativeSession().catch((error) => {
      this.nativeSession = undefined;
      if (error instanceof Error) failedLogins.add(error);
      throw error;
    }));
  }
  web(): Promise<WebSession> {
    this.assertOpen();
    return (this.webSession ??= this.client.openWebSession().catch((error) => {
      this.webSession = undefined;
      if (error instanceof Error) failedLogins.add(error);
      throw error;
    }));
  }
  private takeProfile(profile: "native" | "web") {
    const session = profile === "native" ? this.nativeSession : this.webSession;
    if (profile === "native") this.nativeSession = undefined;
    else this.webSession = undefined;
    return session;
  }
  async closeProfile(profile: "native" | "web"): Promise<void> {
    const session = this.takeProfile(profile);
    if (session) await (await session).close();
  }
  call(id: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.accepting) return Promise.reject(new WsHcmApiError("protocol", "Шлюз закрыт"));
    const entry = byId.get(id);
    if (!entry)
      return Promise.reject(new WsHcmApiError("protocol", "Неизвестная низкоуровневая операция"));
    let snapshot: Record<string, unknown>;
    // Проверяется собственный снимок, чтобы вызывающий не мог подменить URL или вложенные обёртки
    // XML и двоичных данных, пока предыдущий принятый вызов занимает очередь.
    try {
      snapshot = structuredClone(args);
      prepare(snapshot, entry.operation.inputSchema);
    } catch (error) {
      return Promise.reject(error);
    }
    const run = this.queue.then(async () => {
      let failed = false;
      let operationError: unknown;
      try {
        return await this.output(await this.invoke(entry, snapshot));
      } catch (error) {
        failed = true;
        operationError = error;
        throw error;
      } finally {
        if (id === "web.lifecycle.logout") {
          const session = this.webSession;
          this.webSession = undefined;
          if (session) {
            try {
              (await session).disposeLocal();
            } catch (cleanupError) {
              if (failed) attachCleanupError(operationError, cleanupError);
              else throw cleanupError;
            }
          }
        }
      }
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
  /**
   * Сервер сбрасывает сессию, простоявшую без дела (на стендах — в пределах двадцати минут),
   * или закрытую с его стороны; каждый следующий запрос получает HTTP 401. Долгоживущий владелец
   * остался бы без доступа, поэтому сброшенная сессия заменяется новым входом, и запрос
   * отправляется ещё раз. Сервер отклоняет такой запрос до обработки, поэтому повтор не может
   * выполнить что-либо дважды.
   */
  private async invoke(entry: NativeEntry, args: Record<string, unknown>): Promise<unknown> {
    const profile = entry.operation.profile;
    const session =
      profile === "native" ? this.nativeSession : profile === "web" ? this.webSession : undefined;
    try {
      return await entry.invoke(this, args);
    } catch (error) {
      // Без предыдущей сессии это был сам вход: его отказ окончателен.
      if (
        session === undefined ||
        profile === "anonymous" ||
        !(error instanceof WsHcmApiError) ||
        error.kind !== "auth" ||
        error.status !== 401 ||
        /[.](?:session|lifecycle)[.]/.test(entry.operation.id)
      )
        throw error;
      const current = profile === "native" ? this.nativeSession : this.webSession;
      if (current === session) {
        this.takeProfile(profile);
        (await session).disposeLocal();
      }
      return entry.invoke(this, args);
    }
  }
  private async output(result: unknown): Promise<unknown> {
    if (result === undefined) return { completed: true };
    if (result instanceof WsHcmBinaryResponse) {
      const bytes = new Uint8Array(await new Response(result.body).arrayBuffer());
      return {
        kind: "binary",
        bytes,
        contentType: result.headers.get("content-type") ?? "application/octet-stream",
      };
    }
    if (result && typeof result === "object" && "data" in result && "rawBody" in result)
      return (result as { data: unknown }).data;
    if (result && typeof result === "object" && "putResponse" in result) {
      const created = result as unknown as {
        objectId: string;
        url: string;
        loadResponse: { data: unknown };
      };
      return { objectId: created.objectId, url: created.url, document: created.loadResponse.data };
    }
    return result;
  }
  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.accepting = false;
    return (this.closePromise = this.finishClose());
  }
  private async finishClose(): Promise<void> {
    await this.queue;
    this.closed = true;
    const errors: unknown[] = [];
    let transportLost = false;
    // Закрытие одного профиля должно завершиться полностью, прежде чем другой сможет отправлять.
    // Так потеря транспорта останавливает дальнейшую очистку без гонок выхода с запросами в полёте.
    for (const profile of ["native", "web"] as const) {
      try {
        if (transportLost) {
          const session = this.takeProfile(profile);
          if (session) (await session).disposeLocal();
        } else await this.closeProfile(profile);
      } catch (error) {
        // Сессию, которую сервер уже сбросил, закрывать не нужно.
        if (sessionGone(error)) continue;
        errors.push(error);
        transportLost ||= isTransportFailure(error);
      }
    }
    this.client.close();
    if (errors.length)
      throw new WsHcmApiError("cleanup", "Не удалось закрыть сессии шлюза", {
        details: { errorCount: errors.length, remoteCleanupStopped: transportLost },
        cause:
          errors.length === 1
            ? errors[0]
            : new AggregateError(errors, "Ошибки при закрытии сессий шлюза"),
      });
  }
}
