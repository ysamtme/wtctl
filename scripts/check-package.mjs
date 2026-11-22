import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const directory = fileURLToPath(new URL("..", import.meta.url));
const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const npmEntry = process.env.npm_execpath;
assert.ok(
  npmEntry,
  "Проверка запускается через npm run package:check, чтобы работал настроенный npm.",
);
// Дымовая проверка упаковки не должна выбирать подключение HCM чужого пользователя и загружать
// произвольные предзагрузки Node. Установленные команды запуска намеренно сохраняют окружение;
// эта проверка только читает и работает без сети, поэтому берёт собственное окружение.
const smokeEnv = { ...process.env };
for (const key of Object.keys(smokeEnv))
  if (/^(?:WTCTL_|NODE_(?:OPTIONS|PATH)$)/i.test(key)) delete smokeEnv[key];
smokeEnv.NODE_OPTIONS = "";
smokeEnv.WTCTL_URL = "http://synthetic.invalid/";
const packed = spawnSync(
  process.execPath,
  [npmEntry, "pack", "--dry-run", "--json", "--ignore-scripts", "--cache", ".cache/npm"],
  { cwd: directory, env: smokeEnv, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
);
assert.equal(packed.status, 0, packed.stderr);
const [archive] = JSON.parse(packed.stdout);
assert.equal(archive.name, manifest.name);
const files = archive.files.map((file) => file.path.replaceAll("\\", "/"));
assert.ok(files.length > 30, "В пакете должны быть собранные интерфейсы и документация.");
for (const file of files) {
  assert.match(
    file,
    /^(?:package\.json|README\.md|CHANGELOG\.md|CONTRIBUTING\.md|SECURITY\.md|LICENSE|dist\/|docs\/|examples\/|skills\/|plugin\.json|mcp\.json|mcp_config\.json|\.claude-plugin\/|\.agents\/plugins\/)/,
    `Лишний файл в пакете: ${file}`,
  );
  assert.doesNotMatch(
    file,
    /(?:^|\/)(?:\.work|\.runtime|\.local|\.cache|dev|node_modules|task_context|\.git|\.env[^/]*|coverage)(?:\/|$)/,
    `Закрытый файл в архиве: ${file}`,
  );
  assert.doesNotMatch(
    file,
    /(?:lab\.json|live-config\.json|mutations\.jsonl|server\.(?:stdout|stderr)\.log)$/i,
  );
}
for (const entry of Object.values(manifest.exports))
  for (const path of Object.values(entry))
    assert.ok(files.includes(path.replace(/^\.\//, "")), `В пакете нет экспорта: ${path}`);
// Сборка встраивает все зависимости, поэтому установка получает этот пакет и больше ничего.
assert.deepEqual(Object.keys(manifest.dependencies ?? {}), []);
assert.ok(files.includes("dist/THIRD-PARTY-LICENSES.txt"), "Лицензии встроенных пакетов.");
const bin = Object.values(manifest.bin)[0];
assert.ok(files.includes(bin.replace(/^\.\//, "")));
// Папка пакета — ещё и плагин: описание каждого агента запускает один и тот же файл команды.
const json = async (path) => JSON.parse(await readFile(resolve(directory, path), "utf8"));
const plugin = await json("plugin.json");
const servers = [
  (await json("mcp.json")).mcpServers,
  (await json("mcp_config.json")).mcpServers,
  (await json(".claude-plugin/plugin.json")).mcpServers,
];
for (const path of [
  "plugin.json",
  "mcp.json",
  "mcp_config.json",
  ".claude-plugin/plugin.json",
  ".claude-plugin/marketplace.json",
  ".agents/plugins/marketplace.json",
  "skills/wtctl/SKILL.md",
])
  assert.ok(files.includes(path), `В пакете нет файла плагина: ${path}`);
assert.equal(plugin.version, manifest.version, "В plugin.json — версия пакета.");
// Antigravity игнорирует и предупреждает о поле "type" в mcp_config.json: транспорт выводится из command/url.
assert.equal(
  (await json("mcp_config.json")).mcpServers.wtctl.type,
  undefined,
  "В mcp_config.json для Antigravity не должно быть поля type.",
);
// Claude Code заменяет установленную копию, только когда меняется эта версия.
assert.equal((await json(".claude-plugin/plugin.json")).version, manifest.version);
// В этом репозитории сборки нет: файлы marketplace.json отправляют приложение к собранному пакету в
// ветке "plugin". Через HTTPS: источник owner/repo клонируется по SSH, без ключа это падает.
for (const path of [".claude-plugin/marketplace.json", ".agents/plugins/marketplace.json"])
  assert.deepEqual((await json(path)).plugins[0].source, {
    source: "url",
    url: manifest.repository.url.replace(/^git\+/, ""),
    ref: "plugin",
  });
for (const name of [
  (await json(".claude-plugin/plugin.json")).name,
  (await json(".claude-plugin/marketplace.json")).plugins[0].name,
  (await json(".agents/plugins/marketplace.json")).plugins[0].name,
])
  assert.equal(name, plugin.name, "Имя плагина одно во всех описаниях.");
for (const entry of servers) {
  const [server] = Object.values(entry);
  assert.equal(server.command, "node");
  assert.equal(server.args.at(-1), "mcp");
  assert.equal(
    server.args[0].replace(/\$\{[^}]+\}\/?/g, "/").replace(/^\/+/, ""),
    bin.replace(/^\.\//, ""),
    "Плагин запускает файл команды из пакета.",
  );
}

// Копируется ровно тот набор файлов, который выбрал npm, как установленный пакет без зависимостей.
const alone = await mkdtemp(join(tmpdir(), "wtctl-package-check-"));
const pkgDir = join(alone, "node_modules", manifest.name);
try {
  for (const file of files) {
    const target = join(pkgDir, file);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(directory, file), target);
  }
  smokeEnv.WTCTL_RUNTIME_DIR = join(alone, ".runtime");
  const binPath = resolve(pkgDir, bin);
  assert.match(await readFile(binPath, "utf8"), /^#!\/usr\/bin\/env node\r?\n/);
  const timeout = 10000;
  const cli = (...args) => {
    const run = spawnSync(process.execPath, [binPath, ...args], {
      cwd: alone,
      env: smokeEnv,
      encoding: "utf8",
      timeout,
    });
    if (run.error) throw run.error;
    assert.equal(run.status, 0, run.stderr);
    return run.stdout;
  };
  assert.equal(JSON.parse(cli("version")).data.version, manifest.version);
  assert.match(cli("--help"), /wtctl/);
  assert.match(cli("guide"), /^# Работа с сервером WebSoft HCM/);
  const logs = cli("guide", "logs");
  assert.match(logs, /^# Логи сервера/);
  assert.equal(JSON.parse(cli("--json", "api", "list", "--limit", "1")).ok, true);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [binPath, "mcp"],
    cwd: alone,
    env: smokeEnv,
  });
  const client = new Client({ name: "wtctl-package-check", version: manifest.version });
  try {
    const options = { timeout };
    await client.connect(transport, options);
    assert.deepEqual(client.getServerVersion(), { name: "wtctl", version: manifest.version });
    const { tools } = await client.listTools(undefined, options);
    assert.ok(
      tools.some((tool) => tool.name === "hcm_guide"),
      "В MCP-сервере должен быть гайд.",
    );
    const guide = await client.callTool(
      { name: "hcm_guide", arguments: { topic: "logs" } },
      undefined,
      options,
    );
    assert.deepEqual(guide.content, [{ type: "text", text: logs.trimEnd() }]);
    const missing = await client.callTool(
      { name: "hcm_api_describe", arguments: { operationId: "packageCheck.unknown" } },
      undefined,
      options,
    );
    assert.equal(missing.isError, true);
    assert.equal(JSON.parse(missing.content[0].text).error.code, "UNKNOWN_OPERATION");
  } finally {
    await client.close();
  }

  // Публичные точки входа SDK проверяются по именам пакета через exports в package.json.
  const consumer = join(alone, "check-exports.mjs");
  await writeFile(
    consumer,
    [
      'import * as sdk from "wtctl";',
      'import * as native from "wtctl/native";',
      'import * as protocol from "wtctl/protocol";',
      "console.log(JSON.stringify({",
      "  sdk: Object.keys(sdk).sort(),",
      "  native: typeof native.NativeGateway,",
      "  protocol: typeof protocol.WsHcmClient,",
      "}));",
    ].join("\n"),
  );
  const importsRun = spawnSync(process.execPath, [consumer], {
    cwd: alone,
    env: smokeEnv,
    encoding: "utf8",
    timeout,
  });
  if (importsRun.error) throw importsRun.error;
  assert.equal(importsRun.status, 0, importsRun.stderr);
  const exported = JSON.parse(importsRun.stdout);
  assert.deepEqual(exported.sdk, [
    "HcmCleanupError",
    "HcmClient",
    "HcmError",
    "HcmOperationError",
    "HcmStoredResultError",
    "describeHcmOperation",
    "getCleanupError",
    "listHcmOperations",
    "loadConfig",
    "unwrap",
    "withHcmClient",
  ]);
  assert.equal(exported.native, "function");
  assert.equal(exported.protocol, "function");
} finally {
  await rm(alone, { recursive: true, force: true });
}
console.log(
  `Пакет проверен: открытых файлов — ${files.length}, команда и SDK самодостаточны, локального состояния нет.`,
);
