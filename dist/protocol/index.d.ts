/**
 * Клиент TypeScript для административных API WebSoft HCM.
 * Для надёжного жизненного цикла — `WsHcmClient.with*Session()`. Этот модуль протокола
 * ещё экспортирует вспомогательные функции XML.
 *
 * @packageDocumentation
 */
export { NativeSession, WebSession, WsHcmClient } from "./client.js";
export { WsHcmApiError, type WsHcmErrorKind } from "./error.js";
export { WebSocketHeartbeatError } from "./websocket.js";
export { rpc, type ClearUploadChunksRequest, type ClearUploadChunksResult, type CompoundResourceRequest, type LoadRequest, type NativeLdsApi, type QueryValues, type RpcArgument, type RpcResult, type RunMethodRequest, type SoapAttachment, type SoapLoadRequest, type SoapResult, type StreamingLoadRequest, type UploadChunkRequest, type UploadChunkResult, type WebLdsApi, type XQueryRequest, } from "./api.js";
export { WsHcmBinaryResponse, type Credentials, type DecimalId, type RequestOptions, type TrackingId, type WsHcmClientOptions, type WsHcmResponse, type WebSocketConnection, type WebSocketConnectOptions, type WebSocketFactory, type WebSocketHeartbeatInput, type WebSocketHeartbeatData, type WebSocketHeartbeatReceipt, } from "./types.js";
export { NativePhysicalDocumentsApi, resolvePhysicalDocumentLocation, type CreatePhysicalDocumentRequest, type CreatedPhysicalDocument, type PhysicalDocumentLocation, } from "./physical-documents.js";
export { buildXml, parseXml, rawXml, type RawXml, type XmlObject, type XmlValue } from "./xml.js";
