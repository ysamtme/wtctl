import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { mkdtemp, readFile, writeFile, readdir, unlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ResultStore } from "../src/results.js";
import type { ConnectionConfig } from "../src/contracts.js";

function config(directory: string): ConnectionConfig {
  return {
    name: "stream",
    baseUrl: "http://fixture.invalid/",
    timeoutMs: 1000,
    maxResponseBytes: 1024,
    outputLimitBytes: 4096,
    runtimeDir: directory,
    permissions: { write: false, execute: false },
  };
}
async function fixture(action: (store: ResultStore) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "hcm-result-stream-"));
  try {
    await action(new ResultStore(config(directory)));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
async function entire(store: ResultStore, id: string, format?: "json"): Promise<string> {
  const parts: string[] = [];
  let offset = 0;
  for (;;) {
    const page = await store.read(id, offset, 65536, format);
    assert.ok(Buffer.byteLength(JSON.stringify(page)) <= store.config.outputLimitBytes);
    assert.equal(typeof page.text, "string");
    parts.push(page.text as string);
    if (page.nextOffset === undefined) break;
    assert.ok(Number(page.nextOffset) > offset, "every nonfinal page must advance");
    offset = Number(page.nextOffset);
  }
  return parts.join("");
}

test("страницы JSON с индексом точно восстанавливают слишком большой объект с Unicode по разреженным контрольным точкам", async () => {
  await fixture(async (store) => {
    const data = {
      padding: "x".repeat(65521) + "😀Ж".repeat(20000),
      escaped: '\n\t"\\\u0000\ud800X',
      tail: { complete: true },
    };
    const expected = JSON.stringify(data);
    const stored = await store.put(data);
    assert.ok(stored.bytes > store.config.maxResponseBytes * 2);
    assert.equal(await entire(store, stored.resultId, "json"), expected);
    for (const offset of [65520, 65535, 65536, 70000, expected.length - 7]) {
      if (/[\uDC00-\uDFFF]/.test(expected.charAt(offset))) continue;
      const page = await store.read(stored.resultId, offset, 19, "json");
      assert.equal(page.text, expected.slice(offset, Number(page.nextOffset ?? expected.length)));
    }
  });
});

test("страницы простой строки сохраняют управляющие символы и одиночные суррогаты и не позволяют разрезать настоящие суррогатные пары", async () => {
  await fixture(async (store) => {
    const source = "x".repeat(65535) + "😀\ud800X\udc00\n\u0000кириллица";
    const stored = await store.put(source);
    assert.equal(await entire(store, stored.resultId), source);
    assert.equal(await entire(store, stored.resultId, "json"), JSON.stringify(source));
    await assert.rejects(store.read(stored.resultId, 65536, 1), /в середину символа Unicode/);
    const pair = await store.read(stored.resultId, 65535, 1);
    assert.equal(pair.text, "😀");
    assert.equal(pair.nextOffset, 65537);
  });
});

test("индексы строк фиксированного размера позволяют читать поздние страницы массива, не читая предшествующие слишком большие строки", async () => {
  await fixture(async (store) => {
    const rows = [
      { index: 0, text: "large".repeat(2000) },
      ...Array.from({ length: 10000 }, (_, index) => ({ index: index + 1 })),
    ];
    const stored = await store.put(rows);
    const blocked = await store.read(stored.resultId, 0, 10);
    assert.equal((blocked.blockedItem as { index: number }).index, 0);
    assert.deepEqual(blocked.items, []);
    assert.equal(blocked.nextOffset, undefined);
    assert.deepEqual(await store.read(stored.resultId, 9999, 2), {
      items: [{ index: 9999 }, { index: 10000 }],
      total: 10001,
    });
    assert.deepEqual(await store.read(stored.resultId, 10001, 2), { items: [], total: 10001 });
    const metadata = JSON.parse(await readFile(store.path(stored.resultId), "utf8"));
    assert.ok(
      Buffer.byteLength(JSON.stringify(metadata)) < 512,
      "metadata size must not grow with the row count",
    );
    assert.equal(metadata.rows, rows.length);
    assert.equal(
      (await readFile(join(store.directory, `${stored.resultId}.rows.idx`))).byteLength,
      rows.length * 16,
    );
  });
});

test("сбой сериализации удаляет только свои неопубликованные файлы и сохраняет существующие ссылки", async () => {
  await fixture(async (store) => {
    const valid = await store.put({ valid: true });
    const before = (await readdir(store.directory)).sort();
    const circular: { self?: unknown } = {};
    circular.self = circular;
    await assert.rejects(store.put([{ valid: true }, circular]), /нельзя записать как JSON/);
    assert.deepEqual((await readdir(store.directory)).sort(), before);
    assert.equal((await store.read(valid.resultId, 0, 100, "json")).text, '{"valid":true}');
  });
});

test("сбой записи метаданных после создания удаляет файлы неполной публикации и сохраняет прежние ссылки", async () => {
  await fixture(async (store) => {
    const valid = await store.put({ valid: true });
    const before = (await readdir(store.directory)).sort();
    const originalOpen = fs.promises.open;
    const originalWriteFile = fs.promises.writeFile;
    const metadataPath = (path: unknown): boolean =>
      /[\\/][\da-f-]{36}\.json\.tmp$/.test(String(path));
    const diskFull = (): NodeJS.ErrnoException =>
      Object.assign(new Error("Synthetic metadata disk full after creation"), { code: "ENOSPC" });
    // Проверяется граница файловой системы, в том числе реализации через writeFile
    // или явно открытый файл: каждый сбой происходит после появления файла.
    fs.promises.writeFile = async (path, data, options) => {
      if (metadataPath(path)) {
        await originalWriteFile(path, "partial", options);
        throw diskFull();
      }
      return originalWriteFile(path, data, options);
    };
    fs.promises.open = async (...args) => {
      const handle = await originalOpen(...args);
      if (metadataPath(args[0])) {
        handle.write = new Proxy(handle.write, {
          async apply(write, receiver, argumentsList) {
            if (typeof argumentsList[2] === "number")
              argumentsList[2] = Math.min(argumentsList[2], 8);
            await Reflect.apply(write, receiver, argumentsList);
            throw diskFull();
          },
        });
      }
      return handle;
    };
    syncBuiltinESMExports();
    try {
      await assert.rejects(
        store.put({ text: "owned new result" }),
        (error) =>
          error instanceof Error && "code" in error && error.code === "RESULT_WRITE_FAILED",
      );
    } finally {
      fs.promises.open = originalOpen;
      fs.promises.writeFile = originalWriteFile;
      syncBuiltinESMExports();
    }
    assert.deepEqual(
      (await readdir(store.directory)).sort(),
      before,
      "unpublished metadata must be tracked immediately after exclusive creation",
    );
    assert.equal((await store.read(valid.resultId, 0, 100, "json")).text, '{"valid":true}');
  });
});

test("повреждённые метаданные и отсутствующие payload дают явную ошибку, а не страницу без продвижения", async () => {
  await fixture(async (store) => {
    const stored = await store.put({ data: "bounded" });
    const path = store.path(stored.resultId);
    const original = await readFile(path, "utf8");
    const metadata = JSON.parse(original);
    await writeFile(path, JSON.stringify({ ...metadata, jsonChars: metadata.jsonChars + 1 }));
    await assert.rejects(store.read(stored.resultId, metadata.jsonChars, 1, "json"), /не читается/);
    await writeFile(path, JSON.stringify({ ...metadata, jsonChars: metadata.jsonChars - 1 }));
    await assert.rejects(store.read(stored.resultId, 0, 100, "json"), /не читается/);
    await writeFile(path, JSON.stringify({ ...metadata, checkpoints: -1 }));
    await assert.rejects(store.read(stored.resultId, 0, 10, "json"), /не читается/);
    await writeFile(path, original);
    await unlink(join(store.directory, `${stored.resultId}.data.json`));
    await assert.rejects(store.read(stored.resultId), /не читается/);
  });
});

test("старые артефакты читаются в прежних границах, а у слишком больших старых данных есть явное ограничение при обновлении", async () => {
  await fixture(async (store) => {
    const stored = await store.put("temporary");
    await writeFile(store.path(stored.resultId), JSON.stringify({ version: 1, data: "😀value" }));
    assert.equal((await store.read(stored.resultId, 0, 1)).text, "😀");
    await writeFile(
      store.path(stored.resultId),
      JSON.stringify({ version: 1, data: "x".repeat(3000) }),
    );
    await assert.rejects(store.read(stored.resultId), /сохранён прежней версией клиента/);
  });
});

test("пустые значения JSON завершают постраничное чтение, а недоступная для записи папка результатов даёт локальную ошибку хранилища", async () => {
  await fixture(async (store) => {
    const plain = await store.put("");
    assert.deepEqual(await store.read(plain.resultId), { text: "", format: "text", totalChars: 0 });
    assert.deepEqual(await store.read(plain.resultId, 1), {
      text: "",
      format: "text",
      totalChars: 0,
    });
    const rows = await store.put([]);
    assert.deepEqual(await store.read(rows.resultId), { items: [], total: 0 });
    assert.equal(await entire(store, rows.resultId, "json"), "[]");
    const blocked = join(store.directory, "blocked-file");
    await writeFile(blocked, "content");
    const wrong = new ResultStore({ ...store.config, runtimeDir: blocked });
    await assert.rejects(
      wrong.put({ value: true }),
      (error) => error instanceof Error && "code" in error && error.code === "RESULT_WRITE_FAILED",
    );
  });
});

test("экспорт потоком записывает полный JSON, JSONL из array/items и текст UTF-8 с точными сводками", async () => {
  await fixture(async (store) => {
    const nested = [1, { items: [] }];
    const rows = [{ text: 'Ж😀\\"[,]'.repeat(12000), nested }, null, true, "tail"];
    const text = "x".repeat(2046) + "😀\nЖ\ud800";
    const lines = rows.map((row) => JSON.stringify(row) + "\n").join("");
    const catalog = { prefix: { items: ["ignored"] }, 'prefix"items': [], items: rows, total: 4 };
    const cases = [
      [rows, "json", JSON.stringify(rows), undefined],
      [rows, "jsonl", lines, 4],
      [catalog, "jsonl", lines, 4],
      [[], "jsonl", "", 0],
      [text, "text", Buffer.from(text).toString(), undefined],
    ] as const;
    for (const [data, format, expected, items] of cases) {
      const { resultId } = await store.put(data);
      const path = join(store.config.runtimeDir, "exported");
      const exported = await store.export({ resultId, path, format, overwrite: true });
      assert.equal(await readFile(path, "utf8"), expected);
      assert.equal(exported.bytes, Buffer.byteLength(expected));
      assert.equal(exported.items, items);
    }
  });
});

test("экспорт отклоняет несовместимые форматы и существующие файлы, не оставляя временных файлов", async () => {
  await fixture(async (store) => {
    const { resultId } = await store.put({ items: "not an array" });
    const path = join(store.config.runtimeDir, "exported");
    const before = await readdir(store.config.runtimeDir);
    for (const format of ["text", "jsonl", "wrong"] as const) {
      await assert.rejects(store.export({ resultId, path, format: format as "text" }), {
        code: "INVALID_RESULT_FORMAT",
      });
      assert.deepEqual(await readdir(store.config.runtimeDir), before);
    }
    await writeFile(path, "original");
    await assert.rejects(store.export({ resultId, path }), { code: "FILE_EXISTS" });
    assert.equal(await readFile(path, "utf8"), "original");
    await store.export({ resultId, path, overwrite: true });
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { items: "not an array" });
    await assert.rejects(store.export({ resultId, path: join(path + "-missing", "out") }), {
      code: "FOLDER_NOT_FOUND",
    });
    // Папка, указанная как путь, названа папкой — с перезаписью и без неё.
    for (const overwrite of [false, true])
      await assert.rejects(store.export({ resultId, path: store.config.runtimeDir, overwrite }), {
        code: "INVALID_ARGUMENT",
      });
  });
});

test("сбой посреди записи экспорта не оставляет ни целевого, ни временного файла", async () => {
  await fixture(async (store) => {
    const { resultId } = await store.put(["data"]);
    const path = join(store.config.runtimeDir, "failed-export");
    const original = fs.promises.writeFile;
    fs.promises.writeFile = async (target, data, options) => {
      if (String(target).startsWith(path + ".")) {
        await original(target, "partial", options);
        throw Object.assign(new Error("Synthetic disk full"), { code: "ENOSPC" });
      }
      return original(target, data, options);
    };
    syncBuiltinESMExports();
    try {
      const before = (await readdir(store.config.runtimeDir)).sort();
      await assert.rejects(store.export({ resultId, path, overwrite: true }));
      assert.deepEqual((await readdir(store.config.runtimeDir)).sort(), before);
    } finally {
      fs.promises.writeFile = original;
      syncBuiltinESMExports();
    }
  });
});
