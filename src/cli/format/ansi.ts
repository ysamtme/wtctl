import process from "node:process";
import type { CliIo } from "../types.js";

/** Минимальный набор ANSI-стилей для читаемого вывода в терминале; при color=false возвращает текст без изменений. */
export interface Styler {
  bold(text: string): string;
  dim(text: string): string;
  red(text: string): string;
  green(text: string): string;
  yellow(text: string): string;
  cyan(text: string): string;
}

const PLAIN: Styler = {
  bold: (text) => text,
  dim: (text) => text,
  red: (text) => text,
  green: (text) => text,
  yellow: (text) => text,
  cyan: (text) => text,
};

const wrap = (open: string, close: string) => (text: string) =>
  text ? `\x1b[${open}m${text}\x1b[${close}m` : "";

const COLORED: Styler = {
  bold: wrap("1", "22"),
  dim: wrap("2", "22"),
  red: wrap("31", "39"),
  green: wrap("32", "39"),
  yellow: wrap("33", "39"),
  cyan: wrap("36", "39"),
};

/** ANSI-последовательности CSI, вырезаемые при подсчёте ширины или проверке чистого текста. */
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;

export function createStyler(enabled: boolean): Styler {
  return enabled ? COLORED : PLAIN;
}

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

/** Определяет поддержку цвета по NO_COLOR, FORCE_COLOR и признаку интерактивного терминала. */
export function envColor(isTTY: boolean): boolean {
  const noColor = process.env.NO_COLOR;
  if (noColor !== undefined && noColor !== "") return false;
  const forceColor = process.env.FORCE_COLOR;
  if (forceColor === "0" || forceColor === "false") return false;
  if (forceColor !== undefined && forceColor !== "") return true;
  return isTTY;
}

/** Эффективная настройка цвета для потока вывода CLI: явный io.color сильнее окружения. */
export function resolveColor(io: CliIo, stream: "stdout" | "stderr" = "stdout"): boolean {
  if (io.color !== undefined) return io.color;
  return envColor(stream === "stderr" ? io.stderrIsTTY === true : io.stdoutIsTTY === true);
}
