import type { ConnectionConfig } from "./contracts.js";
export interface CheckData {
    version?: string;
    language?: string;
    permissions: ConnectionConfig["permissions"];
    checks: {
        name: string;
        result: "ok" | "failed" | "skipped";
        reason?: string;
    }[];
    summary: {
        ok: number;
        failed: number;
        skipped: number;
    };
}
type Invoke = (id: string, args: Record<string, unknown>) => Promise<unknown>;
/** Фиксированные пробы не сохраняют в отчёте ни payload сервера, ни тексты ошибок. */
export declare function checkServer(config: ConnectionConfig, invoke: Invoke): Promise<CheckData>;
export {};
