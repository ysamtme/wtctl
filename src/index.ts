/**
 * SDK wtctl: клиент сервера WebSoft HCM для программ на JavaScript и TypeScript. Те же операции, права
 * и ответы, что у CLI и MCP-сервера.
 * @packageDocumentation
 */
export {
  HcmClient,
  withHcmClient,
  unwrap,
  getCleanupError,
  HcmOperationError,
  HcmStoredResultError,
  HcmCleanupError,
} from "./sdk.js";
export { HcmError } from "./errors.js";
export { loadConfig, type ConfigOptions, type ConnectionSettings } from "./config.js";
export { listHcmOperations, describeHcmOperation } from "./catalog.js";
export type {
  ConnectionConfig,
  JsonSchema,
  MutationOutcome,
  NativeProfile,
  OperationDefinition,
  OperationEffect,
  OperationError,
  OperationFilter,
  OperationPage,
  OperationResult,
} from "./contracts.js";
export type {
  BatchData,
  BatchInput,
  BatchStep,
  ClearedUploadChunksData,
  ClearUploadChunksInput,
  CreateInput,
  DeleteOptions,
  FilterCondition,
  FilterValue,
  GetManyData,
  GetManyInput,
  GetOptions,
  HcmData,
  HcmResult,
  ObjectData,
  ObjectTarget,
  PatchOperation,
  PatchOptions,
  QueryData,
  QueryInput,
  QueryOptions,
  ResultMeta,
  ResultPage,
  ResultReadInput,
  RpcArgument,
  RpcInput,
  RpcTypedArgument,
  RpcXmlArgument,
  RunAgentInput,
  StatusData,
  StoredResultData,
  UploadChunkInput,
  UploadedChunkData,
  UploadedFileData,
  UploadFileInput,
} from "./sdk.js";
export type { CheckData } from "./self-check.js";
export type {
  ServerInfoInput,
  ServerInfoData,
  ServerCatalogLimit,
  ServerDatabase,
  ServerInfoProfile,
} from "./server-info.js";
export type {
  FileDeleteData,
  FileDeleteInput,
  FileExistsData,
  FileExistsInput,
  FileListData,
  FileListInput,
  FileReadData,
  FileReadInput,
  FileSaveData,
  FileSaveInput,
  FileWriteData,
  FileWriteInput,
} from "./files.js";
export type {
  SchemaField,
  SchemaInput,
  SchemaResult,
  SchemaTypesInput,
  SchemaTypesResult,
} from "./schema.js";
export type {
  CreatedObjectData,
  DeletedObjectData,
  PatchedObjectData,
  PatchPreviewData,
} from "./objects.js";
export type { PatchChange } from "./documents.js";
export type { AgentRunData, ScriptData } from "./scripts.js";
export type { ResultExportData, ResultExportInput } from "./results.js";
export type {
  RpcCatalogFilter,
  RpcCatalogPage,
  RpcDescribeOptions,
  RpcTargetCard,
  RpcTargetDescription,
} from "./rpc-catalog.js";
export type {
  LogFollowInput,
  LogLevel,
  LogListInput,
  LogReadInput,
  LogResetReason,
  LogSearchInput,
} from "./logs.js";
export type {
  LogEntry,
  LogFileSummary,
  LogFiles,
  LogMatches,
  LogNews,
  LogText,
} from "./log-output.js";
export type { WebSocketHeartbeatData, WebSocketHeartbeatInput } from "./protocol/index.js";
