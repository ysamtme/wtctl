import { HcmError } from "./errors.js";
import type { ServerPort } from "./hcm-server.js";
export type LogGateway = ServerPort;
export interface LogFile {
    readonly name: string;
    readonly url: string;
    readonly title: string;
    readonly type: string;
    readonly sizeBytes: string;
    readonly dateLabel: string;
    readonly dateHint?: string;
    readonly rawDateSeconds?: string;
    readonly redFlag: boolean;
}
export interface LogListInput {
    readonly type?: string;
    readonly nameContains?: string;
    readonly startDate?: string;
    readonly endDate?: string;
    readonly offset?: number;
    readonly limit?: number;
}
export interface LogListData {
    readonly files: readonly LogFile[];
    readonly total: number;
    readonly nextOffset?: number;
    readonly dateSemantics: "server calendar date; timezone unspecified";
}
export interface LogReadInput {
    readonly file: string;
    readonly tailBytes?: number;
    readonly full?: boolean;
}
/**
 * The server's own reader refused a listed file, also on the repeated attempt. The server gives
 * no reason; on the stands this happens while it is writing to that file.
 */
export declare class LogReadUnavailableError extends HcmError {
    constructor();
}
export interface LogReadData {
    readonly file: LogFile;
    readonly text: string;
    readonly requestedMode: "full" | "tail";
    readonly requestedTailBytes?: number;
    /** Actual bounded range passed to the server; it can be smaller than the requested tail. */
    readonly effectiveTailBytes: number;
    readonly sizeBytesBefore: string;
    readonly sizeBytesAfter: string;
    readonly serverTailNotice: boolean;
    readonly truncated: boolean;
    readonly returnedChars: number;
    readonly fingerprint: string;
    readonly semantics: "server RPC text; byte offsets and original encoding are not preserved";
    readonly consistency: "file size checked before and after; full reads also compare available date metadata; no atomic snapshot or same-size rewrite guarantee" | "empty file reported before and after; zero range does not open file or flush pending log writes";
}
export type LogLevel = "normal" | "debug" | "info" | "warning" | "error" | "critical";
export interface LogEvent {
    readonly sequence: number;
    readonly time?: string;
    readonly dateHint?: string;
    readonly context?: string;
    readonly level: LogLevel;
    readonly message: string;
    readonly text: string;
    readonly lineStart: number;
    readonly lineEnd: number;
    readonly partialBeginning?: boolean;
}
export interface LogSearchInput extends LogReadInput {
    readonly text?: string;
    readonly level?: LogLevel;
    readonly context?: string;
    readonly offset?: number;
    readonly limit?: number;
    /** Latest matches first; offset then counts from the end of the file. */
    readonly newestFirst?: boolean;
    readonly expectedFingerprint?: string;
}
export interface LogSearchData {
    readonly file: LogFile;
    readonly events: readonly LogEvent[];
    readonly totalEvents: number;
    readonly matches: number;
    readonly fingerprint: string;
    readonly truncated: boolean;
    readonly nextOffset?: number;
    readonly severityDetection: "text heuristic";
    readonly lineNumbers: "relative to fetched text";
}
export interface LogFollowInput extends LogReadInput {
    readonly cursor?: string;
}
export interface LogFollowData {
    readonly file: LogFile;
    readonly events: readonly LogEvent[];
    readonly cursor: string;
    readonly changed: boolean;
    readonly gapPossible: boolean;
    readonly windowTruncated: boolean;
    readonly resetReason?: "overlap-not-found" | "file-size-decreased" | "ambiguous-overlap";
    readonly semantics: "tail overlap; updated final events may be repeated; no byte cursor or exactly-once guarantee";
}
/**
 * Which log a file belongs to: its name without the date. The server's own type column puts most
 * logs into one group, so it does not tell them apart.
 */
export declare function logKind(name: string): string;
/** Parse the actual table-data cells returned by tools_report.server_log_report. */
export declare function parseLogReport(source: string): LogFile[];
/** Preserve continuation lines and stack traces; timestamps stay in server-local text. */
export declare function parseLogEvents(source: string, dateHint?: string, partialBeginning?: boolean): LogEvent[];
/** Remote-only log access through two existing, audited read-only platform methods. */
export declare class LogReader {
    private readonly gateway;
    private readonly maxTailBytes;
    private readonly busyMs;
    private busyUntil;
    constructor(gateway: LogGateway, options: {
        readonly maxResponseBytes: number;
        readonly logBusyMs?: number;
    });
    /**
     * The server keeps a log file to itself for about five seconds after writing a line to it
     * (measured on 2025.1.1333 and 2025.2.1535) and refuses to read it meanwhile. The owner reports
     * a request the server has just refused, since the refusal is what gets written.
     */
    serverWroteLog(): void;
    private whileBusy;
    private allFiles;
    list(input?: LogListInput): Promise<LogListData>;
    read(input: LogReadInput): Promise<LogReadData>;
    search(input: LogSearchInput): Promise<LogSearchData>;
    follow(input: LogFollowInput): Promise<LogFollowData>;
}
