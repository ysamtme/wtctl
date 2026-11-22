// Собирает dist/: CLI и SDK с общими модулями и встроенными зависимостями,
// объявления типов и тексты лицензий встроенных пакетов.
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { builtinModules, createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "dist");
rmSync(dist, { recursive: true, force: true });

const declarations = spawnSync(
  process.execPath,
  [
    createRequire(import.meta.url).resolve("typescript/bin/tsc"),
    "-p",
    "tsconfig.build.json",
    "--emitDeclarationOnly",
  ],
  { cwd: root, stdio: "inherit" },
);
if (declarations.status !== 0) process.exit(declarations.status ?? 1);

// ws загружает эти два модуля, только если они установлены; без них использует свой код.
const optional = ["bufferutil", "utf-8-validate"];
const { metafile } = await build({
  absWorkingDir: root,
  entryPoints: {
    "cli/bin": "src/cli/bin.ts",
    index: "src/index.ts",
    "native/index": "src/native/index.ts",
    "protocol/index": "src/protocol/index.ts",
  },
  outdir: dist,
  bundle: true,
  splitting: true,
  chunkNames: "chunks/[name]-[hash]",
  platform: "node",
  format: "esm",
  target: "node22",
  metafile: true,
  legalComments: "none",
  charset: "utf8",
  external: optional,
  // Встроенные зависимости CommonJS вызывают require() для собственных модулей Node.
  banner: {
    js: 'import { createRequire as __wtctlRequire } from "node:module";\nconst require = __wtctlRequire(import.meta.url);',
  },
  logLevel: "warning",
});

// У установленного пакета нет зависимостей: для импорта могут остаться только модули самого Node.
const outside = new Set([...builtinModules, ...optional]);
for (const [file, output] of Object.entries(metafile.outputs))
  for (const item of output.imports)
    if (item.external && !outside.has(item.path.replace(/^node:/, "")))
      throw new Error(`${file} всё ещё импортирует ${item.path}.`);

// При обычном запуске CLI и в SDK модули MCP-сервера и тексты гайда не загружаются.
const visited = new Set();
const pending = [
  "dist/cli/bin.js",
  "dist/index.js",
  "dist/native/index.js",
  "dist/protocol/index.js",
];
while (pending.length) {
  const file = pending.pop();
  if (visited.has(file)) continue;
  visited.add(file);
  const { inputs, imports } = metafile.outputs[file];
  for (const input of Object.keys(inputs)) {
    const path = input.replaceAll("\\", "/");
    if (
      path.startsWith("src/mcp/") ||
      path === "src/guide-texts.ts" ||
      /(?:^|\/)node_modules\/(?:@modelcontextprotocol\/sdk|zod|ajv)\//.test(path)
    )
      throw new Error(`В статически достижимый файл ${file} попал модуль ${input}.`);
  }
  for (const item of imports)
    if (!item.external && item.kind === "import-statement") pending.push(item.path);
}

// То же для объявлений типов; не достижимые из трёх точек входа отбрасываются.
const reached = new Set();
function reach(file) {
  if (reached.has(file)) return;
  reached.add(file);
  const text = readFileSync(file, "utf8");
  for (const [, specifier] of text.matchAll(/\b(?:from\s*|import\s*\(\s*|import\s+)"([^"]+)"/g)) {
    if (specifier.startsWith("node:")) continue;
    if (!specifier.startsWith("."))
      throw new Error(`Файлу ${relative(root, file)} нужны типы ${specifier}.`);
    reach(resolve(dirname(file), specifier.replace(/\.js$/, ".d.ts")));
  }
}
for (const entry of ["index", "native/index", "protocol/index"]) reach(join(dist, `${entry}.d.ts`));
for (const name of readdirSync(dist, { recursive: true })) {
  const file = join(dist, name);
  if (file.endsWith(".d.ts") && !reached.has(file)) rmSync(file);
}
for (const name of readdirSync(dist, { recursive: true, withFileTypes: true }))
  if (name.isDirectory() && readdirSync(join(name.parentPath, name.name)).length === 0)
    rmdirSync(join(name.parentPath, name.name));

// Тексты лицензий встроенных пакетов, найденные по файлам, которые сборщик действительно прочитал.
const packages = new Map();
for (const input of Object.keys(metafile.inputs)) {
  const match = /^(.*node_modules\/((?:@[^/]+\/)?[^/]+))\//.exec(input.replaceAll("\\", "/"));
  if (match) packages.set(match[2], resolve(root, match[1]));
}
const notices = [
  "This distribution includes the following third-party packages, bundled into its JavaScript files.",
  "",
];
for (const [name, directory] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
  const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
  const file = readdirSync(directory).find((entry) => /^licen[cs]e(\.|$)/i.test(entry));
  notices.push(
    "=".repeat(78),
    `${name} ${manifest.version} — ${manifest.license ?? "see below"}`,
    "=".repeat(78),
    "",
    file
      ? readFileSync(join(directory, file), "utf8").trim()
      : `No licence file in the package; declared licence: ${manifest.license}.`,
    "",
  );
}
writeFileSync(join(dist, "THIRD-PARTY-LICENSES.txt"), notices.join("\n"));

const bin = join(dist, "cli", "bin.js");
if (!readFileSync(bin, "utf8").startsWith("#!/usr/bin/env node"))
  throw new Error("Файл команды потерял первую строку.");
if (!existsSync(join(dist, "index.d.ts"))) throw new Error("Объявления типов не записаны.");
const size = (file) => `${Math.round(readFileSync(file).length / 1024)} KB`;
console.log(
  `dist: cli/bin.js ${size(bin)}, index.js ${size(join(dist, "index.js"))}, файлов объявлений: ${reached.size}, встроенных пакетов: ${packages.size}`,
);
