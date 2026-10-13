// Гайд — текст навыка, который отдают MCP-сервер и команда агенту без навыка.
import assert from "node:assert/strict";
import { test } from "node:test";
import { runCli } from "../src/cli/run.js";
import type { CliDependencies, CliIo, RuntimePort } from "../src/cli/types.js";
import type { OperationResult } from "../src/contracts.js";
import { guide, guideTopics } from "../src/guide.js";
import { HcmMcpTools } from "../src/mcp/server.js";

const noBackend = (): never => {
  throw new Error("The guide must not reach a server.");
};
const runtime: RuntimePort = {
  listOperations: noBackend,
  describe: noBackend,
  getOperationEffect: noBackend,
  call: noBackend,
  close: noBackend,
};

function cli() {
  const state = { stdout: "", stderr: "", files: new Map<string, string>() };
  const io: CliIo = {
    writeOut: (text) => void (state.stdout += text),
    writeError: (text) => void (state.stderr += text),
    readFile: noBackend,
    readStdin: noBackend,
    writeFile: async (path, text) => void state.files.set(path, text),
  };
  const dependencies: CliDependencies = {
    loadConfiguration: noBackend,
    createRuntime: noBackend,
    runMcp: noBackend,
  };
  return { state, io, dependencies };
}

test("гайд содержит обзор и по теме на каждый справочник навыка, без ссылок на файлы", () => {
  assert.deepEqual(guideTopics(), [
    "start",
    "queries",
    "objects",
    "scripts",
    "logs",
    "files",
    "cli-sdk",
    "errors",
  ]);
  const start = guide();
  assert.equal(start.topic, "start");
  assert.match(start.text, /^# Работа с сервером WebSoft HCM/);
  assert.match(start.text, /hcm_guide \{topic:"queries"\}/);
  assert.match(start.text, /\| Коды ошибок и что с ними делать \| `errors` \|/);
  for (const topic of guideTopics()) {
    const page = guide(topic);
    assert.match(page.text, /^# /, topic);
    assert.doesNotMatch(page.text, /\.md\)|references\//, topic);
  }
  assert.match(guide("errors").text, /см\. тему `logs`/);
});

test("hcm_guide отвечает самим текстом и никогда не обращается к серверу", async () => {
  const tools = new HcmMcpTools(runtime);
  const definition = tools.list().find((tool) => tool.name === "hcm_guide")!;
  assert.deepEqual(
    (definition.inputSchema.properties as { topic: { enum: string[] } }).topic.enum,
    guideTopics(),
  );
  const overview = await tools.invoke("hcm_guide");
  assert.equal(overview.isError, undefined);
  assert.deepEqual(overview.content, [{ type: "text", text: guide().text }]);
  const topic = await tools.invoke("hcm_guide", { topic: "scripts" });
  assert.deepEqual(topic.content, [{ type: "text", text: guide("scripts").text }]);
  const unknown = await tools.invoke("hcm_guide", { topic: "nothing" });
  assert.equal(unknown.isError, true);
  const failed = JSON.parse((unknown.content[0] as { text: string }).text) as OperationResult;
  assert.equal(failed.error?.code, "mcp.invalid_arguments");
});

test("wtctl guide печатает текст, сохраняет его в файл, а для неизвестной темы называет существующие", async () => {
  const plain = cli();
  assert.equal(await runCli(["guide"], plain.io, plain.dependencies), 0);
  assert.equal(plain.state.stdout, `${guide().text}\n`);

  const topic = cli();
  assert.equal(await runCli(["guide", "logs"], topic.io, topic.dependencies), 0);
  assert.equal(topic.state.stdout, `${guide("logs").text}\n`);

  const saved = cli();
  assert.equal(
    await runCli(["guide", "errors", "--output", "errors.md"], saved.io, saved.dependencies),
    0,
  );
  assert.equal(saved.state.stdout, "");
  assert.equal(saved.state.files.get("errors.md"), `${guide("errors").text}\n`);

  const json = cli();
  assert.equal(await runCli(["guide", "files", "--json"], json.io, json.dependencies), 0);
  const result = JSON.parse(json.state.stdout) as OperationResult;
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, guide("files"));

  const unknown = cli();
  assert.equal(await runCli(["guide", "nothing"], unknown.io, unknown.dependencies), 1);
  const failed = JSON.parse(unknown.state.stderr) as OperationResult;
  assert.equal(failed.error?.code, "UNKNOWN_GUIDE_TOPIC");
  assert.match(failed.error?.hint ?? "", /queries, objects, scripts, logs, files, cli-sdk, errors/);
});

test("тема про команду и SDK заканчивается местом, откуда запущена программа, если оно известно", async () => {
  const local = {
    node: "/opt/node/bin/node",
    script: "/opt/pkg/dist/cli/bin.js",
    sdk: "file:///opt/pkg/dist/index.js",
  };
  const page = guide("cli-sdk", local);
  assert.ok(page.text.startsWith(guide("cli-sdk").text));
  assert.ok(
    page.text.endsWith(
      [
        "## На этом компьютере",
        "",
        "- Node.js: `/opt/node/bin/node`",
        "- файл команды: `/opt/pkg/dist/cli/bin.js`",
        "- вызов команды, если `wtctl` нет в `PATH`: Node.js, файл команды, затем аргументы, например `status`",
        '- SDK: `import { loadConfig, withHcmClient, unwrap } from "file:///opt/pkg/dist/index.js";`',
      ].join("\n"),
    ),
  );
  assert.doesNotMatch(guide("cli-sdk", { node: "n", script: "s" }).text, /SDK: `import/);
  assert.equal(guide("errors", local).text, guide("errors").text);
  // Копия, которую держит npx или хост плагина, при обновлении переезжает: гайд называет то, что остаётся.
  assert.doesNotMatch(page.text, /меняется при обновлении/);
  for (const script of [
    "/home/u/.npm/_npx/1a2b/node_modules/wtctl/dist/cli/bin.js",
    "C:\\Users\\u\\.claude\\plugins\\cache\\wtctl\\wtctl\\0.1.1\\dist\\cli\\bin.js",
  ])
    assert.match(
      guide("cli-sdk", { node: "n", script }).text,
      /меняется при обновлении.*`npx -y wtctl`.*`npm install wtctl`/,
    );

  const tools = new HcmMcpTools(runtime, { local });
  const served = await tools.invoke("hcm_guide", { topic: "cli-sdk" });
  assert.deepEqual(served.content, [{ type: "text", text: page.text }]);

  const command = cli();
  assert.equal(
    await runCli(["guide", "cli-sdk"], command.io, { ...command.dependencies, local }),
    0,
  );
  assert.equal(command.state.stdout, `${page.text}\n`);
});

test("та же тема говорит, как команда и программа получают подключение этого процесса", async () => {
  const local = { node: "/opt/node/bin/node", script: "/opt/pkg/dist/cli/bin.js" };
  const last = (text: string): string => text.slice(text.lastIndexOf("\n") + 1);
  assert.equal(
    last(guide("cli-sdk", { ...local, settings: { environment: false } }).text),
    "- вызов команды, если `wtctl` нет в `PATH`: Node.js, файл команды, затем аргументы, например `status`",
    "the default connections file needs no note",
  );
  assert.equal(
    last(guide("cli-sdk", { ...local, settings: { configPath: "/etc/hcm.json" } }).text),
    '- подключение: команде добавь `--config "/etc/hcm.json"`, в скрипте — `loadConfig({ configPath: "/etc/hcm.json" })`',
  );
  assert.equal(
    last(guide("cli-sdk", { ...local, settings: { connection: "prod" } }).text),
    '- подключение: команде добавь `--connection prod`, в скрипте — `loadConfig({ connection: "prod" })`',
  );
  assert.match(
    last(guide("cli-sdk", { ...local, settings: { environment: true } }).text),
    /задано переменными окружения.*WTCTL_URL.*config init/,
  );

  // Команда сама определяет настройки по своим флагам и окружению.
  const previous = { config: process.env.WTCTL_CONFIG, url: process.env.WTCTL_URL };
  delete process.env.WTCTL_CONFIG;
  delete process.env.WTCTL_URL;
  try {
    const named = cli();
    const argv = ["--connection", "prod", "guide", "cli-sdk"];
    assert.equal(await runCli(argv, named.io, { ...named.dependencies, local }), 0);
    assert.match(named.state.stdout, /команде добавь `--connection prod`/);

    let served: unknown;
    const server = cli();
    process.env.WTCTL_URL = "http://hcm.example.org/";
    assert.equal(
      await runCli(["mcp"], server.io, {
        ...server.dependencies,
        local,
        loadConfiguration: () => ({
          name: "default",
          baseUrl: "http://hcm.example.org/",
          timeoutMs: 1000,
          maxResponseBytes: 1024,
          outputLimitBytes: 1024,
          runtimeDir: ".unused",
          permissions: { write: false, execute: false },
        }),
        createRuntime: () => ({ ...runtime, close: async () => {} }),
        runMcp: async (_runtime, _name, _io, given) => {
          served = given;
        },
      }),
      0,
    );
    assert.deepEqual(served, { ...local, settings: { environment: true } });
  } finally {
    for (const [key, value] of [
      ["WTCTL_CONFIG", previous.config],
      ["WTCTL_URL", previous.url],
    ] as const)
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
});
