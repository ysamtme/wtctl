import assert from "node:assert/strict";
import { test } from "node:test";
import type { ConnectionConfig, OperationResult } from "../src/contracts.js";
import { HcmError } from "../src/errors.js";
import { WebSocketHeartbeatError } from "../src/protocol/websocket.js";
import { ReplyPacker, type BatchRecovery } from "../src/reply.js";
import { WriteOutcome } from "../src/write-outcome.js";
import { scratchRuntimeDir } from "./fake-server.js";

function setup(outputLimitBytes: number, name = "t", list?: string) {
  const stored = { calls: 0 };
  const config: ConnectionConfig = {
    name,
    baseUrl: "http://fixture.invalid/",
    timeoutMs: 1000,
    maxResponseBytes: 1024 * 1024,
    outputLimitBytes,
    runtimeDir: scratchRuntimeDir,
    permissions: { write: true, execute: true },
  };
  const packer = new ReplyPacker(config, {
    put: async () => (
      stored.calls++,
      { resultId: "stored-id", bytes: 1, ...(list ? { list } : {}) }
    ),
  });
  return { packer, stored };
}
const fail = (packer: ReplyPacker, error: unknown, outcome = new WriteOutcome()) =>
  packer.failure("x.y", 0, error, outcome.verdict("read", error));
const batchFail = (packer: ReplyPacker, batchRecovery: BatchRecovery) =>
  packer.failure("runtime.batch", 0, new Error("x"), new WriteOutcome().verdict("write"), {
    batchRecovery,
  });
const failed = (result: OperationResult) => result.error!;
const detailsOf = (result: OperationResult) => failed(result).details as Record<string, any>;

test("ответы results.read и runtime.check сверх предела возвращаются целиком и не сохраняются", async () => {
  const { packer, stored } = setup(1000);
  const filler = "x".repeat(3000);
  const read = await packer.success("results.read", 0, { text: filler }, true);
  const check = await packer.success(
    "runtime.check",
    0,
    { summary: { failed: 0 }, checks: [], filler },
    true,
  );
  for (const reply of [read, check]) {
    assert.equal(reply.meta.truncated, undefined);
    assert.ok(JSON.stringify(reply.data).includes(filler));
  }
  assert.equal(stored.calls, 0);
  const other = await packer.success("query.run", 0, { text: filler }, true);
  assert.equal(other.meta.truncated, true);
  assert.equal(stored.calls, 1);
});

test("данные, записанные по pageBytes, помещаются в ответ и не сохраняются", async () => {
  const { packer, stored } = setup(2000);
  const reply = await packer.success("query.run", 0, { text: "x".repeat(packer.pageBytes) }, true);
  assert.equal(reply.meta.truncated, undefined);
  assert.equal(stored.calls, 0);
});

test("bigint становится строкой, а bytes — base64 с длиной", async () => {
  const { packer } = setup(65536);
  const reply = await packer.success(
    "x.y",
    0,
    { n: 10n, b: new Uint8Array([1, 2, 3]), list: [5n] },
    false,
  );
  assert.deepEqual(reply.data, { n: "10", b: { base64: "AQID", bytes: 3 }, list: ["5"] });
});

test("пути сервера заменяются в строках message, hint и detail", () => {
  const { packer } = setup(65536);
  const error = new HcmError(
    "X",
    String.raw`Нет файла C:\srv\app\a.log рядом`,
    "см. D:/data/b.txt",
    {
      line: String.raw`в C:\srv\c.log`,
    },
  );
  const reply = fail(packer, error);
  for (const text of [failed(reply).message, failed(reply).hint!, detailsOf(reply).line]) {
    assert.match(text, /\[server-path\]/);
    assert.doesNotMatch(text, /srv|data|[A-D]:[\\/]/);
  }
});

test("значения сессии и авторизации вычищаются из текста ошибки", () => {
  const { packer } = setup(65536);
  const error = new HcmError(
    "X",
    "SessionID=abc123 и Authorization: tok456",
    "Cookie: sid789; дальше",
  );
  const reply = fail(packer, error);
  assert.match(failed(reply).message, /\[redacted\]/);
  assert.match(failed(reply).hint!, /\[redacted\]/);
  const text = JSON.stringify(reply);
  for (const secret of ["abc123", "tok456", "sid789"]) assert.ok(!text.includes(secret));
});

test("message обрезается на 500 символах, hint — на 1000, и обрезка видна по многоточию", () => {
  const { packer } = setup(65536);
  const reply = fail(packer, new HcmError("X", "m".repeat(2000), "h".repeat(2000)));
  assert.equal(failed(reply).message, `${"m".repeat(499)}…`);
  assert.equal(failed(reply).hint, `${"h".repeat(999)}…`);
  const fits = fail(packer, new HcmError("X", "m", "h".repeat(1000)));
  assert.equal(failed(fits).hint, "h".repeat(1000));
});

test("превью сохранённого ответа показывает столько элементов списка, сколько помещается", async () => {
  const { packer } = setup(4096, "t", "types");
  const types = Array.from({ length: 300 }, (_, index) => ({ type: `type_${index}` }));
  const reply = await packer.success("schema.types", 0, { types, total: 300 }, true);
  const { preview, hint } = reply.data as {
    preview: { types: unknown[]; total: number };
    hint: string;
  };
  assert.deepEqual(preview.types, types.slice(0, preview.types.length));
  assert.ok(preview.types.length > 50, String(preview.types.length));
  assert.equal(preview.total, 300);
  assert.ok(hint.includes(`(в preview первые ${preview.types.length} из 300)`), hint);
  assert.ok(Buffer.byteLength(JSON.stringify(reply)) <= 4096);
});

test("превью пакета, шаги которого поместились не все, — строка о каждом шаге", async () => {
  const { packer } = setup(4096, "t", "results");
  const results = Array.from({ length: 40 }, () => ({ ok: true, data: { text: "x".repeat(200) } }));
  const reply = await packer.success("runtime.batch", 0, { results }, true);
  const { preview, hint } = reply.data as { preview: { results: unknown[] }; hint: string };
  assert.deepEqual(preview.results, Array(40).fill({ ok: true }));
  assert.doesNotMatch(hint, /первые/);
});

test("превью отказавшего пакета берёт строки о шагах, пока весь ответ с ошибкой в пределе", async () => {
  const limit = 2600;
  const { packer } = setup(limit, "t", "results");
  const results = Array.from({ length: 40 }, (_, index) => ({
    ok: false,
    error: { code: `STEP_FAILED_${index}` },
    meta: { operationId: "runtime.query" },
    data: { text: "x".repeat(200) },
  }));
  const reply = await packer.success(
    "runtime.batch",
    0,
    { results, completed: 40, requested: 40, atomic: false, ok: false },
    true,
  );
  const { preview, hint } = reply.data as { preview: { results: unknown[] }; hint: string };
  assert.equal(reply.error?.code, "BATCH_FAILED");
  assert.ok(Buffer.byteLength(JSON.stringify(reply)) <= limit);
  // Доля превью (половина предела) ещё не занята: остановил размер всего ответа.
  assert.ok(Buffer.byteLength(JSON.stringify(preview)) < limit / 2 - 40);
  assert.ok(preview.results.length > 0 && preview.results.length < 40);
  assert.match(hint, new RegExp(`первые ${preview.results.length} из 40\\)`));
});

test("details больше четверти предела сжимаются до omitted с точными ID", () => {
  const { packer } = setup(2000);
  const ids = {
    mutationId: "0c1f6b9e-3a4d-4e5f-8a1b-2c3d4e5f6a7b",
    objectId: "0x1F",
    executionId: `hcm_inline_${"a1".repeat(16)}`,
  };
  const outcome = new WriteOutcome();
  outcome.note(ids);
  const big = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`k${i}`, "v".repeat(200)]));
  const reply = fail(packer, new HcmError("X", "m", "h", big), outcome);
  assert.deepEqual(failed(reply).details, { omitted: true, ...ids });
});

test("details вкладываются не глубже трёх уровней", () => {
  const { packer } = setup(65536);
  const reply = fail(packer, new HcmError("X", "m", "h", { a: { b: { c: { d: { e: 1 } } } } }));
  assert.equal(detailsOf(reply).a.b.c.d, "[details omitted]");
  assert.deepEqual(detailsOf(reply).a.b.c, { d: "[details omitted]" });
});

test("списки в details сохраняют 12 элементов, а объекты — 12 ключей", () => {
  const { packer } = setup(65536);
  const wide = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, i]));
  const reply = fail(
    packer,
    new HcmError("X", "m", "h", { list: Array.from({ length: 30 }, (_, i) => i), wide }),
  );
  assert.equal(detailsOf(reply).list.length, 12);
  assert.equal(Object.keys(detailsOf(reply).wide).length, 12);
});

test("упавший пакет называет 20 шагов и считает остальные", async () => {
  const { packer } = setup(65536);
  const step = (index: number) => ({
    ok: false,
    error: { code: `E${index}`, message: "m" },
    meta: { operationId: "object.create" },
  });
  const batch = (n: number) => ({
    ok: false,
    completed: n,
    requested: n,
    results: Array.from({ length: n }, (_, i) => step(i)),
  });
  const many = await packer.success("runtime.batch", 0, batch(25), true);
  assert.equal(detailsOf(many).failed.length, 20);
  assert.equal(detailsOf(many).failedTotal, 25);
  const few = await packer.success("runtime.batch", 0, batch(20), true);
  assert.equal(detailsOf(few).failed.length, 20);
  assert.equal(detailsOf(few).failedTotal, undefined);
});

test("сводка пакета в ответе укладывается в треть предела и считает то, что опущено", () => {
  const { packer } = setup(3000);
  const receipts = Array.from({ length: 100 }, (_, index) => ({
    index,
    id: "object.create",
    ok: true,
  }));
  const recovery = { completed: 100, requested: 120, sentMutationSteps: 100, receipts };
  const reply = batchFail(packer, recovery);
  const data = reply.data as Record<string, any>;
  assert.ok(Buffer.byteLength(JSON.stringify(data)) <= 1000);
  assert.ok(data.receipts.length > 0 && data.omittedReceipts > 0);
  assert.equal(data.receipts.length + data.omittedReceipts, 100);
  assert.deepEqual([data.completed, data.requested, data.sentMutationSteps], [100, 120, 100]);
});

test("сводка пакета отбрасывает URL длиннее 256 символов и оставляет URL в 256 символов", () => {
  const { packer } = setup(65536);
  const long = `http://h/${"a".repeat(300)}`;
  const exact = "u".repeat(256);
  const receipts = [
    { index: 0, id: "files.upload", url: long },
    { index: 1, id: "files.upload", url: exact },
  ];
  const reply = batchFail(packer, { completed: 2, requested: 2, sentMutationSteps: 2, receipts });
  const kept = (reply.data as { receipts: Record<string, unknown>[] }).receipts;
  assert.deepEqual(kept[0], { index: 0, id: "files.upload" });
  assert.deepEqual(kept[1], receipts[1]);
});

test("ошибка heartbeat при малом пределе сохраняет короткую сводку и фиксированную подсказку", () => {
  const error = new WebSocketHeartbeatError("WS_UNAVAILABLE", {
    phase: "heartbeat",
    handshakeValidated: true,
  } as never);
  const full = fail(setup(65536).packer, error);
  assert.equal(detailsOf(full).heartbeatReceiptFieldsOmitted, undefined);
  assert.ok(detailsOf(full).heartbeatReceipt.limits);

  const small = fail(setup(800).packer, error);
  const details = detailsOf(small);
  assert.equal(details.heartbeatReceiptFieldsOmitted, true);
  assert.equal(details.heartbeatReceipt.phase, "heartbeat");
  for (const key of ["limits", "counts", "durationMs"]) {
    assert.equal(details.heartbeatReceipt[key], undefined);
  }
  assert.notEqual(failed(small).hint, error.hint);
});

test("слишком большая ошибка сохраняет короткое имя подключения и опускает длинное", () => {
  const error = new HcmError("X", "m".repeat(600));
  const short = fail(setup(300, "t").packer, error);
  assert.equal(short.meta.connection, "t");
  assert.equal(short.meta.connectionOmitted, undefined);

  const long = fail(setup(300, "n".repeat(200)).packer, error);
  assert.equal(long.meta.connection, "[omitted]");
  assert.equal(long.meta.connectionOmitted, true);
});
