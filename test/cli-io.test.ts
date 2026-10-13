import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { mkdtemp, readFile, readdir, rm, mkdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { CliInputError } from "../src/cli/arguments.js";
import { readBounded, readBoundedBytes, writeAtomicOutput } from "../src/cli/node-io.js";

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
