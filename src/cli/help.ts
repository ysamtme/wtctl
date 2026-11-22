import { isSimilarName, similarHint } from "../errors.js";
import { CliInputError, RPC_TARGET_RE, printableName } from "./arguments.js";
import {
  COMMAND_GROUPS,
  GLOBAL_OPTIONS,
  commandUsageLines,
  formatOptionFlag,
  lookupCommand,
  lookupSubcommand,
  visibleCommands,
  type CommandSpec,
  type OptionSpec,
  type SubcommandSpec,
} from "./registry.js";

const USAGE = "wtctl [--config ФАЙЛ] [-c ИМЯ] [--format ВИД | --json] КОМАНДА …";

const NOTES: readonly string[] = [
  "Аргументы и примеры команды: wtctl help КОМАНДА [ПОДКОМАНДА].",
  "В терминале выводятся таблицы, сводки и текст; при перенаправлении (в скриптах и pipe) и с --json — JSON {ok, data, meta} (help, guide и completion без --json печатают текст).",
  "Форматы: table — читаемый вывод и при перенаправлении; jsonl — по объекту JSON на строку; raw — данные как есть. У result read/export свой --format.",
  "Код выхода: 0 — успех, 1 — ошибка операции, записи в stdout или закрытия сессии, 2 — ошибка аргументов, 3 — ответ сохранён локально (result read/export или --output).",
  "С --output в JSON сводка идёт в stdout (при ошибке в файл — ok:false); в остальных форматах — в stderr (если перенаправлены оба потока — в stdout; -q скрывает), при отказе файл не создаётся (кроме check/run); help/guide/completion без --json пишут без сводки.",
  "ID передаётся строкой: 0x… или десятичной записью. При коде 1, 3 или error.mutationOutcome = indeterminate запись не повторять без проверки объекта.",
];

/** Команда справки к ошибке разбора: справка самой команды, если она есть. */
export function helpCommand(command: string | undefined): string {
  return command !== undefined && command !== "help" && lookupCommand(command) !== undefined
    ? `wtctl help ${command}`
    : "wtctl help";
}

/** Справка команды; неизвестную команду отказ называет как набрана, с похожими. */
function topic(command: string): CommandSpec {
  const spec = lookupCommand(command);
  if (spec !== undefined) return spec;
  const near = [...visibleCommands().map((item) => item.name), "help"].filter((name) =>
    isSimilarName(name, command),
  );
  throw new CliInputError(
    printableName(command) ? `Команды wtctl ${command} нет.` : "Неизвестная команда.",
    similarHint(near).trimEnd() || undefined,
  );
}

function subcommandError(command: CommandSpec, action: string | undefined): CliInputError {
  const names = command.subcommands!.map((sub) => sub.name);
  const list = `есть ${names.join(", ")}${command.call === undefined ? "" : ` или вызов ${command.call}`}.`;
  return new CliInputError(
    action === undefined
      ? `Не указана команда после wtctl ${command.name}: ${list}`
      : printableName(action)
        ? `Команды wtctl ${command.name} ${action} нет: ${list}`
        : `Неизвестная команда после wtctl ${command.name}: ${list}`,
  );
}

/**
 * Отказ, если команда или вложенная команда неизвестна или вложенная не указана: команда названа так,
 * как её набрали, и рядом сказано, какие есть. Остальные аргументы проверяет сама команда.
 */
export function requireCommand([command = "", action, ...rest]: readonly string[]): void {
  const spec = topic(command);
  if (spec.subcommands === undefined || (action !== undefined && lookupSubcommand(spec, action)))
    return;
  // Вызов функции библиотеки: rpc БИБЛИОТЕКА ФУНКЦИЯ или rpc БИБЛИОТЕКА.ФУНКЦИЯ.
  if (
    spec.call !== undefined &&
    (rest.length > 0 || (action !== undefined && RPC_TARGET_RE.test(action)))
  )
    return;
  throw subcommandError(spec, action);
}

function resolveTarget(
  command: string,
  subcommand?: string,
): { readonly spec: CommandSpec; readonly sub?: SubcommandSpec } {
  const spec = topic(command);
  if (subcommand === undefined) return { spec };
  if (spec.subcommands === undefined) throw new CliInputError("Лишние аргументы команды.");
  const sub = lookupSubcommand(spec, subcommand);
  if (sub === undefined) throw subcommandError(spec, subcommand);
  return { spec, sub };
}

function optionLongKey(option: OptionSpec): string {
  return option.valueLabel ? `--${option.name} ${option.valueLabel}` : `--${option.name}`;
}

function optionMap(options: readonly OptionSpec[] | undefined): Record<string, string> | undefined {
  if (!options?.length) return undefined;
  return Object.fromEntries(options.map((option) => [optionLongKey(option), option.description]));
}

export function cliHelp(command?: string, subcommand?: string): Record<string, unknown> {
  if (command === undefined) {
    const commands = visibleCommands();
    const globalOptions = optionMap(GLOBAL_OPTIONS)!;
    // Сохраняет прежний набор ключей options в выводе help --json.
    const options: Record<string, string> = {};
    for (const [key, description] of Object.entries(globalOptions)) {
      options[key] = description;
      if (key === "--connection ИМЯ") {
        options["--input-file ФАЙЛ | --stdin | --args JSON"] =
          "Откуда взять ввод команды; один источник.";
      }
    }
    return {
      usage: USAGE,
      groups: COMMAND_GROUPS.map((group) => ({
        title: group.title,
        commands: commands.filter((item) => item.group === group.id).map((item) => item.name),
      })),
      commands: Object.fromEntries(commands.map((item) => [item.name, item.summary])),
      options,
      notes: NOTES,
    };
  }
  const { spec, sub } = resolveTarget(command, subcommand);
  if (sub !== undefined) {
    const options = optionMap(sub.options);
    return {
      command,
      subcommand: sub.name,
      summary: sub.summary,
      usage: sub.usage,
      ...(options === undefined ? {} : { options }),
      ...(sub.notes?.length ? { notes: sub.notes } : {}),
    };
  }
  const options = optionMap(spec.options);
  return {
    command,
    ...(spec.subcommands
      ? {
          subcommands: Object.fromEntries(
            spec.subcommands.map((item) => [item.name, item.summary]),
          ),
        }
      : {}),
    usage: commandUsageLines(spec),
    ...(options === undefined ? {} : { options }),
    ...(spec.notes?.length ? { notes: spec.notes } : {}),
  };
}

function rows(pairs: readonly (readonly [string, string])[], minWidth = 0): string[] {
  const width = Math.max(minWidth, ...pairs.map(([name]) => name.length));
  return pairs.map(([name, text]) => `  ${name.padEnd(width)}  — ${text}`);
}

function optionLines(options: readonly OptionSpec[] | undefined, heading = "Параметры:"): string[] {
  if (!options?.length) return [];
  return [
    "",
    heading,
    ...rows(options.map((option) => [formatOptionFlag(option), option.description])),
  ];
}

/** Та же справка, что у cliHelp, разложенная по строкам для чтения. */
export function cliHelpText(command?: string, subcommand?: string): string {
  if (command === undefined) {
    const commands = visibleCommands();
    const width = Math.max(...commands.map((item) => item.name.length));
    const lines = [USAGE];
    for (const group of COMMAND_GROUPS) {
      const members = commands.filter((item) => item.group === group.id);
      if (!members.length) continue;
      lines.push(
        "",
        `${group.title}:`,
        ...rows(
          members.map((item) => [item.name, item.summary]),
          width,
        ),
      );
    }
    lines.push(...optionLines(GLOBAL_OPTIONS), "", ...NOTES);
    return `${lines.join("\n")}\n`;
  }

  const { spec, sub } = resolveTarget(command, subcommand);
  if (sub !== undefined) {
    const hasLocalFormat = sub.options?.some((o) => o.name === "format" && o.overridesGlobal);
    const globals = [
      "-c",
      ...(hasLocalFormat ? [] : ["--format"]),
      "--json",
      ...(sub.noOutput ? [] : ["-o"]),
      "-q",
      "-y",
    ];
    const globalList = globals.join(", ");
    const lines = [
      `wtctl ${command} ${sub.name} — ${sub.summary}`,
      "",
      ...sub.usage.map((line) => `  ${line}`),
      ...optionLines(sub.options),
      ...(sub.notes?.length ? ["", ...sub.notes] : []),
      "",
      `Общие параметры (${globalList}): wtctl help.`,
    ];
    return `${lines.join("\n")}\n`;
  }

  if (spec.subcommands !== undefined) {
    const lines = [
      `wtctl ${command} — ${spec.summary}`,
      "",
      "Подкоманды:",
      ...rows(spec.subcommands.map((item) => [item.name, item.summary])),
      "",
      "Использование:",
      ...commandUsageLines(spec).map((line) => `  ${line}`),
      ...optionLines(spec.options, "Параметры вызова:"),
      "",
      ...(spec.notes ?? []),
      `Подробности и параметры подкоманды: wtctl help ${command} ПОДКОМАНДА.`,
    ];
    return `${lines.join("\n")}\n`;
  }

  const lines = [
    `wtctl ${command} — ${spec.summary}`,
    "",
    ...commandUsageLines(spec).map((line) => `  ${line}`),
    ...optionLines(spec.options),
    ...(spec.notes?.length ? ["", ...spec.notes] : []),
  ];
  return `${lines.join("\n")}\n`;
}
