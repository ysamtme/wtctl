/** Преобразует значение ячейки в строку для форматов CSV/TSV: структуры уходят компактным JSON. */
export function tabularCellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint")
    return String(value);
  return JSON.stringify(value, (_key, item) =>
    typeof item === "bigint" ? item.toString(10) : item,
  );
}

/** Экранирование одного поля CSV по RFC 4180. */
function escapeCsvField(text: string): string {
  if (/[",\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

/** Экранирование одного поля TSV: переводы строк и табуляции заменяются пробелами, чтобы строка оставалась одной записью. */
function escapeTsvField(text: string): string {
  return text.replace(/\r\n|[\r\n\t]/g, " ");
}

export function formatCsvRow(values: readonly unknown[]): string {
  return values.map((value) => escapeCsvField(tabularCellText(value))).join(",");
}

export function formatTsvRow(values: readonly unknown[]): string {
  return values.map((value) => escapeTsvField(tabularCellText(value))).join("\t");
}

export function formatCsv(
  headers: readonly string[],
  rows: readonly (readonly unknown[])[],
): string {
  if (headers.length === 0) return "";
  const lines = [
    formatCsvRow(headers),
    ...rows.map((row) => formatCsvRow(headers.map((_, index) => row[index]))),
  ];
  return `${lines.join("\n")}\n`;
}

export function formatTsv(
  headers: readonly string[],
  rows: readonly (readonly unknown[])[],
): string {
  if (headers.length === 0) return "";
  const lines = [
    formatTsvRow(headers),
    ...rows.map((row) => formatTsvRow(headers.map((_, index) => row[index]))),
  ];
  return `${lines.join("\n")}\n`;
}
