import type { WebSocketFactory } from "./protocol/types.js";

/** Public operation contracts shared by SDK, CLI, MCP and native adapters. */
export type OperationEffect = "read" | "write" | "execute" | "unknown";
export type NativeProfile = "native" | "web" | "legacy" | "anonymous";
export type JsonSchema = Readonly<Record<string, unknown>>;

/** Transport settings. Credentials are never part of operation results. */
export interface NativeConfig {
  readonly baseUrl: string;
  readonly username?: string;
  readonly password?: string;
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
  readonly installationId?: string;
  /** Optional persistent, caller-owned legacy client identity. An explicit installationId wins. */
  readonly installationIdFile?: string;
  readonly fetch?: typeof globalThis.fetch;
  /** Trusted in-process socket connector; required alongside a custom fetch for WebSocket calls. */
  readonly webSocketFactory?: WebSocketFactory;
}

/** A named connection plus local runtime policy. No server installation is required. */
export interface ConnectionConfig extends NativeConfig {
  readonly name: string;
  readonly outputLimitBytes: number;
  readonly runtimeDir: string;
  readonly permissions: { readonly write: boolean; readonly execute: boolean };
  /** How long the server keeps a log unreadable after writing to it; 5500 ms unless set. */
  readonly logBusyMs?: number;
}

/** Static description of one operation. Availability is decided by the connected server at call time. */
export interface OperationDefinition {
  readonly id: string;
  readonly group: string;
  readonly title: string;
  readonly description: string;
  readonly effect: OperationEffect;
  readonly status: string;
  readonly inputSchema: JsonSchema;
  readonly profile?: NativeProfile;
  readonly method?: string;
}

export interface NativeOperation extends OperationDefinition {
  readonly profile: NativeProfile;
  readonly method: string;
}

/** Uncertain writes require inspection rather than automatic retry. */
export type MutationOutcome = "not_sent" | "confirmed" | "indeterminate";
export interface OperationError {
  readonly code: string;
  readonly message: string;
  readonly hint?: string;
  readonly retryable?: boolean;
  readonly mutationOutcome?: MutationOutcome;
  readonly details?: Readonly<Record<string, unknown>>;
}
export interface OperationResult {
  readonly ok: boolean;
  readonly data?: unknown;
  readonly error?: OperationError;
  readonly meta: {
    readonly operationId: string;
    readonly connection: string;
    readonly durationMs: number;
    readonly truncated?: boolean;
    readonly resultId?: string;
    readonly resultBytes?: number;
    readonly [key: string]: unknown;
  };
}

export interface OperationFilter {
  readonly query?: string;
  readonly topic?: string;
  readonly group?: string;
  readonly effect?: OperationEffect;
  readonly status?: string;
  readonly cursor?: number;
  readonly limit?: number;
}
export interface OperationPage {
  readonly operations: readonly OperationDefinition[];
  readonly total: number;
  readonly nextCursor?: number;
}
export interface BinaryResult {
  readonly kind: "binary";
  /** Legacy /xhttp framed records, with their original case and lexical values; not HTTP headers. */
  readonly records?: Readonly<Record<string, string>>;
  readonly bytes: Uint8Array;
  readonly contentType: string;
}
