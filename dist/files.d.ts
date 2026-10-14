import type { ConnectionConfig } from "./contracts.js";
import type { HcmServer } from "./hcm-server.js";
import type { WriteOutcome } from "./write-outcome.js";
/** Аргументы fileExists. */
export interface FileExistsInput {
    /** Адрес на сервере: x-local://…, до 256 знаков. */
    readonly url: string;
}
/** Ответ fileExists. */
export interface FileExistsData {
    /** Существует файл, папка или адрес хранилища из настроек; содержимое и доступ не проверяются. */
    readonly exists: boolean;
}
/** Аргументы readFile. */
export interface FileReadInput {
    /** Адрес файла на сервере: x-local://…. */
    readonly url: string;
    /** "base64" отдаёт байты, даже если файл текстовый. */
    readonly encoding?: "base64";
}
/** Ответ readFile: ровно одно из text и base64. */
export interface FileReadData {
    /** Содержимое, если это текст UTF-8; метка порядка байтов в начале убирается. */
    readonly text?: string;
    /** Содержимое, если это не текст или запрошен base64. */
    readonly base64?: string;
    /** Размер файла в байтах. */
    readonly bytes: number;
}
/** Загрузчик отвечает base64, разбитым на строки; вызывающему нужен сам файл. */
export declare function fileContent(response: unknown, encoding?: unknown): FileReadData;
export declare const FILE_EXISTS_URL_MAX_LENGTH = 256;
/** Проверяет, не нормализуя URL, который передаётся штатному предикату. */
export declare function fileExistsUrl(value: unknown): string;
/** Ровно одно из text и base64. */
export type FileWriteInput = {
    /** Адрес файла на сервере: x-local://…; файл заменяется целиком. */
    readonly url: string;
    /** Текст; пишется в UTF-8. */
    readonly text?: string;
    /** Двоичные данные в base64. */
    readonly base64?: string;
};
/** Ответ writeFile. */
export type FileWriteData = {
    /** Сколько байт записано. */
    readonly bytes: number;
    /** Исход записи: подтверждена. */
    readonly mutationOutcome: "confirmed";
};
/** Аргументы deleteFile. */
export type FileDeleteInput = {
    /** Адрес файла на сервере: x-local://…. */
    readonly url: string;
};
/** Ответ deleteFile. */
export type FileDeleteData = {
    /** Файл удалён. */
    readonly deleted: true;
    /** Исход записи: подтверждена. */
    readonly mutationOutcome: "confirmed";
};
/** Папки сервера: в папки данных файлы идут через LDS, в папки кода — только код на сервере. */
export type FileFolders = {
    readonly data: readonly string[];
    readonly code: readonly string[];
};
/** Аргументы listFiles. */
export interface FileListInput {
    /** Папка на сервере: x-local://папка или x-local://папка/путь. */
    readonly url: string;
    /** Оставить имена с этой частью; регистр не важен. */
    readonly search?: string;
}
/** Ответ listFiles. */
export interface FileListData {
    /** По имени; у файла указан размер в байтах, у папки folder:true. */
    readonly items: readonly ({
        /** Имя файла. */
        name: string;
        /** Размер файла в байтах. */
        bytes: number;
    } | {
        /** Имя папки. */
        name: string;
        /** Это папка. */
        folder: true;
    })[];
    /** Сколько элементов в списке. */
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
    private readonly config;
    constructor(server: Pick<HcmServer, "call" | "read" | "runCode" | "applicationInfo">, config: ConnectionConfig);
    exists(args: Record<string, unknown>): Promise<FileExistsData>;
    read(args: Record<string, unknown>): Promise<FileReadData>;
    list(args: Record<string, unknown>, call: FileCall): Promise<FileListData>;
    write(args: Record<string, unknown>, call: FileCall): Promise<FileWriteData>;
    delete(args: Record<string, unknown>, call: FileCall): Promise<FileDeleteData>;
    /** Сбой чтения сведений о приложении означает, что сервер не дал списков папок. */
    folders(): Promise<FileFolders | undefined>;
    private route;
}
