import type { OperationResult } from "../../contracts.js";
import { buildXml, findXmlNode, type XmlObject } from "../../protocol/xml.js";
import { rpcValue } from "../../server-value.js";
import type { Styler } from "./ansi.js";
import { tabularCellText } from "./csv.js";
import { renderTable, type TableColumn } from "./table.js";

export interface HumanRenderOptions {
  readonly columns?: number;
  readonly styler: Styler;
  readonly quiet?: boolean;
  readonly requestedFields?: readonly string[];
  readonly requestArgs?: Readonly<Record<string, unknown>>;
  readonly connectionArg?: string;
}

export interface HumanRenderResult {
  readonly text: string;
  readonly stderrNote?: string;
}

export interface ExtractedTable {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly unknown[])[];
}

export type RawRenderResult =
  | { readonly kind: "text"; readonly text: string; readonly stderrNote?: string }
  | { readonly kind: "binary"; readonly bytes: Uint8Array };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function compactJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    typeof item === "bigint" ? item.toString(10) : item,
  );
}

function ensureNewline(text: string): string {
  if (!text) return "";
  return text.endsWith("\n") ? text : `${text}\n`;
}

/** Читаемый размер в байтах / КиБ / МиБ / ГиБ для вывода в терминале. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return `${bytes} Б`;
  if (bytes < 1024) return `${Math.round(bytes)} Б`;
  const kib = bytes / 1024;
  if (kib < 1024)
    return `${kib >= 100 || Number.isInteger(kib) ? Math.round(kib) : kib.toFixed(1)} КиБ`;
  const mib = kib / 1024;
  if (mib < 1024)
    return `${mib >= 100 || Number.isInteger(mib) ? Math.round(mib) : mib.toFixed(1)} МиБ`;
  return `${(mib / 1024).toFixed(2)} ГиБ`;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0 мс";
  if (ms < 1000) return `${Math.round(ms)} мс`;
  return `${(ms / 1000).toFixed(2)} с`;
}

/** Вычисляет длительность интервала по паре локальных отметок сервера YYYY-MM-DDTHH:MM:SS. */
function formatIsoIntervalDuration(startedAt: string, finishedAt: string): string | undefined {
  const parse = (value: string): number | undefined => {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(value.trim());
    if (!match) return undefined;
    const ms = Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6]),
    );
    return Number.isNaN(ms) ? undefined : ms;
  };
  const start = parse(startedAt);
  const end = parse(finishedAt);
  if (start === undefined || end === undefined || end < start) return undefined;
  const totalSec = Math.round((end - start) / 1000);
  if (totalSec < 60) return `${totalSec} с`;
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} ч`);
  if (minutes > 0) parts.push(`${minutes} мин`);
  if (seconds > 0) parts.push(`${seconds} с`);
  return parts.join(" ");
}

/** Нормализует поле Task ответа web.spxml.getBackgroundTasksByName: undefined | объект | массив. */
export function normalizeBackgroundTasks(data: unknown): Record<string, unknown>[] {
  if (!isRecord(data)) return [];
  const raw = data.Task;
  if (raw === undefined || raw === null || raw === "") return [];
  if (Array.isArray(raw)) return raw.filter(isRecord);
  return isRecord(raw) ? [raw] : [];
}

function parseTaskState(task: Record<string, unknown>): {
  readonly running: boolean;
  readonly finished: boolean;
  readonly errCode?: string;
  readonly errText?: string;
  readonly hasError: boolean;
} {
  const running = task.IsRunning === "1" || task.IsRunning === 1 || task.IsRunning === true;
  const finished = task.IsRunning === "0" || task.IsRunning === 0 || task.IsRunning === false;
  const errText =
    typeof task.ErrorText === "string" && task.ErrorText.trim() !== ""
      ? task.ErrorText.trim()
      : undefined;
  const errCode =
    task.ErrorCode !== undefined &&
    String(task.ErrorCode).trim() !== "" &&
    String(task.ErrorCode).trim() !== "0"
      ? String(task.ErrorCode).trim()
      : undefined;
  return {
    running,
    finished,
    ...(errCode === undefined ? {} : { errCode }),
    ...(errText === undefined ? {} : { errText }),
    hasError: errText !== undefined || errCode !== undefined,
  };
}

function summarizeTaskDetails(task: Record<string, unknown>): string {
  const { errCode, errText } = parseTaskState(task);
  if (errText || errCode) {
    return errCode && errText
      ? `Ошибка [${errCode}]: ${errText}`
      : errText
        ? `Ошибка: ${errText}`
        : `Код ошибки: ${errCode}`;
  }
  if (task.Progress !== undefined && task.Progress !== null && task.Progress !== "") {
    return formatInline(task.Progress);
  }
  if ("value" in task && task.value !== undefined) {
    return formatInline(task.value);
  }
  if (task.ResultData !== undefined && task.ResultData !== null && task.ResultData !== "") {
    try {
      const decoded = rpcValue({ ResultData: task.ResultData });
      if (isRecord(decoded) && "value" in decoded) return formatInline(decoded.value);
    } catch {
      // Оставляем исходную структуру ResultData ниже.
    }
    return formatInline(task.ResultData);
  }
  return "";
}

function formatPermissions(permissions: unknown): string {
  if (!isRecord(permissions)) return "read";
  const list = ["read"];
  if (permissions.write === true) list.push("write");
  if (permissions.execute === true) list.push("execute");
  return list.join(", ");
}

function formatInline(value: unknown): string {
  if (value === undefined) return "—";
  if (value === null) return "null";
  if (typeof value === "string") return value === "" ? '""' : value.replace(/\r?\n/g, "\\n");
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint")
    return String(value);
  return compactJson(value);
}

function renderCard(entries: readonly (readonly [string, string])[], styler: Styler): string {
  const nonEmpty = entries.filter(([, value]) => value !== "");
  if (!nonEmpty.length) return "";
  const labelWidth = Math.max(...nonEmpty.map(([label]) => label.length)) + 1;
  return nonEmpty
    .map(([label, value]) => `${styler.dim(`${label}:`.padEnd(labelWidth))}  ${value}`)
    .join("\n");
}

function dimLine(styler: Styler, ...parts: readonly (string | undefined)[]): string {
  return styler.dim(parts.filter(Boolean).join(" · "));
}

function renderExtractedTable(
  table: ExtractedTable,
  options: { readonly maxWidth?: number; readonly styler: Styler },
): string {
  const cols: TableColumn[] = table.headers.map((header) => ({ header }));
  const rows = table.rows.map((row) => row.map((cell) => tabularCellText(cell)));
  return renderTable(cols, rows, options);
}

function rawLines(
  items: readonly unknown[],
  pick: (record: Record<string, unknown>) => string,
): RawRenderResult {
  const lines = items.map((item) => (isRecord(item) ? pick(item) : ""));
  return { kind: "text", text: lines.length ? `${lines.join("\n")}\n` : "" };
}

/** Читаемое YAML-подобное дерево для объектов и произвольных ответов api call. */
export function renderStructured(value: unknown, styler: Styler, indent = 0, depth = 0): string {
  const pad = " ".repeat(indent);
  if (depth > 16) return `${pad}${compactJson(value)}`;
  if (value === null || value === undefined) return `${pad}${styler.dim("null")}`;
  if (typeof value === "boolean")
    return `${pad}${value ? styler.green("true") : styler.yellow("false")}`;
  if (typeof value === "number" || typeof value === "bigint")
    return `${pad}${styler.cyan(String(value))}`;
  if (typeof value === "string") {
    if (value === "") return `${pad}${styler.dim('""')}`;
    if (value.includes("\n")) {
      return value
        .split(/\r?\n/)
        .map((line) => `${pad}${line}`)
        .join("\n");
    }
    return `${pad}${value}`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}${styler.dim("[]")}`;
    const allShortPrimitives =
      value.length <= 6 &&
      value.every(
        (item) =>
          item === null ||
          typeof item === "boolean" ||
          typeof item === "number" ||
          (typeof item === "string" && !item.includes("\n") && item.length <= 32),
      );
    if (allShortPrimitives) {
      const joined = value.map((item) => formatInline(item)).join(", ");
      if (joined.length <= 72) return `${pad}[${joined}]`;
    }
    return value
      .map((item) => {
        if (isRecord(item) && Object.keys(item).length > 0) {
          const nested = renderStructured(item, styler, indent + 2, depth + 1);
          return `${pad}- ${nested.slice(indent + 2)}`;
        }
        if (Array.isArray(item) && item.length > 0) {
          return `${pad}-\n${renderStructured(item, styler, indent + 2, depth + 1)}`;
        }
        return `${pad}- ${renderStructured(item, styler, 0, depth + 1)}`;
      })
      .join("\n");
  }
  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return `${pad}${styler.dim("{}")}`;
    const lines: string[] = [];
    for (const [key, child] of entries) {
      const label = styler.dim(`${key}:`);
      if (
        child === null ||
        child === undefined ||
        typeof child === "boolean" ||
        typeof child === "number" ||
        typeof child === "bigint" ||
        (typeof child === "string" && !child.includes("\n"))
      ) {
        lines.push(`${pad}${label} ${renderStructured(child, styler, 0, depth + 1)}`);
      } else if (typeof child === "string") {
        lines.push(`${pad}${label}`);
        for (const line of child.split(/\r?\n/)) lines.push(`${pad}  ${line}`);
      } else if (Array.isArray(child) && child.length === 0) {
        lines.push(`${pad}${label} ${styler.dim("[]")}`);
      } else if (isRecord(child) && Object.keys(child).length === 0) {
        lines.push(`${pad}${label} ${styler.dim("{}")}`);
      } else {
        const inlineArr =
          Array.isArray(child) &&
          child.length <= 6 &&
          child.every(
            (item) =>
              item === null ||
              typeof item === "boolean" ||
              typeof item === "number" ||
              (typeof item === "string" && !item.includes("\n") && item.length <= 32),
          )
            ? child.map((item) => formatInline(item)).join(", ")
            : undefined;
        if (inlineArr !== undefined && inlineArr.length <= 72) {
          lines.push(`${pad}${label} [${inlineArr}]`);
        } else {
          lines.push(`${pad}${label}`);
          lines.push(renderStructured(child, styler, indent + 2, depth + 1));
        }
      }
    }
    return lines.join("\n");
  }
  return `${pad}${String(value)}`;
}

/** Собирает ключи массива плоских объектов в порядке первого появления; undefined, если это не массив объектов. */
export function collectObjectKeys(items: readonly unknown[]): string[] | undefined {
  if (items.length === 0) return [];
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (!isRecord(item)) return undefined;
    for (const key of Object.keys(item)) {
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  }
  return keys.length > 0 ? keys : undefined;
}

/** Извлекает XML из ответа native.lds.loadDoc (объект Data / m:Data, строка или двоичный ответ). */
export function extractDocXml(data: unknown): string | undefined {
  if (typeof data === "string") return data;
  if (!isRecord(data)) return undefined;
  const docNode = data.Data !== undefined ? data.Data : findXmlNode(data as XmlObject, "Data");
  if (typeof docNode === "string") return docNode;
  if (isRecord(docNode)) {
    const keys = Object.keys(docNode).filter(
      (key) => !key.startsWith("@_") && !key.startsWith("#") && !key.startsWith("?"),
    );
    if (keys.length > 0) {
      try {
        return buildXml(docNode as XmlObject);
      } catch {
        return undefined;
      }
    }
  }
  if (data.kind === "binary" && isRecord(data.bytes) && typeof data.bytes.base64 === "string") {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(
        Buffer.from(data.bytes.base64, "base64"),
      );
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** Преобразует элементы objects.get --ids в плоские строки для таблицы/CSV/TSV. */
function flattenManyObjects(items: readonly unknown[]): ExtractedTable {
  const fieldKeys: string[] = [];
  const seenFields = new Set<string>();
  let hasError = false;
  for (const item of items) {
    if (!isRecord(item)) continue;
    if (isRecord(item.error)) hasError = true;
    for (const source of [item.data, item.fromCatalog]) {
      if (!isRecord(source)) continue;
      for (const key of Object.keys(source)) {
        if (!seenFields.has(key)) {
          seenFields.add(key);
          fieldKeys.push(key);
        }
      }
    }
  }
  const extraFields = fieldKeys.filter((key) => key !== "id" && key !== "type");
  let errorHeader: string | undefined;
  if (hasError) {
    errorHeader = "error";
    while (seenFields.has(errorHeader)) errorHeader = `_${errorHeader}`;
  }
  const headers = [
    "id",
    "type",
    ...extraFields,
    ...(errorHeader === undefined ? [] : [errorHeader]),
  ];
  const rows = items.map((raw) => {
    if (!isRecord(raw)) return headers.map(() => "");
    const docData = isRecord(raw.data) ? raw.data : {};
    const catalogData = isRecord(raw.fromCatalog) ? raw.fromCatalog : {};
    const err = isRecord(raw.error)
      ? `${String(raw.error.code ?? "")}: ${String(raw.error.message ?? "")}`
      : "";
    return headers.map((header) => {
      if (header === "id") return raw.id ?? (Object.hasOwn(docData, "id") ? docData.id : "");
      if (header === "type")
        return raw.type ?? (Object.hasOwn(docData, "type") ? docData.type : "");
      if (errorHeader !== undefined && header === errorHeader) return err;
      if (Object.hasOwn(docData, header)) return docData[header];
      if (Object.hasOwn(catalogData, header)) return catalogData[header];
      return "";
    });
  });
  return { headers, rows };
}

/** Извлекает табличное представление ответа для csv / tsv; undefined для нетабличной операции. */
export function extractTable(
  operationId: string,
  data: unknown,
  requestedFields?: readonly string[],
): ExtractedTable | undefined {
  if (operationId === "runtime.query" && isRecord(data) && Array.isArray(data.items)) {
    const ordered = requestedFields?.length
      ? [...new Set(requestedFields)]
      : collectObjectKeys(data.items);
    if (ordered === undefined) {
      // Массив пустых объектов {} без запрошенных полей: таблица пуста, а не ошибка формата.
      if (data.items.every((item) => isRecord(item))) return { headers: [], rows: [] };
      return undefined;
    }
    const keys = [...ordered];
    const seen = new Set(keys);
    for (const item of data.items) {
      if (!isRecord(item)) return undefined;
      for (const key of Object.keys(item)) {
        if (!seen.has(key)) {
          seen.add(key);
          keys.push(key);
        }
      }
    }
    return {
      headers: keys,
      rows: data.items.map((item) => {
        const record = item as Record<string, unknown>;
        return keys.map((key) => (Object.hasOwn(record, key) ? record[key] : ""));
      }),
    };
  }
  if (operationId === "schema.types" && isRecord(data) && Array.isArray(data.types)) {
    const headers = ["type", "catalog", "title", "customFields"];
    return {
      headers,
      rows: data.types.map((item) => {
        const record = isRecord(item) ? item : {};
        return [
          record.type ?? "",
          record.catalog ?? "",
          record.title ?? "",
          record.customFields ?? "",
        ];
      }),
    };
  }
  if (operationId === "schema.get" && isRecord(data) && Array.isArray(data.fields)) {
    const headers = [
      "path",
      "type",
      "origin",
      "title",
      "references",
      "query",
      "computed",
      "required",
      "multiple",
    ];
    return {
      headers,
      rows: data.fields.map((item) => {
        const r = isRecord(item) ? item : {};
        return [
          r.path ?? "",
          r.type ?? "",
          r.origin ?? "",
          r.title ?? "",
          r.references ?? "",
          r.query === true ? "true" : "",
          r.computed === true ? "true" : "",
          r.required === true ? "true" : "",
          r.multiple === true ? "true" : "",
        ];
      }),
    };
  }
  if (operationId === "logs.list" && isRecord(data) && Array.isArray(data.files)) {
    return {
      headers: ["name", "type", "date", "sizeBytes"],
      rows: data.files.map((item) => {
        const r = isRecord(item) ? item : {};
        return [r.name ?? "", r.type ?? "", r.date ?? "", r.sizeBytes ?? ""];
      }),
    };
  }
  if (operationId === "files.list" && isRecord(data) && Array.isArray(data.items)) {
    return {
      headers: ["name", "type", "bytes"],
      rows: data.items.map((item) => {
        const r = isRecord(item) ? item : {};
        return [
          r.name ?? "",
          r.folder === true ? "folder" : "file",
          r.folder === true ? "" : (r.bytes ?? ""),
        ];
      }),
    };
  }
  if (operationId === "rpc.list" && isRecord(data) && Array.isArray(data.targets)) {
    return {
      headers: ["id", "parameters", "allowed", "serverOnly"],
      rows: data.targets.map((item) => {
        const r = isRecord(item) ? item : {};
        return [
          r.id ?? "",
          r.parameters ?? [],
          r.allowed ?? "",
          r.serverOnly === true ? "true" : "",
        ];
      }),
    };
  }
  if (operationId === "cli.config.list" && isRecord(data) && Array.isArray(data.connections)) {
    return {
      headers: ["name", "default", "baseUrl", "write", "execute", "username", "password"],
      rows: data.connections.map((item) => {
        const r = isRecord(item) ? item : {};
        const perm = isRecord(r.permissions) ? r.permissions : {};
        const cred = isRecord(r.credentials) ? r.credentials : {};
        return [
          r.name ?? "",
          r.default === true,
          r.baseUrl ?? "",
          perm.write === true,
          perm.execute === true,
          cred.username === "env" && cred.usernameEnv
            ? `env:${String(cred.usernameEnv)}`
            : (cred.username ?? ""),
          cred.password === "env" && cred.passwordEnv
            ? `env:${String(cred.passwordEnv)}`
            : (cred.password ?? ""),
        ];
      }),
    };
  }
  if (operationId === "api.list" && isRecord(data)) {
    if (Array.isArray(data.topics)) {
      return {
        headers: ["topic", "title", "operations", "count"],
        rows: data.topics.map((item) => {
          const r = isRecord(item) ? item : {};
          return [r.topic ?? "", r.title ?? "", r.operations ?? "", r.count ?? ""];
        }),
      };
    }
    if (Array.isArray(data.operations)) {
      return {
        headers: ["id", "topic", "effect", "description"],
        rows: data.operations.map((item) => {
          const r = isRecord(item) ? item : {};
          return [r.id ?? "", r.topic ?? "", r.effect ?? "", r.description ?? ""];
        }),
      };
    }
  }
  if (operationId === "objects.get" && isRecord(data) && Array.isArray(data.items)) {
    return flattenManyObjects(data.items);
  }
  if (operationId === "execute.script" && isRecord(data) && Array.isArray(data.result)) {
    if (data.result.length === 0) return { headers: [], rows: [] };
    const keys = collectObjectKeys(data.result);
    if (keys === undefined) {
      return { headers: ["value"], rows: data.result.map((item) => [item]) };
    }
    return {
      headers: keys,
      rows: data.result.map((item) => {
        const record = item as Record<string, unknown>;
        return keys.map((key) => (Object.hasOwn(record, key) ? record[key] : ""));
      }),
    };
  }
  if (operationId === "results.read" && isRecord(data)) {
    if (Array.isArray(data.items)) {
      if (data.items.length === 0) return { headers: [], rows: [] };
      const keys = collectObjectKeys(data.items);
      if (keys === undefined) {
        return { headers: ["value"], rows: data.items.map((item) => [item]) };
      }
      return {
        headers: keys,
        rows: data.items.map((item) => {
          const record = item as Record<string, unknown>;
          return keys.map((key) => (Object.hasOwn(record, key) ? record[key] : ""));
        }),
      };
    }
    if (typeof data.text === "string") return { headers: ["text"], rows: [[data.text]] };
  }
  if (
    (operationId === "logs.search" || operationId === "logs.follow") &&
    isRecord(data) &&
    Array.isArray(data.events)
  ) {
    return {
      headers: ["sequence", "time", "context", "level", "text"],
      rows: data.events.map((item) => {
        const r = isRecord(item) ? item : {};
        return [r.sequence ?? "", r.time ?? "", r.context ?? "", r.level ?? "", r.text ?? ""];
      }),
    };
  }
  if (operationId === "agents.status" && isRecord(data) && Array.isArray(data.runs)) {
    return {
      headers: ["id", "code", "name", "status", "threadId", "roleUID", "startedAt", "finishedAt"],
      rows: data.runs.map((item) => {
        const r = isRecord(item) ? item : {};
        return [
          r.id ?? "",
          r.code ?? "",
          r.name ?? "",
          r.status ?? "",
          r.threadId ?? "",
          r.roleUID ?? "",
          r.startedAt ?? "",
          r.finishedAt ?? "",
        ];
      }),
    };
  }
  if (operationId === "web.spxml.getBackgroundTasksByName") {
    const tasks = normalizeBackgroundTasks(data);
    return {
      headers: [
        "TrackingID",
        "IsRunning",
        "StartDate",
        "Progress",
        "ErrorCode",
        "ErrorText",
        "ResultData",
      ],
      rows: tasks.map((task) => [
        task.TrackingID ?? "",
        task.IsRunning ?? "",
        task.StartDate ?? "",
        task.Progress ?? "",
        task.ErrorCode ?? "",
        task.ErrorText ?? "",
        task.ResultData ?? "",
      ]),
    };
  }
  if (operationId === "runtime.check" && isRecord(data) && Array.isArray(data.checks)) {
    return {
      headers: ["name", "result", "reason"],
      rows: data.checks.map((item) => {
        const r = isRecord(item) ? item : {};
        return [r.name ?? "", r.result ?? "", r.reason ?? ""];
      }),
    };
  }
  if (Array.isArray(data)) {
    const keys = collectObjectKeys(data);
    if (keys !== undefined && keys.length > 0) {
      return {
        headers: keys,
        rows: data.map((item) => {
          const record = item as Record<string, unknown>;
          return keys.map((key) => record[key]);
        }),
      };
    }
  }
  return undefined;
}

export interface FixedTabularStreamSpec {
  readonly kind: "fixed";
  readonly headers: readonly string[];
  readonly mapRow: (item: unknown) => readonly unknown[];
}

export interface DynamicTabularStreamSpec {
  readonly kind: "dynamic";
  readonly headers?: readonly string[];
  readonly objectDataMode?: boolean;
}

export type TabularStreamSpec = FixedTabularStreamSpec | DynamicTabularStreamSpec;

/** Возвращает описание столбцов для потоковой выгрузки CSV/TSV без загрузки всего результата в память. */
export function tabularStreamSpec(
  operationId: string,
  requestedFields?: readonly string[],
): TabularStreamSpec | undefined {
  switch (operationId) {
    case "runtime.query":
      return {
        kind: "dynamic",
        ...(requestedFields && requestedFields.length > 0 ? { headers: requestedFields } : {}),
      };
    case "execute.script":
    case "results.read":
      return { kind: "dynamic" };
    case "objects.get":
      return { kind: "dynamic", objectDataMode: true };
    case "schema.types":
      return {
        kind: "fixed",
        headers: ["type", "catalog", "title", "customFields"],
        mapRow: (item) => {
          const r = isRecord(item) ? item : {};
          return [r.type ?? "", r.catalog ?? "", r.title ?? "", r.customFields ?? ""];
        },
      };
    case "schema.get":
      return {
        kind: "fixed",
        headers: [
          "path",
          "type",
          "origin",
          "title",
          "references",
          "query",
          "computed",
          "required",
          "multiple",
        ],
        mapRow: (item) => {
          const r = isRecord(item) ? item : {};
          return [
            r.path ?? "",
            r.type ?? "",
            r.origin ?? "",
            r.title ?? "",
            r.references ?? "",
            r.query === true ? "true" : "",
            r.computed === true ? "true" : "",
            r.required === true ? "true" : "",
            r.multiple === true ? "true" : "",
          ];
        },
      };
    case "logs.list":
      return {
        kind: "fixed",
        headers: ["name", "type", "date", "sizeBytes"],
        mapRow: (item) => {
          const r = isRecord(item) ? item : {};
          return [r.name ?? "", r.type ?? "", r.date ?? "", r.sizeBytes ?? ""];
        },
      };
    case "files.list":
      return {
        kind: "fixed",
        headers: ["name", "type", "bytes"],
        mapRow: (item) => {
          const r = isRecord(item) ? item : {};
          return [
            r.name ?? "",
            r.folder === true ? "folder" : "file",
            r.folder === true ? "" : (r.bytes ?? ""),
          ];
        },
      };
    case "rpc.list":
      return {
        kind: "fixed",
        headers: ["id", "parameters", "allowed", "serverOnly"],
        mapRow: (item) => {
          const r = isRecord(item) ? item : {};
          return [
            r.id ?? "",
            r.parameters ?? [],
            r.allowed ?? "",
            r.serverOnly === true ? "true" : "",
          ];
        },
      };
    case "logs.search":
    case "logs.follow":
      return {
        kind: "fixed",
        headers: ["sequence", "time", "context", "level", "text"],
        mapRow: (item) => {
          const r = isRecord(item) ? item : {};
          return [r.sequence ?? "", r.time ?? "", r.context ?? "", r.level ?? "", r.text ?? ""];
        },
      };
    case "agents.status":
      return {
        kind: "fixed",
        headers: ["id", "code", "name", "status", "threadId", "roleUID", "startedAt", "finishedAt"],
        mapRow: (item) => {
          const r = isRecord(item) ? item : {};
          return [
            r.id ?? "",
            r.code ?? "",
            r.name ?? "",
            r.status ?? "",
            r.threadId ?? "",
            r.roleUID ?? "",
            r.startedAt ?? "",
            r.finishedAt ?? "",
          ];
        },
      };
    case "web.spxml.getBackgroundTasksByName":
      return {
        kind: "fixed",
        headers: [
          "TrackingID",
          "IsRunning",
          "StartDate",
          "Progress",
          "ErrorCode",
          "ErrorText",
          "ResultData",
        ],
        mapRow: (item) => {
          const t = isRecord(item) ? item : {};
          return [
            t.TrackingID ?? "",
            t.IsRunning ?? "",
            t.StartDate ?? "",
            t.Progress ?? "",
            t.ErrorCode ?? "",
            t.ErrorText ?? "",
            t.ResultData ?? "",
          ];
        },
      };
    case "runtime.check":
      return {
        kind: "fixed",
        headers: ["name", "result", "reason"],
        mapRow: (item) => {
          const r = isRecord(item) ? item : {};
          return [r.name ?? "", r.result ?? "", r.reason ?? ""];
        },
      };
    default:
      return undefined;
  }
}

/** Извлекает список элементов для формата jsonl; undefined означает одиночный объект. */
export function extractListItems(
  operationId: string,
  data: unknown,
): readonly unknown[] | undefined {
  if (Array.isArray(data)) return data;
  if (!isRecord(data)) return undefined;
  switch (operationId) {
    case "runtime.query":
    case "files.list":
      return Array.isArray(data.items) ? data.items : undefined;
    case "schema.types":
      return Array.isArray(data.types) ? data.types : undefined;
    case "schema.get":
      return Array.isArray(data.fields) ? data.fields : undefined;
    case "logs.list":
      return Array.isArray(data.files) ? data.files : undefined;
    case "logs.search":
    case "logs.follow":
      return Array.isArray(data.events) ? data.events : undefined;
    case "rpc.list":
      return Array.isArray(data.targets) ? data.targets : undefined;
    case "cli.config.list":
      return Array.isArray(data.connections) ? data.connections : undefined;
    case "api.list":
      return Array.isArray(data.topics)
        ? data.topics
        : Array.isArray(data.operations)
          ? data.operations
          : undefined;
    case "objects.get":
    case "results.read":
      return Array.isArray(data.items) ? data.items : undefined;
    case "execute.script":
      return Array.isArray(data.result) ? data.result : undefined;
    case "runtime.batch":
      return Array.isArray(data.results) ? data.results : undefined;
    case "runtime.check":
      return Array.isArray(data.checks) ? data.checks : undefined;
    case "agents.status":
      return Array.isArray(data.runs) ? data.runs : undefined;
    case "web.spxml.getBackgroundTasksByName":
      return normalizeBackgroundTasks(data);
    default:
      return undefined;
  }
}

export function formatJsonl(operationId: string, data: unknown): string {
  const items = extractListItems(operationId, data);
  if (items !== undefined) {
    if (items.length === 0) return "";
    return `${items.map((item) => compactJson(item)).join("\n")}\n`;
  }
  return `${compactJson(data)}\n`;
}

export function formatRawLogEvents(events: readonly unknown[]): string {
  if (!events.length) return "";
  const lines = events.map((raw) => {
    if (!isRecord(raw)) return String(raw);
    if (typeof raw.text === "string" && raw.text.length > 0) {
      // В разобранном логе исходная строка text уже содержит время и контекст; не дублируем их.
      const trimmed = raw.text.trimStart();
      const hasTime =
        typeof raw.time === "string" && raw.time.length > 0 && trimmed.startsWith(raw.time);
      const hasContext =
        typeof raw.context === "string" &&
        raw.context.length > 0 &&
        trimmed.includes(`[${raw.context}]`);
      if (hasTime || hasContext || (raw.time === undefined && raw.context === undefined)) {
        return raw.text;
      }
      const parts = [
        typeof raw.time === "string" && raw.time ? raw.time : undefined,
        typeof raw.context === "string" && raw.context ? `[${raw.context}]` : undefined,
        raw.text,
      ].filter((part): part is string => part !== undefined && part !== "");
      return parts.join(" ");
    }
    const fallbackText = typeof raw.message === "string" ? raw.message : "";
    const parts = [
      typeof raw.time === "string" && raw.time ? raw.time : undefined,
      typeof raw.context === "string" && raw.context ? `[${raw.context}]` : undefined,
      fallbackText,
    ].filter((part): part is string => part !== undefined && part !== "");
    return parts.join(" ");
  });
  return `${lines.join("\n")}\n`;
}

function formatRawTabularRows(table: ExtractedTable): string {
  if (table.headers.length === 0 || table.rows.length === 0) return "";
  if (table.headers.length === 1) {
    return `${table.rows.map((row) => tabularCellText(row[0])).join("\n")}\n`;
  }
  return `${table.rows
    .map((row) =>
      row.map((cell) => tabularCellText(cell).replace(/\r\n|[\r\n\t]/g, " ")).join("\t"),
    )
    .join("\n")}\n`;
}

/** Форматирует ответ в режиме --format raw: чистые данные без обёрток и шапок. */
export function renderRaw(
  result: OperationResult,
  requestedFields?: readonly string[],
  quiet = false,
): RawRenderResult {
  const op = result.meta.operationId;
  const data = result.data;

  if (op === "files.read" && isRecord(data)) {
    if (typeof data.text === "string") return { kind: "text", text: data.text };
    if (typeof data.base64 === "string")
      return { kind: "binary", bytes: Buffer.from(data.base64, "base64") };
    if (typeof data.file === "string") return { kind: "text", text: `${data.file}\n` };
  }
  if (op === "logs.read" && isRecord(data) && typeof data.text === "string") {
    const tailNote =
      !quiet && data.tailOnly === true
        ? `Показан конец файла ${String(data.file ?? "")} (${typeof data.sizeBytes === "number" ? `${data.sizeBytes} Б` : "не весь"}); весь файл: --full.\n`
        : undefined;
    return {
      kind: "text",
      text: data.text,
      ...(tailNote === undefined ? {} : { stderrNote: tailNote }),
    };
  }
  if (
    (op === "logs.search" || op === "logs.follow") &&
    isRecord(data) &&
    Array.isArray(data.events)
  ) {
    return { kind: "text", text: formatRawLogEvents(data.events) };
  }
  if (op === "native.lds.loadDoc") {
    const xml = extractDocXml(data);
    if (xml !== undefined) return { kind: "text", text: xml };
  }
  if (op === "rpc.describe" && isRecord(data)) {
    if (typeof data.code === "string") return { kind: "text", text: data.code };
    const params = Array.isArray(data.parameters) ? data.parameters.join(", ") : "";
    return { kind: "text", text: `${String(data.id ?? "")}(${params})\n` };
  }
  if (op === "runtime.query") {
    const table = extractTable(op, data, requestedFields);
    if (table) return { kind: "text", text: formatRawTabularRows(table) };
  }
  if (op === "cli.config.path" && isRecord(data) && typeof data.path === "string") {
    return { kind: "text", text: `${data.path}\n` };
  }
  if (op === "cli.config.use" && isRecord(data) && typeof data.defaultConnection === "string") {
    return { kind: "text", text: `${data.defaultConnection}\n` };
  }
  if (op === "cli.config.remove" && isRecord(data) && isRecord(data.removed)) {
    return { kind: "text", text: `${String(data.removed.name ?? "")}\n` };
  }
  if (op === "web.spxml.getBackgroundTasksByName") {
    return rawLines(normalizeBackgroundTasks(data), (r) => String(r.TrackingID ?? ""));
  }
  if (op === "cli.version" && isRecord(data) && typeof data.version === "string") {
    return { kind: "text", text: `${data.version}\n` };
  }
  if (op === "objects.create" && isRecord(data) && typeof data.id === "string") {
    return { kind: "text", text: `${data.id}\n` };
  }
  if (op === "objects.delete" && isRecord(data)) {
    return { kind: "text", text: `${typeof data.id === "string" ? data.id : "deleted"}\n` };
  }
  if (op === "objects.patch" && isRecord(data)) {
    const value = typeof data.id === "string" ? data.id : String(data.fingerprint ?? "");
    return { kind: "text", text: value ? `${value}\n` : "" };
  }
  if (op === "files.exists" && isRecord(data) && typeof data.exists === "boolean") {
    return { kind: "text", text: `${data.exists}\n` };
  }
  if (op === "files.write" && isRecord(data) && typeof data.bytes === "number") {
    return { kind: "text", text: `${data.bytes}\n` };
  }
  if (op === "files.delete") {
    return { kind: "text", text: "deleted\n" };
  }
  if ((op === "cli.files.edit" || op === "cli.object.edit") && isRecord(data)) {
    if (data.changed === false) return { kind: "text", text: "" };
  }
  if (op === "web.pages.uploadFile" && isRecord(data) && typeof data.url === "string") {
    return { kind: "text", text: `${data.url}\n` };
  }
  if (op === "web.websocket.heartbeat" && isRecord(data)) {
    return { kind: "text", text: `${Boolean(data.heartbeatObserved)}\n` };
  }
  if (op === "results.export" && isRecord(data) && typeof data.path === "string") {
    return { kind: "text", text: `${data.path}\n` };
  }
  if (op === "results.read" && isRecord(data)) {
    if (typeof data.text === "string") return { kind: "text", text: data.text };
    if (Array.isArray(data.items)) {
      const table = extractTable(op, data);
      if (table) return { kind: "text", text: formatRawTabularRows(table) };
      return {
        kind: "text",
        text: data.items.length
          ? `${data.items.map((item) => tabularCellText(item)).join("\n")}\n`
          : "",
      };
    }
  }
  if (op === "logs.list" && isRecord(data) && Array.isArray(data.files))
    return rawLines(data.files, (r) => String(r.name ?? ""));
  if (op === "files.list" && isRecord(data) && Array.isArray(data.items))
    return rawLines(data.items, (r) => `${String(r.name ?? "")}${r.folder === true ? "/" : ""}`);
  if (op === "schema.types" && isRecord(data) && Array.isArray(data.types))
    return rawLines(data.types, (r) => String(r.type ?? r.catalog ?? ""));
  if (op === "schema.get" && isRecord(data) && Array.isArray(data.fields))
    return rawLines(data.fields, (r) => String(r.path ?? ""));
  if (op === "rpc.list" && isRecord(data) && Array.isArray(data.targets))
    return rawLines(data.targets, (r) => String(r.id ?? ""));
  if (op === "cli.config.list" && isRecord(data) && Array.isArray(data.connections))
    return rawLines(data.connections, (r) => String(r.name ?? ""));
  if (op === "api.list" && isRecord(data)) {
    if (Array.isArray(data.topics)) return rawLines(data.topics, (r) => String(r.topic ?? ""));
    if (Array.isArray(data.operations)) return rawLines(data.operations, (r) => String(r.id ?? ""));
  }
  if (op === "execute.script" && isRecord(data) && Array.isArray(data.result)) {
    const table = extractTable(op, data);
    if (table) return { kind: "text", text: formatRawTabularRows(table) };
    return {
      kind: "text",
      text: data.result.length
        ? `${data.result.map((item) => tabularCellText(item)).join("\n")}\n`
        : "",
    };
  }
  if (op === "rpc.call" && isRecord(data) && "value" in data) {
    if (typeof data.value === "string") return { kind: "text", text: data.value };
    return { kind: "text", text: `${tabularCellText(data.value)}\n` };
  }
  if (op === "runtime.status" && isRecord(data) && typeof data.version === "string") {
    return { kind: "text", text: `${data.version}\n` };
  }
  if (typeof data === "string") return { kind: "text", text: data };
  if (data === null || data === undefined) return { kind: "text", text: "" };
  if (typeof data === "number" || typeof data === "boolean" || typeof data === "bigint") {
    return { kind: "text", text: `${String(data)}\n` };
  }
  return { kind: "text", text: `${compactJson(data)}\n` };
}

function renderTruncated(result: OperationResult, styler: Styler): HumanRenderResult {
  const data = isRecord(result.data) ? result.data : {};
  const resultId =
    typeof result.meta.resultId === "string"
      ? result.meta.resultId
      : typeof data.resultId === "string"
        ? data.resultId
        : undefined;
  const resultBytes =
    typeof result.meta.resultBytes === "number" ? result.meta.resultBytes : undefined;
  const sizeLabel = resultBytes !== undefined ? ` (${formatBytes(resultBytes)})` : "";
  const lines: string[] = [
    styler.bold(
      styler.yellow(`Ответ не поместился в предел вывода и сохранён локально${sizeLabel}.`),
    ),
  ];
  if (resultId) lines.push(`${styler.dim("resultId:")} ${resultId}`);

  if ("preview" in data && data.preview !== undefined) {
    lines.push("", styler.dim("Начало ответа:"));
    const preview = data.preview;
    let previewText: string;
    if (typeof preview === "string") {
      previewText = preview;
    } else if (isRecord(preview) && typeof preview.text === "string") {
      previewText = preview.text;
    } else {
      previewText = renderStructured(preview, styler, 2);
    }
    const previewLines = previewText.split(/\r?\n/);
    const maxLines = 12;
    const clipped = previewLines.slice(0, maxLines).join("\n");
    const bounded = clipped.length > 800 ? `${clipped.slice(0, 799)}…` : clipped;
    lines.push(bounded);
    if (previewLines.length > maxLines) lines.push(styler.dim("…"));
  }

  if (resultId) {
    lines.push(
      "",
      `${styler.dim("Читать частями:")}  wtctl result read ${resultId}`,
      `${styler.dim("Сохранить файл:")}  wtctl result export ${resultId} --to ФАЙЛ`,
    );
  }
  return { text: `${lines.join("\n")}\n` };
}

export function renderLogEvents(events: readonly unknown[], styler: Styler): string[] {
  const LEVEL_PREFIX_RE = /^(CRITICAL|ERROR|WARN(?:ING)?|INFO|DEBUG)\b/i;
  return events.map((raw) => {
    if (!isRecord(raw)) return String(raw);
    const level = typeof raw.level === "string" ? raw.level : "normal";
    const time = typeof raw.time === "string" && raw.time ? styler.dim(raw.time) : undefined;
    const ctx =
      typeof raw.context === "string" && raw.context ? styler.cyan(`[${raw.context}]`) : undefined;
    const body = typeof raw.text === "string" ? raw.text : "";
    const [firstLine = "", ...restLines] = body.split(/\r?\n/);

    const styleLevel = (word: string): string => {
      if (level === "critical" || level === "error") return styler.bold(styler.red(word));
      if (level === "warning") return styler.yellow(word);
      if (level === "debug") return styler.dim(word);
      if (level === "info") return styler.cyan(word);
      return word;
    };

    const match = LEVEL_PREFIX_RE.exec(firstLine);
    let badge: string | undefined;
    let styledFirst = firstLine;
    if (match) {
      styledFirst = styleLevel(match[1]!) + firstLine.slice(match[1]!.length);
    } else if (level !== "normal") {
      badge = styleLevel(level.toUpperCase());
    }

    const head = [time, ctx, badge, styledFirst].filter(Boolean).join(" ");
    if (!restLines.length) return head;
    const tail = restLines.map((line) => (level === "debug" ? styler.dim(line) : line));
    return [head, ...tail].join("\n");
  });
}

function renderObjectSingle(data: Record<string, unknown>, styler: Styler): string {
  const type = String(data.type ?? "объект");
  const id = typeof data.id === "string" ? data.id : undefined;
  const header = styler.bold(id ? `${type} · ${id}` : type);
  const metaEntries: [string, string][] = [];
  if (typeof data.url === "string") metaEntries.push(["URL", data.url]);
  if (typeof data.fingerprint === "string") metaEntries.push(["Отпечаток", data.fingerprint]);
  if (typeof data.formUrl === "string") metaEntries.push(["Форма", data.formUrl]);

  const blocks = [header];
  if (metaEntries.length) blocks.push(renderCard(metaEntries, styler));

  const fieldLines: string[] = [];
  if (isRecord(data.data) && Object.keys(data.data).length > 0) {
    fieldLines.push(renderStructured(data.data, styler));
  }
  if (isRecord(data.fromCatalog)) {
    for (const [key, value] of Object.entries(data.fromCatalog)) {
      const rendered = renderStructured(value, styler, 0);
      fieldLines.push(`${styler.dim(`${key}:`)} ${rendered} ${styler.dim("(из каталога)")}`);
    }
  }
  if (fieldLines.length) blocks.push("", fieldLines.join("\n"));

  const notes: string[] = [];
  if (Array.isArray(data.emptyFields) && data.emptyFields.length > 0) {
    notes.push(styler.dim(`Пустые поля: ${data.emptyFields.join(", ")}`));
  }
  if (Array.isArray(data.unknownFields) && data.unknownFields.length > 0) {
    notes.push(styler.yellow(`Неизвестные поля: ${data.unknownFields.join(", ")}`));
  }
  if (notes.length) blocks.push("", notes.join("\n"));
  return `${blocks.join("\n")}\n`;
}

export function renderObjectPatch(data: Record<string, unknown>, styler: Styler): string {
  const preview = data.preview === true;
  const noop = data.noop === true;
  const type = typeof data.type === "string" ? data.type : undefined;
  const id = typeof data.id === "string" ? data.id : undefined;
  const changes = Array.isArray(data.changes) ? data.changes : [];
  const lines: string[] = [];

  if (preview) {
    lines.push(
      styler.bold(
        styler.yellow(
          noop ? "Предпросмотр правки: изменений нет." : "Предпросмотр правки (без записи):",
        ),
      ),
    );
  } else if (noop) {
    lines.push(styler.dim("Изменений нет (noop), документ не перезаписывался."));
  } else {
    const target = [type, id].filter(Boolean).join(" · ");
    lines.push(styler.bold(styler.green(`✓ Объект изменён${target ? ` (${target})` : ""}`)));
  }

  if (changes.length > 0) {
    lines.push("");
    for (const raw of changes) {
      if (!isRecord(raw)) continue;
      const path = String(raw.path ?? "");
      if (raw.op === "remove") {
        lines.push(styler.red(`- ${path}: ${formatInline(raw.before)}`));
      } else {
        if ("before" in raw && raw.before !== undefined) {
          lines.push(styler.red(`- ${path}: ${formatInline(raw.before)}`));
        }
        lines.push(styler.green(`+ ${path}: ${formatInline(raw.after)}`));
      }
    }
  } else if (!preview && !noop) {
    lines.push(styler.dim("Документ сохранён без изменения полей (--resave)."));
  }

  if (Array.isArray(data.serverFilled) && data.serverFilled.length > 0) {
    lines.push(
      "",
      styler.yellow(
        `Предупреждение: сервер заполняет эти поля сам при сохранении: ${data.serverFilled.join(", ")}.`,
      ),
    );
  }
  if (Array.isArray(data.serverChanged) && data.serverChanged.length > 0) {
    lines.push(
      "",
      styler.cyan(`Сервер дополнительно изменил поля: ${data.serverChanged.join(", ")}.`),
    );
  }

  const metaEntries: [string, string][] = [];
  if (typeof data.url === "string") metaEntries.push(["URL", data.url]);
  if (typeof data.fingerprint === "string") metaEntries.push(["Отпечаток", data.fingerprint]);
  if (typeof data.mutationOutcome === "string") metaEntries.push(["Исход", data.mutationOutcome]);
  if (metaEntries.length) lines.push("", renderCard(metaEntries, styler));

  return `${lines.join("\n")}\n`;
}

function renderCheck(
  data: Record<string, unknown>,
  meta: OperationResult["meta"],
  styler: Styler,
): string {
  const version = typeof data.version === "string" ? ` · ${data.version}` : "";
  const language = typeof data.language === "string" ? ` (${data.language})` : "";
  const lines: string[] = [
    styler.bold(`Проверка подключения ${meta.connection}${version}${language}`),
    "",
  ];
  const checks = Array.isArray(data.checks) ? data.checks : [];
  for (const raw of checks) {
    if (!isRecord(raw)) continue;
    const name = String(raw.name ?? "");
    const result = String(raw.result ?? "");
    const reason = typeof raw.reason === "string" && raw.reason ? ` — ${raw.reason}` : "";
    if (result === "ok") {
      lines.push(`  ${styler.green("✓")} ${name}`);
    } else if (result === "failed") {
      lines.push(`  ${styler.red("✗")} ${styler.red(name)}${reason}`);
    } else {
      lines.push(`  ${styler.yellow("−")} ${styler.dim(name)}${styler.dim(reason)}`);
    }
  }
  const summary = isRecord(data.summary) ? data.summary : {};
  const ok = Number(summary.ok ?? 0);
  const failed = Number(summary.failed ?? 0);
  const skipped = Number(summary.skipped ?? 0);
  const summaryText = `Итог: ${ok} пройдено, ${failed} с ошибкой, ${skipped} пропущено (${formatDuration(meta.durationMs)})`;
  lines.push("", failed > 0 ? styler.bold(styler.red(summaryText)) : styler.green(summaryText));
  return `${lines.join("\n")}\n`;
}

function renderApiDescribe(data: Record<string, unknown>, styler: Styler): string {
  const id = String(data.id ?? "");
  const topic = typeof data.topic === "string" ? data.topic : "";
  const effect = typeof data.effect === "string" ? data.effect : "";
  const lines: string[] = [
    `${styler.bold(id)} ${styler.dim(`(${[topic, effect].filter(Boolean).join(", ")})`)}`,
  ];
  if (typeof data.description === "string" && data.description) lines.push("", data.description);
  if (typeof data.details === "string" && data.details) lines.push("", data.details);

  if (isRecord(data.inputSchema)) {
    const props = isRecord(data.inputSchema.properties) ? data.inputSchema.properties : undefined;
    const required = new Set(
      Array.isArray(data.inputSchema.required)
        ? data.inputSchema.required.filter((item): item is string => typeof item === "string")
        : [],
    );
    if (props && Object.keys(props).length > 0) {
      lines.push("", styler.bold("Аргументы:"));
      const rows: [string, string][] = Object.entries(props).map(([name, raw]) => {
        const schema = isRecord(raw) ? raw : {};
        const typeLabel = Array.isArray(schema.enum)
          ? schema.enum.map(String).join("|")
          : typeof schema.type === "string"
            ? schema.type
            : "";
        const desc = typeof schema.description === "string" ? schema.description : "";
        const label = `${name}${required.has(name) ? "*" : ""}`;
        const detail = [typeLabel ? styler.dim(`(${typeLabel})`) : "", desc]
          .filter(Boolean)
          .join(" ");
        return [label, detail || styler.dim("—")];
      });
      const width = Math.max(...rows.map(([label]) => label.length));
      for (const [label, detail] of rows) {
        lines.push(`  ${styler.cyan(label.padEnd(width))}  ${detail}`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

function renderCredentialSource(cred: Record<string, unknown>): string {
  const user = String(cred.username ?? "none");
  const pass = String(cred.password ?? "none");
  const fmt = (kind: string, envName: unknown) =>
    kind === "env" && typeof envName === "string"
      ? `env:${envName}`
      : kind === "file"
        ? "файл"
        : "нет";
  if (user === "none" && pass === "none") return "нет";
  if (user === "file" && pass === "file") return "файл";
  return `${fmt(user, cred.usernameEnv)} / ${fmt(pass, cred.passwordEnv)}`;
}

/** Форматирование читаемого вывода (auto в TTY и явный --format table). */
export function renderHuman(
  result: OperationResult,
  options: HumanRenderOptions,
): HumanRenderResult {
  const { columns, styler, quiet } = options;
  if (result.meta.truncated === true) return renderTruncated(result, styler);

  const op = result.meta.operationId;
  const data = result.data;
  const tableOpts = { ...(columns === undefined ? {} : { maxWidth: columns }), styler };

  if (op === "runtime.status" && isRecord(data)) {
    const entries: [string, string][] = [
      ["Подключение", String(data.connection ?? result.meta.connection)],
      ["Сервер", String(data.baseUrl ?? "")],
      ["Версия", styler.bold(String(data.version ?? ""))],
      ...(typeof data.database === "string"
        ? ([["База данных", data.database]] as [string, string][])
        : []),
      ...(typeof data.userId === "string"
        ? ([["Пользователь", data.userId]] as [string, string][])
        : []),
      ["Права", formatPermissions(data.permissions)],
      ...(typeof data.operationCount === "number"
        ? ([["Операций", String(data.operationCount)]] as [string, string][])
        : []),
    ];
    return { text: `${renderCard(entries, styler)}\n` };
  }

  if (op === "runtime.check" && isRecord(data)) {
    return { text: renderCheck(data, result.meta, styler) };
  }

  if (op === "server.info" && isRecord(data)) {
    const entries: [string, string][] = [
      ["Профиль", String(data.profile ?? "")],
      ["Версия", styler.bold(String(data.versionServer ?? ""))],
      ["ОС", String(data.osType ?? "")],
      ["База данных", String(data.database ?? "")],
      ["Маска", String(data.capabilityMask ?? "")],
      ...(Array.isArray(data.dataFolders)
        ? ([["Папки данных", data.dataFolders.join(", ")]] as [string, string][])
        : []),
      ...(Array.isArray(data.codeFolders)
        ? ([["Папки кода", data.codeFolders.join(", ")]] as [string, string][])
        : []),
    ];
    const parts = [renderCard(entries, styler)];
    if (Array.isArray(data.catalogLimits) && data.catalogLimits.length > 0) {
      const limitColumns: TableColumn[] = [
        { header: "Тип объекта" },
        { header: "Предел записей", align: "right" },
      ];
      const limitRows = data.catalogLimits.map((item) => {
        const r = isRecord(item) ? item : {};
        return [String(r.objectTypeName ?? ""), String(r.maxRecordsNum ?? "")];
      });
      parts.push("", renderTable(limitColumns, limitRows, tableOpts));
    }
    return { text: `${parts.join("\n")}\n` };
  }

  if (op === "cli.version" && isRecord(data)) {
    return {
      text: `${styler.bold(`${String(data.name ?? "wtctl")} ${String(data.version ?? "")}`)}${typeof data.node === "string" ? styler.dim(` (Node.js ${data.node})`) : ""}\n`,
    };
  }

  if (op === "runtime.query" && isRecord(data) && Array.isArray(data.items)) {
    const parts: string[] = [];
    const table = extractTable(op, data, options.requestedFields);
    if (table && table.headers.length > 0 && table.rows.length > 0) {
      parts.push(renderExtractedTable(table, tableOpts));
    } else {
      parts.push(styler.dim("Ничего не найдено."));
    }
    const count = data.items.length;
    parts.push(
      dimLine(
        styler,
        typeof data.total === "number" ? `Показано ${count} из ${data.total}` : `Показано ${count}`,
        typeof data.nextStartPosition === "number"
          ? `далее: --start-position ${data.nextStartPosition}`
          : undefined,
      ),
    );
    if (Array.isArray(data.unknownFields) && data.unknownFields.length > 0) {
      parts.push(
        styler.yellow(
          `Предупреждение: неизвестные поля каталога: ${data.unknownFields.join(", ")}.`,
        ),
      );
    }
    if (data.incomplete === true) {
      parts.push(styler.yellow("Предупреждение: неполный ответ."));
    }
    if (typeof data.hint === "string" && data.hint) {
      parts.push(
        data.incomplete === true || Array.isArray(data.unknownFields)
          ? styler.yellow(data.hint)
          : styler.dim(data.hint),
      );
    }
    return { text: `${parts.join("\n")}\n` };
  }

  if (op === "schema.types" && isRecord(data) && Array.isArray(data.types)) {
    const parts: string[] = [];
    if (data.types.length > 0) {
      const cols: TableColumn[] = [
        { header: "Тип" },
        { header: "Каталог" },
        { header: "Заголовок" },
        { header: "Настр. поля", align: "right" },
      ];
      const rows = data.types.map((item) => {
        const r = isRecord(item) ? item : {};
        return [
          String(r.type ?? "—"),
          String(r.catalog ?? "—"),
          String(r.title ?? ""),
          r.customFields === undefined ? "" : String(r.customFields),
        ];
      });
      parts.push(renderTable(cols, rows, tableOpts));
    } else {
      parts.push(styler.dim("Типы не найдены."));
    }
    parts.push(
      dimLine(
        styler,
        `Показано ${data.types.length} из ${String(data.total ?? data.types.length)}`,
        typeof data.nextCursor === "number" ? `далее: --cursor ${data.nextCursor}` : undefined,
      ),
    );
    if (Array.isArray(data.notes) && data.notes.length > 0) {
      for (const note of data.notes) parts.push(styler.dim(String(note)));
    }
    return { text: `${parts.join("\n")}\n` };
  }

  if (op === "schema.get" && isRecord(data) && Array.isArray(data.fields)) {
    const header = [
      styler.bold(String(data.type ?? "")),
      typeof data.catalog === "string" ? `каталог ${data.catalog}` : undefined,
      typeof data.formUrl === "string" ? styler.dim(data.formUrl) : undefined,
    ]
      .filter(Boolean)
      .join(" · ");
    const parts: string[] = [header];
    if (isRecord(data.element)) {
      const el = data.element;
      const tags = [
        String(el.type ?? ""),
        el.multiple === true ? "список" : undefined,
        typeof el.key === "string" ? `ключ: ${el.key}` : undefined,
      ]
        .filter(Boolean)
        .join(", ");
      parts.push(styler.dim(`Узел: ${String(el.path ?? "")} (${tags})`));
    }
    if (data.fields.length > 0) {
      const cols: TableColumn[] = [
        { header: "Поле" },
        { header: "Тип" },
        { header: "Источник" },
        { header: "Флаги" },
        { header: "Заголовок" },
      ];
      const rows = data.fields.map((item) => {
        const r = isRecord(item) ? item : {};
        const typeStr = `${String(r.type ?? "")}${r.multiple === true ? "[]" : ""}${typeof r.children === "number" ? ` (+${r.children})` : ""}`;
        const flags = [
          r.query === true ? "query" : undefined,
          r.computed === true ? "computed" : undefined,
          r.required === true ? "required" : undefined,
          typeof r.references === "string" ? `→ ${r.references}` : undefined,
        ]
          .filter(Boolean)
          .join(", ");
        return [
          String(r.path ?? ""),
          typeStr,
          String(r.origin ?? ""),
          flags,
          String(r.title ?? ""),
        ];
      });
      parts.push("", renderTable(cols, rows, tableOpts));
    } else if (!Array.isArray(data.methods) || data.methods.length === 0) {
      parts.push("", styler.dim("Поля не найдены."));
    }
    if (Array.isArray(data.methods) && data.methods.length > 0) {
      parts.push("", styler.bold("Методы формы:"));
      for (const method of data.methods) {
        if (!isRecord(method)) continue;
        const params = Array.isArray(method.parameters) ? method.parameters.join(", ") : "";
        parts.push(`  ${String(method.name ?? "")}(${params})`);
      }
    }
    parts.push(
      dimLine(
        styler,
        `Показано ${data.fields.length} из ${String(data.total ?? data.fields.length)}`,
        data.cutBySize === true ? "обрезано по размеру" : undefined,
        typeof data.nextCursor === "number" ? `далее: --cursor ${data.nextCursor}` : undefined,
      ),
    );
    if (Array.isArray(data.notes) && data.notes.length > 0) {
      for (const note of data.notes) parts.push(styler.dim(String(note)));
    }
    return { text: `${parts.join("\n")}\n` };
  }

  if (op === "objects.get" && isRecord(data)) {
    if (Array.isArray(data.items)) {
      const table = flattenManyObjects(data.items);
      const parts: string[] = [];
      if (table.headers.length > 0 && table.rows.length > 0) {
        parts.push(renderExtractedTable(table, tableOpts));
      } else {
        parts.push(styler.dim("Объекты не найдены."));
      }
      const emptyFields = new Set<string>();
      const unknownFields = new Set<string>();
      for (const item of data.items) {
        if (!isRecord(item)) continue;
        if (Array.isArray(item.emptyFields))
          for (const field of item.emptyFields) emptyFields.add(String(field));
        if (Array.isArray(item.unknownFields))
          for (const field of item.unknownFields) unknownFields.add(String(field));
      }
      if (emptyFields.size > 0)
        parts.push(styler.dim(`Пустые поля: ${[...emptyFields].join(", ")}`));
      if (unknownFields.size > 0)
        parts.push(styler.yellow(`Неизвестные поля: ${[...unknownFields].join(", ")}`));
      const failed = typeof data.failed === "number" ? data.failed : 0;
      const footer = `Объектов: ${String(data.total ?? data.items.length)}${failed ? `, с ошибкой: ${failed}` : ""}`;
      parts.push(failed ? styler.yellow(footer) : styler.dim(footer));
      if (typeof data.hint === "string" && data.hint) parts.push(styler.dim(data.hint));
      return { text: `${parts.join("\n")}\n` };
    }
    return { text: renderObjectSingle(data, styler) };
  }

  if (op === "objects.create" && isRecord(data)) {
    const entries: [string, string][] = [
      ["ID", styler.bold(String(data.id ?? ""))],
      ["Тип", String(data.type ?? "")],
      ["URL", String(data.url ?? "")],
      ...(typeof data.fingerprint === "string"
        ? ([["Отпечаток", data.fingerprint]] as [string, string][])
        : []),
      ["Исход", String(data.mutationOutcome ?? "confirmed")],
    ];
    return {
      text: `${styler.bold(styler.green("✓ Объект создан"))}\n${renderCard(entries, styler)}\n`,
    };
  }

  if (op === "objects.patch" && isRecord(data)) {
    return { text: renderObjectPatch(data, styler) };
  }

  if (op === "objects.delete" && isRecord(data)) {
    const verification =
      data.verification === "catalog" && typeof data.catalog === "string"
        ? `каталог ${data.catalog}`
        : data.verification === "server"
          ? "ответ сервера"
          : String(data.verification ?? "");
    const entries: [string, string][] = [
      ...(typeof data.id === "string" ? ([["ID", data.id]] as [string, string][]) : []),
      ["Проверка", verification],
      ["Исход", String(data.mutationOutcome ?? "confirmed")],
    ];
    return {
      text: `${styler.bold(styler.green("✓ Объект удалён"))}\n${renderCard(entries, styler)}\n`,
    };
  }

  if (op === "files.read" && isRecord(data)) {
    if (typeof data.text === "string") {
      return { text: ensureNewline(data.text) };
    }
    if (typeof data.file === "string") {
      const bytes = typeof data.bytes === "number" ? data.bytes : 0;
      const entries: [string, string][] = [
        ["Файл", data.file],
        ["Размер", `${formatBytes(bytes)} (${bytes} Б)`],
      ];
      return {
        text: `${styler.bold(styler.green("✓ Файл сохранён"))}\n${renderCard(entries, styler)}\n`,
      };
    }
    if (typeof data.base64 === "string") {
      const bytes = typeof data.bytes === "number" ? data.bytes : 0;
      const lines = [
        styler.bold(`Двоичный файл: ${formatBytes(bytes)} (${bytes} Б)`),
        styler.dim("Сохранить на диск:  wtctl files read АДРЕС --to ФАЙЛ"),
        styler.dim("Вывести байты как есть: --format raw"),
      ];
      return { text: `${lines.join("\n")}\n` };
    }
  }

  if (op === "files.exists" && isRecord(data)) {
    const exists = data.exists === true;
    return {
      text: `${exists ? styler.green("✓ Существует") : styler.red("✗ Не найден")}\n`,
    };
  }

  if (op === "files.list" && isRecord(data) && Array.isArray(data.items)) {
    const parts: string[] = [];
    if (data.items.length > 0) {
      const cols: TableColumn[] = [
        { header: "Имя" },
        { header: "Тип" },
        { header: "Размер", align: "right" },
      ];
      const rows = data.items.map((item) => {
        const r = isRecord(item) ? item : {};
        const isFolder = r.folder === true;
        const name = String(r.name ?? "");
        const bytes = typeof r.bytes === "number" ? r.bytes : 0;
        return [
          isFolder ? styler.cyan(`${name}/`) : name,
          isFolder ? "папка" : "файл",
          isFolder ? "—" : formatBytes(bytes),
        ];
      });
      parts.push(renderTable(cols, rows, tableOpts));
    } else {
      parts.push(styler.dim("Папка пуста."));
    }
    parts.push(styler.dim(`Всего: ${String(data.total ?? data.items.length)}`));
    return { text: `${parts.join("\n")}\n` };
  }

  if (op === "files.write" && isRecord(data)) {
    const bytes = typeof data.bytes === "number" ? data.bytes : 0;
    const entries: [string, string][] = [
      ["Размер", `${formatBytes(bytes)} (${bytes} Б)`],
      ["Исход", String(data.mutationOutcome ?? "confirmed")],
    ];
    return {
      text: `${styler.bold(styler.green("✓ Файл записан"))}\n${renderCard(entries, styler)}\n`,
    };
  }

  if (op === "files.delete" && isRecord(data)) {
    const entries: [string, string][] = [["Исход", String(data.mutationOutcome ?? "confirmed")]];
    return {
      text: `${styler.bold(styler.green("✓ Файл удалён"))}\n${renderCard(entries, styler)}\n`,
    };
  }

  if (op === "web.pages.uploadFile" && isRecord(data)) {
    const entries: [string, string][] = [
      ...(typeof data.url === "string" ? ([["URL", data.url]] as [string, string][]) : []),
      ...(typeof data.folderUrl === "string"
        ? ([["Папка", data.folderUrl]] as [string, string][])
        : []),
    ];
    return {
      text: `${styler.bold(styler.green("✓ Файл загружен"))}\n${renderCard(entries, styler)}\n`,
    };
  }

  if (op === "web.websocket.heartbeat" && isRecord(data)) {
    const ok = data.heartbeatObserved === true;
    const entries: [string, string][] = [
      ...(typeof data.route === "string" ? ([["Маршрут", data.route]] as [string, string][]) : []),
      ...(typeof data.durationMs === "number"
        ? ([["Время", formatDuration(data.durationMs)]] as [string, string][])
        : []),
      ...(typeof data.closeCode === "number"
        ? ([["Код закрытия", String(data.closeCode)]] as [string, string][])
        : []),
      ...(typeof data.warning === "string"
        ? ([["Предупреждение", styler.yellow(data.warning)]] as [string, string][])
        : []),
    ];
    const title = ok
      ? styler.bold(styler.green("✓ WebSocket отвечает"))
      : styler.bold(styler.red("✗ WebSocket не ответил"));
    return { text: `${title}\n${renderCard(entries, styler)}\n` };
  }

  if (op === "logs.list" && isRecord(data) && Array.isArray(data.files)) {
    const parts: string[] = [];
    if (data.files.length > 0) {
      const cols: TableColumn[] = [
        { header: "Файл" },
        { header: "Тип" },
        { header: "Дата" },
        { header: "Размер", align: "right" },
      ];
      const rows = data.files.map((item) => {
        const r = isRecord(item) ? item : {};
        const size = typeof r.sizeBytes === "number" ? formatBytes(r.sizeBytes) : "";
        return [String(r.name ?? ""), String(r.type ?? ""), String(r.date ?? ""), size];
      });
      parts.push(renderTable(cols, rows, tableOpts));
    } else {
      parts.push(styler.dim("Логи не найдены."));
    }
    parts.push(
      dimLine(
        styler,
        `Показано ${data.files.length} из ${String(data.total ?? data.files.length)}`,
        typeof data.nextOffset === "number" ? `далее: --offset ${data.nextOffset}` : undefined,
      ),
    );
    return { text: `${parts.join("\n")}\n` };
  }

  if (op === "logs.read" && isRecord(data) && typeof data.text === "string") {
    const file = typeof data.file === "string" ? data.file : "";
    const size = typeof data.sizeBytes === "number" ? ` (${formatBytes(data.sizeBytes)})` : "";
    const stderrNote =
      data.tailOnly === true && !quiet
        ? `${styler.dim(`Показан конец файла ${file}${size}; весь файл: --full.`)}\n`
        : undefined;
    return {
      text: data.text ? ensureNewline(data.text) : `${styler.dim("Файл пуст.")}\n`,
      ...(stderrNote === undefined ? {} : { stderrNote }),
    };
  }

  if (op === "logs.search" && isRecord(data) && Array.isArray(data.events)) {
    const parts = data.events.length
      ? renderLogEvents(data.events, styler)
      : [styler.dim("Совпадений не найдено.")];
    parts.push(
      dimLine(
        styler,
        `Совпадений: ${String(data.matches ?? data.events.length)} (показано ${data.events.length}, событий: ${String(data.totalEvents ?? data.events.length)})`,
        data.tailOnly === true ? "только конец файла" : undefined,
        data.cutBySize === true ? "обрезано по размеру" : undefined,
        typeof data.nextOffset === "number" ? `далее: --offset ${data.nextOffset}` : undefined,
      ),
    );
    return { text: `${parts.join("\n")}\n` };
  }

  if (op === "logs.follow" && isRecord(data) && Array.isArray(data.events)) {
    const parts = data.events.length
      ? renderLogEvents(data.events, styler)
      : [styler.dim("Новых событий нет.")];
    if (typeof data.omitted === "number" && data.omitted > 0) {
      parts.push(styler.yellow(`Пропущено ранних событий: ${data.omitted}.`));
    }
    if (data.gapPossible === true) {
      const reason = typeof data.resetReason === "string" ? ` (${data.resetReason})` : "";
      parts.push(styler.yellow(`Возможен пропуск событий${reason}.`));
    }
    if (typeof data.cursor === "string") {
      parts.push(styler.dim(`cursor: ${data.cursor}`));
    }
    return { text: `${parts.join("\n")}\n` };
  }

  if (op === "rpc.list" && isRecord(data) && Array.isArray(data.targets)) {
    const parts: string[] = [];
    if (data.targets.length > 0) {
      const cols: TableColumn[] = [
        { header: "Функция" },
        { header: "Параметры" },
        { header: "Доступ" },
      ];
      const rows = data.targets.map((item) => {
        const r = isRecord(item) ? item : {};
        const params = Array.isArray(r.parameters) ? r.parameters.join(", ") : "";
        const access =
          r.serverOnly === true || r.allowed === false
            ? "только сервер"
            : r.allowed === true
              ? "клиент"
              : "?";
        return [String(r.id ?? ""), params, access];
      });
      parts.push(renderTable(cols, rows, tableOpts));
    } else {
      parts.push(styler.dim("Функции не найдены."));
    }
    parts.push(
      dimLine(
        styler,
        `Показано ${data.targets.length} из ${String(data.total ?? data.targets.length)}`,
        typeof data.serverOnlyHidden === "number" && data.serverOnlyHidden > 0
          ? `только для кода на сервере: ${data.serverOnlyHidden} (--all)`
          : undefined,
        typeof data.nextCursor === "number" ? `далее: --cursor ${data.nextCursor}` : undefined,
      ),
    );
    if (Array.isArray(data.skipped) && data.skipped.length > 0) {
      parts.push(styler.yellow(`Пропущены библиотеки: ${data.skipped.join(", ")}.`));
    }
    return { text: `${parts.join("\n")}\n` };
  }

  if (op === "rpc.describe" && isRecord(data)) {
    const params = Array.isArray(data.parameters) ? data.parameters.join(", ") : "";
    const access =
      data.serverOnly === true || data.allowed === false
        ? "только код на сервере"
        : data.allowed === true
          ? "разрешён с клиента"
          : "не указан";
    const parts: string[] = [
      styler.bold(`${String(data.id ?? "")}(${params})`),
      renderCard([["Доступ", access]], styler),
    ];
    if (typeof data.note === "string" && data.note) parts.push(styler.yellow(data.note));
    if (typeof data.code === "string") {
      parts.push("", data.code.replace(/^(?:\r?\n)+/, "").replace(/[ \t\r\n]+$/, ""));
      if (data.codeTruncated === true) parts.push(styler.dim("(код обрезан до 8 КиБ)"));
    }
    return { text: `${parts.join("\n")}\n` };
  }

  if (op === "native.lds.loadDoc") {
    const xml = extractDocXml(data);
    if (xml !== undefined) return { text: ensureNewline(xml) };
  }

  if (op === "native.lds.putDoc") {
    const url = typeof options.requestArgs?.url === "string" ? options.requestArgs.url : undefined;
    const entries: [string, string][] = [...(url ? ([["URL", url]] as [string, string][]) : [])];
    return {
      text: `${styler.bold(styler.green("✓ Документ сохранён"))}${entries.length ? `\n${renderCard(entries, styler)}` : ""}\n`,
    };
  }

  if ((op === "cli.files.edit" || op === "cli.object.edit") && isRecord(data)) {
    if (data.changed === false) return { text: `${styler.dim("Изменений нет.")}\n` };
  }

  if (op === "cli.config.list" && isRecord(data) && Array.isArray(data.connections)) {
    const legacy = data.legacy === true ? " (старый формат)" : "";
    const parts: string[] = [styler.dim(`Файл подключений: ${String(data.path ?? "")}${legacy}`)];
    if (data.connections.length > 0) {
      const cols: TableColumn[] = [
        { header: "Подключение" },
        { header: "Адрес" },
        { header: "Права" },
        { header: "Учётные данные" },
      ];
      const rows = data.connections.map((item) => {
        const r = isRecord(item) ? item : {};
        const isDef = r.default === true;
        const name = String(r.name ?? "");
        const cred = isRecord(r.credentials) ? renderCredentialSource(r.credentials) : "нет";
        return [
          isDef ? styler.green(`* ${name}`) : `  ${name}`,
          String(r.baseUrl ?? ""),
          formatPermissions(r.permissions),
          cred,
        ];
      });
      parts.push("", renderTable(cols, rows, tableOpts));
    } else {
      parts.push(styler.dim("Подключений нет."));
    }
    return { text: `${parts.join("\n")}\n` };
  }

  if (op === "cli.config.init" && isRecord(data)) {
    const entries: [string, string][] = [
      ["Подключение", styler.bold(String(data.connection ?? ""))],
      ["Файл", String(data.path ?? "")],
      ...(typeof data.defaultConnection === "string"
        ? ([["По умолчанию", data.defaultConnection]] as [string, string][])
        : []),
      ["Права", formatPermissions(data.permissions)],
      ...(typeof data.next === "string" ? ([["Дальше", data.next]] as [string, string][]) : []),
    ];
    return {
      text: `${styler.bold(styler.green("✓ Подключение сохранено"))}\n${renderCard(entries, styler)}\n`,
    };
  }

  if (op === "cli.config.set" && isRecord(data)) {
    const conn = isRecord(data.connection) ? data.connection : {};
    const entries: [string, string][] = [
      ["Подключение", styler.bold(String(conn.name ?? ""))],
      ...(typeof conn.baseUrl === "string"
        ? ([["Адрес", conn.baseUrl]] as [string, string][])
        : []),
      ["Файл", String(data.path ?? "")],
      ...(typeof data.defaultConnection === "string"
        ? ([["По умолчанию", data.defaultConnection]] as [string, string][])
        : []),
      ["Права", formatPermissions(conn.permissions)],
    ];
    for (const [key, label] of [
      ["timeoutMs", "Таймаут, мс"],
      ["maxResponseBytes", "Предел ответа"],
      ["outputLimitBytes", "Предел вывода"],
      ["runtimeDir", "Папка сохранённых результатов"],
      ["resultsMaxBytes", "Предел результатов"],
      ["resultsMaxAgeDays", "Срок результатов, дн."],
      ["journalMaxBytes", "Журнал записей"],
    ] as const) {
      if (conn[key] !== undefined) entries.push([label, String(conn[key])]);
    }
    return {
      text: `${styler.bold(styler.green("✓ Подключение обновлено"))}\n${renderCard(entries, styler)}\n`,
    };
  }

  if (op === "cli.config.use" && isRecord(data)) {
    const conn = isRecord(data.connection) ? data.connection : {};
    const entries: [string, string][] = [
      ["По умолчанию", styler.bold(String(data.defaultConnection ?? conn.name ?? ""))],
      ...(typeof conn.baseUrl === "string"
        ? ([["Адрес", conn.baseUrl]] as [string, string][])
        : []),
      ["Права", formatPermissions(conn.permissions)],
      ["Файл", String(data.path ?? "")],
    ];
    return {
      text: `${styler.bold(styler.green("✓ Подключение по умолчанию изменено"))}\n${renderCard(entries, styler)}\n`,
    };
  }

  if (op === "cli.config.remove" && isRecord(data)) {
    const removed = isRecord(data.removed) ? data.removed : {};
    const remaining = Array.isArray(data.remaining) ? data.remaining : [];
    const entries: [string, string][] = [
      ["Удалено", styler.bold(String(removed.name ?? ""))],
      ...(typeof removed.baseUrl === "string"
        ? ([["Адрес", removed.baseUrl]] as [string, string][])
        : []),
      ["По умолчанию", typeof data.defaultConnection === "string" ? data.defaultConnection : "—"],
      ["Осталось", remaining.length ? remaining.map(String).join(", ") : "нет"],
      ["Файл", String(data.path ?? "")],
    ];
    return {
      text: `${styler.bold(styler.green("✓ Подключение удалено"))}\n${renderCard(entries, styler)}\n`,
    };
  }

  if (op === "cli.config.path" && isRecord(data)) {
    const entries: [string, string][] = [
      ["Файл", String(data.path ?? "")],
      ["Состояние", data.exists === true ? styler.green("существует") : styler.yellow("не создан")],
    ];
    return { text: `${renderCard(entries, styler)}\n` };
  }

  if (op === "cli.config.example") {
    return { text: `${JSON.stringify(data, null, 2)}\n` };
  }

  if (op === "api.list" && isRecord(data)) {
    if (Array.isArray(data.topics)) {
      const cols: TableColumn[] = [
        { header: "Тема" },
        { header: "Описание" },
        { header: "Операции" },
      ];
      const rows = data.topics.map((item) => {
        const r = isRecord(item) ? item : {};
        const ops = Array.isArray(r.operations)
          ? r.operations.join(", ")
          : typeof r.count === "number"
            ? `${r.count} шт.`
            : "";
        return [styler.cyan(String(r.topic ?? "")), String(r.title ?? ""), ops];
      });
      const effects = isRecord(data.effects)
        ? Object.entries(data.effects)
            .map(([k, v]) => `${k}: ${String(v)}`)
            .join(", ")
        : "";
      const parts = [
        renderTable(cols, rows, tableOpts),
        styler.dim(`Всего операций: ${String(data.total ?? "")}${effects ? ` (${effects})` : ""}`),
      ];
      if (typeof data.hint === "string" && data.hint) parts.push(styler.dim(data.hint));
      return { text: `${parts.join("\n")}\n` };
    }
    if (Array.isArray(data.operations)) {
      const parts: string[] = [];
      if (data.operations.length > 0) {
        const cols: TableColumn[] = [
          { header: "ID" },
          { header: "Тема" },
          { header: "Эффект" },
          { header: "Описание" },
        ];
        const rows = data.operations.map((item) => {
          const r = isRecord(item) ? item : {};
          return [
            String(r.id ?? ""),
            String(r.topic ?? ""),
            String(r.effect ?? ""),
            String(r.description ?? ""),
          ];
        });
        parts.push(renderTable(cols, rows, tableOpts));
      } else {
        parts.push(styler.dim("Операции не найдены."));
      }
      parts.push(
        dimLine(
          styler,
          `Показано ${data.operations.length} из ${String(data.total ?? data.operations.length)}`,
          typeof data.nextCursor === "number" ? `далее: --cursor ${data.nextCursor}` : undefined,
        ),
      );
      if (typeof data.hint === "string" && data.hint) parts.push(styler.dim(data.hint));
      return { text: `${parts.join("\n")}\n` };
    }
  }

  if (op === "api.describe" && isRecord(data)) {
    return { text: renderApiDescribe(data, styler) };
  }

  if (op === "results.read" && isRecord(data)) {
    if (typeof data.text === "string") {
      const footer = dimLine(
        styler,
        `Символов всего: ${String(data.totalChars ?? data.text.length)}`,
        data.cutBySize === true ? "обрезано по размеру" : undefined,
        typeof data.nextOffset === "number" ? `далее: --offset ${data.nextOffset}` : undefined,
      );
      return { text: `${ensureNewline(data.text)}${footer}\n` };
    }
    if (Array.isArray(data.items)) {
      const parts: string[] = [];
      if (isRecord(data.blockedItem)) {
        parts.push(
          styler.yellow(
            `Элемент #${String(data.blockedItem.index ?? 0)} (${formatBytes(Number(data.blockedItem.bytes ?? 0))}) не помещается в ответ.`,
          ),
        );
        if (typeof data.hint === "string") parts.push(styler.dim(data.hint));
      } else {
        const table = extractTable(op, data);
        if (table && table.headers.length > 0 && table.rows.length > 0) {
          parts.push(renderExtractedTable(table, tableOpts));
        } else if (data.items.length > 0) {
          parts.push(renderStructured(data.items, styler));
        } else {
          parts.push(styler.dim("Элементов нет."));
        }
      }
      parts.push(
        dimLine(
          styler,
          `Показано ${data.items.length} из ${String(data.total ?? data.items.length)}`,
          data.cutBySize === true ? "обрезано по размеру" : undefined,
          typeof data.nextOffset === "number" ? `далее: --offset ${data.nextOffset}` : undefined,
        ),
      );
      return { text: `${parts.join("\n")}\n` };
    }
  }

  if (op === "results.export" && isRecord(data)) {
    const bytes = typeof data.bytes === "number" ? data.bytes : 0;
    const entries: [string, string][] = [
      ["Файл", String(data.path ?? "")],
      ["Формат", String(data.format ?? "")],
      ["Размер", `${formatBytes(bytes)} (${bytes} Б)`],
      ...(typeof data.items === "number"
        ? ([["Элементов", String(data.items)]] as [string, string][])
        : []),
    ];
    return {
      text: `${styler.bold(styler.green("✓ Результат сохранён"))}\n${renderCard(entries, styler)}\n`,
    };
  }

  if (op === "runtime.batch" && isRecord(data) && Array.isArray(data.results)) {
    const completed = Number(data.completed ?? data.results.length);
    const requested = Number(data.requested ?? data.results.length);
    const lines: string[] = [
      styler.bold(`Пакет операций: выполнено ${completed} из ${requested}`),
      "",
    ];
    for (const [index, raw] of data.results.entries()) {
      if (!isRecord(raw)) continue;
      const ok = raw.ok === true;
      const meta = isRecord(raw.meta) ? raw.meta : {};
      const stepOp = String(meta.operationId ?? "");
      const as = typeof raw.as === "string" ? ` (${raw.as})` : "";
      const duration =
        typeof meta.durationMs === "number"
          ? styler.dim(` ${formatDuration(meta.durationMs)}`)
          : "";
      const err = isRecord(raw.error) ? raw.error : undefined;
      const detail = err
        ? ` — ${styler.red(`[${String(err.code ?? "ERROR")}]`)} ${String(err.message ?? "")}`
        : isRecord(raw.data) && typeof raw.data.id === "string"
          ? styler.dim(` · id=${raw.data.id}`)
          : "";
      const mark = ok ? styler.green("✓") : styler.red("✗");
      lines.push(`  ${mark} #${index + 1}${as} ${stepOp}${duration}${detail}`);
    }
    return { text: `${lines.join("\n")}\n` };
  }

  if (op === "agents.run" && isRecord(data)) {
    const started = data.started === true;
    const status = typeof data.status === "string" ? data.status : undefined;
    const threadId = typeof data.threadId === "string" && data.threadId ? data.threadId : undefined;
    const roleUID = typeof data.roleUID === "string" && data.roleUID ? data.roleUID : undefined;
    const startedAt = typeof data.startedAt === "string" ? data.startedAt : "";
    const finishedAt = typeof data.finishedAt === "string" ? data.finishedAt : "";
    const duration =
      startedAt && finishedAt ? formatIsoIntervalDuration(startedAt, finishedAt) : undefined;
    const interval =
      startedAt && finishedAt
        ? `${startedAt} – ${finishedAt}${duration ? ` (${duration})` : ""}`
        : startedAt || finishedAt;
    const connFlag = options.connectionArg
      ? options.connectionArg.startsWith("-")
        ? `--connection=${options.connectionArg} `
        : `-c ${options.connectionArg} `
      : "";
    const logType = started ? "xhttp" : "agent";
    const startMatch = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/.exec(startedAt);
    const finishMatch = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/.exec(finishedAt);
    const sameDay = startMatch !== null && finishMatch !== null && startMatch[1] === finishMatch[1];
    const startMin = startMatch?.[2]?.slice(0, 5);
    const finishMin = finishMatch?.[2]?.slice(0, 5);
    const sameMinute = sameDay && startMin === finishMin;
    const sameHour = sameDay && startMatch[2]!.slice(0, 2) === finishMatch[2]!.slice(0, 2);
    const minuteNumber = (hhmm: string): number =>
      Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
    const adjacentMinutes =
      sameDay &&
      startMin !== undefined &&
      finishMin !== undefined &&
      Math.abs(minuteNumber(finishMin) - minuteNumber(startMin)) === 1;
    const searchQuery = sameMinute
      ? startMatch[2] === finishMatch[2]
        ? startMatch[2]!
        : startMin!
      : undefined;
    const logCommand = searchQuery
      ? `wtctl ${connFlag}logs search ${logType} ${searchQuery}  ·  wtctl ${connFlag}logs tail ${logType}`
      : adjacentMinutes && startMin && finishMin
        ? `wtctl ${connFlag}logs search ${logType} ${startMin}  ·  wtctl ${connFlag}logs search ${logType} ${finishMin}`
        : sameHour && startMatch
          ? `wtctl ${connFlag}logs search ${logType} ${startMatch[2]!.slice(0, 3)}  ·  wtctl ${connFlag}logs tail ${logType}`
          : sameDay && startMin
            ? `wtctl ${connFlag}logs search ${logType} ${startMin}  ·  wtctl ${connFlag}logs tail ${logType}`
            : startMatch && finishMatch && !sameDay
              ? `wtctl ${connFlag}logs tail ${logType}  ·  wtctl ${connFlag}logs list --type ${logType} --start-date ${startMatch[1]} --end-date ${finishMatch[1]}`
              : `wtctl ${connFlag}logs tail ${logType}  ·  wtctl ${connFlag}logs search ${logType}`;
    const stateLabel = started
      ? status === "running"
        ? styler.bold(styler.cyan("Запущен в фоне"))
        : status === "cancelled"
          ? styler.bold(styler.yellow("Запущен и отменён"))
          : status === "unknown"
            ? styler.bold(styler.yellow("Запущен (состояние неизвестно)"))
            : styler.bold(styler.green("Запущен и завершён"))
      : status === "running"
        ? styler.bold(styler.yellow("Уже выполняется"))
        : styler.bold(styler.yellow("Не запущен"));
    const entries: [string, string][] = [
      ["Состояние", stateLabel],
      ...(threadId ? ([["Поток", styler.bold(threadId)]] as [string, string][]) : []),
      ...(roleUID ? ([["Роль", roleUID]] as [string, string][]) : []),
      ...(interval
        ? ([[finishedAt ? "Интервал" : "Запущен", interval]] as [string, string][])
        : []),
      ...(status === "running" && threadId
        ? ([
            [
              "Проверка",
              `wtctl ${connFlag}agent status --thread ${threadId} --wait  ·  wtctl ${connFlag}agent cancel ${threadId}`,
            ],
          ] as [string, string][])
        : ([["Лог", logCommand]] as [string, string][])),
    ];
    const parts: string[] = [renderCard(entries, styler)];
    if (!started && status === "running") {
      parts.push(styler.dim("Для параллельного запуска добавьте --allow-concurrent."));
    }
    let stderrNote: string | undefined;

    if (isRecord(data.logs)) {
      const hasWarning = typeof data.logs.warning === "string" && data.logs.warning.length > 0;
      if (hasWarning) {
        stderrNote = `${styler.yellow(`Предупреждение: ${String(data.logs.warning)}`)}\n`;
      }
      const filesList = Array.isArray(data.logs.files)
        ? data.logs.files.filter((item): item is string => typeof item === "string" && item !== "")
        : [];
      const fileLabel =
        filesList.length > 0
          ? filesList.join(", ")
          : typeof data.logs.file === "string" && data.logs.file
            ? data.logs.file
            : String(data.logs.type ?? logType);
      const events = Array.isArray(data.logs.events) ? data.logs.events : [];
      if (events.length > 0) {
        parts.push("", styler.dim(`События в логе ${fileLabel} (${events.length}):`));
        parts.push(...renderLogEvents(events, styler));
      } else if (!hasWarning) {
        parts.push("", styler.dim(`В логе ${fileLabel} событий за интервал не найдено.`));
      }
    }

    return {
      text: `${parts.join("\n")}\n`,
      ...(stderrNote === undefined ? {} : { stderrNote }),
    };
  }

  if (op === "agents.status" && isRecord(data) && Array.isArray(data.runs)) {
    const parts: string[] = [];
    if (data.runs.length > 0) {
      const cols: TableColumn[] = [
        { header: "Поток" },
        { header: "Код" },
        { header: "Название" },
        { header: "Состояние" },
        { header: "Старт" },
        { header: "Конец" },
      ];
      const rows = data.runs.map((item) => {
        const r = isRecord(item) ? item : {};
        const status = String(r.status ?? "");
        const state =
          status === "running"
            ? styler.cyan("Выполняется")
            : status === "finished"
              ? styler.green("Завершён")
              : status === "cancelled"
                ? styler.yellow("Отменён")
                : status || "—";
        return [
          String(r.threadId ?? ""),
          String(r.code ?? ""),
          String(r.name ?? ""),
          state,
          String(r.startedAt ?? ""),
          String(r.finishedAt ?? "—"),
        ];
      });
      parts.push(renderTable(cols, rows, tableOpts));
      parts.push(
        styler.dim(`Показано ${data.runs.length} из ${String(data.total ?? data.runs.length)}`),
      );
    } else {
      parts.push(styler.dim("Запусков агентов не найдено."));
    }
    return { text: `${parts.join("\n")}\n` };
  }

  if (op === "agents.cancel" && isRecord(data)) {
    const connFlag = options.connectionArg
      ? options.connectionArg.startsWith("-")
        ? `--connection=${options.connectionArg} `
        : `-c ${options.connectionArg} `
      : "";
    const threadId = typeof data.threadId === "string" ? data.threadId : undefined;
    const roleUID = typeof data.roleUID === "string" ? data.roleUID : undefined;
    const entries: [string, string][] = [
      ...(threadId ? ([["Поток", styler.bold(threadId)]] as [string, string][]) : []),
      ...(roleUID ? ([["Роль", roleUID]] as [string, string][]) : []),
      ["Исход", String(data.mutationOutcome ?? "confirmed")],
    ];
    const parts = [
      styler.bold(styler.green("✓ Запрос на отмену агента отправлен")),
      renderCard(entries, styler),
      styler.dim(
        threadId
          ? `Уже сделанные изменения не откатываются. Состояние: wtctl ${connFlag}agent status --thread ${threadId}`
          : "Уже сделанные изменения не откатываются.",
      ),
    ];
    return { text: `${parts.join("\n")}\n` };
  }

  if (op === "web.spxml.getBackgroundTasksByName") {
    const tasks = normalizeBackgroundTasks(data);
    const parts: string[] = [];
    if (tasks.length > 0) {
      const cols: TableColumn[] = [
        { header: "ID" },
        { header: "Состояние" },
        { header: "Старт" },
        { header: "Детали" },
      ];
      const rows = tasks.map((task) => {
        const { running, finished, hasError } = parseTaskState(task);
        const state = running
          ? styler.cyan("Выполняется")
          : finished && hasError
            ? styler.red("Ошибка")
            : finished
              ? styler.green("Завершена")
              : String(task.IsRunning ?? "—");
        return [
          String(task.TrackingID ?? ""),
          state,
          String(task.StartDate ?? ""),
          summarizeTaskDetails(task),
        ];
      });
      parts.push(renderTable(cols, rows, tableOpts));
      parts.push(styler.dim(`Всего задач: ${tasks.length}`));
    } else {
      parts.push(styler.dim("Фоновых задач не найдено."));
      if (options.requestArgs?.libName === "" && options.requestArgs?.methodName === "") {
        parts.push(styler.dim("Имя функции задаётся так: wtctl tasks list БИБЛИОТЕКА.ФУНКЦИЯ"));
      }
    }
    return { text: `${parts.join("\n")}\n` };
  }

  if (op === "web.spxml.getAsyncMethodStatus" && isRecord(data)) {
    const trackingId =
      (typeof data.TrackingID === "string" && data.TrackingID) ||
      (typeof options.requestArgs?.trackingId === "string"
        ? options.requestArgs.trackingId
        : undefined);
    const { running, finished, errCode, errText, hasError } = parseTaskState(data);
    const state = running
      ? styler.cyan("Выполняется")
      : finished && hasError
        ? styler.red("Завершена с ошибкой")
        : finished
          ? styler.green("Завершена")
          : String(data.IsRunning ?? "—");

    const entries: [string, string][] = [
      ...(trackingId ? ([["TrackingID", styler.bold(trackingId)]] as [string, string][]) : []),
      ["Состояние", state],
      ...(data.Progress !== undefined && data.Progress !== null && data.Progress !== ""
        ? ([["Прогресс", formatInline(data.Progress)]] as [string, string][])
        : []),
      ...(errCode ? ([["Код ошибки", styler.red(errCode)]] as [string, string][]) : []),
      ...(errText ? ([["Ошибка", styler.red(errText)]] as [string, string][]) : []),
    ];

    let structuredBlock: string | undefined;
    if ("value" in data) {
      const value = data.value;
      if (
        value === null ||
        typeof value === "boolean" ||
        typeof value === "number" ||
        typeof value === "bigint" ||
        (typeof value === "string" && !value.includes("\n") && value.length <= 120)
      ) {
        entries.push(["Результат", formatInline(value)]);
      } else {
        structuredBlock = renderStructured(value, styler, 2);
      }
    } else if (
      data.ResultData !== undefined &&
      data.ResultData !== null &&
      data.ResultData !== ""
    ) {
      structuredBlock = renderStructured(data.ResultData, styler, 2);
    }

    const parts: string[] = [renderCard(entries, styler)];
    if (structuredBlock !== undefined) {
      parts.push("", styler.dim("Результат:"), structuredBlock);
    }
    if (finished) {
      parts.push(styler.dim("Сервер удалил запись о задаче после выдачи итога."));
    }
    return { text: `${parts.join("\n")}\n` };
  }

  if (op === "web.spxml.killAsyncMethod") {
    const trackingId =
      typeof options.requestArgs?.trackingId === "string"
        ? options.requestArgs.trackingId
        : undefined;
    const entries: [string, string][] = [
      ...(trackingId ? ([["TrackingID", styler.bold(trackingId)]] as [string, string][]) : []),
      ["Состояние", "Запрос отправлен"],
    ];
    const parts = [
      styler.bold(styler.green("✓ Запрос на остановку задачи отправлен")),
      renderCard(entries, styler),
      styler.dim("Уже сделанные изменения не откатываются."),
    ];
    return { text: `${parts.join("\n")}\n` };
  }

  if (op === "execute.script" && isRecord(data) && Array.isArray(data.result)) {
    const parts: string[] = [];
    const table = extractTable(op, data);
    if (table && table.headers.length > 0 && table.rows.length > 0) {
      parts.push(renderExtractedTable(table, tableOpts));
    } else if (data.result.length === 0) {
      parts.push(styler.dim("Пустой результат (RESULT = [])."));
    } else {
      parts.push(renderStructured(data.result, styler));
    }
    if (isRecord(data.data) && Object.keys(data.data).length > 0) {
      parts.push("", styler.dim("Дополнительно:"), renderStructured(data.data, styler, 2));
    }
    const execId = typeof data.executionId === "string" ? ` · ${data.executionId}` : "";
    parts.push(styler.dim(`Строк: ${data.result.length}${execId}`));
    return { text: `${parts.join("\n")}\n` };
  }

  if (op === "rpc.call" && isRecord(data) && "value" in data) {
    if (typeof data.value === "string" && data.value.includes("\n")) {
      return { text: ensureNewline(data.value) };
    }
    if (Array.isArray(data.value)) {
      const keys = collectObjectKeys(data.value);
      if (keys && keys.length > 0) {
        const cols: TableColumn[] = keys.map((header) => ({ header }));
        const rows = data.value.map((item) =>
          keys.map((key) => tabularCellText((item as Record<string, unknown>)[key])),
        );
        return { text: `${renderTable(cols, rows, tableOpts)}\n` };
      }
    }
    return { text: `${renderStructured(data.value, styler)}\n` };
  }

  return { text: `${renderStructured(data, styler)}\n` };
}

/** Читаемое форматирование ошибки для stderr в терминале. */
export function formatHumanError(result: OperationResult, styler: Styler): string {
  const err = result.error;
  if (!err) return `${styler.bold(styler.red("Ошибка:"))} Операция не выполнена.\n`;

  const lines: string[] = [`${styler.bold(styler.red(`Ошибка [${err.code}]:`))} ${err.message}`];

  const scriptError = err.details?.scriptError;
  if (typeof scriptError === "string" && scriptError.trim() !== "") {
    lines.push(styler.dim("Ошибка кода на сервере:"));
    for (const line of scriptError.split(/\r?\n/)) {
      lines.push(`  ${line}`);
    }
  }

  if (err.mutationOutcome === "confirmed" && typeof err.details?.threadId === "string") {
    const role =
      typeof err.details.roleUID === "string" && err.details.roleUID
        ? `, роль: ${err.details.roleUID}`
        : "";
    lines.push(
      styler.yellow(`Агент сервера запущен (confirmed), поток: ${err.details.threadId}${role}.`),
    );
  }

  if (err.mutationOutcome === "indeterminate") {
    lines.push(
      styler.yellow(
        "Внимание: исход записи не определён (indeterminate) — запись могла пройти. Перед повтором проверить состояние на сервере.",
      ),
    );
    const refs = (["objectId", "url", "mutationId", "executionId"] as const)
      .map((key) =>
        typeof err.details?.[key] === "string" ? `${key}=${err.details[key]}` : undefined,
      )
      .filter(Boolean);
    if (refs.length) lines.push(styler.dim(`Ссылки для проверки: ${refs.join(", ")}`));
  }

  if (isRecord(result.data) && result.data.receiptOnly === true) {
    const receipt = result.data;
    const receiptRefs = (
      [
        "id",
        "mutationOutcome",
        "mutationId",
        "resultId",
        "executionId",
        "TrackingID",
        "output",
      ] as const
    )
      .map((key) => (typeof receipt[key] === "string" ? `${key}=${receipt[key]}` : undefined))
      .filter(Boolean);
    if (receiptRefs.length)
      lines.push(styler.dim(`Сведения о результате: ${receiptRefs.join(", ")}`));
  }

  const storedId =
    typeof result.meta.resultId === "string"
      ? result.meta.resultId
      : isRecord(result.data) && typeof result.data.resultId === "string"
        ? result.data.resultId
        : undefined;
  if (storedId && !(isRecord(result.data) && result.data.receiptOnly === true)) {
    lines.push(
      styler.dim(
        `Сохранённый результат: ${storedId} (wtctl result read ${storedId} · wtctl result export ${storedId} --to ФАЙЛ)`,
      ),
    );
  }

  if (err.hint) {
    lines.push(`${styler.cyan("Подсказка:")} ${err.hint}`);
  }

  return `${lines.join("\n")}\n`;
}
