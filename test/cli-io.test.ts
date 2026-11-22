import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { lstat, mkdtemp, open, readFile, readdir, rm, mkdir, symlink } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { CliInputError } from "../src/cli/arguments.js";
import {
  readBounded,
  readBoundedBytes,
  writeAtomicOutput,
  writeConfigIfUnchanged,
} from "../src/cli/node-io.js";
import { HcmError } from "../src/errors.js";

test("ограниченный ввод UTF-8 считает байты, справляется с разрезанными кодовыми точками и отклоняет неверную кодировку", async () => {
  const utf8 = Buffer.from("Привет", "utf8");
  assert.equal(
    await readBounded(Readable.from([utf8.subarray(0, 1), utf8.subarray(1)]), utf8.length),
    "Привет",
  );
  await assert.rejects(readBounded(Readable.from([utf8]), utf8.length - 1), CliInputError);
  await assert.rejects(readBounded(Readable.from([Buffer.from([0xff])]), 10), CliInputError);
  const binary = Buffer.from([0, 255, 254, 65]);
  assert.deepEqual(await readBoundedBytes(Readable.from([binary]), binary.length), binary);
});

test("потоки ввода закрываются при переполнении и передают ошибки источника, ничего не печатая", async () => {
  const oversized = Readable.from([Buffer.alloc(11)]);
  await assert.rejects(readBounded(oversized, 10), CliInputError);
  assert.equal(oversized.destroyed, true);
  const broken = new Readable({
    read() {
      this.destroy(new Error("synthetic-source-error"));
    },
  });
  await assert.rejects(readBounded(broken, 10), /synthetic-source-error/);
  assert.equal(broken.destroyed, true);
});

test("атомарный вывод создаёт родительские папки, заменяет свой вывод и убирает промежуточный файл после сбоя", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wtctl-cli-"));
  try {
    const file = join(directory, "nested", "result.json");
    await writeAtomicOutput(file, '{"first":true}\n');
    await writeAtomicOutput(file, '{"second":"Привет"}\n');
    assert.equal(await readFile(file, "utf8"), '{"second":"Привет"}\n');
    assert.deepEqual(await readdir(dirname(file)), ["result.json"]);
    const existingDirectory = join(directory, "cannot-replace-directory");
    await mkdir(existingDirectory);
    await assert.rejects(writeAtomicOutput(existingDirectory, "synthetic"));
    assert.equal(
      (await readdir(directory)).some((entry) => entry.endsWith(".tmp")),
      false,
    );
  } finally {
    // Убедиться, что цель рекурсивного удаления — временная папка этого теста прямо в tmpdir.
    assert.equal(resolve(dirname(directory)), resolve(tmpdir()));
    assert.match(basename(directory), /^wtctl-cli-/);
    await rm(directory, { recursive: true, force: true });
  }
});

test("writeConfigIfUnchanged сохраняет файл при совпадении и отклоняет чужую правку или блокировку без остатков", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wtctl-cli-lock-"));
  try {
    const file = join(directory, "nested", "connections.json");
    const initial = '{"connections":{"dev":{"baseUrl":"http://a.test/"}}}\n';
    const next = '{"connections":{"dev":{"baseUrl":"http://b.test/"}}}\n';

    // Создание нового файла, когда его не было (expectedText = undefined).
    await writeConfigIfUnchanged(file, undefined, initial);
    assert.equal(await readFile(file, "utf8"), initial);
    assert.deepEqual(await readdir(dirname(file)), ["connections.json"]);

    // Повторное создание, когда файл уже появился: CONFIG_CONFLICT.
    await assert.rejects(
      writeConfigIfUnchanged(file, undefined, next),
      (error: unknown) => error instanceof HcmError && error.code === "CONFIG_CONFLICT",
    );
    assert.equal(await readFile(file, "utf8"), initial);

    await writeConfigIfUnchanged(file, initial, next);
    assert.equal(await readFile(file, "utf8"), next);
    assert.deepEqual(await readdir(dirname(file)), ["connections.json"]);

    // Изменили файл после чтения: запись отказывает, файл не перетёрт и .lock удалён.
    await assert.rejects(
      writeConfigIfUnchanged(file, initial, '{"lost":true}\n'),
      (error: unknown) => error instanceof HcmError && error.code === "CONFIG_CONFLICT",
    );
    assert.equal(await readFile(file, "utf8"), next);
    assert.deepEqual(await readdir(dirname(file)), ["connections.json"]);

    // Активный файл блокировки другого процесса: отказ CONFIG_CONFLICT с подсказкой про .lock.
    const lock = await open(`${file}.lock`, "wx");
    try {
      await assert.rejects(
        writeConfigIfUnchanged(file, next, initial),
        (error: unknown) =>
          error instanceof HcmError &&
          error.code === "CONFIG_CONFLICT" &&
          /\.lock/.test(error.hint ?? ""),
      );
      assert.equal(await readFile(file, "utf8"), next);
    } finally {
      await lock.close();
      await rm(`${file}.lock`, { force: true });
    }
  } finally {
    assert.equal(resolve(dirname(directory)), resolve(tmpdir()));
    assert.match(basename(directory), /^wtctl-cli-lock-/);
    await rm(directory, { recursive: true, force: true });
  }
});

test("writeConfigIfUnchanged сохраняет симлинк файла подключений и ставит блокировку рядом с целью", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "wtctl-cli-symlink-"));
  try {
    const target = join(directory, "real", "connections.json");
    const linkPath = join(directory, "link", "connections.json");
    await mkdir(dirname(target), { recursive: true });
    await mkdir(dirname(linkPath), { recursive: true });
    const initial = '{"connections":{"dev":{"baseUrl":"http://a.test/"}}}\n';
    const next = '{"connections":{"dev":{"baseUrl":"http://b.test/"}}}\n';
    await writeConfigIfUnchanged(target, undefined, initial);
    try {
      await symlink(target, linkPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") {
        t.skip("ОС не разрешает создание симлинков без прав");
        return;
      }
      throw error;
    }

    // Блокировка на реальном пути видна при записи через симлинк.
    const lock = await open(`${target}.lock`, "wx");
    try {
      await assert.rejects(
        writeConfigIfUnchanged(linkPath, initial, next),
        (error: unknown) => error instanceof HcmError && error.code === "CONFIG_CONFLICT",
      );
    } finally {
      await lock.close();
      await rm(`${target}.lock`, { force: true });
    }

    await writeConfigIfUnchanged(linkPath, initial, next);
    assert.equal((await lstat(linkPath)).isSymbolicLink(), true);
    assert.equal(await readFile(target, "utf8"), next);
    assert.equal(await readFile(linkPath, "utf8"), next);

    // Висячий симлинк (цели ещё нет, как при config init): создаётся цель, сам симлинк сохраняется.
    const missingTarget = join(directory, "real-new", "connections.json");
    const danglingLink = join(directory, "link", "dangling.json");
    await symlink(missingTarget, danglingLink);
    await writeConfigIfUnchanged(danglingLink, undefined, initial);
    assert.equal((await lstat(danglingLink)).isSymbolicLink(), true);
    assert.equal(await readFile(missingTarget, "utf8"), initial);
    assert.equal(await readFile(danglingLink, "utf8"), initial);
  } finally {
    assert.equal(resolve(dirname(directory)), resolve(tmpdir()));
    assert.match(basename(directory), /^wtctl-cli-symlink-/);
    await rm(directory, { recursive: true, force: true });
  }
});
