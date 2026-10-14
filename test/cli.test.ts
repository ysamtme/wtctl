import test from "node:test";
import assert from "node:assert/strict";
import { CliInputError, parseArguments } from "../src/cli/arguments.js";
import { commandInvocation, runCli } from "../src/cli/run.js";
import type { CliDependencies, CliIo, RuntimePort } from "../src/cli/types.js";
import type { ConnectionConfig, OperationDefinition, OperationResult } from "../src/contracts.js";
import { HcmError } from "../src/errors.js";
import { describeHcmOperation, listHcmOperations } from "../src/catalog.js";
import { operationHelp } from "../src/operation-help.js";
import { cliHelp } from "../src/cli/help.js";
import { ResultStore } from "../src/results.js";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const config: ConnectionConfig = {
  name: "synthetic",
  baseUrl: "http://example.invalid",
  timeoutMs: 1000,
  maxResponseBytes: 1024,
  outputLimitBytes: 1024,
  runtimeDir: ".unused",
  permissions: { write: false, execute: false },
};
const operation: OperationDefinition = {
  id: "native.lds.loadDoc",
  group: "lds",
  title: "LoadDoc",
  description: "Synthetic",
  effect: "read",
  inputSchema: { type: "object" },
};

function fixture(input = "{}") {
  const state = {
    stdout: "",
    stderr: "",
    closes: 0,
    loads: 0,
    mcpRuns: 0,
    inputReads: 0,
    stdinReads: 0,
    calls: [] as { id: string; args: Record<string, unknown> }[],
    files: new Map<string, string>(),
    filters: [] as unknown[],
  };
  const io: CliIo = {
    writeOut: (text) => {
      state.stdout += text;
    },
    writeError: (text) => {
      state.stderr += text;
    },
    readFile: async () => {
      state.inputReads++;
      return input;
    },
    readStdin: async () => {
      state.stdinReads++;
      return input;
    },
    readBinaryFile: async () => Buffer.from(input, "utf8"),
    readBinaryStdin: async () => Buffer.from(input, "utf8"),
    writeFile: async (path, text) => {
      state.files.set(path, text);
    },
  };
  const runtime: RuntimePort = {
    listOperations: (filter) => {
      state.filters.push(filter);
      return { operations: [operation], total: 1 };
    },
    describe: (id) => {
      if (id !== operation.id) throw new HcmError("UNKNOWN_OPERATION", "Unknown operation.");
      return operation;
    },
    getOperationEffect: () => "read",
    call: async (id, args = {}) => {
      state.calls.push({ id, args });
      return {
        ok: true,
        data: args,
        meta: { operationId: id, connection: config.name, durationMs: 1 },
      };
    },
    close: async () => {
      state.closes++;
    },
  };
  const dependencies: CliDependencies = {
    loadConfiguration: () => {
      state.loads++;
      return config;
    },
    createRuntime: () => runtime,
    runMcp: async () => {
      state.mcpRuns++;
    },
  };
  return { state, io, runtime, dependencies };
}

test("парсер принимает глобальные флаги где угодно и не повторяет в ответе неизвестные секретные аргументы argv", () => {
  assert.deepEqual(parseArguments(["status", "--connection=x", "--json"]).options, {
    connection: "x",
    json: true,
  });
  for (const argv of [
    ["--password=synthetic-secret"],
    ["--config"],
    ["--stdin", "--args", "{}"],
    ["--connection", "x", "--connection", "y"],
    ["--json=true"],
  ]) {
    assert.throws(
      () => parseArguments(argv),
      (error: unknown) =>
        error instanceof CliInputError && !error.message.includes("synthetic-secret"),
    );
  }
  assert.deepEqual(parseArguments(["query", "--", "--literal"]).positionals, [
    "query",
    "--literal",
  ]);
});

const commandCases: {
  argv: string[];
  input?: string;
  id: string;
  args: Record<string, unknown>;
}[] = [
  { argv: ["status"], id: "runtime.status", args: {} },
  { argv: ["server", "info"], id: "server.info", args: {} },
  {
    argv: ["server", "info", "--profile", "web"],
    id: "server.info",
    args: { profile: "web" },
  },
  {
    argv: ["run", "--stdin"],
    input:
      '{"steps":[{"id":"objects.get","args":{"type":"collaborator","id":"1"},"as":"person"},{"id":"objects.patch","args":{"id":{"$ref":"person.data.id"},"patch":{"name":"Changed"}}}],"stopOnError":true}',
    id: "runtime.batch",
    args: {
      steps: [
        { id: "objects.get", args: { type: "collaborator", id: "1" }, as: "person" },
        {
          id: "objects.patch",
          args: { id: { $ref: "person.data.id" }, patch: { name: "Changed" } },
        },
      ],
      stopOnError: true,
    },
  },
  {
    argv: ["api", "call", "native.lds.loadDoc", "--stdin"],
    input: '{"url":"x-local://wt_data/objects/01.xml"}',
    id: "native.lds.loadDoc",
    args: { url: "x-local://wt_data/objects/01.xml" },
  },
  {
    argv: ["query", "(1)", "--limit", "1", "--start-position", "2"],
    id: "runtime.query",
    args: { query: "(1)", limit: 1, startPosition: 2 },
  },
  {
    argv: ["query", "--input-file", "query.xquery"],
    input: "(1)",
    id: "runtime.query",
    args: { query: "(1)" },
  },
  {
    // Windows PowerShell 5.1 и cmd требуют \" внутри аргумента; PowerShell 7 и bash тогда передают и обратные косые черты.
    argv: ["query", "--catalog", "collaborators", "--where", '{\\"code\\":\\"synthetic\\"}'],
    id: "runtime.query",
    args: { catalog: "collaborators", where: { code: "synthetic" } },
  },
  {
    argv: ["rpc", "tools", "get_version", "--args", '[\\"wtv\\"]'],
    id: "rpc.call",
    args: { library: "tools", method: "get_version", arguments: ["wtv"] },
  },
  {
    argv: ["query", "(1)", "--fields", "id,name"],
    id: "runtime.query",
    args: { query: "(1)", fields: ["id", "name"] },
  },
  {
    argv: ["query", "--input-file", "query.json", "--limit", "5"],
    input: ' {"catalog":"collaborators","where":{"code":"synthetic"},"fields":["id"],"limit":10}',
    id: "runtime.query",
    args: { catalog: "collaborators", where: { code: "synthetic" }, fields: ["id"], limit: 5 },
  },
  {
    argv: [
      "query",
      "--catalog",
      "collaborators",
      "--where",
      '{"code":"synthetic"}',
      "--fields",
      "id,fullname",
    ],
    id: "runtime.query",
    args: { catalog: "collaborators", where: { code: "synthetic" }, fields: ["id", "fullname"] },
  },
  {
    argv: ["query", "--catalog", "collaborators", "--order", " fullname, hire_date desc ,"],
    id: "runtime.query",
    args: { catalog: "collaborators", order: ["fullname", "hire_date desc"] },
  },
  // Шим npm в PowerShell получает id,fullname без кавычек как массив и склеивает его через пробел.
  {
    argv: ["query", "--catalog", "collaborators", "--fields", "id fullname"],
    id: "runtime.query",
    args: { catalog: "collaborators", fields: ["id", "fullname"] },
  },
  {
    argv: ["query", "--catalog", "collaborators", "--order", "hire_date DESC fullname code asc"],
    id: "runtime.query",
    args: { catalog: "collaborators", order: ["hire_date DESC", "fullname", "code asc"] },
  },
  {
    argv: ["schema", "collaborator", "--origin", "own custom", "--include", "methods"],
    id: "schema.get",
    args: { type: "collaborator", origin: ["own", "custom"], include: ["methods"] },
  },
  {
    argv: ["object", "get", "--ids", "0x8000000000000001 7"],
    id: "objects.get",
    args: { ids: ["0x8000000000000001", "7"] },
  },
  {
    argv: ["object", "get", "0x8000000000000001", "--fields", "id,name"],
    id: "objects.get",
    args: { id: "0x8000000000000001", fields: ["id", "name"] },
  },
  {
    argv: ["object", "get", "7", "--type", "collaborator"],
    id: "objects.get",
    args: { id: "7", type: "collaborator" },
  },
  {
    argv: ["object", "patch", "7", "--args", '{"name":"Changed"}'],
    id: "objects.patch",
    args: { id: "7", patch: { name: "Changed" } },
  },
  {
    argv: ["object", "delete", "7", "--permanent"],
    id: "objects.delete",
    args: { id: "7", permanent: true },
  },
  {
    argv: ["object", "get", "collaborator", "9007199254740993", "--fields", "id,name"],
    id: "objects.get",
    args: { type: "collaborator", id: "9007199254740993", fields: ["id", "name"] },
  },
  {
    argv: ["object", "get", "--id", "0x8000000000000001", "--fields", "id,name"],
    id: "objects.get",
    args: { id: "0x8000000000000001", fields: ["id", "name"] },
  },
  {
    argv: ["object", "get", "--ids", "0x8000000000000001, 7", "--fields", "name"],
    id: "objects.get",
    args: { ids: ["0x8000000000000001", "7"], fields: ["name"] },
  },
  {
    argv: ["object", "get", "--url", "x-local://wt_data/owned.xml", "--type", "collaborator"],
    id: "objects.get",
    args: { url: "x-local://wt_data/owned.xml", type: "collaborator" },
  },
  {
    argv: ["object", "create", "education_mode", "--stdin"],
    input: '{"name":"Synthetic"}',
    id: "objects.create",
    args: { type: "education_mode", data: { name: "Synthetic" } },
  },
  {
    argv: [
      "object",
      "create",
      "education_mode",
      "--stdin",
      "--form-url",
      "x-local://wtv/custom.xmd",
      "--db-name",
      "wt_data",
    ],
    input: '{"name":"Synthetic"}',
    id: "objects.create",
    args: {
      type: "education_mode",
      data: { name: "Synthetic" },
      formUrl: "x-local://wtv/custom.xmd",
      dbName: "wt_data",
    },
  },
  {
    argv: [
      "object",
      "patch",
      "education_mode",
      "1",
      "--args",
      '{"name":"Changed"}',
      "--expected-fingerprint",
      "hash",
      "--preview",
    ],
    id: "objects.patch",
    args: {
      type: "education_mode",
      id: "1",
      patch: { name: "Changed" },
      expectedFingerprint: "hash",
      preview: true,
    },
  },
  {
    argv: ["object", "delete", "education_mode", "1", "--permanent"],
    id: "objects.delete",
    args: { type: "education_mode", id: "1", permanent: true },
  },
  {
    argv: [
      "object",
      "patch",
      "--id",
      "9007199254740993",
      "--type",
      "education_mode",
      "--stdin",
      "--expected-fingerprint",
      "hash",
      "--preview",
    ],
    input: '[{"op":"remove","path":"items[0]"}]',
    id: "objects.patch",
    args: {
      id: "9007199254740993",
      type: "education_mode",
      patch: [{ op: "remove", path: "items[0]" }],
      expectedFingerprint: "hash",
      preview: true,
    },
  },
  {
    argv: ["object", "patch", "--url", "x-local://wt_data/owned.xml", "--input-file", "patch.json"],
    input: '{"name":"Changed"}',
    id: "objects.patch",
    args: { url: "x-local://wt_data/owned.xml", patch: { name: "Changed" } },
  },
  {
    argv: ["object", "delete", "--id", "0x8000000000000001", "--permanent"],
    id: "objects.delete",
    args: { id: "0x8000000000000001", permanent: true },
  },
  {
    argv: [
      "object",
      "delete",
      "--url",
      "x-local://wt_data/owned.xml",
      "--type",
      "education_mode",
      "--permanent",
      "--catalog",
      "education_modes",
    ],
    id: "objects.delete",
    args: {
      url: "x-local://wt_data/owned.xml",
      type: "education_mode",
      permanent: true,
      catalog: "education_modes",
    },
  },
  {
    argv: [
      "object",
      "delete",
      "education_mode",
      "1",
      "--permanent",
      "--catalog",
      "education_modes",
    ],
    id: "objects.delete",
    args: { type: "education_mode", id: "1", permanent: true, catalog: "education_modes" },
  },
  {
    argv: ["doc", "get", "x-local://wt_data/synthetic.xml"],
    id: "native.lds.loadDoc",
    args: { url: "x-local://wt_data/synthetic.xml" },
  },
  {
    argv: [
      "doc",
      "put",
      "x-local://wt_data/synthetic.xml",
      "--args",
      '{"data":"<root/>","neverSaved":true}',
    ],
    id: "native.lds.putDoc",
    args: { data: "<root/>", neverSaved: true, url: "x-local://wt_data/synthetic.xml" },
  },
  {
    argv: ["doc", "delete", "x-local://wt_data/synthetic.xml"],
    id: "native.lds.deleteDoc",
    args: { url: "x-local://wt_data/synthetic.xml" },
  },
  {
    argv: ["files", "list", "x-local://wtv"],
    id: "files.list",
    args: { url: "x-local://wtv" },
  },
  {
    argv: ["files", "exists", "x-local://Share/Папка/📄A%2FB (draft).txt"],
    id: "files.exists",
    args: { url: "x-local://Share/Папка/📄A%2FB (draft).txt" },
  },
  {
    argv: ["files", "exists", "x-local://Share"],
    id: "files.exists",
    args: { url: "x-local://Share" },
  },
  {
    argv: ["files", "exists", "x-local://share/" + "a".repeat(240)],
    id: "files.exists",
    args: { url: "x-local://share/" + "a".repeat(240) },
  },
  {
    argv: ["rpc", "tools", "synthetic_method", "--stdin", "--async"],
    input: '[{"valueType":"integer","lexicalValue":"9007199254740993"}]',
    id: "rpc.call",
    args: {
      library: "tools",
      method: "synthetic_method",
      arguments: [{ valueType: "integer", lexicalValue: "9007199254740993" }],
      async: true,
    },
  },
  {
    argv: [
      "rpc",
      "list",
      "--query",
      "version",
      "--library",
      "tools",
      "--method",
      "get_version",
      "--built-in",
      "--limit",
      "20",
      "--cursor",
      "2",
    ],
    id: "rpc.list",
    args: {
      query: "version",
      library: "tools",
      method: "get_version",
      builtIn: true,
      limit: 20,
      cursor: 2,
    },
  },
  {
    argv: ["rpc", "describe", "tools.get_version", "--built-in", "--source"],
    id: "rpc.describe",
    args: { targetId: "tools.get_version", builtIn: true, source: true },
  },
  {
    argv: ["doc", "put", "x-local://wt_data/synthetic.xml", "--input-file", "document.xml"],
    input: "<root/>",
    id: "native.lds.putDoc",
    args: { data: "<root/>", url: "x-local://wt_data/synthetic.xml" },
  },
  {
    argv: [
      "file",
      "upload",
      "synthetic.bin",
      "--input-file",
      "resource.bin",
      "--content-type",
      "application/octet-stream",
    ],
    input: "A",
    id: "web.pages.uploadFile",
    args: {
      filename: "synthetic.bin",
      data: { base64: "QQ==" },
      contentType: "application/octet-stream",
    },
  },
  {
    argv: ["object", "patch", "education_mode", "1", "--stdin"],
    input: '[{"op":"remove","path":"items[0]"}]',
    id: "objects.patch",
    args: { type: "education_mode", id: "1", patch: [{ op: "remove", path: "items[0]" }] },
  },
  {
    // Аргументы инструмента MCP в том виде, как агент скопировал бы их в файл.
    argv: ["object", "patch", "education_mode", "1", "--stdin", "--preview"],
    input: '{"patch":{"name":"Changed"},"remove":["comment"]}',
    id: "objects.patch",
    args: {
      type: "education_mode",
      id: "1",
      patch: { name: "Changed" },
      remove: ["comment"],
      preview: true,
    },
  },
  {
    argv: ["object", "patch", "education_mode", "1", "--stdin"],
    input: '{"remove":["comment"]}',
    id: "objects.patch",
    args: { type: "education_mode", id: "1", remove: ["comment"] },
  },
  {
    // Поле документа может называться patch: простое значение — это значение.
    argv: ["object", "patch", "education_mode", "1", "--stdin"],
    input: '{"patch":"v2","name":"Changed"}',
    id: "objects.patch",
    args: { type: "education_mode", id: "1", patch: { patch: "v2", name: "Changed" } },
  },
  {
    argv: ["exec", "--stdin"],
    input: "RESULT=[{value:1}];",
    id: "execute.script",
    args: { code: "RESULT=[{value:1}];" },
  },
  {
    argv: ["exec", "--stdin", "--params", '{\\"ids\\":[\\"0x1\\"]}'],
    input: "RESULT=PARAMS.ids;",
    id: "execute.script",
    args: { code: "RESULT=PARAMS.ids;", params: { ids: ["0x1"] } },
  },
  {
    argv: ["result", "read", "synthetic-result", "--offset", "2", "--limit", "100"],
    id: "results.read",
    args: { resultId: "synthetic-result", offset: 2, limit: 100 },
  },
  {
    argv: ["result", "export", "synthetic-result", "--to", "out.json"],
    id: "results.export",
    args: { resultId: "synthetic-result", path: "out.json", overwrite: false },
  },
  {
    argv: ["result", "read", "synthetic-result", "--format", "json"],
    id: "results.read",
    args: { resultId: "synthetic-result", format: "json" },
  },
  {
    argv: ["result", "read", "synthetic-result", "--offset", "1000000"],
    id: "results.read",
    args: { resultId: "synthetic-result", offset: 1000000 },
  },
  { argv: ["schema", "education_mode"], id: "schema.get", args: { type: "education_mode" } },
  {
    argv: ["schema", "education_mode", "--path", "doc_info", "--deep"],
    id: "schema.get",
    args: { type: "education_mode", path: "doc_info", deep: true },
  },
  {
    argv: [
      "schema",
      "education_mode",
      "--search=name",
      "--path=doc_info",
      "--origin=own,inherited,custom",
      "--kind=9007199254740993",
      "--include=methods",
      "--language=english",
      "--limit=5",
      "--cursor=2",
    ],
    id: "schema.get",
    args: {
      type: "education_mode",
      search: "name",
      path: "doc_info",
      origin: ["own", "inherited", "custom"],
      kind: "9007199254740993",
      include: ["methods"],
      language: "english",
      limit: 5,
      cursor: 2,
    },
  },
  {
    argv: ["types", "--search=collab", "--limit=5", "--cursor=2"],
    id: "schema.types",
    args: { search: "collab", limit: 5, cursor: 2 },
  },
  {
    argv: [
      "logs",
      "list",
      "--type",
      "xhttp",
      "--name-contains",
      "http",
      "--date",
      "2026-09-30",
      "--offset",
      "2",
      "--limit",
      "10",
    ],
    id: "logs.list",
    args: {
      type: "xhttp",
      nameContains: "http",
      startDate: "2026-09-30",
      endDate: "2026-09-30",
      offset: 2,
      limit: 10,
    },
  },
  {
    argv: ["logs", "read", "xhttp_2026-09-30.log", "--full"],
    id: "logs.read",
    args: { file: "xhttp_2026-09-30.log", full: true },
  },
  {
    argv: ["logs", "tail", "xhttp_2026-09-30.log", "--tail-bytes", "65536"],
    id: "logs.read",
    args: { file: "xhttp_2026-09-30.log", tailBytes: 65536 },
  },
  {
    argv: [
      "logs",
      "search",
      "xhttp_2026-09-30.log",
      "--text",
      "frame",
      "--level",
      "error",
      "--context",
      "r2",
      "--offset",
      "10",
      "--limit",
      "20",
      "--expected-fingerprint",
      "synthetic",
    ],
    id: "logs.search",
    args: {
      file: "xhttp_2026-09-30.log",
      text: "frame",
      level: "error",
      context: "r2",
      offset: 10,
      limit: 20,
      expectedFingerprint: "synthetic",
    },
  },
  {
    argv: ["logs", "follow", "xhttp_2026-09-30.log", "--cursor", "opaque", "--tail-bytes", "32768"],
    id: "logs.follow",
    args: { file: "xhttp_2026-09-30.log", cursor: "opaque", tailBytes: 32768 },
  },
];

for (const entry of commandCases)
  test(`команда CLI ${entry.argv.slice(0, 2).join(" ")} собирает один явный вызов и закрывается один раз`, async () => {
    const f = fixture(entry.input);
    const code = await runCli(entry.argv, f.io, f.dependencies);
    assert.equal(code, 0, f.state.stderr);
    assert.deepEqual(f.state.calls, [{ id: entry.id, args: entry.args }]);
    assert.equal(f.state.closes, 1);
    assert.equal(f.state.stderr, "");
    const result = JSON.parse(f.state.stdout) as OperationResult;
    assert.equal(result.ok, true);
    assert.equal(result.meta.operationId, entry.id);
  });

/** Команда, которая должна отвечать без подключения. */
async function offline(argv: string[]) {
  const f = fixture();
  assert.equal(await runCli(argv, f.io, f.dependencies), 0, argv.join(" "));
  assert.equal(f.state.loads, 0);
  assert.equal(f.state.closes, 0);
  assert.equal(f.state.stderr, "");
  return f.state;
}

test("отказ до вызова операции называет команды CLI, а неизвестный ID — как его передали", async () => {
  const f = fixture();
  assert.equal(
    await runCli(["api", "describe", "objects.gett", "--offline"], f.io, f.dependencies),
    1,
  );
  const { error } = JSON.parse(f.state.stderr || f.state.stdout) as OperationResult;
  assert.equal(error?.message, "Операции objects.gett нет.");
  assert.equal(
    error?.hint,
    "Похожие: objects.get, schema.get. Список операций показывает wtctl api list.",
  );
});

test("справка — текст для чтения: команды и параметры в колонках, использование и заметки команды по одной в строке", async () => {
  const top = (await offline([])).stdout;
  assert.equal((await offline(["help"])).stdout, top);
  assert.ok(top.startsWith("wtctl [--config ФАЙЛ] [--connection ИМЯ] КОМАНДА …\n\nКоманды:\n"));
  assert.match(
    top,
    /\n {2}status {3}— Адрес и версия сервера, пользователь и права подключения.\n {2}check {4}— /,
  );
  assert.match(top, /\n\nПараметры:\n {2}--config ФАЙЛ +— Файл подключений\.\n/);
  assert.match(top, /\n\nАргументы и примеры команды: wtctl help КОМАНДА\.\n/);
  assert.match(top, /help и guide печатают текст/);

  const query = cliHelp("query") as { usage: string[]; notes: string[] };
  assert.equal(
    (await offline(["query", "--help"])).stdout,
    [
      "wtctl query — Поиск в каталоге; запрос XQuery.",
      "",
      ...query.usage.map((line) => `  ${line}`),
      "",
      ...query.notes,
      "",
    ].join("\n"),
  );
  assert.equal(
    (await offline(["help", "status"])).stdout,
    "wtctl status — Адрес и версия сервера, пользователь и права подключения.\n\n  wtctl status\n",
  );
  assert.equal(
    (await offline(["help", "logs", "search"])).stdout,
    (await offline(["help", "logs"])).stdout,
  );

  for (const name of ["nothing", "constructor"]) {
    const unknown = (await offline(["help", name])).stdout;
    assert.ok(unknown.startsWith(`Неизвестная команда: ${name}.\n\nКоманды:\n  status `), name);
  }

  // Параметры, набранные перед --help, относятся к команде; help help — это главная справка.
  assert.equal(
    (await offline(["query", "--catalog", "people", "--help"])).stdout,
    (await offline(["help", "query"])).stdout,
  );
  assert.equal((await offline(["help", "help"])).stdout, top);

  const saved = await offline(["help", "query", "--output", "query.txt"]);
  assert.equal(saved.stdout, "");
  assert.equal(saved.files.get("query.txt"), (await offline(["help", "query"])).stdout);
});

test("JSON в аргументе справка пишет как '{\\\"…\\\"}': так его передают и Windows PowerShell 5.1, и PowerShell 7, и bash", () => {
  const usage = Object.keys(cliHelp().commands as object).flatMap(
    (command) => (cliHelp(command) as { usage: string[] }).usage,
  );
  const inline = usage.flatMap((line) => line.match(/'[[{][^']*'/g) ?? []);
  assert.ok(inline.length >= 5, inline.join(" "));
  for (const json of inline) {
    assert.match(json, /\\"/, json);
    assert.doesNotMatch(json, /(?<!\\)"/, json);
  }
});

test("help --json даёт ту же справку, что и обычный ответ", async () => {
  for (const [argv, command] of [
    [["--json"], undefined],
    [["help", "--json"], undefined],
    [["object", "--help", "--json"], "object"],
    [["help", "nothing", "--json"], "nothing"],
  ] as const) {
    const result = JSON.parse((await offline([...argv])).stdout) as OperationResult;
    assert.equal(result.ok, true);
    assert.equal(result.meta.operationId, "cli.help");
    assert.deepEqual(result.data, cliHelp(command));
  }
});

test("config example не требует runtime и настроек и содержит только ссылки на переменные окружения", async () => {
  const { stdout } = await offline(["config", "example"]);
  assert.equal(JSON.parse(stdout).ok, true);
  assert.match(stdout, /WTCTL_PASSWORD/);
  assert.doesNotMatch(stdout, /"password":/);
});

test("--order сортирует поиск по каталогу; с текстом XQuery он отклоняется, и ответ говорит, что писать", async () => {
  const io = fixture('{"catalog":"collaborators","order":["fullname","hire_date desc"]}').io;
  const file = await commandInvocation(parseArguments(["query", "--input-file", "q.json"]), io);
  assert.deepEqual(file.args, { catalog: "collaborators", order: ["fullname", "hire_date desc"] });
  const both = await commandInvocation(
    parseArguments(["query", "--input-file", "q.json", "--order", "code"]),
    io,
  );
  assert.deepEqual(both.args, { catalog: "collaborators", order: ["code"] });

  for (const [argv, input] of [
    [["query", "for $e in collaborators return $e", "--order", "fullname"], "{}"],
    [["query", "--input-file", "q.xquery", "--order", "fullname"], "for $e in groups return $e"],
    [["query", "--input-file", "q.json", "--order", "fullname"], '{"query":"(1)"}'],
  ] as const) {
    const f = fixture(input);
    assert.equal(await runCli([...argv], f.io, f.dependencies), 2, argv.join(" "));
    assert.equal(f.state.loads, 0);
    assert.equal(
      JSON.parse(f.state.stderr).error.message,
      "--order работает с --catalog; в тексте XQuery сортировку пишут сами: order by $e/поле",
    );
  }
});

test("обзор api сохраняет точные описания операций и фильтры страниц", async () => {
  const f = fixture();
  assert.equal(
    await runCli(
      [
        "api",
        "list",
        "--effect",
        "unknown",
        "--query",
        "load",
        "--group",
        "lds",
        "--cursor",
        "5",
        "--limit",
        "20",
      ],
      f.io,
      f.dependencies,
    ),
    0,
  );
  assert.deepEqual(f.state.filters, [
    { effect: "unknown", query: "load", group: "lds", cursor: 5, limit: 20 },
  ]);
  assert.equal(f.state.calls.length, 0);
  const g = fixture();
  assert.equal(await runCli(["api", "describe", operation.id], g.io, g.dependencies), 0);
  assert.deepEqual(JSON.parse(g.state.stdout).data, operationHelp(operation));
});

test("обзор с --offline читает точные метаданные из пакета без настроек и учётных данных", async () => {
  for (const action of ["list", "describe"] as const) {
    const f = fixture();
    let creations = 0;
    f.dependencies.loadConfiguration = () => {
      f.state.loads++;
      throw new HcmError("INVALID_CONFIG", "Synthetic profile password is unavailable.");
    };
    f.dependencies.createRuntime = () => {
      creations++;
      return f.runtime;
    };
    const command =
      action === "describe"
        ? ["api", "describe", operation.id]
        : ["api", "list", "--query", operation.id, "--effect", "read", "--limit", "1"];
    assert.equal(
      await runCli(
        [
          ...command,
          "--offline",
          "--config",
          "synthetic-missing-profile.json",
          "--connection",
          "unavailable",
        ],
        f.io,
        f.dependencies,
      ),
      0,
    );
    const result = JSON.parse(f.state.stdout);
    assert.equal(result.ok, true);
    assert.deepEqual(result.meta, {
      operationId: `api.${action}`,
      connection: "unselected",
      durationMs: 0,
    });
    if (action === "describe")
      assert.deepEqual(result.data, operationHelp(describeHcmOperation(operation.id)));
    else {
      assert.equal(result.data.operations.length, 1);
      assert.equal(result.data.operations[0].id, operation.id);
      assert.equal(result.data.operations[0].effect, "read");
      assert.equal(result.data.operations[0].inputSchema, undefined);
      assert.ok(result.data.total >= 1);
    }
    assert.equal(f.state.inputReads, 0);
    assert.equal(f.state.stdinReads, 0);
    assert.equal(f.state.loads, 0);
    assert.equal(creations, 0);
    assert.equal(f.state.closes, 0);
    assert.equal(f.state.calls.length, 0);
    assert.equal(f.state.filters.length, 0);
    assert.equal(f.state.stderr, "");
  }
});

test("обзор с --offline сохраняет разбивку на страницы и общий вид ответа в файле вывода", async () => {
  const expected = listHcmOperations({ limit: 6 }).operations.map((item) => item.id);
  assert.equal(expected.length, 6);
  const visited: string[] = [];
  for (const cursor of [0, 3]) {
    const f = fixture();
    f.dependencies.loadConfiguration = () => {
      f.state.loads++;
      throw new HcmError("INVALID_CONFIG", "Synthetic profile password is unavailable.");
    };
    assert.equal(
      await runCli(
        [
          "api",
          "list",
          "--offline",
          "--json",
          "--cursor",
          String(cursor),
          "--limit",
          "3",
          "--output",
          "offline-result.json",
        ],
        f.io,
        f.dependencies,
      ),
      0,
    );
    const saved = JSON.parse(f.state.files.get("offline-result.json")!);
    assert.equal(saved.ok, true);
    assert.equal(saved.meta.operationId, "api.list");
    assert.equal(saved.meta.connection, "unselected");
    assert.equal(saved.data.nextCursor, cursor + 3);
    assert.equal(saved.data.operations.length, 3);
    visited.push(...saved.data.operations.map((item: { id: string }) => item.id));
    const receipt = JSON.parse(f.state.stdout);
    assert.deepEqual(receipt.data, { saved: true, output: "offline-result.json" });
    assert.deepEqual(receipt.meta, saved.meta);
    assert.equal(f.state.loads, 0);
    assert.equal(f.state.closes, 0);
    assert.equal(f.state.calls.length, 0);
    assert.equal(f.state.filters.length, 0);
    assert.equal(f.state.stderr, "");
  }
  assert.deepEqual(visited, expected);
  assert.equal(new Set(visited).size, 6);
});

test("--offline отклоняет несовместимые команды, ввод и пароль до локального ввода-вывода", async () => {
  const cases = [
    ["api", "list", "--offline", "--password-stdin"],
    ["api", "describe", operation.id, "--offline", "--password-stdin"],
    ["api", "list", "--offline", "--stdin"],
    ["api", "describe", operation.id, "--offline", "--input-file", "unused.json"],
    ["api", "list", "--offline", "--args", "{}"],
    ["api", "list", "--offline", "--limit", "0"],
    ["api", "list", "--offline", "--cursor", "not-a-number"],
    ["api", "list", "--offline=true"],
    ["status", "--offline"],
    ["api", "call", operation.id, "--offline", "--args", "{}"],
    ["mcp", "--offline"],
  ];
  for (const command of cases) {
    const f = fixture("synthetic-password\n");
    let creations = 0;
    f.dependencies.createRuntime = () => {
      creations++;
      return f.runtime;
    };
    assert.equal(await runCli(command, f.io, f.dependencies), 2, command.join(" "));
    assert.equal(f.state.inputReads, 0);
    assert.equal(f.state.stdinReads, 0);
    assert.equal(f.state.loads, 0);
    assert.equal(creations, 0);
    assert.equal(f.state.closes, 0);
    assert.equal(f.state.calls.length, 0);
    assert.equal(f.state.filters.length, 0);
    assert.equal(f.state.stdout, "");
    assert.equal(JSON.parse(f.state.stderr).error.code, "cli.invalid_input");
  }
});

test("компактный обзор проходит каждую операцию по страницам один раз, не встраивая огромные схемы", async () => {
  const definitions: OperationDefinition[] = Array.from({ length: 80 }, (_, index) => ({
    ...operation,
    id: "native.synthetic.read_" + index,
    title: "Synthetic operation " + index,
    description: "Проверенный договор операции. ".repeat(100),
    inputSchema: {
      type: "object",
      properties: { value: { const: "synthetic-schema-only-".repeat(10000) } },
    },
  }));
  const visited: string[] = [];
  let cursor = 0;
  for (let pageNumber = 0; pageNumber < 20; pageNumber++) {
    const f = fixture();
    f.runtime.listOperations = (filter) => ({
      operations: definitions.slice(
        filter?.cursor ?? 0,
        (filter?.cursor ?? 0) + (filter?.limit ?? 30),
      ),
      total: definitions.length,
    });
    assert.equal(
      await runCli(
        ["api", "list", "--limit", "100", "--cursor", String(cursor)],
        f.io,
        f.dependencies,
      ),
      0,
    );
    assert.ok(Buffer.byteLength(f.state.stdout) < 16500);
    assert.doesNotMatch(f.state.stdout, /synthetic-schema-only/);
    const page = JSON.parse(f.state.stdout).data as {
      operations: { id: string; inputSchema?: unknown }[];
      total: number;
      nextCursor?: number;
    };
    assert.equal(page.total, definitions.length);
    assert.ok(page.operations.length > 0);
    for (const card of page.operations) {
      assert.equal(card.inputSchema, undefined);
      visited.push(card.id);
    }
    if (page.nextCursor === undefined) break;
    assert.equal(page.nextCursor, cursor + page.operations.length);
    cursor = page.nextCursor;
  }
  assert.deepEqual(
    visited,
    definitions.map((item) => item.id),
  );
});

test("неверные фильтры api list отказывают до пароля, настроек и runtime", async () => {
  const cases = [
    ["--effect", "not-an-effect"],
    ["--cursor", "not-a-number"],
    ["--cursor", "-1"],
    ["--cursor", "9007199254740992"],
    ["--limit", "not-a-number"],
    ["--limit", "0"],
    ["--limit", "101"],
  ];
  for (const filter of cases) {
    const f = fixture("synthetic-password\n");
    let creations = 0;
    const createRuntime = f.dependencies.createRuntime;
    f.dependencies.createRuntime = (configuration) => {
      creations++;
      return createRuntime(configuration);
    };
    assert.equal(
      await runCli(["api", "list", ...filter, "--password-stdin"], f.io, f.dependencies),
      2,
      filter.join(" "),
    );
    assert.equal(f.state.stdinReads, 0);
    assert.equal(f.state.loads, 0);
    assert.equal(creations, 0);
    assert.equal(f.state.closes, 0);
    assert.equal(f.state.calls.length, 0);
    assert.equal(f.state.filters.length, 0);
    assert.equal(f.state.stdout, "");
    assert.equal(JSON.parse(f.state.stderr).error.code, "cli.invalid_input");
  }
});

test("неверные команда, ввод и пределы отказывают до настроек и сети", async () => {
  const cases = [
    ["unknown"],
    ["status", "extra"],
    ["server"],
    ["server", "unknown"],
    ["server", "info", "extra"],
    ["server", "info", "--profile", "legacy"],
    ["server", "info", "--profile"],
    ["server", "info", "--args", "{}"],
    ["query"],
    ["query", "(1)", "--limit", "1001"],
    ["query", "(1)", "--stdin"],
    ["query", "(1)", "--catalog", "c"],
    ["query", "(1)", "--where", "{}"],
    ["types", "--deep"],
    ["object", "create", "education_mode", "--stdin"],
    ["object", "patch", "education_mode", "1"],
    ["object", "delete", "education_mode", "1", "--stdin"],
    ["object", "delete", "education_mode", "1"],
    ["object", "get"],
    ["object", "get", "a", "b", "c"],
    ["object", "get", "7", "--id", "7"],
    ["object", "get", "", "7"],
    ["object", "get", "collaborator", "0xZZ"],
    ["object", "delete", "--url", "x-local://wt_data/owned.xml", "--id", "7", "--permanent"],
    ["rpc", "tools"],
    ["exec"],
    ["result", "write", "id"],
    ["mcp", "--output", "out.json"],
    ["mcp", "--password-stdin"],
    ["status", "--password-stdin", "--stdin"],
    ["help", "--password-stdin"],
    ["run"],
    ["result", "read", "id", "--format", "xml"],
    ["result", "read", "id", "--limit", "65537"],
    ["file", "upload"],
    ["file", "upload", "synthetic.bin"],
    ["file", "upload", "synthetic.bin", "--args", "{}"],
    ["file", "get", "synthetic.bin", "--content-type", "text/plain"],
    ["rpc", "describe"],
    ["rpc", "describe", "tools.get_version", "--args", "[]"],
    ["rpc", "list", "--source"],
    ["rpc", "list", "--limit", "101"],
    ["rpc", "list", "--stdin"],
    ["logs"],
    ["logs", "unknown"],
    ["logs", "read"],
    ["logs", "read", "x.log", "--full", "--tail-bytes", "1"],
    ["logs", "tail", "x.log", "--full"],
    ["logs", "search", "x.log", "--level", "fatal"],
    ["logs", "list", "--date", "2026-09-30", "--start-date", "2026-09-01"],
    ["logs", "follow", "x.log", "--tail-bytes", "0"],
  ];
  for (const argv of cases) {
    const f = fixture("[]");
    assert.equal(await runCli(argv, f.io, f.dependencies), 2, argv.join(" "));
    assert.equal(f.state.loads, 0);
    assert.equal(f.state.calls.length, 0);
    assert.equal(f.state.stdout, "");
    assert.equal(JSON.parse(f.state.stderr).error.code, "cli.invalid_input");
  }
  // Параметр, которого команда не принимает, назван, и приведена справка со списком принимаемых.
  const named = fixture("[]");
  await runCli(["schema", "--type", "collaborator", "--deep"], named.io, named.dependencies);
  const refusal = JSON.parse(named.state.stderr).error;
  assert.equal(refusal.message, "Команда schema не принимает: --type.");
  assert.equal(refusal.hint, "Справка: wtctl help schema.");
});

test("ошибка разбора называет неизвестный флаг без значения, похожий настоящий и справку команды", async () => {
  const refuse = async (argv: string[]) => {
    const f = fixture();
    assert.equal(await runCli(argv, f.io, f.dependencies), 2, argv.join(" "));
    assert.doesNotMatch(f.state.stderr, /synthetic-secret/);
    const { error } = JSON.parse(f.state.stderr) as { error: Record<string, string> };
    assert.equal(error.code, "cli.invalid_input");
    return error;
  };
  const typo = await refuse(["query", "--catalog", "groups", "--feilds=synthetic-secret"]);
  assert.equal(typo.message, "Неизвестный флаг --feilds.");
  assert.equal(typo.hint, "Похожий: --fields. Справка: wtctl help query.");
  // Пароль в argv назван по имени флага, о паролях подсказка есть только здесь.
  const secret = await refuse(["--connection", "x", "status", "--password", "synthetic-secret"]);
  assert.equal(secret.message, "Неизвестный флаг --password.");
  assert.match(
    secret.hint!,
    /^Пароль в командной строке не принимается: .+ Справка: wtctl help status\.$/,
  );
  assert.doesNotMatch(typo.hint!, /Пароль/);
  // То, что не похоже на имя флага, не печатается.
  for (const odd of ["--synthetic-secret!", "--a3f9c07e1b"]) {
    const error = await refuse(["status", odd]);
    assert.equal(error.message, "Неизвестный флаг.");
    assert.equal(error.hint, "Справка: wtctl help status.");
  }
  assert.doesNotMatch((await refuse(["query", "--author"])).hint!, /Пароль/);

  const remove = await refuse(["object", "delete", "0x1"]);
  assert.equal(
    remove.hint,
    "Корзины нет: удалённый объект не вернуть. Справка: wtctl help object.",
  );
  const get = await refuse(["object", "get"]);
  assert.equal(get.message, "Не задан объект: ID, ТИП ID, --id ID или --url АДРЕС.");
  assert.equal(get.hint, "Справка: wtctl help object.");
  const both = await refuse(["query", "for $e in groups return $e", "--catalog", "groups"]);
  assert.equal(both.message, "Задан и текст XQuery, и --catalog: нужно что-то одно.");
  assert.equal((await refuse(["unknown"])).hint, "Справка: wtctl help.");
});

test("неверный синтаксис files exists и неверные URL отказывают до ввода, пароля, настроек и runtime", async () => {
  const validUrl = "x-local://share/owned.txt";
  const invalidUrls = [
    "",
    " ",
    "x-local://",
    "x-local:///path",
    "x-local:// /path",
    "X-local://share/path",
    "x-local://user@share/path",
    "x-local://share:42/path",
    "x-local://share/path?query=1",
    "x-local://share/path#fragment",
    "x-local://share\\path",
    "x-local://share/line\nbreak",
    "x-local://share/\0",
    "x-local://share/\uD800",
    "x-local://share/\uFFFE",
    "x-local://share/\uFFFF",
    "x-local://" + "a".repeat(247),
    "http://example.invalid/resource",
    "x-db-obj://wt_data/1.xml",
    "x-app://wtv/resource",
    "C:\\resource.txt",
    "relative/path",
  ];
  const cases = [
    ["files"],
    ["files", "write", validUrl],
    ["files", "exists"],
    ["files", "exists", validUrl, "extra"],
    ["files", "exists", validUrl, "--profile", "native"],
    ["files", "exists", validUrl, "--url", validUrl],
    ["files", "exists", validUrl, "--args", "{}"],
    ["files", "exists", validUrl, "--input-file", "input.json"],
    ["files", "exists", validUrl, "--stdin"],
    ["files", "exists", validUrl, "--permanent"],
    ...invalidUrls.map((url) => ["files", "exists", url]),
  ];
  for (const command of cases) {
    const f = fixture("Must not be read");
    assert.equal(
      await runCli([...command, "--password-stdin"], f.io, f.dependencies),
      2,
      JSON.stringify(command),
    );
    assert.equal(f.state.inputReads, 0);
    assert.equal(f.state.stdinReads, 0);
    assert.equal(f.state.loads, 0);
    assert.equal(f.state.calls.length, 0);
    assert.equal(f.state.closes, 0);
    assert.equal(f.state.stdout, "");
    assert.equal(JSON.parse(f.state.stderr).error.code, "cli.invalid_input");
  }
});

test("неверные цели объекта отказывают до ввода операции, пароля, настроек и runtime", async () => {
  const invalidTargets = [
    [],
    ["education_mode"],
    ["x-local://wt_data/owned.xml"],
    ["--type", "education_mode"],
    ["--id", "1", "--url", "x-local://wt_data/owned.xml"],
    ["education_mode", "--id", "1"],
    ["education_mode", "1", "--type", "education_mode"],
    ["education_mode", "1", "--id", "1"],
    ["education_mode", "1", "--url", "x-local://wt_data/owned.xml"],
    ["--url", "x-local://wt_data/owned.xml", "extra"],
    ["education_mode", "1", "extra"],
    ["--id", " "],
    ["--url", "\t"],
    ["--id", "1", "--type", " "],
    ["--id=1", "--id", "1"],
    ["--url"],
    ["--id="],
  ];
  const cases: string[][] = [];
  for (const action of ["get", "patch", "delete"])
    for (const target of invalidTargets)
      cases.push([
        "object",
        action,
        ...target,
        ...(action === "patch" ? ["--input-file", "patch.json"] : []),
        ...(action === "delete" ? ["--permanent"] : []),
        "--password-stdin",
      ]);
  for (const addressing of [
    ["--id", "1"],
    ["--url", "x-local://wt_data/owned.xml"],
  ])
    cases.push(["object", "delete", ...addressing, "--password-stdin"]);
  for (const option of ["--id", "--url", "--type"])
    cases.push([
      "object",
      "create",
      "education_mode",
      option,
      "1",
      "--input-file",
      "object.json",
      "--password-stdin",
    ]);
  for (const argv of cases) {
    const f = fixture('{"name":"Must not be read"}');
    assert.equal(await runCli(argv, f.io, f.dependencies), 2, argv.join(" "));
    assert.equal(f.state.inputReads, 0);
    assert.equal(f.state.stdinReads, 0);
    assert.equal(f.state.loads, 0);
    assert.equal(f.state.calls.length, 0);
    assert.equal(f.state.closes, 0);
    assert.equal(f.state.stdout, "");
    assert.equal(JSON.parse(f.state.stderr).error.code, "cli.invalid_input");
  }
});

test("ошибки runtime структурированы, а закрытие происходит один раз; неизвестные ошибки не показывают подробностей", async () => {
  const f = fixture();
  f.runtime.call = async () => {
    throw new Error("synthetic-private-detail");
  };
  assert.equal(await runCli(["status"], f.io, f.dependencies), 1);
  assert.equal(f.state.closes, 1);
  assert.doesNotMatch(f.state.stderr, /synthetic-private-detail/);
  const g = fixture();
  g.runtime.close = async () => {
    g.state.closes++;
    throw new Error("synthetic-private-detail");
  };
  assert.equal(await runCli(["status"], g.io, g.dependencies), 1);
  assert.equal(g.state.closes, 1);
  const cleanupResult = JSON.parse(g.state.stdout) as OperationResult;
  assert.equal(cleanupResult.error?.code, "cli.cleanup_failed");
  assert.equal(cleanupResult.error?.retryable, false);
  assert.equal(cleanupResult.meta.cleanupFailed, true);
  assert.equal(cleanupResult.meta.operationId, "runtime.status");
  assert.deepEqual(cleanupResult.data, {});
  const h = fixture();
  h.runtime.call = async () => ({
    ok: false,
    error: {
      code: "WRITE_INDETERMINATE",
      message: "Check state.",
      mutationOutcome: "indeterminate",
    },
    meta: { operationId: "objects.create", connection: config.name, durationMs: 1 },
  });
  assert.equal(await runCli(["status"], h.io, h.dependencies), 1);
  assert.equal(JSON.parse(h.state.stdout).error.mutationOutcome, "indeterminate");
  assert.equal(h.state.closes, 1);
});

test("файл вывода получает полный результат, а в stdout — только одна сводка", async () => {
  const f = fixture();
  assert.equal(await runCli(["status", "--output", "result.json"], f.io, f.dependencies), 0);
  assert.equal(f.state.files.size, 1);
  assert.equal(JSON.parse(f.state.files.get("result.json")!).meta.operationId, "runtime.status");
  assert.deepEqual(JSON.parse(f.state.stdout).data, { saved: true, output: "result.json" });
  const g = fixture();
  const failed: OperationResult = {
    ok: false,
    data: { completed: 1 },
    error: {
      code: "BATCH_FAILED",
      message: "Inspect saved partial results.",
      mutationOutcome: "indeterminate",
    },
    meta: { operationId: "runtime.batch", connection: config.name, durationMs: 1 },
  };
  g.runtime.call = async () => failed;
  assert.equal(await runCli(["status", "--output", "partial.json"], g.io, g.dependencies), 1);
  const receipt = JSON.parse(g.state.stdout) as OperationResult;
  assert.deepEqual(receipt.error, failed.error);
  assert.deepEqual(receipt.data, { saved: true, output: "partial.json" });
  assert.deepEqual(JSON.parse(g.state.files.get("partial.json")!), failed);
});

test("--output не пишет файл, если команда остановилась до операции: неверные аргументы или настройки подключения", async () => {
  const f = fixture();
  assert.equal(await runCli(["status", "extra", "--output", "o.json"], f.io, f.dependencies), 2);
  assert.equal(JSON.parse(f.state.stderr).error.code, "cli.invalid_input");
  const g = fixture();
  g.dependencies.loadConfiguration = () => {
    throw new HcmError("INVALID_CONFIG", "Synthetic: no such connection.");
  };
  assert.equal(await runCli(["status", "--output", "o.json"], g.io, g.dependencies), 1);
  assert.equal(JSON.parse(g.state.stderr).error.code, "INVALID_CONFIG");
  for (const { state } of [f, g]) {
    assert.equal(state.files.size, 0);
    assert.equal(state.stdout, "");
  }
});

test("сохранённый результат даёт код 3, а --output пишет полный ответ потоком и при сбое файла сохраняет ссылку без повтора", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hcm-cli-export-"));
  try {
    const f = fixture(),
      store = new ResultStore({ ...config, runtimeDir: directory });
    const data = ["😀large".repeat(10000)],
      stored = await store.put(data);
    const base = await f.runtime.call("runtime.status");
    const meta = { ...base.meta, truncated: true, resultId: stored.resultId };
    const result = { ...base, data: { resultId: stored.resultId }, meta };
    let calls = 0;
    f.dependencies.createRuntime = () => ({
      ...f.runtime,
      results: store,
      call: async () => {
        calls++;
        return result;
      },
    });
    // Без --output ответ сохранён не целиком: код 3, а stdout прежний, с ok:true.
    assert.equal(await runCli(["status"], f.io, f.dependencies), 3);
    assert.deepEqual(JSON.parse(f.state.stdout), result);
    f.state.stdout = "";
    const path = join(directory, "nested", "out.json");
    assert.equal(await runCli(["status", "--output", path], f.io, f.dependencies), 0);
    const saved = JSON.parse(await readFile(path, "utf8"));
    assert.deepEqual(saved, { ...base, data, meta: { ...base.meta, resultId: stored.resultId } });
    assert.equal(JSON.parse(f.state.stdout).data.bytes, Buffer.byteLength(await readFile(path)));
    assert.equal(JSON.parse(f.state.stdout).data.output, path);
    // Файл целиком: сводка хранит имя локальной копии и не называет её обрезанной.
    assert.deepEqual(
      [JSON.parse(f.state.stdout).meta.truncated, JSON.parse(f.state.stdout).meta.resultId],
      [undefined, stored.resultId],
    );
    f.state.stdout = "";
    const blocked = join(directory, "blocked");
    await writeFile(blocked, "file");
    const exit = await runCli(["status", "--output", join(blocked, "out")], f.io, f.dependencies);
    assert.equal(exit, 1);
    const failed = JSON.parse(f.state.stdout);
    assert.equal(failed.meta.outputFailed, true);
    assert.equal(failed.meta.resultId, stored.resultId);
    assert.equal(calls, 3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("сбой локального вывода сохраняет применённые записи и частичные сбои без повтора", async () => {
  const outcomes: OperationResult[] = [
    {
      ok: true,
      data: { id: "9007199254740993", mutationOutcome: "confirmed" },
      meta: { operationId: "objects.create", connection: config.name, durationMs: 1 },
    },
    {
      ok: false,
      data: { completed: 1, results: [{ ok: true, data: { mutationOutcome: "confirmed" } }] },
      error: {
        code: "BATCH_FAILED",
        message: "Inspect partial results.",
        mutationOutcome: "indeterminate",
      },
      meta: { operationId: "runtime.batch", connection: config.name, durationMs: 1 },
    },
  ];
  for (const outcome of outcomes) {
    const f = fixture();
    f.runtime.call = async (id, args = {}) => {
      f.state.calls.push({ id, args });
      return outcome;
    };
    f.io.writeFile = async () => {
      throw new Error("synthetic-private-local-path");
    };
    assert.equal(await runCli(["status", "--output", "result.json"], f.io, f.dependencies), 1);
    const received = JSON.parse(f.state.stdout) as OperationResult;
    assert.equal(received.ok, false);
    assert.deepEqual(received.data, outcome.data);
    assert.equal(received.meta.operationId, outcome.meta.operationId);
    assert.equal(received.meta.outputFailed, true);
    if (outcome.error) assert.deepEqual(received.error, outcome.error);
    else {
      assert.equal(received.error?.code, "cli.output_failed");
      assert.equal(received.error?.retryable, false);
      assert.equal(received.error?.details?.operationSucceeded, true);
    }
    assert.equal(f.state.calls.length, 1);
    assert.equal(f.state.closes, 1);
    assert.doesNotMatch(f.state.stdout + f.state.stderr, /synthetic-private-local-path/);
  }
});

test("сбой доставки в stdout сохраняет исходы записи, сохранённые ссылки и успешные экспорты файлов", async () => {
  const privateMarker = "synthetic-private-payload-cookie-request-EPIPE";
  const id = "9007199254740993";
  const resultId = "01234567-89ab-4cde-8f01-23456789abcd";
  const executionId = "hcm_inline_0123456789abcdef0123456789abcdef";
  const TrackingID = "0xFEDCBA9876543210";
  const confirmed: OperationResult = {
    ok: true,
    data: {
      id,
      mutationOutcome: "confirmed",
      document: privateMarker.repeat(1000),
      TrackingID: privateMarker,
    },
    meta: { operationId: "objects.create", connection: config.name, durationMs: 12 },
  };
  const uncertain: OperationResult = {
    ok: false,
    data: { partial: privateMarker },
    error: {
      code: "WRITE_INDETERMINATE",
      message: "Inspect the exact object before repeating the write.",
      retryable: false,
      mutationOutcome: "indeterminate",
      details: { objectId: id, request: privateMarker },
    },
    meta: { operationId: "objects.create", connection: config.name, durationMs: 13 },
  };
  const stored: OperationResult = {
    ok: true,
    data: { resultId, preview: privateMarker },
    meta: {
      operationId: "objects.create",
      connection: config.name,
      durationMs: 14,
      truncated: true,
      resultId,
    },
  };
  const execution: OperationResult = {
    ok: true,
    data: { executionId, result: [privateMarker] },
    meta: { operationId: "execute.script", connection: config.name, durationMs: 15 },
  };
  const task: OperationResult = {
    ok: true,
    data: { TrackingID, unrelated: privateMarker },
    meta: {
      operationId: "web.spxml.callMethodAsync",
      connection: config.name,
      durationMs: 16,
    },
  };
  for (const entry of [
    { result: confirmed, code: "OUTPUT_WRITE_FAILED" },
    { result: uncertain, code: "WRITE_INDETERMINATE" },
    { result: stored, code: "OUTPUT_WRITE_FAILED" },
    { result: execution, code: "OUTPUT_WRITE_FAILED", command: ["exec", "--args", "RESULT=[];"] },
    {
      result: task,
      code: "OUTPUT_WRITE_FAILED",
      command: [
        "api",
        "call",
        "web.spxml.callMethodAsync",
        "--args",
        '{"target":"tools.synthetic_async"}',
      ],
    },
    { result: confirmed, code: "OUTPUT_WRITE_FAILED", output: true },
    { result: confirmed, code: "cli.cleanup_failed", failClose: true },
    { result: confirmed, code: "cli.output_failed", output: true, failExport: true },
  ]) {
    const f = fixture();
    const diagnostics: OperationResult[] = [];
    let stdoutWrites = 0;
    let fileWrites = 0;
    f.runtime.call = async (operationId, args = {}) => {
      f.state.calls.push({ id: operationId, args });
      return entry.result;
    };
    f.io.writeOut = () => {
      stdoutWrites++;
      throw new Error(privateMarker);
    };
    f.io.writeError = (text) => {
      f.state.stderr += text;
      diagnostics.push(JSON.parse(text) as OperationResult);
    };
    f.io.writeFile = async (path, text) => {
      fileWrites++;
      if (entry.failExport) throw new Error(privateMarker);
      f.state.files.set(path, text);
    };
    if (entry.failClose)
      f.runtime.close = async () => {
        f.state.closes++;
        throw new Error(privateMarker);
      };
    const command = entry.command
      ? [...entry.command]
      : ["object", "create", "education_mode", "--args", '{"name":"Synthetic"}'];
    if (entry.output) command.push("--output", "result.json");
    assert.equal(await runCli(command, f.io, f.dependencies), 1);
    const receipt = diagnostics.at(-1)!;
    const returned = receipt.data as Record<string, unknown>;
    assert.equal(receipt.error?.code, entry.code);
    assert.equal(receipt.error?.retryable, false);
    assert.equal(receipt.meta.operationId, entry.result.meta.operationId);
    assert.equal(receipt.meta.connection, entry.result.meta.connection);
    assert.equal(receipt.meta.durationMs, entry.result.meta.durationMs);
    assert.equal(receipt.meta.outputDeliveryFailed, true);
    assert.equal(returned.receiptOnly, true);
    assert.equal(returned.operationSucceeded, entry.result.ok);
    assert.equal(
      returned.mutationOutcome,
      entry.result === confirmed
        ? "confirmed"
        : entry.result === uncertain
          ? "indeterminate"
          : undefined,
    );
    assert.equal(
      returned.id,
      entry.result === confirmed || entry.result === uncertain ? id : undefined,
    );
    if (entry.result === execution) assert.equal(returned.executionId, executionId);
    assert.equal(returned.TrackingID, entry.result === task ? TrackingID : undefined);
    if (entry.result === uncertain) {
      assert.equal(receipt.error?.message, uncertain.error!.message);
      assert.equal(receipt.error?.mutationOutcome, "indeterminate");
      assert.equal(receipt.error?.details, undefined);
    }
    if (entry.result === stored) {
      assert.equal(returned.resultId, resultId);
      assert.equal(receipt.meta.resultId, resultId);
      assert.equal(receipt.meta.truncated, true);
    }
    if (entry.failClose) assert.equal(receipt.meta.cleanupFailed, true);
    if (entry.failExport) assert.equal(receipt.meta.outputFailed, true);
    if (entry.output && !entry.failExport) {
      assert.equal(returned.saved, true);
      assert.equal(returned.output, "result.json");
      assert.deepEqual(JSON.parse(f.state.files.get("result.json")!), entry.result);
    } else assert.equal(returned.saved, undefined);
    assert.equal(stdoutWrites, 1);
    assert.equal(fileWrites, entry.output ? 1 : 0);
    assert.equal(f.state.calls.length, 1);
    assert.equal(f.state.closes, 1);
    assert.equal(f.state.stdout, "");
    assert.equal(Object.hasOwn(entry.result.meta, "outputDeliveryFailed"), false);
    assert.doesNotMatch(f.state.stderr, new RegExp(privateMarker));
    assert.ok(Buffer.byteLength(JSON.stringify(receipt, null, 2), "utf8") <= 4096);
  }
});

test("закрытые stdout и stderr всё равно дают один отказ после завершённой операции", async () => {
  const f = fixture();
  let stdoutWrites = 0;
  let stderrWrites = 0;
  f.io.writeOut = () => {
    stdoutWrites++;
    throw new Error("synthetic-private-stdout");
  };
  f.io.writeError = () => {
    stderrWrites++;
    throw new Error("synthetic-private-stderr");
  };
  assert.equal(await runCli(["status"], f.io, f.dependencies), 1);
  assert.equal(stdoutWrites, 1);
  assert.equal(stderrWrites, 1);
  assert.equal(f.state.calls.length, 1);
  assert.equal(f.state.closes, 1);
  assert.equal(f.state.stdout + f.state.stderr, "");
});

test("жизненный цикл MCP ждёт транспорта перед закрытием runtime и не выдаёт результата CLI", async () => {
  const f = fixture();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.dependencies.runMcp = async () => {
    f.state.mcpRuns++;
    await gate;
  };
  const running = runCli(["mcp"], f.io, f.dependencies);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.state.closes, 0);
  release();
  assert.equal(await running, 0);
  assert.equal(f.state.closes, 1);
  assert.equal(f.state.stdout, "");
});

test("ограниченный ввод отклоняет слишком большие переданные данные до runtime", async () => {
  const f = fixture("x".repeat(8 * 1024 * 1024 + 1));
  await assert.rejects(commandInvocation(parseArguments(["exec", "--stdin"]), f.io), CliInputError);
});

test("пароль через stdin — отдельный ввод учётных данных, сохраняет пробелы и никогда не становится данными результата", async () => {
  const f = fixture(" synthetic-private-password \r\n");
  let supplied: string | undefined;
  f.dependencies.loadConfiguration = (options) => {
    supplied = options.password;
    f.state.loads++;
    return config;
  };
  assert.equal(await runCli(["status", "--password-stdin"], f.io, f.dependencies), 0);
  assert.equal(supplied, " synthetic-private-password ");
  assert.doesNotMatch(f.state.stdout + f.state.stderr, /synthetic-private-password/);
  for (const text of ["", "one\ntwo", "x\0y", "x".repeat(65537)]) {
    const invalid = fixture(text);
    assert.equal(await runCli(["status", "--password-stdin"], invalid.io, invalid.dependencies), 2);
    assert.equal(invalid.state.loads, 0);
    assert.equal(invalid.state.calls.length, 0);
  }
});

test("загрузка файла использует точный ограниченный двоичный ввод без преобразования из UTF-8", async () => {
  const bytes = Buffer.from([0, 255, 254, 65]);
  for (const [action, target] of [["upload", "synthetic.bin"]]) {
    const f = fixture();
    f.io.readBinaryFile = async () => bytes;
    assert.equal(
      await runCli(
        ["file", action!, target!, "--input-file", "synthetic.bin"],
        f.io,
        f.dependencies,
      ),
      0,
    );
    assert.deepEqual(f.state.calls[0]?.args, {
      data: { base64: bytes.toString("base64") },
      filename: target,
    });
    const stdin = fixture();
    stdin.io.readBinaryStdin = async () => bytes;
    assert.equal(
      await runCli(["file", action!, target!, "--stdin"], stdin.io, stdin.dependencies),
      0,
    );
    assert.deepEqual(stdin.state.calls, f.state.calls);
    const large = fixture();
    large.io.readBinaryFile = async () => Buffer.alloc(8 * 1024 * 1024 + 1);
    assert.equal(
      await runCli(
        ["file", action!, target!, "--input-file", "synthetic.bin"],
        large.io,
        large.dependencies,
      ),
      2,
    );
    assert.equal(large.state.loads, 0);
    const unsupported = fixture("Synthetic");
    delete unsupported.io.readBinaryFile;
    assert.equal(
      await runCli(
        ["file", action!, target!, "--input-file", "synthetic.bin"],
        unsupported.io,
        unsupported.dependencies,
      ),
      2,
    );
    assert.equal(unsupported.state.loads, 0);
  }
});
