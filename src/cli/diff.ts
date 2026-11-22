import type { Styler } from "./format/ansi.js";
import { sanitizeTerminalText } from "./interactive.js";

const MAX_LCS_LINES = 4000;
const MAX_LCS_CELLS = 2_000_000;
const MAX_COMPACT_SECTION_LINES = 40;
const MAX_DIFF_LINE_CHARS = 500;
const MAX_DIFF_TOTAL_CHARS = 32 * 1024;

interface DiffOp {
  readonly kind: "equal" | "delete" | "insert";
  readonly text: string;
  readonly oldNo: number;
  readonly newNo: number;
}

function splitTextLines(text: string): string[] {
  if (text === "") return [];
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/** Экранирует управляющие символы и ограничивает слишком длинную строку, сохраняя табуляцию. */
function sanitizeDiffLine(line: string): string {
  const sanitized = line.split("\t").map(sanitizeTerminalText).join("\t");
  if (sanitized.length <= MAX_DIFF_LINE_CHARS) return sanitized;
  const omitted = sanitized.length - MAX_DIFF_LINE_CHARS;
  return `${sanitized.slice(0, MAX_DIFF_LINE_CHARS)}… (ещё ${omitted} знаков)`;
}

function finalizeDiffOutput(lines: readonly string[], styler: Styler): string {
  const kept: string[] = [];
  let totalChars = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (kept.length > 0 && totalChars + line.length + 1 > MAX_DIFF_TOTAL_CHARS) {
      kept.push(styler.dim(`… diff сокращён (показано ${kept.length} из ${lines.length} строк) …`));
      break;
    }
    kept.push(line);
    totalChars += line.length + 1;
  }
  return `${kept.join("\n")}\n`;
}

function buildLcsOps(
  midBefore: readonly string[],
  midAfter: readonly string[],
  oldBase: number,
  newBase: number,
): DiffOp[] {
  const n = midBefore.length;
  const m = midAfter.length;
  const cols = m + 1;
  const dp = new Uint32Array((n + 1) * cols);

  for (let i = n - 1; i >= 0; i--) {
    const rowOffset = i * cols;
    const nextRowOffset = (i + 1) * cols;
    const leftLine = midBefore[i]!;
    for (let j = m - 1; j >= 0; j--) {
      if (leftLine === midAfter[j]!) {
        dp[rowOffset + j] = dp[nextRowOffset + j + 1]! + 1;
      } else {
        const down = dp[nextRowOffset + j]!;
        const right = dp[rowOffset + j + 1]!;
        dp[rowOffset + j] = down >= right ? down : right;
      }
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (midBefore[i] === midAfter[j]) {
      ops.push({ kind: "equal", text: midBefore[i]!, oldNo: oldBase + i, newNo: newBase + j });
      i++;
      j++;
    } else if (dp[(i + 1) * cols + j]! >= dp[i * cols + j + 1]!) {
      ops.push({ kind: "delete", text: midBefore[i]!, oldNo: oldBase + i, newNo: newBase + j });
      i++;
    } else {
      ops.push({ kind: "insert", text: midAfter[j]!, oldNo: oldBase + i, newNo: newBase + j });
      j++;
    }
  }
  while (i < n) {
    ops.push({ kind: "delete", text: midBefore[i]!, oldNo: oldBase + i, newNo: newBase + j });
    i++;
  }
  while (j < m) {
    ops.push({ kind: "insert", text: midAfter[j]!, oldNo: oldBase + i, newNo: newBase + j });
    j++;
  }
  return ops;
}

function renderCompactRange(
  beforeLines: readonly string[],
  afterLines: readonly string[],
  prefixLen: number,
  suffixLen: number,
  styler: Styler,
  contextLines: number,
): string {
  const midBefore = beforeLines.slice(prefixLen, beforeLines.length - suffixLen);
  const midAfter = afterLines.slice(prefixLen, afterLines.length - suffixLen);
  const ctxBeforeStart = Math.max(0, prefixLen - contextLines);
  const ctxBefore = beforeLines.slice(ctxBeforeStart, prefixLen);
  const suffixStartBefore = beforeLines.length - suffixLen;
  const ctxAfter = beforeLines.slice(
    suffixStartBefore,
    suffixStartBefore + Math.min(suffixLen, contextLines),
  );

  const oldCount = ctxBefore.length + midBefore.length + ctxAfter.length;
  const newCount = ctxBefore.length + midAfter.length + ctxAfter.length;
  const oldStart = oldCount === 0 ? prefixLen : ctxBeforeStart + 1;
  const newStart = newCount === 0 ? prefixLen : ctxBeforeStart + 1;

  const out: string[] = [styler.cyan(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`)];
  for (const line of ctxBefore) out.push(`  ${sanitizeDiffLine(line)}`);

  const pushSection = (
    items: readonly string[],
    prefix: "- " | "+ ",
    paint: (s: string) => string,
    omittedLabel: string,
  ): void => {
    if (items.length <= MAX_COMPACT_SECTION_LINES) {
      for (const line of items) out.push(paint(`${prefix}${sanitizeDiffLine(line)}`));
      return;
    }
    const headCount = Math.floor(MAX_COMPACT_SECTION_LINES * 0.75);
    const tailCount = MAX_COMPACT_SECTION_LINES - headCount;
    for (let i = 0; i < headCount; i++) {
      out.push(paint(`${prefix}${sanitizeDiffLine(items[i]!)}`));
    }
    out.push(
      styler.dim(`  … ещё ${items.length - headCount - tailCount} ${omittedLabel} пропущено …`),
    );
    for (let i = items.length - tailCount; i < items.length; i++) {
      out.push(paint(`${prefix}${sanitizeDiffLine(items[i]!)}`));
    }
  };

  pushSection(midBefore, "- ", styler.red, "строк удалено");
  pushSection(midAfter, "+ ", styler.green, "строк добавлено");
  for (const line of ctxAfter) out.push(`  ${sanitizeDiffLine(line)}`);
  return finalizeDiffOutput(out, styler);
}

/** Строит построчный unified-diff с контекстом и защитой от больших файлов. */
export function renderLineDiff(
  before: string,
  after: string,
  styler: Styler,
  contextLines = 3,
): string {
  if (before === after) return "";

  const beforeLines = splitTextLines(before);
  const afterLines = splitTextLines(after);

  let prefixLen = 0;
  const minLen = Math.min(beforeLines.length, afterLines.length);
  while (prefixLen < minLen && beforeLines[prefixLen] === afterLines[prefixLen]) {
    prefixLen++;
  }

  let suffixLen = 0;
  const maxSuffix = minLen - prefixLen;
  while (
    suffixLen < maxSuffix &&
    beforeLines[beforeLines.length - 1 - suffixLen] ===
      afterLines[afterLines.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const midBefore = beforeLines.slice(prefixLen, beforeLines.length - suffixLen);
  const midAfter = afterLines.slice(prefixLen, afterLines.length - suffixLen);

  if (midBefore.length === 0 && midAfter.length === 0) {
    return `${styler.dim("Изменились только переводы строк или перевод строки в конце файла.")}\n`;
  }

  if (
    beforeLines.length > MAX_LCS_LINES ||
    afterLines.length > MAX_LCS_LINES ||
    midBefore.length * midAfter.length > MAX_LCS_CELLS
  ) {
    return renderCompactRange(beforeLines, afterLines, prefixLen, suffixLen, styler, contextLines);
  }

  const ctxBeforeStart = Math.max(0, prefixLen - contextLines);
  const ops: DiffOp[] = [];
  for (let i = ctxBeforeStart; i < prefixLen; i++) {
    ops.push({ kind: "equal", text: beforeLines[i]!, oldNo: i + 1, newNo: i + 1 });
  }
  ops.push(...buildLcsOps(midBefore, midAfter, prefixLen + 1, prefixLen + 1));

  const suffixOldStart = beforeLines.length - suffixLen;
  const suffixNewStart = afterLines.length - suffixLen;
  const ctxAfterCount = Math.min(suffixLen, contextLines);
  for (let k = 0; k < ctxAfterCount; k++) {
    ops.push({
      kind: "equal",
      text: beforeLines[suffixOldStart + k]!,
      oldNo: suffixOldStart + k + 1,
      newNo: suffixNewStart + k + 1,
    });
  }

  const ranges: { start: number; end: number }[] = [];
  for (let idx = 0; idx < ops.length; idx++) {
    if (ops[idx]!.kind === "equal") continue;
    const start = Math.max(0, idx - contextLines);
    const end = Math.min(ops.length - 1, idx + contextLines);
    const last = ranges.at(-1);
    if (last && start <= last.end + 1) {
      last.end = Math.max(last.end, end);
    } else {
      ranges.push({ start, end });
    }
  }

  const out: string[] = [];
  for (const { start, end } of ranges) {
    const slice = ops.slice(start, end + 1);
    let oldCount = 0;
    let newCount = 0;
    let firstOld: number | undefined;
    let firstNew: number | undefined;
    for (const op of slice) {
      if (op.kind !== "insert") {
        firstOld ??= op.oldNo;
        oldCount++;
      }
      if (op.kind !== "delete") {
        firstNew ??= op.newNo;
        newCount++;
      }
    }
    const oldStart = firstOld ?? Math.max(0, slice[0]!.oldNo - 1);
    const newStart = firstNew ?? Math.max(0, slice[0]!.newNo - 1);
    out.push(styler.cyan(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`));
    for (const op of slice) {
      const safe = sanitizeDiffLine(op.text);
      if (op.kind === "equal") out.push(`  ${safe}`);
      else if (op.kind === "delete") out.push(styler.red(`- ${safe}`));
      else out.push(styler.green(`+ ${safe}`));
    }
  }

  return finalizeDiffOutput(out, styler);
}
