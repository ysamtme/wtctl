import type {
  OperationDefinition,
  OperationEffect,
  OperationFilter,
  OperationPage,
  OperationResult,
} from "./contracts.js";

/** The seam between the front ends (MCP, CLI, SDK) and the runtime: all they may ask of it. */
export interface RuntimePort {
  readonly results?: Pick<import("./results.js").ResultStore, "export"> | undefined;
  listOperations(filter?: OperationFilter): OperationPage;
  describe(id: string): OperationDefinition;
  getOperationEffect(id: string, args?: Record<string, unknown>): OperationEffect;
  call(id: string, args?: Record<string, unknown>): Promise<OperationResult>;
  close(): Promise<void>;
}
