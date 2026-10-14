/**
 * wtctl/native: шлюз низкоуровневых операций, без проверок и удобств клиента. Точка входа для
 * разработки клиента; в своём коде — HcmClient из wtctl.
 * @packageDocumentation
 */
export { NativeGateway, getNativeOperations } from "./gateway.js";
export { getEffectiveNativeEffect } from "./metadata.js";
export { WsHcmApiError } from "../protocol/error.js";
