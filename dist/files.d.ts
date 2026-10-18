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
/** Аргументы readFile без file: файл приходит в ответе. */
export interface FileReadInput {
    /** Адрес файла на сервере: x-local://…. */
    readonly url: string;
    /** "base64" отдаёт байты, даже если файл текстовый. */
    readonly encoding?: "base64";
    /** Не задаётся: файл на диск сохраняет вызов с FileSaveInput. */
    readonly file?: undefined;
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
/** Аргументы readFile с file: файл сохраняется на этот компьютер. */
export interface FileSaveInput {
    /** Адрес файла на сервере: x-local://…. */
    readonly url: string;
    /** Полный путь, куда сохранить файл байт в байт; размер не ограничен. Папка должна быть. */
    readonly file: string;
    /** Заменить файл, если он уже есть; иначе FILE_EXISTS. */
    readonly overwrite?: boolean;
}
/** Ответ readFile с file. */
export interface FileSaveData {
    /** Размер файла в байтах. */
    readonly bytes: number;
    /** Полный путь к сохранённому файлу. */
    readonly file: string;
}
/** Файл целиком: текст, если это текст в UTF-8, иначе base64. */
export declare function fileContent(content: Buffer, encoding?: "base64"): FileReadData;
export declare const FILE_EXISTS_URL_MAX_LENGTH = 256;
/** Проверяет, не нормализуя URL, который передаётся штатному предикату. */
export declare function fileExistsUrl(value: unknown): string;
/** Ровно одно из text, base64 и file. */
export type FileWriteInput = {
    /** Адрес файла на сервере: x-local://…; файл заменяется целиком. */
    readonly url: string;
    /** Текст; пишется в UTF-8. */
    readonly text?: string;
    /** Двоичные данные в base64. */
    readonly base64?: string;
    /** Полный путь к файлу на этом компьютере: он читается частями, память не растёт с размером. */
    readonly file?: string;
};
/** Ответ writeFile. */
export type FileWriteData = {
    /** Сколько байт записано. */
    readonly bytes: number;
    /** Исход записи: файл на сервере прочитан назад и совпал с отправленным. */
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
/**
 * Папки сервера: папка кода хранит код сервера, поэтому запись в неё требует ещё права execute.
 * database — папки данных, которые сервер хранит в базе данных, а не на диске.
 */
export type FileFolders = {
    readonly data: readonly string[];
    readonly code: readonly string[];
    readonly database: readonly string[];
};
/** Столько байт за раз шлёт штатная настольная админка. */
export declare const UPLOAD_BLOCK_BYTES = 10000000;
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
/**
 * Что операция сообщает runtime об одном вызове: из этого строятся исход и сообщение при сбое.
 * Часть OperationCall, своим типом: объявления пакета не тянут за собой устройство runtime.
 */
export interface FileCall {
    outcome: WriteOutcome;
    afterSend?: {
        message: string;
        hint?: string;
    };
}
/** Файловые операции: метод — вся цепочка одной, от проверки адреса до проверки после ответа. */
export declare class ServerFiles {
    private readonly server;
    private readonly config;
    constructor(server: Pick<HcmServer, "call" | "read" | "stream" | "runCode" | "applicationInfo">, config: ConnectionConfig);
    exists(args: Record<string, unknown>): Promise<FileExistsData>;
    /** Без file файл собирается в память в пределах maxResponseBytes; с file идёт на диск без предела. */
    read(args: Record<string, unknown>): Promise<FileReadData | FileSaveData>;
    /** Файл сервера потоком байт: read читает тело ответа, пока запрос занимает подключение. */
    private load;
    list(args: Record<string, unknown>, call: FileCall): Promise<FileListData>;
    /**
     * Путь настольной админки, одинаковый для всех папок: начало записи делает файл пустым, блоки
     * ложатся по месту, затем файл читается назад и сверяется по размеру и SHA256.
     */
    write(args: Record<string, unknown>, call: FileCall): Promise<FileWriteData>;
    /** Размер и SHA256 файла на сервере: файл читается потоком и в памяти не собирается. */
    private readBack;
    delete(args: Record<string, unknown>, call: FileCall): Promise<FileDeleteData>;
    /** Сбой чтения сведений о приложении означает, что сервер не дал списков папок. */
    folders(): Promise<FileFolders | undefined>;
}
