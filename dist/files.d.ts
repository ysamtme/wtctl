/** One absolute platform URL; this predicate does not read its contents. */
export interface FileExistsInput {
    readonly url: string;
}
export interface FileExistsData {
    /** A file, a directory or a configured storage address exists; contents and access are not checked. */
    readonly exists: boolean;
}
/** One address of a file on the server. */
export interface FileReadInput {
    readonly url: string;
    /** "base64" gives the bytes even when the file is text. */
    readonly encoding?: "base64";
}
export interface FileReadData {
    /** The contents when they are UTF-8 text; a leading byte order mark is removed. */
    readonly text?: string;
    /** The contents when they are not text, or when base64 was asked for. */
    readonly base64?: string;
    readonly bytes: number;
}
/** The loader answers with base64 broken into lines; a caller wants the file itself. */
export declare function fileContent(response: unknown, encoding?: unknown): FileReadData;
export declare const FILE_EXISTS_TARGET = "tools.file_url_exists_server";
export declare const FILE_EXISTS_URL_MAX_LENGTH = 256;
/** Validate without normalizing the URL passed to the stock predicate. */
export declare function fileExistsUrl(value: unknown): string;
/** Decode only the fixed stock predicate's direct ResultData/Result boolean. */
export declare function parseFileExists(response: unknown): FileExistsData;
