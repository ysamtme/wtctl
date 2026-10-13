import { HcmError } from "./errors.js";
import { type ScriptData } from "./scripts.js";
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
/** Exactly one of text (written in UTF-8) and base64. */
export type FileWriteInput = {
    readonly url: string;
    readonly text?: string;
    readonly base64?: string;
};
export type FileWriteData = {
    readonly bytes: number;
    readonly mutationOutcome: "confirmed";
};
export type FileDeleteInput = {
    readonly url: string;
};
export type FileDeleteData = {
    readonly deleted: true;
    readonly mutationOutcome: "confirmed";
};
/** Folders of the server: data ones take files through LDS, code ones only code on the server. */
export type FileFolders = {
    readonly data: readonly string[];
    readonly code: readonly string[];
};
/** Only the two folder lists of the application info are read; undefined when the server gave none. */
export declare function fileFolders(info: Record<string, unknown> | undefined): FileFolders | undefined;
/** The folder is the first part of the address and decides the route: no part may get around it. */
export declare function fileTarget(value: unknown, listing?: boolean): {
    url: string;
    folder: string;
};
/** Folders of the server database delete by address with no error and remove nothing (2025.1.1333 - 2025.2.1535); refused before any request. */
export declare function assertFileDeletable(folder: string): void;
/** The route is chosen before anything is sent; "unlisted": the server did not say which folders take files. */
export declare function fileRoute(operation: "write" | "delete", folders: FileFolders | undefined, folder: string, canExecute: boolean): "data" | "code" | "unlisted";
/** The bytes to write: text in UTF-8, or base64 without line breaks. */
export declare function fileWriteContent(args: Record<string, unknown>): {
    base64: string;
    bytes: number;
    text?: string;
};
export declare function codeWrite(url: string, content: {
    base64: string;
    text?: string;
}): {
    request: Record<string, unknown>;
    executionId: string;
};
export declare function codeDelete(url: string): {
    request: Record<string, unknown>;
    executionId: string;
};
export declare function fileRemains(): HcmError;
/** The code found a folder or nothing at the address and deleted nothing. */
export declare function codeDeleteRefusal(data: ScriptData): HcmError | undefined;
export interface FileListData {
    /** By name; a file has its size in bytes, a folder has folder:true. */
    readonly items: readonly ({
        name: string;
        bytes: number;
    } | {
        name: string;
        folder: true;
    })[];
    readonly total: number;
}
/** One level of a folder: the addresses ReadDirectory gives, which of them are folders, and the file sizes. */
export declare function codeList(url: string): {
    request: Record<string, unknown>;
    executionId: string;
};
export declare function fileList(data: ScriptData, folder: string, search?: string): FileListData;
/** Decode only the fixed stock predicate's direct ResultData/Result boolean. */
export declare function parseFileExists(response: unknown): FileExistsData;
