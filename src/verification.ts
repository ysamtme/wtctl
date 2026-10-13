import { HcmError } from "./errors.js";
import { patchSegments } from "./documents.js";
import { parseXml } from "./protocol/xml.js";

type Field = { path: string; type?: unknown; multiple?: unknown };
/** Первое место, где записанная ветка и сохранённая расходятся, в коротких значениях. */
type Difference = { path: string; requested: unknown; actual: unknown };
const shown = (value: unknown): unknown =>
  value === undefined
    ? null
    : typeof value === "string"
      ? value.length > 200
        ? `${value.slice(0, 200)}…`
        : value
      : Array.isArray(value)
        ? `[список: ${value.length}]`
        : value !== null && typeof value === "object"
          ? "{структура}"
          : value;
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function bool(value: unknown): boolean | undefined {
  if (value === true || value === "true" || value === "1" || value === 1) return true;
  if (value === false || value === "false" || value === "0" || value === 0) return false;
  return undefined;
}
const DATE =
  /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2})(?::(\d{2})(?:\.\d+)?)?)?(?:Z|[+-]\d{2}:\d{2})?$/;
/**
 * Время на часах, которое сервер понимает под значением даты: он хранит дату и время
 * как записаны, отбрасывает смещение и доли секунды и отдаёт значение с секундами и +00:00.
 */
function serverDate(value: unknown): string | undefined {
  const match = typeof value === "string" ? DATE.exec(value) : null;
  return match ? `${match[1]}T${match[2] ?? "00:00"}:${match[3] ?? "00"}` : undefined;
}
/** Читает ли сервер текст как дату; другие записи он хранит как нечто другое. */
export function isServerDate(value: string): boolean {
  return DATE.test(value);
}
function equivalent(
  expected: unknown,
  actual: unknown,
  path: string,
  fields: Map<string, Field>,
  prior?: unknown,
  inCollection = false,
  differences: Difference[] = [],
): boolean {
  const differ = (): false => {
    if (differences.length < 5)
      differences.push({ path, requested: shown(expected), actual: shown(actual) });
    return false;
  };
  const field = fields.get(path.replace(/\[\d+\]/g, ""));
  const child = (key: string | number) => (prior as Record<string, unknown> | undefined)?.[key];
  const hasAttrs = record(prior) && Object.keys(prior).some((key) => key.startsWith("@_"));
  const text = record(prior) && /\S/.test(String(prior["#text"] ?? ""));
  if (!hasAttrs && !text && record(prior) && typeof expected === "string" && expected.trim() === "")
    expected = "";
  if (field?.multiple === true && !inCollection) {
    const left =
      expected === undefined || expected === ""
        ? []
        : Array.isArray(expected)
          ? expected
          : [expected];
    const right =
      actual === undefined || actual === "" ? [] : Array.isArray(actual) ? actual : [actual];
    if (left.length !== right.length) return differ();
    return left.every((item, index) =>
      equivalent(
        item,
        right[index],
        `${path}[${index}]`,
        fields,
        child(index) ?? prior,
        true,
        differences,
      ),
    );
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || expected.length !== actual.length) return differ();
    return expected.every((item, i) =>
      equivalent(item, actual[i], `${path}[${i}]`, fields, child(i), false, differences),
    );
  }
  if (record(expected)) {
    const received = !hasAttrs && !text && (actual == null || actual === "") ? {} : actual;
    if (!record(received)) return differ();
    return Object.entries(expected).every(([key, value]) =>
      equivalent(value, received[key], `${path}.${key}`, fields, child(key), false, differences),
    );
  }
  if (expected === undefined || expected === "" || expected === null)
    return actual === undefined || actual === "" || actual === null || differ();
  if (actual !== null && typeof actual === "object") return differ();
  if (field?.type === "bool")
    return (bool(expected) !== undefined && bool(expected) === bool(actual)) || differ();
  if (
    field?.type === "integer" &&
    /^(?:-?\d+|0x[0-9a-f]+)$/i.test(String(expected)) &&
    /^(?:-?\d+|0x[0-9a-f]+)$/i.test(String(actual))
  )
    return BigInt(String(expected)) === BigInt(String(actual)) || differ();
  const date = serverDate(expected);
  if (date !== undefined && date === serverDate(actual)) return true;
  return String(expected) === String(actual) || differ();
}

/** Проверяет запрошенные ветки чтением обратно, допуская только известную нормализацию XMD. */
export function verifyFields(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
  descriptors: unknown,
  names = Object.keys(expected),
  original?: string,
): void {
  const reference = original
    ? (Object.values(parseXml(original))[0] as Record<string, unknown>)
    : expected;
  const fields = new Map<string, Field>();
  if (Array.isArray(descriptors))
    for (const field of descriptors)
      if (record(field) && typeof field.path === "string") fields.set(field.path, field as Field);
  const differences: Difference[] = [];
  const mismatches = [...new Set(names)].filter(
    (name) =>
      !equivalent(expected[name], actual[name], name, fields, reference[name], false, differences),
  );
  if (mismatches.length)
    throw new HcmError(
      "READ_BACK_MISMATCH",
      "Документ сохранён, но поля из details.fields не приняли запрошенные значения.",
      "Что не совпало — в details.differences. Остальные поля запроса сохранены: заново объект не создавать. Обычная причина: сервер переписывает значение или внутри структуры нет такого поля; поля показывает schema.get.",
      { fields: mismatches, differences },
      "indeterminate",
    );
}

/**
 * Отсутствующих вложенных потомков надо проверять явно: добавленные сервером значения
 * по умолчанию допустимы в других местах.
 */
export function verifyRemovals(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
  changes: readonly unknown[],
  descriptors?: unknown,
): void {
  const at = (data: Record<string, unknown>, path: string): unknown => {
    let value: unknown = data;
    let fieldPath = "";
    for (const match of patchSegments(path)) {
      fieldPath += `${fieldPath ? "." : ""}${match[1]}`;
      value = record(value) ? value[match[1]!] : undefined;
      if (match[3] !== undefined) {
        const keyPath = `${fieldPath}.${match[3]}`;
        const field = Array.isArray(descriptors)
          ? descriptors.find((field) => record(field) && field.path === keyPath)
          : undefined;
        value = (Array.isArray(value) ? value : [value]).find(
          (item) =>
            record(item) &&
            equivalent(match[4], item[match[3]!], keyPath, new Map([[keyPath, field]])),
        );
      } else if (match[2] !== undefined)
        value = Array.isArray(value)
          ? value[Number(match[2])]
          : Number(match[2]) === 0
            ? value
            : undefined;
    }
    return value;
  };
  for (const raw of changes) {
    if (
      !record(raw) ||
      raw.op !== "remove" ||
      typeof raw.path !== "string" ||
      patchSegments(raw.path).at(-1)![2] !== undefined
    )
      continue;
    if (at(expected, raw.path) !== undefined) continue;
    const value = at(actual, raw.path);
    if (value !== undefined && value !== "" && value !== null)
      throw new HcmError(
        "READ_BACK_MISMATCH",
        "Поле, которое нужно было удалить, осталось в документе.",
        "До повтора проверить, не задаёт ли форма этому полю значение по умолчанию.",
        { fields: [raw.path] },
        "indeterminate",
      );
  }
}
