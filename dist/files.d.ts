import type { HcmServer } from "./hcm-server.js";
import type { WriteOutcome } from "./write-outcome.js";
/** Один абсолютный URL платформы; предикат не читает содержимое. */
export interface FileExistsInput {
    readonly url: string;
}
export interface FileExistsData {
    /** Существует файл, папка или адрес хранилища из настроек; содержимое и доступ не проверяются. */
    readonly exists: boolean;
}
/** Один адрес файла на сервере. */
export interface FileReadInput {
    readonly url: string;
    /** "base64" отдаёт байты, даже если файл текстовый. */
    readonly encoding?: "base64";
}
export interface FileReadData {
    /** Содержимое, если это текст UTF-8; метка порядка байтов в начале убирается. */
    readonly text?: string;
    /** Содержимое, если это не текст или запрошен base64. */
    readonly base64?: string;
    readonly bytes: number;
}
/** Загрузчик отвечает base64, разбитым на строки; вызывающему нужен сам файл. */
export declare function fileContent(response: unknown, encoding?: unknown): FileReadData;
export declare const FILE_EXISTS_URL_MAX_LENGTH = 256;
/** Проверяет, не нормализуя URL, который передаётся штатному предикату. */
export declare function fileExistsUrl(value: unknown): string;
/** Ровно одно из text (запись в UTF-8) и base64. */
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
/** Папки сервера: в папки данных файлы идут через LDS, в папки кода — только код на сервере. */
export type FileFolders = {
    readonly data: readonly string[];
    readonly code: readonly string[];
};
export interface FileListData {
    /** По имени; у файла указан размер в байтах, у папки folder:true. */
    readonly items: readonly ({
        name: string;
        bytes: number;
    } | {
        name: string;
        folder: true;
    })[];
    readonly total: number;
}
/** Разбирает только прямой булев ResultData/Result фиксированного штатного предиката. */
export declare function parseFileExists(response: unknown): FileExistsData;
/** Что операция сообщает runtime об одном вызове: из этого строятся исход и подсказка при сбое. */
export interface FileCall {
    outcome: WriteOutcome;
    causeRuledOut?: true;
}
/** Файловые операции: метод — вся цепочка одной, от проверки адреса до проверки после ответа. */
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
    /** Сбой чтения сведений о приложении означает, что сервер не дал списков папок. */
    folders(): Promise<FileFolders | undefined>;
    private route;
}
