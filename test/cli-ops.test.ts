import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { stripAnsi } from "../src/cli/format/ansi.js";
import { filterLogEventsByInterval } from "../src/cli/interactive.js";
import { confirmOnStream, parseConfirmAnswer } from "../src/cli/node-io.js";
import { runCli } from "../src/cli/run.js";
import type { CliDependencies, CliIo, RuntimePort } from "../src/cli/types.js";
import type { ConnectionConfig, OperationResult } from "../src/contracts.js";
import { NAMES, errorInFrontendTerms } from "../src/frontend-names.js";
import { parseLogEvents } from "../src/logs.js";
import { ResultStore } from "../src/results.js";
import { scratchRuntimeDir } from "./fake-server.js";

const BASE_CONFIG: ConnectionConfig = {
  name: "dev",
  baseUrl: "http://hcm.invalid/",
  timeoutMs: 1000,
  maxResponseBytes: 1024 * 1024,
  outputLimitBytes: 24 * 1024,
  runtimeDir: scratchRuntimeDir,
  permissions: { write: true, execute: true },
};

function okResult(
  operationId: string,
  data: unknown,
  extraMeta: Record<string, unknown> = {},
): OperationResult {
  return {
    ok: true,
    data,
    meta: { operationId, connection: BASE_CONFIG.name, durationMs: 12, ...extraMeta },
  };
}

function errResult(
  operationId: string,
  code: string,
  message: string,
  hint?: string,
): OperationResult {
  return {
    ok: false,
    error: { code, message, ...(hint ? { hint } : {}), retryable: false },
    meta: { operationId, connection: BASE_CONFIG.name, durationMs: 5 },
  };
}

interface HarnessOptions {
  stdoutIsTTY?: boolean;
  stderrIsTTY?: boolean;
  color?: boolean;
  columns?: number;
  confirm?: boolean | ((question: string) => boolean | Promise<boolean>);
  fileContent?: string;
  readFile?: (path: string) => Promise<string>;
  results?: RuntimePort["results"];
  reply?: (
    id: string,
    args: Record<string, unknown>,
    callIndex: number,
  ) => OperationResult | Promise<OperationResult>;
}

function harness(options: HarnessOptions = {}) {
  const state = {
    stdout: "",
    stderr: "",
    loads: 0,
    closes: 0,
    confirmQuestions: [] as string[],
    calls: [] as { id: string; args: Record<string, unknown> }[],
    files: new Map<string, string>(),
  };

  const confirmFn =
    options.confirm === undefined
      ? undefined
      : async (question: string) => {
          state.confirmQuestions.push(question);
          return typeof options.confirm === "function"
            ? await options.confirm(question)
            : options.confirm!;
        };

  const io: CliIo = {
    ...(options.stdoutIsTTY === undefined ? {} : { stdoutIsTTY: options.stdoutIsTTY }),
    ...(options.stderrIsTTY === undefined ? {} : { stderrIsTTY: options.stderrIsTTY }),
    ...(options.color === undefined ? {} : { color: options.color }),
    ...(options.columns === undefined ? {} : { columns: options.columns }),
    ...(confirmFn === undefined ? {} : { confirm: confirmFn }),
    pretty: options.stdoutIsTTY === true,
    writeOut: (text) => {
      state.stdout += text;
    },
    writeError: (text) => {
      state.stderr += text;
    },
    readFile:
      options.readFile ??
      (async (path) => {
        if (state.files.has(path)) return state.files.get(path)!;
        if (options.fileContent !== undefined) return options.fileContent;
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT", syscall: "open" });
      }),
    readStdin: async () => options.fileContent ?? "{}",
    writeFile: async (path, text) => {
      state.files.set(path, text);
    },
  };

  const runtime: RuntimePort = {
    ...(options.results === undefined ? {} : { results: options.results }),
    listOperations: () => ({ operations: [], total: 0 }),
    describe: () => {
      throw new Error("Не ожидалось в подставном тесте");
    },
    getOperationEffect: () => "read",
    call: async (id, args = {}) => {
      const index = state.calls.length;
      state.calls.push({ id, args });
      if (options.reply) return options.reply(id, args, index);
      return okResult(id, args);
    },
    close: async () => {
      state.closes++;
    },
  };

  const dependencies: CliDependencies = {
    loadConfiguration: () => {
      state.loads++;
      return BASE_CONFIG;
    },
    createRuntime: () => runtime,
    runMcp: async () => undefined,
  };

  return { state, io, runtime, dependencies };
}

// ---------------------------------------------------------------------------
// 1. wtctl agent run и фильтрация лога по интервалу
// ---------------------------------------------------------------------------

test("NAMES переводит agents.run в wtctl agent run для CLI и оставляет agents.run для MCP", () => {
  assert.deepEqual(NAMES["agents.run"], [undefined, "wtctl agent run"]);
  const err = errResult(
    "agents.run",
    "EXECUTE_DISABLED",
    "Операция agents.run требует права execute.",
    "Проверить agents.run.",
  );
  assert.equal(
    errorInFrontendTerms(err, "cli").error?.message,
    "Операция wtctl agent run требует права execute.",
  );
  assert.equal(
    errorInFrontendTerms(err, "mcp").error?.message,
    "Операция agents.run требует права execute.",
  );
});

test("agent run передаёт id, --object или --objects, сохраняет точный JSON без --logs и рисует карточку в TTY", async () => {
  const payload = {
    started: true,
    startedAt: "2026-11-22T14:10:00",
    finishedAt: "2026-11-22T14:10:03",
    hint: "Код агента отработал.",
  };

  // Без --logs в машинном режиме ответ совпадает с agents.run 1 в 1 (вариант с --object).
  const singleObj = harness({
    stdoutIsTTY: false,
    reply: () => okResult("agents.run", payload),
  });
  assert.equal(
    await runCli(
      ["agent", "run", "0x65D6BB73BFE67019", "--object", "123"],
      singleObj.io,
      singleObj.dependencies,
    ),
    0,
    singleObj.state.stderr,
  );
  assert.deepEqual(singleObj.state.calls, [
    {
      id: "agents.run",
      args: {
        id: "0x65D6BB73BFE67019",
        objectId: "123",
      },
    },
  ]);
  assert.deepEqual(JSON.parse(singleObj.state.stdout).data, payload);

  // Вариант с повторяемым --objects.
  const multiObj = harness({
    stdoutIsTTY: false,
    reply: () => okResult("agents.run", payload),
  });
  assert.equal(
    await runCli(
      ["agent", "run", "0x65D6BB73BFE67019", "--objects", "0x1,0x2", "--objects", "3"],
      multiObj.io,
      multiObj.dependencies,
    ),
    0,
    multiObj.state.stderr,
  );
  assert.deepEqual(multiObj.state.calls, [
    {
      id: "agents.run",
      args: {
        id: "0x65D6BB73BFE67019",
        objectIds: ["0x1", "0x2", "3"],
      },
    },
  ]);

  // В TTY с --connection stage: компактная карточка с длительностью и подсказкой с -c stage и интервалом.
  const tty = harness({
    stdoutIsTTY: true,
    color: false,
    reply: () => okResult("agents.run", payload),
  });
  assert.equal(
    await runCli(["-c", "stage", "agent", "run", "0x65D6BB73BFE67019"], tty.io, tty.dependencies),
    0,
  );
  assert.match(tty.state.stdout, /Запущен и завершён/);
  assert.match(tty.state.stdout, /2026-11-22T14:10:00 – 2026-11-22T14:10:03 \(3 с\)/);
  assert.match(tty.state.stdout, /wtctl -c stage logs search xhttp 14:10/);
  assert.match(tty.state.stdout, /wtctl -c stage logs tail xhttp/);

  // Некорректные аргументы, совместные --object/--objects и пустые элементы отклоняются с кодом 2.
  for (const badArgv of [
    ["agent", "run"],
    ["agent", "run", "not-an-id"],
    ["agent", "run", "0x1", "--object", "bad"],
    ["agent", "run", "0x1", "--object", "123", "--objects", "0x1,0x2"],
    ["agent", "run", "0x1", "--objects", "0x1,,0x2"],
    ["agent", "run", "0x1", "--objects", ",0x1"],
    ["agent", "run", "0x1", "--objects", "0x1,"],
    ["agent", "run", "0x1", "--objects", "   "],
  ]) {
    const bad = harness();
    assert.equal(await runCli(badArgv, bad.io, bad.dependencies), 2, badArgv.join(" "));
    assert.equal(bad.state.calls.length, 0);
  }
});

test("agent run --logs читает свежий xhttp в той же сессии, распаковывает truncated и подсвечивает события", async () => {
  const logText = [
    "14:09:50 [0100] старое событие",
    "14:09:59 [0139] alert: в пределах допуска до старта",
    "14:10:01 [0139] ERROR сбой в агенте",
    "14:10:05 [0139] в пределах допуска после конца",
    "14:10:15 [0140] позднее событие",
  ].join("\n");

  const tty = harness({
    stdoutIsTTY: true,
    color: true,
    results: {
      export: async () => ({ path: "", format: "json", bytes: 0 }),
      loadData: async (resultId) => {
        assert.equal(resultId, "stored-log-1");
        return {
          file: "xhttp_2026-11-22.log",
          text: logText,
          sizeBytes: 5000,
          tailOnly: true,
          fingerprint: "fp1",
        };
      },
    },
    reply: (id) => {
      if (id === "agents.run") {
        return okResult("agents.run", {
          started: true,
          startedAt: "2026-11-22T14:10:00",
          finishedAt: "2026-11-22T14:10:03",
          hint: "hint",
        });
      }
      if (id === "logs.list") {
        return okResult("logs.list", {
          files: [{ name: "xhttp_2026-11-22.log", type: "xhttp", sizeBytes: 5000 }],
          total: 1,
        });
      }
      return okResult(
        "logs.read",
        { preview: { file: "xhttp_2026-11-22.log" } },
        { truncated: true, resultId: "stored-log-1" },
      );
    },
  });

  assert.equal(await runCli(["agent", "run", "0x10", "--logs"], tty.io, tty.dependencies), 0);
  assert.equal(tty.state.closes, 1, "должна использоваться одна сессия runtime");
  assert.deepEqual(
    tty.state.calls.map((c) => c.id),
    ["agents.run", "logs.list", "logs.read"],
  );
  assert.deepEqual(tty.state.calls[1]!.args, { type: "xhttp", limit: 10 });
  const plain = stripAnsi(tty.state.stdout);
  assert.match(plain, /События в логе xhttp_2026-11-22\.log \(3\):/);
  assert.match(plain, /14:09:59 \[0139\] alert: в пределах допуска до старта/);
  assert.match(plain, /14:10:01 \[0139\] ERROR сбой в агенте/);
  assert.match(plain, /14:10:05 \[0139\] в пределах допуска после конца/);
  assert.doesNotMatch(plain, /старое событие/);
  assert.doesNotMatch(plain, /позднее событие/);
  assert.match(tty.state.stdout, /\x1b\[31mERROR\x1b\[39m/);

  // Когда событий за интервал нет — понятная пометка.
  const empty = harness({
    stdoutIsTTY: true,
    color: false,
    reply: (id) => {
      if (id === "agents.run") {
        return okResult("agents.run", {
          started: true,
          startedAt: "2026-11-22T14:10:00",
          finishedAt: "2026-11-22T14:10:01",
          hint: "hint",
        });
      }
      if (id === "logs.list") {
        return okResult("logs.list", {
          files: [{ name: "xhttp_2026-11-22.log", type: "xhttp", sizeBytes: 100 }],
          total: 1,
        });
      }
      return okResult("logs.read", {
        file: "xhttp_2026-11-22.log",
        text: "09:00:00 [0001] далеко от интервала\n",
        sizeBytes: 100,
        tailOnly: false,
        fingerprint: "fp2",
      });
    },
  });
  assert.equal(await runCli(["agent", "run", "0x10", "--logs"], empty.io, empty.dependencies), 0);
  assert.match(empty.state.stdout, /В логе xhttp_2026-11-22\.log событий за интервал не найдено\./);
});

test("agent run при started:false и при LOG_READ_UNAVAILABLE не отменяет запуск и предупреждает корректно", async () => {
  // started: false → лог agent и подсказка wtctl logs tail agent.
  const notStarted = harness({
    stdoutIsTTY: true,
    color: false,
    reply: (id, args) => {
      if (id === "agents.run") {
        return okResult("agents.run", {
          started: false,
          startedAt: "2026-11-22T23:59:59",
          finishedAt: "2026-11-23T00:00:01",
          hint: "Агент не запущен.",
        });
      }
      if (id === "logs.list") {
        return okResult("logs.list", {
          files: [
            { name: "agent_2026-11-23.log", type: "agent", dateHint: "2026-11-23", sizeBytes: 200 },
            { name: "agent_2026-11-22.log", type: "agent", dateHint: "2026-11-22", sizeBytes: 200 },
          ],
          total: 2,
        });
      }
      if (args.file === "agent_2026-11-22.log") {
        return okResult("logs.read", {
          file: "agent_2026-11-22.log",
          text: "23:59:58 [a1] агент занят\n",
          sizeBytes: 200,
          tailOnly: false,
          fingerprint: "fp3a",
        });
      }
      return okResult("logs.read", {
        file: "agent_2026-11-23.log",
        text: "00:00:01 [a1] пропуск запуска\n01:00:00 [a1] лишнее\n",
        sizeBytes: 200,
        tailOnly: false,
        fingerprint: "fp3b",
      });
    },
  });
  assert.equal(
    await runCli(["agent", "run", "0x10", "--logs"], notStarted.io, notStarted.dependencies),
    0,
  );
  assert.deepEqual(notStarted.state.calls[1]!.args, { type: "agent", limit: 10 });
  assert.match(notStarted.state.stdout, /Не запущен/);
  assert.match(notStarted.state.stdout, /wtctl logs tail agent/);
  assert.match(notStarted.state.stdout, /23:59:58 \[a1\] агент занят/);
  assert.match(notStarted.state.stdout, /00:00:01 \[a1\] пропуск запуска/);
  assert.doesNotMatch(notStarted.state.stdout, /лишнее/);

  // LOG_READ_UNAVAILABLE: код 0, в TTY предупреждение в stderr, в --json — поле logs без stderr.
  const replyUnavailable = (id: string) => {
    if (id === "agents.run") {
      return okResult("agents.run", {
        started: true,
        startedAt: "2026-11-22T12:00:00",
        finishedAt: "2026-11-22T12:00:01",
        hint: "ok",
      });
    }
    if (id === "logs.list") {
      return okResult("logs.list", {
        files: [{ name: "xhttp_2026-11-22.log", type: "xhttp", sizeBytes: 100 }],
        total: 1,
      });
    }
    return errResult("logs.read", "LOG_READ_UNAVAILABLE", "Файл занят сервером.");
  };

  const ttyWarn = harness({ stdoutIsTTY: true, color: false, reply: replyUnavailable });
  assert.equal(
    await runCli(["agent", "run", "0x10", "--logs"], ttyWarn.io, ttyWarn.dependencies),
    0,
  );
  assert.match(ttyWarn.state.stdout, /Запущен и завершён/);
  assert.match(ttyWarn.state.stderr, /Предупреждение:.*LOG_READ_UNAVAILABLE/);

  const jsonWarn = harness({ stdoutIsTTY: false, reply: replyUnavailable });
  assert.equal(
    await runCli(["agent", "run", "0x10", "--logs", "--json"], jsonWarn.io, jsonWarn.dependencies),
    0,
  );
  assert.equal(jsonWarn.state.stderr, "");
  const jsonBody = JSON.parse(jsonWarn.state.stdout);
  assert.equal(jsonBody.ok, true);
  assert.equal(jsonBody.data.started, true);
  assert.equal(jsonBody.data.logs.file, "xhttp_2026-11-22.log");
  assert.equal(jsonBody.data.logs.error.code, "LOG_READ_UNAVAILABLE");
  assert.match(jsonBody.data.logs.warning, /LOG_READ_UNAVAILABLE/);
});

test("filterLogEventsByInterval корректно учитывает переход через полночь и допуск ±2 с", () => {
  const events = parseLogEvents(
    [
      "23:59:56 [c] рано",
      "23:59:57 [c] граница-до",
      "23:59:59.500 [c] перед-полуночью",
      "00:00:00 [c] полночь",
      "00:00:03 [c] граница-после",
      "00:00:04 [c] поздно",
    ].join("\n"),
  );
  const across = filterLogEventsByInterval(events, "2026-11-22T23:59:59", "2026-11-23T00:00:01");
  assert.deepEqual(
    across.map((e) => e.message),
    ["граница-до", "перед-полуночью", "полночь", "граница-после"],
  );

  // Допуск назад через полночь: старт в 00:00:01 захватывает 23:59:59.
  const backWrap = filterLogEventsByInterval(events, "2026-11-23T00:00:01", "2026-11-23T00:00:01");
  assert.deepEqual(
    backWrap.map((e) => e.message),
    ["перед-полуночью", "полночь", "граница-после"],
  );
});

// ---------------------------------------------------------------------------
// 2. wtctl tasks list / status / kill
// ---------------------------------------------------------------------------

test("tasks list принимает разные формы имени, нормализует Task (пусто / объект / массив) и поддерживает csv/tsv/jsonl", async () => {
  // Без имени и пусто → подсказка указать имя функции.
  const empty = harness({
    stdoutIsTTY: true,
    color: false,
    reply: () => okResult("web.spxml.getBackgroundTasksByName", {}),
  });
  assert.equal(await runCli(["tasks", "list"], empty.io, empty.dependencies), 0);
  assert.deepEqual(empty.state.calls, [
    { id: "web.spxml.getBackgroundTasksByName", args: { libName: "", methodName: "" } },
  ]);
  assert.match(empty.state.stdout, /Фоновых задач не найдено\./);
  assert.match(
    empty.state.stdout,
    /Имя функции задаётся так: wtctl tasks list БИБЛИОТЕКА\.ФУНКЦИЯ/,
  );

  // Формы передачи имени: БИБЛИОТЕКА.ФУНКЦИЯ, БИБЛИОТЕКА ФУНКЦИЯ, --library/--method.
  for (const argv of [
    ["tasks", "list", "tools.get_version"],
    ["tasks", "list", "tools", "get_version"],
    ["tasks", "list", "--library", "tools", "--method", "get_version"],
  ]) {
    const h = harness({
      stdoutIsTTY: true,
      color: false,
      reply: () =>
        okResult("web.spxml.getBackgroundTasksByName", {
          Task: {
            TrackingID: "0x111",
            StartDate: "2026-11-22T12:00:00",
            IsRunning: "0",
            ResultData: { Result: { "#text": "2025.1.1171", "@_VALUE-TYPE": "string" } },
          },
        }),
    });
    assert.equal(await runCli(argv, h.io, h.dependencies), 0, argv.join(" "));
    assert.deepEqual(h.state.calls[0]!.args, { libName: "tools", methodName: "get_version" });
    assert.match(h.state.stdout, /0x111/);
    assert.match(h.state.stdout, /Завершена/);
    assert.match(h.state.stdout, /2025\.1\.1171/);
  }

  // Несколько задач (массив) в csv, tsv, jsonl и сырой --json.
  const manyPayload = {
    Task: [
      { TrackingID: "0x1", StartDate: "2026-11-22T12:00:00", IsRunning: "1", Progress: "50%" },
      {
        TrackingID: "0x2",
        StartDate: "2026-11-22T12:01:00",
        IsRunning: "0",
        ErrorCode: "500",
        ErrorText: "сбой",
      },
    ],
  };

  const csvRun = harness({
    reply: () => okResult("web.spxml.getBackgroundTasksByName", manyPayload),
  });
  assert.equal(
    await runCli(
      ["tasks", "list", "tools.get_version", "--format", "csv"],
      csvRun.io,
      csvRun.dependencies,
    ),
    0,
  );
  assert.match(
    csvRun.state.stdout,
    /^TrackingID,IsRunning,StartDate,Progress,ErrorCode,ErrorText,ResultData\n/,
  );
  assert.match(csvRun.state.stdout, /0x1,1,2026-11-22T12:00:00,50%/);
  assert.match(csvRun.state.stdout, /0x2,0,2026-11-22T12:01:00,,500,сбой/);

  const tsvRun = harness({
    reply: () => okResult("web.spxml.getBackgroundTasksByName", manyPayload),
  });
  assert.equal(
    await runCli(
      ["tasks", "list", "tools.get_version", "--format", "tsv"],
      tsvRun.io,
      tsvRun.dependencies,
    ),
    0,
  );
  assert.match(tsvRun.state.stdout, /^TrackingID\tIsRunning\tStartDate\t/);

  const jsonlRun = harness({
    reply: () => okResult("web.spxml.getBackgroundTasksByName", manyPayload),
  });
  assert.equal(
    await runCli(
      ["tasks", "list", "tools.get_version", "--format", "jsonl"],
      jsonlRun.io,
      jsonlRun.dependencies,
    ),
    0,
  );
  const jsonlRows = jsonlRun.state.stdout
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line) as { TrackingID: string });
  assert.deepEqual(
    jsonlRows.map((r) => r.TrackingID),
    ["0x1", "0x2"],
  );

  // В --json сырой data не искажается.
  const jsonRun = harness({
    reply: () => okResult("web.spxml.getBackgroundTasksByName", { Task: manyPayload.Task[0] }),
  });
  assert.equal(
    await runCli(
      ["tasks", "list", "tools.get_version", "--json"],
      jsonRun.io,
      jsonRun.dependencies,
    ),
    0,
  );
  assert.deepEqual(JSON.parse(jsonRun.state.stdout).data, { Task: manyPayload.Task[0] });

  // Неверный формат имени отклоняется с кодом 2.
  for (const badArgv of [
    ["tasks", "list", "tools"],
    ["tasks", "list", "a.b.c"],
    ["tasks", "list", "--library", "tools"],
    ["tasks", "list", "tools.get_version", "--library", "tools", "--method", "get_version"],
  ]) {
    const bad = harness();
    assert.equal(await runCli(badArgv, bad.io, bad.dependencies), 2, badArgv.join(" "));
    assert.equal(bad.state.calls.length, 0);
  }
});

test("tasks status и tasks kill работают в TTY (с подтверждением на kill), с --yes и в не-TTY", async () => {
  // tasks status: завершённая задача показывает TrackingID, результат и пометку об удалении сервером.
  const done = harness({
    stdoutIsTTY: true,
    color: false,
    reply: () =>
      okResult("web.spxml.getAsyncMethodStatus", { IsRunning: "0", value: "2025.1.1171" }),
  });
  assert.equal(await runCli(["tasks", "status", "0xABC"], done.io, done.dependencies), 0);
  assert.deepEqual(done.state.calls, [
    { id: "web.spxml.getAsyncMethodStatus", args: { trackingId: "0xABC" } },
  ]);
  assert.match(done.state.stdout, /0xABC/);
  assert.match(done.state.stdout, /Завершена/);
  assert.match(done.state.stdout, /2025\.1\.1171/);
  assert.match(done.state.stdout, /удалил запись о задаче/);

  // tasks status: идущая задача без пометки об удалении.
  const running = harness({
    stdoutIsTTY: true,
    color: false,
    reply: () => okResult("web.spxml.getAsyncMethodStatus", { IsRunning: "1", Progress: "40%" }),
  });
  assert.equal(await runCli(["tasks", "status", "42"], running.io, running.dependencies), 0);
  assert.match(running.state.stdout, /Выполняется/);
  assert.match(running.state.stdout, /40%/);
  assert.doesNotMatch(running.state.stdout, /удалил запись/);

  // tasks kill в TTY: отказ отменяет остановку с кодом 1.
  const killDecline = harness({
    stdoutIsTTY: true,
    color: false,
    confirm: false,
  });
  assert.equal(
    await runCli(["tasks", "kill", "0xABC"], killDecline.io, killDecline.dependencies),
    1,
  );
  assert.equal(killDecline.state.calls.length, 0);
  assert.equal(killDecline.state.confirmQuestions.length, 1);
  assert.match(killDecline.state.stderr, /dev \(http:\/\/hcm\.invalid\/\)/);
  assert.match(killDecline.state.stderr, /Уже сделанные изменения не откатываются/);
  assert.match(killDecline.state.stderr, /Отменено\./);

  // tasks kill в TTY: согласие вызывает web.spxml.killAsyncMethod.
  const killAccept = harness({
    stdoutIsTTY: true,
    color: false,
    confirm: true,
    reply: () => okResult("web.spxml.killAsyncMethod", {}),
  });
  assert.equal(await runCli(["tasks", "kill", "0xABC"], killAccept.io, killAccept.dependencies), 0);
  assert.deepEqual(killAccept.state.calls, [
    { id: "web.spxml.killAsyncMethod", args: { trackingId: "0xABC" } },
  ]);
  assert.match(killAccept.state.stdout, /0xABC/);

  // tasks kill с --yes в TTY и в не-TTY не спрашивает подтверждение.
  for (const [argv, isTty] of [
    [["tasks", "kill", "0xABC", "--yes"], true],
    [["tasks", "kill", "0xABC"], false],
  ] as const) {
    const h = harness({
      stdoutIsTTY: isTty,
      color: false,
      confirm: false,
      reply: () => okResult("web.spxml.killAsyncMethod", {}),
    });
    assert.equal(await runCli([...argv], h.io, h.dependencies), 0);
    assert.equal(h.state.confirmQuestions.length, 0);
    assert.equal(h.state.calls.length, 1);
  }

  // Неверный TrackingID отклоняется до подключения.
  const badId = harness();
  assert.equal(await runCli(["tasks", "status", "not-id"], badId.io, badId.dependencies), 2);
  assert.equal(badId.state.loads, 0);
});

// ---------------------------------------------------------------------------
// 3. wtctl config use и wtctl config remove (алиас rm)
// ---------------------------------------------------------------------------

test("config use переключает defaultConnection, проверяет конфликты и отклоняет запрещённые флаги", async () => {
  const initial = JSON.stringify({
    defaultConnection: "dev",
    connections: {
      dev: { baseUrl: "http://dev.test/", username: "u", password: "secret-dev" },
      prod: { baseUrl: "https://prod.test/", username: "u", password: "secret-prod" },
    },
  });

  // TTY: карточка и сохранение файла без раскрытия пароля.
  const tty = harness({ stdoutIsTTY: true, color: false, fileContent: initial });
  assert.equal(
    await runCli(["config", "use", "prod", "--config", "c.json"], tty.io, tty.dependencies),
    0,
    tty.state.stderr,
  );
  assert.match(tty.state.stdout, /Подключение по умолчанию изменено/);
  assert.match(tty.state.stdout, /prod/);
  assert.doesNotMatch(tty.state.stdout + tty.state.stderr, /secret-prod/);
  assert.equal(JSON.parse(tty.state.files.get("c.json")!).defaultConnection, "prod");

  // Конфликт одновременной записи.
  let reads = 0;
  const race = harness({
    readFile: async () => (++reads === 1 ? initial : '{"changed":true}'),
  });
  assert.equal(
    await runCli(["config", "use", "prod", "--config", "c.json"], race.io, race.dependencies),
    1,
  );
  assert.equal(JSON.parse(race.state.stderr).error.code, "CONFIG_CONFLICT");
  assert.equal(race.state.files.size, 0);

  // Старый формат → INVALID_CONFIG; несуществующее имя → UNKNOWN_CONNECTION.
  const legacy = harness({ fileContent: JSON.stringify({ baseUrl: "http://old.test/" }) });
  assert.equal(
    await runCli(["config", "use", "dev", "--config", "c.json"], legacy.io, legacy.dependencies),
    1,
  );
  assert.equal(JSON.parse(legacy.state.stderr).error.code, "INVALID_CONFIG");

  const missing = harness({ fileContent: initial });
  assert.equal(
    await runCli(["config", "use", "nope", "--config", "c.json"], missing.io, missing.dependencies),
    1,
  );
  assert.equal(JSON.parse(missing.state.stderr).error.code, "UNKNOWN_CONNECTION");

  // Отклонение --output, --password-stdin, лишних/недостающих аргументов и --format csv.
  for (const badArgv of [
    ["config", "use"],
    ["config", "use", "dev", "extra"],
    ["config", "use", "dev", "--output", "out.json"],
    ["config", "use", "dev", "--password-stdin"],
    ["config", "use", "dev", "--format", "csv"],
  ]) {
    const bad = harness({ fileContent: initial });
    assert.equal(await runCli(badArgv, bad.io, bad.dependencies), 2, badArgv.join(" "));
    assert.equal(bad.state.files.size, 0);
  }
});

test("config remove и алиас config rm подтверждают в TTY, защищены от гонки во время вопроса и обновляют defaultConnection", async () => {
  const initial = JSON.stringify({
    defaultConnection: "dev",
    connections: {
      dev: { baseUrl: "http://dev.test/", username: "u", password: "secret-dev" },
      prod: { baseUrl: "https://prod.test/", username: "u", password: "secret-prod" },
    },
  });

  // Справка для алиаса rm работает.
  const rmHelp = harness();
  assert.equal(await runCli(["config", "rm", "--help"], rmHelp.io, rmHelp.dependencies), 0);
  assert.match(rmHelp.state.stdout, /wtctl config remove/);

  // Несуществующее имя отклоняется ДО вопроса подтверждения.
  const unknown = harness({
    stdoutIsTTY: true,
    color: false,
    confirm: true,
    fileContent: initial,
  });
  assert.equal(
    await runCli(
      ["config", "rm", "absent", "--config", "c.json"],
      unknown.io,
      unknown.dependencies,
    ),
    1,
  );
  assert.equal(unknown.state.confirmQuestions.length, 0);
  assert.match(unknown.state.stderr, /UNKNOWN_CONNECTION/);

  // TTY без --yes: отказ → Отменено., код 1, файл не изменён.
  const declined = harness({
    stdoutIsTTY: true,
    color: false,
    confirm: false,
    fileContent: initial,
  });
  assert.equal(
    await runCli(
      ["config", "remove", "dev", "--config", "c.json"],
      declined.io,
      declined.dependencies,
    ),
    1,
  );
  assert.equal(declined.state.confirmQuestions.length, 1);
  assert.match(declined.state.stderr, /dev \(http:\/\/dev\.test\/\)/);
  assert.match(declined.state.stderr, /Отменено\./);
  assert.equal(declined.state.files.size, 0);

  // TTY без --yes: согласие по алиасу rm удаляет dev и переводит defaultConnection на prod.
  const accepted = harness({
    stdoutIsTTY: true,
    color: false,
    confirm: true,
    fileContent: initial,
  });
  assert.equal(
    await runCli(["config", "rm", "dev", "--config", "c.json"], accepted.io, accepted.dependencies),
    0,
  );
  assert.equal(accepted.state.confirmQuestions.length, 1);
  assert.match(accepted.state.stdout, /Подключение удалено/);
  assert.match(accepted.state.stdout, /По умолчанию:\s+prod/);
  assert.doesNotMatch(accepted.state.stdout + accepted.state.stderr, /secret-dev/);
  const afterFirst = JSON.parse(accepted.state.files.get("c.json")!);
  assert.equal(afterFirst.defaultConnection, "prod");
  assert.deepEqual(Object.keys(afterFirst.connections), ["prod"]);

  // Изменение файла во время ожидания подтверждения → CONFIG_CONFLICT.
  let raceReads = 0;
  const raceDuringConfirm = harness({
    stdoutIsTTY: true,
    color: false,
    confirm: true,
    readFile: async () =>
      ++raceReads === 1 ? initial : '{"connections":{"other":{"baseUrl":"http://o.test/"}}}',
  });
  assert.equal(
    await runCli(
      ["config", "remove", "dev", "--config", "c.json"],
      raceDuringConfirm.io,
      raceDuringConfirm.dependencies,
    ),
    1,
  );
  assert.match(raceDuringConfirm.state.stderr, /CONFIG_CONFLICT/);
  assert.equal(raceDuringConfirm.state.files.size, 0);

  // С --yes в TTY и в не-TTY удаляет без вопроса; удаление последнего убирает defaultConnection.
  const single = JSON.stringify({
    defaultConnection: "prod",
    connections: { prod: { baseUrl: "https://prod.test/" } },
  });
  const withYes = harness({
    stdoutIsTTY: true,
    color: false,
    confirm: false,
    fileContent: single,
  });
  assert.equal(
    await runCli(
      ["config", "remove", "prod", "--yes", "--config", "c.json"],
      withYes.io,
      withYes.dependencies,
    ),
    0,
  );
  assert.equal(withYes.state.confirmQuestions.length, 0);
  const afterLast = JSON.parse(withYes.state.files.get("c.json")!);
  assert.equal("defaultConnection" in afterLast, false);
  assert.deepEqual(afterLast.connections, {});

  const nonTty = harness({ stdoutIsTTY: false, confirm: false, fileContent: initial });
  assert.equal(
    await runCli(["config", "rm", "prod", "--config", "c.json"], nonTty.io, nonTty.dependencies),
    0,
  );
  assert.equal(nonTty.state.confirmQuestions.length, 0);
  const nonTtyJson = JSON.parse(nonTty.state.stdout);
  assert.equal(nonTtyJson.ok, true);
  assert.equal(nonTtyJson.data.removed.name, "prod");
  assert.deepEqual(nonTtyJson.data.remaining, ["dev"]);

  // Запрещённые флаги отклоняются с кодом 2.
  for (const badArgv of [
    ["config", "remove"],
    ["config", "remove", "dev", "--output", "out.json"],
    ["config", "rm", "dev", "--password-stdin"],
    ["config", "rm", "dev", "--format", "csv"],
  ]) {
    const bad = harness({ fileContent: initial });
    assert.equal(await runCli(badArgv, bad.io, bad.dependencies), 2, badArgv.join(" "));
    assert.equal(bad.state.files.size, 0);
  }
});

// ---------------------------------------------------------------------------
// 4. Безопасное удаление в TTY (object delete, files delete) и parseConfirmAnswer
// ---------------------------------------------------------------------------

test("parseConfirmAnswer принимает y/yes/д/да без учёта регистра и отклоняет пустой ввод и отказы", () => {
  for (const yes of ["y", "Y", "yes", "YES", "  Yes  ", "д", "Д", "да", "Да", "\tДА\n"]) {
    assert.equal(parseConfirmAnswer(yes), true, yes);
  }
  for (const no of ["", "   ", "n", "no", "нет", "da", "1", "maybe"]) {
    assert.equal(parseConfirmAnswer(no), false, no);
  }
});

test("object delete в TTY без --permanent/--yes показывает объект и спрашивает [y/N], а в не-TTY требует --permanent", async () => {
  const objectPreview = okResult("objects.get", {
    type: "collaborator",
    id: "0x123",
    url: "x-local://wt_data/objects/0000/123.xml",
    data: { fullname: "Иванов Иван", code: "emp_01" },
  });

  // TTY, согласие: читает сводку, показывает подключение и поля, затем удаляет с permanent:true.
  const accept = harness({
    stdoutIsTTY: true,
    color: false,
    confirm: true,
    reply: (id) =>
      id === "objects.get"
        ? objectPreview
        : okResult("objects.delete", {
            id: "0x123",
            verification: "catalog",
            catalog: "collaborators",
            mutationOutcome: "confirmed",
          }),
  });
  assert.equal(
    await runCli(["object", "delete", "collaborator", "0x123"], accept.io, accept.dependencies),
    0,
  );
  assert.deepEqual(accept.state.calls, [
    { id: "objects.get", args: { id: "0x123", type: "collaborator" } },
    { id: "objects.delete", args: { id: "0x123", type: "collaborator", permanent: true } },
  ]);
  assert.equal(accept.state.confirmQuestions.length, 1);
  assert.match(accept.state.stderr, /dev \(http:\/\/hcm\.invalid\/\)/);
  assert.match(accept.state.stderr, /collaborator · 0x123/);
  assert.match(accept.state.stderr, /Иванов Иван/);
  assert.match(accept.state.stderr, /emp_01/);
  assert.match(accept.state.stdout, /Объект удалён/);

  // TTY, отказ: «Отменено.» и код 1 без вызова objects.delete.
  const decline = harness({
    stdoutIsTTY: true,
    color: false,
    confirm: false,
    reply: () => objectPreview,
  });
  assert.equal(await runCli(["object", "delete", "0x123"], decline.io, decline.dependencies), 1);
  assert.deepEqual(
    decline.state.calls.map((c) => c.id),
    ["objects.get"],
  );
  assert.match(decline.state.stderr, /Отменено\./);
  assert.equal(decline.state.stdout, "");

  // Ошибка objects.get при показе сводки не блокирует вопрос подтверждения.
  const brokenPreview = harness({
    stdoutIsTTY: true,
    color: false,
    confirm: true,
    reply: (id) =>
      id === "objects.get"
        ? errResult("objects.get", "PLATFORM_SOAP-FAULT", "Не прочитан")
        : okResult("objects.delete", { id: "0x123", mutationOutcome: "confirmed" }),
  });
  assert.equal(
    await runCli(["object", "delete", "0x123"], brokenPreview.io, brokenPreview.dependencies),
    0,
  );
  assert.equal(brokenPreview.state.confirmQuestions.length, 1);
  assert.equal(brokenPreview.state.calls[1]!.id, "objects.delete");
  assert.equal(brokenPreview.state.calls[1]!.args.permanent, true);

  // В TTY с --permanent или --yes: без вопроса и без предварительного objects.get.
  for (const flag of ["--permanent", "--yes"]) {
    const direct = harness({
      stdoutIsTTY: true,
      color: false,
      confirm: false,
      reply: () => okResult("objects.delete", { id: "0x123", mutationOutcome: "confirmed" }),
    });
    assert.equal(
      await runCli(["object", "delete", "0x123", flag], direct.io, direct.dependencies),
      0,
      flag,
    );
    assert.equal(direct.state.confirmQuestions.length, 0);
    assert.deepEqual(direct.state.calls, [
      { id: "objects.delete", args: { id: "0x123", permanent: true } },
    ]);
  }

  // В не-TTY или без io.confirm требование --permanent сохраняется даже при --yes!
  for (const [argv, opts] of [
    [["object", "delete", "0x123"], { stdoutIsTTY: false }],
    [["object", "delete", "0x123", "--yes"], { stdoutIsTTY: false, confirm: true }],
    [["object", "delete", "0x123", "--json"], { stdoutIsTTY: false, confirm: true }],
    [["object", "delete", "0x123", "--yes", "--json"], { stdoutIsTTY: false, confirm: true }],
    [["object", "delete", "0x123"], { stdoutIsTTY: true }],
  ] as const) {
    const blocked = harness(opts);
    assert.equal(await runCli([...argv], blocked.io, blocked.dependencies), 2, argv.join(" "));
    assert.equal(blocked.state.loads, 0);
    assert.equal(blocked.state.calls.length, 0);
  }
});

test("files delete в TTY без --yes показывает подключение и сведения файла и спрашивает [y/N]", async () => {
  const url = "x-local://share/tmp/test.txt";

  // TTY, согласие: проверяет files.exists, показывает сведения, удаляет.
  const accept = harness({
    stdoutIsTTY: true,
    color: false,
    confirm: true,
    reply: (id) =>
      id === "files.exists"
        ? okResult("files.exists", { exists: true })
        : okResult("files.delete", { mutationOutcome: "confirmed" }),
  });
  assert.equal(await runCli(["files", "delete", url], accept.io, accept.dependencies), 0);
  assert.deepEqual(accept.state.calls, [
    { id: "files.exists", args: { url } },
    { id: "files.delete", args: { url } },
  ]);
  assert.match(accept.state.stderr, /dev \(http:\/\/hcm\.invalid\/\)/);
  assert.match(accept.state.stderr, /x-local:\/\/share\/tmp\/test\.txt/);
  assert.match(accept.state.stderr, /существует/);
  assert.match(accept.state.stdout, /Файл удалён/);

  // TTY, отказ: «Отменено.» и код 1 без вызова files.delete.
  const decline = harness({
    stdoutIsTTY: true,
    color: false,
    confirm: false,
    reply: () => okResult("files.exists", { exists: true }),
  });
  assert.equal(await runCli(["files", "delete", url], decline.io, decline.dependencies), 1);
  assert.deepEqual(
    decline.state.calls.map((c) => c.id),
    ["files.exists"],
  );
  assert.match(decline.state.stderr, /Отменено\./);

  // Ошибка files.exists не блокирует подтверждение.
  const failedExists = harness({
    stdoutIsTTY: true,
    color: false,
    confirm: true,
    reply: (id) =>
      id === "files.exists"
        ? errResult("files.exists", "INVALID_ARGUMENT", "Слишком длинный адрес")
        : okResult("files.delete", { mutationOutcome: "confirmed" }),
  });
  assert.equal(
    await runCli(["files", "delete", url], failedExists.io, failedExists.dependencies),
    0,
  );
  assert.equal(failedExists.state.confirmQuestions.length, 1);
  assert.equal(failedExists.state.calls[1]!.id, "files.delete");

  // С --yes, --permanent в TTY или в не-TTY: сразу вызывает files.delete без files.exists и вопроса.
  for (const [argv, isTty] of [
    [["files", "delete", url, "--yes"], true],
    [["files", "delete", url, "--permanent"], true],
    [["files", "delete", url], false],
  ] as const) {
    const direct = harness({
      stdoutIsTTY: isTty,
      color: false,
      confirm: false,
      reply: () => okResult("files.delete", { mutationOutcome: "confirmed" }),
    });
    assert.equal(await runCli([...argv], direct.io, direct.dependencies), 0);
    assert.equal(direct.state.confirmQuestions.length, 0);
    assert.deepEqual(direct.state.calls, [{ id: "files.delete", args: { url } }]);
  }
});

test("confirmOnStream завершается с false при EOF и при Ctrl+C (SIGINT) без зависания", async () => {
  // EOF: закрытие входного потока сразу завершает вопрос.
  const eofIn = new PassThrough();
  const eofOut = new PassThrough();
  const eofPromise = confirmOnStream("Удалить? [y/N] ", eofIn, eofOut, true);
  eofIn.end();
  assert.equal(await eofPromise, false);

  // Ctrl+C (\x03 в terminal-режиме): readline шлёт SIGINT, вопрос завершается отказом.
  const ctrlCIn = new PassThrough();
  const ctrlCOut = new PassThrough();
  const ctrlCPromise = confirmOnStream("Удалить? [y/N] ", ctrlCIn, ctrlCOut, true);
  ctrlCIn.write("\x03");
  assert.equal(await ctrlCPromise, false);

  // Обычное согласие «да».
  const yesIn = new PassThrough();
  const yesOut = new PassThrough();
  const yesPromise = confirmOnStream("Удалить? [y/N] ", yesIn, yesOut, false);
  yesIn.end("да\n");
  assert.equal(await yesPromise, true);
});

test("agent run --logs учитывает дату файла, отсекает события вне многодневного интервала и читает оба файла при смене дня", async () => {
  // Многодневный интервал: 21 ноя 15:00 .. 22 ноя 16:00 — событие 22:00 22 ноября не должно попасть.
  const multiEvents = parseLogEvents(
    "15:30:00 [r] внутри\n22:00:00 [r] позже конца\n",
    "2026-11-22",
    false,
  );
  const filteredMulti = filterLogEventsByInterval(
    multiEvents,
    "2026-11-21T15:00:00",
    "2026-11-22T16:00:00",
    2,
    "2026-11-22",
  );
  assert.equal(filteredMulti.length, 1);
  assert.match(filteredMulti[0]!.text, /внутри/);

  // Переход через полночь: читает оба дневных файла в хронологическом порядке.
  const h = harness({
    stdoutIsTTY: false,
    reply: (id, args) => {
      if (id === "agents.run") {
        return okResult("agents.run", {
          started: true,
          startedAt: "2026-11-21T23:59:59",
          finishedAt: "2026-11-22T00:00:01",
          hint: "ok",
        });
      }
      if (id === "logs.list") {
        return okResult("logs.list", {
          files: [
            { name: "xhttp_2026-11-22.log", type: "xhttp", dateHint: "2026-11-22" },
            { name: "xhttp_2026-11-21.log", type: "xhttp", dateHint: "2026-11-21" },
            { name: "xhttp_2026-11-20.log", type: "xhttp", dateHint: "2026-11-20" },
          ],
        });
      }
      if (id === "logs.read" && args.file === "xhttp_2026-11-21.log") {
        return okResult("logs.read", {
          file: "xhttp_2026-11-21.log",
          text: "23:50:00 [r] рано\n23:59:59 [r] до полуночи\n",
          tailOnly: false,
        });
      }
      if (id === "logs.read" && args.file === "xhttp_2026-11-22.log") {
        return okResult("logs.read", {
          file: "xhttp_2026-11-22.log",
          text: "00:00:01 [r] после полуночи\n00:10:00 [r] поздно\n",
          tailOnly: false,
        });
      }
      throw new Error(`unexpected ${id} ${JSON.stringify(args)}`);
    },
  });
  assert.equal(await runCli(["agent", "run", "0x1", "--logs"], h.io, h.dependencies), 0);
  const parsed = JSON.parse(h.state.stdout) as {
    data: { logs: { files: string[]; events: { text: string }[] } };
  };
  assert.deepEqual(parsed.data.logs.files, ["xhttp_2026-11-21.log", "xhttp_2026-11-22.log"]);
  assert.equal(parsed.data.logs.events.length, 2);
  assert.match(parsed.data.logs.events[0]!.text, /до полуночи/);
  assert.match(parsed.data.logs.events[1]!.text, /после полуночи/);
});

test("agent run --logs соблюдает outputLimitBytes (код 3 в json/jsonl/raw/table, 0 с --output)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wtctl-agent-limit-"));
  try {
    const store = new ResultStore({ ...BASE_CONFIG, runtimeDir: dir, outputLimitBytes: 24 * 1024 });
    const hugeLine = `14:10:01 [0139] ${"X".repeat(49 * 1024)}\n`;

    const makeHarness = () =>
      harness({
        stdoutIsTTY: false,
        color: false,
        results: store,
        reply: (id) => {
          if (id === "agents.run") {
            return okResult("agents.run", {
              started: true,
              startedAt: "2026-11-22T14:10:00",
              finishedAt: "2026-11-22T14:10:02",
              hint: "ok",
            });
          }
          if (id === "logs.list") {
            return okResult("logs.list", {
              files: [{ name: "xhttp_2026-11-22.log", type: "xhttp", dateHint: "2026-11-22" }],
            });
          }
          return okResult("logs.read", {
            file: "xhttp_2026-11-22.log",
            text: hugeLine,
            tailOnly: false,
          });
        },
      });

    for (const fmt of ["json", "jsonl", "raw", "table"] as const) {
      const h = makeHarness();
      const code = await runCli(
        ["agent", "run", "0x1", "--logs", "--format", fmt],
        h.io,
        h.dependencies,
      );
      assert.equal(code, 3, `формат ${fmt} должен вернуть код 3`);
      assert.ok(
        Buffer.byteLength(h.state.stdout, "utf8") < 24 * 1024,
        `stdout переполнен в ${fmt}`,
      );
    }

    // С --output полный ответ записывается в файл и возвращает 0.
    const withFile = makeHarness();
    assert.equal(
      await runCli(
        ["agent", "run", "0x1", "--logs", "--output", "out.json"],
        withFile.io,
        withFile.dependencies,
      ),
      0,
    );
    const saved = withFile.state.files.get("out.json") ?? "";
    assert.ok(saved.length > 49 * 1024);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("object delete в TTY экранирует управляющие символы из полей объекта на экране подтверждения", async () => {
  const h = harness({
    stdoutIsTTY: true,
    color: false,
    confirm: false,
    reply: () =>
      okResult("objects.get", {
        type: "group",
        id: "0x1",
        data: { name: "Опасная\x07\x1b[31mгруппа" },
      }),
  });
  assert.equal(await runCli(["object", "delete", "group", "0x1"], h.io, h.dependencies), 1);
  assert.equal(h.state.stderr.includes("\x07"), false, "BEL не должен попадать в stderr");
  assert.equal(h.state.stderr.includes("\x1b"), false, "ESC не должен попадать в stderr");
  assert.match(h.state.stderr, /\\x07\\x1b\[31mгруппа/);
});

test("WTCTL_FORMAT=json и --json в TTY не отключают подтверждение удаления и остановки", async () => {
  const prev = process.env.WTCTL_FORMAT;
  process.env.WTCTL_FORMAT = "json";
  try {
    // files delete с WTCTL_FORMAT=json в TTY спрашивает [y/N], отказ не вызывает files.delete.
    const filesDecline = harness({
      stdoutIsTTY: true,
      color: false,
      confirm: false,
      reply: () => okResult("files.exists", { exists: true }),
    });
    assert.equal(
      await runCli(
        ["files", "delete", "x-local://share/tmp/a.txt"],
        filesDecline.io,
        filesDecline.dependencies,
      ),
      1,
    );
    assert.equal(filesDecline.state.confirmQuestions.length, 1);
    assert.deepEqual(
      filesDecline.state.calls.map((c) => c.id),
      ["files.exists"],
    );
    assert.match(filesDecline.state.stderr, /Отменено\./);

    // tasks kill с WTCTL_FORMAT=json в TTY спрашивает [y/N], согласие выводит чистый JSON в stdout.
    const killAccept = harness({
      stdoutIsTTY: true,
      color: false,
      confirm: true,
      reply: () => okResult("web.spxml.killAsyncMethod", { killed: true }),
    });
    assert.equal(
      await runCli(["tasks", "kill", "0x42"], killAccept.io, killAccept.dependencies),
      0,
    );
    assert.equal(killAccept.state.confirmQuestions.length, 1);
    assert.equal(JSON.parse(killAccept.state.stdout).ok, true);
  } finally {
    if (prev === undefined) delete process.env.WTCTL_FORMAT;
    else process.env.WTCTL_FORMAT = prev;
  }
});

test("agent run --logs читает поле date из logs.list (включая truncated список), а карточка при смене дня не ищет только по времени старта", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wtctl-agent-list-trunc-"));
  try {
    const store = new ResultStore({ ...BASE_CONFIG, runtimeDir: dir, outputLimitBytes: 24 * 1024 });
    const storedList = await store.put({
      files: [
        { name: "xhttp_2026-11-22.log", type: "xhttp", date: "2026-11-22", sizeBytes: 100 },
        { name: "xhttp.log", type: "xhttp", date: "2026-11-21", sizeBytes: 200 },
      ],
      total: 2,
    });

    const h = harness({
      stdoutIsTTY: true,
      color: false,
      results: store,
      reply: (id, args) => {
        if (id === "agents.run") {
          return okResult("agents.run", {
            started: true,
            startedAt: "2026-11-21T23:59:59",
            finishedAt: "2026-11-22T00:00:01",
            hint: "ok",
          });
        }
        if (id === "logs.list") {
          return okResult(
            "logs.list",
            { kind: "stored-result", resultId: storedList.resultId },
            { truncated: true, resultId: storedList.resultId, resultBytes: storedList.bytes },
          );
        }
        if (id === "logs.read" && args.file === "xhttp.log") {
          return okResult("logs.read", {
            file: "xhttp.log",
            text: "23:59:59 [r] до полуночи в xhttp.log\n",
            tailOnly: false,
          });
        }
        if (id === "logs.read" && args.file === "xhttp_2026-11-22.log") {
          return okResult("logs.read", {
            file: "xhttp_2026-11-22.log",
            text: "00:00:01 [r] после полуночи\n",
            tailOnly: false,
          });
        }
        throw new Error(`unexpected ${id} ${JSON.stringify(args)}`);
      },
    });

    assert.equal(await runCli(["agent", "run", "0x1", "--logs"], h.io, h.dependencies), 0);
    assert.match(h.state.stdout, /до полуночи в xhttp\.log/);
    assert.match(h.state.stdout, /после полуночи/);
    assert.doesNotMatch(h.state.stdout, /logs search xhttp 23:59/);
    assert.match(
      h.state.stdout,
      /logs list --type xhttp --start-date 2026-11-21 --end-date 2026-11-22/,
    );

    // Переход через границу минуты в пределах дня: подсказка с фильтрами обеих минут.
    const crossMin = harness({
      stdoutIsTTY: true,
      stderrIsTTY: true,
      color: false,
      reply: () =>
        okResult("agents.run", {
          started: true,
          startedAt: "2026-11-22T10:15:58",
          finishedAt: "2026-11-22T10:16:02",
        }),
    });
    assert.equal(await runCli(["agent", "run", "0x1"], crossMin.io, crossMin.dependencies), 0);
    assert.match(crossMin.state.stdout, /logs search xhttp 10:15.*logs search xhttp 10:16/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
