import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadOrCreateLegacyInstallationId } from "../src/native/identity.js";
import { NativeGateway } from "../src/native/index.js";

const exec = promisify(execFile);
const base = {
  baseUrl: "http://fixture.invalid/",
  username: "fixture",
  password: "fixture",
  timeoutMs: 1000,
  maxResponseBytes: 1024 * 1024,
};

async function directory(): Promise<{ path: string; close: () => Promise<void> }> {
  const root = resolve(tmpdir());
  const path = await mkdtemp(join(root, "hcm-native-identity-"));
  return {
    path,
    close: async () => {
      assert.ok(resolve(path).startsWith(`${root}${sep}hcm-native-identity-`));
      await rm(path, { recursive: true, force: true });
    },
  };
}

test("persistent legacy identity is stable across concurrent processes and published completely", async () => {
  const dir = await directory();
  try {
    const filename = join(dir.path, "client.id");
    const module = new URL("../src/native/identity.ts", import.meta.url).href;
    const script = `import {loadOrCreateLegacyInstallationId} from ${JSON.stringify(module)}; process.stdout.write(await loadOrCreateLegacyInstallationId(process.argv[1]));`;
    const processes = await Promise.all(
      Array.from({ length: 4 }, () =>
        exec(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script, filename]),
      ),
    );
    const ids = processes.map((result) => result.stdout);
    assert.match(ids[0]!, /^[0-9A-F]{16}$/);
    assert.equal(new Set(ids).size, 1);
    assert.equal(await loadOrCreateLegacyInstallationId(filename), ids[0]);
    assert.equal(await readFile(filename, "utf8"), `${ids[0]}\n`);
    assert.deepEqual(await readdir(dir.path), ["client.id"]);
  } finally {
    await dir.close();
  }
});

test("invalid existing client files are bounded, never overwritten, and do not send requests", async () => {
  const dir = await directory();
  try {
    for (const [name, contents] of [
      ["invalid.id", Buffer.from("foreign-file")],
      ["large.id", Buffer.alloc(1024 * 1024, 65)],
      ["nonascii.id", Buffer.from(Array(16).fill(0xb1))],
    ] as const) {
      const filename = join(dir.path, name);
      await writeFile(filename, contents);
      let calls = 0;
      const gateway = new NativeGateway({
        ...base,
        installationIdFile: filename,
        fetch: async () => {
          calls++;
          return new Response("");
        },
      });
      await assert.rejects(
        gateway.call("legacy.session.open", {}),
        (error) =>
          error instanceof Error &&
          /installationId старого клиента (?:должен быть|не 16)/.test(error.message) &&
          (error as { requestSent?: boolean }).requestSent === false,
      );
      assert.equal(calls, 0);
      assert.deepEqual(await readFile(filename), contents);
      await gateway.close();
    }
  } finally {
    await dir.close();
  }
});

test("two gateway contexts reuse one installation identity and send distinct frame IDs; explicit identity wins", async () => {
  const dir = await directory();
  const frames: Array<{ body: string; headers: Headers }> = [];
  const fetch: typeof globalThis.fetch = async (_input, init) => {
    frames.push({
      body: new TextDecoder().decode(init?.body as Uint8Array),
      headers: new Headers(init?.headers),
    });
    return new Response("Result: ok\r\n\r\n", {
      headers: { "set-cookie": "SessionID=fixture-auth" },
    });
  };
  const filename = join(dir.path, "client.id");
  const gateways = [
    new NativeGateway({ ...base, installationIdFile: filename, fetch }),
    new NativeGateway({ ...base, installationIdFile: filename, fetch }),
  ];
  try {
    await Promise.all(gateways.map((gateway) => gateway.call("legacy.session.open", {})));
    const initial = frames.filter((frame) => frame.body.startsWith("Action: Idle"));
    assert.equal(initial.length, 2);
    const installations = initial.map(
      (frame) => /^InstallationID: (\w+)\r$/m.exec(frame.body)?.[1],
    );
    assert.equal(installations[0], await loadOrCreateLegacyInstallationId(filename));
    assert.equal(installations[0], installations[1]);
    const ids = initial.map((frame) => /^SessionID: (\d+)\r$/m.exec(frame.body)![1]!);
    assert.notEqual(ids[0], ids[1]);
    for (const id of ids) assert.ok(BigInt(id) > 0n && BigInt(id) < 1n << 63n);
    await Promise.all(gateways.map((gateway) => gateway.close()));
    assert.deepEqual(
      frames
        .filter((frame) => frame.body.startsWith("Action: QuitSession"))
        .map((frame) => /^SessionID: (\d+)\r$/m.exec(frame.body)![1]!)
        .sort(),
      ids.sort(),
    );
    const override = new NativeGateway({
      ...base,
      installationId: "1234567890ABCDEF",
      installationIdFile: join(dir.path, "must-not-exist.id"),
      fetch,
    });
    try {
      await override.call("legacy.session.open", {});
    } finally {
      await override.close();
    }
    assert.deepEqual(await readdir(dir.path), ["client.id"]);
    assert.match(
      frames.filter((frame) => frame.body.startsWith("Action: Idle")).at(-1)!.body,
      /InstallationID: 1234567890ABCDEF\r\n/,
    );
  } finally {
    await Promise.all(gateways.map((gateway) => gateway.close()));
    await dir.close();
  }
});
