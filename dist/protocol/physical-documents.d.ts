import type { NativeLdsApi, SoapResult } from "./api.js";
import type { RequestOptions } from "./types.js";
import { type RawXml } from "./xml.js";
export interface PhysicalDocumentLocation {
    /** Canonical ID lexical form stored in the document. */
    objectId: string;
    /** Physical x-local URL accepted by native LDS document operations. */
    url: string;
}
export interface CreatePhysicalDocumentRequest {
    /** Target physical database. Defaults to the classic WebTutor database `wt_data`. */
    dbName?: string;
    /** Populate server-managed `doc_info` metadata. Defaults to `true`. */
    writeDocInfo?: boolean;
    /** Suppress server pre-save action processing. Defaults to `false`/omitted. */
    skipActions?: boolean;
    /** Set the server document-state `NeverSaved` marker. Defaults to `true`; broader semantics are form-dependent. */
    neverSaved?: boolean;
    /** Builds one complete XML document containing the exact supplied `objectId`. */
    document: (location: PhysicalDocumentLocation) => RawXml;
}
export interface CreatedPhysicalDocument extends PhysicalDocumentLocation {
    /** Buffered LDS `PutDoc` response proving transport success. */
    putResponse: SoapResult;
    /** Buffered LDS `LoadDoc` response whose direct root ID was verified against `objectId`. */
    loadResponse: SoapResult;
}
/**
 * Applies the shipped web `XmBuildMessObjectUrl` layout without converting the ID through `number`.
 *
 * IDs below 4,000,000,000 use the decimal `/100` layout. All other IDs use the fixed 16-hex `14/2` layout.
 * This helper implements the shipped web layout; it does not claim to reproduce every internal `BindToDb` decision.
 */
export declare function resolvePhysicalDocumentLocation(idLexeme: string, dbName?: string): PhysicalDocumentLocation;
export declare function parsePhysicalDocumentId(url: string): string | undefined;
/**
 * Composes native physical persistence primitives without executing a client XMD runtime or registering an object type.
 * Native LDS executes server pre-save processing unless `skipActions` is true.
 * A successful return verifies physical round-trip and root ID, not arbitrary catalog visibility or full XMD/business rules.
 */
export declare class NativePhysicalDocumentsApi {
    private readonly lds;
    constructor(lds: NativeLdsApi);
    /**
     * Allocates an ID, writes caller-built XML, and verifies it with `LoadDoc`.
     * Defaults to `WriteDocInfo=true`, `NeverSaved=true`, and enabled server pre-save processing.
     * A failed write/verification triggers best-effort `DeleteDoc` cleanup before the original error is rethrown.
     *
     * @mutating
     */
    createFromXml(request: CreatePhysicalDocumentRequest, options?: RequestOptions): Promise<CreatedPhysicalDocument>;
}
