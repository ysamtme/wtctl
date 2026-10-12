export class CliInputError extends Error {
  readonly code = "cli.invalid_input";
  constructor(
    message: string,
    readonly hint = "Справка: wtctl help или wtctl help <группа>.",
  ) {
    super(message);
    this.name = "CliInputError";
  }
}

export interface CliArguments {
  positionals: string[];
  options: Record<string, string | boolean>;
}

const BOOLEAN_OPTIONS = new Set([
  "json",
  "stdin",
  "help",
  "async",
  "permanent",
  "preview",
  "resave",
  "newest-first",
  "base64",
  "password-stdin",
  "full",
  "offline",
  "built-in",
  "source",
  "overwrite",
  "version",
  "all",
  "allow-write",
  "allow-execute",
  "force",
  "deep",
]);
const VALUE_OPTIONS = new Set([
  "config",
  "connection",
  "output",
  "input-file",
  "args",
  "params",
  "params-file",
  "query",
  "topic",
  "group",
  "effect",
  "status",
  "cursor",
  "limit",
  "offset",
  "start-position",
  "fields",
  "ids",
  "order",
  "expected-fingerprint",
  "type",
  "id",
  "url",
  "library",
  "method",
  "result-id",
  "catalog",
  "where",
  "format",
  "form-url",
  "db-name",
  "date",
  "start-date",
  "end-date",
  "name-contains",
  "tail-bytes",
  "text",
  "level",
  "context",
  "content-type",
  "timeout-ms",
  "profile",
  "search",
  "path",
  "origin",
  "kind",
  "include",
  "language",
  "to",
  "username",
  "name",
  "password-env",
]);

/** Parse once; secrets are deliberately not accepted as command-line options. */
export function parseArguments(argv: readonly string[]): CliArguments {
  const result: CliArguments = { positionals: [], options: {} };
  let positionalOnly = false;
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index]!;
    if (value === "--") {
      positionalOnly = true;
      continue;
    }
    if (!positionalOnly && (value === "-h" || value === "--help")) {
      if (Object.hasOwn(result.options, "help"))
        throw new CliInputError("Параметр --help повторяется.");
      result.options.help = true;
      continue;
    }
    if (!positionalOnly && value === "-v") {
      result.options.version = true;
      continue;
    }
    if (positionalOnly || !value.startsWith("--")) {
      result.positionals.push(value);
      continue;
    }
    const equals = value.indexOf("=");
    const name = value.slice(2, equals < 0 ? undefined : equals);
    if (Object.hasOwn(result.options, name))
      throw new CliInputError(`Параметр --${name} повторяется.`);
    if (BOOLEAN_OPTIONS.has(name)) {
      if (equals >= 0) throw new CliInputError(`Параметр --${name} не принимает значения.`);
      result.options[name] = true;
    } else if (VALUE_OPTIONS.has(name)) {
      const next = equals < 0 ? argv[++index] : value.slice(equals + 1);
      if (next === undefined || next.length === 0 || (equals < 0 && next.startsWith("--"))) {
        throw new CliInputError(`Для --${name} требуется значение.`);
      }
      result.options[name] = next;
    } else {
      // Never echo unknown arguments: they might accidentally contain credentials.
      throw new CliInputError(
        "Неизвестный параметр командной строки.",
        "Пароли и токены задаются через конфигурацию и переменные окружения; параметры доступа не принимаются в argv.",
      );
    }
  }
  const sources = [result.options["input-file"], result.options.stdin, result.options.args].filter(
    Boolean,
  );
  if (sources.length > 1)
    throw new CliInputError("Нужно выбрать один источник: --input-file, --stdin или --args.");
  if (result.options["password-stdin"] && result.options.stdin)
    throw new CliInputError(
      "--password-stdin несовместим с --stdin ввода операции.",
      "Ввод операции передаётся через --input-file; пароль — отдельным stdin.",
    );
  if (result.options.help) result.positionals = ["help", ...result.positionals.slice(0, 1)];
  else if (result.options.version) {
    delete result.options.version;
    result.positionals = ["version", ...result.positionals];
  }
  return result;
}

export function stringOption(args: CliArguments, name: string): string | undefined {
  const value = args.options[name];
  return typeof value === "string" ? value : undefined;
}

/** A list written through commas: items are trimmed, empty ones dropped. */
export function listOption(args: CliArguments, name: string): string[] | undefined {
  return stringOption(args, name)
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function integerOption(
  args: CliArguments,
  name: string,
  minimum = 0,
  maximum = 100_000,
): number | undefined {
  const value = stringOption(args, name);
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) throw new CliInputError(`--${name} должен быть целым числом.`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new CliInputError(`--${name} должен быть от ${minimum} до ${maximum}.`);
  }
  return number;
}

export function requirePositional(args: CliArguments, index: number, label: string): string {
  const value = args.positionals[index];
  if (!value) throw new CliInputError(`Не задан ${label}.`);
  return value;
}

/**
 * JSON given to the command. Shells disagree about quotes inside an argument: Windows PowerShell 5.1
 * and cmd need them written as \", PowerShell 7 and bash pass them as they are and then the
 * backslashes arrive too. Both spellings are accepted.
 */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    if (text.includes('\\"'))
      try {
        return JSON.parse(text.replaceAll('\\"', '"'));
      } catch {
        // The common message below covers it.
      }
    throw new CliInputError(
      'Ввод — не JSON. В аргументе оболочка могла убрать кавычки: их можно написать как \\" или передать JSON файлом через --input-file.',
    );
  }
}

export function jsonObject(text: string): Record<string, unknown> {
  const value = parseJson(text);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new CliInputError("Ожидается объект JSON, а не массив или скаляр.");
  }
  return value as Record<string, unknown>;
}
