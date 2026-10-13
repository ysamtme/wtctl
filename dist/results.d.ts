import type { ConnectionConfig, OperationResult } from "./contracts.js";
export interface ResultExportInput {
    resultId: string;
    path: string;
    format?: "json" | "jsonl" | "text";
    overwrite?: boolean;
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
    export(input: ResultExportInput, envelope?: OperationResult): Promise<{
        items?: number;
        path: string;
        bytes: number;
        format: "text" | "json" | "jsonl";
    }>;
    private listName;
    put(data: unknown): Promise<{
        resultId: string;
        bytes: number;
        list?: string;
    }>;
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
