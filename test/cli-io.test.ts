import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { mkdtemp, readFile, readdir, rm, mkdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { CliInputError } from "../src/cli/arguments.js";
import { readBounded, readBoundedBytes, writeAtomicOutput } from "../src/cli/node-io.js";

test("bounded UTF-8 input counts bytes, handles split code points and rejects invalid encoding", async () => {
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

test("input streams close on overflow and propagate source errors without printing", async () => {
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

test("atomic output creates parents, replaces owned output and cleans staging after failure", async () => {
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
    // Verify the computed recursive-delete target is this test's direct temporary child.
    assert.equal(resolve(dirname(directory)), resolve(tmpdir()));
    assert.match(basename(directory), /^wtctl-cli-/);
    await rm(directory, { recursive: true, force: true });
  }
});
