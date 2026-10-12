import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm, access } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

async function runNode(entry: string, env: NodeJS.ProcessEnv, cwd: string, args: string[] = []) {
  const child = spawn(process.execPath, [entry, ...args], {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 20000,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  const code = await new Promise<number | null>((done, reject) => {
    child.once("error", reject);
    child.once("close", done);
  });
  return { code, stdout, stderr };
}

test(
  "actual package check ignores unrelated HCM profiles and Node preloads in its offline child smoke",
  { timeout: 30000 },
  async (t) => {
    const root = realpathSync(await mkdtemp(join(tmpdir(), "hcm package check ")));
    t.after(async () => {
      assert.equal(dirname(root), realpathSync(tmpdir()));
      assert.match(basename(root), /^hcm package check /);
      await rm(root, { recursive: true, force: true });
    });
    const packageRoot = fileURLToPath(new URL("..", import.meta.url));
    const npmEntry =
      process.env.npm_execpath ??
      join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
    await access(npmEntry);
    const preload = join(root, "ambient-preload.cjs");
    await writeFile(
      preload,
      `
if ((process.argv[1] ?? '').endsWith(require('node:path').join('dist', 'cli', 'bin.js'))) {
  process.stderr.write('synthetic ambient Node preload reached package CLI smoke' + String.fromCharCode(10));
  process.exit(43);
}
`,
    );
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: "", npm_execpath: npmEntry };
    for (const key of Object.keys(env)) if (/^WTCTL_/i.test(key)) delete env[key];
    env.WTCTL_CONFIG = join(root, "unrelated-missing-profile.json");
    env.hCm_CoNnEcTiOn = "unrelated-profile";
    env.WTCTL_USERNAME = "synthetic-account-must-not-print";
    env.hcm_password = "synthetic-password-must-not-print";
    env.WTCTL_URL = "http://localhost:1/";
    env.NODE_OPTIONS = `--require=${JSON.stringify(preload)}`;
    const bin = join(packageRoot, "dist", "cli", "bin.js");
    const preloadControl = await runNode(bin, env, root, ["--help"]);
    assert.equal(
      preloadControl.code,
      43,
      "the ambient preload must actually block an unisolated CLI child",
    );
    assert.equal(
      preloadControl.stderr,
      "synthetic ambient Node preload reached package CLI smoke\n",
    );
    const profileControl = await runNode(bin, { ...env, NODE_OPTIONS: "" }, root, [
      "api",
      "list",
      "--limit",
      "1",
    ]);
    assert.notEqual(
      profileControl.code,
      0,
      "an unisolated discovery must actually select the invalid profile",
    );

    const { code, stdout, stderr } = await runNode(
      join(packageRoot, "scripts", "check-package.mjs"),
      env,
      root,
    );
    assert.equal(code, 0, stderr);
    assert.equal(stderr, "");
    assert.match(
      stdout,
      /^Package validated: \d+ public files, self-contained command and SDK, no local state\.\r?\n$/,
    );
    assert.doesNotMatch(stdout, /synthetic-account|synthetic-password|ambient Node preload/);
  },
);
