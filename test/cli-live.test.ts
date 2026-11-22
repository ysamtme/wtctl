import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { stripAnsi } from "../src/cli/format/ansi.js";
import { openAtomicTextWriter } from "../src/cli/node-io.js";
import { createProgress } from "../src/cli/progress.js";
import { runCli } from "../src/cli/run.js";
import type {
  CliDependencies,
  CliIo,
  CliTimers,
  FileTextWriter,
  RuntimePort,
} from "../src/cli/types.js";
import type { ConnectionConfig, OperationResult } from "../src/contracts.js";
import { logNews } from "../src/log-output.js";
import { LogReader } from "../src/logs.js";
import { ResultStore } from "../src/results.js";
import { scratchRuntimeDir } from "./fake-server.js";

const BASE_CONFIG: ConnectionConfig = {
  name: "stand",
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
    meta: { operationId, connection: "stand", durationMs: 10, ...extraMeta },
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
    meta: { operationId, connection: "stand", durationMs: 5 },
  };
}

/** Детерминированный планировщик таймеров без реального ожидания. */
function makeFakeTimers() {
  let nextId = 1;
  const timeouts = new Map<number, { fn: () => void; ms: number }>();
  const intervals = new Map<number, { fn: () => void; ms: number }>();
  const timers: CliTimers = {
    setTimeout(callback, ms) {
      const id = nextId++;
      timeouts.set(id, { fn: callback, ms });
      return id;
    },
    clearTimeout(handle) {
      timeouts.delete(handle as number);
    },
    setInterval(callback, ms) {
      const id = nextId++;
      intervals.set(id, { fn: callback, ms });
      return id;
    },
    clearInterval(handle) {
      intervals.delete(handle as number);
    },
  };
  return {
    timers,
    timeouts,
    intervals,
    fireTimeouts(): void {
      for (const [id, entry] of [...timeouts]) {
        timeouts.delete(id);
        entry.fn();
      }
    },
    tickIntervals(): void {
      for (const entry of [...intervals.values()]) entry.fn();
    },
  };
}

interface LiveHarnessOptions {
  stdoutIsTTY?: boolean;
  stderrIsTTY?: boolean;
  columns?: number;
  color?: boolean;
  signal?: AbortSignal;
  timers?: CliTimers;
  fileInput?: string;
  results?: RuntimePort["results"];
  outputLimitBytes?: number;
  maxResponseBytes?: number;
  forceExit?: (code: number) => void;
  openTextWriter?: (path: string) => Promise<FileTextWriter>;
  onSleep?: (ms: number, signal?: AbortSignal) => void | Promise<void>;
  reply?: (
    id: string,
    args: Record<string, unknown>,
    callIndex: number,
  ) => OperationResult | Promise<OperationResult>;
}

function liveHarness(options: LiveHarnessOptions = {}) {
  const interruptHandlers = new Set<() => void>();
  const state = {
    stdout: "",
    stdoutChunks: [] as string[],
    stderr: "",
    stderrChunks: [] as string[],
    files: new Map<string, string>(),
    writerEvents: [] as string[],
    calls: [] as { id: string; args: Record<string, unknown> }[],
    sleeps: [] as number[],
    closes: 0,
  };

  const io: CliIo = {
    ...(options.stdoutIsTTY === undefined ? {} : { stdoutIsTTY: options.stdoutIsTTY }),
    ...(options.stderrIsTTY === undefined ? {} : { stderrIsTTY: options.stderrIsTTY }),
    ...(options.columns === undefined ? {} : { columns: options.columns }),
    ...(options.color === undefined ? {} : { color: options.color }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.timers === undefined ? {} : { timers: options.timers }),
    ...(options.openTextWriter === undefined ? {} : { openTextWriter: options.openTextWriter }),
    ...(options.forceExit === undefined ? {} : { forceExit: options.forceExit }),
    pretty: options.stdoutIsTTY === true,
    onInterrupt: (handler) => {
      interruptHandlers.add(handler);
      return () => {
        interruptHandlers.delete(handler);
      };
    },
    sleep: async (ms, signal) => {
      state.sleeps.push(ms);
      if (signal?.aborted) return;
      if (options.onSleep) await options.onSleep(ms, signal);
    },
    writeOut: (text) => {
      state.stdout += text;
      state.stdoutChunks.push(text);
    },
    writeError: (text) => {
      state.stderr += text;
      state.stderrChunks.push(text);
    },
    readFile: async () => options.fileInput ?? "{}",
    readStdin: async () => options.fileInput ?? "{}",
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
    loadConfiguration: (loadOpts) => ({
      ...BASE_CONFIG,
      maxResponseBytes: options.maxResponseBytes ?? BASE_CONFIG.maxResponseBytes,
      outputLimitBytes:
        options.outputLimitBytes ??
        loadOpts.defaultOutputLimitBytes ??
        BASE_CONFIG.outputLimitBytes,
    }),
    createRuntime: () => runtime,
    runMcp: async () => undefined,
  };

  return {
    state,
    io,
    runtime,
    dependencies,
    triggerInterrupt: () => {
      for (const handler of [...interruptHandlers]) handler();
    },
    interruptListenerCount: () => interruptHandlers.size,
  };
}

function makeLogLines(count: number): string {
  return `${Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    const sec = String(n % 60).padStart(2, "0");
    const min = String(Math.floor(n / 60)).padStart(2, "0");
    const level = n % 10 === 0 ? "ERROR сбой" : "событие";
    return `12:${min}:${sec} [t${n}] ${level} #${n}`;
  }).join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// 1. Разрешение свежего файла лога по имени типа
// ---------------------------------------------------------------------------

test("logs read/search/tail/follow разрешают имя типа в самый свежий файл через logs.list", async () => {
  const h = liveHarness({
    stdoutIsTTY: true,
    stderrIsTTY: true,
    color: false,
    reply: (id, args) => {
      if (id === "logs.list") {
        assert.deepEqual(args, { type: "xhttp", limit: 1 });
        return okResult("logs.list", {
          files: [
            { name: "xhttp_2026-11-22.log", type: "xhttp", date: "2026-11-22", sizeBytes: 1200 },
          ],
          total: 5,
        });
      }
      return okResult("logs.read", {
        file: String(args.file),
        text: "10:00:00 [r1] строка\n",
        sizeBytes: 1200,
        tailOnly: false,
        fingerprint: "fp1",
      });
    },
  });

  assert.equal(await runCli(["logs", "read", "xhttp"], h.io, h.dependencies), 0);
  assert.deepEqual(
    h.state.calls.map((c) => c.id),
    ["logs.list", "logs.read"],
  );
  assert.equal(h.state.calls[1]!.args.file, "xhttp_2026-11-22.log");
  assert.match(h.state.stderr, /Файл лога: xhttp_2026-11-22\.log/);
  assert.equal(h.state.stdout, "10:00:00 [r1] строка\n");

  // С --quiet и в машинном --json имя файла в stderr не печатается.
  const quietRun = liveHarness({
    stdoutIsTTY: true,
    color: false,
    reply: (id, args) =>
      id === "logs.list"
        ? okResult("logs.list", {
            files: [{ name: "agent_2026-11-22.log", type: "agent", sizeBytes: 50 }],
            total: 1,
          })
        : okResult("logs.search", {
            file: String(args.file),
            events: [],
            totalEvents: 0,
            matches: 0,
            fingerprint: "fp",
            tailOnly: false,
          }),
  });
  assert.equal(
    await runCli(["logs", "search", "agent", "текст", "-q"], quietRun.io, quietRun.dependencies),
    0,
  );
  assert.equal(quietRun.state.stderr, "");
  assert.equal(quietRun.state.calls[1]!.args.file, "agent_2026-11-22.log");

  const jsonRun = liveHarness({
    stdoutIsTTY: false,
    reply: (id, args) =>
      id === "logs.list"
        ? okResult("logs.list", {
            files: [{ name: "xhttp_2026-11-22.log", type: "xhttp", sizeBytes: 50 }],
            total: 1,
          })
        : okResult("logs.follow", {
            file: String(args.file),
            events: [],
            cursor: "c1",
            changed: false,
            gapPossible: false,
            windowTruncated: false,
          }),
  });
  assert.equal(await runCli(["logs", "follow", "xhttp"], jsonRun.io, jsonRun.dependencies), 0);
  assert.equal(jsonRun.state.stderr, "");
  assert.equal(JSON.parse(jsonRun.state.stdout).data.file, "xhttp_2026-11-22.log");
});

test("отсутствующий тип лога возвращает LOG_NOT_FOUND с кодом 1, а имя с точкой или URL не вызывает logs.list", async () => {
  const missing = liveHarness({
    stdoutIsTTY: true,
    stderrIsTTY: true,
    color: false,
    reply: () => okResult("logs.list", { files: [], total: 0 }),
  });
  assert.equal(await runCli(["logs", "tail", "missingtype"], missing.io, missing.dependencies), 1);
  assert.equal(missing.state.calls.length, 1);
  assert.match(missing.state.stderr, /LOG_NOT_FOUND/);
  assert.match(missing.state.stderr, /missingtype/);

  // Имя с точкой и URL идут сразу в logs.read без logs.list.
  for (const target of ["xhttp_2026-11-22.log", "x-local://Logs/xhttp.log"]) {
    const direct = liveHarness({
      reply: (_id, args) =>
        okResult("logs.read", {
          file: String(args.file),
          text: "ok\n",
          sizeBytes: 3,
          tailOnly: false,
          fingerprint: "fp",
        }),
    });
    assert.equal(await runCli(["logs", "read", target], direct.io, direct.dependencies), 0);
    assert.deepEqual(
      direct.state.calls.map((c) => c.id),
      ["logs.read"],
    );
  }
});

// ---------------------------------------------------------------------------
// 2. logs tail: -n, дефолт 50 в TTY, --tail-bytes, совместимость и валидация
// ---------------------------------------------------------------------------

test("logs tail в TTY по умолчанию показывает последние 50 событий и не запрашивает 150+ КиБ", async () => {
  const h = liveHarness({
    stdoutIsTTY: true,
    color: true,
    reply: (_id, args) => {
      // В TTY дефолтный лимит 256 КиБ, но для 50 событий запрашиваем аккуратное окно (~50 КиБ).
      assert.ok(typeof args.tailBytes === "number" && args.tailBytes <= 64 * 1024);
      return okResult("logs.read", {
        file: "xhttp.log",
        text: makeLogLines(80),
        sizeBytes: 200_000,
        tailOnly: true,
        fingerprint: "fp",
      });
    },
  });

  assert.equal(await runCli(["logs", "tail", "xhttp.log"], h.io, h.dependencies), 0);
  const plainLines = stripAnsi(h.state.stdout).trimEnd().split("\n");
  assert.equal(plainLines.length, 50);
  assert.match(plainLines[0]!, /#31$/);
  assert.match(plainLines.at(-1)!, /#80$/);
  // Подсветка уровня ERROR присутствует в TTY.
  assert.match(h.state.stdout, /\x1b\[31mERROR\x1b\[39m/);
  assert.match(stripAnsi(h.state.stderr), /последние 50 событий/);
});

test("logs tail -n N поддерживает все форматы, расширяет окно при нехватке событий и сохраняет --tail-bytes / pipe", async () => {
  // Явный -n 3 в table, jsonl, csv, raw и json.
  const makeReply = () =>
    okResult("logs.read", {
      file: "xhttp.log",
      text: makeLogLines(10),
      sizeBytes: 2048,
      tailOnly: false,
      fingerprint: "fp",
    });

  const tableRun = liveHarness({ color: false, reply: makeReply });
  assert.equal(
    await runCli(
      ["logs", "tail", "xhttp.log", "-n", "3", "--format", "table"],
      tableRun.io,
      tableRun.dependencies,
    ),
    0,
  );
  assert.equal(tableRun.state.stdout.trimEnd().split("\n").length, 3);
  assert.match(tableRun.state.stdout, /#8\n.*#9\n.*#10\n$/);

  const jsonlRun = liveHarness({ reply: makeReply });
  assert.equal(
    await runCli(
      ["logs", "tail", "xhttp.log", "-n", "2", "--format", "jsonl"],
      jsonlRun.io,
      jsonlRun.dependencies,
    ),
    0,
  );
  const jsonlItems = jsonlRun.state.stdout
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line) as { text: string; level: string });
  assert.equal(jsonlItems.length, 2);
  assert.match(jsonlItems[0]!.text, /#9$/);
  assert.equal(jsonlItems[1]!.level, "error");

  const csvRun = liveHarness({ reply: makeReply });
  assert.equal(
    await runCli(
      ["logs", "tail", "xhttp.log", "-n", "2", "--format", "csv"],
      csvRun.io,
      csvRun.dependencies,
    ),
    0,
  );
  assert.match(csvRun.state.stdout, /^sequence,time,context,level,text\n/);
  assert.equal(csvRun.state.stdout.trimEnd().split("\n").length, 3);

  const jsonRun = liveHarness({ reply: makeReply });
  assert.equal(
    await runCli(
      ["logs", "tail", "xhttp.log", "-n", "2", "--json"],
      jsonRun.io,
      jsonRun.dependencies,
    ),
    0,
  );
  const parsedJson = JSON.parse(jsonRun.state.stdout) as {
    data: { text: string; tailOnly: boolean };
  };
  assert.equal(parsedJson.data.text.trimEnd().split("\n").length, 2);
  assert.equal(parsedJson.data.tailOnly, true);

  // Дозапрос большего безопасного окна, если в первом 16 КиБ было меньше событий, чем -n.
  const expandRun = liveHarness({
    stdoutIsTTY: true,
    color: false,
    reply: (_id, args, index) => {
      if (index === 0) {
        return okResult("logs.read", {
          file: "xhttp.log",
          text: makeLogLines(2),
          sizeBytes: 300_000,
          tailOnly: true,
          fingerprint: "fp1",
        });
      }
      assert.ok((args.tailBytes as number) > 16 * 1024);
      return okResult("logs.read", {
        file: "xhttp.log",
        text: makeLogLines(10),
        sizeBytes: 300_000,
        tailOnly: true,
        fingerprint: "fp2",
      });
    },
  });
  assert.equal(
    await runCli(["logs", "tail", "xhttp.log", "-n", "5"], expandRun.io, expandRun.dependencies),
    0,
  );
  assert.equal(expandRun.state.calls.length, 2);
  assert.equal(expandRun.state.stdout.trimEnd().split("\n").length, 5);

  // Явный --tail-bytes без -n в TTY и pipe без -n сохраняют прежний путь logs.read.
  const byteTail = liveHarness({
    stdoutIsTTY: true,
    color: false,
    reply: () =>
      okResult("logs.read", {
        file: "xhttp.log",
        text: "сырой фрагмент\n",
        sizeBytes: 9000,
        tailOnly: true,
        fingerprint: "fp",
      }),
  });
  assert.equal(
    await runCli(
      ["logs", "tail", "xhttp.log", "--tail-bytes", "4096"],
      byteTail.io,
      byteTail.dependencies,
    ),
    0,
  );
  assert.deepEqual(byteTail.state.calls, [
    { id: "logs.read", args: { file: "xhttp.log", tailBytes: 4096 } },
  ]);
  assert.equal(byteTail.state.stdout, "сырой фрагмент\n");

  const pipeTail = liveHarness({ stdoutIsTTY: false });
  assert.equal(await runCli(["logs", "tail", "xhttp.log"], pipeTail.io, pipeTail.dependencies), 0);
  assert.deepEqual(pipeTail.state.calls, [{ id: "logs.read", args: { file: "xhttp.log" } }]);
});

test("ошибочные комбинации флагов logs tail и logs follow отклоняются с кодом 2 до обращения к серверу", async () => {
  const invalidCases: { argv: string[]; stdoutIsTTY?: boolean }[] = [
    { argv: ["logs", "tail", "xhttp.log", "--interval", "1"] },
    { argv: ["logs", "tail", "xhttp.log", "-f", "--output", "out.log"], stdoutIsTTY: true },
    { argv: ["logs", "tail", "xhttp.log", "-f", "--format", "csv"] },
    { argv: ["logs", "tail", "xhttp.log", "-f", "--format", "tsv"] },
    { argv: ["logs", "tail", "xhttp.log", "-f", "--json"] },
    { argv: ["logs", "tail", "xhttp.log", "-f", "--format", "json"] },
    { argv: ["logs", "tail", "xhttp.log", "--full"] },
    { argv: ["logs", "tail", "xhttp.log", "-n", "0"] },
    { argv: ["logs", "tail", "xhttp.log", "-n", "10001"] },
    { argv: ["logs", "tail", "xhttp.log", "-f", "--interval", "0.2"] },
    { argv: ["logs", "tail", "xhttp.log", "-f", "--interval", "61"] },
    { argv: ["logs", "tail", "xhttp.log", "-f", "--once"] },
    { argv: ["logs", "follow", "xhttp.log", "--once", "--interval", "1"] },
    { argv: ["logs", "follow", "xhttp.log", "-f"] },
    { argv: ["logs", "follow", "xhttp.log", "--full", "--tail-bytes", "100"] },
    { argv: ["logs", "follow", "xhttp.log", "--output", "out.log"], stdoutIsTTY: true },
    { argv: ["logs", "follow", "xhttp.log", "--format", "csv"], stdoutIsTTY: true },
    { argv: ["logs", "follow", "xhttp.log", "--format", "tsv"], stdoutIsTTY: true },
    { argv: ["logs", "follow", "xhttp.log", "--interval", "1", "--format", "json"] },
    { argv: ["logs", "follow", "xhttp.log", "--interval", "1", "--format", "csv"] },
    {
      argv: [
        "logs",
        "follow",
        "xhttp.log",
        "--interval",
        "1",
        "--format",
        "jsonl",
        "--output",
        "a.jsonl",
      ],
    },
  ];

  for (const item of invalidCases) {
    const h = liveHarness({ stdoutIsTTY: item.stdoutIsTTY ?? false });
    const code = await runCli(item.argv, h.io, h.dependencies);
    assert.equal(code, 2, `${item.argv.join(" ")} (TTY=${String(item.stdoutIsTTY ?? false)})`);
    assert.equal(h.state.calls.length, 0, item.argv.join(" "));
  }
});

// ---------------------------------------------------------------------------
// 3. logs follow и logs tail -f: потоковый цикл, LOG_READ_UNAVAILABLE, SIGINT, one-shot
// ---------------------------------------------------------------------------

test("logs follow в TTY идёт циклом, переживает LOG_READ_UNAVAILABLE с прежним cursor и чисто выходит по SIGINT с кодом 0", async () => {
  let step = 0;
  let harnessRef!: ReturnType<typeof liveHarness>;

  harnessRef = liveHarness({
    stdoutIsTTY: true,
    stderrIsTTY: true,
    color: true,
    onSleep: () => {
      // После 4-го опроса имитируем Ctrl+C (SIGINT).
      if (step >= 4) harnessRef.triggerInterrupt();
    },
    reply: (id, args) => {
      if (id === "logs.list") {
        return okResult("logs.list", {
          files: [{ name: "xhttp_2026-11-22.log", type: "xhttp", sizeBytes: 500 }],
          total: 1,
        });
      }
      step++;
      if (step === 1) {
        assert.equal(args.cursor, undefined);
        return okResult("logs.follow", {
          file: "xhttp_2026-11-22.log",
          events: [
            { sequence: 1, time: "12:00:01", context: "r1", level: "normal", text: "старт" },
          ],
          cursor: "cur-1",
          changed: true,
          gapPossible: false,
          windowTruncated: false,
        });
      }
      if (step === 2 || step === 3) {
        // Два сбоя подряд: cursor обязан остаться "cur-1", сообщение в stderr — один раз за серию!
        assert.equal(args.cursor, "cur-1");
        return errResult("logs.follow", "LOG_READ_UNAVAILABLE", "Файл занят.");
      }
      assert.equal(args.cursor, "cur-1");
      return okResult("logs.follow", {
        file: "xhttp_2026-11-22.log",
        events: [
          { sequence: 2, time: "12:00:05", context: "r2", level: "error", text: "ERROR сбой" },
        ],
        cursor: "cur-2",
        changed: true,
        gapPossible: false,
        windowTruncated: false,
      });
    },
  });

  const code = await runCli(
    ["logs", "follow", "xhttp", "--interval", "1.5"],
    harnessRef.io,
    harnessRef.dependencies,
  );
  assert.equal(code, 0);
  assert.equal(harnessRef.state.closes, 1);
  assert.equal(harnessRef.interruptListenerCount(), 0);
  assert.deepEqual(harnessRef.state.sleeps, [1500, 1500, 1500, 1500]);
  const plainOut = stripAnsi(harnessRef.state.stdout);
  assert.match(plainOut, /12:00:01 \[r1\] старт/);
  assert.match(plainOut, /12:00:05 \[r2\] ERROR сбой/);
  assert.match(harnessRef.state.stdout, /\x1b\[31mERROR\x1b\[39m/);
  // Файл лога выбран, а сообщение о занятости напечатано ровно один раз за серию из 2 отказов.
  const plainErr = stripAnsi(harnessRef.state.stderr);
  assert.match(plainErr, /Файл лога: xhttp_2026-11-22\.log/);
  assert.equal(plainErr.match(/Файл лога занят сервером/g)?.length, 1);
});

test("logs follow сохраняет одноразовый режим при --once, --json и в pipe, а с --format jsonl --interval стримит JSONL", async () => {
  const followPayload = () =>
    okResult("logs.follow", {
      file: "xhttp.log",
      events: [{ sequence: 1, time: "12:00:01", level: "info", text: "INFO привет" }],
      cursor: "cur-once",
      changed: true,
      gapPossible: false,
      windowTruncated: false,
    });

  // 1. --once в TTY: ровно 1 вызов, в выводе cursor, без sleep.
  const onceTty = liveHarness({ stdoutIsTTY: true, color: false, reply: followPayload });
  assert.equal(
    await runCli(["logs", "follow", "xhttp.log", "--once"], onceTty.io, onceTty.dependencies),
    0,
  );
  assert.equal(onceTty.state.calls.length, 1);
  assert.equal(onceTty.state.sleeps.length, 0);
  assert.match(onceTty.state.stdout, /cursor: cur-once/);

  // 2. --json в TTY: одноразовый JSON.
  const jsonTty = liveHarness({ stdoutIsTTY: true, reply: followPayload });
  assert.equal(
    await runCli(["logs", "follow", "xhttp.log", "--json"], jsonTty.io, jsonTty.dependencies),
    0,
  );
  assert.equal(jsonTty.state.calls.length, 1);
  assert.equal(JSON.parse(jsonTty.state.stdout).data.cursor, "cur-once");

  // 3. pipe (auto, не-TTY) с --cursor: одноразовый JSON.
  const pipeRun = liveHarness({ stdoutIsTTY: false, reply: followPayload });
  assert.equal(
    await runCli(
      ["logs", "follow", "xhttp.log", "--cursor", "prev"],
      pipeRun.io,
      pipeRun.dependencies,
    ),
    0,
  );
  assert.deepEqual(pipeRun.state.calls, [
    { id: "logs.follow", args: { file: "xhttp.log", cursor: "prev" } },
  ]);

  // 4. --format jsonl --interval 0.5 в не-TTY: потоковый JSONL до AbortSignal.
  const ac = new AbortController();
  let polls = 0;
  const jsonlStream = liveHarness({
    stdoutIsTTY: false,
    signal: ac.signal,
    onSleep: () => {
      if (polls >= 2) ac.abort();
    },
    reply: () => {
      polls++;
      return okResult("logs.follow", {
        file: "xhttp.log",
        events: [
          { sequence: polls, time: `12:00:0${polls}`, level: "normal", text: `событие ${polls}` },
        ],
        cursor: `c-${polls}`,
        changed: true,
        gapPossible: false,
        windowTruncated: false,
      });
    },
  });
  assert.equal(
    await runCli(
      ["logs", "follow", "xhttp.log", "--format", "jsonl", "--interval", "0.5"],
      jsonlStream.io,
      jsonlStream.dependencies,
    ),
    0,
  );
  const streamed = jsonlStream.state.stdout
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line) as { text: string });
  assert.deepEqual(
    streamed.map((e) => e.text),
    ["событие 1", "событие 2"],
  );
  assert.deepEqual(jsonlStream.state.sleeps, [500, 500]);
});

test("logs tail -f печатает хвост и продолжает слежение с cursor без дублирования событий", async () => {
  const ac = new AbortController();
  let followCalls = 0;
  const h = liveHarness({
    stdoutIsTTY: true,
    color: false,
    signal: ac.signal,
    onSleep: () => {
      if (followCalls >= 2) ac.abort();
    },
    reply: (id, args) => {
      if (id === "logs.read") {
        return okResult("logs.read", {
          file: "xhttp.log",
          text: makeLogLines(15),
          sizeBytes: 3000,
          tailOnly: false,
          fingerprint: "fp1",
        });
      }
      followCalls++;
      if (followCalls === 1) {
        // Первый logs.follow возвращает последние события 14, 15 (перекрытие!) и новое событие 16.
        assert.equal(args.cursor, undefined);
        return okResult("logs.follow", {
          file: "xhttp.log",
          events: [
            {
              sequence: 14,
              time: "12:00:14",
              context: "t14",
              level: "normal",
              text: "событие #14",
            },
            {
              sequence: 15,
              time: "12:00:15",
              context: "t15",
              level: "normal",
              text: "событие #15",
            },
            {
              sequence: 16,
              time: "12:00:16",
              context: "t16",
              level: "normal",
              text: "событие #16",
            },
          ],
          cursor: "cur-tail-1",
          changed: true,
          gapPossible: false,
          windowTruncated: false,
        });
      }
      assert.equal(args.cursor, "cur-tail-1");
      return okResult("logs.follow", {
        file: "xhttp.log",
        events: [
          { sequence: 17, time: "12:00:17", context: "t17", level: "normal", text: "событие #17" },
        ],
        cursor: "cur-tail-2",
        changed: true,
        gapPossible: false,
        windowTruncated: false,
      });
    },
  });

  const code = await runCli(
    ["logs", "tail", "xhttp.log", "-n", "12", "-f", "--interval", "0.5"],
    h.io,
    h.dependencies,
  );
  assert.equal(code, 0);
  const lines = h.state.stdout.trimEnd().split("\n");
  // Хвост 4..15 (12 событий) + новые 16 и 17 = ровно 14 строк, без повторения 14 и 15!
  assert.equal(lines.length, 14);
  assert.match(lines[0]!, /#4$/);
  assert.match(lines[11]!, /#15$/);
  assert.match(lines[12]!, /#16$/);
  assert.match(lines[13]!, /#17$/);
  assert.equal(lines.filter((l) => l.endsWith("#15")).length, 1);
});

// ---------------------------------------------------------------------------
// 4. query --all: автопагинация, потоковый csv/tsv/jsonl, --output, incomplete, truncated, прогресс
// ---------------------------------------------------------------------------

test("query --all валидирует конфликты флагов до обращения к серверу", async () => {
  const cases: { argv: string[]; fileInput?: string }[] = [
    { argv: ["query", "collaborators", "--page-size", "50"] },
    { argv: ["query", "collaborators", "--max-rows", "100"] },
    { argv: ["query", "collaborators", "--all", "--limit", "20"] },
    { argv: ["query", "collaborators", "--all", "-n", "20"] },
    { argv: ["query", "collaborators", "--all", "--page-size", "0"] },
    { argv: ["query", "collaborators", "--all", "--page-size", "1001"] },
    { argv: ["query", "collaborators", "--all", "--max-rows", "0"] },
    {
      argv: ["query", "--input-file", "q.json", "--all"],
      fileInput: '{"catalog":"collaborators","limit":10}',
    },
    { argv: ["query", "sql: select 1", "--all"] },
    {
      argv: ["query", "--input-file", "q.json", "--all"],
      fileInput: '{"query":"  SQL : select 1"}',
    },
    {
      argv: ["query", "--input-file", "q.json", "--all"],
      fileInput: '{"catalog":"people","startPosition":"9"}',
    },
    {
      argv: ["query", "--input-file", "q.json", "--all"],
      fileInput: '{"catalog":"people","startPosition":-1}',
    },
  ];
  for (const item of cases) {
    const h = liveHarness(item.fileInput === undefined ? {} : { fileInput: item.fileInput });
    assert.equal(await runCli(item.argv, h.io, h.dependencies), 2, item.argv.join(" "));
    assert.equal(h.state.calls.length, 0, item.argv.join(" "));
  }
});

test("query --all постранично стримит csv/tsv/jsonl, соблюдает --page-size и --max-rows, показывает прогресс в TTY", async () => {
  const allRows = [
    { id: "1", fullname: "Иван, А." },
    { id: "2", fullname: "Мария" },
    { id: "3", fullname: "Пётр" },
    { id: "4", fullname: "Ольга" },
    { id: "5", fullname: "Сергей" },
  ];

  const makePaginatedReply = () => (_id: string, args: Record<string, unknown>) => {
    const start = Number(args.startPosition ?? 0);
    const limit = Number(args.limit ?? 20);
    const slice = allRows.slice(start, start + limit);
    const next = start + slice.length < allRows.length ? start + slice.length : undefined;
    return okResult("runtime.query", {
      items: slice,
      total: allRows.length,
      ...(next === undefined ? {} : { nextStartPosition: next }),
    });
  };

  // CSV с автозаголовком из первой страницы, 3 страницы по 2 строки; прогресс появляется только после задержки 250 мс.
  const csvTimers = makeFakeTimers();
  let pageCount = 0;
  const csvRun = liveHarness({
    stdoutIsTTY: false,
    stderrIsTTY: true,
    color: false,
    timers: csvTimers.timers,
    reply: (id, args) => {
      pageCount++;
      if (pageCount === 2) csvTimers.fireTimeouts();
      return makePaginatedReply()(id, args);
    },
  });
  assert.equal(
    await runCli(
      ["query", "collaborators", "--all", "--page-size", "2", "--format", "csv"],
      csvRun.io,
      csvRun.dependencies,
    ),
    0,
  );
  assert.equal(csvRun.state.calls.length, 3);
  assert.equal(
    csvRun.state.stdout,
    'id,fullname\n1,"Иван, А."\n2,Мария\n3,Пётр\n4,Ольга\n5,Сергей\n',
  );
  // Строки уходили потоково по мере прихода страниц (3 чанка записи в stdout).
  assert.equal(csvRun.state.stdoutChunks.length, 3);
  // Прогресс в stderr показался после 250 мс (на 2-й странице) и стёрт в конце (\r\x1b[2K).
  assert.match(csvRun.state.stderr, /получено 2 строк \(из 5\)/);
  assert.match(csvRun.state.stderr, /получено 4 строк \(из 5\)/);
  assert.ok(csvRun.state.stderr.endsWith("\r\x1b[2K"));

  // Быстрый многостраничный query --all (< 250 мс) не мигает прогрессом в stderr.
  const fastTimers = makeFakeTimers();
  const fastCsv = liveHarness({
    stdoutIsTTY: false,
    stderrIsTTY: true,
    color: false,
    timers: fastTimers.timers,
    reply: makePaginatedReply(),
  });
  assert.equal(
    await runCli(
      ["query", "collaborators", "--all", "--page-size", "2", "--format", "csv"],
      fastCsv.io,
      fastCsv.dependencies,
    ),
    0,
  );
  assert.equal(fastCsv.state.stderr, "");

  // --max-rows 3 с --page-size 2: запрашивает 2, затем 1 (а не лишние строки!).
  const maxRun = liveHarness({ reply: makePaginatedReply() });
  assert.equal(
    await runCli(
      [
        "query",
        "collaborators",
        "--all",
        "--page-size",
        "2",
        "--max-rows",
        "3",
        "--format",
        "jsonl",
      ],
      maxRun.io,
      maxRun.dependencies,
    ),
    0,
  );
  assert.deepEqual(
    maxRun.state.calls.map((c) => ({ start: c.args.startPosition, limit: c.args.limit })),
    [
      { start: 0, limit: 2 },
      { start: 2, limit: 1 },
    ],
  );
  const jsonlRows = maxRun.state.stdout
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line) as { id: string });
  assert.deepEqual(
    jsonlRows.map((r) => r.id),
    ["1", "2", "3"],
  );

  // XQuery + --fields + TSV + защита от прототипного поля constructor.
  const tsvRun = liveHarness({ reply: makePaginatedReply() });
  assert.equal(
    await runCli(
      [
        "query",
        "for $e in collaborators return $e",
        "-f",
        "id,constructor,fullname",
        "--all",
        "--page-size",
        "3",
        "--format",
        "tsv",
      ],
      tsvRun.io,
      tsvRun.dependencies,
    ),
    0,
  );
  assert.equal(
    tsvRun.state.stdout,
    "id\tconstructor\tfullname\n1\t\tИван, А.\n2\t\tМария\n3\t\tПётр\n4\t\tОльга\n5\t\tСергей\n",
  );

  // В --json и TTY human собирает все страницы в один ответ.
  const jsonRun = liveHarness({ reply: makePaginatedReply() });
  assert.equal(
    await runCli(
      ["query", "collaborators", "--all", "--page-size", "2", "--json"],
      jsonRun.io,
      jsonRun.dependencies,
    ),
    0,
  );
  const fullJson = JSON.parse(jsonRun.state.stdout) as {
    data: { items: unknown[]; total: number };
  };
  assert.equal(fullJson.data.items.length, 5);
  assert.equal(fullJson.data.total, 5);
});

test("query --all прерывается с QUERY_INCOMPLETE (код 1) при incomplete:true и не оставляет битый --output файл", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wtctl-qall-"));
  const outPath = join(dir, "nested", "export.csv");
  try {
    const h = liveHarness({
      stdoutIsTTY: true,
      stderrIsTTY: true,
      color: false,
      openTextWriter: openAtomicTextWriter,
      reply: (_id, args) => {
        const start = Number(args.startPosition ?? 0);
        if (start === 0) {
          return okResult("runtime.query", {
            items: [{ id: "1" }, { id: "2" }],
            total: 10,
            nextStartPosition: 2,
          });
        }
        return okResult("runtime.query", {
          items: [{ id: "3" }],
          total: 10,
          incomplete: true,
          hint: "Сервер вернул неполную страницу.",
        });
      },
    });

    const code = await runCli(
      [
        "query",
        "collaborators",
        "--all",
        "--page-size",
        "2",
        "--format",
        "csv",
        "--output",
        outPath,
      ],
      h.io,
      h.dependencies,
    );
    assert.equal(code, 1);
    assert.match(h.state.stderr, /QUERY_INCOMPLETE/);
    assert.match(h.state.stderr, /неполную страницу/);
    // Временный файл откатан — целевого файла на диске нет.
    await assert.rejects(stat(outPath), { code: "ENOENT" });

    // Успешный потоковый экспорт вложенного файла --output создаёт папки и сохраняет файл целиком.
    const okRun = liveHarness({
      stdoutIsTTY: false,
      stderrIsTTY: false,
      color: false,
      openTextWriter: openAtomicTextWriter,
      reply: (_id, args) => {
        const start = Number(args.startPosition ?? 0);
        return start === 0
          ? okResult("runtime.query", {
              items: [{ id: "1", name: "А" }],
              total: 2,
              nextStartPosition: 1,
            })
          : okResult("runtime.query", { items: [{ id: "2", name: "Б" }], total: 2 });
      },
    });
    assert.equal(
      await runCli(
        [
          "query",
          "collaborators",
          "--all",
          "--page-size",
          "1",
          "--format",
          "csv",
          "--output",
          outPath,
        ],
        okRun.io,
        okRun.dependencies,
      ),
      0,
    );
    assert.equal(await readFile(outPath, "utf8"), "id,name\n1,А\n2,Б\n");
    assert.match(okRun.state.stdout, /Сохранено:.*строк: 2/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("query --all дочитывает страницу, сохранённую на диск (meta.truncated / resultId), без потери строк", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wtctl-qstored-"));
  try {
    const store = new ResultStore({ ...BASE_CONFIG, runtimeDir: dir });
    const storedPage = await store.put(
      {
        items: [
          { id: "10", name: "Первая" },
          { id: "11", name: "Вторая" },
        ],
        total: 3,
        nextStartPosition: 2,
      },
      "items",
    );

    const h = liveHarness({
      results: store,
      reply: async (id, args) => {
        if (id === "results.read") {
          const data = await store.read(
            String(args.resultId),
            args.offset,
            args.limit,
            args.format,
          );
          return okResult("results.read", data);
        }
        if (Number(args.startPosition ?? 0) === 0) {
          return okResult(
            "runtime.query",
            { preview: { items: [] }, resultId: storedPage.resultId },
            { truncated: true, resultId: storedPage.resultId, resultBytes: storedPage.bytes },
          );
        }
        return okResult("runtime.query", { items: [{ id: "12", name: "Третья" }], total: 3 });
      },
    });

    assert.equal(
      await runCli(["query", "collaborators", "--all", "--format", "jsonl"], h.io, h.dependencies),
      0,
    );
    const items = h.state.stdout
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line) as { id: string });
    assert.deepEqual(
      items.map((item) => item.id),
      ["10", "11", "12"],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 5. Спиннер и прогресс в stderr
// ---------------------------------------------------------------------------

test("спиннер появляется только после задержки 250 мс, обновляется и всегда стирает свою строку", async () => {
  const fake = makeFakeTimers();
  const chunks: string[] = [];
  const io = {
    stderrIsTTY: true,
    color: false,
    timers: fake.timers,
    writeError: (text: string) => {
      chunks.push(text);
    },
  } as unknown as CliIo;

  // Быстрая команда (stop до 250 мс): ничего не пишется в stderr.
  const fast = createProgress(io, { enabled: true });
  fast.start("Загрузка…");
  assert.equal(fake.timeouts.size, 1);
  assert.equal([...fake.timeouts.values()][0]!.ms, 250);
  await fast.stop();
  assert.equal(fake.timeouts.size, 0);
  assert.deepEqual(chunks, []);

  // Долгая команда (>= 250 мс): показывает кадр, крутится и стирает строку \r\x1b[2K.
  const slow = createProgress(io, { enabled: true });
  slow.start("Загрузка…");
  fake.fireTimeouts();
  assert.equal(chunks.length, 1);
  assert.match(chunks[0]!, /^\r\x1b\[2K⠋ Загрузка…$/);
  fake.tickIntervals();
  assert.equal(chunks.length, 2);
  assert.match(chunks[1]!, /^\r\x1b\[2K⠙ Загрузка…$/);
  await slow.stop();
  assert.equal(chunks.at(-1), "\r\x1b[2K");
  assert.equal(fake.intervals.size, 0);
});

test("спиннер в runCli стирается до вывода и ошибки и выключен при --quiet, --json и не-TTY", async () => {
  // Долгий сетевой вызов в TTY: спиннер показывается и стирается ДО печати результата.
  const fake = makeFakeTimers();
  const events: string[] = [];
  let releaseCall!: () => void;
  const callPending = new Promise<void>((resolve) => {
    releaseCall = resolve;
  });

  const ttyRun = liveHarness({
    stdoutIsTTY: true,
    stderrIsTTY: true,
    color: false,
    timers: fake.timers,
    reply: async () => {
      await callPending;
      return okResult("runtime.status", {
        connection: "stand",
        baseUrl: "http://hcm.invalid/",
        version: "2025.1",
        permissions: { write: false, execute: false },
      });
    },
  });
  const origOut = ttyRun.io.writeOut;
  const origErr = ttyRun.io.writeError;
  ttyRun.io.writeOut = (text) => {
    events.push(`OUT:${text.slice(0, 12)}`);
    return origOut(text);
  };
  ttyRun.io.writeError = (text) => {
    events.push(`ERR:${text}`);
    return origErr(text);
  };

  const pendingRun = runCli(["status"], ttyRun.io, ttyRun.dependencies);
  // Даём дойти до вызова runtime.call и срабатываем таймер 250 мс.
  await Promise.resolve();
  fake.fireTimeouts();
  releaseCall();
  assert.equal(await pendingRun, 0);
  // Сначала кадр спиннера, затем очистка \r\x1b[2K, и только потом stdout!
  const clearIndex = events.indexOf("ERR:\r\x1b[2K");
  const outIndex = events.findIndex((e) => e.startsWith("OUT:"));
  assert.ok(clearIndex > 0, events.join(" | "));
  assert.ok(outIndex > clearIndex, events.join(" | "));

  // При ошибке сетевого вызова спиннер тоже стирается до печати ошибки.
  const errTimers = makeFakeTimers();
  let releaseFail!: () => void;
  const failPending = new Promise<void>((resolve) => {
    releaseFail = resolve;
  });
  const failRun = liveHarness({
    stdoutIsTTY: true,
    stderrIsTTY: true,
    color: false,
    timers: errTimers.timers,
    reply: async () => {
      await failPending;
      return errResult("runtime.status", "AUTH_FAILED", "Ошибка входа.");
    },
  });
  const pendingFail = runCli(["status"], failRun.io, failRun.dependencies);
  await Promise.resolve();
  errTimers.fireTimeouts();
  releaseFail();
  assert.equal(await pendingFail, 1);
  const clearIdx = failRun.state.stderrChunks.indexOf("\r\x1b[2K");
  const errIdx = failRun.state.stderrChunks.findIndex((c) => c.includes("AUTH_FAILED"));
  assert.ok(clearIdx > 0);
  assert.ok(errIdx > clearIdx);

  // При --quiet, --json и не-TTY (stderrIsTTY: false) таймеры спиннера даже не заводятся.
  for (const [argv, opts] of [
    [["status", "-q"], { stdoutIsTTY: true, stderrIsTTY: true }],
    [["status", "--json"], { stdoutIsTTY: true, stderrIsTTY: true }],
    [["status"], { stdoutIsTTY: false, stderrIsTTY: true }],
    [["status"], { stdoutIsTTY: true, stderrIsTTY: false }],
    [["version"], { stdoutIsTTY: true, stderrIsTTY: true }],
    [["api", "list"], { stdoutIsTTY: true, stderrIsTTY: true }],
  ] as const) {
    const timers = makeFakeTimers();
    const run = liveHarness({ ...opts, timers: timers.timers });
    assert.equal(await runCli([...argv], run.io, run.dependencies), 0, argv.join(" "));
    assert.equal(timers.timeouts.size, 0, argv.join(" "));
    assert.equal(run.state.stderr, "", argv.join(" "));
  }
});

// ---------------------------------------------------------------------------
// 6. Регрессионные тесты по замечаниям ревью Тикета 04
// ---------------------------------------------------------------------------

test("logs tail -f строит cursor из того же logs.read и не теряет события, пришедшие до первого follow", async () => {
  // 50 исходных событий, затем до первого follow дописываются ещё 11 (51..61 — больше окна 10 у follow без cursor!).
  const initialText = makeLogLines(50);
  const grownText = makeLogLines(61);
  let currentText = initialText;
  const fakeLogs = new LogReader(
    {
      call: async (id: string) => {
        throw new Error(`unexpected ${id}`);
      },
    },
    { maxResponseBytes: 1024 * 1024 },
  );
  // Подменяем read/follow поверх реального алгоритма Logs.follow через общий движок курсоров.
  (fakeLogs as unknown as { read: (input: { file: string }) => Promise<unknown> }).read = async ({
    file,
  }) => ({
    file: {
      name: file,
      url: `x-local://Logs/${encodeURIComponent(file)}`,
      title: file,
      type: "xhttp",
      sizeBytes: String(Buffer.byteLength(currentText, "utf8")),
      dateLabel: "2026-11-22",
      dateHint: "2026-11-22",
      redFlag: false,
    },
    text: currentText,
    requestedMode: "tail",
    effectiveTailBytes: Buffer.byteLength(currentText, "utf8"),
    sizeBytesBefore: String(Buffer.byteLength(currentText, "utf8")),
    sizeBytesAfter: String(Buffer.byteLength(currentText, "utf8")),
    serverTailNotice: true,
    truncated: false,
    returnedChars: currentText.length,
    fingerprint: createHash("sha256").update(currentText).digest("hex"),
  });

  const ac = new AbortController();
  let followCalls = 0;
  const h = liveHarness({
    stdoutIsTTY: true,
    color: false,
    signal: ac.signal,
    onSleep: () => {
      // После initial tail наращиваем файл на 11 событий; после первого follow останавливаемся.
      if (followCalls === 0) currentText = grownText;
      else ac.abort();
    },
    reply: async (id, args) => {
      if (id === "logs.read") {
        const read = (await fakeLogs.read({ file: String(args.file) })) as {
          file: { name: string };
          text: string;
          sizeBytesAfter: string;
          truncated: boolean;
          fingerprint: string;
        };
        return okResult("logs.read", {
          file: read.file.name,
          text: read.text,
          sizeBytes: Number(read.sizeBytesAfter),
          tailOnly: read.truncated,
          fingerprint: read.fingerprint,
        });
      }
      followCalls++;
      // В первый же logs.follow передан cursor из logs.read!
      assert.equal(typeof args.cursor, "string");
      const data = await fakeLogs.follow({
        file: String(args.file),
        cursor: String(args.cursor),
      });
      return okResult("logs.follow", logNews(data, false, 128 * 1024));
    },
  });

  assert.equal(
    await runCli(["logs", "tail", "xhttp.log", "-n", "50", "-f"], h.io, h.dependencies),
    0,
  );
  const lines = h.state.stdout.trimEnd().split("\n");
  assert.equal(lines.length, 61);
  assert.match(lines[0]!, /#1$/);
  assert.match(lines[49]!, /#50$/);
  assert.match(lines[50]!, /#51$/);
  assert.match(lines[60]!, /#61$/);
});

test("потоковый logs follow дочитывает сохранённый ответ (meta.truncated) и продвигает cursor", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wtctl-fstored-"));
  try {
    const store = new ResultStore({ ...BASE_CONFIG, runtimeDir: dir });
    const bigPayload = "X".repeat(30 * 1024);
    const saved = await store.put({
      file: "xhttp.log",
      events: [{ sequence: 1, time: "12:00:01", level: "info", text: `INFO ${bigPayload}` }],
      cursor: "cur-after-big",
      changed: true,
      gapPossible: false,
      windowTruncated: false,
    });

    const ac = new AbortController();
    let polls = 0;
    const h = liveHarness({
      stdoutIsTTY: false,
      signal: ac.signal,
      results: store,
      onSleep: () => {
        if (polls >= 2) ac.abort();
      },
      reply: (_id, args) => {
        polls++;
        if (polls === 1) {
          return okResult(
            "logs.follow",
            { kind: "stored-result", resultId: saved.resultId },
            { truncated: true, resultId: saved.resultId, resultBytes: saved.bytes },
          );
        }
        assert.equal(args.cursor, "cur-after-big");
        return okResult("logs.follow", {
          file: "xhttp.log",
          events: [{ sequence: 2, time: "12:00:02", level: "normal", text: "следующее" }],
          cursor: "cur-final",
          changed: true,
          gapPossible: false,
          windowTruncated: false,
        });
      },
    });

    assert.equal(
      await runCli(
        ["logs", "follow", "xhttp.log", "--format", "jsonl", "--interval", "0.5"],
        h.io,
        h.dependencies,
      ),
      0,
    );
    const items = h.state.stdout
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line) as { text: string });
    assert.equal(items.length, 2);
    assert.equal(items[0]!.text, `INFO ${bigPayload}`);
    assert.equal(items[1]!.text, "следующее");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("logs tail -n 150 расширяет окно сверх 140 КиБ (включая meta.truncated и --output) и кавычит имя с пробелами", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wtctl-tailbig-"));
  try {
    const store = new ResultStore({ ...BASE_CONFIG, runtimeDir: dir });
    const full200 = `${Array.from({ length: 200 }, (_, i) => `12:00:00 [r${i + 1}] ${"A".repeat(1800)} #${i + 1}`).join("\n")}\n`;
    const fullBytes = Buffer.byteLength(full200, "utf8"); // ~360 КиБ > 256 КиБ!
    const saved = await store.put({
      file: "my log.log",
      text: full200,
      sizeBytes: fullBytes,
      tailOnly: false,
      fingerprint: "a".repeat(64),
    });

    const outPath = join(dir, "tail.txt");
    const h = liveHarness({
      stdoutIsTTY: true,
      color: false,
      outputLimitBytes: 256 * 1024,
      maxResponseBytes: 8 * 1024 * 1024,
      results: store,
      reply: (_id, args) => {
        const tailBytes = Number(args.tailBytes ?? 0);
        if (tailBytes < fullBytes) {
          const partial = full200.slice(-tailBytes);
          return okResult("logs.read", {
            file: "my log.log",
            text: partial,
            sizeBytes: fullBytes,
            tailOnly: true,
            fingerprint: "b".repeat(64),
          });
        }
        return okResult(
          "logs.read",
          { kind: "stored-result", resultId: saved.resultId },
          { truncated: true, resultId: saved.resultId, resultBytes: saved.bytes },
        );
      },
    });

    assert.equal(
      await runCli(
        ["logs", "tail", "my log.log", "-n", "150", "--format", "raw", "--output", outPath],
        h.io,
        h.dependencies,
      ),
      0,
    );
    const written = h.state.files.get(outPath) ?? "";
    const outLines = written.trimEnd().split("\n");
    assert.equal(outLines.length, 150);
    assert.match(outLines[0]!, /#51$/);
    assert.match(outLines[149]!, /#200$/);
    assert.match(h.state.stderr, /wtctl logs read "my log\.log" --full\./);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("logs follow немедленно прерывает зависший опрос по SIGTERM и держит обработчик сигнала до конца close()", async () => {
  let closeSawListener = false;
  let harnessRef!: ReturnType<typeof liveHarness>;
  harnessRef = liveHarness({
    stdoutIsTTY: true,
    color: false,
    reply: () =>
      new Promise<OperationResult>(() => {
        // Имитируем зависший сетевой опрос и посылаем SIGTERM во время ожидания ответа.
        queueMicrotask(() => harnessRef.triggerInterrupt());
      }),
  });
  const origClose = harnessRef.runtime.close;
  harnessRef.runtime.close = async () => {
    closeSawListener = harnessRef.interruptListenerCount() > 0;
    await origClose();
  };

  assert.equal(
    await runCli(["logs", "follow", "xhttp.log"], harnessRef.io, harnessRef.dependencies),
    0,
  );
  assert.equal(closeSawListener, true);
  assert.equal(harnessRef.state.closes, 1);
  assert.equal(harnessRef.interruptListenerCount(), 0);
});

test("query --all в CSV/TSV/raw без --fields сообщает об ошибке QUERY_COLUMNS_CHANGED при появлении новых полей на 2-й странице", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wtctl-drift-"));
  const outPath = join(dir, "drift.csv");
  try {
    const h = liveHarness({
      color: false,
      openTextWriter: openAtomicTextWriter,
      reply: (_id, args) => {
        const start = Number(args.startPosition ?? 0);
        if (start === 0) {
          return okResult("runtime.query", {
            items: [{ id: "1" }],
            total: 2,
            nextStartPosition: 1,
          });
        }
        return okResult("runtime.query", {
          items: [{ id: "2", email: "a@b.invalid" }],
          total: 2,
        });
      },
    });

    assert.equal(
      await runCli(
        [
          "query",
          "collaborators",
          "--all",
          "--page-size",
          "1",
          "--format",
          "csv",
          "--output",
          outPath,
        ],
        h.io,
        h.dependencies,
      ),
      1,
    );
    assert.match(h.state.stderr, /QUERY_COLUMNS_CHANGED/);
    assert.match(h.state.stderr, /--fields id,email/);
    await assert.rejects(stat(outPath), { code: "ENOENT" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("спиннер пропускает промежуточные кадры при занятом stderr и не копит очередь", async () => {
  const fake = makeFakeTimers();
  let releaseFirstWrite!: () => void;
  const writes: string[] = [];
  const io = {
    stderrIsTTY: true,
    color: false,
    timers: fake.timers,
    writeError: (text: string) => {
      writes.push(text);
      if (writes.length === 1) {
        return new Promise<void>((resolve) => {
          releaseFirstWrite = resolve;
        });
      }
      return undefined;
    },
  } as unknown as CliIo;

  const progress = createProgress(io, { enabled: true });
  progress.start("Запрос…");
  fake.fireTimeouts();
  for (let i = 0; i < 1000; i++) fake.tickIntervals();
  assert.equal(writes.length, 1);

  const stopping = progress.stop();
  releaseFirstWrite();
  await stopping;
  // Только 1 кадр + 1 очистка строки, а не 1001 запись!
  assert.deepEqual(writes, ["\r\x1b[2K⠋ Запрос…", "\r\x1b[2K"]);
});

test("logs tail -f при малом бюджете 24 КиБ дочитывает omitted-пачку через logs.read без потери событий", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wtctl-omitted-"));
  try {
    const store = new ResultStore({ ...BASE_CONFIG, runtimeDir: dir, outputLimitBytes: 24 * 1024 });
    const makeBigEvents = (count: number) =>
      `${Array.from({ length: count }, (_, i) => `12:00:${String(i % 60).padStart(2, "0")} [r${i + 1}] ${"B".repeat(1200)} #${i + 1}`).join("\n")}\n`;
    const initialText = makeBigEvents(12);
    const grownText = makeBigEvents(32); // +20 событий (~24+ КиБ > pageBytes 14.4 КиБ)
    let currentText = initialText;

    const fakeLogs = new LogReader(
      {
        call: async () => {
          throw new Error("unused");
        },
      },
      { maxResponseBytes: 1024 * 1024 },
    );
    (fakeLogs as unknown as { read: (input: { file: string }) => Promise<unknown> }).read = async ({
      file,
    }) => ({
      file: {
        name: file,
        url: `x-local://Logs/${encodeURIComponent(file)}`,
        title: file,
        type: "xhttp",
        sizeBytes: String(Buffer.byteLength(currentText, "utf8")),
        dateLabel: "2026-11-22",
        dateHint: "2026-11-22",
        redFlag: false,
      },
      text: currentText,
      requestedMode: "tail",
      effectiveTailBytes: Buffer.byteLength(currentText, "utf8"),
      sizeBytesBefore: String(Buffer.byteLength(currentText, "utf8")),
      sizeBytesAfter: String(Buffer.byteLength(currentText, "utf8")),
      serverTailNotice: true,
      truncated: false,
      returnedChars: currentText.length,
      fingerprint: createHash("sha256").update(currentText).digest("hex"),
    });

    const ac = new AbortController();
    let followCalls = 0;
    const h = liveHarness({
      stdoutIsTTY: false,
      outputLimitBytes: 24 * 1024,
      signal: ac.signal,
      results: store,
      onSleep: () => {
        if (followCalls === 0) currentText = grownText;
        else ac.abort();
      },
      reply: async (id, args) => {
        if (id === "logs.read") {
          const read = (await fakeLogs.read({ file: String(args.file) })) as {
            file: { name: string };
            text: string;
            sizeBytesAfter: string;
            truncated: boolean;
            fingerprint: string;
          };
          const payload = {
            file: read.file.name,
            text: read.text,
            sizeBytes: Number(read.sizeBytesAfter),
            tailOnly: read.truncated,
            fingerprint: read.fingerprint,
          };
          const saved = await store.put(payload);
          return okResult(
            "logs.read",
            { kind: "stored-result", resultId: saved.resultId },
            { truncated: true, resultId: saved.resultId, resultBytes: saved.bytes },
          );
        }
        followCalls++;
        const data = await fakeLogs.follow({
          file: String(args.file),
          cursor: String(args.cursor),
        });
        // pageBytes = 14.4 КиБ — logNews обрежет пачку из 20 событий и вернёт omitted > 0!
        const news = logNews(data, false, Math.floor(24 * 1024 * 0.6));
        assert.ok((news.omitted ?? 0) > 0);
        return okResult("logs.follow", news);
      },
    });

    assert.equal(
      await runCli(
        ["logs", "tail", "xhttp.log", "-n", "12", "-f", "--format", "jsonl"],
        h.io,
        h.dependencies,
      ),
      0,
    );
    const items = h.state.stdout
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line) as { text: string });
    // Все 12 начальных + все 20 новых событий = ровно 32, ни одно не потеряно!
    assert.equal(items.length, 32);
    assert.match(items[0]!.text, /#1$/);
    assert.match(items[11]!.text, /#12$/);
    assert.match(items[12]!.text, /#13$/);
    assert.match(items[31]!.text, /#32$/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("query --all: сохранённая первая страница собирает столбцы всей страницы, а preview.incomplete прерывает до stdout", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wtctl-stored-p1-"));
  try {
    const store = new ResultStore({ ...BASE_CONFIG, runtimeDir: dir });

    // 1. Первая страница в ResultStore: вторая строка добавляет email — CSV собирает оба столбца, как и без сохранения.
    const savedCsv = await store.put(
      {
        items: [{ id: "1" }, { id: "2", email: "a@b.invalid" }],
        total: 2,
      },
      "items",
    );
    const csvH = liveHarness({
      results: store,
      reply: () =>
        okResult(
          "runtime.query",
          { preview: { items: [] }, resultId: savedCsv.resultId },
          { truncated: true, resultId: savedCsv.resultId, resultBytes: savedCsv.bytes },
        ),
    });
    assert.equal(
      await runCli(
        ["query", "collaborators", "--all", "--format", "csv"],
        csvH.io,
        csvH.dependencies,
      ),
      0,
    );
    assert.equal(csvH.state.stdout, "id,email\n1,\n2,a@b.invalid\n");

    // 2. Сохранённая страница с data.preview.incomplete === true: stdout остаётся пустым!
    const savedInc = await store.put(
      {
        items: [{ id: "1", big: "Z".repeat(70 * 1024) }],
        incomplete: true,
        hint: "Сервер оборвал страницу.",
      },
      "items",
    );
    const incH = liveHarness({
      results: store,
      reply: () =>
        okResult(
          "runtime.query",
          {
            preview: {
              kind: "stored-result",
              items: [],
              incomplete: true,
              hint: "Сервер оборвал страницу.",
            },
            resultId: savedInc.resultId,
          },
          { truncated: true, resultId: savedInc.resultId, resultBytes: savedInc.bytes },
        ),
    });
    assert.equal(
      await runCli(
        ["query", "collaborators", "--all", "--format", "jsonl"],
        incH.io,
        incH.dependencies,
      ),
      1,
    );
    assert.equal(incH.state.stdout, "");
    assert.match(incH.state.stderr, /QUERY_INCOMPLETE/);
    assert.match(incH.state.stderr, /Сервер оборвал страницу/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("logs follow по имени типа переключается на новый файл при ротации (idle и LOG_NOT_FOUND)", async () => {
  const ac = new AbortController();
  let step = 0;
  let currentLatest = "xhttp_2026-11-21.log";
  const h = liveHarness({
    stdoutIsTTY: true,
    color: false,
    signal: ac.signal,
    onSleep: () => {
      if (step >= 4) ac.abort();
    },
    reply: (id, args) => {
      if (id === "logs.list") {
        return okResult("logs.list", {
          files: [{ name: currentLatest, type: "xhttp", sizeBytes: 100 }],
          total: 1,
        });
      }
      if (id === "logs.read") {
        // Симулируем кратковременную занятость при чтении нового файла: цикл перейдёт к logs.follow без курсора.
        return errResult("logs.read", "LOG_READ_UNAVAILABLE", "Файл временно занят.");
      }
      step++;
      if (step === 1) {
        assert.equal(args.file, "xhttp_2026-11-21.log");
        return okResult("logs.follow", {
          file: "xhttp_2026-11-21.log",
          events: [{ sequence: 1, time: "23:59:59", level: "normal", text: "вчера" }],
          cursor: "c-day1",
          changed: true,
          gapPossible: false,
          windowTruncated: false,
        });
      }
      if (step === 2) {
        // Файл перестал меняться, на сервере появился новый дневной файл.
        currentLatest = "xhttp_2026-11-22.log";
        return okResult("logs.follow", {
          file: "xhttp_2026-11-21.log",
          events: [],
          cursor: "c-day1",
          changed: false,
          gapPossible: false,
          windowTruncated: false,
        });
      }
      if (step === 3) {
        // Переключились на новый файл без старого курсора!
        assert.equal(args.file, "xhttp_2026-11-22.log");
        assert.equal(args.cursor, undefined);
        // Имитируем исчезновение 22-го и появление 23-го файла на следующем шаге.
        currentLatest = "xhttp_2026-11-23.log";
        return okResult("logs.follow", {
          file: "xhttp_2026-11-22.log",
          events: [{ sequence: 1, time: "00:00:01", level: "normal", text: "сегодня" }],
          cursor: "c-day2",
          changed: true,
          gapPossible: false,
          windowTruncated: false,
        });
      }
      if (args.file === "xhttp_2026-11-22.log") {
        return errResult("logs.follow", "LOG_NOT_FOUND", "Файл удалён.");
      }
      assert.equal(args.file, "xhttp_2026-11-23.log");
      return okResult("logs.follow", {
        file: "xhttp_2026-11-23.log",
        events: [{ sequence: 1, time: "00:00:02", level: "normal", text: "после удаления" }],
        cursor: "c-day3",
        changed: true,
        gapPossible: false,
        windowTruncated: false,
      });
    },
  });

  assert.equal(await runCli(["logs", "follow", "xhttp"], h.io, h.dependencies), 0);
  assert.match(h.state.stdout, /вчера/);
  assert.match(h.state.stdout, /сегодня/);
  assert.match(h.state.stdout, /после удаления/);
  assert.match(h.state.stderr, /Файл лога: xhttp_2026-11-22\.log/);
  assert.match(h.state.stderr, /Файл лога: xhttp_2026-11-23\.log/);
});

test("logs tail -n при минимальном outputLimitBytes=1024 доходит до нужного окна сверх 144 КиБ", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wtctl-tiny-limit-"));
  try {
    const store = new ResultStore({ ...BASE_CONFIG, runtimeDir: dir, outputLimitBytes: 1024 });
    const twoBig = `12:00:01 [r1] ${"A".repeat(130 * 1024)} #1\n12:00:02 [r2] ${"B".repeat(130 * 1024)} #2\n`;
    const totalBytes = Buffer.byteLength(twoBig, "utf8"); // ~260 КиБ > 144 КиБ
    const savedFull = await store.put({
      file: "xhttp.log",
      text: twoBig,
      sizeBytes: totalBytes,
      tailOnly: false,
      fingerprint: "c".repeat(64),
    });

    const h = liveHarness({
      outputLimitBytes: 1024,
      maxResponseBytes: 8 * 1024 * 1024,
      color: false,
      results: store,
      reply: async (_id, args) => {
        const w = Number(args.tailBytes ?? 0);
        if (w < totalBytes) {
          const slice = twoBig.slice(-w);
          const saved = await store.put({
            file: "xhttp.log",
            text: slice,
            sizeBytes: totalBytes,
            tailOnly: true,
            fingerprint: "d".repeat(64),
          });
          return okResult(
            "logs.read",
            { kind: "stored-result", resultId: saved.resultId },
            { truncated: true, resultId: saved.resultId, resultBytes: saved.bytes },
          );
        }
        return okResult(
          "logs.read",
          { kind: "stored-result", resultId: savedFull.resultId },
          { truncated: true, resultId: savedFull.resultId, resultBytes: savedFull.bytes },
        );
      },
    });

    assert.equal(
      await runCli(
        ["logs", "tail", "xhttp.log", "-n", "2", "--format", "jsonl"],
        h.io,
        h.dependencies,
      ),
      0,
    );
    const items = h.state.stdout
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line) as { text: string });
    assert.equal(items.length, 2);
    assert.match(items[0]!.text, /#1$/);
    assert.match(items[1]!.text, /#2$/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("logs follow выходит по SIGTERM за ограниченное время и вызывает forceExit(0), если runtime.close() ждёт зависший запрос в очереди", async () => {
  const forcedCodes: number[] = [];
  let harnessRef!: ReturnType<typeof liveHarness>;
  harnessRef = liveHarness({
    stdoutIsTTY: true,
    color: false,
    forceExit: (code) => {
      forcedCodes.push(code);
    },
    reply: () =>
      new Promise<OperationResult>(() => {
        queueMicrotask(() => harnessRef.triggerInterrupt());
      }),
  });
  // Имитируем HcmRuntime.close(), зависающий в очереди вслед за незавершённым запросом.
  harnessRef.runtime.close = () => new Promise<void>(() => undefined);

  const started = Date.now();
  const code = await runCli(
    ["logs", "follow", "xhttp.log"],
    harnessRef.io,
    harnessRef.dependencies,
  );
  assert.equal(code, 0);
  assert.ok(Date.now() - started < 2000);
  assert.equal(harnessRef.interruptListenerCount(), 0);
  assert.deepEqual(forcedCodes, [0]);
});

test("logs tail -f при omitted > 0 и смене файла между logs.follow и logs.read сохраняет события из logs.follow и предупреждает об omitted", async () => {
  const initialLines = Array.from(
    { length: 12 },
    (_, i) => `12:00:${String(i).padStart(2, "0")} [r] seed ${i}`,
  );
  const initialText = `${initialLines.join("\n")}\n`;
  const initialFp = createHash("sha256").update(initialText).digest("hex");

  // Симулируем: logs.follow вернул 3 события и omitted: 5, но к моменту дочитывания logs.read
  // файл успел смениться/перезаписаться и стал короче (содержит только 1 новую строку).
  const rotatedText = "12:05:00 [r] fresh-after-reset\n";
  const rotatedFp = createHash("sha256").update(rotatedText).digest("hex");
  const followEvents = [
    { time: "12:01:01", level: "normal", text: "12:01:01 [r] burst-keep-1" },
    { time: "12:01:02", level: "normal", text: "12:01:02 [r] burst-keep-2" },
    { time: "12:01:03", level: "normal", text: "12:01:03 [r] burst-keep-3" },
  ];

  const ac = new AbortController();
  let readCalls = 0;
  let followDone = false;
  const h = liveHarness({
    stdoutIsTTY: false,
    color: false,
    signal: ac.signal,
    onSleep: () => {
      if (followDone) ac.abort();
    },
    reply: (id) => {
      if (id === "logs.read") {
        readCalls++;
        if (readCalls === 1) {
          return okResult("logs.read", {
            file: "xhttp.log",
            text: initialText,
            sizeBytes: Buffer.byteLength(initialText, "utf8"),
            tailOnly: false,
            fingerprint: initialFp,
          });
        }
        return okResult("logs.read", {
          file: "xhttp.log",
          text: rotatedText,
          sizeBytes: Buffer.byteLength(rotatedText, "utf8"),
          tailOnly: false,
          fingerprint: rotatedFp,
        });
      }
      if (id === "logs.follow") {
        followDone = true;
        return okResult("logs.follow", {
          file: "xhttp.log",
          cursor: "cursor-after-burst",
          changed: true,
          events: followEvents,
          omitted: 5,
          gapPossible: false,
        });
      }
      throw new Error(`unexpected ${id}`);
    },
  });

  const code = await runCli(
    ["logs", "tail", "xhttp.log", "-n", "12", "-f", "--format", "jsonl", "--interval", "1"],
    h.io,
    h.dependencies,
  );
  assert.equal(code, 0);
  const items = h.state.stdout
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line) as { text: string });
  assert.equal(items.length, 15);
  assert.match(items[12]!.text, /burst-keep-1$/);
  assert.match(items[13]!.text, /burst-keep-2$/);
  assert.match(items[14]!.text, /burst-keep-3$/);
  assert.match(h.state.stderr, /Пропущено ранних событий: 5/);
});

test("logs follow по типу при ротации на новый файл с >10 событиями выводит все события нового файла без обрезки до 10", async () => {
  const newLines = Array.from(
    { length: 12 },
    (_, i) => `00:00:${String(i).padStart(2, "0")} [r] newday-${i + 1}`,
  );
  const newText = `${newLines.join("\n")}\n`;
  const newFp = createHash("sha256").update(newText).digest("hex");

  const ac = new AbortController();
  let listCalls = 0;
  let followCalls = 0;
  const h = liveHarness({
    stdoutIsTTY: false,
    color: false,
    signal: ac.signal,
    reply: (id, args) => {
      if (id === "logs.list") {
        listCalls++;
        if (listCalls === 1) {
          return okResult("logs.list", {
            files: [{ name: "xhttp_2026_11_21.log", type: "xhttp" }],
          });
        }
        return okResult("logs.list", { files: [{ name: "xhttp_2026_11_22.log", type: "xhttp" }] });
      }
      if (id === "logs.follow") {
        followCalls++;
        if (followCalls === 1) {
          return okResult("logs.follow", {
            file: "xhttp_2026_11_21.log",
            cursor: "c1",
            changed: true,
            events: [{ time: "23:59:59", level: "normal", text: "23:59:59 [r] oldday" }],
          });
        }
        if (followCalls === 2) {
          return okResult("logs.follow", {
            file: "xhttp_2026_11_21.log",
            cursor: "c1",
            changed: false,
            events: [],
          });
        }
        // После чтения нового файла через logs.read follow приходит с уже построенным курсором.
        assert.equal(args.file, "xhttp_2026_11_22.log");
        assert.equal(typeof args.cursor, "string");
        ac.abort();
        return okResult("logs.follow", {
          file: "xhttp_2026_11_22.log",
          cursor: args.cursor,
          changed: false,
          events: [],
        });
      }
      if (id === "logs.read") {
        assert.equal(args.file, "xhttp_2026_11_22.log");
        return okResult("logs.read", {
          file: "xhttp_2026_11_22.log",
          text: newText,
          sizeBytes: Buffer.byteLength(newText, "utf8"),
          tailOnly: false,
          fingerprint: newFp,
        });
      }
      throw new Error(`unexpected ${id}`);
    },
  });

  const code = await runCli(
    ["logs", "follow", "xhttp", "--format", "jsonl", "--interval", "1"],
    h.io,
    h.dependencies,
  );
  assert.equal(code, 0);
  const items = h.state.stdout
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line) as { text: string });
  assert.equal(items.length, 13);
  assert.match(items[0]!.text, /oldday$/);
  assert.match(items[1]!.text, /newday-1$/);
  assert.match(items[12]!.text, /newday-12$/);
});

test("logs tail -n ограничивает расширение по maxResponseBytes и предупреждает в stderr в формате jsonl", async () => {
  // BASE_CONFIG.maxResponseBytes = 1 MiB → maxLogTailBytes = Math.floor((1048576 - 512) / 6) = 174677.
  const expectedCap = Math.floor((1024 * 1024 - 512) / 6);
  const requestedTailBytes: number[] = [];
  const sampleText = "12:00:01 [r] one\n12:00:02 [r] two\n";
  const h = liveHarness({
    stdoutIsTTY: false,
    color: false,
    maxResponseBytes: 1024 * 1024,
    reply: (_id, args) => {
      const tb = Number(args.tailBytes ?? 0);
      requestedTailBytes.push(tb);
      assert.ok(tb <= expectedCap, `tailBytes ${tb} превысил лимит ${expectedCap}`);
      return okResult("logs.read", {
        file: "xhttp.log",
        text: sampleText,
        sizeBytes: 5 * 1024 * 1024,
        tailOnly: true,
        fingerprint: "f".repeat(64),
      });
    },
  });

  const code = await runCli(
    ["logs", "tail", "xhttp.log", "-n", "50", "--format", "jsonl"],
    h.io,
    h.dependencies,
  );
  assert.equal(code, 0);
  assert.ok(requestedTailBytes.includes(expectedCap));
  const items = h.state.stdout
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line) as { text: string });
  assert.equal(items.length, 2);
  assert.match(h.state.stderr, /Показан конец файла xhttp\.log \(2 из запрошенных 50 событий/);
  assert.match(h.state.stderr, /прочитано не больше 171 КиБ с конца файла/);
});

test("logs tail -f при перезаписи файла с сохранением старого якоря и чужими событиями не теряет пачку из logs.follow", async () => {
  const initialLines = Array.from(
    { length: 12 },
    (_, i) => `12:00:${String(i).padStart(2, "0")} [r] anchor-${i}`,
  );
  const initialText = `${initialLines.join("\n")}\n`;
  const initialFp = createHash("sha256").update(initialText).digest("hex");

  // Файл сохранил старый якорь, но после него появились 4 посторонние строки вместо 3 событий из logs.follow.
  const rewrittenLines = [
    ...initialLines,
    "12:02:01 [r] foreign-1",
    "12:02:02 [r] foreign-2",
    "12:02:03 [r] foreign-3",
    "12:02:04 [r] foreign-4",
  ];
  const rewrittenText = `${rewrittenLines.join("\n")}\n`;
  const rewrittenFp = createHash("sha256").update(rewrittenText).digest("hex");

  const followEvents = [
    { time: "12:01:01", context: "r", level: "normal", text: "12:01:01 [r] keep-1" },
    { time: "12:01:02", context: "r", level: "normal", text: "12:01:02 [r] keep-2" },
    { time: "12:01:03", context: "r", level: "normal", text: "12:01:03 [r] keep-3" },
  ];

  const ac = new AbortController();
  let readCalls = 0;
  let followDone = false;
  const h = liveHarness({
    stdoutIsTTY: false,
    color: false,
    signal: ac.signal,
    onSleep: () => {
      if (followDone) ac.abort();
    },
    reply: (id) => {
      if (id === "logs.read") {
        readCalls++;
        if (readCalls === 1) {
          return okResult("logs.read", {
            file: "xhttp.log",
            text: initialText,
            sizeBytes: Buffer.byteLength(initialText, "utf8"),
            tailOnly: false,
            fingerprint: initialFp,
          });
        }
        return okResult("logs.read", {
          file: "xhttp.log",
          text: rewrittenText,
          sizeBytes: Buffer.byteLength(rewrittenText, "utf8"),
          tailOnly: false,
          fingerprint: rewrittenFp,
        });
      }
      if (id === "logs.follow") {
        followDone = true;
        return okResult("logs.follow", {
          file: "xhttp.log",
          cursor: "cursor-follow",
          changed: true,
          events: followEvents,
          omitted: 4,
          gapPossible: false,
        });
      }
      throw new Error(`unexpected ${id}`);
    },
  });

  const code = await runCli(
    ["logs", "tail", "xhttp.log", "-n", "12", "-f", "--format", "jsonl", "--interval", "1"],
    h.io,
    h.dependencies,
  );
  assert.equal(code, 0);
  const items = h.state.stdout
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line) as { text: string });
  assert.equal(items.length, 15);
  assert.match(items[12]!.text, /keep-1$/);
  assert.match(items[13]!.text, /keep-2$/);
  assert.match(items[14]!.text, /keep-3$/);
  assert.doesNotMatch(h.state.stdout, /foreign-/);
  assert.match(h.state.stderr, /Пропущено ранних событий: 4/);
});

test("logs follow при SIGTERM во время зависшего logs.list после LOG_NOT_FOUND выходит с кодом 0 и без ошибки", async () => {
  const forcedCodes: number[] = [];
  let listCalls = 0;
  let harnessRef!: ReturnType<typeof liveHarness>;
  harnessRef = liveHarness({
    stdoutIsTTY: true,
    color: false,
    forceExit: (code) => {
      forcedCodes.push(code);
    },
    reply: (id) => {
      if (id === "logs.list") {
        listCalls++;
        if (listCalls === 1) {
          return okResult("logs.list", {
            files: [{ name: "xhttp_2026-11-21.log", type: "xhttp", sizeBytes: 100 }],
          });
        }
        return new Promise<OperationResult>(() => {
          queueMicrotask(() => harnessRef.triggerInterrupt());
        });
      }
      if (id === "logs.follow") {
        return errResult("logs.follow", "LOG_NOT_FOUND", "Файл удалён.");
      }
      throw new Error(`unexpected ${id}`);
    },
  });
  harnessRef.runtime.close = () => new Promise<void>(() => undefined);

  const code = await runCli(["logs", "follow", "xhttp"], harnessRef.io, harnessRef.dependencies);
  assert.equal(code, 0);
  assert.deepEqual(forcedCodes, [0]);
  assert.doesNotMatch(harnessRef.state.stderr, /LOG_NOT_FOUND|Ошибка/);
});

test("query --all в json/table соблюдает outputLimitBytes (код 3 + ResultStore), а --json --output пишет файл потоково", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wtctl-qall-limit-"));
  try {
    const config: ConnectionConfig = {
      ...BASE_CONFIG,
      outputLimitBytes: 1024,
      runtimeDir: dir,
    };
    const store = new ResultStore(config);
    const makePages = (id: string, args: Record<string, unknown>): OperationResult => {
      assert.equal(id, "runtime.query");
      const start = Number(args.startPosition ?? 0);
      const total = 30;
      const items = Array.from({ length: Math.min(10, total - start) }, (_, i) => ({
        id: `0x${(start + i + 1).toString(16)}`,
        fullname: `Сотрудник номер ${start + i + 1} ${"Д".repeat(80)}`,
      }));
      return okResult("runtime.query", {
        items,
        total,
        ...(start + items.length < total ? { nextStartPosition: start + items.length } : {}),
      });
    };

    // 1. --all --json без --output при превышении 1 КиБ: код 3, ответ <= 1024 байт и resultId в ResultStore.
    const jsonLimit = liveHarness({
      outputLimitBytes: 1024,
      results: store,
      reply: makePages,
    });
    assert.equal(
      await runCli(
        ["query", "collaborators", "--all", "--page-size", "10", "--json"],
        jsonLimit.io,
        jsonLimit.dependencies,
      ),
      3,
    );
    const parsed = JSON.parse(jsonLimit.state.stdout);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.meta.truncated, true);
    assert.equal(typeof parsed.meta.resultId, "string");
    assert.ok(
      Buffer.byteLength(jsonLimit.state.stdout.trimEnd(), "utf8") <= 1024,
      `ожидалось <= 1024 байт, получено ${Buffer.byteLength(jsonLimit.state.stdout.trimEnd(), "utf8")}`,
    );
    const storedPage = await store.read(parsed.meta.resultId, 0, 50);
    assert.equal(storedPage.total, 30);

    // 1a. Ответ с итоговым JSON ~900 байт (<= 1024 байт) не обрезается и даёт код 0.
    const smallFit = liveHarness({
      outputLimitBytes: 1024,
      results: store,
      reply: () =>
        okResult("runtime.query", {
          items: Array.from({ length: 10 }, (_, i) => ({
            id: `0x${i + 1}`,
            fullname: `Сотрудник ${i + 1} ${"A".repeat(30)}`,
          })),
          total: 10,
        }),
    });
    assert.equal(
      await runCli(
        ["query", "collaborators", "--all", "--page-size", "10", "--json"],
        smallFit.io,
        smallFit.dependencies,
      ),
      0,
    );
    assert.ok(Buffer.byteLength(smallFit.state.stdout, "utf8") <= 1024);
    assert.equal(JSON.parse(smallFit.state.stdout).data.items.length, 10);

    // 1b. Крупная первая строка не пропускается ради включения второй строки в preview.
    const bigFirst = liveHarness({
      outputLimitBytes: 1024,
      results: store,
      reply: () =>
        okResult("runtime.query", {
          items: [
            { id: "0x1", fullname: "X".repeat(1500) },
            { id: "0x2", fullname: "маленькая" },
          ],
          total: 2,
        }),
    });
    assert.equal(
      await runCli(
        ["query", "collaborators", "--all", "--page-size", "10", "--json"],
        bigFirst.io,
        bigFirst.dependencies,
      ),
      3,
    );
    assert.deepEqual(JSON.parse(bigFirst.state.stdout).data.preview.items, []);

    // 2. --all --json --output out.json: потоковая запись (включая сохранённую строку > 8 МиБ) и код 0.
    const outPath = join(dir, "all.json");
    const jsonFile = liveHarness({
      outputLimitBytes: 1024,
      results: store,
      openTextWriter: openAtomicTextWriter,
      reply: makePages,
    });
    assert.equal(
      await runCli(
        ["query", "collaborators", "--all", "--page-size", "10", "--json", "--output", outPath],
        jsonFile.io,
        jsonFile.dependencies,
      ),
      0,
    );
    const receipt = JSON.parse(jsonFile.state.stdout);
    assert.equal(receipt.data.saved, true);
    const fullSaved = JSON.parse(await readFile(outPath, "utf8"));
    assert.equal(fullSaved.ok, true);
    assert.equal(fullSaved.data.items.length, 30);
    assert.equal(fullSaved.data.total, 30);

    const hugeSaver = await store.openListSaver("items");
    await hugeSaver.writeItem({ id: "0x1", body: "Z".repeat(9 * 1024 * 1024) });
    const hugeStored = await hugeSaver.commit({ total: 1 });
    const hugeOut = join(dir, "huge.json");
    const hugeJsonFile = liveHarness({
      outputLimitBytes: 1024,
      results: store,
      openTextWriter: openAtomicTextWriter,
      reply: () =>
        okResult(
          "runtime.query",
          { preview: { items: [] }, resultId: hugeStored.resultId },
          { truncated: true, resultId: hugeStored.resultId, resultBytes: hugeStored.bytes },
        ),
    });
    assert.equal(
      await runCli(
        ["query", "collaborators", "--all", "--json", "--output", hugeOut],
        hugeJsonFile.io,
        hugeJsonFile.dependencies,
      ),
      0,
    );
    const hugeParsed = JSON.parse(await readFile(hugeOut, "utf8"));
    assert.equal(hugeParsed.data.items[0].body.length, 9 * 1024 * 1024);

    // 2b. Та же сохранённая строка > 8 МиБ БЕЗ --output: код 3 с resultId и полными данными в ResultStore.
    const hugeNoOut = liveHarness({
      outputLimitBytes: 1024,
      results: store,
      reply: () =>
        okResult(
          "runtime.query",
          { preview: { items: [] }, resultId: hugeStored.resultId },
          { truncated: true, resultId: hugeStored.resultId, resultBytes: hugeStored.bytes },
        ),
    });
    assert.equal(
      await runCli(
        ["query", "collaborators", "--all", "--json"],
        hugeNoOut.io,
        hugeNoOut.dependencies,
      ),
      3,
    );
    const hugeReply = JSON.parse(hugeNoOut.state.stdout);
    assert.equal(hugeReply.meta.truncated, true);
    assert.ok(Buffer.byteLength(hugeNoOut.state.stdout.trimEnd(), "utf8") <= 1024);
    const exportedHuge = join(dir, "huge-exported.jsonl");
    await store.export({ resultId: hugeReply.meta.resultId, path: exportedHuge, format: "jsonl" });
    assert.equal(JSON.parse(await readFile(exportedHuge, "utf8")).body.length, 9 * 1024 * 1024);

    // 2c. 12 и 64 unknownFields (и граничный полный ответ в TTY с отступами) при лимите 1 КиБ: всегда <= 1024 байт.
    for (const stdoutIsTTY of [false, true]) {
      for (const unknownCount of [12, 64]) {
        const manyUnknown = liveHarness({
          stdoutIsTTY,
          outputLimitBytes: 1024,
          results: store,
          reply: () =>
            okResult("runtime.query", {
              items: [{ id: "0x1", fullname: "A".repeat(1200) }],
              total: 1,
              unknownFields: Array.from(
                { length: unknownCount },
                (_, i) => `unknown_field_name_${i}`,
              ),
            }),
        });
        assert.equal(
          await runCli(
            ["query", "collaborators", "--all", "--json"],
            manyUnknown.io,
            manyUnknown.dependencies,
          ),
          3,
        );
        assert.ok(
          Buffer.byteLength(manyUnknown.state.stdout, "utf8") <= 1024,
          `ожидалось <= 1024 байт (TTY=${stdoutIsTTY}, unknown=${unknownCount}), получено ${Buffer.byteLength(manyUnknown.state.stdout, "utf8")}`,
        );
      }
    }

    // 2d. Полный ответ, который в компактном JSON <= 1024 Б, но в TTY с отступами > 1024 Б:
    // в pipe возвращает 0, а в TTY обрезается с кодом 3 и укладывается в 1024 Б.
    const prettyItems = Array.from({ length: 16 }, (_, i) => ({
      id: `0x${i + 1}`,
      fullname: `User ${i + 1}`,
    }));
    const compactFit = liveHarness({
      stdoutIsTTY: false,
      outputLimitBytes: 1024,
      results: store,
      reply: () => okResult("runtime.query", { items: prettyItems, total: prettyItems.length }),
    });
    assert.equal(
      await runCli(
        ["query", "collaborators", "--all", "--json"],
        compactFit.io,
        compactFit.dependencies,
      ),
      0,
    );
    assert.ok(Buffer.byteLength(compactFit.state.stdout, "utf8") <= 1024);

    const prettyOverflow = liveHarness({
      stdoutIsTTY: true,
      outputLimitBytes: 1024,
      results: store,
      reply: () => okResult("runtime.query", { items: prettyItems, total: prettyItems.length }),
    });
    assert.equal(
      await runCli(
        ["query", "collaborators", "--all", "--json"],
        prettyOverflow.io,
        prettyOverflow.dependencies,
      ),
      3,
    );
    assert.ok(
      Buffer.byteLength(prettyOverflow.state.stdout, "utf8") <= 1024,
      `ожидалось <= 1024 байт в TTY, получено ${Buffer.byteLength(prettyOverflow.state.stdout, "utf8")}`,
    );

    // 2e. Табличный вывод (--format table в pipe/TTY и auto в TTY), где JSON <= 1024 Б,
    // но таблица с выравниванием > 1024 Б: код 3, stdout <= 1024 Б и все 25 строк в ResultStore.
    const tableItems = Array.from({ length: 25 }, (_, i) => ({
      id: `0x${i + 1}`,
      code: `u${i + 1}`,
      name: `User ${i + 1}`,
    }));
    for (const variant of [
      { stdoutIsTTY: false, argv: ["query", "collaborators", "--all", "--format", "table"] },
      { stdoutIsTTY: true, argv: ["query", "collaborators", "--all", "--format", "table"] },
      { stdoutIsTTY: true, argv: ["query", "collaborators", "--all"] },
    ]) {
      const tableOverflow = liveHarness({
        stdoutIsTTY: variant.stdoutIsTTY,
        outputLimitBytes: 1024,
        results: store,
        reply: () => okResult("runtime.query", { items: tableItems, total: tableItems.length }),
      });
      assert.equal(await runCli(variant.argv, tableOverflow.io, tableOverflow.dependencies), 3);
      assert.ok(
        Buffer.byteLength(tableOverflow.state.stdout, "utf8") <= 1024,
        `ожидалось <= 1024 байт (${variant.argv.join(" ")}, TTY=${variant.stdoutIsTTY}), получено ${Buffer.byteLength(tableOverflow.state.stdout, "utf8")}`,
      );
      const idMatch = stripAnsi(tableOverflow.state.stdout).match(/resultId:\s*(\S+)/);
      assert.ok(idMatch?.[1], "в табличной сводке должен быть resultId");
      const savedTable = await store.read(idMatch[1], 0, 50);
      assert.equal(savedTable.total, 25);
    }

    // 3. logs follow --format table --interval 1 работает в человеческом потоковом режиме.
    let tableFollowRef!: ReturnType<typeof liveHarness>;
    tableFollowRef = liveHarness({
      stdoutIsTTY: false,
      color: false,
      onSleep: async () => {
        tableFollowRef.triggerInterrupt();
      },
      reply: (id) => {
        assert.equal(id, "logs.follow");
        return okResult("logs.follow", {
          file: "xhttp.log",
          cursor: "c-1",
          events: [{ sequence: 1, time: "10:00:00", level: "info", text: "10:00:00 ok" }],
        });
      },
    });
    assert.equal(
      await runCli(
        ["logs", "follow", "xhttp.log", "--format", "table", "--interval", "1"],
        tableFollowRef.io,
        tableFollowRef.dependencies,
      ),
      0,
    );
    assert.match(tableFollowRef.state.stdout, /10:00:00/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
