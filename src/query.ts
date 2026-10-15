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
/** Дата в формате ISO: 2024-01-31, при желании со временем. */
export function looksLikeDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:$|[T ]\d{2}:\d{2})/.test(value);
}
/** ID в десятичной записи, как сам сервер возвращает новый. */
export function looksLikeDecimalId(value: unknown): value is string {
  return typeof value === "string" && /^[1-9]\d{0,18}$/.test(value);
}
function literal(value: unknown, date = false, integer = false): string {
  // Число в кавычках на PostgreSQL никогда не равно целому полю: сервер отклоняет запрос.
  if (integer && looksLikeDecimalId(value)) return value;
  // Поле даты, сравнённое со строкой в кавычках, на PostgreSQL ничего не находит без ошибки;
  // date('…') понимает любая база, с которой работает сервер.
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
  // ID передаётся строкой, чтобы сохранить 64 бита, но 0x… в кавычках никогда не равно целому
  // полю: запрос молча ничего не найдёт. Десятичная запись — то, что пишет код платформы.
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
/** Токенизатор XQuery платформы принимает десятичные литералы, но не экспоненту JS. */
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
const OPERATOR_HINT =
  'Условие пишется как {поле: {оператор: значение}}, например {fullname: {contains: "Иван"}}; равенство — {поле: значение}.';
/** Закрытый DSL запросов: идентификаторы и значения не могут внедрить сырое выражение сервера. */
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
    // «Поле пусто» требует обеих форм. Поле с несколькими значениями: на PostgreSQL его находит
    // только IsEmpty; на MS SQL IsEmpty пропускает заполненное, а затем опустошённое, а = ''
    // находит. У «не пусто» такой пары нет: != '' совпадает со всеми строками на MS SQL
    // и ни с одной на PostgreSQL.
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
          OPERATOR_HINT,
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
            operation === "in"
              ? 'Пример: {role_id: {in: ["admin", "user"]}}.'
              : /^\$?(starts?_?with|begins?_?with|prefix|ends?_?with|suffix|i?like|regexp?|match(es)?)$/i.test(
                    operation,
                  )
                ? "Условий «начинается с» и шаблонов нет: формы, которая работает на обеих базах данных, сервер не даёт. Подходит contains, а строки по началу значения отбираются после ответа."
                : OPERATOR_HINT,
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
/** order запроса к каталогу: поле или список полей, каждое как "field" или "field desc". */
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
 * Сервер пишет дату с +00:00, хотя время — его местное. Смещение отбрасывается: программа,
 * которая ему верит, сдвинет время на расстояние сервера от UTC.
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
 * Каталоги, которые читает текст XQuery, и поля, которые он называет в каждом: `$v in CATALOG`
 * и `$v/field`. Хватает, чтобы объяснить отказ; дальше текст не разбирается.
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

/** Шлюз уже развернул XQueryResponse; поля строк никогда не бывают метаданными ответа. */
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

/** blankIsEmpty: пробелы в Data — форматирование пустого ответа, а не значение. */
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
  // Парсер XML-объектов группирует равные теги; несколько групп не сохраняют порядок документа.
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

/** Тег строк в ответе XQuery: тип объекта каталога, из которого они пришли. */
export function rowTag(response: unknown): string | undefined {
  const data = responseChild(inputObject(response, "ответ на запрос XQuery"), "Data");
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  const entries = elementEntries(data as Record<string, unknown>);
  return entries.length === 1 ? localName(entries[0]![0]) : undefined;
}

/** Ограниченные строки объектов и годное смещение, но не обещание стабильного снимка сервера. */
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
  // Штатный NULL-FALSE-сериализатор 1171 пропускает false; просмотра вперёд за MaxCount строк нет.
  const ended = serverEOF !== undefined && /^(?:1|true)$/.test(serverEOF.trim());
  // Запрос, возвращающий отдельные значения, пишет их текстом; пробел тогда мог бы быть одним
  // пустым значением. Что их нет, решает счётчик сервера или его признак конца без счётчика.
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

  // Страница сообщает одно из трёх: могут идти ещё строки (nextStartPosition), строки кончились
  // (нет ни того, ни другого поля) или конец не установлен и смещение не растёт (incomplete).
  let more = false;
  let incomplete = false;
  if (items.length === 0) {
    // «Нет строк» — счётчик сервера. Первая страница с признаком конца и без счётчика — так
    // сервер на SQL-базе отвечает на запрос, который база отклонила (MS SQL и PostgreSQL,
    // 2025.1.1171–2025.2.1535); такой сервер называет счётчик на каждой странице, и за концом тоже.
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
    // Строки закончились.
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

/** Документ с вложенным значением: форма показывает, повторяющийся ли это элемент. */
export function hasStructure(data: Record<string, unknown>): boolean {
  return Object.values(data).some((value) => value !== null && typeof value === "object");
}
