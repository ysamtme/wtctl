// Builds dist/: the command as one self-contained file, the library with its dependencies inlined,
// type declarations, and the licence texts of everything that was inlined.
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

const shared = {
  absWorkingDir: root,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  metafile: true,
  legalComments: "none",
  charset: "utf8",
  // ws loads these two only when they are installed; without them it uses its own code.
  external: ["bufferutil", "utf-8-validate"],
  // Inlined CommonJS dependencies call require() for Node's own modules.
  banner: {
    js: 'import { createRequire as __wtctlRequire } from "node:module";\nconst require = __wtctlRequire(import.meta.url);',
  },
  logLevel: "warning",
};
const command = await build({
  ...shared,
  entryPoints: { "cli/bin": "src/cli/bin.ts" },
  outdir: dist,
});
const library = await build({
  ...shared,
  entryPoints: {
    index: "src/index.ts",
    "native/index": "src/native/index.ts",
    "protocol/index": "src/protocol/index.ts",
  },
  outdir: dist,
  splitting: true,
  chunkNames: "chunks/[name]-[hash]",
});

// An installed package has no dependencies: nothing but Node's own modules may be left to import.
const outside = new Set([...builtinModules, ...shared.external]);
for (const result of [command, library])
  for (const [file, output] of Object.entries(result.metafile.outputs))
    for (const item of output.imports)
      if (item.external && !outside.has(item.path.replace(/^node:/, "")))
        throw new Error(`${file} still imports ${item.path}.`);

// The same for the type declarations; those the three entries do not reach are dropped.
const reached = new Set();
function reach(file) {
  if (reached.has(file)) return;
  reached.add(file);
  const text = readFileSync(file, "utf8");
  for (const [, specifier] of text.matchAll(/\b(?:from\s*|import\s*\(\s*|import\s+)"([^"]+)"/g)) {
    if (specifier.startsWith("node:")) continue;
    if (!specifier.startsWith("."))
      throw new Error(`${relative(root, file)} needs the types of ${specifier}.`);
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

// Licence texts of the inlined packages, found from the files the bundler actually read.
const packages = new Map();
for (const input of [
  ...Object.keys(command.metafile.inputs),
  ...Object.keys(library.metafile.inputs),
]) {
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
  throw new Error("The command file lost its first line.");
if (!existsSync(join(dist, "index.d.ts"))) throw new Error("Type declarations were not written.");
const size = (file) => `${Math.round(readFileSync(file).length / 1024)} KB`;
console.log(
  `dist: cli/bin.js ${size(bin)}, index.js ${size(join(dist, "index.js"))}, ${reached.size} declaration files, ${packages.size} bundled packages`,
);
