import { CliInputError, jsonObject, parseJson, type OrderedOption } from "./arguments.js";

const FORBIDDEN_PATH_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const SAFE_INT_RE = /^-?(?:0|[1-9]\d{0,14})$/;

const COLON_WHERE_RE = /^([A-Za-z_][A-Za-z0-9_]*):(eq|ne|gt|gte|lt|lte|contains|in)=([\s\S]*)$/;
const UNKNOWN_COLON_WHERE_RE = /^([A-Za-z_][A-Za-z0-9_]*):([^=]+)=([\s\S]*)$/;
const SYMBOL_WHERE_RE = /^([A-Za-z_][A-Za-z0-9_]*)(!=|>=|<=|=|>|<|~)([\s\S]*)$/;

const SYMBOL_TO_OP: Record<string, "eq" | "ne" | "contains" | "gt" | "gte" | "lt" | "lte"> = {
  "=": "eq",
  "!=": "ne",
  "~": "contains",
  ">": "gt",
  ">=": "gte",
  "<": "lt",
  "<=": "lte",
};

export interface KeyValueEntry {
  readonly key: string;
  readonly value: unknown;
}

export type PatchFlagOp =
  | { readonly op: "set"; readonly path: string; readonly value: unknown }
  | { readonly op: "remove"; readonly path: string };

function assertSafePathKey(key: string, label: string): void {
  if (FORBIDDEN_PATH_KEYS.has(key)) throw new CliInputError(`Недопустимое имя ${label}: «${key}».`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function setOwnProperty(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

/** Скаляр для позиционных аргументов rpc и -p ключ=значение в exec: 64-битные ID и ведущие нули остаются строками. */
export function parseScalarArg(raw: string): string | number | boolean | null {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  if (SAFE_INT_RE.test(raw)) return raw === "-0" ? 0 : Number(raw);
  return raw;
}

/** Скаляр для -w: числа, даты и 0x… оставляются строками, их типизирует query.ts по форме каталога. */
function parseWhereScalar(raw: string): string | boolean | null {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  return raw;
}

function isWhereScalar(value: unknown): boolean {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function toOperatorMap(field: string, value: unknown): Record<string, unknown> {
  if (isWhereScalar(value)) return { eq: value };
  if (isPlainObject(value) && Object.keys(value).length > 0) return value;
  throw new CliInputError(`Конфликтующие условия для поля «${field}».`);
}

function mergeWhereCondition(
  merged: Record<string, unknown>,
  field: string,
  incoming: unknown,
): void {
  if (!Object.hasOwn(merged, field)) {
    setOwnProperty(merged, field, incoming);
    return;
  }
  const left = toOperatorMap(field, merged[field]);
  const right = toOperatorMap(field, incoming);
  const combined: Record<string, unknown> = {};
  for (const [op, val] of Object.entries(left)) setOwnProperty(combined, op, val);
  for (const [op, val] of Object.entries(right)) {
    if (Object.hasOwn(combined, op))
      throw new CliInputError(`Для поля «${field}» оператор ${op} задан больше одного раза.`);
    setOwnProperty(combined, op, val);
  }
  setOwnProperty(merged, field, combined);
}

function buildOperatorCondition(field: string, op: string, rawValue: string): unknown {
  if (op === "eq") return parseWhereScalar(rawValue);
  if (op === "contains") return { contains: rawValue };
  if (op === "in") {
    const trimmed = rawValue.trim();
    if (!trimmed)
      throw new CliInputError(
        `Условие «${field}:in=» требует непустой список значений через запятую.`,
      );
    // PowerShell без кавычек передаёт обёртке npm a,b,c массивом, а та склеивает его через пробел.
    const parts = rawValue.includes(",")
      ? rawValue.split(",").map((part) => part.trim())
      : trimmed.split(/\s+/);
    if (parts.some((part) => part === ""))
      throw new CliInputError(`Условие «${field}:in=» не допускает пустые значения в списке.`);
    return { in: parts.map(parseWhereScalar) };
  }
  return { [op]: parseWhereScalar(rawValue) };
}

/** Разбирает и объединяет один или несколько флагов -w / --where (выражения и JSON-объекты). */
export function parseWhereFlags(entries: readonly string[]): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const entry of entries) {
    if (entry.trimStart().startsWith("{")) {
      const object = jsonObject(entry);
      for (const [field, value] of Object.entries(object))
        mergeWhereCondition(merged, field, value);
      continue;
    }
    const colon = COLON_WHERE_RE.exec(entry);
    if (colon) {
      const [, field, op, rawValue] = colon;
      mergeWhereCondition(merged, field!, buildOperatorCondition(field!, op!, rawValue!));
      continue;
    }
    const unknownColon = UNKNOWN_COLON_WHERE_RE.exec(entry);
    if (unknownColon) {
      throw new CliInputError(
        `Неизвестный оператор условия «:${unknownColon[2]}».`,
        "Допустимы: eq, ne, gt, gte, lt, lte, contains, in.",
      );
    }
    const symbol = SYMBOL_WHERE_RE.exec(entry);
    if (symbol) {
      const [, field, sym, rawValue] = symbol;
      const op = SYMBOL_TO_OP[sym!]!;
      mergeWhereCondition(merged, field!, buildOperatorCondition(field!, op, rawValue!));
      continue;
    }
    throw new CliInputError(
      "Неверный формат --where: нужно поле=значение, поле:op=значение или объект JSON.",
      "Операторы: =, !=, ~, >, >=, <, <= или :eq=, :ne=, :contains=, :gt=, :gte=, :lt=, :lte=, :in=a,b.",
    );
  }
  return merged;
}

/** Находит первый «=» (при respectBrackets — вне […], где скобка закрывается первым «]», как в patchSegments). */
function findAssignmentEquals(entry: string, respectBrackets: boolean): number {
  if (!respectBrackets) return entry.indexOf("=");
  let inBracket = false;
  for (let index = 0; index < entry.length; index++) {
    const ch = entry[index];
    if (ch === "[") inBracket = true;
    else if (ch === "]") inBracket = false;
    else if (ch === "=" && !inBracket) return index;
  }
  return -1;
}

function parseKeyValue(
  entry: string,
  flag: string,
  valueLabel: string,
  kind: "string" | "json" | "scalar",
  respectBrackets: boolean,
): KeyValueEntry {
  const eq = findAssignmentEquals(entry, respectBrackets);
  const key = eq >= 0 ? entry.slice(0, eq).trim() : "";
  if (eq <= 0 || !key)
    throw new CliInputError(`Для --${flag} нужен вид ${valueLabel} с непустым именем до «=».`);
  const raw = entry.slice(eq + 1);
  if (kind === "json") {
    if (!raw.trim()) throw new CliInputError(`Для --${flag} нужно значение JSON после «=».`);
    return { key, value: parseJson(raw) };
  }
  return { key, value: kind === "scalar" ? parseScalarArg(raw) : raw };
}

/** Разбирает -s/--set и --set-json для object create в точном порядке флагов в argv. */
export function parseCreateSetFlags(entries: readonly OrderedOption[]): KeyValueEntry[] {
  return entries.map(({ name, value }) =>
    parseKeyValue(
      value,
      name,
      name === "set-json" ? "ПУТЬ=JSON" : "ПУТЬ=ЗНАЧЕНИЕ",
      name === "set-json" ? "json" : "string",
      false,
    ),
  );
}

/** Разбирает -s/--set, --set-json и --remove для object patch в точном порядке флагов в argv. */
export function parsePatchFlags(entries: readonly OrderedOption[]): PatchFlagOp[] {
  return entries.map(({ name, value }) => {
    if (name === "remove") {
      const path = value.trim();
      if (!path) throw new CliInputError("Путь в --remove не может быть пустым.");
      return { op: "remove", path };
    }
    const parsed = parseKeyValue(
      value,
      name,
      name === "set-json" ? "ПУТЬ=JSON" : "ПУТЬ=ЗНАЧЕНИЕ",
      name === "set-json" ? "json" : "string",
      true,
    );
    return { op: "set", path: parsed.key, value: parsed.value };
  });
}

function isWholePatchInput(
  input: Record<string, unknown>,
): input is { patch?: unknown; remove?: string[] } {
  const keys = Object.keys(input);
  return (
    keys.length > 0 &&
    keys.every((key) => key === "patch" || key === "remove") &&
    (!("patch" in input) || (input.patch !== null && typeof input.patch === "object")) &&
    (!("remove" in input) || Array.isArray(input.remove))
  );
}

function objectToSetOps(record: Record<string, unknown>): PatchFlagOp[] {
  return Object.entries(record).map(([path, value]) => ({ op: "set", path, value }));
}

/** Собирает аргументы patch/remove для objects.patch, сохраняя порядок ввода из файла и всех флагов. */
export function mergePatchInput(
  base: unknown,
  flagOps: readonly PatchFlagOp[],
  resave: boolean,
): Record<string, unknown> {
  if (base === undefined) {
    if (flagOps.length === 0) return {};
    let seenRemove = false;
    let needsArray = false;
    const seenSet = new Set<string>();
    for (const op of flagOps) {
      if (op.op === "remove") {
        seenRemove = true;
      } else {
        if (seenRemove || seenSet.has(op.path)) {
          needsArray = true;
          break;
        }
        seenSet.add(op.path);
      }
    }
    if (needsArray) return { patch: [...flagOps] };
    const patch: Record<string, unknown> = {};
    const remove: string[] = [];
    let hasSets = false;
    for (const op of flagOps) {
      if (op.op === "set") {
        setOwnProperty(patch, op.path, op.value);
        hasSets = true;
      } else {
        remove.push(op.path);
      }
    }
    return {
      ...(hasSets ? { patch } : {}),
      ...(remove.length ? { remove } : {}),
    };
  }

  if (base === null || typeof base !== "object")
    throw new CliInputError("Правка — объект {поле: значение} или массив операций.");

  if (flagOps.length === 0) {
    if (!Array.isArray(base) && isWholePatchInput(base as Record<string, unknown>))
      return base as Record<string, unknown>;
    return Array.isArray(base) || Object.keys(base).length || !resave ? { patch: base } : {};
  }

  // Базовая правка всегда превращается в список операций, чтобы правки флагов применялись строго после неё.
  let baseOps: unknown[];
  if (Array.isArray(base)) {
    baseOps = base;
  } else if (isWholePatchInput(base as Record<string, unknown>)) {
    const record = base as { patch?: unknown; remove?: unknown[] };
    const setOps = Array.isArray(record.patch)
      ? record.patch
      : record.patch !== undefined
        ? objectToSetOps(record.patch as Record<string, unknown>)
        : [];
    const removeOps = Array.isArray(record.remove)
      ? record.remove.map((path) => ({ op: "remove", path }))
      : [];
    baseOps = [...setOps, ...removeOps];
  } else {
    baseOps = objectToSetOps(base as Record<string, unknown>);
  }
  return { patch: [...baseOps, ...flagOps] };
}

/** Собирает объект data для objects.create из необязательного JSON-объекта и путей через точку. */
export function buildCreateData(
  base: Record<string, unknown> | undefined,
  entries: readonly KeyValueEntry[],
): Record<string, unknown> {
  const data: Record<string, unknown> = base ? structuredClone(base) : {};
  for (const { key, value } of entries) {
    const segments = key.split(".");
    for (const segment of segments) {
      if (!segment)
        throw new CliInputError(`Неверный путь «${key}»: сегмент не может быть пустым.`);
      assertSafePathKey(segment, "сегмента пути");
    }
    let cursor = data;
    for (let index = 0; index < segments.length - 1; index++) {
      const segment = segments[index]!;
      const existing = Object.hasOwn(cursor, segment) ? cursor[segment] : undefined;
      if (existing === undefined) {
        const next: Record<string, unknown> = {};
        setOwnProperty(cursor, segment, next);
        cursor = next;
      } else if (isPlainObject(existing)) {
        cursor = existing;
      } else {
        const prefix = segments.slice(0, index + 1).join(".");
        throw new CliInputError(
          `Конфликт в пути «${key}»: поле «${prefix}» уже содержит не объект.`,
        );
      }
    }
    const last = segments.at(-1)!;
    const existing = Object.hasOwn(cursor, last) ? cursor[last] : undefined;
    if (isPlainObject(existing) && !isPlainObject(value))
      throw new CliInputError(
        `Конфликт в пути «${key}»: поле «${key}» уже содержит вложенные поля.`,
      );
    setOwnProperty(cursor, last, value);
  }
  return data;
}

/** Разбирает и объединяет повторяемые -p / --params (JSON или ключ=значение) и --param-json в точном порядке argv. */
export function parseExecParams(entries: readonly OrderedOption[]): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const { name, value: entry } of entries) {
    if (name === "param-json") {
      const { key, value } = parseKeyValue(entry, "param-json", "КЛЮЧ=JSON", "json", false);
      setOwnProperty(params, key, value);
      continue;
    }
    if (entry.trimStart().startsWith("{")) {
      for (const [key, value] of Object.entries(jsonObject(entry)))
        setOwnProperty(params, key, value);
      continue;
    }
    const { key, value } = parseKeyValue(entry, "params", "КЛЮЧ=ЗНАЧЕНИЕ", "scalar", false);
    setOwnProperty(params, key, value);
  }
  return params;
}

/** Объединяет позиционный поиск и флаг поиска с проверкой конфликта и пустой строки. */
export function resolvePositionalSearch(
  positional: string | undefined,
  flag: string | undefined,
  flagName: string,
): string | undefined {
  if (positional !== undefined && flag !== undefined)
    throw new CliInputError(`Поиск задан и аргументом, и в --${flagName}.`);
  if (positional !== undefined && !positional.length)
    throw new CliInputError("Строка поиска не может быть пустой.");
  return positional ?? flag;
}
