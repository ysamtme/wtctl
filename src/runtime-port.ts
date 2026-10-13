import type {
  OperationDefinition,
  OperationEffect,
  OperationFilter,
  OperationPage,
  OperationResult,
} from "./contracts.js";

/** Шов между интерфейсами (MCP, CLI, SDK) и runtime: всё, о чём они могут его просить. */
export interface RuntimePort {
  readonly results?: Pick<import("./results.js").ResultStore, "export"> | undefined;
  listOperations(filter?: OperationFilter): OperationPage;
  describe(id: string): OperationDefinition;
  getOperationEffect(id: string, args?: Record<string, unknown>): OperationEffect;
  call(id: string, args?: Record<string, unknown>): Promise<OperationResult>;
  close(): Promise<void>;
}
