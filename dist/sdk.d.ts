import { HcmRuntime } from "./runtime.js";
import type { ResultExportInput } from "./results.js";
export type { ResultExportInput } from "./results.js";
import type { CheckData } from "./self-check.js";
export type { CheckData } from "./self-check.js";
import { HcmError } from "./errors.js";
import type { AgentRunData, ScriptData } from "./scripts.js";
import type { ServerInfoInput, ServerInfoData, ServerDatabase } from "./server-info.js";
export type { ServerInfoInput, ServerInfoData } from "./server-info.js";
import type { FileExistsInput, FileExistsData, FileReadInput, FileReadData } from "./files.js";
export type { FileExistsInput, FileExistsData, FileReadInput, FileReadData } from "./files.js";
import type { SchemaInput, SchemaResult, SchemaTypesInput, SchemaTypesResult } from "./schema.js";
export type { SchemaInput, SchemaResult, SchemaTypesInput, SchemaTypesResult } from "./schema.js";
export type { SchemaField } from "./schema.js";
import type { ConnectionConfig, MutationOutcome, OperationDefinition, OperationError, OperationFilter, OperationPage, OperationResult } from "./contracts.js";
import type { LogListInput, LogReadInput, LogSearchInput, LogFollowInput } from "./logs.js";
import type { LogFiles, LogMatches, LogNews, LogText } from "./log-output.js";
import type { RpcCatalogFilter, RpcCatalogPage, RpcDescribeOptions, RpcTargetDescription } from "./rpc-catalog.js";
import type { WebSocketHeartbeatInput, WebSocketHeartbeatData } from "./protocol/index.js";
export type { WebSocketHeartbeatInput, WebSocketHeartbeatData } from "./protocol/index.js";
export type HcmData = Record<string, unknown>;
export type ResultMeta = OperationResult["meta"];
export interface StoredResultData {
    readonly preview: unknown;
    readonly resultId: string;
    /** Which operations read the stored answer. */
    readonly hint?: string;
}
/** A full value, a local reference, and a failed partial outcome are deliberately distinct. */
export type HcmResult<T = unknown> = {
    readonly ok: true;
    readonly data: T;
    readonly meta: ResultMeta & {
        readonly truncated?: false;
    };
    readonly error?: never;
} | {
    readonly ok: true;
    readonly data: StoredResultData;
    readonly meta: ResultMeta & {
        readonly truncated: true;
        readonly resultId: string;
    };
    readonly error?: never;
} | {
    readonly ok: false;
    readonly data?: T | StoredResultData;
    readonly error: OperationError;
    readonly meta: ResultMeta;
};
export type ObjectTarget = {
    readonly url: string;
    readonly type?: string;
    readonly id?: string;
} | {
    readonly id: string;
    readonly type?: string;
    readonly url?: string;
};
export interface GetOptions {
    readonly fields?: readonly string[];
}
export interface CreateInput<T extends object = HcmData> {
    readonly type: string;
    readonly data: T;
    readonly dbName?: string;
    readonly formUrl?: string;
}
export type PatchOperation = {
    readonly op: "set";
    readonly path: string;
    readonly value: unknown;
} | {
    readonly op: "remove";
    readonly path: string;
};
export interface PatchOptions {
    /** What to write: {path: value} or a list of operations. */
    readonly patch?: HcmData | readonly PatchOperation[];
    /** Paths to remove from the document. */
    readonly remove?: readonly string[];
    readonly expectedFingerprint?: string;
    readonly preview?: boolean;
    /** Save the document even when the patch changes nothing: the server refills what it computes on save. */
    readonly resave?: boolean;
}
export interface DeleteOptions {
    readonly permanent: true;
    readonly catalog?: string;
}
export type FilterValue = string | number | boolean | null;
export interface FilterCondition {
    readonly eq?: FilterValue;
    readonly ne?: FilterValue;
    readonly gt?: FilterValue;
    readonly gte?: FilterValue;
    readonly lt?: FilterValue;
    readonly lte?: FilterValue;
    readonly contains?: FilterValue;
    readonly in?: FilterValue[];
}
export interface QueryOptions {
    readonly fields?: readonly string[];
    readonly limit?: number;
    readonly startPosition?: number;
}
/** Raw expressions must return homogeneous XML object rows; scalar/mixed sequences use LDS directly. */
export type QueryInput = QueryOptions & ({
    readonly catalog: string;
    readonly where?: Record<string, FilterValue | FilterCondition>;
    /** Catalog fields to sort by: "fullname", "hire_date desc". */
    readonly order?: string | readonly string[];
    readonly query?: never;
} | {
    readonly query: string;
    readonly catalog?: never;
    readonly where?: never;
});
export interface RpcTypedArgument {
    readonly valueType: string;
    readonly lexicalValue: string | {
        readonly xml: string;
    };
}
export interface RpcXmlArgument {
    readonly lexicalValue: {
        readonly xml: string;
    };
    readonly valueType?: never;
}
export type RpcArgument = string | boolean | number | null | RpcTypedArgument | RpcXmlArgument;
export interface RpcInput {
    readonly library: string;
    readonly method: string;
    readonly arguments?: readonly RpcArgument[];
    readonly async?: boolean;
}
export interface BatchStep {
    readonly id: string;
    readonly args?: HcmData;
    readonly as?: string;
}
export interface BatchInput {
    readonly steps: readonly BatchStep[];
    readonly stopOnError?: boolean;
}
export interface ResultReadInput {
    readonly resultId: string;
    readonly offset?: number;
    readonly limit?: number;
    readonly format?: "auto" | "json" | "text";
}
export interface UploadFileInput {
    readonly filename: string;
    readonly data: string | {
        readonly base64: string;
    };
    readonly contentType?: string;
}
export interface UploadedFileData {
    /** The address of the file: x-local://share/uploaded_files/<folder>/<name>. */
    readonly url: string;
    /** The folder the server made for the file; it stays after the file is deleted. */
    readonly folderUrl: string;
}
/** One stock upload_chunk request. Reuse fileId and send the final index last. */
export interface UploadChunkInput extends UploadFileInput {
    readonly fileId: string;
    readonly index: number;
    readonly chunksTotal: number;
    readonly totalBytes: number;
    readonly offset: number;
}
/** The advertised Url is an acknowledgement, not proof that a complete file exists. */
export interface UploadedChunkData {
    readonly error: 0;
    readonly Url: string;
}
export interface ClearUploadChunksInput {
    readonly fileId: string;
    readonly chunksTotal: number;
}
/** Stock clear_chunks suppresses delete errors; its empty response cannot verify absence. */
export interface ClearedUploadChunksData {
    readonly acknowledged: true;
    readonly fileId: string;
    readonly chunksTotal: number;
    readonly absenceVerified: false;
}
export interface StatusData {
    readonly connection: string;
    readonly baseUrl: string;
    readonly version: string;
    /** Database behind the server, when the server describes it. */
    readonly database?: ServerDatabase;
    /** ID of the user the connection is signed in as, when the server names it. */
    readonly userId?: string;
    readonly operationCount: number;
    readonly permissions: {
        readonly write: boolean;
        readonly execute: boolean;
    };
}
export interface QueryData<T = HcmData> {
    readonly items: T[];
    /** Rows matching the query on the server, when the server reports a consistent count. */
    readonly total?: number;
    /** More rows may follow: pass it as startPosition. Offsets are not a stable snapshot. */
    readonly nextStartPosition?: number;
    /** The end was not established and no offset advances; hint says why. */
    readonly incomplete?: true;
    readonly hint?: string;
    /** Requested fields that are not fields of the catalog. */
    readonly unknownFields?: string[];
}
export interface ObjectData<T extends object = HcmData> {
    readonly id?: string;
    readonly type: string;
    readonly url: string;
    readonly data: T;
    /** Requested fields the document does not keep: the server computes them for the catalog row. */
    readonly fromCatalog?: HcmData;
    /** Fields asked for by name that the object has no value for. */
    readonly emptyFields?: string[];
    /** Requested fields that neither the type nor its catalog has. */
    readonly unknownFields?: string[];
    readonly fingerprint: string;
    readonly formUrl?: string;
}
/** A write returns the receipt, not a copy of the document; read the object when its fields are needed. */
export interface CreatedObjectData {
    readonly id: string;
    readonly type: string;
    readonly url: string;
    readonly fingerprint: string;
    readonly mutationId: string;
    readonly mutationOutcome: "confirmed";
}
/** Scalar values are shown as they were and as written; a structure is named, not copied. */
export interface PatchChange {
    readonly op: "set" | "remove";
    readonly path: string;
    readonly before?: unknown;
    readonly after?: unknown;
}
/** Nothing was written: a preview was asked for, or the patch changes nothing (noop). */
export interface PatchPreviewData {
    readonly preview: boolean;
    readonly noop: boolean;
    readonly changes: PatchChange[];
    readonly fingerprint: string;
}
export interface PatchedObjectData {
    readonly id?: string;
    readonly type: string;
    readonly url: string;
    readonly fingerprint: string;
    readonly changes: PatchChange[];
    /** Top-level fields outside the patch that the server itself changed on the save. */
    readonly serverChanged?: string[];
    readonly mutationId: string;
    readonly mutationOutcome: "confirmed";
}
export interface DeletedObjectData {
    readonly id?: string;
    readonly mutationId: string;
    readonly mutationOutcome: "confirmed";
    readonly verification: string;
    readonly catalog?: string;
}
export interface BatchData {
    readonly results: OperationResult[];
    readonly completed: number;
    readonly requested: number;
    readonly atomic: false;
    readonly ok: boolean;
}
export type ResultPage<T = unknown> = {
    readonly items: T[];
    readonly total: number;
    readonly nextOffset?: number;
    readonly blockedItem?: {
        readonly index: number;
        readonly bytes: number;
    };
    readonly hint?: string;
    /** The page is shorter than asked: one answer holds no more. */
    readonly cutBySize?: true;
    /** The member of the stored answer these items come from; absent for a bare list. */
    readonly list?: string;
} | {
    readonly text: string;
    readonly totalChars: number;
    readonly nextOffset?: number;
    readonly format?: "text" | "json";
    readonly cutBySize?: true;
};
/** The complete safe runtime boundary; a client can borrow an existing runtime without opening a second session. */
export interface HcmSdkRuntime {
    listOperations(filter?: OperationFilter): OperationPage;
    describe(id: string): OperationDefinition;
    call(id: string, args?: HcmData): Promise<OperationResult>;
    close(): Promise<void>;
}
/** An actionable operation error retains partial results without serialising them automatically. */
export declare class HcmOperationError extends HcmError {
    readonly result: OperationResult;
    readonly cleanupError?: HcmError;
    private readonly operationError;
    constructor(result: OperationResult, operationError?: OperationError | undefined);
    toJSON(): OperationError;
}
/** A stored preview cannot be mistaken for the complete generic T. Read its pages explicitly. */
export declare class HcmStoredResultError extends HcmOperationError {
    readonly resultId: string;
    constructor(result: OperationResult, resultId: string);
}
/** Cleanup failure after a successful action retains its value; repeating a write is unsafe. */
export declare class HcmCleanupError<T = unknown> extends HcmError {
    readonly value: T;
    constructor(value: T);
}
export declare function unwrap<T>(result: HcmResult<T>): T;
export declare function unwrap<T = unknown>(result: OperationResult): T;
/** Typed convenience methods retain the same result envelope, policy, evidence and outcomes as call(). */
export declare class HcmClient {
    readonly runtime: HcmSdkRuntime;
    constructor(connection: ConnectionConfig | HcmSdkRuntime);
    static fromRuntime(runtime: HcmSdkRuntime): HcmClient;
    listOperations(filter?: OperationFilter): OperationPage;
    describe(id: string): OperationDefinition;
    call<T = unknown>(id: string, args?: HcmData): Promise<HcmResult<T>>;
    /** Several objects in one call; an object that was not read has error in its element. */
    getMany<T extends object = HcmData>(input: {
        ids: readonly string[];
        type?: string;
        fields?: readonly string[];
    }): Promise<HcmResult<{
        items: (ObjectData<T> | {
            id: string;
            error: {
                code: string;
                message: string;
            };
        })[];
        total: number;
        failed?: number;
    }>>;
    status(): Promise<HcmResult<StatusData>>;
    check(): Promise<HcmResult<CheckData>>;
    serverInfo(input?: ServerInfoInput): Promise<HcmResult<ServerInfoData>>;
    fileExists(input: FileExistsInput): Promise<HcmResult<FileExistsData>>;
    readFile(input: FileReadInput): Promise<HcmResult<FileReadData>>;
    query<T = HcmData>(input: QueryInput): Promise<HcmResult<QueryData<T>>>;
    get<T extends object = HcmData>(input: ObjectTarget & GetOptions): Promise<HcmResult<ObjectData<T>>>;
    create(input: CreateInput<object>): Promise<HcmResult<CreatedObjectData>>;
    patch(input: ObjectTarget & PatchOptions): Promise<HcmResult<PatchedObjectData | PatchPreviewData>>;
    delete(input: ObjectTarget & DeleteOptions): Promise<HcmResult<DeletedObjectData>>;
    schema(input: SchemaInput): Promise<HcmResult<SchemaResult>>;
    types(input?: SchemaTypesInput): Promise<HcmResult<SchemaTypesResult>>;
    rpc<T = unknown>(input: RpcInput): Promise<HcmResult<T>>;
    listRpc(input?: RpcCatalogFilter): Promise<HcmResult<RpcCatalogPage>>;
    describeRpc(targetId: string, options?: RpcDescribeOptions): Promise<HcmResult<RpcTargetDescription>>;
    /**
     * The code as a string or, like the hcm_script tool takes it, as {code, params}.
     * The code reads params as the ready variable PARAMS.
     */
    execute<T = unknown>(code: string | {
        code: string;
        params?: object;
    }, params?: object): Promise<HcmResult<ScriptData<T>>>;
    /** Runs a server agent and waits for the end of its code; errors of the code are in the log only. */
    runAgent(input: {
        id: string;
        objectId?: string;
        objectIds?: string[];
    }): Promise<HcmResult<AgentRunData>>;
    batch(input: BatchInput): Promise<HcmResult<BatchData>>;
    readResult<T = unknown>(input: ResultReadInput): Promise<HcmResult<ResultPage<T>>>;
    exportResult(input: ResultExportInput): Promise<HcmResult<Awaited<ReturnType<HcmRuntime["results"]["export"]>>>>;
    uploadFile(input: UploadFileInput): Promise<HcmResult<UploadedFileData>>;
    uploadChunk(input: UploadChunkInput): Promise<HcmResult<UploadedChunkData>>;
    clearUploadChunks(input: ClearUploadChunksInput): Promise<HcmResult<ClearedUploadChunksData>>;
    heartbeat(input?: WebSocketHeartbeatInput): Promise<HcmResult<WebSocketHeartbeatData>>;
    listLogs(input?: LogListInput): Promise<HcmResult<LogFiles>>;
    readLog(input: LogReadInput): Promise<HcmResult<LogText>>;
    searchLogs(input: LogSearchInput): Promise<HcmResult<LogMatches>>;
    followLog(input: LogFollowInput): Promise<HcmResult<LogNews>>;
    close(): Promise<void>;
    /** This client owns the scope and closes exactly once after the callback, including failure. */
    use<T>(action: (client: HcmClient) => Promise<T>): Promise<T>;
}
/** Inspect secondary cleanup evidence without casting an unknown caught value. */
export declare function getCleanupError(error: unknown): HcmError | undefined;
/** Open one shared runtime for a typed script. Permissions are never expanded by the facade. */
export declare function withHcmClient<T>(config: ConnectionConfig, action: (client: HcmClient) => Promise<T>): Promise<T>;
/** Compatible raw-runtime scope with complete cleanup/error preservation. */
export declare function withHcm<T>(config: ConnectionConfig, action: (runtime: HcmRuntime) => Promise<T>): Promise<T>;
export type { MutationOutcome };
export type { RpcCatalogFilter, RpcCatalogPage, RpcTargetDescription, RpcTargetCard, RpcDescribeOptions, } from "./rpc-catalog.js";
