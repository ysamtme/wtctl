import { MAX_CONFIG_BYTES, defaultConfigPath } from "../config.js";
import { guideTopics } from "../guide.js";
import { CliInputError, exactPositionals, stringOption, type CliArguments } from "./arguments.js";
import {
  CLI_COMMANDS,
  GLOBAL_OPTIONS,
  visibleCommands,
  type CommandSpec,
  type OptionSpec,
} from "./registry.js";
import type { CliIo } from "./types.js";

export const COMPLETION_SHELLS = ["pwsh", "bash", "zsh"] as const;
export type CompletionShell = (typeof COMPLETION_SHELLS)[number];

const CONNECTION_NAME_RE = /^[A-Za-z0-9_.-]{1,64}$/;
const CONNECTION_POSITIONAL_SCOPES = new Set([
  "config use",
  "config remove",
  "config rm",
  "config set",
]);

interface CompletionItem {
  readonly name: string;
  readonly description: string;
}

interface CompletionFlag {
  readonly long: string;
  readonly short?: string;
  readonly takesValue: boolean;
  readonly values?: readonly string[];
  readonly dynamic?: "connections";
  readonly description: string;
}

interface CompletionModel {
  readonly commands: readonly CompletionItem[];
  readonly subcommands: ReadonlyMap<string, readonly CompletionItem[]>;
  readonly globalFlags: readonly CompletionFlag[];
  readonly scopeFlags: ReadonlyMap<string, readonly CompletionFlag[]>;
  readonly scopePositionalValues: ReadonlyMap<string, readonly CompletionItem[]>;
  readonly connectionPositionalScopes: ReadonlySet<string>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Проверяет имя оболочки для `wtctl completion`. */
export function parseCompletionShell(value: string | undefined): CompletionShell {
  if (value === undefined || !value.trim()) {
    throw new CliInputError("Не указана оболочка: поддерживаются pwsh, bash и zsh.");
  }
  if ((COMPLETION_SHELLS as readonly string[]).includes(value)) {
    return value as CompletionShell;
  }
  throw new CliInputError("Неподдерживаемая оболочка: поддерживаются pwsh, bash и zsh.");
}

/** Читает имена подключений из файла подключений без раскрытия паролей и URL; при ошибке — пустой список. */
export async function readConnectionNamesForCompletion(
  configPath: string,
  io: Pick<CliIo, "readFile">,
): Promise<string[]> {
  try {
    const text = await io.readFile(configPath, MAX_CONFIG_BYTES);
    const parsed: unknown = JSON.parse(text);
    if (!isPlainObject(parsed)) return [];
    if (isPlainObject(parsed.connections)) {
      return Object.keys(parsed.connections).filter(
        (name) => parsed.connections !== undefined && CONNECTION_NAME_RE.test(name),
      );
    }
    if (Object.keys(parsed).length > 0) {
      if (
        typeof parsed.defaultConnection === "string" &&
        CONNECTION_NAME_RE.test(parsed.defaultConnection)
      ) {
        return [parsed.defaultConnection];
      }
      if (typeof parsed.baseUrl === "string" && parsed.baseUrl.trim() !== "") {
        return ["default"];
      }
    }
    return [];
  } catch {
    return [];
  }
}

/** Служебная команда `__complete-connections` для динамического дополнения имён подключений. */
export async function runCompleteConnections(args: CliArguments, io: CliIo): Promise<number> {
  exactPositionals(args, 1);
  for (const key of Object.keys(args.options)) {
    if (key !== "config") {
      throw new CliInputError(`Служебная команда __complete-connections не принимает --${key}.`);
    }
  }
  const configPath =
    stringOption(args, "config") ?? process.env.WTCTL_CONFIG ?? defaultConfigPath();
  const names = await readConnectionNamesForCompletion(configPath, io);
  if (names.length > 0) await io.writeOut(`${names.join("\n")}\n`);
  return 0;
}

function toCompletionFlag(option: OptionSpec): CompletionFlag {
  return {
    long: `--${option.name}`,
    ...(option.short === undefined ? {} : { short: `-${option.short}` }),
    takesValue: option.type === "string",
    ...(option.values === undefined ? {} : { values: option.values }),
    ...(option.name === "connection" ? { dynamic: "connections" as const } : {}),
    description: option.description,
  };
}

function buildCompletionModel(
  commands: readonly CommandSpec[] = CLI_COMMANDS,
  globalOptions: readonly OptionSpec[] = GLOBAL_OPTIONS,
): CompletionModel {
  const visible = visibleCommands(commands);
  const topCommands: CompletionItem[] = [
    ...visible.map((cmd) => ({ name: cmd.name, description: cmd.summary })),
    { name: "help", description: "Справка по командам и подкомандам." },
  ];

  const subcommands = new Map<string, CompletionItem[]>();
  const scopeFlags = new Map<string, CompletionFlag[]>();
  const scopePositionalValues = new Map<string, CompletionItem[]>();

  const globalFlags = globalOptions.map(toCompletionFlag);

  for (const cmd of visible) {
    if (cmd.options?.length) {
      scopeFlags.set(cmd.name, cmd.options.map(toCompletionFlag));
    }
    if (cmd.subcommands?.length) {
      const items: CompletionItem[] = [];
      for (const sub of cmd.subcommands) {
        items.push({ name: sub.name, description: sub.summary });
        const flags = sub.options?.map(toCompletionFlag) ?? [];
        if (flags.length) scopeFlags.set(`${cmd.name} ${sub.name}`, flags);
        for (const alias of sub.aliases ?? []) {
          items.push({ name: alias, description: sub.summary });
          if (flags.length) scopeFlags.set(`${cmd.name} ${alias}`, flags);
        }
      }
      subcommands.set(cmd.name, items);
    }
  }

  // Команда help дополняет имена команд, а вторым словом — их подкоманды.
  subcommands.set(
    "help",
    visible.map((cmd) => ({ name: cmd.name, description: cmd.summary })),
  );
  for (const cmd of visible) {
    if (cmd.subcommands?.length) {
      scopePositionalValues.set(
        `help ${cmd.name}`,
        cmd.subcommands.map((sub) => ({ name: sub.name, description: sub.summary })),
      );
    }
  }

  scopePositionalValues.set("completion", [
    { name: "pwsh", description: "PowerShell (5.1 и 7+)." },
    { name: "bash", description: "GNU Bash." },
    { name: "zsh", description: "Zsh." },
  ]);

  const topics = guideTopics().slice(1);
  if (topics.length > 0) {
    scopePositionalValues.set(
      "guide",
      topics.map((topic) => ({ name: topic, description: `Тема гайда ${topic}.` })),
    );
  }

  return {
    commands: topCommands,
    subcommands,
    globalFlags,
    scopeFlags,
    scopePositionalValues,
    connectionPositionalScopes: CONNECTION_POSITIONAL_SCOPES,
  };
}

function cleanDescription(text: string, fallback: string): string {
  const cleaned = text.replace(/[\r\n\t]+/g, " ").trim();
  return cleaned || fallback;
}

function psQuote(text: string): string {
  return `'${text.replaceAll("'", "''")}'`;
}

function psArray(items: readonly string[]): string {
  return `@(${items.map(psQuote).join(", ")})`;
}

function psEntryList(items: readonly CompletionItem[]): string {
  const entries = items.map(
    (item) =>
      `@{ N = ${psQuote(item.name)}; D = ${psQuote(cleanDescription(item.description, item.name))} }`,
  );
  return `@(${entries.join(", ")})`;
}

function psFlagList(flags: readonly CompletionFlag[]): string {
  const entries = flags.map((flag) => {
    const parts = [
      `L = ${psQuote(flag.long)}`,
      ...(flag.short ? [`S = ${psQuote(flag.short)}`] : []),
      `V = ${flag.takesValue ? "$true" : "$false"}`,
      ...(flag.values?.length ? [`E = ${psArray(flag.values)}`] : []),
      ...(flag.dynamic ? [`Dyn = ${psQuote(flag.dynamic)}`] : []),
      `D = ${psQuote(cleanDescription(flag.description, flag.long))}`,
    ];
    return `@{ ${parts.join("; ")} }`;
  });
  return `@(${entries.join(", ")})`;
}

function generatePwshCompletion(model: CompletionModel): string {
  const subEntries = [...model.subcommands.entries()].map(
    ([cmd, items]) => `        ${psQuote(cmd)} = ${psEntryList(items)}`,
  );
  const scopeFlagEntries = [...model.scopeFlags.entries()].map(
    ([scope, flags]) => `        ${psQuote(scope)} = ${psFlagList(flags)}`,
  );
  const scopePosEntries = [...model.scopePositionalValues.entries()].map(
    ([scope, items]) => `        ${psQuote(scope)} = ${psEntryList(items)}`,
  );
  const connScopes = psArray([...model.connectionPositionalScopes]);

  return [
    "# Автодополнение wtctl для PowerShell (подключение: wtctl completion pwsh --format raw | Out-String | Invoke-Expression)",
    "Register-ArgumentCompleter -Native -CommandName wtctl -ScriptBlock {",
    "    param($wordToComplete, $commandAst, $cursorPosition)",
    "",
    `    $topCommands = ${psEntryList(model.commands)}`,
    `    $globalFlags = ${psFlagList(model.globalFlags)}`,
    "    $subcommands = @{",
    ...subEntries,
    "    }",
    "    $scopeFlags = @{",
    ...scopeFlagEntries,
    "    }",
    "    $scopePositionalValues = @{",
    ...scopePosEntries,
    "    }",
    `    $connectionPositionalScopes = ${connScopes}`,
    "",
    "    $resolveFlags = {",
    "        param($cmdName, $subName)",
    "        $byLong = [ordered]@{}",
    "        foreach ($f in $globalFlags) { $byLong[$f.L] = $f }",
    "        $key = if ($subName) { \"$cmdName $subName\" } elseif ($cmdName) { $cmdName } else { '' }",
    "        if ($key -and $scopeFlags.ContainsKey($key)) {",
    "            foreach ($f in $scopeFlags[$key]) { $byLong[$f.L] = $f }",
    "        } elseif ($cmdName -and $scopeFlags.ContainsKey($cmdName)) {",
    "            foreach ($f in $scopeFlags[$cmdName]) { $byLong[$f.L] = $f }",
    "        }",
    "        return @($byLong.Values)",
    "    }",
    "",
    "    $findFlag = {",
    "        param($flagList, $token)",
    "        foreach ($f in $flagList) {",
    "            if ($f.L -eq $token -or ($f.ContainsKey('S') -and $f.S -eq $token)) { return $f }",
    "        }",
    "        return $null",
    "    }",
    "",
    "    $getConnections = {",
    "        param($cfgPath)",
    "        $callArgs = @('__complete-connections')",
    "        if ($cfgPath) { $callArgs += @('--config', $cfgPath) }",
    "        $out = & wtctl @callArgs 2>$null",
    "        if (-not $out) { return @() }",
    "        return @($out | ForEach-Object { $_.ToString().Trim() } | Where-Object { $_ -ne '' })",
    "    }",
    "",
    "    $unquote = {",
    "        param($s)",
    '        if ($s.Length -ge 2 -and $s.StartsWith("\'") -and $s.EndsWith("\'")) {',
    '            return $s.Substring(1, $s.Length - 2).Replace("\'\'", "\'")',
    "        }",
    "        if ($s.Length -ge 2 -and $s.StartsWith('\"') -and $s.EndsWith('\"')) {",
    "            return $s.Substring(1, $s.Length - 2).Replace('`\"', '\"').Replace('``', '`')",
    "        }",
    "        return $s",
    "    }",
    "",
    "    $tokens = @()",
    "    for ($i = 1; $i -lt $commandAst.CommandElements.Count; $i++) {",
    "        $el = $commandAst.CommandElements[$i]",
    "        if ($el.Extent.EndOffset -le $cursorPosition -and ($wordToComplete -eq '' -or $el.Extent.EndOffset -lt $cursorPosition)) {",
    "            if ($el -is [System.Management.Automation.Language.StringConstantExpressionAst] -or $el -is [System.Management.Automation.Language.ExpandableStringExpressionAst]) {",
    "                $tokens += $el.Value",
    "            } else {",
    "                $tokens += $el.Extent.Text",
    "            }",
    "        }",
    "    }",
    "",
    "    $cmd = $null",
    "    $sub = $null",
    "    $configPath = $null",
    "    $expectFlag = $null",
    "    $afterDoubleDash = $false",
    "    $posCount = 0",
    "",
    "    foreach ($tok in $tokens) {",
    "        if ($null -ne $expectFlag) {",
    "            if ($expectFlag.L -eq '--config') { $configPath = & $unquote $tok }",
    "            $expectFlag = $null",
    "            continue",
    "        }",
    "        if (-not $afterDoubleDash -and $tok -eq '--') {",
    "            $afterDoubleDash = $true",
    "            continue",
    "        }",
    "        if (-not $afterDoubleDash -and $tok.StartsWith('-')) {",
    "            if ($tok -match '^(--[A-Za-z0-9-]+)=(.*)$') {",
    "                if ($Matches[1] -eq '--config') { $configPath = & $unquote $Matches[2] }",
    "                continue",
    "            }",
    "            $curFlags = & $resolveFlags $cmd $sub",
    "            $matched = & $findFlag $curFlags $tok",
    "            if ($null -ne $matched -and $matched.V) { $expectFlag = $matched }",
    "            continue",
    "        }",
    "        if (-not $cmd) {",
    "            $cmd = $tok",
    "        } elseif (-not $sub -and $subcommands.ContainsKey($cmd)) {",
    "            $sub = $tok",
    "        } else {",
    "            $posCount++",
    "        }",
    "    }",
    "",
    "    $activeFlags = & $resolveFlags $cmd $sub",
    "    $scopeKey = if ($sub) { \"$cmd $sub\" } elseif ($cmd) { $cmd } else { '' }",
    "",
    "    if ($null -ne $expectFlag) {",
    "        if ($expectFlag.ContainsKey('Dyn') -and $expectFlag.Dyn -eq 'connections') {",
    "            foreach ($name in (& $getConnections $configPath)) {",
    "                if ($name.StartsWith($wordToComplete, [System.StringComparison]::OrdinalIgnoreCase)) {",
    "                    [System.Management.Automation.CompletionResult]::new($name, $name, 'ParameterValue', 'Подключение')",
    "                }",
    "            }",
    "        } elseif ($expectFlag.ContainsKey('E')) {",
    "            foreach ($val in $expectFlag.E) {",
    "                if ($val.StartsWith($wordToComplete, [System.StringComparison]::OrdinalIgnoreCase)) {",
    "                    [System.Management.Automation.CompletionResult]::new($val, $val, 'ParameterValue', $val)",
    "                }",
    "            }",
    "        }",
    "        return",
    "    }",
    "",
    "    if (-not $afterDoubleDash -and $wordToComplete -match '^(--[A-Za-z0-9-]+)=(.*)$') {",
    "        $flagName = $Matches[1]",
    "        $valPrefix = $Matches[2]",
    "        $matched = & $findFlag $activeFlags $flagName",
    "        if ($null -ne $matched) {",
    "            if ($matched.ContainsKey('Dyn') -and $matched.Dyn -eq 'connections') {",
    "                foreach ($name in (& $getConnections $configPath)) {",
    "                    if ($name.StartsWith($valPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {",
    "                        [System.Management.Automation.CompletionResult]::new(\"$flagName=$name\", $name, 'ParameterValue', 'Подключение')",
    "                    }",
    "                }",
    "            } elseif ($matched.ContainsKey('E')) {",
    "                foreach ($val in $matched.E) {",
    "                    if ($val.StartsWith($valPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {",
    "                        [System.Management.Automation.CompletionResult]::new(\"$flagName=$val\", $val, 'ParameterValue', $val)",
    "                    }",
    "                }",
    "            }",
    "        }",
    "        return",
    "    }",
    "",
    "    if (-not $afterDoubleDash -and $wordToComplete.StartsWith('-')) {",
    "        foreach ($f in $activeFlags) {",
    "            if ($f.L.StartsWith($wordToComplete, [System.StringComparison]::OrdinalIgnoreCase)) {",
    "                [System.Management.Automation.CompletionResult]::new($f.L, $f.L, 'ParameterName', $f.D)",
    "            }",
    "            if ($f.ContainsKey('S') -and $f.S.StartsWith($wordToComplete, [System.StringComparison]::OrdinalIgnoreCase)) {",
    "                [System.Management.Automation.CompletionResult]::new($f.S, $f.S, 'ParameterName', $f.D)",
    "            }",
    "        }",
    "        return",
    "    }",
    "",
    "    if (-not $cmd) {",
    "        foreach ($item in $topCommands) {",
    "            if ($item.N.StartsWith($wordToComplete, [System.StringComparison]::OrdinalIgnoreCase)) {",
    "                [System.Management.Automation.CompletionResult]::new($item.N, $item.N, 'Command', $item.D)",
    "            }",
    "        }",
    "        return",
    "    }",
    "",
    "    if (-not $sub -and $subcommands.ContainsKey($cmd)) {",
    "        foreach ($item in $subcommands[$cmd]) {",
    "            if ($item.N.StartsWith($wordToComplete, [System.StringComparison]::OrdinalIgnoreCase)) {",
    "                [System.Management.Automation.CompletionResult]::new($item.N, $item.N, 'Command', $item.D)",
    "            }",
    "        }",
    "        return",
    "    }",
    "",
    "    if ($posCount -eq 0) {",
    "        if ($connectionPositionalScopes -contains $scopeKey) {",
    "            foreach ($name in (& $getConnections $configPath)) {",
    "                if ($name.StartsWith($wordToComplete, [System.StringComparison]::OrdinalIgnoreCase)) {",
    "                    [System.Management.Automation.CompletionResult]::new($name, $name, 'ParameterValue', 'Подключение')",
    "                }",
    "            }",
    "            return",
    "        }",
    "        if ($scopePositionalValues.ContainsKey($scopeKey)) {",
    "            foreach ($item in $scopePositionalValues[$scopeKey]) {",
    "                if ($item.N.StartsWith($wordToComplete, [System.StringComparison]::OrdinalIgnoreCase)) {",
    "                    [System.Management.Automation.CompletionResult]::new($item.N, $item.N, 'ParameterValue', $item.D)",
    "                }",
    "            }",
    "        }",
    "    }",
    "}",
    "",
  ].join("\n");
}

function allFlagTokens(flags: readonly CompletionFlag[]): string[] {
  const out: string[] = [];
  for (const flag of flags) {
    out.push(flag.long);
    if (flag.short) out.push(flag.short);
  }
  return out;
}

function generateBashCompletion(model: CompletionModel): string {
  const topNames = model.commands.map((c) => c.name).join(" ");
  const cmdsWithSubs = [...model.subcommands.keys()].join("|");
  const globalFlagNames = allFlagTokens(model.globalFlags).join(" ");
  const globalValFlags = allFlagTokens(model.globalFlags.filter((f) => f.takesValue)).join("|");

  const subCases = [...model.subcommands.entries()].map(
    ([cmd, items]) => `    ${cmd}) echo '${items.map((i) => i.name).join(" ")}' ;;`,
  );

  const scopeFlagCases: string[] = [];
  const scopeValFlagCases: string[] = [];
  const scopeEnumCases: string[] = [];

  for (const [scope, localFlags] of model.scopeFlags.entries()) {
    const localTokens = allFlagTokens(localFlags);
    if (localTokens.length > 0) {
      scopeFlagCases.push(`    '${scope}') echo '${localTokens.join(" ")}' ;;`);
    }
    const localBoolShorts = localFlags.filter((f) => !f.takesValue && f.short).map((f) => f.short!);
    const localValTokens = allFlagTokens(localFlags.filter((f) => f.takesValue));
    if (localBoolShorts.length > 0 || localValTokens.length > 0) {
      scopeValFlagCases.push(`    '${scope}')`);
      if (localBoolShorts.length > 0) {
        scopeValFlagCases.push(
          `      case "$flag" in ${localBoolShorts.join("|")}) return 1 ;; esac`,
        );
      }
      if (localValTokens.length > 0) {
        scopeValFlagCases.push(
          `      case "$flag" in ${localValTokens.join("|")}) return 0 ;; esac`,
        );
      }
      scopeValFlagCases.push("      ;;");
    }
    for (const flag of localFlags) {
      if (!flag.values?.length) continue;
      const pattern = flag.short
        ? `'${scope}:${flag.long}'|'${scope}:${flag.short}'`
        : `'${scope}:${flag.long}'`;
      scopeEnumCases.push(`    ${pattern}) echo '${flag.values.join(" ")}'; return 0 ;;`);
    }
  }

  const globalEnumCases: string[] = [];
  for (const flag of model.globalFlags) {
    if (!flag.values?.length) continue;
    const pattern = flag.short ? `${flag.long}|${flag.short}` : flag.long;
    globalEnumCases.push(`    ${pattern}) echo '${flag.values.join(" ")}' ;;`);
  }

  const posCases = [...model.scopePositionalValues.entries()].map(
    ([scope, items]) => `    '${scope}') echo '${items.map((i) => i.name).join(" ")}' ;;`,
  );
  const connScopePattern = [...model.connectionPositionalScopes].map((s) => `'${s}'`).join("|");

  return [
    '# Автодополнение wtctl для bash (подключение: eval "$(wtctl completion bash --format raw)")',
    "",
    "_wtctl_complete_connections() {",
    '  local cfg="$1"',
    '  if [[ -n "$cfg" ]]; then',
    '    wtctl __complete-connections --config "$cfg" 2>/dev/null',
    "  else",
    "    wtctl __complete-connections 2>/dev/null",
    "  fi",
    "}",
    "",
    "_wtctl_has_subcommands() {",
    '  case "$1" in',
    `    ${cmdsWithSubs}) return 0 ;;`,
    "    *) return 1 ;;",
    "  esac",
    "}",
    "",
    "_wtctl_subcommands() {",
    '  case "$1" in',
    ...subCases,
    "  esac",
    "}",
    "",
    "_wtctl_local_flags() {",
    '  case "$1" in',
    ...scopeFlagCases,
    "  esac",
    "}",
    "",
    "_wtctl_scope_flags() {",
    '  local scope="$1" cmd="$2" local_flags',
    '  local_flags="$(_wtctl_local_flags "$scope")"',
    '  if [[ -z "$local_flags" && -n "$cmd" && "$scope" != "$cmd" ]]; then',
    '    local_flags="$(_wtctl_local_flags "$cmd")"',
    "  fi",
    `  echo "${globalFlagNames} \${local_flags}"`,
    "}",
    "",
    "_wtctl_scope_flag_takes_value() {",
    '  local scope="$1" flag="$2"',
    '  case "$scope" in',
    ...scopeValFlagCases,
    "  esac",
    "  return 2",
    "}",
    "",
    "_wtctl_flag_takes_value() {",
    '  local scope="$1" cmd="$2" flag="$3" rc',
    '  _wtctl_scope_flag_takes_value "$scope" "$flag"; rc=$?',
    '  if (( rc != 2 )); then return "$rc"; fi',
    '  if [[ -n "$cmd" && "$scope" != "$cmd" ]]; then',
    '    _wtctl_scope_flag_takes_value "$cmd" "$flag"; rc=$?',
    '    if (( rc != 2 )); then return "$rc"; fi',
    "  fi",
    '  case "$flag" in',
    `    ${globalValFlags}) return 0 ;;`,
    "    *) return 1 ;;",
    "  esac",
    "}",
    "",
    "_wtctl_flag_values() {",
    '  local scope="$1" flag="$2"',
    '  case "${scope}:${flag}" in',
    ...scopeEnumCases,
    "  esac",
    '  case "$flag" in',
    ...globalEnumCases,
    "  esac",
    "}",
    "",
    "_wtctl_positional_values() {",
    '  case "$1" in',
    ...posCases,
    "  esac",
    "}",
    "",
    "_wtctl_unquote() {",
    '  local s="$1"',
    '  if (( ${#s} >= 2 )) && [[ "${s:0:1}" == \'"\' && "${s: -1}" == \'"\' ]]; then',
    '    s="${s:1:${#s}-2}"',
    '    s="${s//\\\\\\"/\\"}"',
    '    s="${s//\\\\\\\\/\\\\}"',
    '  elif (( ${#s} >= 2 )) && [[ "${s:0:1}" == "\'" && "${s: -1}" == "\'" ]]; then',
    '    s="${s:1:${#s}-2}"',
    "  else",
    '    s="${s//\\\\ / }"',
    '    s="${s//\\\\\\"/\\"}"',
    "    s=\"${s//\\\\'/'}\"",
    "  fi",
    "  printf '%s' \"$s\"",
    "}",
    "",
    "_wtctl_completions() {",
    '  local cur="${COMP_WORDS[COMP_CWORD]}"',
    '  local cmd="" sub="" config_path="" expect_flag="" after_dd=0 pos_count=0 i tok scope',
    "",
    "  for ((i = 1; i < COMP_CWORD; i++)); do",
    '    tok="${COMP_WORDS[i]}"',
    '    if [[ -n "$expect_flag" ]]; then',
    '      if [[ "$expect_flag" == "--config" ]]; then config_path="$(_wtctl_unquote "$tok")"; fi',
    '      expect_flag=""',
    "      continue",
    "    fi",
    '    if (( !after_dd )) && [[ "$tok" == "--" ]]; then',
    "      after_dd=1",
    "      continue",
    "    fi",
    '    if (( !after_dd )) && [[ "$tok" == -* ]]; then',
    '      if [[ "$tok" == --*=* ]]; then',
    '        if [[ "${tok%%=*}" == "--config" ]]; then config_path="$(_wtctl_unquote "${tok#*=}")"; fi',
    "        continue",
    "      fi",
    '      if (( i + 1 < COMP_CWORD )) && [[ "${COMP_WORDS[i+1]}" == "=" ]]; then',
    "        if (( i + 2 < COMP_CWORD )); then",
    '          if [[ "$tok" == "--config" ]]; then config_path="$(_wtctl_unquote "${COMP_WORDS[i+2]}")"; fi',
    "          ((i += 2))",
    "        else",
    '          expect_flag="$tok"',
    "          ((i++))",
    "        fi",
    "        continue",
    "      fi",
    '      scope="${sub:+$cmd $sub}"',
    '      scope="${scope:-$cmd}"',
    '      if _wtctl_flag_takes_value "$scope" "$cmd" "$tok"; then expect_flag="$tok"; fi',
    "      continue",
    "    fi",
    '    if [[ -z "$cmd" ]]; then',
    '      cmd="$tok"',
    '    elif [[ -z "$sub" ]] && _wtctl_has_subcommands "$cmd"; then',
    '      sub="$tok"',
    "    else",
    "      ((pos_count++))",
    "    fi",
    "  done",
    "",
    '  scope="${sub:+$cmd $sub}"',
    '  scope="${scope:-$cmd}"',
    "",
    '  if [[ -n "$expect_flag" ]]; then',
    '    local prefix="" match_cur="$cur"',
    '    if [[ "$cur" == "=" ]]; then prefix="="; match_cur=""; fi',
    '    if [[ "$expect_flag" == "-c" || "$expect_flag" == "--connection" ]]; then',
    '      local conns; conns="$(_wtctl_complete_connections "$config_path")"',
    '      COMPREPLY=( $(compgen -P "$prefix" -W "$conns" -- "$match_cur") )',
    "      return 0",
    "    fi",
    '    local vals; vals="$(_wtctl_flag_values "$scope" "$expect_flag")"',
    '    if [[ -n "$vals" ]]; then COMPREPLY=( $(compgen -P "$prefix" -W "$vals" -- "$match_cur") ); fi',
    "    return 0",
    "  fi",
    "",
    '  if (( !after_dd )) && [[ "$cur" == --*=* ]]; then',
    '    local flag_name="${cur%%=*}" val_prefix="${cur#*=}" vals item',
    '    if [[ "$flag_name" == "--connection" ]]; then',
    '      vals="$(_wtctl_complete_connections "$config_path")"',
    "    else",
    '      vals="$(_wtctl_flag_values "$scope" "$flag_name")"',
    "    fi",
    "    COMPREPLY=()",
    "    for item in $vals; do",
    '      if [[ "$item" == "$val_prefix"* ]]; then COMPREPLY+=("${flag_name}=${item}"); fi',
    "    done",
    "    return 0",
    "  fi",
    "",
    '  if (( !after_dd )) && [[ "$cur" == -* ]]; then',
    '    local flags; flags="$(_wtctl_scope_flags "$scope" "$cmd")"',
    '    COMPREPLY=( $(compgen -W "$flags" -- "$cur") )',
    "    return 0",
    "  fi",
    "",
    '  if [[ -z "$cmd" ]]; then',
    `    COMPREPLY=( $(compgen -W '${topNames}' -- "$cur") )`,
    "    return 0",
    "  fi",
    "",
    '  if [[ -z "$sub" ]] && _wtctl_has_subcommands "$cmd"; then',
    '    local subs; subs="$(_wtctl_subcommands "$cmd")"',
    '    COMPREPLY=( $(compgen -W "$subs" -- "$cur") )',
    "    return 0",
    "  fi",
    "",
    "  if (( pos_count == 0 )); then",
    '    case "$scope" in',
    `      ${connScopePattern})`,
    '        local conns; conns="$(_wtctl_complete_connections "$config_path")"',
    '        COMPREPLY=( $(compgen -W "$conns" -- "$cur") )',
    "        return 0",
    "        ;;",
    "    esac",
    '    local pvals; pvals="$(_wtctl_positional_values "$scope")"',
    '    if [[ -n "$pvals" ]]; then COMPREPLY=( $(compgen -W "$pvals" -- "$cur") ); fi',
    "  fi",
    "}",
    "",
    "complete -o default -F _wtctl_completions wtctl",
    "",
  ].join("\n");
}

function zshQuote(text: string): string {
  return `'${text.replaceAll("'", "'\\''")}'`;
}

function zshDescribeEntry(name: string, description: string): string {
  const desc = cleanDescription(description, name).replaceAll("\\", "\\\\").replaceAll(":", "\\:");
  return zshQuote(`${name}:${desc}`);
}

function zshFlagDescribeEntries(flags: readonly CompletionFlag[]): string {
  const entries: string[] = [];
  for (const flag of flags) {
    entries.push(zshDescribeEntry(flag.long, flag.description));
    if (flag.short) entries.push(zshDescribeEntry(flag.short, flag.description));
  }
  return entries.join(" ");
}

function generateZshCompletion(model: CompletionModel): string {
  const topEntries = model.commands.map((c) => zshDescribeEntry(c.name, c.description)).join(" ");
  const cmdsWithSubs = [...model.subcommands.keys()].join("|");
  const globalValFlags = allFlagTokens(model.globalFlags.filter((f) => f.takesValue)).join("|");
  const globalFlagEntries = zshFlagDescribeEntries(model.globalFlags);

  const subCases = [...model.subcommands.entries()].map(
    ([cmd, items]) =>
      `    ${cmd}) items=(${items.map((i) => zshDescribeEntry(i.name, i.description)).join(" ")}) ;;`,
  );

  const scopeFlagCases: string[] = [];
  const scopeValFlagCases: string[] = [];
  const scopeEnumCases: string[] = [];

  for (const [scope, localFlags] of model.scopeFlags.entries()) {
    const localEntries = zshFlagDescribeEntries(localFlags);
    if (localEntries) {
      scopeFlagCases.push(`    ${zshQuote(scope)}) local_flags=(${localEntries}) ;;`);
    }
    const localBoolShorts = localFlags.filter((f) => !f.takesValue && f.short).map((f) => f.short!);
    const localValTokens = allFlagTokens(localFlags.filter((f) => f.takesValue));
    if (localBoolShorts.length > 0 || localValTokens.length > 0) {
      scopeValFlagCases.push(`    ${zshQuote(scope)})`);
      if (localBoolShorts.length > 0) {
        scopeValFlagCases.push(
          `      case "$flag" in ${localBoolShorts.join("|")}) return 1 ;; esac`,
        );
      }
      if (localValTokens.length > 0) {
        scopeValFlagCases.push(
          `      case "$flag" in ${localValTokens.join("|")}) return 0 ;; esac`,
        );
      }
      scopeValFlagCases.push("      ;;");
    }
    for (const flag of localFlags) {
      if (!flag.values?.length) continue;
      const pattern = flag.short
        ? `${zshQuote(`${scope}:${flag.long}`)}|${zshQuote(`${scope}:${flag.short}`)}`
        : zshQuote(`${scope}:${flag.long}`);
      scopeEnumCases.push(`    ${pattern}) vals=(${flag.values.map(zshQuote).join(" ")}) ;;`);
    }
  }

  const globalEnumCases: string[] = [];
  for (const flag of model.globalFlags) {
    if (!flag.values?.length) continue;
    const pattern = flag.short ? `${flag.long}|${flag.short}` : flag.long;
    globalEnumCases.push(`    ${pattern}) vals=(${flag.values.map(zshQuote).join(" ")}) ;;`);
  }

  const posCases = [...model.scopePositionalValues.entries()].map(
    ([scope, items]) =>
      `    ${zshQuote(scope)}) items=(${items.map((i) => zshDescribeEntry(i.name, i.description)).join(" ")}) ;;`,
  );
  const connScopePattern = [...model.connectionPositionalScopes].map(zshQuote).join("|");

  return [
    "#compdef wtctl",
    '# Автодополнение wtctl для zsh (подключение: eval "$(wtctl completion zsh --format raw)")',
    "",
    "_wtctl_complete_connections() {",
    '  local cfg="$1"',
    "  local -a conns",
    '  if [[ -n "$cfg" ]]; then',
    '    conns=(${(f)"$(wtctl __complete-connections --config "$cfg" 2>/dev/null)"})',
    "  else",
    '    conns=(${(f)"$(wtctl __complete-connections 2>/dev/null)"})',
    "  fi",
    "  (( ${#conns} )) && [[ -n \"${conns[1]}\" ]] && _describe -t connections 'подключение' conns",
    "}",
    "",
    "_wtctl_has_subcommands() {",
    '  case "$1" in',
    `    ${cmdsWithSubs}) return 0 ;;`,
    "    *) return 1 ;;",
    "  esac",
    "}",
    "",
    "_wtctl_scope_flag_takes_value() {",
    '  local scope="$1" flag="$2"',
    '  case "$scope" in',
    ...scopeValFlagCases,
    "  esac",
    "  return 2",
    "}",
    "",
    "_wtctl_flag_takes_value() {",
    '  local scope="$1" cmd="$2" flag="$3" rc',
    '  _wtctl_scope_flag_takes_value "$scope" "$flag"; rc=$?',
    '  if (( rc != 2 )); then return "$rc"; fi',
    '  if [[ -n "$cmd" && "$scope" != "$cmd" ]]; then',
    '    _wtctl_scope_flag_takes_value "$cmd" "$flag"; rc=$?',
    '    if (( rc != 2 )); then return "$rc"; fi',
    "  fi",
    '  case "$flag" in',
    `    ${globalValFlags}) return 0 ;;`,
    "    *) return 1 ;;",
    "  esac",
    "}",
    "",
    "_wtctl_flag_values() {",
    '  local scope="$1" flag="$2"',
    "  local -a vals",
    '  case "${scope}:${flag}" in',
    ...scopeEnumCases,
    "  esac",
    "  if (( ! ${#vals} )); then",
    '    case "$flag" in',
    ...globalEnumCases,
    "    esac",
    "  fi",
    "  (( ${#vals} )) && compadd -a vals",
    "}",
    "",
    "_wtctl_local_flags() {",
    '  case "$1" in',
    ...scopeFlagCases,
    "  esac",
    "}",
    "",
    "_wtctl() {",
    '  local cur="${words[CURRENT]}"',
    '  local cmd="" sub="" config_path="" expect_flag="" scope=""',
    "  local -i after_dd=0 pos_count=0 i",
    "  local tok cfg_raw",
    "",
    "  for (( i = 2; i < CURRENT; i++ )); do",
    '    tok="${words[i]}"',
    '    if [[ -n "$expect_flag" ]]; then',
    '      [[ "$expect_flag" == "--config" ]] && config_path="${(Q)tok}"',
    '      expect_flag=""',
    "      continue",
    "    fi",
    '    if (( !after_dd )) && [[ "$tok" == "--" ]]; then',
    "      after_dd=1",
    "      continue",
    "    fi",
    '    if (( !after_dd )) && [[ "$tok" == -* ]]; then',
    '      if [[ "$tok" == --*=* ]]; then',
    '        if [[ "${tok%%=*}" == "--config" ]]; then',
    '          cfg_raw="${tok#*=}"',
    '          config_path="${(Q)cfg_raw}"',
    "        fi",
    "        continue",
    "      fi",
    '      scope="${sub:+$cmd $sub}"',
    '      scope="${scope:-$cmd}"',
    '      _wtctl_flag_takes_value "$scope" "$cmd" "$tok" && expect_flag="$tok"',
    "      continue",
    "    fi",
    '    if [[ -z "$cmd" ]]; then',
    '      cmd="$tok"',
    '    elif [[ -z "$sub" ]] && _wtctl_has_subcommands "$cmd"; then',
    '      sub="$tok"',
    "    else",
    "      (( pos_count++ ))",
    "    fi",
    "  done",
    "",
    '  scope="${sub:+$cmd $sub}"',
    '  scope="${scope:-$cmd}"',
    "",
    '  if [[ -n "$expect_flag" ]]; then',
    '    if [[ "$expect_flag" == "-c" || "$expect_flag" == "--connection" ]]; then',
    '      _wtctl_complete_connections "$config_path"',
    "      return",
    "    fi",
    '    _wtctl_flag_values "$scope" "$expect_flag"',
    "    return",
    "  fi",
    "",
    '  if (( !after_dd )) && [[ "$cur" == --*=* ]]; then',
    '    local flag_name="${cur%%=*}"',
    '    compset -P "${flag_name}="',
    '    if [[ "$flag_name" == "--connection" ]]; then',
    '      _wtctl_complete_connections "$config_path"',
    "    else",
    '      _wtctl_flag_values "$scope" "$flag_name"',
    "    fi",
    "    return",
    "  fi",
    "",
    '  if (( !after_dd )) && [[ "$cur" == -* ]]; then',
    `    local -a global_flags=(${globalFlagEntries})`,
    "    local -a local_flags=()",
    '    _wtctl_local_flags "$scope"',
    '    if (( ! ${#local_flags} )) && [[ -n "$cmd" && "$scope" != "$cmd" ]]; then',
    '      _wtctl_local_flags "$cmd"',
    "    fi",
    '    local -a flags=("${local_flags[@]}" "${global_flags[@]}")',
    "    _describe -t options 'параметр' flags",
    "    return",
    "  fi",
    "",
    '  if [[ -z "$cmd" ]]; then',
    `    local -a commands=(${topEntries})`,
    "    _describe -t commands 'команда' commands",
    "    return",
    "  fi",
    "",
    '  if [[ -z "$sub" ]] && _wtctl_has_subcommands "$cmd"; then',
    "    local -a items",
    '    case "$cmd" in',
    ...subCases,
    "    esac",
    "    _describe -t subcommands 'подкоманда' items",
    "    return",
    "  fi",
    "",
    "  if (( pos_count == 0 )); then",
    '    case "$scope" in',
    `      ${connScopePattern})`,
    '        _wtctl_complete_connections "$config_path"',
    "        return",
    "        ;;",
    "    esac",
    "    local -a items",
    '    case "$scope" in',
    ...posCases,
    "    esac",
    "    (( ${#items} )) && _describe -t values 'значение' items && return",
    "  fi",
    "",
    "  _files",
    "}",
    "",
    'if [[ "${funcstack[1]:-}" == "_wtctl" ]]; then',
    '  _wtctl "$@"',
    "else",
    "  compdef _wtctl wtctl",
    "fi",
    "",
  ].join("\n");
}

/** Генерирует скрипт автодополнения оболочки из актуального реестра команд и флагов CLI. */
export function generateCompletion(shell: CompletionShell): string {
  const model = buildCompletionModel();
  if (shell === "pwsh") return generatePwshCompletion(model);
  if (shell === "bash") return generateBashCompletion(model);
  return generateZshCompletion(model);
}
