/** Shared WebSoft HCM SDK. Native and higher-level operations use the same runtime as CLI/MCP. */
export { HcmRuntime } from "./runtime.js";
export { listHcmOperations, describeHcmOperation } from "./catalog.js";
export { loadConfig, configExample, type ConfigOptions } from "./config.js";
export { HcmError } from "./errors.js";
export { NativeGateway, getNativeOperations } from "./native/index.js";
export type {
  ConnectionConfig,
  NativeConfig,
  NativeOperation,
  OperationDefinition,
  OperationFilter,
  OperationPage,
  OperationEffect,
  OperationResult,
  OperationError,
  MutationOutcome,
} from "./contracts.js";
export * from "./sdk.js";
export type { AgentRunData, ScriptData } from "./scripts.js";
export { parseServerInfo } from "./server-info.js";
export { parseFileExists } from "./files.js";
export type { ServerInfoProfile, ServerCatalogLimit, ServerDatabase } from "./server-info.js";
export { RpcCatalog } from "./rpc-catalog.js";
export type {
  RpcCatalogFilter,
  RpcCatalogPage,
  RpcTargetCard,
  RpcTargetDescription,
  RpcDescribeOptions,
} from "./rpc-catalog.js";
export { LogReader, LogReadUnavailableError } from "./logs.js";
export type {
  LogEntry,
  LogFileSummary,
  LogFiles,
  LogMatches,
  LogNews,
  LogText,
} from "./log-output.js";
export type {
  LogFile,
  LogListInput,
  LogListData,
  LogReadInput,
  LogReadData,
  LogSearchInput,
  LogSearchData,
  LogFollowInput,
  LogFollowData,
  LogEvent,
  LogLevel,
} from "./logs.js";
