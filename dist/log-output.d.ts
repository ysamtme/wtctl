import type { LogFollowData, LogLevel, LogListData, LogReadData, LogResetReason, LogSearchData } from "./logs.js";
/** Файл лога. */
export interface LogFileSummary {
    /** Имя файла: его принимают readLog, searchLogs и followLog. */
    readonly name: string;
    /** Имя лога без даты: xhttp, agent… */
    readonly type: string;
    /** Размер файла в байтах. */
    readonly sizeBytes: number;
    /** Календарная дата файла по времени сервера, YYYY-MM-DD. */
    readonly date?: string;
}
/** Страница логов: ответ listLogs. */
export interface LogFiles {
    /** Файлы страницы, сначала свежие. */
    readonly files: readonly LogFileSummary[];
    /** Сколько файлов подходит всего. */
    readonly total: number;
    /** offset следующей страницы; нет — страница последняя. */
    readonly nextOffset?: number;
}
/** Ответ readLog. */
export interface LogText {
    /** Имя файла. */
    readonly file: string;
    /** Текст лога. */
    readonly text: string;
    /** Размер файла в байтах. */
    readonly sizeBytes: number;
    /** Текст — только конец длинного файла. Обрезка сохранённого ответа — это meta.truncated. */
    readonly tailOnly: boolean;
    /** Отпечаток прочитанного текста. */
    readonly fingerprint: string;
}
/** Событие лога: строка с временем и продолжающие её строки. */
export interface LogEntry {
    /** Номер события в прочитанной части файла, с 1. */
    readonly sequence: number;
    /** Местное время сервера. */
    readonly time?: string;
    /** Поток: текст в квадратных скобках в начале сообщения. */
    readonly context?: string;
    /** Уровень события. */
    readonly level: LogLevel;
    /** Сообщение с продолжающими строками; время и контекст — отдельные поля. */
    readonly text: string;
    /** Начало события не попало в прочитанную часть файла. */
    readonly partialBeginning?: true;
}
/** Страница событий: ответ searchLogs. */
export interface LogMatches {
    /** Имя файла. */
    readonly file: string;
    /** Подходящие события страницы. */
    readonly events: readonly LogEntry[];
    /** Сколько событий в прочитанной части файла. */
    readonly totalEvents: number;
    /** Сколько событий подходит. */
    readonly matches: number;
    /** Отпечаток прочитанного текста: expectedFingerprint следующей страницы. */
    readonly fingerprint: string;
    /** Искался только конец файла: totalEvents и matches считают эту часть. */
    readonly tailOnly: boolean;
    /** offset следующей страницы; нет — страница последняя. */
    readonly nextOffset?: number;
    /** В странице меньше событий, чем просили: остальные не влезли в ответ. Продолжает nextOffset. */
    readonly cutBySize?: true;
}
/** Ответ followLog. */
export interface LogNews {
    /** Имя файла. */
    readonly file: string;
    /** Новые события. Последнее событие прошлого вызова может повториться. */
    readonly events: readonly LogEntry[];
    /** Новые события, которые не уместились; они старше возвращённых. Читает logs.search. */
    readonly omitted?: number;
    /** cursor следующего вызова; после ошибки чтения передать прежний. */
    readonly cursor: string;
    /** Файл изменился с прошлого вызова. */
    readonly changed: boolean;
    /** Часть событий могла быть пропущена; причина — в resetReason. */
    readonly gapPossible: boolean;
    /** Прочитан только конец файла. */
    readonly windowTruncated: boolean;
    /** Почему чтение началось заново. */
    readonly resetReason?: LogResetReason;
}
export declare function logFiles(data: LogListData): LogFiles;
export declare function logText(data: LogReadData): LogText;
export declare function logMatches(data: LogSearchData, budgetBytes: number): LogMatches;
/** first: вызов, который только берёт позицию; прежние события — не новости, часть показывается. */
export declare function logNews(data: LogFollowData, first: boolean, budgetBytes: number): LogNews;
