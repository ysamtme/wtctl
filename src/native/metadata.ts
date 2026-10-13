import type { NativeOperation } from "../contracts.js";

const compatibilityDescriptions: Readonly<Record<string, string>> = {
  "web.websocket.heartbeat":
    "One bounded raw $hbt/$ok exchange on the fixed stock /services/main_ws_service route. Uses the gateway-owned web cookie, closes the socket locally and reports peer EOF separately from a close acknowledgement. No business payload, event subscription, browser LDS WebSocket binding or automatic reconnect is implied. On server 2025.1.1171 the main service returned $ok and then EOF without a peer close frame.",
  "web.experimental.authenticate":
    "Partial shipped browser JSON login shape requiring its own login-page token. Server 2025.1.1171 has no authenticate route in its built-in SPXML2 API; optional application hooks may differ. On the tested installation the stock login page returned HTTP 200 with a rendered error and no token, so no authenticate POST or managed-ticket revocation was exercised. Successful body and cookie semantics remain unverified.",
};

/** Replaces the generated description where the generic wording would mislead. */
export function decorateOperation(operation: NativeOperation): NativeOperation {
  const description = compatibilityDescriptions[operation.id];
  return description === undefined ? operation : { ...operation, description };
}

/** Lock flags change the effect even when the default document/URL retrieval is read-only. */
export function getEffectiveNativeEffect(
  operation: NativeOperation,
  args: Readonly<Record<string, unknown>>,
): NativeOperation["effect"] {
  const isReference = (value: unknown): boolean =>
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    typeof (value as Record<string, unknown>).$ref === "string";
  const deferredArgs = isReference(args);
  // Batch policy is evaluated before reference resolution. An unresolved lock
  // flag or argument object can turn this read into a lock mutation.
  if (
    (operation.method === "loadDoc" || operation.method === "getDoc") &&
    (deferredArgs || args.tryLock === true || isReference(args.tryLock))
  )
    return "write";
  // GET and HEAD read; a missing method or a reference stays unknown.
  if (operation.method === "rawRequest" && typeof args.method === "string") {
    const verb = args.method.toUpperCase();
    if (verb === "GET" || verb === "HEAD") return "read";
  }
  return operation.effect;
}
