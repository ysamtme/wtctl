import { resolve } from "node:path";
import { describeHcmOperation, listHcmOperations } from "../catalog.js";
import { markServedByMcp } from "../config.js";
import type { OperationFilter, OperationResult } from "../contracts.js";
import { HcmError } from "../errors.js";
import { errorInFrontendTerms } from "../frontend-names.js";
import { guide, type LocalInstall } from "../guide.js";
import { discoverOperations, operationHelp } from "../operation-help.js";
import { VERSION } from "../version.js";
import {
  CliInputError,
  allowOptions,
  commandOf,
  enumOption,
  exactPositionals,
  integerOption,
  optional,
  parseArguments,
  rejectPasswordStdin,
  requirePositional,
  stringOption,
  type CliArguments,
} from "./arguments.js";
import { commandInvocation, type Invocation } from "./commands.js";
import { runConfigCommand } from "./config-commands.js";
import { DeferredRuntime } from "./deferred-runtime.js";
import { cliHelp, cliHelpText, helpCommand } from "./help.js";
import {
  emit,
  emitText,
  failure,
  frontendFailure,
  frontendResult,
  safeDiagnostic,
  serializeResult,
} from "./output.js";
import type { CliDependencies, CliIo, RuntimePort } from "./types.js";

export { commandInvocation, serializeResult };

/** Команда настройки целиком: у MCP-сервера от хоста агента wtctl может не быть в PATH. */
function setupCommand(local: LocalInstall | undefined): string | undefined {
  if (!local) return undefined;
  const command = /[\\/]_npx[\\/]/.test(local.script)
    ? "npx -y wtctl"
    : `"${local.node}" "${local.script}"`;
  return `Файл создаёт человек в своём терминале, полная команда: ${command} config init`;
}

/** Гайд говорит, как команда и программа получают подключение, с которым работает процесс. */
function withSettings(
  local: LocalInstall | undefined,
  args: CliArguments,
): LocalInstall | undefined {
  if (!local) return undefined;
  const configPath = stringOption(args, "config") ?? process.env.WTCTL_CONFIG;
  const connection = stringOption(args, "connection") ?? process.env.WTCTL_CONNECTION;
  return {
    ...local,
    settings: {
      ...(configPath === undefined ? {} : { configPath: resolve(configPath) }),
      ...(connection === undefined ? {} : { connection }),
      environment: configPath === undefined && process.env.WTCTL_URL !== undefined,
    },
  };
}

export async function runCli(
  argv: readonly string[],
  io: CliIo,
  dependencies: CliDependencies,
): Promise<number> {
  let runtime: RuntimePort | undefined;
  let parsed: CliArguments | undefined;
  try {
    parsed = parseArguments(argv);
    const [command, action] = parsed.positionals;
    if (!command || command === "help") {
      rejectPasswordStdin(parsed, "Ввод пароля не нужен для help.");
      // КОМАНДА … --help: параметры, набранные до --help, относятся к команде и не проверяются.
      if (!parsed.options.help) allowOptions(parsed, []);
      // help logs search: справка группы покрывает её подкоманды.
      exactPositionals(parsed, 0, 3);
      const topic = action === "help" ? undefined : action;
      if (parsed.options.json)
        return await emit(frontendResult("cli.help", "unselected", cliHelp(topic)), parsed, io);
      return await emitText(cliHelpText(topic), parsed, io);
    }
    if (command === "version") {
      rejectPasswordStdin(parsed, "Ввод пароля не нужен для version.");
      allowOptions(parsed, []);
      exactPositionals(parsed, 1);
      return await emit(
        frontendResult("cli.version", "unselected", {
          name: "wtctl",
          version: VERSION,
          node: process.versions.node,
        }),
        parsed,
        io,
      );
    }
    if (command === "guide") {
      rejectPasswordStdin(parsed, "Ввод пароля не нужен для guide.");
      allowOptions(parsed, []);
      exactPositionals(parsed, 1, 2);
      const page = await guide(action, withSettings(dependencies.local, parsed));
      if (parsed.options.json)
        return await emit(frontendResult("cli.guide", "unselected", page), parsed, io);
      return await emitText(`${page.text}\n`, parsed, io);
    }
    if (command === "config") {
      const configResult = await runConfigCommand(action, parsed, io);
      if (configResult) return await emit(configResult, parsed, io);
    }
    // Полная команда и её локальные входные данные проверяются до открытия runtime.
    const discovery = command === "api" && (action === "list" || action === "describe");
    let discoveryFilter: OperationFilter = {};
    let invocation: Invocation | undefined;
    if (command === "mcp") {
      allowOptions(parsed, []);
      exactPositionals(parsed, 1);
      if (parsed.options.output)
        throw new CliInputError("wtctl mcp не принимает --output: stdout занят протоколом MCP.");
      rejectPasswordStdin(
        parsed,
        "--password-stdin несовместим с MCP: stdin занят протоколом.",
        "Для MCP пароль задаётся через переменную окружения из конфигурации.",
      );
    } else if (!discovery) invocation = await commandInvocation(parsed, io);
    else if (action === "describe") {
      allowOptions(parsed, ["offline"]);
      exactPositionals(parsed, 3);
    } else {
      allowOptions(parsed, ["query", "topic", "group", "effect", "cursor", "limit", "offline"]);
      exactPositionals(parsed, 2);
      const effect = enumOption(
        parsed,
        "effect",
        ["read", "write", "execute", "unknown"],
        "--effect должен быть read, write, execute или unknown.",
      );
      discoveryFilter = {
        ...optional("query", stringOption(parsed, "query")),
        ...optional("topic", stringOption(parsed, "topic")),
        ...optional("group", stringOption(parsed, "group")),
        ...optional("effect", effect),
        ...optional("cursor", integerOption(parsed, "cursor", 0, Number.MAX_SAFE_INTEGER)),
        ...optional("limit", integerOption(parsed, "limit", 1, 100)),
      };
    }
    // api list и api describe читают статический реестр пакета без настроек подключения;
    // флаг --offline сохранён для обратной совместимости.
    if (discovery) {
      rejectPasswordStdin(parsed, "Пароль не нужен: команда не обращается к серверу.");
      const data =
        action === "describe"
          ? operationHelp(describeHcmOperation(requirePositional(parsed, 2, "ID операции")))
          : discoverOperations(listHcmOperations, discoveryFilter);
      return await emit(frontendResult(`api.${action}`, "unselected", data), parsed, io);
    }
    let password: string | undefined;
    if (parsed.options["password-stdin"]) {
      password = (await io.readStdin(65536)).replace(/\r?\n$/, "");
      if (!password || /[\r\n\0]/.test(password) || Buffer.byteLength(password, "utf8") > 65536)
        throw new CliInputError("Пароль из stdin должен быть одной непустой строкой до 64 КиБ.");
    }
    const selected = parsed;
    const load = () =>
      dependencies.loadConfiguration({
        ...optional("configPath", stringOption(selected, "config")),
        ...optional("connection", stringOption(selected, "connection")),
        ...optional("password", password),
      });
    if (command === "mcp") {
      const served = async () => markServedByMcp(await load());
      // MCP-сервер без настроек всё равно стартует: его инструменты отвечают, что настроить.
      let name = "unconfigured";
      let serving: RuntimePort;
      try {
        const config = await served();
        name = config.name;
        serving = dependencies.createRuntime(config);
      } catch (error) {
        if (!(error instanceof HcmError)) throw error;
        serving = new DeferredRuntime(
          served,
          dependencies.createRuntime,
          error,
          setupCommand(dependencies.local),
        );
      }
      runtime = serving;
      await dependencies.runMcp(serving, name, io, withSettings(dependencies.local, selected));
      runtime = undefined;
      await serving.close();
      return 0;
    }
    const config = await load();
    runtime = dependencies.createRuntime(config);
    if (!invocation) throw new CliInputError("Команда не определена.");
    let result: OperationResult = await runtime.call(invocation.operationId, invocation.args);
    const closing = runtime;
    runtime = undefined;
    try {
      await closing.close();
    } catch {
      const cleanup = failure(
        "cli.cleanup_failed",
        "Основная операция завершилась, но закрыть подключение не удалось.",
        "Результат основной операции сохранён в data/meta. Её из-за ошибки закрытия не повторять.",
      );
      await safeDiagnostic(io, cleanup);
      result = frontendFailure(result, cleanup, "cleanupFailed");
    }
    return await emit(result, parsed, io, closing);
  } catch (error) {
    const result =
      error instanceof CliInputError
        ? failure(
            error.code,
            error.message,
            [error.hint, `Справка: ${helpCommand(commandOf(argv))}.`].filter(Boolean).join(" "),
          )
        : error instanceof HcmError
          ? {
              ...failure(
                error.code,
                error.message,
                error.hint ?? "Проверить конфигурацию и api describe.",
              ),
              error: error.toJSON(),
            }
          : failure(
              "cli.failed",
              "Команда не завершена.",
              "Проверить конфигурацию и api describe; неизвестные ошибки не выводят реквизиты или серверный ответ.",
            );
    await safeDiagnostic(io, errorInFrontendTerms(result, "cli"));
    return error instanceof CliInputError ? 2 : 1;
  } finally {
    if (runtime) {
      try {
        await runtime.close();
      } catch {
        await safeDiagnostic(
          io,
          failure("cli.cleanup_failed", "Не удалось закрыть сессию подключения."),
        );
      }
    }
  }
}
