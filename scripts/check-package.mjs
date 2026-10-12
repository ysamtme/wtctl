import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

const directory = fileURLToPath(new URL("..", import.meta.url));
const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const npmEntry = process.env.npm_execpath;
assert.ok(npmEntry, "Run this check through npm run package:check so the configured npm is used.");
// Packaging smoke must not select an unrelated user's HCM connection or load
// arbitrary Node preloads. The installed launchers intentionally preserve env;
// this read-only, offline check uses its own environment instead.
const smokeEnv = { ...process.env };
for (const key of Object.keys(smokeEnv))
  if (/^WTCTL_/i.test(key) || key.toUpperCase() === "NODE_OPTIONS") delete smokeEnv[key];
smokeEnv.NODE_OPTIONS = "";
smokeEnv.WTCTL_URL = "http://synthetic.invalid/";
smokeEnv.WTCTL_RUNTIME_DIR = resolve(directory, ".runtime", "package-check");
const packed = spawnSync(
  process.execPath,
  [npmEntry, "pack", "--dry-run", "--json", "--ignore-scripts", "--cache", ".cache/npm"],
  { cwd: directory, env: smokeEnv, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
);
assert.equal(packed.status, 0, packed.stderr);
const [archive] = JSON.parse(packed.stdout);
assert.equal(archive.name, manifest.name);
const files = archive.files.map((file) => file.path.replaceAll("\\", "/"));
assert.ok(
  files.length > 30,
  "The distributable should contain the compiled interfaces and documentation.",
);
for (const file of files) {
  assert.match(
    file,
    /^(?:package\.json|README\.md|CHANGELOG\.md|CONTRIBUTING\.md|SECURITY\.md|LICENSE|dist\/|docs\/|examples\/|skills\/|plugin\.json|mcp\.json|gemini-extension\.json|\.claude-plugin\/|\.agents\/plugins\/)/,
    `Unexpected packaged file: ${file}`,
  );
  assert.doesNotMatch(
    file,
    /(?:^|\/)(?:\.work|\.runtime|\.local|\.cache|dev|node_modules|task_context|\.git|\.env[^/]*|coverage)(?:\/|$)/,
    `Private material in archive: ${file}`,
  );
  assert.doesNotMatch(
    file,
    /(?:lab\.json|live-config\.json|mutations\.jsonl|server\.(?:stdout|stderr)\.log)$/i,
  );
}
for (const entry of Object.values(manifest.exports))
  for (const path of Object.values(entry))
    assert.ok(files.includes(path.replace(/^\.\//, "")), `Export is missing from package: ${path}`);
// The build inlines every dependency, so an install fetches this package and nothing else.
assert.deepEqual(Object.keys(manifest.dependencies ?? {}), []);
assert.ok(files.includes("dist/THIRD-PARTY-LICENSES.txt"), "Licences of the inlined packages.");
const bin = Object.values(manifest.bin)[0];
assert.ok(files.includes(bin.replace(/^\.\//, "")));
// The package folder is also a plugin: every agent's description starts the same command file.
const json = async (path) => JSON.parse(await readFile(resolve(directory, path), "utf8"));
const plugin = await json("plugin.json");
const servers = [
  (await json("mcp.json")).mcpServers,
  (await json(".claude-plugin/plugin.json")).mcpServers,
  (await json("gemini-extension.json")).mcpServers,
];
for (const path of [
  "plugin.json",
  "mcp.json",
  "gemini-extension.json",
  ".claude-plugin/plugin.json",
  ".claude-plugin/marketplace.json",
  ".agents/plugins/marketplace.json",
  "skills/wtctl/SKILL.md",
])
  assert.ok(files.includes(path), `Plugin file is missing from package: ${path}`);
assert.equal(plugin.version, manifest.version, "plugin.json carries the package version.");
assert.equal((await json("gemini-extension.json")).version, manifest.version);
// Claude Code replaces an installed copy only when this version changes.
assert.equal((await json(".claude-plugin/plugin.json")).version, manifest.version);
// This repository has no build in it: its catalogs send an application to the built package on the
// branch "plugin". Over HTTPS, since an owner/repo source is cloned over SSH and fails without a key.
for (const path of [".claude-plugin/marketplace.json", ".agents/plugins/marketplace.json"])
  assert.deepEqual((await json(path)).plugins[0].source, {
    source: "url",
    url: manifest.repository.url.replace(/^git\+/, ""),
    ref: "plugin",
  });
for (const name of [
  (await json(".claude-plugin/plugin.json")).name,
  (await json("gemini-extension.json")).name,
  (await json(".claude-plugin/marketplace.json")).plugins[0].name,
  (await json(".agents/plugins/marketplace.json")).plugins[0].name,
])
  assert.equal(name, plugin.name, "One plugin name in every description.");
for (const entry of servers) {
  const [server] = Object.values(entry);
  assert.equal(server.command, "node");
  assert.equal(server.args.at(-1), "mcp");
  assert.equal(
    server.args[0].replace(/\$\{[^}]+\}\/?/g, "/").replace(/^\/+/, ""),
    bin.replace(/^\.\//, ""),
    "The plugin starts the command file of the package.",
  );
}
assert.match(await readFile(resolve(directory, bin), "utf8"), /^#!\/usr\/bin\/env node\r?\n/);
const help = spawnSync(process.execPath, [resolve(directory, bin), "--help"], {
  cwd: directory,
  env: smokeEnv,
  encoding: "utf8",
  timeout: 10000,
});
assert.equal(help.status, 0, help.stderr);
assert.match(help.stdout, /wtctl/);
const api = spawnSync(
  process.execPath,
  [resolve(directory, bin), "--json", "api", "list", "--limit", "1"],
  { cwd: directory, env: smokeEnv, encoding: "utf8", timeout: 10000 },
);
assert.equal(api.status, 0, api.stderr);
assert.ok(JSON.parse(api.stdout), "Compiled CLI must emit one valid JSON result.");
// The command file alone, away from this folder and its node_modules.
const alone = await mkdtemp(join(tmpdir(), "wtctl-package-check-"));
try {
  await copyFile(resolve(directory, bin), join(alone, "wtctl.mjs"));
  const version = spawnSync(process.execPath, [join(alone, "wtctl.mjs"), "version"], {
    cwd: alone,
    env: smokeEnv,
    encoding: "utf8",
    timeout: 10000,
  });
  assert.equal(version.status, 0, version.stderr);
  assert.equal(JSON.parse(version.stdout).data.version, manifest.version);
} finally {
  await rm(alone, { recursive: true, force: true });
}
const sdk = await import(new URL("../dist/index.js", import.meta.url));
assert.equal(typeof sdk.HcmRuntime, "function");
assert.equal(typeof sdk.loadConfig, "function");
for (const path of Object.values(manifest.exports).flatMap((entry) => Object.values(entry)))
  assert.ok((await stat(resolve(directory, path))).isFile());
console.log(
  `Package validated: ${files.length} public files, self-contained command and SDK, no local state.`,
);
