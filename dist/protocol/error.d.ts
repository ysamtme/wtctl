/** Stable high-level categories used for programmatic error handling. */
export type WsHcmErrorKind = "auth" | "permission" | "soap-fault" | "http" | "protocol" | "cleanup";
/**
 * Normalized API/transport error with bounded, redacted diagnostics.
 * Operation and cleanup failures preserve the operation error and attach cleanup in `cleanupError`.
 */
export declare class WsHcmApiError extends Error {
    /** Stable machine-readable category. */
    readonly kind: WsHcmErrorKind;
    /** Wire operation/action name when known. */
    readonly operation?: string;
    /** HTTP status when one was available. */
    readonly status?: number;
    /** Bounded structured diagnostics; never a complete response body. */
    readonly details?: Readonly<Record<string, unknown>>;
    /** Explicit local preflight proof; absence leaves the mutation outcome uncertain. */
    readonly requestSent?: boolean;
    /** Cleanup failure(s) attached without replacing this primary error. */
    cleanupError?: unknown;
    constructor(kind: WsHcmErrorKind, message: string, options?: {
        operation?: string;
        status?: number;
        details?: Readonly<Record<string, unknown>>;
        requestSent?: boolean;
        cause?: unknown;
    });
}
/** A status-bearing server rejection is distinct from an unobserved/lost HTTP response.
 * Walk only bounded error links; a local TypeError by itself is not network evidence. */
export declare function isTransportFailure(error: unknown): boolean;
/** Preserves and aggregates cleanup failures without replacing the primary operation error. */
export declare function attachCleanupError(operationError: unknown, cleanupError: unknown): void;
