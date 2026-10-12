import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";
import { ResultStore } from "../src/results.js";
import type { ConnectionConfig } from "../src/contracts.js";

const config = (runtimeDir: string, name = "dev"): ConnectionConfig => ({
  name,
  baseUrl: "http://hcm.test/",
  timeoutMs: 1000,
  maxResponseBytes: 1024 * 1024,
  outputLimitBytes: 24000,
  runtimeDir,
  permissions: { write: false, execute: false },
});
test("configuration accepts UTF-8 BOM and preserves Unicode profile values", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hcm-config-utf8-"));
  try {
    const file = join(directory, "connections.json");
    const text = JSON.stringify({
      defaultConnection: "utf8",
      connections: {
        utf8: {
          baseUrl: "http://fixture.invalid/",
          username: "Пользователь 🙂",
          password: "local-test-only",
        },
      },
    });
    await writeFile(file, text);
    const expected = loadConfig({ configPath: file, connection: "utf8" });
    await writeFile(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)]));
    assert.deepEqual(loadConfig({ configPath: file, connection: "utf8" }), expected);
    assert.equal(expected.username, "Пользователь 🙂");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("configuration rejects malformed UTF-8 instead of replacing credential bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hcm-config-invalid-utf8-"));
  try {
    const file = join(directory, "connections.json");
    await writeFile(
      file,
      Buffer.concat([
        Buffer.from('{"connections":{"utf8":{"username":"'),
        Buffer.from([0xc3, 0x28]),
        Buffer.from('","password":"local-test-only"}}}'),
      ]),
    );
    assert.throws(
      () => loadConfig({ configPath: file, connection: "utf8" }),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "INVALID_CONFIG" &&
        !error.message.includes("local-test-only"),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("configuration enforces its byte ceiling and rejects directories", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hcm-config-bound-"));
  try {
    const file = join(directory, "connections.json");
    const prefix = '{"connections":{"bounded":{"baseUrl":"http://fixture.invalid/"}},"padding":"';
    const suffix = '"}';
    const exact = prefix + "x".repeat(1024 * 1024 - prefix.length - suffix.length) + suffix;
    await writeFile(file, exact);
    assert.equal(loadConfig({ configPath: file, connection: "bounded" }).name, "bounded");
    await writeFile(file, exact + " ");
    assert.throws(() => loadConfig({ configPath: file }), { code: "INVALID_CONFIG" });
    assert.throws(() => loadConfig({ configPath: directory }), { code: "INVALID_CONFIG" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("named profiles isolate origin, credentials and write policy from global environment overrides", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hcm-config-"));
  const file = join(directory, "profiles.json");
  const keys = [
    "WTCTL_URL",
    "WTCTL_USERNAME",
    "WTCTL_PASSWORD",
    "WTCTL_ALLOW_WRITE",
    "WTCTL_ALLOW_EXECUTE",
  ];
  const previous = keys.map((key) => process.env[key]);
  try {
    await writeFile(
      file,
      JSON.stringify({
        defaultConnection: "prod",
        connections: {
          prod: {
            baseUrl: "http://prod.test/",
            username: "profile-user",
            password: "profile-secret",
            permissions: { write: false, execute: false },
          },
        },
      }),
    );
    for (const [index, key] of keys.entries())
      process.env[key] = ["http://dev.test/", "global-user", "global-secret", "true", "true"][
        index
      ]!;
    const result = loadConfig({ configPath: file });
    assert.equal(result.baseUrl, "http://prod.test/");
    assert.equal(result.username, "profile-user");
    assert.deepEqual(result.permissions, { write: false, execute: false });
  } finally {
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
    await rm(directory, { recursive: true, force: true });
  }
});
test("opaque result scope prevents cross-connection access and rejects traversal; emoji pages always progress", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hcm-results-"));
  try {
    const store = new ResultStore(config(directory));
    const stored = await store.put("😀x");
    const page = await store.read(stored.resultId, 0, 1);
    assert.equal(page.text, "😀");
    assert.equal(page.nextOffset, 2);
    assert.equal((await store.read(stored.resultId, 2, 1)).text, "x");
    await assert.rejects(
      new ResultStore(config(directory, "other")).read(stored.resultId),
      /сохранён другим подключением/,
    );
    await assert.rejects(store.read("../../file"), /resultId неверен/);
    const array = await store.put([{ id: "1" }, { id: "2" }]);
    assert.deepEqual(await store.read(array.resultId, 1, 1), { items: [{ id: "2" }], total: 2 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("oversized array rows remain recoverable as bounded JSON pages without skipping or corrupting Unicode", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hcm-results-"));
  try {
    const settings = { ...config(directory), outputLimitBytes: 1024 };
    const store = new ResultStore(settings);
    const data = [{ id: "0x65CAFFFFFFFFFFFF", text: '😀"\\\n'.repeat(500) }, { id: "second" }];
    const saved = await store.put(data);
    const blocked = await store.read(saved.resultId, 0, 10);
    assert.deepEqual(blocked.items, []);
    assert.equal((blocked.blockedItem as { index: number }).index, 0);
    assert.equal(blocked.nextOffset, undefined);
    let offset = 0;
    let text = "";
    let pages = 0;
    while (true) {
      const page = await store.read(saved.resultId, offset, 65536, "json");
      assert.ok(Buffer.byteLength(JSON.stringify(page)) <= settings.outputLimitBytes);
      assert.equal(page.format, "json");
      text += page.text;
      pages++;
      if (page.nextOffset === undefined) break;
      assert.ok(Number(page.nextOffset) > offset);
      offset = Number(page.nextOffset);
    }
    assert.ok(pages > 1);
    assert.deepEqual(JSON.parse(text), data);
    await assert.rejects(store.read(saved.resultId, 0, 0), /больше нуля/);
    await writeFile(store.path(saved.resultId), JSON.stringify({ version: 2, data }));
    await assert.rejects(store.read(saved.resultId), /не читается/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
