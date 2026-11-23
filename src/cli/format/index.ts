import process from "node:process";
import type { OperationResult } from "../../contracts.js";
import {
  CliInputError,
  stringOption,
  usesLocalFormat,
  usesLocalFormatArgv,
  type CliArguments,
} from "../arguments.js";
import type { CliIo } from "../types.js";
import { createStyler, envColor, resolveColor, stripAnsi } from "./ansi.js";
import { formatCsv, formatTsv } from "./csv.js";
import {
  extractTable,
  formatBytes,
  formatHumanError,
  formatJsonl,
  renderHuman,
  renderRaw,
} from "./human.js";

export { createStyler, envColor, formatBytes, formatHumanError, resolveColor, stripAnsi };

export const OUTPUT_FORMATS = ["auto", "table", "json", "jsonl", "csv", "tsv", "raw"] as const;
export type RequestedOutputFormat = (typeof OUTPUT_FORMATS)[number];
export type ResolvedOutputFormat = "human" | "table" | "json" | "jsonl" | "csv" | "tsv" | "raw";

export interface OutputMode {
  readonly requested: RequestedOutputFormat;
  readonly format: ResolvedOutputFormat;
  readonly humanErrors: boolean;
}

export type FormattedOutput =
  | { readonly kind: "text"; readonly text: string; readonly stderrNote?: string }
  | { readonly kind: "binary"; readonly bytes: Uint8Array };

function isOutputFormat(value: string): value is RequestedOutputFormat {
  return (OUTPUT_FORMATS as readonly string[]).includes(value);
}

/** Определяет режим вывода по приоритету: --json → глобальный --format → WTCTL_FORMAT → auto (TTY/pipe). */
export function resolveOutputMode(args: CliArguments, io: CliIo): OutputMode {
  const localFormat = usesLocalFormat(args);
  const flag = localFormat ? undefined : stringOption(args, "format");
  let requested: RequestedOutputFormat;

  if (args.options.json === true) {
    if (flag !== undefined) throw new CliInputError("Нужно выбрать --json или --format, а не оба.");
    requested = "json";
  } else if (flag !== undefined) {
    if (!isOutputFormat(flag)) {
      throw new CliInputError("--format должен быть auto, table, json, jsonl, csv, tsv или raw.");
    }
    requested = flag;
  } else {
    const envFormat = process.env.WTCTL_FORMAT;
    if (envFormat !== undefined && envFormat !== "") {
      if (!isOutputFormat(envFormat)) {
        throw new CliInputError(
          "WTCTL_FORMAT должен быть auto, table, json, jsonl, csv, tsv или raw.",
        );
      }
      requested = envFormat;
    } else {
      requested = "auto";
    }
  }

  const format: ResolvedOutputFormat =
    requested === "auto" ? (io.stdoutIsTTY === true ? "human" : "json") : requested;
  const humanErrors = requested !== "json" && (format !== "json" || io.stderrIsTTY === true);
  return { requested, format, humanErrors };
}

/** Режим печати ошибок в stderr: работает и тогда, когда parseArguments сам выбросил CliInputError. */
export function resolveErrorMode(
  argv: readonly string[],
  parsed: CliArguments | undefined,
  io: CliIo,
): "human" | "json" {
  if (parsed !== undefined) {
    try {
      return resolveOutputMode(parsed, io).humanErrors ? "human" : "json";
    } catch {
      // Неверный --format или WTCTL_FORMAT: проверяем исходный argv и TTY ниже.
    }
  }
  const localFormat = usesLocalFormatArgv(argv);
  let hasJsonFlag = false;
  let rawFormat: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token === "--") break;
    if (token === "--json") {
      hasJsonFlag = true;
      continue;
    }
    if (!localFormat) {
      if (token === "--format" && i + 1 < argv.length) {
        rawFormat = argv[++i];
      } else if (token.startsWith("--format=")) {
        rawFormat = token.slice("--format=".length);
      }
    }
  }

  if (hasJsonFlag || rawFormat === "json") return "json";
  if (rawFormat !== undefined && isOutputFormat(rawFormat) && rawFormat !== "auto") return "human";
  if (rawFormat === undefined) {
    const envFormat = process.env.WTCTL_FORMAT;
    if (envFormat === "json") return "json";
    if (
      envFormat !== undefined &&
      envFormat !== "" &&
      isOutputFormat(envFormat) &&
      envFormat !== "auto"
    )
      return "human";
  }
  return io.stdoutIsTTY === true || io.stderrIsTTY === true ? "human" : "json";
}

/** Список операций, поддерживающих табличные форматы csv и tsv. */
const TABULAR_OPERATIONS = new Set([
  "runtime.query",
  "schema.types",
  "schema.get",
  "logs.list",
  "logs.search",
  "logs.follow",
  "files.list",
  "rpc.list",
  "cli.config.list",
  "api.list",
  "runtime.check",
  "execute.script",
  "results.read",
  "agents.status",
  "web.spxml.getBackgroundTasksByName",
]);

const CLI_FORMAT_LABELS: Readonly<Record<string, string>> = {
  "cli.version": "wtctl version",
  "cli.config.init": "wtctl config init",
  "cli.config.set": "wtctl config set",
  "cli.config.use": "wtctl config use",
  "cli.config.remove": "wtctl config remove",
  "cli.config.path": "wtctl config path",
  "cli.config.example": "wtctl config example",
  "agents.run": "wtctl agent run",
  "agents.cancel": "wtctl agent cancel",
  "web.spxml.getAsyncMethodStatus": "wtctl tasks status",
  "web.spxml.killAsyncMethod": "wtctl tasks kill",
};

/** Проверяет совместимость операции с запрошенным форматом до вызова сервера или изменения файлов. */
export function assertFormatSupported(
  operationId: string,
  format: ResolvedOutputFormat,
  args?: Record<string, unknown>,
  commandLabel?: string,
): void {
  if (
    (operationId === "cli.help" ||
      operationId === "cli.guide" ||
      operationId === "cli.completion") &&
    (format === "csv" || format === "tsv" || format === "jsonl")
  ) {
    const cmdName =
      operationId === "cli.help" ? "help" : operationId === "cli.guide" ? "guide" : "completion";
    throw new CliInputError(
      `Формат ${format} не поддерживается командой ${cmdName}.`,
      "Подходят --format auto, --format table, --format raw или --json.",
    );
  }
  if (format !== "csv" && format !== "tsv") return;
  const supported =
    TABULAR_OPERATIONS.has(operationId) ||
    (operationId === "objects.get" && args?.ids !== undefined);
  if (!supported) {
    const label = commandLabel ?? CLI_FORMAT_LABELS[operationId] ?? operationId;
    throw new CliInputError(
      `Формат ${format} не подходит для ответа ${label}: ответ не является таблицей.`,
      "Для одиночного ответа подходят --format auto, --format table, --format json, --format jsonl или --format raw.",
    );
  }
}

/** Форматирует успешный или частичный ответ операции в выбранный формат, отличный от JSON. */
export function formatOperationOutput(
  result: OperationResult,
  format: Exclude<ResolvedOutputFormat, "json">,
  options: {
    readonly columns?: number;
    readonly color: boolean;
    readonly quiet?: boolean;
    readonly requestedFields?: readonly string[];
    readonly requestArgs?: Readonly<Record<string, unknown>>;
    readonly connectionArg?: string;
  },
): FormattedOutput {
  if (format === "human" || format === "table") {
    const rendered = renderHuman(result, {
      ...(options.columns === undefined ? {} : { columns: options.columns }),
      styler: createStyler(options.color),
      quiet: options.quiet === true,
      ...(options.requestedFields === undefined
        ? {}
        : { requestedFields: options.requestedFields }),
      ...(options.requestArgs === undefined ? {} : { requestArgs: options.requestArgs }),
      ...(options.connectionArg === undefined ? {} : { connectionArg: options.connectionArg }),
    });
    return {
      kind: "text",
      text: rendered.text,
      ...(rendered.stderrNote === undefined ? {} : { stderrNote: rendered.stderrNote }),
    };
  }
  if (format === "jsonl") {
    return { kind: "text", text: formatJsonl(result.meta.operationId, result.data) };
  }
  if (format === "csv" || format === "tsv") {
    const table = extractTable(result.meta.operationId, result.data, options.requestedFields) ?? {
      headers: ["value"],
      rows: [[result.data]],
    };
    return {
      kind: "text",
      text:
        format === "csv"
          ? formatCsv(table.headers, table.rows)
          : formatTsv(table.headers, table.rows),
    };
  }
  return renderRaw(result, options.requestedFields, options.quiet === true);
}
