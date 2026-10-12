import type {
  ConnectionConfig,
  OperationDefinition,
  OperationEffect,
  OperationFilter,
  OperationPage,
  OperationResult,
} from "../contracts.js";

export interface RuntimePort {
  readonly results?: Pick<import("../results.js").ResultStore, "export"> | undefined;
  listOperations(filter?: OperationFilter): OperationPage;
  describe(id: string): OperationDefinition;
  getOperationEffect(id: string, args?: Record<string, unknown>): OperationEffect;
  call(id: string, args?: Record<string, unknown>): Promise<OperationResult>;
  close(): Promise<void>;
}

export interface CliIo {
  /** Indent JSON for a person at a terminal; otherwise results are one compact line. */
  readonly pretty?: boolean;
  writeOut(text: string): void | Promise<void>;
  writeError(text: string): void | Promise<void>;
  readFile(path: string, maximumBytes: number): Promise<string>;
  readStdin(maximumBytes: number): Promise<string>;
  readBinaryFile?(path: string, maximumBytes: number): Promise<Uint8Array>;
  readBinaryStdin?(maximumBytes: number): Promise<Uint8Array>;
  writeFile(path: string, text: string): Promise<void>;
  /** Ask the person at the terminal; absent when there is no terminal. Typed secrets are not shown. */
  prompt?(question: string, secret?: boolean): Promise<string>;
}

export interface CliDependencies {
  loadConfiguration(options: {
    configPath?: string;
    connection?: string;
    password?: string;
  }): ConnectionConfig | Promise<ConnectionConfig>;
  createRuntime(config: ConnectionConfig): RuntimePort;
  runMcp(
    runtime: RuntimePort,
    connectionName: string,
    io: CliIo,
    local?: import("../guide.js").LocalInstall,
  ): Promise<void>;
  /** Where this program runs from; the guide names it so an agent can call the command and the SDK. */
  readonly local?: import("../guide.js").LocalInstall | undefined;
}
