import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { unknownDocumentedMcpTools } from "./documented-mcp-tools.mjs";

const root = resolve(import.meta.dirname, "..");
const failures = [];
const fail = (message) => failures.push(message);
const readJson = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));

const markdown = [
  "README.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "skills/wtctl/SKILL.md",
  ...["skills/wtctl/references", "docs"].flatMap((folder) =>
    readdirSync(resolve(root, folder))
      .filter((name) => name.endsWith(".md"))
      .map((name) => `${folder}/${name}`),
  ),
];
let toolNames = new Set();
try {
  const { HcmMcpTools } = await import("../src/mcp/server.ts");
  const noBackend = () => {
    throw new Error("Список инструментов для документации читается без обращения к серверу.");
  };
  const runtime = Object.fromEntries(
    ["listOperations", "describe", "getOperationEffect", "call", "close"].map((name) => [
      name,
      noBackend,
    ]),
  );
  toolNames = new Set(new HcmMcpTools(runtime).list().map((tool) => tool.name));
} catch {
  fail(
    "Не удалось получить инструменты MCP из src/mcp/server.ts; проверка запускается как npm run docs:check.",
  );
}
for (const name of markdown) {
  const file = resolve(root, name);
  const source = readFileSync(file, "utf8");
  for (const tool of unknownDocumentedMcpTools(source, toolNames))
    fail(`Неизвестный инструмент MCP в ${name}: ${tool}`);
  for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    let target = match[1].replace(/^<|>$/g, "").split("#")[0];
    if (!target || /^[a-z]+:/i.test(target)) continue;
    target = target.split(/\s+"/)[0];
    const resolved = resolve(dirname(file), decodeURIComponent(target));
    if (relative(root, resolved).startsWith("..") || !existsSync(resolved))
      fail(`Битая или внешняя локальная ссылка в ${name}: ${target}`);
    if (/^dev[\\/]/.test(relative(root, resolved)))
      fail(`Ссылка в закрытую папку разработки в ${name}: ${target}`);
  }
  if (/Authorization:\s*Basic\s+[A-Za-z0-9+/=]+/i.test(source))
    fail(`Учётные данные записаны в ${name}`);
}
for (const name of readdirSync(resolve(root, "examples")).filter((name) =>
  name.endsWith(".json"),
)) {
  const example = readJson(`examples/${name}`);
  const text = JSON.stringify(example);
  if (/"(?:username|password|cookie|sessionId|session_token)"\s*:/i.test(text))
    fail(`Поле с секретом или сессией в примере ${name}`);
}
if (failures.length) {
  for (const failure of failures) console.error(failure);
  process.exitCode = 1;
} else
  console.log(
    JSON.stringify({ ok: true, markdownFiles: markdown.length, mcpTools: toolNames.size }),
  );
