import { createStyler, stripAnsi, type Styler } from "./ansi.js";

export interface TableColumn {
  readonly header: string;
  readonly align?: "left" | "right";
  readonly minWidth?: number;
  readonly style?: (text: string) => string;
}

export interface TableOptions {
  readonly maxWidth?: number;
  readonly styler?: Styler;
}

/** Ширина одной кодовой точки в моноширинном терминале: 0 для управляющих и диакритики, 2 для CJK и эмодзи. */
function codePointWidth(cp: number): number {
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if (
    (cp >= 0x0300 && cp <= 0x036f) ||
    (cp >= 0x1ab0 && cp <= 0x1aff) ||
    (cp >= 0x1dc0 && cp <= 0x1dff) ||
    (cp >= 0x20d0 && cp <= 0x20ff) ||
    (cp >= 0xfe00 && cp <= 0xfe0f) ||
    (cp >= 0xfe20 && cp <= 0xfe2f) ||
    cp === 0x200d
  )
    return 0;
  if (
    cp >= 0x1100 &&
    (cp <= 0x115f ||
      cp === 0x2329 ||
      cp === 0x232a ||
      (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe10 && cp <= 0xfe19) ||
      (cp >= 0xfe30 && cp <= 0xfe6f) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x1f300 && cp <= 0x1fbff) ||
      (cp >= 0x20000 && cp <= 0x3fffd))
  )
    return 2;
  return 1;
}

/** Видимая ширина строки с учётом кириллицы, широких символов и без учёта ANSI-кодов. */
export function displayWidth(text: string): number {
  let width = 0;
  for (const ch of stripAnsi(text)) width += codePointWidth(ch.codePointAt(0)!);
  return width;
}

/** Обрезает строку до maxWidth видимых столбцов с многоточием, сохраняя целостность ANSI-кодов. */
export function truncateText(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (displayWidth(text) <= maxWidth) return text;
  if (maxWidth === 1) return "…";

  const target = maxWidth - 1;
  let result = "";
  let width = 0;
  let hasAnsi = false;
  let i = 0;

  while (i < text.length) {
    if (text.charCodeAt(i) === 0x1b && text[i + 1] === "[") {
      const end = text.slice(i).search(/[A-Za-z]/);
      if (end > 0) {
        result += text.slice(i, i + end + 1);
        hasAnsi = true;
        i += end + 1;
        continue;
      }
    }
    const cp = text.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    const w = codePointWidth(cp);
    if (width + w > target) break;
    result += ch;
    width += w;
    i += ch.length;
  }

  return `${result}…${hasAnsi ? "\x1b[0m" : ""}`;
}

function sanitizeCell(value: string): string {
  return value.replace(/\r?\n|\t/g, " ");
}

function padCell(text: string, width: number, align: "left" | "right", trimRight: boolean): string {
  const truncated = truncateText(text, width);
  const gap = Math.max(0, width - displayWidth(truncated));
  if (align === "right") return " ".repeat(gap) + truncated;
  return trimRight ? truncated : truncated + " ".repeat(gap);
}

/** Вычисляет ширину столбцов так, чтобы вся строка таблицы укладывалась в maxWidth. */
function fitWidths(
  columns: readonly TableColumn[],
  rows: readonly (readonly string[])[],
  maxWidth: number | undefined,
  gapWidth: number,
): number[] {
  const natural = columns.map((column, colIndex) =>
    Math.max(displayWidth(column.header), ...rows.map((row) => displayWidth(row[colIndex] ?? ""))),
  );
  if (maxWidth === undefined || maxWidth <= 0 || columns.length === 0) return natural;

  const widths = [...natural];
  const minWidths = columns.map((column, index) => Math.min(natural[index]!, column.minWidth ?? 4));
  const totalGaps = gapWidth * (columns.length - 1);
  const sum = () => widths.reduce((acc, w) => acc + w, 0) + totalGaps;

  const shrinkTo = (floors: readonly number[]) => {
    while (sum() > maxWidth) {
      let widest = -1;
      for (let i = 0; i < widths.length; i++) {
        if (widths[i]! > floors[i]! && (widest < 0 || widths[i]! > widths[widest]!)) widest = i;
      }
      if (widest < 0) break;
      widths[widest]!--;
    }
  };

  shrinkTo(minWidths);
  // Если терминал экстремально узкий, сжимаем дальше вплоть до 1 символа на столбец.
  shrinkTo(widths.map(() => 1));
  return widths;
}

/** Рисует выровненную таблицу с заголовком, разделителем «─» и подгонкой под ширину терминала. */
export function renderTable(
  columns: readonly TableColumn[],
  rows: readonly (readonly string[])[],
  options: TableOptions = {},
): string {
  if (columns.length === 0) return "";
  const styler = options.styler ?? createStyler(false);
  const gap = "  ";
  const cleanRows = rows.map((row) => columns.map((_, index) => sanitizeCell(row[index] ?? "")));
  const widths = fitWidths(columns, cleanRows, options.maxWidth, gap.length);
  const last = columns.length - 1;

  const headerLine = columns
    .map((column, index) =>
      styler.bold(
        padCell(
          column.header,
          widths[index]!,
          column.align ?? "left",
          index === last && (column.align ?? "left") === "left",
        ),
      ),
    )
    .join(gap);

  const separatorLine = widths.map((width) => styler.dim("─".repeat(Math.max(1, width)))).join(gap);

  const bodyLines = cleanRows.map((row) =>
    columns
      .map((column, index) => {
        const align = column.align ?? "left";
        const cell = padCell(
          row[index]!,
          widths[index]!,
          align,
          index === last && align === "left",
        );
        return column.style ? column.style(cell) : cell;
      })
      .join(gap),
  );

  return [headerLine, separatorLine, ...bodyLines].join("\n");
}
