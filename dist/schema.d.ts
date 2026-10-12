import { HcmError } from "./errors.js";
export interface SchemaInput {
    type?: string;
    url?: string;
    search?: string;
    path?: string;
    /** Nested fields of every depth in one listing, not one level per call. */
    deep?: boolean;
    origin?: ("own" | "inherited" | "custom" | "catalog")[];
    kind?: string;
    include?: "methods"[];
    language?: string;
    limit?: number;
    cursor?: number;
}
export interface SchemaField {
    path: string;
    type: string;
    origin: string;
    name?: string;
    title?: string;
    references?: string;
    multiple?: true;
    required?: true;
    key?: string;
    children?: number;
    values?: string[];
    sheet?: string;
    query?: true;
    computed?: true;
}
export interface SchemaResult {
    type: string;
    catalog?: string;
    formUrl: string;
    /** With path: the element whose fields are listed — is it a list, what is its key. */
    element?: SchemaField;
    fields: SchemaField[];
    total: number;
    nextCursor?: number;
    /** The page is shorter than asked: more does not fit into one answer. */
    cutBySize?: true;
    notes: string[];
    methods?: {
        name: string;
        parameters: string[];
    }[];
}
export interface SchemaTypesInput {
    search?: string;
    limit?: number;
    cursor?: number;
}
export interface SchemaTypesResult {
    types: {
        type: string;
        catalog?: string;
        title?: string;
        customFields: number | "by kind";
    }[];
    total: number;
    /** Catalogs of the server in all, the ones without an object type of their own included. */
    catalogs: number;
    nextCursor?: number;
    notes?: string[];
}
/** What a reader needs to give data one form: the top-level field names and the repeated elements. */
export interface DataShape {
    readonly fields: Set<string>;
    /** Paths of elements the form declares repeated, such as collaborators.collaborator. */
    readonly repeated: Set<string>;
    /** Top-level fields the form declares as dates. */
    readonly dates: Set<string>;
    /** Top-level fields of a catalog row the form declares as integers: IDs and counters. */
    readonly integers?: Set<string>;
    /** Top-level fields the server computes: a value written to one is not kept. */
    readonly computed?: Set<string>;
    /** A base type of the form was not found, so the field names are not all of them. */
    partial?: boolean;
}
/** A repeated element is a list also when the data holds a single item. */
export declare function withRepeated(value: unknown, repeated: ReadonlySet<string>, prefix?: string): unknown;
type Data = Record<string, unknown>;
export declare function languageFileUrl(id: unknown, language?: string): string;
/** Reads live metadata through the runtime's fixed read operations; all caches stay in memory. */
export declare class SchemaReader {
    private applicationInfo;
    private readForm;
    private readDocument;
    private forms;
    private shapes;
    private dictionaries;
    private common;
    private custom;
    constructor(applicationInfo: () => Promise<Data>, readForm: (url: string) => Promise<string>, readDocument: (url: string) => Promise<Data>);
    private form;
    /**
     * Field types for the check after a write. A base type gives its fields to the place that names
     * it: without them a logical value the server stores as 1 would not equal the true that was sent.
     */
    documentForm(url: string): Promise<{
        roots: string[];
        fields: unknown[];
    }>;
    private shared;
    private commonData;
    /** Object types the server declares; an empty list when the declaration cannot be read. */
    private declaredTypes;
    private customData;
    private language;
    private unknownType;
    /**
     * A name that is not an object type is refused before anything is written. The check needs the
     * server's lists: when they cannot be read, the name is left to the server.
     */
    requireType(type: string): Promise<void>;
    /**
     * Whether rows of this type are documents. Rows of the other catalogs (group_collaborators)
     * are built by the server and have no document; the answer is yes when it cannot be told.
     */
    private hasDocuments;
    /**
     * Catalogs of the main database. The server names the object type only for some of them. Next to
     * them it lists its common lists (common.…): those are not catalogs and are left out.
     */
    private catalogs;
    /** Type of the rows of a catalog: named by the server or, failing that, by the catalog form. */
    private rowType;
    /**
     * Catalogs whose rows are objects of the type. For some types (event) the server leaves the
     * catalog unnamed: then the catalog called after the type counts, if its form agrees.
     */
    private catalogsOf;
    private context;
    private title;
    private typeTranslations;
    private typeTitle;
    private samples;
    /** Fields of one catalog row by path, read from the catalog form. */
    private catalogFields;
    /** Shape of a document of one type, with inherited fields; read once per form. */
    documentShape(type: string, formUrl?: string): Promise<DataShape>;
    /** Shape of one catalog row; the catalog is named or found by the object type of its rows. */
    catalogShape(selector: {
        catalog?: string;
        type?: string;
    }): Promise<DataShape | undefined>;
    private shape;
    /**
     * The server answers a refused catalog query with a bare HTTP 500. After such a refusal this
     * names the usual cause: a catalog that does not exist or a field that is not in the catalog.
     */
    explainQuery(catalogId: string, fields: readonly string[]): Promise<HcmError | undefined>;
    get(input: SchemaInput): Promise<SchemaResult>;
    types(input?: SchemaTypesInput): Promise<SchemaTypesResult>;
}
export {};
