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
  commandOf,
  enumOption,
  exactPositionals,
  integerOption,
  optional,
  parseArguments,
  rejectPasswordStdin,
  requirePositional,
  stringOption,
  usesLocalFormatArgv,
  type CliArguments,
} from "./arguments.js";
import { commandInvocation, type Invocation } from "./commands.js";
import { generateCompletion, parseCompletionShell, runCompleteConnections } from "./completion.js";
import { runConfigCommand } from "./config-commands.js";
import { DeferredRuntime } from "./deferred-runtime.js";
import { planEditCommand, runEditCommand, type EditPlan } from "./edit.js";
import {
  assertFormatSupported,
  resolveErrorMode,
  resolveOutputMode,
  type OutputMode,
} from "./format/index.js";
import { cliHelp, cliHelpText, helpCommand } from "./help.js";
import {
  attachAgentRunLogs,
  confirmDestructiveAction,
  isInteractiveConfirm,
} from "./interactive.js";
import {
  planLogExecution,
  resolveLogFile,
  runLogStream,
  runLogTail,
  type LogExecutionPlan,
} from "./live-logs.js";
import {
  emit,
  emitText,
  failure,
  frontendFailure,
  frontendResult,
  safeDiagnostic,
  serializeResult,
} from "./output.js";
import { createProgress, type ProgressIndicator } from "./progress.js";
import { queryAllOptions, runQueryAll, type QueryAllOptions } from "./query-all.js";
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

const TTY_DEFAULT_OUTPUT_LIMIT_BYTES = 256 * 1024;
const JSON_OUTPUT_MODE: OutputMode = { requested: "json", format: "json", humanErrors: false };

export async function runCli(
  argv: readonly string[],
  io: CliIo,
  dependencies: CliDependencies,
): Promise<number> {
  let runtime: RuntimePort | undefined;
  let parsed: CliArguments | undefined;
  let progress: ProgressIndicator | undefined;
  try {
    parsed = parseArguments(argv);
    const [command, action] = parsed.positionals;
    if (command === "__complete-connections") {
      return await runCompleteConnections(parsed, io);
    }
    if (!command || command === "help") {
      rejectPasswordStdin(parsed, "Ввод пароля не нужен для help.");
      exactPositionals(parsed, 0, 3);
      const subcommand = parsed.positionals[2];
      if (action === "help" && subcommand !== undefined)
        throw new CliInputError("Лишние аргументы команды.");
      // У `result read --format text --help` флаг --format относился к подкоманде, а не к help.
      const helpArgs =
        parsed.options.help === true && usesLocalFormatArgv(argv)
          ? { positionals: parsed.positionals, options: { ...parsed.options, format: false } }
          : parsed;
      if (helpArgs !== parsed) delete helpArgs.options.format;
      const helpMode = resolveOutputMode(helpArgs, io);
      if (helpMode.requested !== "auto") assertFormatSupported("cli.help", helpMode.format);
      const topic = action === "help" ? undefined : action;
      if (helpMode.requested === "json")
        return await emit(
          frontendResult("cli.help", "unselected", cliHelp(topic, subcommand)),
          parsed,
          io,
          undefined,
          JSON_OUTPUT_MODE,
        );
      return await emitText(cliHelpText(topic, subcommand), parsed, io);
    }
    const outputMode = command === "mcp" ? undefined : resolveOutputMode(parsed, io);
    if (command === "version") {
      rejectPasswordStdin(parsed, "Ввод пароля не нужен для version.");
      exactPositionals(parsed, 1);
      assertFormatSupported("cli.version", outputMode!.format);
      return await emit(
        frontendResult("cli.version", "unselected", {
          name: "wtctl",
          version: VERSION,
          node: process.versions.node,
        }),
        parsed,
        io,
        undefined,
        outputMode,
      );
    }
    if (command === "guide") {
      rejectPasswordStdin(parsed, "Ввод пароля не нужен для guide.");
      exactPositionals(parsed, 1, 2);
      if (outputMode!.requested !== "auto") assertFormatSupported("cli.guide", outputMode!.format);
      const page = await guide(action, withSettings(dependencies.local, parsed));
      if (outputMode!.requested === "json")
        return await emit(
          frontendResult("cli.guide", "unselected", page),
          parsed,
          io,
          undefined,
          JSON_OUTPUT_MODE,
        );
      return await emitText(`${page.text}\n`, parsed, io);
    }
    if (command === "completion") {
      rejectPasswordStdin(parsed, "Ввод пароля не нужен для completion.");
      exactPositionals(parsed, 1, 2);
      if (outputMode!.requested !== "auto")
        assertFormatSupported("cli.completion", outputMode!.format);
      const shell = parseCompletionShell(action);
      const script = generateCompletion(shell);
      if (outputMode!.requested === "json")
        return await emit(
          frontendResult("cli.completion", "unselected", { shell, script }),
          parsed,
          io,
          undefined,
          JSON_OUTPUT_MODE,
        );
      return await emitText(script, parsed, io);
    }
    if (command === "config") {
      const configAction = action === "rm" ? "remove" : action;
      if (
        configAction === "init" ||
        configAction === "list" ||
        configAction === "set" ||
        configAction === "use" ||
        configAction === "remove" ||
        configAction === "path" ||
        configAction === "example"
      ) {
        assertFormatSupported(`cli.config.${configAction}`, outputMode!.format);
      }
      const configOutcome = await runConfigCommand(action, parsed, io);
      if (configOutcome?.kind === "cancelled") return configOutcome.exitCode;
      if (configOutcome?.kind === "result")
        return await emit(configOutcome.result, parsed, io, undefined, outputMode);
    }
    // Полная команда и её локальные входные данные проверяются до открытия runtime.
    const interactiveConfirm = isInteractiveConfirm(io);
    const discovery = command === "api" && (action === "list" || action === "describe");
    let discoveryFilter: OperationFilter = {};
    let invocation: Invocation | undefined;
    let logPlan: LogExecutionPlan | undefined;
    let queryAll: QueryAllOptions | undefined;
    let editPlan: EditPlan | undefined;
    if (command === "mcp") {
      exactPositionals(parsed, 1);
      if (parsed.options.output)
        throw new CliInputError("wtctl mcp не принимает --output: stdout занят протоколом MCP.");
      rejectPasswordStdin(
        parsed,
        "--password-stdin несовместим с MCP: stdin занят протоколом.",
        "Для MCP пароль берётся из файла подключений или переменной окружения.",
      );
    } else if ((command === "files" || command === "object") && action === "edit") {
      editPlan = planEditCommand(parsed, outputMode!, io);
    } else if (!discovery) {
      invocation = await commandInvocation(parsed, io, { interactive: interactiveConfirm });
      if (command === "logs") {
        logPlan = planLogExecution(parsed, invocation, outputMode!, io);
      } else {
        assertFormatSupported(invocation.operationId, outputMode!.format, invocation.args);
        if (command === "query") queryAll = queryAllOptions(parsed);
      }
    } else if (action === "describe") {
      exactPositionals(parsed, 3);
      assertFormatSupported("api.describe", outputMode!.format);
    } else {
      exactPositionals(parsed, 2);
      assertFormatSupported("api.list", outputMode!.format);
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
      return await emit(
        frontendResult(`api.${action}`, "unselected", data),
        parsed,
        io,
        undefined,
        outputMode,
      );
    }
    let password: string | undefined;
    if (parsed.options["password-stdin"]) {
      password = (await io.readStdin(65536)).replace(/\r?\n$/, "");
      if (!password || /[\r\n\0]/.test(password) || Buffer.byteLength(password, "utf8") > 65536)
        throw new CliInputError("Пароль из stdin должен быть одной непустой строкой до 64 КиБ.");
    }
    const selected = parsed;
    const defaultOutputLimitBytes =
      command !== "mcp" &&
      ((io.stdoutIsTTY === true &&
        outputMode !== undefined &&
        (outputMode.format === "human" || outputMode.format === "table")) ||
        logPlan?.kind === "stream")
        ? TTY_DEFAULT_OUTPUT_LIMIT_BYTES
        : undefined;
    const load = () =>
      dependencies.loadConfiguration({
        ...optional("configPath", stringOption(selected, "config")),
        ...optional("connection", stringOption(selected, "connection")),
        ...optional("password", password),
        ...optional("defaultOutputLimitBytes", defaultOutputLimitBytes),
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
    const progressEnabled =
      outputMode !== undefined &&
      outputMode.format !== "json" &&
      outputMode.requested !== "json" &&
      parsed.options.quiet !== true &&
      logPlan?.kind !== "stream";
    progress = createProgress(io, { enabled: progressEnabled });
    progress.start(queryAll ? "Запрос строк…" : editPlan ? "Чтение данных…" : "Выполнение…");

    const config = await load();
    runtime = dependencies.createRuntime(config);
    if (!invocation && !editPlan) throw new CliInputError("Команда не определена.");

    let closingRuntime: RuntimePort | undefined;
    const closeRuntimeOnce = async (): Promise<{
      readonly failed: boolean;
      readonly diagnostic?: OperationResult;
    }> => {
      if (!runtime) return { failed: false };
      const target = runtime;
      runtime = undefined;
      closingRuntime = target;
      try {
        await target.close();
        return { failed: false };
      } catch {
        const cleanup = failure(
          "cli.cleanup_failed",
          "Основная операция завершилась, но закрыть подключение не удалось.",
          "Результат основной операции сохранён в data/meta. Её из-за ошибки закрытия не повторять.",
        );
        await safeDiagnostic(io, cleanup, outputMode?.humanErrors ? "human" : "json");
        return { failed: true, diagnostic: cleanup };
      }
    };

    if (logPlan?.kind === "stream") {
      await progress.stop();
      return await runLogStream(
        logPlan,
        parsed,
        io,
        runtime,
        outputMode!,
        config.outputLimitBytes,
        config.maxResponseBytes,
        closeRuntimeOnce,
      );
    }

    let result: OperationResult;
    let emitRequestArgs: Readonly<Record<string, unknown>> | undefined = invocation?.args;
    if (editPlan) {
      const outcome = await runEditCommand(
        editPlan,
        parsed,
        config,
        io,
        runtime,
        outputMode!,
        progress,
        closeRuntimeOnce,
      );
      if (outcome.handled) return outcome.exitCode;
      result = outcome.result;
      emitRequestArgs = outcome.requestArgs;
    } else if (logPlan?.kind === "tail") {
      const outcome = await runLogTail(
        logPlan,
        parsed,
        io,
        runtime,
        outputMode!,
        config.outputLimitBytes,
        config.maxResponseBytes,
        progress,
        closeRuntimeOnce,
      );
      if (outcome.handled) return outcome.exitCode;
      result = outcome.result;
    } else if (queryAll) {
      const outcome = await runQueryAll(
        invocation!.args,
        queryAll,
        parsed,
        config,
        io,
        runtime,
        outputMode!,
        progress,
        closeRuntimeOnce,
      );
      if (outcome.handled) return outcome.exitCode;
      result = outcome.result;
    } else {
      let callArgs = invocation!.args;
      if (logPlan?.kind === "single" && logPlan.resolveType && typeof callArgs.file === "string") {
        const resolved = await resolveLogFile(
          callArgs.file,
          runtime,
          io,
          outputMode!,
          parsed.options.quiet === true,
          progress,
        );
        if (!resolved.ok) {
          result = resolved.result;
          callArgs = {};
        } else {
          callArgs = { ...callArgs, file: resolved.file };
          result = await runtime.call(invocation!.operationId, callArgs);
        }
      } else {
        const confirmTarget =
          interactiveConfirm && parsed.options.yes !== true
            ? command === "object" && action === "delete" && parsed.options.permanent !== true
              ? ("objects.delete" as const)
              : command === "files" && action === "delete" && parsed.options.permanent !== true
                ? ("files.delete" as const)
                : command === "tasks" && action === "kill"
                  ? ("web.spxml.killAsyncMethod" as const)
                  : command === "agent" && action === "cancel"
                    ? ("agents.cancel" as const)
                    : undefined
            : undefined;
        if (confirmTarget !== undefined) {
          const confirmed = await confirmDestructiveAction(
            confirmTarget,
            callArgs,
            config,
            runtime,
            io,
            progress,
          );
          if (!confirmed) {
            await closeRuntimeOnce();
            return 1;
          }
          if (confirmTarget === "objects.delete") {
            callArgs = { ...callArgs, permanent: true };
          }
          progress.start(
            confirmTarget === "web.spxml.killAsyncMethod"
              ? "Остановка задачи…"
              : confirmTarget === "agents.cancel"
                ? "Остановка агента…"
                : "Удаление…",
          );
        }
        result = await runtime.call(invocation!.operationId, callArgs);
        if (command === "agent" && action === "run" && parsed.options.logs === true && result.ok) {
          result = await attachAgentRunLogs(
            result,
            runtime,
            config,
            progress,
            stringOption(parsed, "output") !== undefined,
          );
        }
      }
    }

    await progress.stop();
    const closed = await closeRuntimeOnce();
    if (closed.failed && closed.diagnostic) {
      result = frontendFailure(result, closed.diagnostic, "cleanupFailed");
    }
    const requestedFields =
      Array.isArray(invocation?.args.fields) &&
      invocation.args.fields.every((item): item is string => typeof item === "string")
        ? invocation.args.fields
        : undefined;
    return await emit(
      result,
      parsed,
      io,
      closingRuntime,
      outputMode,
      requestedFields,
      emitRequestArgs,
    );
  } catch (error) {
    await progress?.stop();
    const result =
      error instanceof CliInputError
        ? failure(
            error.code,
            error.message,
            [error.hint, `Справка: ${helpCommand(commandOf(argv))}.`].filter(Boolean).join(" "),
          )
        : error instanceof HcmError
          ? {
              ...failure(error.code, error.message),
              error: {
                hint: "Проверить подключение и api.describe.",
                ...error.toJSON(),
              },
            }
          : failure(
              "cli.failed",
              "Команда не завершена.",
              "Проверить подключение и api.describe; неизвестные ошибки не выводят реквизиты или серверный ответ.",
            );
    await safeDiagnostic(
      io,
      errorInFrontendTerms(result, "cli"),
      resolveErrorMode(argv, parsed, io),
    );
    return error instanceof CliInputError ? 2 : 1;
  } finally {
    await progress?.stop();
    if (runtime) {
      try {
        await runtime.close();
      } catch {
        await safeDiagnostic(
          io,
          failure("cli.cleanup_failed", "Не удалось закрыть сессию подключения."),
          resolveErrorMode(argv, parsed, io),
        );
      }
    }
  }
}
