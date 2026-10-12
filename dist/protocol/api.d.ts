import { type SoapField, type SoapProfile, type XHttpEntity } from "./protocol.js";
import { HttpTransport } from "./transport.js";
import { WsHcmBinaryResponse, type DecimalId, type RequestOptions, type TrackingId, type WsHcmResponse } from "./types.js";
import { type RawXml, type XmlObject } from "./xml.js";
/** Buffered parsed SOAP result with exact response bytes. */
export type SoapResult = WsHcmResponse<XmlObject>;
/** Query parameter map whose defined values are serialized lexically. */
export type QueryValues = Readonly<Record<string, string | number | boolean | null | undefined>>;
/** Exact external MIME-part data; strings and RawXml are encoded as UTF-8. */
export type SoapAttachment = RawXml | string | Uint8Array | ArrayBuffer;
/** Stock LDS library invocation. ArgData is inline typed child XML, never an XOP attachment. */
export interface RunMethodRequest {
    libName: string;
    methodName: string;
    /** Separate internal thread; no public task handle or completion acknowledgement is returned. */
    runAsync?: boolean;
    errorLogName?: string;
    argData: RawXml;
}
/** Web SPXML large-field streaming request. Lossless IDs are strings. */
export interface GetLargeFieldRequest {
    docUrl: string;
    fieldId: DecimalId;
    size: DecimalId;
    contentType: string;
    prepareHtmlImages?: boolean;
    fileName?: string;
}
/** Web SPXML large-field upload request. `body` is forwarded without buffering. */
export interface PutLargeFieldRequest {
    docUrl: string;
    fieldId: DecimalId;
    fieldPathname: string;
    contentType: string;
    body: BodyInit;
}
/** Web SPXML request that imports a large field from a server-visible source URL. */
export interface PutLargeFieldFromUrlRequest {
    docUrl: string;
    fieldId: DecimalId;
    fieldPathname: string;
    contentType?: string;
    srcUrl: string;
}
export interface OpenSessionResult {
    sessionId: DecimalId;
    response: SoapResult;
}
export declare function openLdsSession(transport: HttpTransport, profile: SoapProfile, installationId?: string, basic?: boolean): Promise<OpenSessionResult>;
declare class LdsCaller {
    private readonly transport;
    private readonly profile;
    private readonly sessionId;
    constructor(transport: HttpTransport, profile: SoapProfile, sessionId: () => DecimalId);
    call(method: string, fields: readonly SoapField[], options?: RequestOptions): Promise<SoapResult>;
    binaryCall(method: string, fields: readonly SoapField[], options?: RequestOptions): Promise<WsHcmBinaryResponse>;
    id(): DecimalId;
    getTransport(): HttpTransport;
}
/** Request shape for LDS XQuery. Cursor identifiers remain lossless decimal strings. */
export interface XQueryRequest {
    query: string;
    startPos?: number;
    maxCount?: number;
    expectToReadAll?: boolean;
    keepCursor?: boolean;
    cursorId?: DecimalId;
}
/** Shared request fields for native `LoadUrl`/`LoadDoc`. */
export interface LoadRequest {
    url: string;
    useBinaryResponse?: boolean;
    useMultipartResponse?: boolean;
    tryLock?: boolean;
    compress?: boolean;
}
/** Load request that selects an unbuffered binary/multipart response. */
export type StreamingLoadRequest = LoadRequest & ({
    useBinaryResponse: true;
} | {
    useMultipartResponse: true;
});
/** Load request that keeps the normal parsed SOAP response. */
export type SoapLoadRequest = LoadRequest & {
    useBinaryResponse?: false;
    useMultipartResponse?: false;
};
/** Native LDS large-field download parameters. The response is always streamed. */
export interface LoadLargeFieldRequest {
    docUrl: string;
    fieldId: DecimalId;
    contentType?: string;
    compress?: boolean;
    size?: DecimalId;
    useMultipartResponse?: boolean;
}
/**
 * Native Administrator LDS SOAP 1.2 operations bound to one decimal LDS session ID.
 * Optional fields remain omitted unless explicitly supplied; large request bodies use multipart/XOP.
 */
export declare class NativeLdsApi {
    private readonly caller;
    constructor(caller: LdsCaller);
    /** Closes the decimal LDS context. Prefer `NativeSession.close()` for the complete client lifecycle. */
    closeSession(options?: RequestOptions): Promise<SoapResult>;
    /**
     * Returns ready entries from the current context's classic catalog-stat cache.
     * An empty Catalogs response is valid; readiness and skip gates may hide entries.
     * RecordsNum is cached metadata, not a fresh SQL COUNT or an object-type registry.
     */
    getCatalogsStat(options?: RequestOptions): Promise<SoapResult>;
    /** Returns modified objects since optional `minModDate`. */
    getModObjects(request?: {
        minModDate?: string;
        compress?: boolean;
    }, options?: RequestOptions): Promise<SoapResult>;
    /** Returns deleted-object changes. Availability and server-side storage dependencies must be checked on the connected server. */
    getModDeletedObjects(request?: {
        minModDate?: string;
        compress?: boolean;
    }, options?: RequestOptions): Promise<SoapResult>;
    /**
     * Loads URL data; response flags select a stream, while `tryLock` mutates lock state.
     * @mutating When `tryLock` is enabled.
     */
    loadUrl(request: StreamingLoadRequest, options?: RequestOptions): Promise<WsHcmBinaryResponse>;
    loadUrl(request: SoapLoadRequest, options?: RequestOptions): Promise<SoapResult>;
    loadUrl(request: LoadRequest, options?: RequestOptions): Promise<SoapResult | WsHcmBinaryResponse>;
    /**
     * Writes exact text/binary URL data as an XOP attachment.
     * @mutating
     */
    putUrl(request: {
        url: string;
        data: SoapAttachment;
    }, options?: RequestOptions): Promise<SoapResult>;
    /**
     * Deletes a URL, optionally requiring strict existence.
     * @mutating
     */
    deleteUrl(request: {
        url: string;
        strictDelete?: boolean;
    }, options?: RequestOptions): Promise<SoapResult>;
    /**
     * Releases a URL lock owned by the current LDS context.
     * @mutating
     */
    unlockUrl(url: string, options?: RequestOptions): Promise<SoapResult>;
    /**
     * Initializes an unsaved document through the runtime object model.
     * The wire contract is supported, but success requires a registered object type; classic XMD catalogs may not qualify.
     * @mutating
     */
    createDoc(request: {
        objectTypeId: string;
        assignId?: boolean;
    }, options?: RequestOptions): Promise<SoapResult>;
    /**
     * Loads a document; `tryLock` mutates lock state.
     * In 1171, the LoadDoc handler ignores binary/multipart response flags and emits SOAP.
     * Those flags select the client's raw stream, whose bytes may still contain a SOAP envelope;
     * they do not guarantee the returned representation.
     * @mutating When `tryLock` is enabled.
     */
    loadDoc(request: StreamingLoadRequest, options?: RequestOptions): Promise<WsHcmBinaryResponse>;
    loadDoc(request: SoapLoadRequest, options?: RequestOptions): Promise<SoapResult>;
    loadDoc(request: LoadRequest, options?: RequestOptions): Promise<SoapResult | WsHcmBinaryResponse>;
    /**
     * Persists caller-built XML as an XOP attachment.
     * Omitted/false `skipActions` keeps server pre-save processing enabled; `true` suppresses its action-enable state.
     * `data` must be created by `rawXml()`.
     * @mutating
     */
    putDoc(request: {
        url: string;
        writeDocInfo?: boolean;
        skipActions?: boolean;
        neverSaved?: boolean;
        data: RawXml;
    }, options?: RequestOptions): Promise<SoapResult>;
    /**
     * Deletes a physical document URL, optionally requiring strict existence.
     * @mutating
     */
    deleteDoc(request: {
        url: string;
        strictDelete?: boolean;
    }, options?: RequestOptions): Promise<SoapResult>;
    /** Streams a native LDS large field for a registered x-db-obj object type; consume or cancel the body. */
    loadLargeField(request: LoadLargeFieldRequest, options?: RequestOptions): Promise<WsHcmBinaryResponse>;
    /**
     * Writes a large-field XOP attachment without text re-encoding binary values.
     * Requires an x-db-obj document URL backed by a registered object-type provider.
     * Never derive this URL from a classic x-local document by guessing its type.
     * @mutating
     */
    putLargeField(request: {
        docUrl: string;
        fieldId: DecimalId;
        fieldPathname?: string;
        contentType?: string;
        data: SoapAttachment;
    }, options?: RequestOptions): Promise<SoapResult>;
    /**
     * Deletes a large field by lossless document/field identity.
     * Requires a registered x-db-obj object-type provider.
     * @mutating
     */
    deleteLargeField(request: {
        docUrl: string;
        fieldId: DecimalId;
    }, options?: RequestOptions): Promise<SoapResult>;
    /**
     * Allocates a new lossless object ID in the selected database.
     * @mutating
     */
    getNewObjectId(request: {
        dbName: string;
        objectType?: string;
    }, options?: RequestOptions): Promise<SoapResult>;
    /** Executes XQuery with optional pagination/cursor lifecycle. */
    xQuery(request: XQueryRequest, options?: RequestOptions): Promise<SoapResult>;
    /**
     * Releases a cursor previously returned to this LDS context.
     * @mutating Changes transient cursor state.
     */
    releaseCursor(cursorId: DecimalId, options?: RequestOptions): Promise<SoapResult>;
    /**
     * Executes a server library method with inline XML `ArgData` children.
     * Server 2025.1.1171 takes the arguments only as XML inside the SOAP body;
     * it rejects external XOP attachments as Parameter is not XML.
     * RunAsync uses a separate internal thread and returns no public task handle;
     * its initial ResultData may be typed undefined and does not prove completion.
     * GetAsyncMethodStatus and KillAsyncMethod cannot track this execution.
     * @mutating
     */
    runMethod(request: RunMethodRequest, options?: RequestOptions): Promise<SoapResult>;
    /**
     * Executes server-side code. Treat every invocation as mutating.
     * On server 2025.1.1171 this SOAP method responds Unknown method:
     * Eval even with ALLOW-SERVER-EVAL enabled. Availability must be checked per server.
     * @mutating
     */
    eval(request: {
        code: string;
    }, options?: RequestOptions): Promise<SoapResult>;
    /** Keeps the current native LDS session active. */
    idle(options?: RequestOptions): Promise<SoapResult>;
}
/** Web Administrator LDS SOAP 1.1 context and shared stock service methods, bound to one LDS ID. */
export declare class WebLdsApi {
    private readonly caller;
    constructor(caller: LdsCaller);
    /**
     * Executes web LDS XQuery. `keepCursor` defaults to `true`; pass `false` for one-shot reads.
     * @mutating When cursor retention is enabled (the default).
     */
    xQuery(request: XQueryRequest, options?: RequestOptions): Promise<SoapResult>;
    /**
     * Releases a caller-owned web LDS cursor.
     * @mutating Changes transient cursor state.
     */
    releaseCursor(cursorId: DecimalId, options?: RequestOptions): Promise<SoapResult>;
    /**
     * Executes the stock LDS RunMethod in this web SOAP 1.1 context.
     * ArgData contains inline typed XML children; SessionID precedes that stream.
     * RunAsync uses a separate internal thread and returns no public task handle;
     * its initial ResultData may be typed undefined and does not prove completion.
     * GetAsyncMethodStatus and KillAsyncMethod cannot track this execution.
     * Server target permissions still apply, independently of the web profile.
     * @mutating
     */
    runMethod(request: RunMethodRequest, options?: RequestOptions): Promise<SoapResult>;
    /**
     * Deletes a URL through the shipped web LDS subset.
     * @mutating
     */
    deleteUrl(url: string, options?: RequestOptions): Promise<SoapResult>;
    /**
     * Deletes a document; web wire sends `StrictDelete=1` only when enabled.
     * @mutating
     */
    deleteDoc(request: {
        url: string;
        strictDelete?: boolean;
    }, options?: RequestOptions): Promise<SoapResult>;
    /**
     * Executes server-side code in the web LDS context.
     * On server 2025.1.1171 this SOAP method responds Unknown method:
     * Eval even with ALLOW-SERVER-EVAL enabled. Availability must be checked per server.
     * @mutating
     */
    eval(code: string, options?: RequestOptions): Promise<SoapResult>;
}
/** One RPC argument. Structured XmElem child XML uses no VALUE-TYPE attribute. */
export interface RpcArgument {
    readonly valueType?: string;
    readonly lexicalValue: string | RawXml;
}
/** Parsed RPC result plus the complete XML response tree. */
export interface RpcResult {
    readonly valueType?: string;
    readonly lexicalValue?: string;
    readonly xml: XmlObject;
}
/**
 * RPC argument helpers. Only the string case is automatically typed; use `typed()` for every other lexical type.
 * `RawXml` lexical values are inserted as exact child XML rather than escaped text.
 */
export declare const rpc: Readonly<{
    string(value: string): RpcArgument;
    typed(valueType: string, lexicalValue: string | RawXml): RpcArgument;
    /** Match the shipped XmElem serializer: validated child XML without an invented VALUE-TYPE. */
    xml(value: RawXml): RpcArgument;
}>;
/**
 * SPXML `CallMethod` client for existing native or web server libraries.
 * Target discovery is historical evidence; the server decides authorization and reachability for dynamic targets.
 */
export declare class RpcApi {
    private readonly transport;
    private readonly profile;
    constructor(transport: HttpTransport, profile: SoapProfile);
    /**
     * Calls an existing server target; discovery evidence does not impose a hardcoded allowlist.
     * @mutating
     */
    call(request: {
        target: string;
        args?: readonly RpcArgument[];
    }, options?: RequestOptions): Promise<WsHcmResponse<RpcResult>>;
}
/** Shipped web `/api/spxml` RPC, document, large-field and async-task surface. */
export declare class WebSpXmlApi {
    private readonly transport;
    readonly rpc: RpcApi;
    constructor(transport: HttpTransport);
    /**
     * Synchronous allowlisted RPC call. The selected target may change state.
     * @mutating
     */
    callMethod(request: {
        target: string;
        args?: readonly RpcArgument[];
    }, options?: RequestOptions): Promise<WsHcmResponse<RpcResult>>;
    /**
     * Starts an allowlisted asynchronous RPC task and returns a lossless TrackingID.
     * @mutating
     */
    callMethodAsync(request: {
        target: string;
        args?: readonly RpcArgument[];
    }, options?: RequestOptions): Promise<SoapResult>;
    /**
     * Lists background tasks filtered by library and method names.
     * On server 2025.1.1171 the task pool is application-wide and can include other callers;
     * matching a name does not establish task ownership. Expired nonrunning entries
     * are removed before filtering. Recent terminal tasks are not
     * consumed by this list, but their status/results are included in each Task.
     * Use an independently journalled TrackingID for subsequent status or kill calls.
     */
    getBackgroundTasksByName(request: {
        libName: string;
        methodName: string;
    }, options?: RequestOptions): Promise<SoapResult>;
    /**
     * Reads async task state using the original decimal or `0x` TrackingID lexical form.
     * On server 2025.1.1171 the first terminal response consumes the finished tracking entry.
     * Retain that payload immediately and never poll the finished ID again: a lost HTTP
     * terminal response can consume its result. Other builds require separate verification.
     * Poll running tasks no more often than once every 250 ms.
     */
    getAsyncMethodStatus(trackingId: TrackingId, options?: RequestOptions): Promise<SoapResult>;
    /**
     * Requests task cancellation; successful cancellation of already-completed tasks is not guaranteed.
     * @mutating
     */
    killAsyncMethod(trackingId: TrackingId, options?: RequestOptions): Promise<SoapResult>;
    /**
     * Reads document XML using UTF-8 unless `charset` is supplied; response charset headers take precedence.
     * Server 2025.1.1171 does not accept a TryLock query parameter on this route:
     * a value passed in the query is refused.
     * Use native LDS LoadDoc for a verified document-lock route.
     * @mutating When `tryLock` is enabled.
     */
    getDoc(request: {
        docUrl: string;
        charset?: string;
        tryLock?: boolean;
    }, options?: RequestOptions): Promise<WsHcmResponse<XmlObject>>;
    /**
     * Persists caller XML through web SPXML server pre-save processing.
     * `neverSaved=true` sends `NeverSaved=1`; false/omitted sends no flag. This route has no `SkipActions` control.
     * @mutating
     */
    putDoc(request: {
        docUrl: string;
        document: string | RawXml;
        writeDocInfo?: boolean;
        neverSaved?: boolean;
    }, options?: RequestOptions): Promise<WsHcmResponse<unknown>>;
    /** Streams a web SPXML large field for a registered x-db-obj object type; consume or cancel the body. */
    getLargeField(request: GetLargeFieldRequest, options?: RequestOptions): Promise<WsHcmBinaryResponse>;
    /**
     * Uploads a web SPXML large-field body without implicit buffering.
     * Requires an x-db-obj document URL backed by a registered object-type provider.
     * Never derive this URL from a classic x-local document by guessing its type.
     * @mutating
     */
    putLargeField(request: PutLargeFieldRequest, options?: RequestOptions): Promise<WsHcmResponse<unknown>>;
    /**
     * Imports a web large field from a server-visible source URL.
     * Requires an x-db-obj document URL backed by a registered object-type provider.
     * @mutating
     */
    putLargeFieldFromUrl(request: PutLargeFieldFromUrlRequest, options?: RequestOptions): Promise<WsHcmResponse<unknown>>;
}
/**
 * Schema-backed native SPXML variants whose native reachability remains partial.
 * Access this class only through `NativeSession.experimental.spxml`.
 */
export declare class NativeExperimentalSpXmlApi {
    #private;
    private readonly transport;
    constructor(transport: HttpTransport);
    /**
     * Starts an allowlisted async target through the partial native SPXML profile.
     * @mutating The selected target may change server state.
     */
    callMethodAsync(request: {
        target: string;
        args?: readonly RpcArgument[];
    }, options?: RequestOptions): Promise<SoapResult>;
    /**
     * Lists name-filtered application-wide tasks through the native SOAP profile.
     * On server 2025.1.1171 expired nonrunning entries are removed before
     * filtering and the list can hold tasks belonging to other callers. Recent terminal
     * entries are retained by this list; Task includes TrackingID, StartDate and
     * status/result fields. Name matching never proves ownership: only operate on
     * an independently journalled TrackingID.
     */
    getBackgroundTasksByName(request: {
        libName: string;
        methodName: string;
    }, options?: RequestOptions): Promise<SoapResult>;
    /**
     * Reads native async task state while preserving the original TrackingID lexical form.
     * On server 2025.1.1171 the first terminal response consumes the finished tracking entry.
     * Retain that payload immediately and never poll the finished ID again: a lost HTTP
     * terminal response can consume its result. Other builds require separate verification.
     * Poll running tasks no more often than once every 250 ms.
     */
    getAsyncMethodStatus(trackingId: TrackingId, options?: RequestOptions): Promise<SoapResult>;
    /**
     * Requests cancellation through the partial native SPXML profile.
     * @mutating
     */
    killAsyncMethod(trackingId: TrackingId, options?: RequestOptions): Promise<SoapResult>;
    /** Reads document XML through the partial native SPXML route. */
    getDoc(...args: Parameters<WebSpXmlApi["getDoc"]>): ReturnType<WebSpXmlApi["getDoc"]>;
    /** Streams a large field through the partial native SPXML route. */
    getLargeField(...args: Parameters<WebSpXmlApi["getLargeField"]>): ReturnType<WebSpXmlApi["getLargeField"]>;
    /**
     * Persists document XML through the partial native SPXML route.
     * @mutating
     */
    putDoc(...args: Parameters<WebSpXmlApi["putDoc"]>): ReturnType<WebSpXmlApi["putDoc"]>;
    /**
     * Uploads a large field through the partial native SPXML route.
     * @mutating
     */
    putLargeField(...args: Parameters<WebSpXmlApi["putLargeField"]>): ReturnType<WebSpXmlApi["putLargeField"]>;
    /**
     * Imports a large field from a server-visible URL through the partial native route.
     * @mutating
     */
    putLargeFieldFromUrl(...args: Parameters<WebSpXmlApi["putLargeFieldFromUrl"]>): ReturnType<WebSpXmlApi["putLargeFieldFromUrl"]>;
}
declare class SpXml2Base {
    protected readonly transport: HttpTransport;
    constructor(transport: HttpTransport);
    /** Reads server application/bootstrap metadata; `application_module` is optional and may be absent. */
    getAppInfo(request?: {
        fastStart?: boolean;
        anonymous?: boolean;
        openSession?: boolean;
        rnd?: number;
    }, options?: RequestOptions): Promise<WsHcmResponse<unknown>>;
    /** Loads a form payload by server-local URL as text using the response charset. */
    getForm(request: {
        url: string;
    }, options?: RequestOptions): Promise<WsHcmResponse<string>>;
}
/** Native SPXML2 app-info and form retrieval surface. */
export declare class NativeSpXml2Api extends SpXml2Base {
}
/** Web SPXML2 surface; app-info defaults to `fast_start=1` and a random cache-busting `rnd`. */
export declare class WebSpXml2Api extends SpXml2Base {
    getAppInfo(request?: {
        fastStart?: boolean;
        anonymous?: boolean;
        openSession?: boolean;
        rnd?: number;
    }, options?: RequestOptions): Promise<WsHcmResponse<unknown>>;
    /** Streams a web SPXML2 image with optional effect query values. */
    getImage(request: {
        url: string;
        effects?: QueryValues;
    }, options?: RequestOptions): Promise<WsHcmBinaryResponse>;
    /** Reads the default preloaded-design-file set. */
    getPreloadedDesignFiles(options?: RequestOptions): Promise<WsHcmResponse<string>>;
    /** Calls the shipped server `std_encrypt` service; this is not a general client-side encryption primitive. */
    stdEncrypt(text: string, options?: RequestOptions): Promise<WsHcmResponse<unknown>>;
}
/** Buffered legacy `/xhttp` result records and exact raw response bytes. */
export interface XHttpResult extends XHttpEntity {
    readonly result: string;
}
/** Streaming legacy response whose CRLF record prefix has already been removed from `body`. */
export declare class XHttpBinaryResponse extends WsHcmBinaryResponse {
    readonly records: Readonly<Record<string, string>>;
    constructor(response: Response, records: Readonly<Record<string, string>>);
}
declare const LEGACY_QUIT: unique symbol;
/** One source-defined scalar literal per legacy query body line; strings are not code. */
export type LegacyCatalogKey = {
    type: "string";
    value: string;
} | {
    type: "integer";
    value: string;
} | {
    type: "real";
    value: string;
};
/**
 * Legacy CRLF-framed `/xhttp` operations bound to an isolated legacy session.
 * Obtain instances through `LegacySession`, which owns its distinct frame SessionID.
 */
export declare class LegacyXHttpApi {
    private readonly transport;
    private readonly sessionId;
    constructor(transport: HttpTransport, sessionId: () => DecimalId | undefined);
    private send;
    private call;
    /** Bootstraps or keeps alive the legacy session. */
    idle(installationId?: string, options?: RequestOptions): Promise<WsHcmResponse<XHttpResult>>;
    /**
     * Streams URL bytes after CRLF result records; `lock=true` changes lock state.
     * @mutating When `lock` is enabled.
     */
    getUrl(request: {
        url: string;
        lock?: boolean;
        compress?: boolean;
    }, options?: RequestOptions): Promise<XHttpBinaryResponse>;
    /**
     * Writes URL bytes using exact legacy framing.
     * @mutating
     */
    putUrl(request: {
        url: string;
        body: Uint8Array | string;
        writeDocInfo?: boolean;
    }, options?: RequestOptions): Promise<WsHcmResponse<XHttpResult>>;
    /**
     * Deletes a URL; false strictness is serialized explicitly as required by legacy framing.
     * @mutating
     */
    deleteUrl(request: {
        url: string;
        strictDelete?: boolean;
    }, options?: RequestOptions): Promise<WsHcmResponse<XHttpResult>>;
    /**
     * Releases a legacy URL lock.
     * @mutating
     */
    unlockUrl(url: string, options?: RequestOptions): Promise<WsHcmResponse<XHttpResult>>;
    /**
     * Allocates a new document ID in the named legacy database.
     * @mutating
     */
    obtainNewDocId(request: {
        db: string;
    }, options?: RequestOptions): Promise<WsHcmResponse<XHttpResult>>;
    /**
     * Selects catalog rows by typed keys using one XQuery scalar literal per CRLF body line.
     * Catalog and KeyName are explicit legacy header records. Strings escape apostrophes
     * by doubling; integer/real lexical strings avoid implicit JavaScript conversion.
     * The initial proven grammar supports unsigned integers, finite unsigned decimals,
     * and single-line strings. Signed expressions, boolean/null keys and raw code are not accepted.
     */
    queryCatalogByKeys(request: {
        catalog: string;
        keyName: string;
        keys: LegacyCatalogKey[];
    }, options?: RequestOptions): Promise<WsHcmResponse<XHttpResult>>;
    /**
     * Executes server-side code supplied as the legacy request body.
     * Server 2025.1.1171 rejects this action
     * with Obsolete method: ServerEval when ALLOW-SERVER-EVAL is disabled.
     * Fresh baseline fixtures confirmed disabled rejection with a masked HTTP 500
     * and an enabled harmless Unicode string expression with a typed UTF-8 result.
     * These checks do not establish other scripts or the separate SOAP LDS Eval path.
     * The separate legacy XQuery action returns No longer supported.
     * @mutating
     */
    eval(code: string, options?: RequestOptions): Promise<WsHcmResponse<XHttpResult>>;
    /** Reads whether the current legacy context has administrator privileges. */
    isAdmin(options?: RequestOptions): Promise<WsHcmResponse<XHttpResult>>;
    [LEGACY_QUIT](sessionId: DecimalId, options?: RequestOptions): Promise<WsHcmResponse<XHttpResult>>;
}
/** One caller-selected part of the stock chunk uploader. offset and totalBytes count decoded bytes. */
export interface UploadChunkRequest {
    fileId: string;
    filename: string;
    index: number;
    chunksTotal: number;
    totalBytes: number;
    offset: number;
    data: SoapAttachment;
    contentType?: string;
}
/** The endpoint allocates a new Url on every request; this is not completion or file-existence proof. */
export interface UploadChunkResult {
    error: 0;
    Url: string;
}
/** Exact indices [0, chunksTotal) in the caller-selected global filechunk namespace. */
export interface ClearUploadChunksRequest {
    fileId: string;
    chunksTotal: number;
}
/** Server deletion errors are swallowed; an empty response proves acknowledgement only. */
export interface ClearUploadChunksResult {
    acknowledged: true;
    fileId: string;
    chunksTotal: number;
    absenceVerified: false;
}
/** Shipped web Administrator page-service operations. */
export declare class WebPageApi {
    private readonly transport;
    private readonly uploadToken?;
    private readonly maximumUploadBytes;
    constructor(transport: HttpTransport, uploadToken?: (() => string | undefined) | undefined, maximumUploadBytes?: number);
    /**
     * Copies one server URL to another.
     * @mutating
     */
    copyUrl(request: {
        srcUrl: string;
        destUrl: string;
    }, options?: RequestOptions): Promise<WsHcmResponse<string>>;
    /**
     * Asks the web create handler for unsaved document XML.
     * Success depends on classic/object-model branch and registered object type; this method does not persist the result.
     * @mutating
     */
    createDoc(request: {
        objectTypeId: string;
        assignId?: boolean;
    }, options?: RequestOptions): Promise<WsHcmResponse<XmlObject>>;
    /** Reads the shipped PDF preview helper page as text. */
    filePreviewPdf(options?: RequestOptions): Promise<WsHcmResponse<string>>;
    /** Reads a form by server-local URL as text. */
    getForm(request: {
        url: string;
    }, options?: RequestOptions): Promise<WsHcmResponse<string>>;
    /** Reads a screen form by server-local URL as text. */
    getScreenForm(request: {
        url: string;
    }, options?: RequestOptions): Promise<WsHcmResponse<string>>;
    /**
     * Streams SVG through the stock web page image handler. The server accepts
     * x-app/x-local SVG URLs and checks source read access. Optional state values
     * hover/pressed/disabled select the shipped color substitution; other values
     * preserve the original content. Omission sends state="" because the shipped
     * page requires that query field. Consume or cancel the returned body.
     */
    getImage(request: {
        url: string;
        state?: string;
    }, options?: RequestOptions): Promise<WsHcmBinaryResponse>;
    /**
     * Streams a PNG generated by the stock icon page from an x-app/x-local .ico URL.
     * This page supports one fixed 16-pixel extraction, not arbitrary resizing or
     * a PNG input. A sufficiently fresh server icon-cache entry is returned as-is;
     * a cache miss creates directories/temp files and runs misc/image_convert.exe.
     * Availability therefore requires that cache entry or the installed converter.
     * Treat this operation as write because it may change server cache/temp files.
     * Consume or cancel the returned body.
     * @mutating
     */
    getIcon(request: {
        url: string;
    }, options?: RequestOptions): Promise<WsHcmBinaryResponse>;
    /** Reads and parses web UI text XML using its declared application charset. */
    getUiText(options?: RequestOptions): Promise<WsHcmResponse<XmlObject>>;
    /** Streams page-service URL output; consume or cancel the returned body. */
    getUrl(request: {
        url: string;
        navigate?: boolean;
        download?: boolean;
        base64?: boolean;
    }, options?: RequestOptions): Promise<WsHcmBinaryResponse>;
    /**
     * Writes a page-service URL body with optional base64/text hints.
     * @mutating
     */
    putUrl(request: {
        url: string;
        isBase64?: boolean;
        isText?: boolean;
        body: BodyInit;
    }, options?: RequestOptions): Promise<WsHcmResponse<string>>;
    /**
     * Uploads one file through the shipped multipart f/session_token workflow.
     * The owning WebSession supplies its current private page token. Input is
     * bounded by maxResponseBytes and an 8 MiB client input budget; no chunks or
     * legacy base64 branch is implied. A successful response contains Url.
     * @mutating Persists a server upload and runs the platform's upload rules.
     */
    uploadFile(request: {
        filename: string;
        data: SoapAttachment;
        contentType?: string;
    }, options?: RequestOptions): Promise<WsHcmResponse<unknown>>;
    /**
     * Sends one stock upload_chunk POST with exact data bytes and an explicit Content-Range.
     * The caller supplies a known 32-hex fileId and coordinates chunk order; the last part joins the file.
     * Receipts do not independently prove chunk persistence or final file bytes.
     * Verify staging with a storage-appropriate read before submitting the final part.
     * Final errors can leave an unknown output URL; do not retry or guess cleanup targets.
     * Requires the installed WebSoft/libMain branch and its existing principal/upload policies.
     * @mutating Writes global chunk storage and may create an assembled upload.
     */
    uploadChunk(request: UploadChunkRequest, options?: RequestOptions): Promise<WsHcmResponse<UploadChunkResult>>;
    /**
     * Requests deletion of [0, chunksTotal) for a known caller-selected 32-hex fileId.
     * The namespace is global; the server does not check who created this ID.
     * An empty ACK does not prove chunk absence, directory removal, final-file or scratch cleanup.
     * @mutating Requests chunk deletion; individual server errors are swallowed.
     */
    clearUploadChunks(request: ClearUploadChunksRequest, options?: RequestOptions): Promise<WsHcmResponse<ClearUploadChunksResult>>;
}
/** Exactly one source for a named compound-attc attachment. */
export type CompoundResourceRequest = {
    url: string;
    resId: string;
} | {
    docUrl: string;
    elemPath: string;
    resId: string;
};
/** Resource streaming API shared by native and web sessions. */
export declare class ResourceApi {
    private readonly transport;
    constructor(transport: HttpTransport);
    /** Streams a resource image by lossless decimal ID and optional image type. */
    getImage(request: {
        resourceId: DecimalId;
        imageType?: string;
    }, options?: RequestOptions): Promise<WsHcmBinaryResponse>;
    /**
     * Streams a named compound-attc attachment through GET /xhttp_res.
     * Use url for an x-local/x-app HTML source, or docUrl plus elemPath for a
     * document string field (also accepts a registered x-db-obj document).
     * elemPath starts with the document element name, such as presence_state.name;
     * obtain it from the actual document rather than guessing its root or layout.
     * The server decodes the matching attachment data and selects media type
     * from resId. Stock 1171 also requires URL sources under configured courses_path;
     * a permitted local scheme alone does not establish that prefix.
     * Native Administrator builds this route; the web alias uses
     * the same server handler with its own HTTP context, not a distinct caller
     * claim. Consume or cancel the returned body.
     */
    getCompoundResource(request: CompoundResourceRequest, options?: RequestOptions): Promise<WsHcmBinaryResponse>;
}
/** Read-only transport/server diagnostics that do not create an LDS session. */
export declare class DiagnosticsApi {
    private readonly transport;
    constructor(transport: HttpTransport);
    /** Observes the portal status without following redirects or retaining its body. */
    portal(options?: RequestOptions): Promise<{
        status: number;
    }>;
    /** Reads `/xhttp_info`, using Basic auth only when client credentials were configured. */
    xhttpInfo(options?: RequestOptions): Promise<WsHcmResponse<string>>;
}
/** Explicit escape hatch for unknown/experimental wire requests. Prefer typed API groups. */
export declare class ExperimentalApi {
    protected readonly transport: HttpTransport;
    constructor(transport: HttpTransport);
    /**
     * Sends a same-origin caller-defined request and returns its body as a stream.
     * `unsafe: true` is mandatory. Normal operation serializers, fault parsing and mutability guarantees are bypassed;
     * configured auth/cookies still apply and the caller owns method, headers, body and stream cleanup.
     */
    rawRequest(request: {
        unsafe: true;
        path: string;
        method?: string;
        headers?: HeadersInit;
        body?: BodyInit;
    }, options?: RequestOptions): Promise<WsHcmBinaryResponse>;
}
/** Schema-backed partial web operations plus the raw escape hatch. */
export declare class WebExperimentalApi extends ExperimentalApi {
    /** Reads the schema-backed but partial web UI-template route. */
    getUiTemplate(request: {
        id: string;
    }, options?: RequestOptions): Promise<WsHcmResponse<string>>;
    /**
     * Calls the partial web authentication route; success cookie/body semantics are not fully established.
     * @mutating Changes authentication/session state.
     */
    authenticate(request: {
        login: string;
        password: string;
        token: string;
    }, options?: RequestOptions): Promise<WsHcmResponse<unknown>>;
}
/** Schema-backed partial native operations plus the raw escape hatch. */
export declare class NativeExperimentalApi extends ExperimentalApi {
    private readonly sessionId;
    readonly spxml: NativeExperimentalSpXmlApi;
    constructor(transport: HttpTransport, sessionId: () => DecimalId);
    /** Reads the schema-backed partial native directory operation; flag types remain intentionally lexical/raw. */
    readDirectory(request: {
        url: string;
        readFilesOnly?: string | RawXml;
        readDirectoriesOnly?: string | RawXml;
    }, options?: RequestOptions): Promise<SoapResult>;
}
export declare function createNativeLdsApi(transport: HttpTransport, sessionId: () => DecimalId): NativeLdsApi;
export declare function createWebLdsApi(transport: HttpTransport, sessionId: () => DecimalId): WebLdsApi;
export {};
