import assert from "node:assert/strict";
import { test } from "node:test";
import { NativeGateway, getNativeOperations } from "../src/native/index.js";
import { findXmlNode } from "../src/protocol/xml.js";

const config = {
  baseUrl: "http://fixture.invalid/hcm/",
  username: "fixture",
  password: "fixture",
  timeoutMs: 1000,
  maxResponseBytes: 1024 * 1024,
};
const id = "web.spxml.getBackgroundTasksByName";
const ownTrackingId = "0x7FFFFFFFFFFFFFFE";

test(`${id} отправляет свой точный профиль SOAP и сохраняет повторяющиеся payload выполняющейся и завершённой задачи`, async () => {
  const calls: string[] = [];
  let consumed = false;
  const gateway = new NativeGateway({
    ...config,
    fetch: async (input, init = {}) => {
      const url = new URL(String(input));
      const body = typeof init.body === "string" ? init.body : "";
      const method = /<soap:Body><([A-Za-z0-9]+)/.exec(body)?.[1];
      if (!method)
        return new Response("fixture page", {
          headers: { "set-cookie": "SessionID=fixture-auth" },
        });
      calls.push(method);
      let content = "";
      if (method === "OpenSession") content = "<SessionID>42</SessionID>";
      if (method === "GetBackgroundTasksByName") {
        assert.equal(url.pathname, "/hcm/api/spxml/GetBackgroundTasksByName");
        assert.equal(init.method, "POST");
        assert.equal(new Headers(init.headers).get("cookie"), "SessionID=fixture-auth");
        assert.ok(!body.includes("ArgData") && !body.includes("TrackingID"));
        assert.ok(body.includes("<LibName>fixture&amp;library</LibName>"));
        assert.ok(body.includes("<MethodName>method&lt;name</MethodName>"));
        assert.ok(body.includes('xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"'));
        assert.ok(body.includes('xmlns="http://www.datex-soft.com/soap/"'));
        if (!consumed) {
          const running = calls.filter((call) => call === method).length === 1;
          content = `<Task><TrackingID>${ownTrackingId}</TrackingID><StartDate>2026-09-30T01:00:00</StartDate><IsRunning>${running ? 1 : 0}</IsRunning>${running ? "<Progress/>" : '<ResultData><Result VALUE-TYPE="string">fixture-result</Result></ResultData>'}</Task>`;
        }
      }
      if (method === "GetAsyncMethodStatus") {
        assert.ok(!consumed);
        consumed = true;
        content =
          '<IsRunning>0</IsRunning><ResultData><Result VALUE-TYPE="string">fixture-result</Result></ResultData>';
      }
      return new Response(
        `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope/"><soap:Body><${method}Response>${content}</${method}Response></soap:Body></soap:Envelope>`,
        {
          headers: {
            "content-type": "application/soap+xml",
            "set-cookie": "SessionID=fixture-auth",
          },
        },
      );
    },
  });
  const operation = getNativeOperations().find((operation) => operation.id === id)!;
  assert.equal(operation.effect, "read");
  assert.match(operation.description, /чужие задачи/);
  assert.match(operation.description, /Устаревшие записи/);
  try {
    for (const expectedRunning of ["1", "0", "0"]) {
      const result = await gateway.call(id, {
        libName: "fixture&library",
        methodName: "method<name",
      });
      assert.equal(findXmlNode(result, "TrackingID"), ownTrackingId);
      assert.equal(findXmlNode(result, "IsRunning"), expectedRunning);
      if (expectedRunning === "0") assert.equal(findXmlNode(result, "#text"), "fixture-result");
    }
    assert.equal(consumed, false);
    const statusId = id.replace("getBackgroundTasksByName", "getAsyncMethodStatus");
    const terminal = await gateway.call(statusId, { trackingId: ownTrackingId });
    assert.equal(findXmlNode(terminal, "IsRunning"), "0");
    assert.equal(consumed, true);
    assert.equal(
      findXmlNode(
        await gateway.call(id, { libName: "fixture&library", methodName: "method<name" }),
        "Task",
      ),
      undefined,
    );
  } finally {
    await gateway.close();
  }
  assert.equal(calls.filter((call) => call === "OpenSession").length, 1);
  assert.equal(calls.filter((call) => call === "CloseSession").length, 1);
  assert.equal(calls.filter((call) => call === "GetAsyncMethodStatus").length, 1);
});

test("обзор фоновых задач отклоняет отсутствующие и нестроковые имена до аутентификации", async () => {
  let calls = 0;
  const gateway = new NativeGateway({
    ...config,
    fetch: async () => {
      calls++;
      throw new Error("unexpected wire call");
    },
  });
  for (const args of [
    { libName: "fixture" },
    { libName: "fixture", methodName: 42 },
    { libName: "fixture", methodName: "method", trackingId: "42" },
  ])
    await assert.rejects(
      gateway.call(id, args),
      /обязательное значение не задано|нужна строка|такого аргумента у операции нет/,
    );
  assert.equal(calls, 0);
  await gateway.close();
});
