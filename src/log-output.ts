import type {
  LogEvent,
  LogFile,
  LogFollowData,
  LogListData,
  LogReadData,
  LogSearchData,
} from "./logs.js";

// То, что вызывающий получает от операций с логами. Читатель хранит полный учёт, нужный
// для проверок согласованности; результат несёт каждый факт один раз и без постоянных замечаний.
//
// Страница событий режется по бюджету в байтах ниже предела вывода. За пределом весь результат
// сохраняется локально, и курсор или смещение для следующего вызова оказались бы спрятаны в нём.

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

function summary(file: LogFile): LogFileSummary {
  return {
    name: file.name,
    type: file.type,
    sizeBytes: Number(file.sizeBytes),
    ...(file.dateHint === undefined ? {} : { date: file.dateHint }),
  };
}
function entry(event: LogEvent): LogEntry {
  return {
    sequence: event.sequence,
    ...(event.time === undefined ? {} : { time: event.time }),
    ...(event.context === undefined ? {} : { context: event.context }),
    level: event.level,
    text: [event.message, ...event.text.split("\n").slice(1)].join("\n"),
    ...(event.partialBeginning ? { partialBeginning: true as const } : {}),
  };
}

export function logFiles(data: LogListData): LogFiles {
  return {
    files: data.files.map(summary),
    total: data.total,
    ...(data.nextOffset === undefined ? {} : { nextOffset: data.nextOffset }),
  };
}
export function logText(data: LogReadData): LogText {
  return {
    file: data.file.name,
    text: data.text,
    sizeBytes: Number(data.sizeBytesAfter),
    tailOnly: data.truncated,
    fingerprint: data.fingerprint,
  };
}
/** Сколько записей умещается в бюджет, считая с начала или с конца; не меньше одной. */
function fitting(entries: readonly LogEntry[], budgetBytes: number, fromEnd: boolean): number {
  let bytes = 0;
  let count = 0;
  for (let index = 0; index < entries.length; index++) {
    const item = entries[fromEnd ? entries.length - 1 - index : index];
    bytes += Buffer.byteLength(JSON.stringify(item)) + 1;
    if (bytes > budgetBytes && count > 0) break;
    count++;
  }
  return count;
}

export function logMatches(data: LogSearchData, budgetBytes: number): LogMatches {
  const events = data.events.map(entry);
  const kept = fitting(events, budgetBytes, false);
  // Смещение читателя считает совпадения: короткая страница сдвигает следующее смещение назад.
  const offset = (data.nextOffset ?? data.matches) - events.length;
  const nextOffset = kept < events.length ? offset + kept : data.nextOffset;
  return {
    file: data.file.name,
    events: events.slice(0, kept),
    totalEvents: data.totalEvents,
    matches: data.matches,
    fingerprint: data.fingerprint,
    tailOnly: data.truncated,
    ...(nextOffset === undefined ? {} : { nextOffset }),
    ...(kept < events.length ? { cutBySize: true as const } : {}),
  };
}
/** first: вызов, который только берёт позицию; прежние события — не новости, часть показывается. */
export function logNews(data: LogFollowData, first: boolean, budgetBytes: number): LogNews {
  const all = data.events.map(entry);
  const recent = first ? all.slice(-10) : all;
  const events = recent.slice(recent.length - fitting(recent, budgetBytes, true));
  const omitted = first ? 0 : all.length - events.length;
  return {
    file: data.file.name,
    events,
    ...(omitted ? { omitted } : {}),
    cursor: data.cursor,
    changed: data.changed,
    gapPossible: data.gapPossible,
    windowTruncated: data.windowTruncated,
    ...(data.resetReason === undefined ? {} : { resetReason: data.resetReason }),
  };
}
