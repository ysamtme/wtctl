import {
  DEFAULT_CLI_REGISTRY,
  lookupCommand,
  lookupSubcommand,
  type CommandSpec,
  type OptionSpec,
  type OptionType,
  type ParseRegistry,
  type SubcommandSpec,
} from "./registry.js";

export const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const RPC_TARGET_RE = /^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/;

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

export interface OrderedOption {
  readonly name: string;
  readonly value: string;
}

export interface CliArguments {
  positionals: string[];
  options: Record<string, string | boolean | string[]>;
  optionOrder?: OrderedOption[];
}

interface RegistryIndex {
  readonly globalByLong: Map<string, OptionSpec>;
  readonly globalByShort: Map<string, OptionSpec>;
  readonly commandByName: Map<string, CommandSpec>;
  readonly allLong: Map<string, OptionSpec>;
  readonly allLongNames: readonly string[];
  readonly allShort: Map<string, OptionSpec>;
  readonly uniqueShortType: Map<string, OptionType | "mixed">;
}

const SECRET_OPTION_RE =
  /(?:^|-)(?:pass|password|passwd|pwd|token|secret|key|apikey|auth|cookie|credentials?)(?:-|$)/i;
const EXACT_SECRET_WORD_RE =
  /^(?:pass|password|passwd|pwd|token|secret|key|apikey|auth|cookie|credentials?)$/i;
const PASSWORD_HINT =
  "Пароль в командной строке не принимается: его читают из переменной окружения, названной в подключении, или из stdin с --password-stdin.";

/** Короткий флаг (-x, -x=val, -!=val), одиночный дефис перед известным длинным флагом (-json) или секретным словом (-password). */
function parseShortToken(
  token: string,
  index: RegistryIndex,
): { readonly raw: string; readonly equals: number } | undefined {
  if (!token.startsWith("-") || token.length < 2 || token.startsWith("--")) return undefined;
  const equals = token.indexOf("=");
  const raw = token.slice(1, equals < 0 ? undefined : equals);
  if (raw.length === 1) {
    // Отрицательная цифра без = (например -1) — числовое значение, а не флаг.
    if (equals < 0 && /^\d$/.test(raw)) return undefined;
    return { raw, equals };
  }
  const lower = raw.toLowerCase();
  if (index.allLong.has(lower) || EXACT_SECRET_WORD_RE.test(lower)) return { raw, equals };
  return undefined;
}

/** Отдельный токен, который выглядит как флаг и не может молча съедаться как значение флага перед ним. */
function isNextFlagToken(
  token: string,
  index: RegistryIndex,
  longNames: ReadonlyMap<string, OptionSpec> = index.allLong,
): boolean {
  if (token.startsWith("--")) return true;
  const short = parseShortToken(token, index);
  if (!short) return false;
  if (short.raw.length === 1) return true;
  const lower = short.raw.toLowerCase();
  return longNames.has(lower) || EXACT_SECRET_WORD_RE.test(lower);
}

function recordShortType(map: Map<string, OptionType | "mixed">, option: OptionSpec): void {
  if (!option.short) return;
  const previous = map.get(option.short);
  if (previous === undefined) map.set(option.short, option.type);
  else if (previous !== option.type) map.set(option.short, "mixed");
}

function buildIndex(registry: ParseRegistry): RegistryIndex {
  const globalByLong = new Map<string, OptionSpec>();
  const globalByShort = new Map<string, OptionSpec>();
  const commandByName = new Map<string, CommandSpec>();
  const allLong = new Map<string, OptionSpec>();
  const allShort = new Map<string, OptionSpec>();
  const uniqueShortType = new Map<string, OptionType | "mixed">();

  for (const option of registry.globalOptions) {
    globalByLong.set(option.name, option);
    if (option.short) {
      globalByShort.set(option.short, option);
      if (!allShort.has(option.short)) allShort.set(option.short, option);
    }
    allLong.set(option.name, option);
    recordShortType(uniqueShortType, option);
  }
  for (const command of registry.commands) {
    commandByName.set(command.name, command);
    for (const option of command.options ?? []) {
      if (!allLong.has(option.name)) allLong.set(option.name, option);
      if (option.short && !allShort.has(option.short)) allShort.set(option.short, option);
      recordShortType(uniqueShortType, option);
    }
    for (const sub of command.subcommands ?? []) {
      for (const option of sub.options ?? []) {
        if (!allLong.has(option.name)) allLong.set(option.name, option);
        if (option.short && !allShort.has(option.short)) allShort.set(option.short, option);
        recordShortType(uniqueShortType, option);
      }
    }
  }
  return {
    globalByLong,
    globalByShort,
    commandByName,
    allLong,
    allLongNames: [...allLong.keys()],
    allShort,
    uniqueShortType,
  };
}

let cachedDefaultIndex: RegistryIndex | undefined;

function getIndex(registry: ParseRegistry): RegistryIndex {
  if (registry === DEFAULT_CLI_REGISTRY) {
    cachedDefaultIndex ??= buildIndex(DEFAULT_CLI_REGISTRY);
    return cachedDefaultIndex;
  }
  return buildIndex(registry);
}

/** Единый тип короткого флага внутри команды и её подкоманд, если все определения согласны. */
function commandShortType(command: CommandSpec | undefined, short: string): OptionType | undefined {
  if (!command) return undefined;
  let type: OptionType | undefined;
  for (const option of [
    ...(command.options ?? []),
    ...(command.subcommands?.flatMap((sub) => sub.options ?? []) ?? []),
  ]) {
    if (option.short !== short) continue;
    if (type === undefined) type = option.type;
    else if (type !== option.type) return undefined;
  }
  return type;
}

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
 * Имя из argv печатается, только если похоже на имя флага или команды: слова из букв через дефис.
 * В argv может оказаться пароль или токен, а цифр в именах нет.
 */
export function printableName(name: string): boolean {
  return name.length <= 30 && /^[a-z]+(?:-[a-z]+)*$/i.test(name);
}

function unknownFlagError(label: string, near: string | undefined, raw: string): CliInputError {
  const hint = [
    near ? `Похожий: --${near}.` : "",
    SECRET_OPTION_RE.test(raw) ? PASSWORD_HINT : "",
  ].filter(Boolean);
  return new CliInputError(`Неизвестный флаг ${label}.`, hint.join(" ") || undefined);
}

/** Значение флага не печатается никогда, имя — по правилу printableName. */
function unknownOption(
  name: string,
  scopeByLong: Map<string, OptionSpec>,
  allLongNames: readonly string[],
): CliInputError {
  if (!printableName(name)) return new CliInputError("Неизвестный флаг.");
  const lower = name.toLowerCase();
  const [near] = allLongNames
    .map((known) => ({ known, steps: distance(lower, known), inScope: scopeByLong.has(known) }))
    .filter(({ known, steps }) => steps <= (Math.min(lower.length, known.length) > 4 ? 2 : 1))
    .sort((a, b) => a.steps - b.steps || Number(b.inScope) - Number(a.inScope));
  return unknownFlagError(`--${name}`, near?.known, name);
}

/** Неизвестный короткий флаг: имя проверяется через printableName, значение после = не печатается. */
function unknownShortOption(raw: string, allLongNames: readonly string[]): CliInputError {
  if (!printableName(raw)) return new CliInputError("Неизвестный флаг.");
  const lower = raw.toLowerCase();
  const near = allLongNames.includes(lower) ? lower : undefined;
  return unknownFlagError(`-${raw}`, near, raw);
}

/** Команда, к которой относится argv: первый аргумент, который не флаг и не значение флага. */
export function commandOf(argv: readonly string[]): string | undefined {
  return locateCommand(argv, getIndex(DEFAULT_CLI_REGISTRY)).commandName;
}

interface LocatedCommand {
  readonly commandName: string | undefined;
  readonly commandSpec: CommandSpec | undefined;
  readonly subcommandSpec: SubcommandSpec | undefined;
}

/** Первый проход: находит команду и подкоманду для контекстного разрешения коротких флагов. */
function locateCommand(argv: readonly string[], index: RegistryIndex): LocatedCommand {
  const found: string[] = [];
  let positionalOnly = false;
  let commandSpec: CommandSpec | undefined;

  for (let i = 0; i < argv.length && found.length < 2; i++) {
    const value = argv[i]!;
    if (positionalOnly) {
      found.push(value);
      if (found.length === 1) commandSpec = index.commandByName.get(value);
      continue;
    }
    if (value === "--") {
      positionalOnly = true;
      continue;
    }
    if (value.startsWith("--")) {
      const equals = value.indexOf("=");
      const name = value.slice(2);
      if (equals < 0 && index.allLong.get(name)?.type === "string") {
        const nextFlags = name === "input-file" ? index.globalByLong : index.allLong;
        if (i + 1 < argv.length && !isNextFlagToken(argv[i + 1]!, index, nextFlags)) i++;
      }
      continue;
    }
    const shortToken = parseShortToken(value, index);
    if (shortToken) {
      if (shortToken.equals < 0 && shortToken.raw.length === 1) {
        const type =
          index.globalByShort.get(shortToken.raw)?.type ??
          (found.length === 1
            ? commandShortType(commandSpec, shortToken.raw)
            : index.uniqueShortType.get(shortToken.raw));
        // Если короткий флаг до команды бывает и булевым, и строковым (например -f),
        // значение пропускается, только когда следующий токен не команда, а после него идёт команда.
        const nextFlags = shortToken.raw === "i" ? index.globalByLong : index.allLong;
        const consumesValue =
          type === "string" ||
          (type === "mixed" &&
            found.length === 0 &&
            i + 1 < argv.length &&
            !isNextFlagToken(argv[i + 1]!, index, nextFlags) &&
            !index.commandByName.has(argv[i + 1]!) &&
            i + 2 < argv.length &&
            index.commandByName.has(argv[i + 2]!));
        if (
          consumesValue &&
          i + 1 < argv.length &&
          !isNextFlagToken(argv[i + 1]!, index, nextFlags)
        )
          i++;
      }
      continue;
    }
    found.push(value);
    if (found.length === 1) commandSpec = index.commandByName.get(value);
  }

  const [commandName, second] = found;
  const subcommandSpec =
    second !== undefined && commandSpec !== undefined
      ? lookupSubcommand(commandSpec, second)
      : undefined;
  return { commandName, commandSpec, subcommandSpec };
}

function resolveScopeOptions(
  registry: ParseRegistry,
  located: LocatedCommand,
): {
  readonly scopeByLong: Map<string, OptionSpec>;
  readonly scopeByShort: Map<string, OptionSpec>;
  readonly validateOptions: boolean;
  readonly scopeLabel: string;
  readonly requiresDirectCallArgs: boolean;
} {
  const scopeByLong = new Map<string, OptionSpec>();
  const scopeByShort = new Map<string, OptionSpec>();
  const add = (options: readonly OptionSpec[] | undefined) => {
    for (const option of options ?? []) {
      scopeByLong.set(option.name, option);
      if (option.short) scopeByShort.set(option.short, option);
    }
  };
  add(registry.globalOptions);

  const { commandName, commandSpec, subcommandSpec } = located;
  if (subcommandSpec !== undefined && commandName !== undefined) {
    add(subcommandSpec.options);
    return {
      scopeByLong,
      scopeByShort,
      validateOptions: true,
      scopeLabel: `${commandName} ${subcommandSpec.name}`,
      requiresDirectCallArgs: false,
    };
  }
  if (commandSpec !== undefined && commandName !== undefined) {
    if (!commandSpec.subcommands) {
      add(commandSpec.options);
      return {
        scopeByLong,
        scopeByShort,
        validateOptions: true,
        scopeLabel: commandName,
        requiresDirectCallArgs: false,
      };
    }
    if (commandSpec.call !== undefined) {
      add(commandSpec.options);
      return {
        scopeByLong,
        scopeByShort,
        validateOptions: true,
        scopeLabel: commandName,
        requiresDirectCallArgs: true,
      };
    }
    return {
      scopeByLong,
      scopeByShort,
      validateOptions: false,
      scopeLabel: commandName,
      requiresDirectCallArgs: false,
    };
  }
  if (commandName === undefined || commandName === "help") {
    return {
      scopeByLong,
      scopeByShort,
      validateOptions: true,
      scopeLabel: commandName === "help" ? "help" : "",
      requiresDirectCallArgs: false,
    };
  }
  return {
    scopeByLong,
    scopeByShort,
    validateOptions: false,
    scopeLabel: "",
    requiresDirectCallArgs: false,
  };
}

function recordOption(
  result: CliArguments,
  spec: OptionSpec,
  equals: number,
  token: string,
  argv: readonly string[],
  cursor: { index: number },
  index: RegistryIndex,
  scopeByLong: ReadonlyMap<string, OptionSpec>,
): void {
  if (spec.type === "boolean") {
    if (equals >= 0) throw new CliInputError(`Флаг --${spec.name} пишется без значения.`);
    if (Object.hasOwn(result.options, spec.name))
      throw new CliInputError(`Флаг --${spec.name} повторяется.`);
    result.options[spec.name] = true;
    return;
  }
  const next = equals < 0 ? argv[++cursor.index] : token.slice(equals + 1);
  // Для --input-file имена вроде -remove (флаг другой команды) остаются именами файлов; остальные флаги сверяются со всеми флагами CLI.
  const nextFlags = spec.name === "input-file" ? scopeByLong : index.allLong;
  if (
    next === undefined ||
    next.length === 0 ||
    (equals < 0 && isNextFlagToken(next, index, nextFlags))
  ) {
    throw new CliInputError(`Для --${spec.name} требуется значение.`);
  }
  if (spec.repeatable) {
    const existing = result.options[spec.name];
    if (Array.isArray(existing)) existing.push(next);
    else result.options[spec.name] = [next];
    (result.optionOrder ??= []).push({ name: spec.name, value: next });
    return;
  }
  if (Object.hasOwn(result.options, spec.name))
    throw new CliInputError(`Флаг --${spec.name} повторяется.`);
  result.options[spec.name] = next;
}

/** Разбирается один раз по декларативному реестру; секреты не принимаются параметрами командной строки. */
export function parseArguments(
  argv: readonly string[],
  registry: ParseRegistry = DEFAULT_CLI_REGISTRY,
): CliArguments {
  const index = getIndex(registry);
  const located = locateCommand(argv, index);
  const scope = resolveScopeOptions(registry, located);
  const result: CliArguments = { positionals: [], options: {} };
  let positionalOnly = false;
  const cursor = { index: 0 };

  for (; cursor.index < argv.length; cursor.index++) {
    const value = argv[cursor.index]!;
    if (!positionalOnly && value === "--") {
      positionalOnly = true;
      continue;
    }
    if (positionalOnly) {
      result.positionals.push(value);
      continue;
    }
    if (value.startsWith("--")) {
      const equals = value.indexOf("=");
      const name = value.slice(2, equals < 0 ? undefined : equals);
      const spec = scope.scopeByLong.get(name) ?? index.allLong.get(name);
      if (!spec) throw unknownOption(name, scope.scopeByLong, index.allLongNames);
      recordOption(result, spec, equals, value, argv, cursor, index, scope.scopeByLong);
      continue;
    }
    const shortToken = parseShortToken(value, index);
    if (shortToken) {
      const { raw, equals } = shortToken;
      const spec =
        raw.length === 1
          ? (scope.scopeByShort.get(raw) ??
            (!scope.validateOptions ? index.allShort.get(raw) : undefined))
          : undefined;
      if (!spec) throw unknownShortOption(raw, index.allLongNames);
      recordOption(result, spec, equals, value, argv, cursor, index, scope.scopeByLong);
      continue;
    }
    result.positionals.push(value);
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
  const localFormat = scope.scopeByLong.get("format")?.overridesGlobal === true;
  if (result.options.json && result.options.format !== undefined && !localFormat)
    throw new CliInputError("Нужно выбрать --json или --format, а не оба.");

  // КОМАНДА [ПОДКОМАНДА] … --help: параметры, набранные до --help, относятся к команде и не проверяются.
  if (result.options.help) {
    const [first, second] = result.positionals;
    const command = first === undefined ? undefined : index.commandByName.get(first);
    const hasSub =
      second !== undefined &&
      command !== undefined &&
      lookupSubcommand(command, second) !== undefined;
    result.positionals =
      first === undefined ? ["help"] : hasSub ? ["help", first, second] : ["help", first];
    return result;
  }

  let allowed = scope.scopeByLong;
  let shouldValidate =
    scope.validateOptions &&
    (!scope.requiresDirectCallArgs ||
      result.positionals.length >= 3 ||
      (result.positionals.length === 2 && RPC_TARGET_RE.test(result.positionals[1]!)));
  let scopeLabel = scope.scopeLabel;

  if (result.options.version) {
    delete result.options.version;
    result.positionals = ["version", ...result.positionals];
    allowed = index.globalByLong;
    shouldValidate = true;
    scopeLabel = "version";
  }

  if (shouldValidate) {
    const extra = Object.keys(result.options).filter((key) => !allowed.has(key));
    if (extra.length) {
      const command = scopeLabel ? ` ${scopeLabel}` : "";
      throw new CliInputError(
        `Команда${command} не принимает: ${extra.map((key) => `--${key}`).join(", ")}.`,
      );
    }
  }

  return result;
}

export function stringOption(args: CliArguments, name: string): string | undefined {
  const value = args.options[name];
  return typeof value === "string" ? value : undefined;
}

export function repeatedOption(args: CliArguments, name: string): string[] {
  const value = args.options[name];
  if (Array.isArray(value)) return value;
  return typeof value === "string" ? [value] : [];
}

/** Повторяемые флаги из набора `names` в точном порядке их появления в argv. */
export function orderedOptions(args: CliArguments, names: readonly string[]): OrderedOption[] {
  if (args.optionOrder) {
    const wanted = new Set(names);
    return args.optionOrder.filter((entry) => wanted.has(entry.name));
  }
  const fallback: OrderedOption[] = [];
  for (const name of names) {
    for (const value of repeatedOption(args, name)) fallback.push({ name, value });
  }
  return fallback;
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

export function intervalOption(
  args: CliArguments,
  name = "interval",
  minimum = 0.5,
  maximum = 60,
): number | undefined {
  const value = stringOption(args, name);
  if (value === undefined) return undefined;
  if (!/^\d+(?:\.\d+)?$/.test(value))
    throw new CliInputError(
      `--${name} должен быть числом в секундах (от ${minimum} до ${maximum}).`,
    );
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new CliInputError(`--${name} должен быть от ${minimum} до ${maximum} секунд.`);
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

export function exactPositionals(args: CliArguments, minimum: number, maximum = minimum): void {
  if (args.positionals.length < minimum || args.positionals.length > maximum) {
    if (args.positionals.length < minimum)
      throw new CliInputError("Не хватает аргументов команды.");
    throw new CliInputError(
      "Лишние аргументы команды.",
      "Текст с пробелами, например запрос XQuery, берут в кавычки целиком.",
    );
  }
}

export function optional(key: string, value: unknown): Record<string, unknown> {
  return value === undefined ? {} : { [key]: value };
}

export function enumOption<T extends string>(
  args: CliArguments,
  name: string,
  allowed: readonly T[],
  message: string,
): T | undefined {
  const value = stringOption(args, name);
  if (value !== undefined && !allowed.includes(value as T)) throw new CliInputError(message);
  return value as T | undefined;
}

export function rejectPasswordStdin(args: CliArguments, message: string, hint?: string): void {
  if (args.options["password-stdin"]) throw new CliInputError(message, hint);
}

/** Относится ли --format к параметру самой подкоманды (result read / result export), а не к виду вывода CLI. */
export function usesLocalFormat(args: CliArguments): boolean {
  const [command, action] = args.positionals;
  if (!command || !action) return false;
  const spec = lookupCommand(command);
  const sub = spec ? lookupSubcommand(spec, action) : undefined;
  return (
    sub?.options?.some((option) => option.name === "format" && option.overridesGlobal === true) ===
    true
  );
}

/** То же по исходному argv до разбора — нужно, когда parseArguments уже выбросил ошибку. */
export function usesLocalFormatArgv(argv: readonly string[]): boolean {
  const { subcommandSpec } = locateCommand(argv, getIndex(DEFAULT_CLI_REGISTRY));
  return (
    subcommandSpec?.options?.some(
      (option) => option.name === "format" && option.overridesGlobal === true,
    ) === true
  );
}
