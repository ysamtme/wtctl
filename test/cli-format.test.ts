import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfigWithDefaults } from "../src/config.js";
import { runCli } from "../src/cli/run.js";
import { displayWidth, renderTable } from "../src/cli/format/table.js";
import { envColor, resolveColor, stripAnsi } from "../src/cli/format/ansi.js";
import { nodeIo } from "../src/cli/node-io.js";
import { formatTsv } from "../src/cli/format/csv.js";
import { ResultStore } from "../src/results.js";
import type { CliDependencies, CliIo, RuntimePort } from "../src/cli/types.js";
import type { ConnectionConfig, OperationResult } from "../src/contracts.js";
import { VERSION } from "../src/version.js";
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

interface HarnessOptions {
  stdoutIsTTY?: boolean;
  stderrIsTTY?: boolean;
  columns?: number;
  color?: boolean;
  fileInput?: string;
  results?: RuntimePort["results"];
  failClose?: boolean;
  reply?: (id: string, args: Record<string, unknown>) => OperationResult | Promise<OperationResult>;
}

function harness(options: HarnessOptions = {}) {
  const state = {
    stdout: "",
    stderr: "",
    binaryOut: [] as Uint8Array[],
    files: new Map<string, string>(),
    binaryFiles: new Map<string, Uint8Array>(),
    calls: [] as { id: string; args: Record<string, unknown> }[],
    loadOptions: [] as {
      configPath?: string;
      connection?: string;
      password?: string;
      defaultOutputLimitBytes?: number;
    }[],
  };
  const io: CliIo = {
    ...(options.stdoutIsTTY === undefined ? {} : { stdoutIsTTY: options.stdoutIsTTY }),
    ...(options.stderrIsTTY === undefined ? {} : { stderrIsTTY: options.stderrIsTTY }),
    ...(options.columns === undefined ? {} : { columns: options.columns }),
    ...(options.color === undefined ? {} : { color: options.color }),
    pretty: options.stdoutIsTTY === true,
    writeOut: (text) => {
      state.stdout += text;
    },
    writeBinaryOut: (bytes) => {
      state.binaryOut.push(bytes);
    },
    writeError: (text) => {
      state.stderr += text;
    },
    readFile: async () => options.fileInput ?? "{}",
    readStdin: async () => options.fileInput ?? "{}",
    readBinaryFile: async () => Buffer.from(options.fileInput ?? "", "utf8"),
    readBinaryStdin: async () => Buffer.from(options.fileInput ?? "", "utf8"),
    writeFile: async (path, text) => {
      state.files.set(path, text);
    },
    writeBinaryFile: async (path, bytes) => {
      state.binaryFiles.set(path, bytes);
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
      state.calls.push({ id, args });
      if (options.reply) return options.reply(id, args);
      return {
        ok: true,
        data: args,
        meta: { operationId: id, connection: BASE_CONFIG.name, durationMs: 12 },
      };
    },
    close: async () => {
      if (options.failClose) throw new Error("close failed");
    },
  };
  const dependencies: CliDependencies = {
    loadConfiguration: (loadOpts) => {
      state.loadOptions.push(loadOpts);
      return {
        ...BASE_CONFIG,
        outputLimitBytes: loadOpts.defaultOutputLimitBytes ?? BASE_CONFIG.outputLimitBytes,
      };
    },
    createRuntime: () => runtime,
    runMcp: async () => undefined,
  };
  return { state, io, runtime, dependencies };
}

function okResult(
  operationId: string,
  data: unknown,
  extraMeta: Record<string, unknown> = {},
): OperationResult {
  return {
    ok: true,
    data,
    meta: { operationId, connection: "stand", durationMs: 42, ...extraMeta },
  };
}

async function withEnv(
  vars: Record<string, string | undefined>,
  fn: () => Promise<void> | void,
): Promise<void> {
  const saved = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(vars)) {
    saved.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("автовыбор формата по TTY/pipe, --json, --format, WTCTL_FORMAT и локальный --format у result", async () => {
  const statusData = {
    connection: "stand",
    baseUrl: "http://hcm.invalid/",
    version: "2025.1.1171",
    database: "mssql",
    userId: "0x1",
    operationCount: 128,
    permissions: { write: false, execute: true },
  };

  // В pipe при auto — компактный JSON; в TTY при auto — человеческая сводка; с --json в TTY — JSON.
  const pipe = harness({ stdoutIsTTY: false, reply: () => okResult("runtime.status", statusData) });
  assert.equal(await runCli(["status"], pipe.io, pipe.dependencies), 0);
  assert.equal(JSON.parse(pipe.state.stdout).data.version, "2025.1.1171");

  const tty = harness({
    stdoutIsTTY: true,
    color: false,
    reply: () => okResult("runtime.status", statusData),
  });
  assert.equal(await runCli(["status"], tty.io, tty.dependencies), 0);
  assert.match(tty.state.stdout, /Подключение:\s+stand/);
  assert.match(tty.state.stdout, /Версия:\s+2025\.1\.1171/);
  assert.match(tty.state.stdout, /Права:\s+read, execute/);

  const ttyJson = harness({
    stdoutIsTTY: true,
    reply: () => okResult("runtime.status", statusData),
  });
  assert.equal(await runCli(["status", "--json"], ttyJson.io, ttyJson.dependencies), 0);
  assert.equal(JSON.parse(ttyJson.state.stdout).ok, true);

  // WTCTL_FORMAT перекрывает auto, а явный --format сильнее WTCTL_FORMAT.
  await withEnv({ WTCTL_FORMAT: "table" }, async () => {
    const fromEnv = harness({
      stdoutIsTTY: false,
      color: false,
      reply: () => okResult("runtime.status", statusData),
    });
    assert.equal(await runCli(["status"], fromEnv.io, fromEnv.dependencies), 0);
    assert.match(fromEnv.state.stdout, /Версия:\s+2025\.1\.1171/);

    const overridden = harness({
      stdoutIsTTY: false,
      reply: () => okResult("runtime.status", statusData),
    });
    assert.equal(
      await runCli(["status", "--format", "raw"], overridden.io, overridden.dependencies),
      0,
    );
    assert.equal(overridden.state.stdout, "2025.1.1171\n");
  });

  // Конфликт --json и --format отклоняется до сети, а неверные значения дают код 2.
  const conflict = harness({ stdoutIsTTY: true, color: false });
  assert.equal(
    await runCli(["status", "--json", "--format", "table"], conflict.io, conflict.dependencies),
    2,
  );
  assert.equal(conflict.state.calls.length, 0);
  assert.match(conflict.state.stderr, /Нужно выбрать --json или --format, а не оба/);

  const badFlag = harness({ stdoutIsTTY: true, color: false });
  assert.equal(await runCli(["status", "--format", "xml"], badFlag.io, badFlag.dependencies), 2);
  assert.match(badFlag.state.stderr, /Ошибка \[cli\.invalid_input\]/);

  await withEnv({ WTCTL_FORMAT: "xml" }, async () => {
    const badEnv = harness({ stdoutIsTTY: false });
    assert.equal(await runCli(["status"], badEnv.io, badEnv.dependencies), 2);
    assert.equal(JSON.parse(badEnv.state.stderr).error.code, "cli.invalid_input");
  });

  // Локальный --format у result read и result export совместим с --json и передаётся в операцию.
  const readRes = harness({
    stdoutIsTTY: true,
    reply: (id, args) => okResult(id, { text: "строка", format: "text", totalChars: 6, args }),
  });
  assert.equal(
    await runCli(
      ["result", "read", "r-1", "--format", "text", "--json"],
      readRes.io,
      readRes.dependencies,
    ),
    0,
  );
  assert.deepEqual(readRes.state.calls[0], {
    id: "results.read",
    args: { resultId: "r-1", format: "text" },
  });
  assert.equal(JSON.parse(readRes.state.stdout).ok, true);

  const exportRes = harness({
    stdoutIsTTY: true,
    reply: (id) => okResult(id, { path: "out.jsonl", bytes: 42, format: "jsonl", items: 2 }),
  });
  assert.equal(
    await runCli(
      ["result", "export", "r-1", "--to", "out.jsonl", "--format", "jsonl", "--json"],
      exportRes.io,
      exportRes.dependencies,
    ),
    0,
  );
  assert.deepEqual(exportRes.state.calls[0], {
    id: "results.export",
    args: { resultId: "r-1", path: "out.jsonl", overwrite: false, format: "jsonl" },
  });
  assert.equal(JSON.parse(exportRes.state.stdout).data.items, 2);

  // result read --format text --help не ломается о глобальный валидатор --format.
  const resultHelp = harness({ stdoutIsTTY: true });
  assert.equal(
    await runCli(
      ["result", "read", "r-1", "--format", "text", "--help"],
      resultHelp.io,
      resultHelp.dependencies,
    ),
    0,
  );
  assert.match(resultHelp.state.stdout, /^wtctl result read — /);
});

test("табличный, CSV/TSV, JSONL и raw рендеры для query, подгонка ширины и отказ CSV на нетабличной команде", async () => {
  const queryData = {
    items: [
      { id: "0x1", fullname: 'Иванов, "Иван" Иванович', extra: { dept: "IT" } },
      { id: "0x2", fullname: "Петров\nПётр", extra: ["a", "b"] },
    ],
    total: 10,
    nextStartPosition: 2,
    incomplete: true,
    unknownFields: ["bad_col"],
    hint: "Полей из unknownFields нет в строке каталога.",
  };

  // Таблица с сохранением порядка столбцов, подвалом пагинации и предупреждениями.
  const tbl = harness({
    stdoutIsTTY: true,
    color: false,
    columns: 60,
    reply: () => okResult("runtime.query", queryData),
  });
  assert.equal(await runCli(["query", "--catalog", "collaborators"], tbl.io, tbl.dependencies), 0);
  const tblLines = tbl.state.stdout.trimEnd().split("\n");
  assert.match(tblLines[0]!, /^id\s+fullname\s+extra$/);
  assert.match(tblLines[1]!, /^─+\s+─+\s+─+$/);
  // Строки таблицы уложены в columns=60 с учётом кириллицы.
  for (const line of tblLines.slice(0, 4)) assert.ok(displayWidth(line) <= 60, line);
  assert.match(tbl.state.stdout, /Показано 2 из 10 · далее: --start-position 2/);
  assert.match(tbl.state.stdout, /неизвестные поля каталога: bad_col/);
  assert.match(tbl.state.stdout, /неполный ответ/);

  // RFC 4180 CSV: экранирование запятых, кавычек, переводов строк и компактный JSON для структур.
  const csv = harness({ reply: () => okResult("runtime.query", queryData) });
  assert.equal(
    await runCli(
      ["query", "--catalog", "collaborators", "--format", "csv"],
      csv.io,
      csv.dependencies,
    ),
    0,
  );
  assert.equal(
    csv.state.stdout,
    [
      "id,fullname,extra",
      '0x1,"Иванов, ""Иван"" Иванович","{""dept"":""IT""}"',
      '0x2,"Петров\nПётр","[""a"",""b""]"',
      "",
    ].join("\n"),
  );

  // TSV и JSONL (без обёртки {ok, data, meta}).
  const tsv = harness({ reply: () => okResult("runtime.query", queryData) });
  assert.equal(
    await runCli(
      ["query", "--catalog", "collaborators", "--format", "tsv"],
      tsv.io,
      tsv.dependencies,
    ),
    0,
  );
  assert.equal(tsv.state.stdout.split("\n")[1], '0x1\tИванов, "Иван" Иванович\t{"dept":"IT"}');

  const jsonl = harness({ reply: () => okResult("runtime.query", queryData) });
  assert.equal(
    await runCli(
      ["query", "--catalog", "collaborators", "--format", "jsonl"],
      jsonl.io,
      jsonl.dependencies,
    ),
    0,
  );
  const parsedLines = jsonl.state.stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(parsedLines.length, 2);
  assert.equal(parsedLines[0].id, "0x1");
  assert.equal(parsedLines[0].ok, undefined);

  // raw: одно поле → по значению на строку; несколько → через \t.
  const rawOne = harness({
    reply: () => okResult("runtime.query", { items: [{ id: "0x1" }, { id: "0x2" }], total: 2 }),
  });
  assert.equal(
    await runCli(
      ["query", "--catalog", "collaborators", "-f", "id", "--format", "raw"],
      rawOne.io,
      rawOne.dependencies,
    ),
    0,
  );
  assert.equal(rawOne.state.stdout, "0x1\n0x2\n");

  const rawMany = harness({
    reply: () =>
      okResult("runtime.query", {
        items: [{ id: "0x1", login: "admin" }],
        total: 1,
      }),
  });
  assert.equal(
    await runCli(
      ["query", "--catalog", "collaborators", "--format", "raw"],
      rawMany.io,
      rawMany.dependencies,
    ),
    0,
  );
  assert.equal(rawMany.state.stdout, "0x1\tadmin\n");

  // CSV на нетабличной команде → CliInputError (код 2).
  const badCsv = harness({
    color: false,
    reply: () => okResult("runtime.status", { version: "2025.1.1171" }),
  });
  assert.equal(await runCli(["status", "--format", "csv"], badCsv.io, badCsv.dependencies), 2);
  assert.equal(badCsv.state.stdout, "");
  assert.match(badCsv.state.stderr, /не является таблицей/);

  // Ширина таблицы корректно учитывает ANSI-коды и кириллицу.
  const ansiRendered = renderTable(
    [{ header: "Имя" }, { header: "Значение" }],
    [["\x1b[36mКириллица\x1b[39m", "очень длинная строка текста"]],
    { maxWidth: 24 },
  );
  for (const line of ansiRendered.split("\n")) {
    assert.ok(displayWidth(line) <= 24, stripAnsi(line));
  }
});

test("рендереры check, object get/patch, files read, logs, rpc describe, doc get, config list и exec", async () => {
  // check: чеклист ✓ / ✗ / − и код выхода 1 при сбое шага.
  const chk = harness({
    stdoutIsTTY: true,
    color: false,
    reply: () => ({
      ok: false,
      data: {
        version: "2025.1.1171",
        language: "ru",
        permissions: { write: false, execute: false },
        checks: [
          { name: "login", result: "ok" },
          { name: "portal", result: "failed", reason: "HTTP 500" },
          { name: "execute", result: "skipped", reason: "право не включено" },
        ],
        summary: { ok: 1, failed: 1, skipped: 1 },
      },
      error: { code: "CHECK_FAILED", message: "Проверка подключения не пройдена: portal." },
      meta: { operationId: "runtime.check", connection: "stand", durationMs: 320 },
    }),
  });
  assert.equal(await runCli(["check"], chk.io, chk.dependencies), 1);
  assert.match(chk.state.stdout, /✓ login/);
  assert.match(chk.state.stdout, /✗ portal — HTTP 500/);
  assert.match(chk.state.stdout, /− execute — право не включено/);
  assert.match(chk.state.stdout, /1 пройдено, 1 с ошибкой, 1 пропущено \(320 мс\)/);

  // object get: карточка с (из каталога), emptyFields и unknownFields.
  const obj = harness({
    stdoutIsTTY: true,
    color: false,
    reply: () =>
      okResult("objects.get", {
        id: "0x1",
        type: "collaborator",
        url: "x-local://wt_data/objects/01.xml",
        data: { login: "admin", lastname: "Иванов" },
        fromCatalog: { fullname: "Иванов Иван" },
        emptyFields: ["email"],
        unknownFields: ["ghost"],
        fingerprint: "sha-abc",
      }),
  });
  assert.equal(
    await runCli(["object", "get", "0x1", "-f", "login,fullname"], obj.io, obj.dependencies),
    0,
  );
  assert.match(obj.state.stdout, /collaborator · 0x1/);
  assert.match(obj.state.stdout, /fullname: Иванов Иван \(из каталога\)/);
  assert.match(obj.state.stdout, /Пустые поля: email/);
  assert.match(obj.state.stdout, /Неизвестные поля: ghost/);

  // object patch --preview: цветной diff с serverFilled.
  const patch = harness({
    stdoutIsTTY: true,
    color: true,
    reply: () =>
      okResult("objects.patch", {
        preview: true,
        noop: false,
        changes: [
          { op: "set", path: "lastname", before: "Старое", after: "Новое" },
          { op: "remove", path: "comment", before: "Лишнее" },
        ],
        fingerprint: "sha-1",
        serverFilled: ["position_name"],
      }),
  });
  assert.equal(
    await runCli(
      ["object", "patch", "0x1", "--args", '{"lastname":"Новое"}', "--preview"],
      patch.io,
      patch.dependencies,
    ),
    0,
  );
  assert.match(patch.state.stdout, /\x1b\[31m- lastname: Старое\x1b\[39m/);
  assert.match(patch.state.stdout, /\x1b\[32m\+ lastname: Новое\x1b\[39m/);
  assert.match(patch.state.stdout, /\x1b\[31m- comment: Лишнее\x1b\[39m/);
  assert.match(stripAnsi(patch.state.stdout), /serverFilled|сервер заполняет.*position_name/i);

  // files read: живой текст, двоичный в human и сырые байты в --format raw.
  const txtFile = harness({
    stdoutIsTTY: true,
    color: false,
    reply: () => okResult("files.read", { text: "строка 1\nстрока 2\n", bytes: 29 }),
  });
  assert.equal(
    await runCli(["files", "read", "x-local://wt/web/a.txt"], txtFile.io, txtFile.dependencies),
    0,
  );
  assert.equal(txtFile.state.stdout, "строка 1\nстрока 2\n");

  const binBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
  const binHuman = harness({
    stdoutIsTTY: true,
    color: false,
    reply: () =>
      okResult("files.read", { base64: binBytes.toString("base64"), bytes: binBytes.length }),
  });
  assert.equal(
    await runCli(["files", "read", "x-local://share/pic.png"], binHuman.io, binHuman.dependencies),
    0,
  );
  assert.match(binHuman.state.stdout, /Двоичный файл: 6 Б/);
  assert.match(binHuman.state.stdout, /--to ФАЙЛ/);

  const binRaw = harness({
    reply: () =>
      okResult("files.read", { base64: binBytes.toString("base64"), bytes: binBytes.length }),
  });
  assert.equal(
    await runCli(
      ["files", "read", "x-local://share/pic.png", "--format", "raw"],
      binRaw.io,
      binRaw.dependencies,
    ),
    0,
  );
  assert.equal(binRaw.state.stdout, "");
  assert.equal(binRaw.state.binaryOut.length, 1);
  assert.deepEqual(Buffer.from(binRaw.state.binaryOut[0]!), binBytes);

  // logs list: человеческий размер в human и sizeBytes в CSV.
  const logsListData = {
    files: [{ name: "xhttp_2026-11-22.log", type: "xhttp", date: "2026-11-22", sizeBytes: 2048 }],
    total: 1,
  };
  const logsHuman = harness({
    stdoutIsTTY: true,
    color: false,
    reply: () => okResult("logs.list", logsListData),
  });
  assert.equal(await runCli(["logs", "list"], logsHuman.io, logsHuman.dependencies), 0);
  assert.match(logsHuman.state.stdout, /2 КиБ/);

  const logsCsv = harness({ reply: () => okResult("logs.list", logsListData) });
  assert.equal(
    await runCli(["logs", "list", "--format", "csv"], logsCsv.io, logsCsv.dependencies),
    0,
  );
  assert.equal(
    logsCsv.state.stdout,
    "name,type,date,sizeBytes\nxhttp_2026-11-22.log,xhttp,2026-11-22,2048\n",
  );

  // logs read: живые переносы, пометка tailOnly в stderr, тишина при -q.
  const logRead = harness({
    stdoutIsTTY: true,
    color: false,
    reply: () =>
      okResult("logs.read", {
        file: "xhttp.log",
        text: "10:00:00 [r1] первая\n10:00:01 [r2] вторая\n",
        sizeBytes: 4096,
        tailOnly: true,
        fingerprint: "fp",
      }),
  });
  assert.equal(await runCli(["logs", "tail", "xhttp.log"], logRead.io, logRead.dependencies), 0);
  assert.equal(logRead.state.stdout, "10:00:00 [r1] первая\n10:00:01 [r2] вторая\n");
  assert.match(logRead.state.stderr, /Показан конец файла xhttp\.log/);

  const logQuiet = harness({
    stdoutIsTTY: true,
    color: false,
    reply: () =>
      okResult("logs.read", {
        file: "xhttp.log",
        text: "строка\n",
        sizeBytes: 4096,
        tailOnly: true,
        fingerprint: "fp",
      }),
  });
  assert.equal(
    await runCli(["logs", "tail", "xhttp.log", "-q"], logQuiet.io, logQuiet.dependencies),
    0,
  );
  assert.equal(logQuiet.state.stderr, "");

  // logs search: многострочное событие целиком и подсветка уровня.
  const logSearch = harness({
    stdoutIsTTY: true,
    color: true,
    reply: () =>
      okResult("logs.search", {
        file: "xhttp.log",
        events: [
          {
            sequence: 1,
            time: "12:00:01",
            context: "r2",
            level: "error",
            text: "ERROR сбой\n    at frame",
          },
        ],
        totalEvents: 5,
        matches: 1,
        fingerprint: "fp",
        tailOnly: false,
      }),
  });
  assert.equal(
    await runCli(["logs", "search", "xhttp.log"], logSearch.io, logSearch.dependencies),
    0,
  );
  assert.match(logSearch.state.stdout, /\x1b\[36m\[r2\]\x1b\[39m/);
  assert.match(logSearch.state.stdout, /\x1b\[31mERROR\x1b\[39m/);
  assert.match(stripAnsi(logSearch.state.stdout), /ERROR сбой\n    at frame/);

  // rpc describe --source: живой код без экранирования и чистый код в --format raw.
  const rpcCode = "function get_version(s) {\n  return '1.0';\n}";
  const rpcDesc = harness({
    stdoutIsTTY: true,
    color: false,
    reply: () =>
      okResult("rpc.describe", {
        id: "tools.get_version",
        parameters: ["sTypeParam"],
        allowed: true,
        source: "server",
        code: rpcCode,
      }),
  });
  assert.equal(
    await runCli(
      ["rpc", "describe", "tools.get_version", "--source"],
      rpcDesc.io,
      rpcDesc.dependencies,
    ),
    0,
  );
  assert.match(rpcDesc.state.stdout, /tools\.get_version\(sTypeParam\)/);
  assert.ok(rpcDesc.state.stdout.includes(rpcCode));

  const rpcRaw = harness({
    reply: () =>
      okResult("rpc.describe", {
        id: "tools.get_version",
        parameters: ["sTypeParam"],
        allowed: true,
        source: "server",
        code: rpcCode,
      }),
  });
  assert.equal(
    await runCli(
      ["rpc", "describe", "tools.get_version", "--source", "--format", "raw"],
      rpcRaw.io,
      rpcRaw.dependencies,
    ),
    0,
  );
  assert.equal(rpcRaw.state.stdout, rpcCode);

  // doc get (native.lds.loadDoc): живой XML.
  const docXml = harness({
    stdoutIsTTY: true,
    color: false,
    reply: () => okResult("native.lds.loadDoc", { Data: { group: { id: "0x1", name: "Отдел" } } }),
  });
  assert.equal(
    await runCli(["doc", "get", "x-local://wt_data/1.xml"], docXml.io, docXml.dependencies),
    0,
  );
  assert.match(docXml.state.stdout, /<group>/);
  assert.match(docXml.state.stdout, /<name>Отдел<\/name>/);

  // config list: таблица без паролей и * у подключения по умолчанию; version --format raw.
  const cfgText = JSON.stringify({
    defaultConnection: "prod",
    connections: {
      dev: { baseUrl: "http://dev.test/", username: "u", password: "secret-never-shown" },
      prod: {
        baseUrl: "https://prod.test/",
        usernameEnv: "WTCTL_USER",
        passwordEnv: "WTCTL_PASS",
        permissions: { write: true, execute: false },
      },
    },
  });
  const cfgList = harness({ stdoutIsTTY: true, color: false, fileInput: cfgText });
  assert.equal(
    await runCli(["config", "list", "--config", "c.json"], cfgList.io, cfgList.dependencies),
    0,
  );
  assert.doesNotMatch(cfgList.state.stdout, /secret-never-shown/);
  assert.match(
    cfgList.state.stdout,
    /\* prod\s+https:\/\/prod\.test\/\s+read, write\s+env:WTCTL_USER \/ env:WTCTL_PASS/,
  );

  const verRaw = harness();
  assert.equal(await runCli(["version", "--format", "raw"], verRaw.io, verRaw.dependencies), 0);
  assert.equal(verRaw.state.stdout, `${VERSION}\n`);

  // execute.script с массивом плоских объектов рендерится таблицей и CSV.
  const execCsv = harness({
    reply: () =>
      okResult("execute.script", {
        result: [{ code: "a", title: "Первый" }],
        executionId: "hcm_inline_0123456789abcdef0123456789abcdef",
      }),
  });
  assert.equal(
    await runCli(["exec", "RESULT=[];", "--format", "csv"], execCsv.io, execCsv.dependencies),
    0,
  );
  assert.equal(execCsv.state.stdout, "code,title\na,Первый\n");
});

test("читаемые ошибки в человеческом режиме (SCRIPT_FAILED, indeterminate), NO_COLOR и --output", async () => {
  // SCRIPT_FAILED с живыми переносами строк и предупреждением indeterminate.
  const scriptFail = harness({
    stdoutIsTTY: true,
    stderrIsTTY: true,
    reply: () => ({
      ok: false,
      error: {
        code: "SCRIPT_FAILED",
        message: "Сервер сообщил об ошибке в коде SP-XML Script.",
        hint: "Проверить код и состояние данных.",
        mutationOutcome: "indeterminate",
        details: {
          scriptError: "ReferenceError: x is not defined\nline 4",
          executionId: "hcm_inline_0123456789abcdef0123456789abcdef",
        },
      },
      meta: { operationId: "execute.script", connection: "stand", durationMs: 5 },
    }),
  });

  await withEnv({ NO_COLOR: "1", FORCE_COLOR: undefined }, async () => {
    assert.equal(await runCli(["exec", "x;"], scriptFail.io, scriptFail.dependencies), 1);
    assert.equal(scriptFail.state.stdout, "");
    assert.equal(scriptFail.state.stderr, stripAnsi(scriptFail.state.stderr));
    assert.match(scriptFail.state.stderr, /^Ошибка \[SCRIPT_FAILED\]:/);
    assert.match(scriptFail.state.stderr, /  ReferenceError: x is not defined\n  line 4/);
    assert.match(scriptFail.state.stderr, /indeterminate/);
    assert.match(scriptFail.state.stderr, /Подсказка: Проверить код/);
  });

  // С включённым цветом предупреждение indeterminate выделяется жёлтым.
  const coloredFail = harness({
    stdoutIsTTY: true,
    stderrIsTTY: true,
    color: true,
    reply: () => ({
      ok: false,
      error: {
        code: "WRITE_INDETERMINATE",
        message: "Ответ не получен.",
        mutationOutcome: "indeterminate",
      },
      meta: { operationId: "objects.patch", connection: "stand", durationMs: 5 },
    }),
  });
  assert.equal(
    await runCli(
      ["object", "patch", "0x1", "--args", '{"name":"a"}'],
      coloredFail.io,
      coloredFail.dependencies,
    ),
    1,
  );
  assert.match(coloredFail.state.stderr, /\x1b\[33m.*indeterminate/);

  // --output в --format csv пишет чистый CSV в файл и короткую сводку в stdout (в pipe) / stderr (в TTY).
  const queryReply = () =>
    okResult("runtime.query", { items: [{ id: "0x1", name: "Тест" }], total: 1 });
  const pipeOut = harness({ stdoutIsTTY: false, reply: queryReply });
  assert.equal(
    await runCli(
      ["query", "--catalog", "groups", "--format", "csv", "-o", "out.csv"],
      pipeOut.io,
      pipeOut.dependencies,
    ),
    0,
  );
  assert.equal(pipeOut.state.files.get("out.csv"), "id,name\n0x1,Тест\n");
  assert.match(pipeOut.state.stdout, /Сохранено: out\.csv/);
  assert.equal(pipeOut.state.stderr, "");

  const ttyOut = harness({ stdoutIsTTY: true, stderrIsTTY: true, color: true, reply: queryReply });
  assert.equal(
    await runCli(
      ["query", "--catalog", "groups", "-o", "table.txt"],
      ttyOut.io,
      ttyOut.dependencies,
    ),
    0,
  );
  // В файл никогда не попадают ANSI-коды.
  const savedTable = ttyOut.state.files.get("table.txt")!;
  assert.equal(savedTable, stripAnsi(savedTable));
  assert.equal(ttyOut.state.stdout, "");
  assert.match(stripAnsi(ttyOut.state.stderr), /Сохранено: table\.txt/);

  // -q подавляет уведомление о сохранении.
  const quietOut = harness({
    stdoutIsTTY: true,
    stderrIsTTY: true,
    color: false,
    reply: queryReply,
  });
  assert.equal(
    await runCli(
      ["query", "--catalog", "groups", "-o", "q.txt", "-q"],
      quietOut.io,
      quietOut.dependencies,
    ),
    0,
  );
  assert.equal(quietOut.state.stderr, "");

  // Двоичный --format raw с -o сохраняет байты через writeBinaryFile.
  const rawBytes = Buffer.from([1, 2, 3, 255]);
  const binOut = harness({
    reply: () => okResult("files.read", { base64: rawBytes.toString("base64"), bytes: 4 }),
  });
  assert.equal(
    await runCli(
      ["files", "read", "x-local://share/a.bin", "--format", "raw", "-o", "a.bin"],
      binOut.io,
      binOut.dependencies,
    ),
    0,
  );
  assert.deepEqual(Buffer.from(binOut.state.binaryFiles.get("a.bin")!), rawBytes);
});

test("предел вывода 256 КиБ в человеческом TTY, приоритет явной настройки и обрезанный ответ с кодом 3", async () => {
  // runCli передаёт defaultOutputLimitBytes=256 КиБ только в человеческом TTY и не для mcp/--json/pipe.
  const tty = harness({ stdoutIsTTY: true, color: false });
  assert.equal(await runCli(["status"], tty.io, tty.dependencies), 0);
  assert.equal(tty.state.loadOptions[0]?.defaultOutputLimitBytes, 256 * 1024);

  const ttyJson = harness({ stdoutIsTTY: true });
  assert.equal(await runCli(["status", "--json"], ttyJson.io, ttyJson.dependencies), 0);
  assert.equal(ttyJson.state.loadOptions[0]?.defaultOutputLimitBytes, undefined);

  const pipe = harness({ stdoutIsTTY: false });
  assert.equal(await runCli(["status"], pipe.io, pipe.dependencies), 0);
  assert.equal(pipe.state.loadOptions[0]?.defaultOutputLimitBytes, undefined);

  const mcp = harness({ stdoutIsTTY: true });
  assert.equal(await runCli(["mcp"], mcp.io, mcp.dependencies), 0);
  assert.equal(mcp.state.loadOptions[0]?.defaultOutputLimitBytes, undefined);

  // loadConfigWithDefaults уважает приоритет: конфиг и WTCTL_OUTPUT_LIMIT_BYTES сильнее defaultOutputLimitBytes.
  const dir = await mkdtemp(join(tmpdir(), "wtctl-tty-limit-"));
  try {
    const fileDefault = join(dir, "default.json");
    const fileExplicit = join(dir, "explicit.json");
    await writeFile(
      fileDefault,
      JSON.stringify({ connections: { dev: { baseUrl: "http://hcm.invalid/" } } }),
    );
    await writeFile(
      fileExplicit,
      JSON.stringify({
        connections: { dev: { baseUrl: "http://hcm.invalid/", outputLimitBytes: 16384 } },
      }),
    );

    await withEnv({ WTCTL_OUTPUT_LIMIT_BYTES: undefined }, () => {
      assert.equal(
        loadConfigWithDefaults(
          { configPath: fileDefault, connection: "dev" },
          { outputLimitBytes: 256 * 1024 },
        ).outputLimitBytes,
        256 * 1024,
      );
      assert.equal(
        loadConfigWithDefaults({ configPath: fileDefault, connection: "dev" }).outputLimitBytes,
        24 * 1024,
      );
      assert.equal(
        loadConfigWithDefaults(
          { configPath: fileExplicit, connection: "dev" },
          { outputLimitBytes: 256 * 1024 },
        ).outputLimitBytes,
        16384,
      );
    });

    await withEnv({ WTCTL_OUTPUT_LIMIT_BYTES: "8192" }, () => {
      assert.equal(
        loadConfigWithDefaults(
          { configPath: fileDefault, connection: "dev" },
          { outputLimitBytes: 256 * 1024 },
        ).outputLimitBytes,
        8192,
      );
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  // Обрезанный ответ в TTY: читаемая сводка, resultId, превью, команды и код выхода 3.
  const resultId = "01234567-89ab-4cde-8f01-23456789abcd";
  const truncated = harness({
    stdoutIsTTY: true,
    color: false,
    reply: () =>
      okResult(
        "runtime.query",
        {
          preview: { items: [{ id: "0x1", name: "Первая" }], total: 5000 },
          resultId,
          hint: "Ответ не поместился.",
        },
        { truncated: true, resultId, resultBytes: 512 * 1024 },
      ),
  });
  assert.equal(
    await runCli(["query", "--catalog", "collaborators"], truncated.io, truncated.dependencies),
    3,
  );
  assert.match(truncated.state.stdout, /512 КиБ/);
  assert.match(truncated.state.stdout, new RegExp(resultId));
  assert.match(truncated.state.stdout, new RegExp(`wtctl result read ${resultId}`));
  assert.match(truncated.state.stdout, new RegExp(`wtctl result export ${resultId} --to ФАЙЛ`));
});

test("проверка формата до отправки, --output для больших ответов, help/guide с WTCTL_FORMAT, CHECK_FAILED и порядок полей query", async () => {
  // P1: нетабличный формат отклоняется ДО вызова сервера или изменения файла подключений.
  const delCsv = harness();
  assert.equal(
    await runCli(
      ["object", "delete", "group", "0x1", "--permanent", "--format", "csv"],
      delCsv.io,
      delCsv.dependencies,
    ),
    2,
  );
  assert.equal(delCsv.state.calls.length, 0);

  const cfgCsv = harness({
    fileInput: JSON.stringify({ connections: { dev: { baseUrl: "http://dev.test/" } } }),
  });
  assert.equal(
    await runCli(
      ["config", "set", "dev", "--config", "c.json", "--write", "true", "--format", "csv"],
      cfgCsv.io,
      cfgCsv.dependencies,
    ),
    2,
  );
  assert.equal(cfgCsv.state.files.size, 0);

  await withEnv({ WTCTL_FORMAT: "csv" }, async () => {
    const exp = harness();
    assert.equal(
      await runCli(["result", "export", "r1", "--to", "a.json"], exp.io, exp.dependencies),
      2,
    );
    assert.equal(exp.state.calls.length, 0);
  });

  // P1: --output с настоящим ResultStore при truncated сохраняет данные в запрошенном формате.
  const storeDir = await mkdtemp(join(tmpdir(), "wtctl-trunc-fmt-"));
  try {
    const store = new ResultStore({ ...BASE_CONFIG, runtimeDir: storeDir });

    // Двоичный files read --format raw --output out.bin -> байты потоково, не JSON.
    const rawBytes = Buffer.from([0x00, 0x01, 0xfe, 0xff, 0x41, 0x42]);
    const binOutPath = join(storeDir, "out.bin");
    const binStored = await store.put({
      url: "x-local://share/a.bin",
      encoding: "base64",
      base64: rawBytes.toString("base64"),
      bytes: rawBytes.length,
    });
    const binRun = harness({
      results: store,
      reply: () =>
        okResult(
          "files.read",
          { preview: {}, resultId: binStored.resultId },
          { truncated: true, resultId: binStored.resultId, resultBytes: binStored.bytes },
        ),
    });
    assert.equal(
      await runCli(
        ["files", "read", "x-local://share/a.bin", "--format", "raw", "--output", binOutPath],
        binRun.io,
        binRun.dependencies,
      ),
      0,
    );
    assert.deepEqual(await readFile(binOutPath), rawBytes);

    // query --format csv --output out.csv при truncated -> CSV со всеми строками.
    const queryStored = await store.put(
      {
        items: [
          { id: "0x1", name: "Иван" },
          { id: "0x2", name: "Пётр" },
        ],
        total: 2,
      },
      "items",
    );
    const csvRun = harness({
      results: store,
      reply: () =>
        okResult(
          "runtime.query",
          { preview: { items: [{ id: "0x1" }] }, resultId: queryStored.resultId },
          { truncated: true, resultId: queryStored.resultId, resultBytes: queryStored.bytes },
        ),
    });
    assert.equal(
      await runCli(
        [
          "query",
          "--catalog",
          "collaborators",
          "--fields",
          "name,id",
          "--format",
          "csv",
          "--output",
          "out.csv",
        ],
        csvRun.io,
        csvRun.dependencies,
      ),
      0,
    );
    assert.equal(csvRun.state.files.get("out.csv"), "name,id\nИван,0x1\nПётр,0x2\n");

    // jsonl для одиночного сохранённого объекта -> одна строка JSON потоково, код 0.
    const singleStored = await store.put({ id: "0x1", type: "group", data: { name: "Отдел" } });
    const jsonlOutPath = join(storeDir, "obj.jsonl");
    const jsonlRun = harness({
      results: store,
      reply: () =>
        okResult(
          "objects.get",
          { preview: {}, resultId: singleStored.resultId },
          { truncated: true, resultId: singleStored.resultId, resultBytes: singleStored.bytes },
        ),
    });
    assert.equal(
      await runCli(
        ["object", "get", "0x1", "--format", "jsonl", "--output", jsonlOutPath],
        jsonlRun.io,
        jsonlRun.dependencies,
      ),
      0,
    );
    assert.deepEqual(JSON.parse((await readFile(jsonlOutPath, "utf8")).trim()), {
      id: "0x1",
      type: "group",
      data: { name: "Отдел" },
    });

    // Большой BATCH_FAILED с --format table --output сохраняет файл и выводит resultId в stderr.
    const batchStored = await store.put(
      {
        results: [
          { ok: true, meta: { operationId: "runtime.status", connection: "stand", durationMs: 1 } },
        ],
        completed: 1,
        failedAt: 1,
      },
      "results",
    );
    const batchOut = harness({
      results: store,
      reply: () => ({
        ok: false,
        data: { preview: {}, resultId: batchStored.resultId },
        error: { code: "BATCH_FAILED", message: "Шаг 2 не выполнен." },
        meta: {
          operationId: "runtime.batch",
          connection: "stand",
          durationMs: 10,
          truncated: true,
          resultId: batchStored.resultId,
        },
      }),
    });
    assert.equal(
      await runCli(
        ["run", "--args", '{"steps":[]}', "--format", "table", "--output", "batch.txt"],
        batchOut.io,
        batchOut.dependencies,
      ),
      1,
    );
    assert.match(batchOut.state.files.get("batch.txt") ?? "", /runtime\.status/);
    assert.match(batchOut.state.stderr, new RegExp(batchStored.resultId));

    // cleanupFailed на большом ответе с --output -> полный результат в файле, код 1.
    const cleanupRun = harness({
      results: store,
      failClose: true,
      reply: () =>
        okResult(
          "runtime.query",
          { preview: { items: [{ id: "0x1" }] }, resultId: queryStored.resultId },
          { truncated: true, resultId: queryStored.resultId, resultBytes: queryStored.bytes },
        ),
    });
    assert.equal(
      await runCli(
        ["query", "--catalog", "collaborators", "--format", "table", "--output", "q.txt"],
        cleanupRun.io,
        cleanupRun.dependencies,
      ),
      1,
    );
    assert.match(cleanupRun.state.files.get("q.txt") ?? "", /Пётр/);

    // Оборванный base64 в хранилище не даёт код 0 и не оставляет неполный файл.
    const brokenBin = await store.put({
      url: "x-local://share/broken.bin",
      encoding: "base64",
      base64: Buffer.alloc(1024, 0x41).toString("base64"),
      bytes: 1024,
    });
    const brokenDataPath = join(store.directory, `${brokenBin.resultId}.data.json`);
    const fullBroken = await readFile(brokenDataPath, "utf8");
    await writeFile(brokenDataPath, fullBroken.slice(0, 200), "utf8");
    const brokenOutPath = join(storeDir, "nested", "broken.bin");
    const brokenRun = harness({
      results: store,
      reply: () =>
        okResult(
          "files.read",
          { preview: {}, resultId: brokenBin.resultId },
          { truncated: true, resultId: brokenBin.resultId, resultBytes: brokenBin.bytes },
        ),
    });
    assert.equal(
      await runCli(
        [
          "files",
          "read",
          "x-local://share/broken.bin",
          "--format",
          "raw",
          "--output",
          brokenOutPath,
        ],
        brokenRun.io,
        brokenRun.dependencies,
      ),
      1,
    );
    await assert.rejects(() => readFile(brokenOutPath));

    // exec с одним большим элементом в jsonl + --output в новую вложенную папку: отдаёт элемент result[0].
    const bigExec = await store.put({
      executionId: "hcm_inline_0123456789abcdef0123456789abcdef",
      result: [{ id: "0x1", payload: "x".repeat(30_000) }],
    });
    const execOutPath = join(storeDir, "deep", "dir", "exec.jsonl");
    const execJsonlRun = harness({
      results: store,
      reply: () =>
        okResult(
          "execute.script",
          { preview: {}, resultId: bigExec.resultId },
          { truncated: true, resultId: bigExec.resultId, resultBytes: bigExec.bytes },
        ),
    });
    assert.equal(
      await runCli(
        ["exec", "RESULT=[];", "--format", "jsonl", "--output", execOutPath],
        execJsonlRun.io,
        execJsonlRun.dependencies,
      ),
      0,
    );
    assert.deepEqual(JSON.parse((await readFile(execOutPath, "utf8")).trim()), {
      id: "0x1",
      payload: "x".repeat(30_000),
    });

    // Хвост лога в --format raw --output в новую вложенную папку.
    const bigLog = await store.put({
      file: "xhttp.log",
      text: "hello-log\n",
      sizeBytes: 99999,
      tailOnly: true,
      fingerprint: "fp",
    });
    const nestedLogOut = join(storeDir, "logs-sub", "tail.log");
    const nestedLogRun = harness({
      results: store,
      reply: () =>
        okResult(
          "logs.read",
          {
            preview: { file: "xhttp.log", sizeBytes: 99999, tailOnly: true },
            resultId: bigLog.resultId,
          },
          { truncated: true, resultId: bigLog.resultId, resultBytes: bigLog.bytes },
        ),
    });
    assert.equal(
      await runCli(
        ["logs", "read", "xhttp.log", "--format", "raw", "--output", nestedLogOut],
        nestedLogRun.io,
        nestedLogRun.dependencies,
      ),
      0,
    );
    assert.equal(await readFile(nestedLogOut, "utf8"), "hello-log\n");
  } finally {
    await rm(storeDir, { recursive: true, force: true });
  }

  // P2: большой BATCH_FAILED показывает resultId в человеческом stderr.
  const batchId = "11111111-2222-4333-8444-555555555555";
  const batchFail = harness({
    stdoutIsTTY: true,
    stderrIsTTY: true,
    color: false,
    reply: () => ({
      ok: false,
      data: { preview: {}, resultId: batchId },
      error: { code: "BATCH_FAILED", message: "Шаг 2 не выполнен." },
      meta: {
        operationId: "runtime.batch",
        connection: "stand",
        durationMs: 10,
        truncated: true,
        resultId: batchId,
      },
    }),
  });
  assert.equal(
    await runCli(["run", "--args", '{"steps":[]}'], batchFail.io, batchFail.dependencies),
    1,
  );
  assert.match(batchFail.state.stderr, new RegExp(batchId));

  // P2: WTCTL_FORMAT=json действует на help и guide, а csv/jsonl отклоняются с кодом 2.
  await withEnv({ WTCTL_FORMAT: "json" }, async () => {
    const h = harness();
    assert.equal(await runCli(["help"], h.io, h.dependencies), 0);
    assert.equal(JSON.parse(h.state.stdout).meta.operationId, "cli.help");
    const g = harness();
    assert.equal(await runCli(["guide", "logs"], g.io, g.dependencies), 0);
    assert.equal(JSON.parse(g.state.stdout).meta.operationId, "cli.guide");
  });
  for (const argv of [
    ["help", "--format", "csv"],
    ["help", "--format", "jsonl"],
    ["guide", "logs", "--format", "csv"],
  ]) {
    const f = harness();
    assert.equal(await runCli(argv, f.io, f.dependencies), 2, argv.join(" "));
  }

  // P2: CHECK_FAILED выводит чеклист/таблицу в stdout и ошибку в stderr (и в table, и в csv/jsonl).
  const checkFailure = (): OperationResult => ({
    ok: false,
    data: {
      version: "2025.1.1171",
      permissions: { write: false, execute: false },
      checks: [
        { name: "login", result: "ok" },
        { name: "logs", result: "failed", reason: "нет доступа" },
      ],
      summary: { ok: 1, failed: 1, skipped: 0 },
    },
    error: { code: "CHECK_FAILED", message: "Проверка подключения не пройдена: logs." },
    meta: { operationId: "runtime.check", connection: "stand", durationMs: 20 },
  });
  for (const format of ["table", "csv", "jsonl"] as const) {
    const chk = harness({ color: false, reply: checkFailure });
    assert.equal(await runCli(["check", "--format", format], chk.io, chk.dependencies), 1, format);
    assert.match(chk.state.stdout, /logs/, format);
    assert.match(chk.state.stderr, /CHECK_FAILED/, format);
  }

  // Порядок запрошенных --fields сохраняется в query при частичных строках и пустой странице.
  const partialQuery = harness({
    reply: () =>
      okResult("runtime.query", {
        items: [{ id: "1" }, { name: "B", id: "2" }],
        total: 2,
      }),
  });
  assert.equal(
    await runCli(
      ["query", "--catalog", "collaborators", "--fields", "name,id", "--format", "raw"],
      partialQuery.io,
      partialQuery.dependencies,
    ),
    0,
  );
  assert.equal(partialQuery.state.stdout, "\t1\nB\t2\n");

  const emptyQuery = harness({
    reply: () => okResult("runtime.query", { items: [], total: 0 }),
  });
  assert.equal(
    await runCli(
      ["query", "--catalog", "collaborators", "--fields", "id,name", "--format", "csv"],
      emptyQuery.io,
      emptyQuery.dependencies,
    ),
    0,
  );
  assert.equal(emptyQuery.state.stdout, "id,name\n");

  const emptyObjects = harness({
    reply: () => okResult("runtime.query", { items: [{}, {}], total: 2 }),
  });
  assert.equal(
    await runCli(
      ["query", "--catalog", "collaborators", "--format", "raw"],
      emptyObjects.io,
      emptyObjects.dependencies,
    ),
    0,
  );
  assert.equal(emptyObjects.state.stdout, "");

  // FORCE_COLOR=0 выключает цвет даже в TTY; nodeIo не фиксирует io.color, чтобы stderr и stdout решались раздельно.
  await withEnv({ NO_COLOR: undefined, FORCE_COLOR: "0" }, () => {
    assert.equal(envColor(true), false);
  });
  await withEnv({ NO_COLOR: undefined, FORCE_COLOR: undefined }, () => {
    assert.equal(nodeIo().color, undefined);
    const mixedIo = { ...nodeIo(), stdoutIsTTY: true, stderrIsTTY: false };
    assert.equal(resolveColor(mixedIo, "stdout"), true);
    assert.equal(resolveColor(mixedIo, "stderr"), false);
    const pipedIo = { ...nodeIo(), stdoutIsTTY: false, stderrIsTTY: true };
    assert.equal(resolveColor(pipedIo, "stdout"), false);
    assert.equal(resolveColor(pipedIo, "stderr"), true);
  });
  assert.equal(formatTsv(["a"], [["x\ry\tz"]]), "a\nx y z\n");

  const prefixedDoc = harness({
    stdoutIsTTY: true,
    color: false,
    reply: () => okResult("native.lds.loadDoc", { "m:Data": { group: { name: "Тест" } } }),
  });
  assert.equal(
    await runCli(
      ["doc", "get", "x-local://wt_data/1.xml"],
      prefixedDoc.io,
      prefixedDoc.dependencies,
    ),
    0,
  );
  assert.match(prefixedDoc.state.stdout, /<name>Тест<\/name>/);

  const ttyCsvLimit = harness({
    stdoutIsTTY: true,
    reply: () => okResult("runtime.query", { items: [{ id: "1" }], total: 1 }),
  });
  assert.equal(
    await runCli(
      ["query", "--catalog", "collaborators", "--format", "csv"],
      ttyCsvLimit.io,
      ttyCsvLimit.dependencies,
    ),
    0,
  );
  assert.equal(ttyCsvLimit.state.loadOptions[0]?.defaultOutputLimitBytes, undefined);

  const logOut = harness({
    stdoutIsTTY: true,
    stderrIsTTY: true,
    color: false,
    reply: () =>
      okResult("logs.read", {
        file: "xhttp.log",
        text: "line1\n",
        sizeBytes: 1000,
        tailOnly: true,
        fingerprint: "fp",
      }),
  });
  assert.equal(
    await runCli(
      ["logs", "read", "xhttp.log", "--output", "x.log"],
      logOut.io,
      logOut.dependencies,
    ),
    0,
  );
  assert.match(logOut.state.stderr, /Показан конец файла xhttp\.log/);

  for (const argv of [
    ["run", "--args", '{"steps":[{"id":"objects.delete"}]}', "--format", "csv"],
    ["api", "call", "agents.run", "--args", '{"id":"0x1"}', "--format", "csv"],
  ]) {
    const blocked = harness();
    assert.equal(await runCli(argv, blocked.io, blocked.dependencies), 2, argv.join(" "));
    assert.equal(blocked.state.calls.length, 0, argv.join(" "));
  }

  const scalarExec = harness({
    reply: () => okResult("execute.script", { result: [1, 2, "ok"] }),
  });
  assert.equal(
    await runCli(
      ["exec", "RESULT=[1,2,'ok'];", "--format", "csv"],
      scalarExec.io,
      scalarExec.dependencies,
    ),
    0,
  );
  assert.equal(scalarExec.state.stdout, "value\n1\n2\nok\n");

  const protoField = harness({
    reply: () => okResult("runtime.query", { items: [{ id: "1" }], total: 1 }),
  });
  assert.equal(
    await runCli(
      ["query", "--catalog", "collaborators", "--fields", "id,constructor", "--format", "raw"],
      protoField.io,
      protoField.dependencies,
    ),
    0,
  );
  assert.equal(protoField.state.stdout, "1\t\n");

  const errCols = harness({
    reply: () =>
      okResult("objects.get", {
        items: [
          { id: "0x1", type: "group", data: { error: "user-err", _error: "user-uerr" } },
          { id: "0x2", error: { code: "NOT_FOUND", message: "нет" } },
        ],
        total: 2,
        failed: 1,
      }),
  });
  assert.equal(
    await runCli(
      ["object", "get", "--ids", "0x1,0x2", "--format", "csv"],
      errCols.io,
      errCols.dependencies,
    ),
    0,
  );
  assert.equal(
    errCols.state.stdout,
    "id,type,error,_error,__error\n0x1,group,user-err,user-uerr,\n0x2,,,,NOT_FOUND: нет\n",
  );

  const rawLogOut = harness({
    stderrIsTTY: true,
    color: false,
    reply: () =>
      okResult("logs.read", {
        file: "xhttp.log",
        text: "line1\n",
        sizeBytes: 1000,
        tailOnly: true,
        fingerprint: "fp",
      }),
  });
  assert.equal(
    await runCli(
      ["logs", "read", "xhttp.log", "--format", "raw", "--output", "raw.log"],
      rawLogOut.io,
      rawLogOut.dependencies,
    ),
    0,
  );
  assert.match(rawLogOut.state.stderr, /Показан конец файла xhttp\.log/);

  const batchJsonl = harness({
    reply: () => ({
      ok: false,
      data: {
        results: [
          {
            ok: true,
            data: { a: 1 },
            meta: { operationId: "runtime.status", connection: "stand", durationMs: 1 },
          },
        ],
      },
      error: { code: "BATCH_FAILED", message: "Шаг 2 упал." },
      meta: { operationId: "runtime.batch", connection: "stand", durationMs: 5 },
    }),
  });
  assert.equal(
    await runCli(
      ["run", "--args", '{"steps":[]}', "--format", "jsonl"],
      batchJsonl.io,
      batchJsonl.dependencies,
    ),
    1,
  );
  assert.match(batchJsonl.state.stdout, /"operationId":"runtime\.status"/);
  assert.match(batchJsonl.state.stderr, /BATCH_FAILED/);
});

test("raw-лог не дублирует время и контекст, tasks list jsonl совпадает при --output, а csv --output стримит результат >8 МиБ", async () => {
  // 1. formatRawLogEvents не дублирует время/контекст из разобранного event.text.
  const rawLog = harness({
    reply: () =>
      okResult("logs.search", {
        file: "xhttp.log",
        events: [
          {
            sequence: 1,
            time: "10:15:02",
            context: "ctx-1",
            level: "error",
            text: "10:15:02 [ctx-1] Ошибка запроса",
          },
        ],
      }),
  });
  assert.equal(
    await runCli(
      ["logs", "search", "xhttp.log", "--format", "raw"],
      rawLog.io,
      rawLog.dependencies,
    ),
    0,
  );
  assert.equal(rawLog.state.stdout, "10:15:02 [ctx-1] Ошибка запроса\n");

  const dir = await mkdtemp(join(tmpdir(), "wtctl-stream-export-"));
  try {
    const store = new ResultStore({ ...BASE_CONFIG, runtimeDir: dir });

    // 2. Одиночная задача и массив с пустыми/null элементами tasks list при truncated + --format jsonl --output.
    const singleTask = { TrackingID: "t-1", IsRunning: "1", StartDate: "2026-11-22T10:00:00" };
    const storedTask = await store.put({ Task: singleTask });
    const taskOut = join(dir, "task.jsonl");
    const taskRun = harness({
      results: store,
      reply: () =>
        okResult(
          "web.spxml.getBackgroundTasksByName",
          { preview: {}, resultId: storedTask.resultId },
          { truncated: true, resultId: storedTask.resultId, resultBytes: storedTask.bytes },
        ),
    });
    assert.equal(
      await runCli(
        ["tasks", "list", "tools.job", "--format", "jsonl", "--output", taskOut],
        taskRun.io,
        taskRun.dependencies,
      ),
      0,
    );
    assert.deepEqual(JSON.parse((await readFile(taskOut, "utf8")).trim()), singleTask);

    const mixedTasks = await store.put({ Task: ["", null, singleTask, ""] });
    const mixedTaskOut = join(dir, "tasks-mixed.jsonl");
    const mixedTaskRun = harness({
      results: store,
      reply: () =>
        okResult(
          "web.spxml.getBackgroundTasksByName",
          { preview: {}, resultId: mixedTasks.resultId },
          { truncated: true, resultId: mixedTasks.resultId, resultBytes: mixedTasks.bytes },
        ),
    });
    assert.equal(
      await runCli(
        ["tasks", "list", "tools.job", "--format", "jsonl", "--output", mixedTaskOut],
        mixedTaskRun.io,
        mixedTaskRun.dependencies,
      ),
      0,
    );
    assert.equal((await readFile(mixedTaskOut, "utf8")).trim().split("\n").length, 1);
    assert.deepEqual(JSON.parse((await readFile(mixedTaskOut, "utf8")).trim()), singleTask);

    // 2b. object get --ids при truncated + --format csv --output сохраняет fromCatalog и error.
    const manyStored = await store.put(
      {
        items: [
          {
            id: "0x1",
            type: "collaborator",
            data: { login: "ivan" },
            fromCatalog: { fullname: "Иванов" },
          },
          {
            id: "0x2",
            type: "collaborator",
            error: { code: "NOT_FOUND", message: "Не найден" },
          },
        ],
      },
      "items",
    );
    const manyCsvOut = join(dir, "many.csv");
    const manyCsvRun = harness({
      results: store,
      reply: () =>
        okResult(
          "objects.get",
          { preview: { items: [] }, resultId: manyStored.resultId },
          { truncated: true, resultId: manyStored.resultId, resultBytes: manyStored.bytes },
        ),
    });
    assert.equal(
      await runCli(
        ["object", "get", "0x1", "0x2", "--format", "csv", "--output", manyCsvOut],
        manyCsvRun.io,
        manyCsvRun.dependencies,
      ),
      0,
    );
    assert.equal(
      manyCsvRun.state.files.get(manyCsvOut),
      "id,type,login,fullname,error\n0x1,collaborator,ivan,Иванов,\n0x2,collaborator,,,NOT_FOUND: Не найден\n",
    );

    // 3. Сохранённый результат > 8 МиБ выгружается в --format csv --output потоково без RESULT_TOO_LARGE_FOR_FORMAT.
    const saver = await store.openListSaver("items");
    const pad = "x".repeat(4000);
    for (let i = 0; i < 2300; i++) {
      await saver.writeItem({ id: `0x${i + 1}`, note: pad });
    }
    const bigStored = await saver.commit({ total: 2300 });
    assert.ok(bigStored.bytes > 8 * 1024 * 1024, `expected > 8 MiB, got ${bigStored.bytes}`);
    const csvOut = join(dir, "big.csv");
    const { openAtomicTextWriter } = await import("../src/cli/node-io.js");
    const bigCsv = harness({
      results: store,
      reply: () =>
        okResult(
          "runtime.query",
          { preview: { items: [] }, resultId: bigStored.resultId },
          { truncated: true, resultId: bigStored.resultId, resultBytes: bigStored.bytes },
        ),
    });
    bigCsv.io.openTextWriter = openAtomicTextWriter;
    assert.equal(
      await runCli(
        ["query", "collaborators", "--fields", "id,note", "--format", "csv", "--output", csvOut],
        bigCsv.io,
        bigCsv.dependencies,
      ),
      0,
    );
    const csvText = await readFile(csvOut, "utf8");
    assert.ok(csvText.startsWith("id,note\n0x1,"));
    assert.equal(csvText.trimEnd().split("\n").length, 2301);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
