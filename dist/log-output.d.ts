import type { LogEvent, LogFollowData, LogListData, LogReadData, LogSearchData } from "./logs.js";
export interface LogFileSummary {
    readonly name: string;
    readonly type: string;
    readonly sizeBytes: number;
    /** Server calendar date of the file, YYYY-MM-DD. */
    readonly date?: string;
}
export interface LogFiles {
    readonly files: readonly LogFileSummary[];
    readonly total: number;
    readonly nextOffset?: number;
}
export interface LogText {
    readonly file: string;
    readonly text: string;
    readonly sizeBytes: number;
    /** The text is only the end of a longer file. Not the cut of a stored answer: that is meta.truncated. */
    readonly tailOnly: boolean;
    readonly fingerprint: string;
}
export interface LogEntry {
    readonly sequence: number;
    readonly time?: string;
    readonly context?: string;
    readonly level: LogEvent["level"];
    /** The message with its continuation lines; time and context are separate fields. */
    readonly text: string;
    readonly partialBeginning?: true;
}
export interface LogMatches {
    readonly file: string;
    readonly events: readonly LogEntry[];
    readonly totalEvents: number;
    readonly matches: number;
    readonly fingerprint: string;
    /** Only the end of the file was searched: totalEvents and matches count that part. */
    readonly tailOnly: boolean;
    readonly nextOffset?: number;
    /** The page holds fewer events than asked: more did not fit one answer. nextOffset continues. */
    readonly cutBySize?: true;
}
export interface LogNews {
    readonly file: string;
    readonly events: readonly LogEntry[];
    /** New events that did not fit; they are older than the returned ones. logs.search reads them. */
    readonly omitted?: number;
    readonly cursor: string;
    readonly changed: boolean;
    readonly gapPossible: boolean;
    readonly windowTruncated: boolean;
    readonly resetReason?: LogFollowData["resetReason"];
}
export declare function logFiles(data: LogListData): LogFiles;
export declare function logText(data: LogReadData): LogText;
export declare function logMatches(data: LogSearchData, budgetBytes: number): LogMatches;
/** first: the call that only takes a position; earlier events are not news, a few are shown. */
export declare function logNews(data: LogFollowData, first: boolean, budgetBytes: number): LogNews;
