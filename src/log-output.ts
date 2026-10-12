import type {
  LogEvent,
  LogFile,
  LogFollowData,
  LogListData,
  LogReadData,
  LogSearchData,
} from "./logs.js";

// What a caller gets from the log operations. The reader keeps the complete bookkeeping it
// needs for consistency checks; a result carries each fact once and no fixed remarks.
//
// A page of events is cut to a byte budget below the output limit. Past that limit the whole
// result is stored locally, and the cursor or offset needed for the next call would be hidden in it.

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
/** How many entries fit the budget, counted from the start or from the end; at least one. */
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
  // The reader's offset counts matches, so a shorter page moves the next offset back with it.
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
/** first: the call that only takes a position; earlier events are not news, a few are shown. */
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
