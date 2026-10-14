// files.list показывает один уровень папки кодом на сервере; низкоуровневые операции с URL — собственные для runtime.
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { HcmError } from "../src/errors.js";
import { HcmClient, unwrap } from "../src/sdk.js";
import { parseXml } from "../src/protocol/xml.js";
import { fakeRuntime } from "./fake-server.js";

const element = (value: string | Record<string, string>) =>
  typeof value === "string"
    ? `<e VALUE-TYPE="string">${value}</e>`
    : `<e VALUE-TYPE="Object">${Object.entries(value)
        .map(([key, text]) => `<${key} VALUE-TYPE="string">${text}</${key}>`)
        .join("")}</e>`;
const scriptAnswer = (rows: (string | Record<string, string>)[]) =>
  parseXml(
    `<ResultData><Result VALUE-TYPE="Object"><error VALUE-TYPE="integer">0</error><ticks VALUE-TYPE="integer">1</ticks><total VALUE-TYPE="integer">1</total><result VALUE-TYPE="Array">${rows.map(element).join("")}</result><columns VALUE-TYPE="Array"/><data VALUE-TYPE="Object"/></Result></ResultData>`,
  );

function fixture(rows: (string | Record<string, string>)[], execute = true) {
  return fakeRuntime(
    { "*": (_args, id) => (id === "web.rpc.call" ? scriptAnswer(rows) : { Data: "QUJD" }) },
    { runtimeDir: join(tmpdir(), "wtctl-files-list"), permissions: { write: true, execute } },
  );
}

test("папка перечисляется по имени с размерами файлов и пометками папок; код получает адрес как задан", async () => {
  const { runtime, server } = fixture([
    { u: "x-local://share/б файл%20.txt", f: "0", b: "12" },
    { u: "x-local://share/img", f: "1", b: "0" },
    { u: "x-local://share/a.txt", f: "0", b: "3" },
  ]);
  const data = unwrap(await HcmClient.fromRuntime(runtime).listFiles({ url: "x-local://share/" }));
  assert.deepEqual(data, {
    items: [
      { name: "a.txt", bytes: 3 },
      { name: "img", folder: true },
      { name: "б файл%20.txt", bytes: 12 },
    ],
    total: 3,
  });
  const found = await runtime.call("files.list", { url: "x-local://share", search: "Файл" });
  assert.deepEqual(found.data, { items: [{ name: "б файл%20.txt", bytes: 12 }], total: 1 });
  assert.match(JSON.stringify(server.calls[0]!.args), /ReadDirectory\(PARAMS\.url\)/);
  const params = /Base64Decode\(&quot;([A-Za-z0-9+/=]+)&quot;\)/.exec(
    JSON.stringify(server.calls[0]!.args),
  )![1]!;
  assert.deepEqual(JSON.parse(Buffer.from(params, "base64").toString()), {
    url: "x-local://share",
  });
  await runtime.close();
});

test("отсутствие папки — ошибка, которая ничего не отправила; право — execute; неверные адреса и строки отклоняются", async () => {
  const call = (f: ReturnType<typeof fixture>, url = "x-local://share") =>
    f.runtime.call("files.list", { url });
  const none = await call(fixture(["none"]));
  assert.equal(none.error?.code, "FOLDER_NOT_FOUND");
  assert.equal(none.error?.mutationOutcome, "not_sent");

  const plain = fixture([], false);
  assert.equal((await call(plain)).error?.code, "EXECUTE_DISABLED");
  assert.deepEqual(plain.server.calls, []);

  const bad = fixture([]);
  for (const url of ["x-local://share/..", "x-local://a/b%2fc", "x-local://", "x-local://a\b"])
    assert.equal((await call(bad, url)).error?.code, "INVALID_ARGUMENT", url);
  assert.deepEqual(bad.server.calls, []);
  assert.deepEqual((await call(bad)).data, { items: [], total: 0 });

  for (const row of [
    { u: "x-local://other/a", f: "0", b: "1" },
    { u: "x-local://share/a/b", f: "0", b: "1" },
    { u: "x-local://share/a", f: "0", b: "x" },
  ])
    assert.equal((await call(fixture([row]))).error?.code, "SCRIPT_RESPONSE");
});

test("ошибка с not_sent не делает отправленную запись not_sent", async () => {
  const { runtime, server } = fixture([]);
  server.on("*", () => {
    throw new HcmError("X", "m", undefined, undefined, "not_sent");
  });
  const write = await runtime.call("files.write", { url: "x-local://share/a", text: "a" });
  assert.equal(write.error?.mutationOutcome, "indeterminate");
});

test("операции LDS с URL снаружи неизвестны, но внутри files.read работают", async () => {
  const { runtime, server } = fixture([]);
  const args = { url: "x-local://share/a" };
  for (const id of ["native.lds.putUrl", "native.lds.deleteUrl", "native.lds.loadUrl"]) {
    assert.throws(() => runtime.describe(id), { code: "UNKNOWN_OPERATION" }, id);
    assert.equal((await runtime.call(id, args)).error?.code, "UNKNOWN_OPERATION");
    assert.equal((await runtime.call("runtime.batch", { steps: [{ id, args }] })).ok, false, id);
  }
  assert.equal(server.calls.length, 0);
  assert.deepEqual((await runtime.call("files.read", args)).data, { text: "ABC", bytes: 3 });
  assert.equal(server.calls[0]!.id, "native.lds.loadUrl");
});

test("удалённые операции снаружи неизвестны", async () => {
  const { runtime, server } = fixture([]);
  const removed = `native.lds.getModDeletedObjects native.lds.createDoc native.lds.loadLargeField native.lds.putLargeField native.lds.deleteLargeField web.spxml.putLargeField web.spxml.getLargeField web.spxml.putLargeFieldFromUrl web.pages.createDoc web.pages.getIcon web.lifecycle.logout2 web.experimental.getUiTemplate native.experimental.spxml.getLargeField native.experimental.spxml.putLargeField native.experimental.spxml.putLargeFieldFromUrl native.experimental.spxml.callMethodAsync native.experimental.spxml.getBackgroundTasksByName native.experimental.spxml.getAsyncMethodStatus native.experimental.spxml.killAsyncMethod native.experimental.spxml.getDoc native.experimental.spxml.putDoc native.lds.openSession native.lds.closeSession web.lds.openSession web.lds.closeSession native.spxml.call`;
  for (const id of removed.split(" ")) {
    assert.throws(() => runtime.describe(id), { code: "UNKNOWN_OPERATION" }, id);
    assert.equal((await runtime.call(id, {})).error?.code, "UNKNOWN_OPERATION");
    assert.equal(
      (await runtime.call("runtime.batch", { steps: [{ id, args: {} }] })).ok,
      false,
      id,
    );
  }
  assert.equal(server.calls.length, 0);
});
