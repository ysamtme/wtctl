import type { ConnectionConfig } from "./contracts.js";
/** Ответ check: шаги проверки и их итог. */
export interface CheckData {
    /** Версия сервера, если шаг version прошёл. */
    version?: string;
    /** Язык интерфейса сервера: ru, en… */
    language?: string;
    /** Права подключения. */
    permissions: ConnectionConfig["permissions"];
    /** Шаги проверки по порядку. */
    checks: {
        /** Шаг: login, version, query, document, schema, titles, libraries, logs, portal, execute. */
        name: string;
        /** ok — прошёл, failed — не прошёл, skipped — не выполнялся. */
        result: "ok" | "failed" | "skipped";
        /** Почему шаг не прошёл или пропущен. */
        reason?: string;
    }[];
    /** Сколько шагов в каждом исходе. */
    summary: {
        /** Прошли. */
        ok: number;
        /** Не прошли. */
        failed: number;
        /** Пропущены. */
        skipped: number;
    };
}
type Invoke = (id: string, args: Record<string, unknown>) => Promise<unknown>;
/** Фиксированные пробы не сохраняют в отчёте ни payload сервера, ни тексты ошибок. */
export declare function checkServer(config: ConnectionConfig, invoke: Invoke): Promise<CheckData>;
export {};
