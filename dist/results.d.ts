import type { ConnectionConfig, OperationResult } from "./contracts.js";
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
export declare function writeResultFile(path: string, chunks: AsyncIterable<string> | string[], overwrite?: boolean): Promise<number>;
/**
 * Непрозрачные ID привязаны к подключению и пользователю. Опубликованные метаданные
 * указывают только на полные локальные payload.
 */
export declare class ResultStore {
    readonly config: ConnectionConfig;
    readonly directory: string;
    constructor(config: ConnectionConfig);
    path(id: string): string;
    private payload;
    export(input: ResultExportInput, envelope?: OperationResult): Promise<ResultExportData>;
    private listName;
    /** Сохраняет результат и чистит папку подключения; сбой чистки ответа не меняет. */
    put(data: unknown): Promise<{
        resultId: string;
        bytes: number;
        list?: string;
    }>;
    /**
     * Удаляет результаты старше resultsMaxAgeDays, затем самые старые сверх resultsMaxBytes.
     * Результаты моложе часа остаются: их может читать другой процесс того же подключения.
     */
    private prune;
    private write;
    read(id: string, offsetValue?: unknown, limitValue?: unknown, formatValue?: unknown): Promise<Record<string, unknown>>;
    private metadata;
    private assertSize;
    private array;
    private plain;
    private json;
    private textPage;
    /** Артефакты версии 1 читает прежний ограниченный читатель; новые ссылки — индексированная v2. */
    private legacy;
}
