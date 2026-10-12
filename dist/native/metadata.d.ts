import type { NativeOperation } from "../contracts.js";
/** Replaces the generated description where the generic wording would mislead. */
export declare function decorateOperation(operation: NativeOperation): NativeOperation;
/** Lock flags change the effect even when the default document/URL retrieval is read-only. */
export declare function getEffectiveNativeEffect(operation: NativeOperation, args: Readonly<Record<string, unknown>>): NativeOperation["effect"];
