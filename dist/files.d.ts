import type { HcmServer } from "./hcm-server.js";
import type { WriteOutcome } from "./write-outcome.js";
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
/** Decode only the fixed stock predicate's direct ResultData/Result boolean. */
export declare function parseFileExists(response: unknown): FileExistsData;
/** What an operation tells the runtime about one call: the outcome and the failure hint are built from it. */
export interface FileCall {
    outcome: WriteOutcome;
    refusal?: string;
}
/** The file operations: a method is the whole sequence of one, from the address check to the check after the answer. */
export declare class ServerFiles {
    private readonly server;
    private readonly permissions;
    constructor(server: Pick<HcmServer, "call" | "read" | "runCode" | "applicationInfo">, permissions: {
        readonly execute: boolean;
    });
    exists(args: Record<string, unknown>): Promise<FileExistsData>;
    read(args: Record<string, unknown>): Promise<FileReadData>;
    list(args: Record<string, unknown>, call: FileCall): Promise<FileListData>;
    write(args: Record<string, unknown>, call: FileCall): Promise<FileWriteData>;
    delete(args: Record<string, unknown>, call: FileCall): Promise<FileDeleteData>;
    /** A failure to read the application info means the server gave no folder lists. */
    folders(): Promise<FileFolders | undefined>;
    private route;
}
