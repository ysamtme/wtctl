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
/** Fixed probes retain neither server payloads nor error messages in the report. */
export declare function checkServer(config: ConnectionConfig, invoke: Invoke): Promise<CheckData>;
export {};
