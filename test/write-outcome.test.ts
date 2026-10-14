import assert from "node:assert/strict";
import { test } from "node:test";
import { HcmError } from "../src/errors.js";
import { HcmServer } from "../src/hcm-server.js";
import { WsHcmApiError } from "../src/protocol/error.js";
import { parseXml } from "../src/protocol/xml.js";
import { prepareScript } from "../src/scripts.js";
import { WriteOutcome } from "../src/write-outcome.js";
import { fakeServer, refuse, refusal } from "./fake-server.js";

const notSent = new HcmError("X", "x", undefined, undefined, "not_sent");
const plain = new Error("x");
const unauthorized = () => new WsHcmApiError("http", "unauthorized", { status: 401 });
const atTheDoor = [new HcmError("RPC_SERVER_ONLY", "x"), new HcmError("UNKNOWN_RPC_TARGET", "x")];

function marked(): { outcome: WriteOutcome; withdraw: () => void } {
  const outcome = new WriteOutcome();
  return { outcome, withdraw: outcome.sending() };
}

test("без ошибки исхода нет, а отметка означает отправку только у операции, которая не чтение", () => {
  assert.deepEqual(new WriteOutcome().verdict("write"), { sent: false, ids: {}, exactIds: {} });
  for (const effect of ["write", "execute", "unknown"] as const) {
    const verdict = marked().outcome.verdict(effect);
    assert.equal(verdict.sent, true);
    assert.equal("mutationOutcome" in verdict, false);
  }
  assert.equal(marked().outcome.verdict("read").sent, false);
});

test("у чтения нет исхода, даже если его несёт собственная ошибка", () => {
  const { outcome } = marked();
  for (const error of [plain, new HcmError("X", "x"), notSent])
    assert.equal("mutationOutcome" in outcome.verdict("read", error), false);
});

test("неудавшаяся операция, которая не чтение, — not_sent без отметки, indeterminate с отметкой и снова not_sent, когда отметка снята", () => {
  for (const effect of ["write", "execute"] as const) {
    assert.equal(new WriteOutcome().verdict(effect, plain).mutationOutcome, "not_sent");
    const { outcome, withdraw } = marked();
    assert.equal(outcome.verdict(effect, plain).mutationOutcome, "indeterminate");
    withdraw();
    assert.equal(outcome.verdict(effect, plain).mutationOutcome, "not_sent");
  }
});

test("отклонение единственного запроса rpc.call — not_sent, хотя запрос был отмечен", () => {
  for (const error of atTheDoor) {
    const verdict = marked().outcome.verdict("write", error);
    assert.equal(verdict.sent, true);
    assert.equal(verdict.mutationOutcome, "not_sent");
  }
  const refused = new WsHcmApiError("soap-fault", "x", { status: 500 });
  assert.equal(marked().outcome.verdict("write", refused).mutationOutcome, "indeterminate");
});

test("отказ на входе, заставший отметку на месте, — indeterminate и говорит об этом", () => {
  const verdict = marked().outcome.verdict("write", unauthorized());
  assert.equal(verdict.mutationOutcome, "indeterminate");
  assert.equal(verdict.refusedAfterSend, true);
});

test("общий путь вызова снимает отметку с запроса, отклонённого на входе", async () => {
  const server = new HcmServer(
    fakeServer({ "native.lds.putDoc": refuse(401), "web.rpc.call": refuse(401) }),
  );
  const first = new WriteOutcome();
  await assert.rejects(server.call("native.lds.putDoc", put, first));
  assert.equal(first.verdict("write", unauthorized()).mutationOutcome, "not_sent");

  // Прежний запрос, который прошёл, сохраняет свою отметку.
  const later = new WriteOutcome();
  later.sending();
  await assert.rejects(server.call("native.lds.putDoc", put, later));
  assert.equal(later.verdict("write", unauthorized()).mutationOutcome, "indeterminate");

  const code = new WriteOutcome();
  await assert.rejects(server.runCode(prepareScript("RESULT = [];"), code));
  assert.equal(code.verdict("execute", unauthorized()).mutationOutcome, "not_sent");
});

test("снятие относится к своей отметке и срабатывает один раз", () => {
  const outcome = new WriteOutcome();
  const [first, second] = [outcome.sending(), outcome.sending()];
  first();
  first();
  assert.equal(outcome.verdict("write").sent, true);
  second();
  assert.equal(outcome.verdict("write").sent, false);
});

test("записанные ID заменяются более поздними значениями и никогда не стираются undefined", () => {
  const outcome = new WriteOutcome();
  outcome.note({ objectId: "1", url: "x-local://a" });
  outcome.note({ objectId: "2", url: undefined } as never);
  const { ids, exactIds } = outcome.verdict("write");
  assert.deepEqual(ids, { objectId: "2", url: "x-local://a" });
  assert.deepEqual(exactIds, { objectId: "2" });
});

test("точными считаются только корректно сформированные ID", () => {
  const hex32 = "0123456789abcdef0123456789abcdef";
  const cases: [string, string, boolean][] = [
    ["mutationId", "123e4567-e89b-42d3-a456-426614174000", true],
    ["mutationId", "123e4567-e89b-12d3-a456-426614174000", false],
    ["objectId", "41", true],
    ["objectId", "0x1000000000000029", true],
    ["objectId", "18446744073709551615", true],
    ["objectId", "18446744073709551616", false],
    ["objectId", "0x10000000000000000", false],
    ["objectId", "-1", false],
    ["executionId", `hcm_inline_${hex32}`, true],
    ["executionId", `hcm_inline_${hex32.slice(1)}`, false],
    ["executionId", "untrusted-inline", false],
  ];
  for (const [key, value, exact] of cases) {
    const outcome = new WriteOutcome();
    outcome.note({ [key]: value });
    assert.equal(Object.hasOwn(outcome.verdict("write").exactIds, key), exact, `${key} ${value}`);
  }
});

const put = { url: "x-local://wt_data/objects/0000/41.xml", data: "<fixture/>" };
const query = { query: "for $e in fixtures return $e" };
const load = { url: put.url };

test("запрос, способный изменить сервер, отклоняется без владельца до того, как дойдёт до сервера", async () => {
  const fake = fakeServer({ "*": { ok: true } });
  const server = new HcmServer(fake);
  await assert.rejects(server.call("native.lds.putDoc", put), /без владельца/);
  await assert.rejects(server.call("native.lds.xQuery", query), /без владельца/);
  assert.equal(fake.calls.length, 0);
  await server.call("native.lds.loadDoc", load);
  assert.equal(fake.calls.length, 1);
});

test("read пропускает запрос класса execute без отметки и всё равно отклоняет запись", async () => {
  const fake = fakeServer({ "*": { ok: true } });
  const server = new HcmServer(fake);
  await server.read("native.lds.xQuery", query);
  await assert.rejects(server.read("native.lds.putDoc", put), /без владельца/);
  assert.deepEqual(
    fake.calls.map((call) => call.id),
    ["native.lds.xQuery"],
  );
});

test("собственный вызов помечается; ошибка порта, доказывающая, что ничего не отправлено, снимает отметку, а отказ сервера — нет", async () => {
  const fake = fakeServer({ "native.lds.putDoc": { completed: true } });
  const server = new HcmServer(fake);
  const outcome = new WriteOutcome();
  await server.call("native.lds.putDoc", put, outcome);
  assert.equal(outcome.verdict("write").sent, true);

  const local = new WriteOutcome();
  fake.on("native.lds.putDoc", () => {
    throw new WsHcmApiError("protocol", "not sent", { requestSent: false });
  });
  await assert.rejects(server.call("native.lds.putDoc", put, local));
  assert.equal(local.verdict("write").sent, false);

  const refused = new WriteOutcome();
  fake.on("native.lds.putDoc", () => {
    throw refusal("native.lds.putDoc");
  });
  await assert.rejects(server.call("native.lds.putDoc", put, refused));
  assert.equal(refused.verdict("write").sent, true);
});

test("код, выполняемый на сервере, записывает свой ID исполнения, остаётся отмеченным после ответа и снимается в простое", async () => {
  const body =
    '<error VALUE-TYPE="integer">0</error><error_text VALUE-TYPE="string"/><ticks VALUE-TYPE="integer">1</ticks><result VALUE-TYPE="Array"/><columns VALUE-TYPE="Array"/><data VALUE-TYPE="Object"/><total VALUE-TYPE="integer">0</total>';
  const answer = parseXml(`<ResultData><Result VALUE-TYPE="Object">${body}</Result></ResultData>`);
  const server = new HcmServer(fakeServer({ "web.rpc.call": answer }));
  const script = prepareScript("RESULT = [];");

  const busy = new WriteOutcome();
  await server.runCode(script, busy, () => false);
  const verdict = busy.verdict("execute");
  assert.equal(verdict.sent, true);
  assert.equal(verdict.ids.executionId, script.executionId);

  const idle = new WriteOutcome();
  await server.runCode(script, idle, (data) => data.result.length === 0);
  assert.equal(idle.verdict("execute").sent, false);

  const bare = new WriteOutcome();
  await server.runCode(script, bare);
  assert.equal(bare.verdict("execute").sent, true);
});
