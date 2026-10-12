import type { NativeConfig, NativeOperation } from "../contracts.js";
import {
  WsHcmClient,
  type NativeSession,
  type WebSession,
  type LegacySession,
} from "../protocol/client.js";
import { WsHcmBinaryResponse } from "../protocol/types.js";
import { XHttpBinaryResponse } from "../protocol/api.js";
import { WsHcmApiError, attachCleanupError, isTransportFailure } from "../protocol/error.js";
import { rawXml } from "../protocol/xml.js";
import { NATIVE_ENTRIES, type NativeEntry } from "./generated.js";
import { validate, prepare } from "./validation.js";
import { freezeRegistry } from "../immutable.js";
import { loadOrCreateLegacyInstallationId } from "./identity.js";

const empty = { type: "object", properties: {}, required: [], additionalProperties: false };
const managed: NativeEntry[] = [];
managed.push({
  operation: {
    id: "anonymous.diagnostics.portal",
    profile: "anonymous",
    group: "diagnostics",
    method: "portal",
    title: "Portal status",
    description: "Read the portal landing status without redirects or body.",
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
      "Sends one bounded $hbt on /services/main_ws_service and observes $ok. A receipt distinguishes peer Close from missing acknowledgement; app messages and browser /api/spxml2/ws are not covered.",
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
for (const profile of ["native", "web", "legacy"] as const) {
  for (const method of ["open", "close"] as const) {
    managed.push({
      operation: {
        id: `${profile}.session.${method}`,
        profile,
        group: "session",
        method,
        title: `${profile} session ${method}`,
        description:
          "Opens or closes the gateway-owned session. Cookies and LDS IDs remain private to this process.",
        effect: "read",
        status: "implemented",
        inputSchema: empty,
      },
      invoke:
        method === "open"
          ? async (gateway) => {
              if (profile === "native") await gateway.native();
              else if (profile === "web") await gateway.web();
              else await gateway.legacy();
              return { opened: true, profile };
            }
          : async (gateway) => {
              await gateway.closeProfile(profile);
              return { closed: true, profile };
            },
    });
  }
}
// These closures are explicit and intentionally do not expose arbitrary instance members.
managed.push({
  operation: {
    id: "native.lds.closeSession",
    profile: "native",
    group: "lds",
    method: "closeSession",
    title: "Close native LDS context",
    description: "Closes the LDS and HTTP context and removes it from the gateway session cache.",
    effect: "read",
    status: "implemented",
    inputSchema: empty,
  },
  invoke: async (gateway) => {
    await gateway.closeProfile("native");
    return { closed: true };
  },
});
managed.push({
  operation: {
    id: "web.lds.closeSession",
    profile: "web",
    group: "lds",
    method: "closeSession",
    title: "Close web LDS context",
    description:
      "Closes the web LDS and HTTP context and removes it from the gateway session cache.",
    effect: "read",
    status: "implemented",
    inputSchema: empty,
  },
  invoke: async (gateway) => {
    await gateway.closeProfile("web");
    return { closed: true };
  },
});
managed.push({
  operation: {
    id: "native.lds.openSession",
    profile: "native",
    group: "lds",
    method: "openSession",
    title: "Open native LDS context",
    description:
      "Opens the gateway-owned native session. Internal session IDs remain in the gateway.",
    effect: "read",
    status: "implemented",
    inputSchema: empty,
  },
  invoke: async (gateway) => {
    await gateway.native();
    return { opened: true };
  },
});
managed.push({
  operation: {
    id: "web.lds.openSession",
    profile: "web",
    group: "lds",
    method: "openSession",
    title: "Open web LDS context",
    description: "Opens the gateway-owned web session. Internal session IDs remain in the gateway.",
    effect: "read",
    status: "implemented",
    inputSchema: empty,
  },
  invoke: async (gateway) => {
    await gateway.web();
    return { opened: true };
  },
});
managed.push({
  operation: {
    id: "native.physicalDocuments.createFromXml",
    profile: "native",
    group: "physicalDocuments",
    method: "createFromXml",
    title: "Create a physical XML document",
    description:
      "Allocates an ID and replaces {{objectId}} in documentXmlTemplate, then PutDoc and LoadDoc verify its root ID. This does not reproduce client XMD lifecycle.",
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
if (byId.size !== entries.length) throw new Error("Duplicate native operation ID");
export function getNativeOperations(): readonly NativeOperation[] {
  return entries.map((entry) => entry.operation);
}

/** Every failure inside a cleanup error is the server's HTTP 401: it no longer knows the session. */
function sessionGone(error: unknown): boolean {
  if (!(error instanceof WsHcmApiError) || error.kind !== "cleanup") return false;
  const causes = error.cause instanceof AggregateError ? error.cause.errors : [error.cause];
  return causes.every((cause) => cause instanceof WsHcmApiError && cause.status === 401);
}

const failedLogins = new WeakSet<object>();
/** The failure happened while opening the session: the operation itself was not sent. */
export function loginFailed(error: unknown): boolean {
  return typeof error === "object" && error !== null && failedLogins.has(error);
}

/** Stateful owner shared by SDK, MCP and CLI. Calls are serialized to protect session/cursor identity. */
export class NativeGateway {
  readonly client: WsHcmClient;
  private nativeSession: Promise<NativeSession> | undefined;
  private webSession: Promise<WebSession> | undefined;
  private legacySession: Promise<LegacySession> | undefined;
  private closed = false;
  private accepting = true;
  private queue: Promise<unknown> = Promise.resolve();
  private closePromise: Promise<void> | undefined;

  constructor(private readonly config: NativeConfig) {
    if ((config.username === undefined) !== (config.password === undefined))
      throw new TypeError("Имя пользователя и пароль задают вместе.");
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
    if (this.closed) throw new WsHcmApiError("protocol", "Gateway is closed");
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
  legacy(): Promise<LegacySession> {
    this.assertOpen();
    if (this.config.installationId === undefined && this.config.installationIdFile === undefined)
      throw new WsHcmApiError(
        "protocol",
        "Операциям старого клиента нужен installationId из 16 шестнадцатеричных цифр или файл installationIdFile, где он хранится.",
        { requestSent: false },
      );
    return (this.legacySession ??= (async () => {
      const installationId =
        this.config.installationId ??
        (await loadOrCreateLegacyInstallationId(this.config.installationIdFile!));
      return this.client.openLegacySession({ installationId });
    })().catch((error) => {
      this.legacySession = undefined;
      if (error instanceof Error) failedLogins.add(error);
      throw error;
    }));
  }
  private takeProfile(profile: "native" | "web" | "legacy") {
    const session =
      profile === "native"
        ? this.nativeSession
        : profile === "web"
          ? this.webSession
          : this.legacySession;
    if (profile === "native") this.nativeSession = undefined;
    else if (profile === "web") this.webSession = undefined;
    else this.legacySession = undefined;
    return session;
  }
  async closeProfile(profile: "native" | "web" | "legacy"): Promise<void> {
    const session = this.takeProfile(profile);
    if (session) await (await session).close();
  }
  call(id: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.accepting) return Promise.reject(new WsHcmApiError("protocol", "Gateway is closed"));
    const entry = byId.get(id);
    if (!entry) return Promise.reject(new WsHcmApiError("protocol", "Unknown native operation"));
    let snapshot: Record<string, unknown>;
    // Validate an owned snapshot, so a caller cannot replace URLs or nested
    // XML/binary boxes while an earlier accepted call occupies the queue.
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
        if (id === "web.lifecycle.logout" || id === "web.lifecycle.logout2") {
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
   * The server drops a session that stayed idle (within twenty minutes on the stands) or was closed
   * from its side; every later request then gets HTTP 401. A long-lived owner would stay locked out,
   * so the dropped session is replaced by a new login and the request is sent once more. The server
   * rejects such a request before handling it, hence the repeat cannot run anything twice.
   */
  private async invoke(entry: NativeEntry, args: Record<string, unknown>): Promise<unknown> {
    const profile = entry.operation.profile;
    const session =
      profile === "native"
        ? this.nativeSession
        : profile === "web"
          ? this.webSession
          : profile === "legacy"
            ? this.legacySession
            : undefined;
    try {
      return await entry.invoke(this, args);
    } catch (error) {
      // Without an earlier session this was the login itself: its refusal is final.
      if (
        session === undefined ||
        profile === "anonymous" ||
        !(error instanceof WsHcmApiError) ||
        error.kind !== "auth" ||
        error.status !== 401 ||
        /(?:^|[.])(?:session|lifecycle)[.]|[.](?:open|close)Session$/.test(entry.operation.id)
      )
        throw error;
      const current =
        profile === "native"
          ? this.nativeSession
          : profile === "web"
            ? this.webSession
            : this.legacySession;
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
        // Framed lock/owner records are independent of successful payload bytes.
        // Keep them first so stored JSON readers can inspect metadata before base64.
        ...(result instanceof XHttpBinaryResponse ? { records: { ...result.records } } : {}),
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
    // One profile's complete teardown must settle before another can send.
    // This lets transport loss stop later cleanup without in-flight logout races.
    for (const profile of ["native", "web", "legacy"] as const) {
      try {
        if (transportLost) {
          const session = this.takeProfile(profile);
          if (session) (await session).disposeLocal();
        } else await this.closeProfile(profile);
      } catch (error) {
        // A session the server has already dropped needs no closing.
        if (sessionGone(error)) continue;
        errors.push(error);
        transportLost ||= isTransportFailure(error);
      }
    }
    this.client.close();
    if (errors.length)
      throw new WsHcmApiError("cleanup", "Gateway session cleanup failed", {
        details: { errorCount: errors.length, remoteCleanupStopped: transportLost },
        cause:
          errors.length === 1 ? errors[0] : new AggregateError(errors, "Gateway cleanup failures"),
      });
  }
}
