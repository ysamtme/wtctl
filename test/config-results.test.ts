import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, type ConnectionSettings } from "../src/config.js";
import { HcmError } from "../src/errors.js";
import { ResultStore } from "../src/results.js";
import type { ConnectionConfig } from "../src/contracts.js";
import { fakeRuntime } from "./fake-server.js";

const config = (runtimeDir: string, name = "dev"): ConnectionConfig => ({
  name,
  baseUrl: "http://hcm.test/",
  timeoutMs: 1000,
  maxResponseBytes: 1024 * 1024,
  outputLimitBytes: 24000,
  runtimeDir,
  permissions: { write: false, execute: false },
});
test("конфигурация принимает UTF-8 BOM и сохраняет значения подключения в Unicode", async () => {
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

test("ключи удалённого прежнего клиента в файле подключений игнорируются", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hcm-config-leftover-"));
  try {
    const file = join(directory, "connections.json");
    const dev = { baseUrl: "http://x.invalid/", installationId: "bad", installationIdFile: "x" };
    await writeFile(file, JSON.stringify({ connections: { dev } }));
    assert.equal(loadConfig({ configPath: file, connection: "dev" }).baseUrl, dev.baseUrl);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("конфигурация отклоняет неверный UTF-8, а не подменяет байты учётных данных", async () => {
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

test("конфигурация соблюдает предел в байтах и отклоняет папки", async () => {
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

test("именованные подключения изолируют origin, учётные данные и право на запись от глобальных переопределений через переменные окружения", async () => {
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
/** Запуск без переменных WTCTL_* и с пустой папкой клиента; после — вернуть переменные. */
async function withEnvironment<T>(
  variables: Record<string, string>,
  run: (home: string) => T | Promise<T>,
): Promise<T> {
  const previous = Object.entries(process.env).filter(([key]) => key.startsWith("WTCTL_"));
  const home = await mkdtemp(join(tmpdir(), "hcm-config-env-"));
  try {
    for (const [key] of previous) delete process.env[key];
    Object.assign(process.env, { WTCTL_HOME: home }, variables);
    return await run(home);
  } finally {
    for (const key of Object.keys(process.env))
      if (key.startsWith("WTCTL_")) delete process.env[key];
    Object.assign(process.env, Object.fromEntries(previous));
    await rm(home, { recursive: true, force: true });
  }
}
/** Ошибка, которую бросил вызов, или undefined. */
function thrown(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  return undefined;
}
// Поле, переменная, верное и неверное значение.
const fields: [string, string, number | string, number | string][] = [
  ["timeoutMs", "WTCTL_TIMEOUT_MS", 5000, 0],
  ["maxResponseBytes", "WTCTL_MAX_RESPONSE_BYTES", 2048, 1000],
  ["outputLimitBytes", "WTCTL_OUTPUT_LIMIT_BYTES", 1024, 2 * 1024 * 1024],
  ["runtimeDir", "WTCTL_RUNTIME_DIR", join(tmpdir(), "hcm-config-runtime"), ""],
  ["resultsMaxBytes", "WTCTL_RESULTS_MAX_BYTES", 0, 500],
  ["resultsMaxAgeDays", "WTCTL_RESULTS_MAX_AGE_DAYS", 3, 5000],
  ["journalMaxBytes", "WTCTL_JOURNAL_MAX_BYTES", 4096, -1],
];

test("поле подключения одинаково задают файл, переменная и settings, и неверное значение отклоняется одинаково", async () => {
  await withEnvironment({}, async (home) => {
    const file = join(home, "connections.json");
    const write = (extra: Record<string, unknown>) =>
      writeFile(
        file,
        JSON.stringify({ connections: { default: { baseUrl: "http://hcm.test/", ...extra } } }),
      );
    const load = (settings?: Record<string, unknown>) =>
      loadConfig({
        configPath: file,
        ...(settings ? { settings: settings as ConnectionSettings } : {}),
      });
    for (const [field, variable, good, bad] of fields) {
      await write({ [field]: good });
      const fromFile = load();
      await write({});
      process.env[variable] = String(good);
      const fromVariable = load();
      delete process.env[variable];
      const fromSettings = load({ [field]: good });
      assert.deepEqual(fromVariable, fromFile, field);
      assert.deepEqual(fromSettings, fromFile, field);
      assert.notDeepEqual(load(), fromFile, field);

      await write({ [field]: bad });
      const failures = [thrown(() => load())];
      await write({});
      process.env[variable] = String(bad);
      failures.push(thrown(() => load()));
      delete process.env[variable];
      failures.push(thrown(() => load({ [field]: bad })));
      for (const failure of failures) {
        assert.ok(failure instanceof HcmError, field);
        assert.equal(failure.code, "INVALID_CONFIG", field);
        assert.equal(failure.message, (failures[0] as HcmError).message, field);
      }
      assert.match((failures[0] as HcmError).message, new RegExp(`^${field} \\(${variable}\\):`));
    }
  });
});

test("settings сильнее переменной, переменная сильнее поля в файле с разделом connections", async () => {
  await withEnvironment({}, async (home) => {
    const file = join(home, "connections.json");
    await writeFile(
      file,
      JSON.stringify({
        connections: { default: { baseUrl: "http://hcm.test/", outputLimitBytes: 2048 } },
      }),
    );
    const limit = (settings?: ConnectionSettings) =>
      loadConfig({ configPath: file, ...(settings ? { settings } : {}) }).outputLimitBytes;
    assert.equal(limit(), 2048);
    process.env.WTCTL_OUTPUT_LIMIT_BYTES = "4096";
    assert.equal(limit(), 4096);
    assert.equal(limit({ outputLimitBytes: 8192 }), 8192);
    await writeFile(
      file,
      JSON.stringify({ connections: { default: { baseUrl: "http://hcm.test/" } } }),
    );
    delete process.env.WTCTL_OUTPUT_LIMIT_BYTES;
    assert.deepEqual([limit(), loadConfig({ configPath: file }).resultsMaxAgeDays], [24 * 1024, 7]);
  });
});

test("settings не меняет адрес, учётные данные и права подключения из файла или переменных", async () => {
  await withEnvironment({ WTCTL_URL: "http://env.test/" }, async (home) => {
    const file = join(home, "other.json");
    await writeFile(
      file,
      JSON.stringify({ connections: { default: { baseUrl: "http://hcm.test/" } } }),
    );
    for (const settings of [
      { username: "admin" },
      { password: "local-test-only" },
      { permissions: { write: true } },
    ])
      for (const configPath of [file, undefined])
        assert.throws(
          () => loadConfig({ ...(configPath ? { configPath } : {}), settings }),
          (error: unknown) =>
            error instanceof HcmError &&
            error.code === "INVALID_CONFIG" &&
            !error.message.includes("local-test-only"),
        );
    assert.throws(() => loadConfig({ settings: { timeout: 5 } as never }), {
      code: "INVALID_CONFIG",
      message: /settings\.timeout/,
    });
  });
});

test("settings с baseUrl — подключение без файла и без переменных адреса, учётных данных и прав", async () => {
  await withEnvironment(
    {
      WTCTL_URL: "http://env.test/",
      WTCTL_USERNAME: "env-user",
      WTCTL_PASSWORD: "env-secret",
      WTCTL_ALLOW_WRITE: "true",
      WTCTL_CONNECTION: "env",
      WTCTL_TIMEOUT_MS: "5000",
    },
    async (home) => {
      // Файл в стандартном месте не читается: в нём неверный JSON.
      await writeFile(join(home, "connections.json"), "{");
      const settings = { baseUrl: "http://hcm.test", outputLimitBytes: 1024 };
      assert.deepEqual(loadConfig({ settings }), {
        name: "default",
        baseUrl: "http://hcm.test/",
        timeoutMs: 5000,
        maxResponseBytes: 32 * 1024 * 1024,
        outputLimitBytes: 1024,
        runtimeDir: join(home, "runtime"),
        resultsMaxBytes: 1024 * 1024 * 1024,
        resultsMaxAgeDays: 7,
        journalMaxBytes: 10 * 1024 * 1024,
        permissions: { write: false, execute: false },
      });
      const own = loadConfig({
        connection: "script",
        settings: {
          ...settings,
          username: "admin",
          password: "local-test-only",
          permissions: { execute: true },
        },
      });
      assert.deepEqual(
        [own.name, own.username, own.password, own.permissions],
        ["script", "admin", "local-test-only", { write: false, execute: true }],
      );
      assert.throws(() => loadConfig({ settings: { ...settings, username: "admin" } }), {
        code: "INVALID_CONFIG",
      });
      assert.throws(() => loadConfig({ configPath: join(home, "connections.json"), settings }), {
        code: "INVALID_CONFIG",
      });
      process.env.WTCTL_CONFIG = join(home, "connections.json");
      assert.throws(() => loadConfig({ settings }), { code: "INVALID_CONFIG" });
    },
  );
});

test("непрозрачная область результатов не пускает к чужому подключению и отклоняет выход за пределы пути; страницы с эмодзи всегда продвигаются", async () => {
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

test("слишком большие строки массивов читаются ограниченными страницами JSON без пропусков и порчи Unicode", async () => {
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

const HOUR = 3600 * 1000;
/** Сдвигает время изменения всех файлов результата в прошлое. */
async function age(directory: string, resultId: string, ms: number): Promise<number> {
  let bytes = 0;
  const time = new Date(Date.now() - ms);
  for (const name of await readdir(directory))
    if (name.startsWith(resultId)) {
      await utimes(join(directory, name), time, time);
      bytes += (await stat(join(directory, name))).size;
    }
  return bytes;
}

test("новый результат удаляет из папки подключения старые по сроку, затем самые старые сверх предела", async () => {
  const runtimeDir = await mkdtemp(join(tmpdir(), "hcm-results-prune-"));
  const script = { "native.spxml2.getAppInfo": { large: "x".repeat(5000) } };
  const limits = { runtimeDir, outputLimitBytes: 1024, resultsMaxAgeDays: 7 };
  const save = async (runtime: ReturnType<typeof fakeRuntime>["runtime"]) => {
    const result = await runtime.call("native.spxml2.getAppInfo");
    assert.equal(result.meta.truncated, true);
    return result.meta.resultId!;
  };
  const other = fakeRuntime(script, { ...limits, name: "other" }).runtime;
  const first = fakeRuntime(script, limits).runtime;
  try {
    const directory = first.results.directory;
    const foreign = await save(other);
    await age(other.results.directory, foreign, 30 * 24 * HOUR);
    const [expired, oldest, older, fresh] = [
      await save(first),
      await save(first),
      await save(first),
      await save(first),
    ];
    const size = await age(directory, expired, 8 * 24 * HOUR);
    await age(directory, oldest, 3 * HOUR);
    await age(directory, older, 2 * HOUR);
    await age(directory, fresh, HOUR / 2);
    // Журнал записей, недописанный результат и результат, который не удаляется, — не в счёт.
    await writeFile(join(directory, "mutations.jsonl"), "x".repeat(10 * size));
    const unfinished = "00000000-0000-4000-8000-000000000001";
    await writeFile(join(directory, `${unfinished}.data.json.tmp`), "x");
    await age(directory, unfinished, 30 * 24 * HOUR);
    const stuck = "00000000-0000-4000-8000-000000000002";
    await writeFile(join(directory, `${stuck}.json`), "x".repeat(10 * size));
    await mkdir(join(directory, `${stuck}.data.json`));
    await age(directory, stuck, 30 * 24 * HOUR);

    // Новый результат и три оставшихся больше предела на один: удаляется самый старый.
    const bounded = fakeRuntime(script, {
      ...limits,
      resultsMaxBytes: 3 * size + 100,
    }).runtime;
    const newest = await save(bounded);
    const read = async (resultId: string, runtime = first) =>
      (await runtime.call("results.read", { resultId })).error;
    for (const resultId of [expired, oldest]) {
      const error = await read(resultId);
      assert.equal(error?.code, "RESULT_NOT_FOUND");
      assert.match(error?.hint ?? "", /сроку хранения.*повторить запрос/s);
    }
    for (const resultId of [older, fresh, newest]) assert.equal(await read(resultId), undefined);
    assert.equal(await read(foreign, other), undefined);
    const left = await readdir(directory);
    for (const name of ["mutations.jsonl", `${unfinished}.data.json.tmp`, `${stuck}.json`])
      assert.ok(left.includes(name), name);

    // Результаты моложе часа остаются и сверх предела; 0 снимает срок и предел.
    const tiny = fakeRuntime(script, { ...limits, resultsMaxBytes: 1024 }).runtime;
    await save(tiny);
    assert.equal((await read(older))?.code, "RESULT_NOT_FOUND");
    assert.equal(await read(fresh), undefined);
    await age(directory, fresh, 30 * 24 * HOUR);
    const unlimited = fakeRuntime(script, {
      ...limits,
      resultsMaxBytes: 0,
      resultsMaxAgeDays: 0,
    }).runtime;
    await save(unlimited);
    assert.equal(await read(fresh), undefined);
    await Promise.all([bounded.close(), tiny.close(), unlimited.close()]);
  } finally {
    await Promise.all([first.close(), other.close()]);
    await rm(runtimeDir, { recursive: true, force: true });
  }
});

test("журнал записей больше journalMaxBytes становится mutations.1.jsonl, строки записей не теряются", async () => {
  const runtimeDir = await mkdtemp(join(tmpdir(), "hcm-journal-"));
  let stored = "<fixture><id>41</id><name>before</name></fixture>";
  const xml = () => ({ kind: "binary", bytes: new TextEncoder().encode(stored) });
  const script = {
    "native.lds.loadDoc": xml,
    "native.spxml2.getForm":
      '<SPXML-FORM><fixture><id TYPE="integer"/><name TYPE="string"/></fixture></SPXML-FORM>',
    "native.lds.putDoc": (args: Record<string, unknown>) => {
      stored = String(args.data);
      return {};
    },
  };
  let directory = "";
  const patch = async (journalMaxBytes: number, name: string) => {
    const { runtime } = fakeRuntime(script, { runtimeDir, journalMaxBytes });
    directory = runtime.results.directory;
    try {
      const result = await runtime.call("objects.patch", { id: "41", patch: { name } });
      return (result.data as { mutationId: string }).mutationId;
    } finally {
      await runtime.close();
    }
  };
  const lines = async (path: string) =>
    (await readFile(path, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  try {
    let last = "";
    for (let index = 0; index < 12; index++) last = await patch(1024, `name ${index}`);
    const current = join(directory, "mutations.jsonl");
    const previous = join(directory, "mutations.1.jsonl");
    assert.ok((await stat(current)).size <= 1024 + 512);
    assert.ok((await stat(previous)).size > 1024);
    const all = [...(await lines(previous)), ...(await lines(current))];
    assert.deepEqual(
      all.filter((line) => line.mutationId === last).map((line) => line.stage),
      ["prepared", "verified"],
    );
    assert.deepEqual(Object.keys(all.at(-1)!), [
      "at",
      "mutationId",
      "operation",
      "stage",
      "fingerprint",
    ]);
    // 0 — без предела: файл только растёт.
    const before = [(await stat(current)).size, await readFile(previous, "utf8")] as const;
    for (let index = 0; index < 6; index++) await patch(0, `unlimited ${index}`);
    assert.ok((await stat(current)).size > before[0] + 1024);
    assert.equal(await readFile(previous, "utf8"), before[1]);
  } finally {
    await rm(runtimeDir, { recursive: true, force: true });
  }
});
