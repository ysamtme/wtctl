import { NativeGateway } from "./native/index.js";
import { ResultStore } from "./results.js";
import { LogReader } from "./logs.js";
import { type ServerPort } from "./hcm-server.js";
import type { RuntimePort } from "./runtime-port.js";
import type { ConnectionConfig, OperationDefinition, OperationEffect, OperationFilter, OperationPage, OperationResult } from "./contracts.js";
/** One runtime owns sessions, serialization, local policy and artifacts for every frontend. */
export declare class HcmRuntime implements RuntimePort {
    readonly config: ConnectionConfig;
    readonly gateway: NativeGateway;
    readonly results: ResultStore;
    readonly logs: LogReader;
    private readonly replies;
    private readonly server;
    private readonly schemaReader;
    private readonly files;
    private readonly objects;
    private readonly rpcCatalog;
    private queue;
    private closed;
    private closePromise;
    constructor(config: ConnectionConfig, 
    /** How to reach the server; the connection's gateway by default. */
    port?: ServerPort);
    listOperations(filter?: OperationFilter): OperationPage;
    describe(id: string): OperationDefinition;
    /** Resolve conditional side effects for the actual arguments; frontends must use this before routing. */
    getOperationEffect(id: string, args?: Record<string, unknown>): OperationEffect;
    call(id: string, args?: Record<string, unknown>): Promise<OperationResult>;
    private effect;
    private authorize;
    private perform;
    private failure;
    private serverInfo;
    /**
     * Date and integer fields of the catalog, read only when a condition holds a value written as a
     * date or as a decimal ID: such a value must reach a date field as date('…') and an integer field
     * as a number, and the form is the only place that tells them from strings.
     */
    private typedFields;
    private dispatch;
    private batch;
    close(): Promise<void>;
}
