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
/** Аргументы readLog: файл и сколько читать. */
export interface LogReadInput {
    /** Имя файла лога из listLogs. */
    readonly file: string;
    /** Сколько байт с конца файла читать; по умолчанию: у readLog — сколько помещается в ответ, у searchLogs и followLog — до 512 КБ. Вместе с full не задаётся. */
    readonly tailBytes?: number;
    /** Читать весь файл, а не конец. */
    readonly full?: boolean;
}
/**
 * Почему followLog начал заново: overlap-not-found — прошлых событий в файле не найдено,
 * file-size-decreased — файл стал короче, ambiguous-overlap — прошлое событие встречается дважды.
 */
export type LogResetReason = "overlap-not-found" | "file-size-decreased" | "ambiguous-overlap";
/** Уровень события; определяется по словам в тексте. */
export type LogLevel = "normal" | "debug" | "info" | "warning" | "error" | "critical";
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
/** Аргументы followLog. */
export interface LogFollowInput extends LogReadInput {
    /** cursor прошлого ответа; без него — последние 10 событий и новый cursor. */
    readonly cursor?: string;
}
