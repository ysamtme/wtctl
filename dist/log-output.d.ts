import type { LogEvent, LogFollowData, LogListData, LogReadData, LogSearchData } from "./logs.js";
export interface LogFileSummary {
    readonly name: string;
    readonly type: string;
    readonly sizeBytes: number;
    /** Календарная дата файла по времени сервера, YYYY-MM-DD. */
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
    /** Текст — только конец длинного файла. Обрезка сохранённого ответа — это meta.truncated. */
    readonly tailOnly: boolean;
    readonly fingerprint: string;
}
export interface LogEntry {
    readonly sequence: number;
    readonly time?: string;
    readonly context?: string;
    readonly level: LogEvent["level"];
    /** Сообщение с продолжающими строками; время и контекст — отдельные поля. */
    readonly text: string;
    readonly partialBeginning?: true;
}
export interface LogMatches {
    readonly file: string;
    readonly events: readonly LogEntry[];
    readonly totalEvents: number;
    readonly matches: number;
    readonly fingerprint: string;
    /** Искался только конец файла: totalEvents и matches считают эту часть. */
    readonly tailOnly: boolean;
    readonly nextOffset?: number;
    /** В странице меньше событий, чем просили: остальные не влезли в ответ. Продолжает nextOffset. */
    readonly cutBySize?: true;
}
export interface LogNews {
    readonly file: string;
    readonly events: readonly LogEntry[];
    /** Новые события, которые не уместились; они старше возвращённых. Читает logs.search. */
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
/** first: вызов, который только берёт позицию; прежние события — не новости, часть показывается. */
export declare function logNews(data: LogFollowData, first: boolean, budgetBytes: number): LogNews;
