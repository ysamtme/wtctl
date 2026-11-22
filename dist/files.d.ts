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
