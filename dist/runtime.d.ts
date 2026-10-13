import { NativeGateway } from "./native/index.js";
import { ResultStore } from "./results.js";
import { LogReader } from "./logs.js";
import type { ConnectionConfig, OperationDefinition, OperationEffect, OperationFilter, OperationPage, OperationResult } from "./contracts.js";
export declare class HcmRuntime {
    readonly config: ConnectionConfig;
    readonly gateway: NativeGateway;
    readonly results: ResultStore;
    readonly logs: LogReader;
    private readonly schemaReader;
    private readonly rpcCatalog;
    private queue;
    private closed;
    private closePromise;
    private appInfo;
    /** Room for the payload of one reply; the rest of the output limit is left to its other fields. */
    private get pageBytes();
    constructor(config: ConnectionConfig);
    listOperations(filter?: OperationFilter): OperationPage;
    describe(id: string): OperationDefinition;
    /** Resolve conditional side effects for the actual arguments; frontends must use this before routing. */
    getOperationEffect(id: string, args?: Record<string, unknown>): OperationEffect;
    call(id: string, args?: Record<string, unknown>): Promise<OperationResult>;
    private effect;
    private authorize;
    private perform;
    /** Local storage failure cannot erase already executed steps or label a sent batch not_sent. */
    private batchRecoveryData;
    private failure;
    /** One object by id or url, as objects.get answers. */
    private readObject;
    private load;
    private journal;
    private serverInfo;
    private applicationInfo;
    private resolveCatalog;
    /**
     * Values of the named fields in the catalog row of an object. `known` holds the names that are
     * fields of the catalog, whether the row has a value for them or not.
     */
    private catalogRow;
    private catalogHasId;
    /**
     * Date and integer fields of the catalog, read only when a condition holds a value written as a
     * date or as a decimal ID: such a value must reach a date field as date('…') and an integer field
     * as a number, and the form is the only place that tells them from strings.
     */
    private typedFields;
    /**
     * What the server would not keep is refused before the write: a field the type does not have is
     * dropped from the saved document, as is a value for a field the server computes, and a date the
     * server cannot read is stored as another value.
     */
    private requireFields;
    private dispatch;
    /** Code prepared by prepareScript, run on the server; the answer is checked for a caught error. */
    private runCode;
    private batch;
    close(): Promise<void>;
}
