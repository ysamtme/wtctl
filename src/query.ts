import { HcmError, inputObject, requiredString } from "./errors.js";
import { localName } from "./protocol/xml.js";

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
export function identifier(value: unknown, field: string): string {
  const text = requiredString(value, field);
  if (!IDENTIFIER.test(text))
    throw new HcmError(
      "INVALID_IDENTIFIER",
      `${field}: «${text.slice(0, 64)}» не подходит — нужно имя из латинских букв, цифр и _, первой не цифра.`,
      undefined,
      {
        path: field,
      },
    );
  return text;
}
/** A date written the ISO way: 2024-01-31, optionally with a time. */
export function looksLikeDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:$|[T ]\d{2}:\d{2})/.test(value);
}
/** An ID written in decimal, the way the server itself returns a new one. */
export function looksLikeDecimalId(value: unknown): value is string {
  return typeof value === "string" && /^[1-9]\d{0,18}$/.test(value);
}
function literal(value: unknown, date = false, integer = false): string {
  // A quoted number never equals an integer field on PostgreSQL: the server rejects the query.
  if (integer && looksLikeDecimalId(value)) return value;
  // A date field compared with a quoted string finds nothing on PostgreSQL and gives no error;
  // date('…') is understood by every database the server works with.
  if (date && looksLikeDate(value) && value.length <= 40 && !value.includes("'"))
    return `date('${value}')`;
  if (value === null) return "null()";
  if (typeof value === "boolean") return value ? "true()" : "false()";
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    (!Number.isInteger(value) || Number.isSafeInteger(value))
  )
    return decimalLiteral(value);
  // An ID is passed as a string to keep its 64 bits, but a quoted 0x… never equals an integer
  // field: the query would silently find nothing. The decimal form is what platform code writes.
  if (typeof value === "string" && /^0x[0-9a-fA-F]{1,16}$/.test(value)) {
    const id = BigInt(value);
    return id < 1n << 63n ? id.toString(10) : value;
  }
  if (typeof value === "string" && value.length <= 10000 && !/[\u0000-\u001F]/.test(value))
    return `'${value.replaceAll("'", "''")}'`;
  throw new HcmError(
    "INVALID_FILTER_VALUE",
    "Значение в условии — это строка, число, true, false или null.",
    "ID передаётся строкой: число такой величины теряет последние цифры.",
  );
}
/** The platform's XQuery tokenizer accepts decimal literals, not JS exponent notation. */
function decimalLiteral(value: number): string {
  const source = String(value);
  const scientific = /^(-?)(\d+)(?:\.(\d+))?e([+-]?\d+)$/i.exec(source);
  if (!scientific) return source;
  const [, sign, integral, fractional = "", exponent] = scientific;
  const digits = integral! + fractional;
  const point = integral!.length + Number(exponent);
  if (point <= 0) return `${sign}0.${"0".repeat(-point)}${digits}`;
  if (point >= digits.length) return `${sign}${digits}${"0".repeat(point - digits.length)}`;
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}
/** Closed query DSL: identifiers and values cannot inject a raw server expression. */
export function catalogQuery(
  catalog: unknown,
  where: unknown = {},
  dates: ReadonlySet<string> = new Set(),
  order?: unknown,
  integers: ReadonlySet<string> = new Set(),
): string {
  const name = identifier(catalog, "catalog");
  const conditions: string[] = [];
  for (const [field, condition] of Object.entries(inputObject(where, "where"))) {
    const path = `$elem/${identifier(field, "поле условия")}`;
    const date = dates.has(field);
    const integer = integers.has(field);
    // "The field is empty" needs both forms. A field of several values: on PostgreSQL only IsEmpty
    // finds it; on MS SQL IsEmpty misses one that was filled and then emptied, and = '' finds it.
    // "Not empty" has no such pair: != '' matches every row on MS SQL and none on PostgreSQL.
    const equals = (value: unknown): string =>
      value === "" || value === null
        ? `(${path} = '' or IsEmpty(${path}) = true())`
        : `${path} = ${literal(value, date, integer)}`;
    if (condition !== null && typeof condition === "object") {
      const operators = Object.entries(inputObject(condition, "условие"));
      if (operators.length === 0)
        throw new HcmError(
          "INVALID_FILTER_OPERATOR",
          "В условии по полю нет оператора.",
          undefined,
          { field },
        );
      for (const [operation, value] of operators) {
        if (
          operation === "eq" ||
          operation === "ne" ||
          operation === "gt" ||
          operation === "gte" ||
          operation === "lt" ||
          operation === "lte"
        ) {
          const operator = { eq: "=", ne: "!=", gt: ">", gte: ">=", lt: "<", lte: "<=" }[operation];
          if (operation === "eq") conditions.push(equals(value));
          else if (operation === "ne" && (value === "" || value === null))
            conditions.push(`IsEmpty(${path}) = false()`);
          else conditions.push(`${path} ${operator} ${literal(value, date, integer)}`);
        } else if (operation === "contains")
          conditions.push(`contains(${path}, ${literal(value)})`);
        else if (
          operation === "in" &&
          Array.isArray(value) &&
          value.length > 0 &&
          value.length <= 100
        )
          conditions.push(`(${value.map(equals).join(" or ")})`);
        else
          throw new HcmError(
            "INVALID_FILTER_OPERATOR",
            "Операторы условия: eq, ne, gt, gte, lt, lte, contains, in. Для in нужен массив от 1 до 100 значений.",
            undefined,
            { field, operation },
          );
      }
    } else conditions.push(equals(condition));
  }
  const sorted = orderFields(order).map(
    ({ field, descending }) => `$elem/${field}${descending ? " descending" : ""}`,
  );
  return `for $elem in ${name}${conditions.length ? ` where ${conditions.map((condition) => `(${condition})`).join(" and ")}` : ""}${sorted.length ? ` order by ${sorted.join(", ")}` : ""} return $elem`;
}
/** order of a catalog query: a field or a list of fields, each as "field" or "field desc". */
export function orderFields(order: unknown): { field: string; descending: boolean }[] {
  if (order === undefined) return [];
  const items = typeof order === "string" ? [order] : order;
  const wrong = (): never => {
    throw new HcmError(
      "INVALID_ARGUMENT",
      "order: поле каталога или список до пяти полей; по убыванию — «поле desc».",
    );
  };
  if (!Array.isArray(items) || items.length === 0 || items.length > 5) return wrong();
  return items.map((item) => {
    if (typeof item !== "string") return wrong();
    const [field = "", direction, ...rest] = item.trim().split(/\s+/);
    if (rest.length || (direction !== undefined && !/^(asc|desc)$/i.test(direction)))
      return wrong();
    return {
      field: identifier(field, "поле сортировки"),
      descending: direction?.toLowerCase() === "desc",
    };
  });
}
/**
 * The server writes a date with +00:00 though the time is its own local time. The offset is
 * dropped: a program that trusts it moves the time by the server's distance from UTC.
 */
export function withoutFalseOffset(value: unknown): unknown {
  if (typeof value === "string")
    return /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?\+00:00$/.test(value) ? value.slice(0, -6) : value;
  if (Array.isArray(value)) return value.map(withoutFalseOffset);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, withoutFalseOffset(child)]),
  );
}
/**
 * The catalogs an XQuery text reads and the fields it names in each: `$v in CATALOG` and
 * `$v/field`. Enough to explain a refusal; the text is not parsed further.
 */
export function xqueryNames(query: string): [string, string[]][] {
  const names: [string, string[]][] = [];
  for (const [, variable, catalog] of query.matchAll(/\$(\w+)\s+in\s+([A-Za-z_]\w*)/g)) {
    const fields = new Set<string>();
    for (const [, field] of query.matchAll(new RegExp(`\\$${variable}/([A-Za-z_]\\w*)`, "g")))
      fields.add(field!);
    names.push([catalog!, [...fields]]);
  }
  return names;
}
export function cleanXmlValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cleanXmlValue);
  if (value === null || typeof value !== "object") return value;
  const entries = Object.entries(value);
  const elements = entries.filter(
    ([key]) => !key.startsWith("@_") && !key.startsWith("#") && !key.startsWith("?"),
  );
  if (!elements.length) return (value as Record<string, unknown>)["#text"] ?? "";
  return Object.fromEntries(elements.map(([key, child]) => [key, cleanXmlValue(child)]));
}
export function projectFields(
  data: Record<string, unknown>,
  fields: unknown,
): Record<string, unknown> {
  if (fields === undefined) return data;
  if (
    !Array.isArray(fields) ||
    fields.some((field) => typeof field !== "string" || !IDENTIFIER.test(field))
  )
    throw new HcmError("INVALID_FIELDS", "fields: нужен массив имён полей верхнего уровня.");
  return Object.fromEntries(
    fields.filter((field) => Object.hasOwn(data, field)).map((field) => [field, data[field]]),
  );
}

function elementEntries(value: Record<string, unknown>): [string, unknown][] {
  return Object.entries(value).filter(
    ([key]) => !key.startsWith("@_") && !key.startsWith("#") && !key.startsWith("?"),
  );
}

/** The gateway already unwrapped XQueryResponse; row fields are never response metadata. */
function responseChild(response: Record<string, unknown>, name: string): unknown {
  const matches = elementEntries(response).filter(([key]) => localName(key) === name);
  if (matches.length > 1 || (matches.length === 1 && Array.isArray(matches[0]![1])))
    throw new HcmError(
      "PLATFORM_RESPONSE",
      `В ответе на запрос XQuery элемент ${name} повторяется.`,
    );
  return matches[0]?.[1];
}

function responseScalar(value: unknown, name: string): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const node = value as Record<string, unknown>;
    if (elementEntries(node).length === 0 && typeof node["#text"] === "string")
      return node["#text"];
  }
  throw new HcmError("PLATFORM_RESPONSE", `В ответе на запрос XQuery ${name} — не текст.`);
}

function representationError(): never {
  throw new HcmError(
    "QUERY_REPRESENTATION",
    "Запрос вернул не строки каталога целиком.",
    "Запрос должен заканчиваться на `return $elem`, а поля выбираются аргументом fields. Запрос, который возвращает отдельные значения или разные элементы, читает native.lds.xQuery.",
  );
}

function hasMixedText(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasMixedText);
  if (!value || typeof value !== "object") return false;
  const node = value as Record<string, unknown>;
  const children = elementEntries(node);
  return (
    (children.length > 0 &&
      node["#text"] !== undefined &&
      responseScalar(node["#text"], "содержимое строки").trim() !== "") ||
    children.some(([, child]) => hasMixedText(child))
  );
}

/** blankIsEmpty: whitespace in Data is formatting of an empty answer, not a value. */
function objectRows(data: unknown, blankIsEmpty: boolean): Record<string, unknown>[] {
  if (typeof data === "string") {
    if (data === "" || (blankIsEmpty && data.trim() === "")) return [];
    return representationError();
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return representationError();
  const node = data as Record<string, unknown>;
  if (node["#text"] !== undefined && responseScalar(node["#text"], "содержимое Data").trim() !== "")
    return representationError();
  const entries = elementEntries(node);
  // The XML object parser groups equal tags. Multiple groups cannot retain document order.
  if (entries.length > 1) return representationError();
  if (entries.length === 0) {
    if (!blankIsEmpty && node["#text"] !== undefined && node["#text"] !== "")
      return representationError();
    return [];
  }
  const children = entries[0]![1];
  return (Array.isArray(children) ? children : [children]).map((child) => {
    if (typeof child === "string" && child.trim() === "") return {};
    if (!child || typeof child !== "object" || Array.isArray(child)) return representationError();
    if (hasMixedText(child)) return representationError();
    const row = cleanXmlValue(child);
    if (row === "") return {};
    if (!row || typeof row !== "object" || Array.isArray(row)) return representationError();
    return row as Record<string, unknown>;
  });
}

/** Tag of the rows in an XQuery answer: the object type of the catalog they came from. */
export function rowTag(response: unknown): string | undefined {
  const data = responseChild(inputObject(response, "ответ на запрос XQuery"), "Data");
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const entries = elementEntries(data as Record<string, unknown>);
  return entries.length === 1 ? localName(entries[0]![0]) : undefined;
}

/** Bounded object rows and a usable offset, never a promise of a stable server snapshot. */
export function queryPage(
  response: unknown,
  start: number,
  limit: number,
  fields: unknown,
  rawQuery: boolean,
) {
  const root = inputObject(response, "ответ на запрос XQuery");
  const data = responseChild(root, "Data");
  if (data === undefined)
    throw new HcmError("PLATFORM_RESPONSE", "В ответе на запрос XQuery нет Data.");
  const totalNode = responseChild(root, "TotalCount");
  const eofNode = responseChild(root, "EOF");
  const total = totalNode === undefined ? undefined : responseScalar(totalNode, "TotalCount");
  if (total !== undefined && (total.trim().length > 64 || !/^\d+$/.test(total.trim())))
    throw new HcmError(
      "PLATFORM_RESPONSE",
      "В ответе на запрос XQuery TotalCount — не целое неотрицательное число.",
    );
  const count = total === undefined ? undefined : BigInt(total.trim());
  const serverEOF = eofNode === undefined ? undefined : responseScalar(eofNode, "EOF");
  if (serverEOF !== undefined && !/^(?:0|1|false|true)$/.test(serverEOF.trim()))
    throw new HcmError(
      "PLATFORM_RESPONSE",
      "В ответе на запрос XQuery EOF — не 0, 1, false или true.",
    );
  // The stock 1171 NULL-FALSE serializer omits false; no lookahead occurs after MaxCount rows.
  const ended = serverEOF !== undefined && /^(?:1|true)$/.test(serverEOF.trim());
  // A query that returns separate values writes them as text; whitespace could then be one empty
  // value. The server's own count, or its end mark without a count, settles that there are none.
  const rows = objectRows(data, !rawQuery || count === 0n || (count === undefined && ended));
  const items = rows.slice(0, limit).map((row) => projectFields(row, fields));
  const next = start + items.length;
  const inconsistentTotal =
    count !== undefined &&
    ((rows.length > 0 && BigInt(start + rows.length) > count) ||
      (ended && BigInt(start + rows.length) < count));
  const hints: string[] = [];
  if (inconsistentTotal)
    hints.push(
      "Число строк, которое назвал сервер, не сходится с полученной страницей, поэтому total не показан.",
    );

  // A page states one of three things: more rows may follow (nextStartPosition), the rows have
  // ended (neither field), or the end is not established and no offset advances (incomplete).
  let more = false;
  let incomplete = false;
  if (items.length === 0) {
    // "No rows" is the server's count. A first page with an end mark and no count is how a server
    // on an SQL database answers a query the database refused (MS SQL and PostgreSQL,
    // 2025.1.1171–2025.2.1535); such a server names the count on every page, also past the end.
    const refused = ended && count === undefined && start === 0;
    incomplete =
      refused || !(ended || (count !== undefined && !inconsistentTotal && BigInt(start) >= count));
    if (refused)
      hints.push(
        "Страница пуста, а числа строк сервер не назвал: так он отвечает, когда запрос отвергла база данных, а не когда строк нет. " +
          (rawQuery
            ? "Сверить значения с типами полей: дата — через date('…'), ID — без кавычек, строка — в кавычках."
            : "Сверить значения условий с типами полей каталога.") +
          " Причину база пишет в лог spxml_unibridge.",
      );
    else if (incomplete)
      hints.push(
        "Страница пуста, но сервер не подтвердил, что строки кончились. Следующей позиции нет.",
      );
  } else if (
    items.length === rows.length &&
    (ended || (count !== undefined && !inconsistentTotal && BigInt(next) >= count))
  ) {
    // The rows have ended.
  } else if (next > 1_000_000) {
    incomplete = true;
    hints.push("Следующая позиция больше предела startPosition (1000000): запрос нужно сузить.");
  } else {
    more = true;
  }
  const known =
    count !== undefined && !inconsistentTotal && count <= BigInt(Number.MAX_SAFE_INTEGER);
  return {
    items,
    ...(known ? { total: Number(count) } : {}),
    ...(more ? { nextStartPosition: next } : {}),
    ...(incomplete ? { incomplete: true as const } : {}),
    ...(hints.length ? { hint: hints.join(" ") } : {}),
  };
}

/** A document with a nested value: the form tells whether it is a repeated element. */
export function hasStructure(data: Record<string, unknown>): boolean {
  return Object.values(data).some((value) => value !== null && typeof value === "object");
}
