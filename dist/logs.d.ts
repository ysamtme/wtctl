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
/** Аргументы listLogs. */
export interface LogListInput {
    /** Имя лога без даты: xhttp, agent… */
    readonly type?: string;
    /** Часть имени файла; регистр не важен. */
    readonly nameContains?: string;
    /** Файлы не раньше этой даты сервера, ГГГГ-ММ-ДД. */
    readonly startDate?: string;
    /** Файлы не позже этой даты сервера, ГГГГ-ММ-ДД. */
    readonly endDate?: string;
    /** Сколько файлов пропустить: nextOffset прошлой страницы. */
    readonly offset?: number;
    /** Файлов на странице, 1–1000; по умолчанию 30. */
    readonly limit?: number;
}
export interface LogListData {
    readonly files: readonly LogFile[];
    readonly total: number;
    readonly nextOffset?: number;
    readonly dateSemantics: "server calendar date; timezone unspecified";
}
/** Аргументы readLog: файл и сколько читать. */
export interface LogReadInput {
    /** Имя файла лога из listLogs. */
    readonly file: string;
    /** Сколько байт с конца файла читать; по умолчанию 512 КБ. Вместе с full не задаётся. */
    readonly tailBytes?: number;
    /** Читать весь файл, а не конец. */
    readonly full?: boolean;
}
/**
 * Собственный читатель сервера отказал на файле из списка и при повторной попытке. Причину
 * сервер не называет; на стендах это бывает, пока он пишет в этот файл.
 */
export declare class LogReadUnavailableError extends HcmError {
    constructor();
}
export interface LogReadData {
    readonly file: LogFile;
    readonly text: string;
    readonly requestedMode: "full" | "tail";
    readonly requestedTailBytes?: number;
    /** Фактически переданный серверу ограниченный диапазон; может быть меньше запрошенного хвоста. */
    readonly effectiveTailBytes: number;
    readonly sizeBytesBefore: string;
    readonly sizeBytesAfter: string;
    readonly serverTailNotice: boolean;
    readonly truncated: boolean;
    readonly returnedChars: number;
    readonly fingerprint: string;
}
/**
 * Почему followLog начал заново: overlap-not-found — прошлых событий в файле не найдено,
 * file-size-decreased — файл стал короче, ambiguous-overlap — прошлое событие встречается дважды.
 */
export type LogResetReason = "overlap-not-found" | "file-size-decreased" | "ambiguous-overlap";
/** Уровень события; определяется по словам в тексте. */
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
/** Аргументы searchLogs. */
export interface LogSearchInput extends LogReadInput {
    /** Часть текста события; регистр не важен. */
    readonly text?: string;
    /** Только события этого уровня. */
    readonly level?: LogLevel;
    /** Часть потока события — текста в квадратных скобках в начале сообщения. */
    readonly context?: string;
    /** Сколько подходящих событий пропустить: nextOffset прошлой страницы. */
    readonly offset?: number;
    /** Событий на странице, 1–1000; по умолчанию 100. */
    readonly limit?: number;
    /** Сначала новейшие совпадения; offset тогда считается с конца файла. */
    readonly newestFirst?: boolean;
    /** fingerprint прошлой страницы: если файл изменился, ошибка LOG_CHANGED. */
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
}
/** Аргументы followLog. */
export interface LogFollowInput extends LogReadInput {
    /** cursor прошлого ответа; без него — события в прочитанной части файла. */
    readonly cursor?: string;
}
export interface LogFollowData {
    readonly file: LogFile;
    readonly events: readonly LogEvent[];
    readonly cursor: string;
    readonly changed: boolean;
    readonly gapPossible: boolean;
    readonly windowTruncated: boolean;
    readonly resetReason?: LogResetReason;
}
/**
 * К какому логу относится файл: его имя без даты. Собственный столбец типа на сервере
 * сводит большинство логов в одну группу, поэтому по нему их не различить.
 */
export declare function logKind(name: string): string;
/** Разбирает фактические ячейки таблицы данных от tools_report.server_log_report. */
export declare function parseLogReport(source: string): LogFile[];
/** Сохраняет строки продолжения и стеки; время остаётся текстом в местном времени сервера. */
export declare function parseLogEvents(source: string, dateHint?: string, partialBeginning?: boolean): LogEvent[];
/** Доступ к логам только удалённо: два существующих проверенных метода чтения платформы. */
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
     * Сервер держит файл лога за собой около пяти секунд после записи в него строки
     * (замер на 2025.1.1333 и 2025.2.1535) и всё это время отказывает в чтении. Владелец
     * отмечает запрос, который сервер только что отклонил, потому что в лог пишется именно отказ.
     */
    serverWroteLog(): void;
    private whileBusy;
    private allFiles;
    list(input?: LogListInput): Promise<LogListData>;
    read(input: LogReadInput): Promise<LogReadData>;
    search(input: LogSearchInput): Promise<LogSearchData>;
    follow(input: LogFollowInput): Promise<LogFollowData>;
}
