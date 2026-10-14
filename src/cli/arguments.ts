export class CliInputError extends Error {
  readonly code = "cli.invalid_input";
  /** Команду справки к подсказке добавляет runCli: здесь команда ещё не известна. */
  constructor(
    message: string,
    readonly hint?: string,
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

/** Расстояние правки с перестановкой соседних букв: --feilds в одном шаге от --fields. */
function distance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        best = Math.min(best, rows[i - 2]![j - 2]! + 1);
      rows[i]![j] = best;
    }
  return rows[a.length]![b.length]!;
}

/**
 * Значение флага не печатается никогда, имя — только если похоже на имя флага: слова из букв
 * через дефис. В argv может оказаться пароль или токен, а цифр в именах флагов нет.
 */
function unknownOption(name: string): CliInputError {
  if (name.length > 30 || !/^[a-z]+(?:-[a-z]+)*$/i.test(name))
    return new CliInputError("Неизвестный флаг.");
  const lower = name.toLowerCase();
  const [near] = [...BOOLEAN_OPTIONS, ...VALUE_OPTIONS]
    .map((known) => ({ known, steps: distance(lower, known) }))
    .filter(({ steps }) => steps <= (lower.length > 4 ? 2 : 1))
    .sort((a, b) => a.steps - b.steps);
  const hint = [
    near ? `Похожий: --${near.known}.` : "",
    /(?:^|-)(?:pass|password|passwd|pwd|token|secret|key|apikey|auth|cookie|credentials?)(?:-|$)/i.test(
      name,
    )
      ? "Пароль в командной строке не принимается: его читают из переменной окружения, названной в подключении, или из stdin с --password-stdin."
      : "",
  ].filter(Boolean);
  return new CliInputError(`Неизвестный флаг --${name}.`, hint.join(" ") || undefined);
}

/** Команда, к которой относится argv: первый аргумент, который не флаг и не значение флага. */
export function commandOf(argv: readonly string[]): string | undefined {
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index]!;
    if (value === "--") return argv[index + 1];
    if (value === "-h" || value === "-v") continue;
    if (!value.startsWith("--")) return value;
    if (!value.includes("=") && VALUE_OPTIONS.has(value.slice(2))) index++;
  }
  return undefined;
}

/** Разбирается один раз; секреты намеренно не принимаются как параметры командной строки. */
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
        throw new CliInputError("Флаг --help повторяется.");
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
    if (!BOOLEAN_OPTIONS.has(name) && !VALUE_OPTIONS.has(name)) throw unknownOption(name);
    if (Object.hasOwn(result.options, name)) throw new CliInputError(`Флаг --${name} повторяется.`);
    if (BOOLEAN_OPTIONS.has(name)) {
      if (equals >= 0) throw new CliInputError(`Флаг --${name} пишется без значения.`);
      result.options[name] = true;
    } else {
      const next = equals < 0 ? argv[++index] : value.slice(equals + 1);
      if (next === undefined || next.length === 0 || (equals < 0 && next.startsWith("--"))) {
        throw new CliInputError(`Для --${name} требуется значение.`);
      }
      result.options[name] = next;
    }
  }
  const sources = [result.options["input-file"], result.options.stdin, result.options.args].filter(
    Boolean,
  );
  if (sources.length > 1)
    throw new CliInputError("Нужно выбрать один источник: --input-file, --stdin или --args.");
  if (result.options["password-stdin"] && result.options.stdin)
    throw new CliInputError(
      "--password-stdin и --stdin вместе не работают: stdin один.",
      "Ввод команды передаётся через --input-file или --args.",
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

/**
 * Список через запятую или пробел. PowerShell передаёт обёртке npm `id,fullname` без кавычек
 * массивом, а обёртка склеивает его через пробел; в именах полей и ID пробелов нет.
 */
export function listOption(args: CliArguments, name: string): string[] | undefined {
  return stringOption(args, name)
    ?.split(/[\s,]+/)
    .filter(Boolean);
}

/** Поля сортировки делятся так же, но asc и desc остаются при поле перед ними. */
export function orderOption(args: CliArguments): string[] | undefined {
  return stringOption(args, "order")
    ?.split(",")
    .flatMap((part) => part.match(/\S+(?:\s+(?:asc|desc)(?=\s|$))?/gi) ?? []);
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
 * JSON, переданный команде. Оболочки по-разному трактуют кавычки внутри аргумента: Windows
 * PowerShell 5.1 и cmd требуют писать их как \", PowerShell 7 и bash передают их как есть, и тогда
 * обратные косые черты доходят до команды тоже. Принимаются обе записи.
 */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    if (text.includes('\\"'))
      try {
        return JSON.parse(text.replaceAll('\\"', '"'));
      } catch {
        // Это покрывает общее сообщение ниже.
      }
    throw new CliInputError(
      'Ввод — не JSON. В аргументе оболочка могла убрать кавычки: их можно написать как \\" или передать JSON файлом через --input-file.',
    );
  }
}

export function jsonObject(text: string): Record<string, unknown> {
  const value = parseJson(text);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new CliInputError("Нужен объект JSON, а не массив, строка или число.");
  }
  return value as Record<string, unknown>;
}
