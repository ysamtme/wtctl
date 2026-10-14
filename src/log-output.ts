import type {
  LogEvent,
  LogFile,
  LogFollowData,
  LogLevel,
  LogListData,
  LogReadData,
  LogResetReason,
  LogSearchData,
} from "./logs.js";

// То, что вызывающий получает от операций с логами. Читатель хранит полный учёт, нужный
// для проверок согласованности; результат несёт каждый факт один раз и без постоянных замечаний.
//
// Страница событий режется по бюджету в байтах ниже предела вывода. За пределом весь результат
// сохраняется локально, и курсор или смещение для следующего вызова оказались бы спрятаны в нём.

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
