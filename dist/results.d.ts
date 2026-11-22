/** Аргументы exportResult. */
export interface ResultExportInput {
    /** ID сохранённого результата: meta.resultId ответа. */
    readonly resultId: string;
    /** Путь к файлу на этом компьютере; папка должна быть, иначе FOLDER_NOT_FOUND. */
    readonly path: string;
    /**
     * json — ответ целиком одним JSON (по умолчанию); jsonl — элементы списка, по строке на элемент;
     * text — сохранённый текст как есть.
     */
    readonly format?: "json" | "jsonl" | "text";
    /** Заменить файл, если он уже есть; иначе FILE_EXISTS. */
    readonly overwrite?: boolean;
}
/** Ответ exportResult. */
export interface ResultExportData {
    /** Путь к файлу, как передан. */
    readonly path: string;
    /** Размер файла в байтах. */
    readonly bytes: number;
    /** Формат записи. */
    readonly format: "json" | "jsonl" | "text";
    /** Сколько элементов записано; только у jsonl. */
    readonly items?: number;
}
