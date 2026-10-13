import assert from "node:assert/strict";
import { test } from "node:test";
import { HcmRuntime } from "../src/runtime.js";
import { decodeRpcValue, scriptRequest, scriptResult } from "../src/scripts.js";
import { findXmlNode, parseXml } from "../src/protocol/xml.js";

const fields =
  '<error VALUE-TYPE="integer">0</error><error_text VALUE-TYPE="string"/><ticks VALUE-TYPE="integer">7</ticks><result VALUE-TYPE="Array"><e VALUE-TYPE="Object"><id VALUE-TYPE="integer">9223372036854775807</id><text VALUE-TYPE="string">Текст &amp; &lt;tag&gt; 😀</text><flags VALUE-TYPE="Array"><e VALUE-TYPE="bool">1</e><e VALUE-TYPE="null"/></flags></e></result><columns VALUE-TYPE="Array"/><data VALUE-TYPE="Object"/><total VALUE-TYPE="integer">1</total>';
const resultXml = (body: string): string =>
  `<ResultData><Result VALUE-TYPE="Object">${body}</Result></ResultData>`;
const syntheticExecutionId = "hcm_inline_00000000000000000000000000000000";

function fixture(responseFields = fields) {
  const calls: { url: URL; body: string }[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const body = String(init?.body ?? "");
    const url = new URL(String(input));
    calls.push({ url, body });
    const method = /<soap:Body><([A-Za-z]+)/.exec(body)?.[1];
    if (!method)
      return new Response("<html>fixture</html>", {
        headers: { "set-cookie": "SessionID=fixture-http" },
      });
    const content =
      method === "OpenSession"
        ? "<SessionID>42</SessionID>"
        : method === "CallMethod"
          ? resultXml(responseFields)
          : "";
    return new Response(
      `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope/"><soap:Body><${method}Response>${content}</${method}Response></soap:Body></soap:Envelope>`,
      { headers: { "content-type": "application/soap+xml" } },
    );
  };
  const runtime = new HcmRuntime({
    name: "fixture",
    baseUrl: "http://fixture.invalid/",
    username: "fixture",
    password: "synthetic-secret",
    timeoutMs: 1000,
    maxResponseBytes: 1024 * 1024,
    outputLimitBytes: 24000,
    runtimeDir: ".runtime",
    permissions: { write: false, execute: true },
    fetch,
  });
  return { calls, runtime };
}

test("temporary collection requests escape code, disable cache and never allocate or persist an object", async () => {
  const fixtureValue = fixture();
  const code = 'RESULT=[{text:"<& 😀"}];';
  try {
    const result = await fixtureValue.runtime.call("execute.script", { code });
    assert.equal(result.ok, true, JSON.stringify(result));
    const { executionId, ...data } = result.data as { executionId: string };
    assert.match(executionId, /^hcm_inline_[a-f0-9]{32}$/);
    assert.deepEqual(data, {
      result: [{ id: "9223372036854775807", text: "Текст & <tag> 😀", flags: ["1", null] }],
    });
    const call = fixtureValue.calls.find((item) => item.url.pathname === "/api/spxml/CallMethod")!;
    assert.ok(
      call.body.includes(
        "<LibName>ms_tools</LibName><MethodName>evaluate_remote_collection_obj</MethodName>",
      ),
    );
    assert.ok(
      call.body.includes(
        '<arg-0><remote_collection SPXML-FORM="x-local://wtv/wtv_remote_collection.xmd" SPXML-FORM-ELEM="remote_collection">',
      ),
    );
    const document = parseXml(call.body);
    assert.equal(findXmlNode(document, "code"), executionId);
    assert.equal(findXmlNode(document, "script"), code);
    assert.ok(call.body.includes("<use_cache>0</use_cache>"));
    assert.equal(
      fixtureValue.calls.filter((item) => /<PutDoc |<GetNewObjectID |<Eval /.test(item.body))
        .length,
      0,
    );
  } finally {
    await fixtureValue.runtime.close();
  }
  assert.ok(fixtureValue.calls.some((item) => item.url.pathname === "/spxml_web/main.htm"));
  assert.ok(fixtureValue.calls.some((item) => item.body.includes("<CloseSession ")));
  assert.ok(fixtureValue.calls.some((item) => item.url.pathname.endsWith("/logout.htm")));
  assert.ok(fixtureValue.calls.some((item) => item.url.pathname.endsWith("/logout2.htm")));
  assert.notDeepEqual(
    scriptRequest(code),
    scriptRequest(code),
    "a fresh marker must prevent accidental identity or cache reuse",
  );
});

test("params reach the code as PARAMS on its first line; anything but an object is refused unsent", () => {
  const params = { name: 'Иван "и" \\ 😀', ids: ["0x1"], n: 1.5, none: null };
  const code = "// первая строка\nRESULT = [PARAMS.name];";
  const xml = (scriptRequest(code, params).args as { lexicalValue: { xml: string } }[])[0]!
    .lexicalValue.xml;
  const sent = findXmlNode(parseXml(xml), "script") as string;
  const [, encoded, rest] = /^var PARAMS = ParseJson\(.*?"([A-Za-z0-9+/=]+)".*?\); (.*)$/s.exec(
    sent,
  )!;
  assert.deepEqual(JSON.parse(Buffer.from(encoded!, "base64").toString()), params);
  assert.equal(rest, code);
  for (const wrong of [[1], "x", null])
    assert.throws(
      () => scriptRequest(code, wrong),
      (error: unknown) => (error as { code?: string }).code === "INVALID_ARGUMENT",
    );
});

test("agents.run sends decimal IDs only and answers with the times of the run", async () => {
  const fixtureValue = fixture(
    fields.replace(
      /<result .*<\/result>/,
      '<result VALUE-TYPE="Array"><e VALUE-TYPE="Object"><started VALUE-TYPE="bool">1</started><from VALUE-TYPE="string">2026-10-09T20:31:17+00:00</from><to VALUE-TYPE="string">2026-10-09T20:31:19+00:00</to></e></result>',
    ),
  );
  try {
    const result = await fixtureValue.runtime.call("agents.run", {
      id: "0x10",
      objectIds: ["0x11", "18"],
    });
    const { hint, ...data } = result.data as { hint: string };
    assert.deepEqual(data, {
      started: true,
      startedAt: "2026-10-09T20:31:17",
      finishedAt: "2026-10-09T20:31:19",
    });
    assert.match(hint, /xhttp/);
    const call = fixtureValue.calls.find((item) => item.url.pathname === "/api/spxml/CallMethod")!;
    const encoded = /Base64Decode\(&quot;([A-Za-z0-9+/=]+)&quot;\)/.exec(call.body)![1]!;
    assert.deepEqual(JSON.parse(Buffer.from(encoded, "base64").toString()), {
      id: "16",
      objectId: null,
      objectIds: "17;18",
    });
    const before = fixtureValue.calls.length;
    for (const args of [{ id: '1"; evil()' }, { id: "1", objectIds: ["x"] }, { id: 1 }]) {
      const refused = await fixtureValue.runtime.call("agents.run", args);
      assert.equal(refused.error?.code, "INVALID_ARGUMENT");
      assert.equal(refused.error?.mutationOutcome, "not_sent");
    }
    assert.equal(fixtureValue.calls.length, before);
  } finally {
    await fixtureValue.runtime.close();
  }
});

test("caught server script errors are failures with indeterminate mutation outcome and the script's own message", async () => {
  const fixtureValue = fixture(
    fields
      .replace('<error VALUE-TYPE="integer">0</error>', '<error VALUE-TYPE="integer">1</error>')
      .replace(
        '<error_text VALUE-TYPE="string"/>',
        `<error_text VALUE-TYPE="string">Error evaluating collection 'hcm_inline_0'
no_such_var not defined
(eval,  Unknown source,   line 3)
(eval(),  x-local://wtv/wtv_remote_collection.xmd,   line 428)
(eval,  x-local://wtv/wtv_remote_collection.xmd,   line 428)</error_text>`,
      ),
  );
  try {
    const result = await fixtureValue.runtime.call("execute.script", { code: 'throw "example";' });
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "SCRIPT_FAILED");
    assert.equal(result.error?.mutationOutcome, "indeterminate");
    assert.equal(
      result.error?.details?.executionId,
      findXmlNode(
        parseXml(
          fixtureValue.calls.find((item) => item.url.pathname === "/api/spxml/CallMethod")!.body,
        ),
        "code",
      ),
    );
    assert.equal(
      result.error?.details?.scriptError,
      "no_such_var not defined\n(eval,  Unknown source,   line 3)",
    );
    assert.doesNotMatch(JSON.stringify(result), /wtv_remote_collection|Error evaluating/);
    assert.equal(
      fixtureValue.calls.filter((item) => item.url.pathname === "/api/spxml/CallMethod").length,
      1,
    );
  } finally {
    await fixtureValue.runtime.close();
  }
});

test("a syntax error of the whole code is not_sent, one raised by eval() in running code is not", async () => {
  const syntax = "JavaScript syntax error.\nUnknown source,   line 1";
  for (const [text, expected] of [
    [syntax, "not_sent"],
    [`${syntax}\n(eval(),  Unknown source,   line 1)`, "indeterminate"],
  ] as const) {
    const fixtureValue = fixture(
      fields
        .replace('<error VALUE-TYPE="integer">0</error>', '<error VALUE-TYPE="integer">1</error>')
        .replace(
          '<error_text VALUE-TYPE="string"/>',
          `<error_text VALUE-TYPE="string">${text}</error_text>`,
        ),
    );
    try {
      const result = await fixtureValue.runtime.call("execute.script", { code: "x = ;" });
      assert.equal(result.error?.mutationOutcome, expected);
    } finally {
      await fixtureValue.runtime.close();
    }
  }
});

test("script policy and XML/byte limits reject locally while typed result validation detects semantic failures", async () => {
  for (const code of ["\0", "😀".repeat(300000)]) {
    const fixtureValue = fixture();
    try {
      const result = await fixtureValue.runtime.call("execute.script", { code });
      assert.equal(result.ok, false);
      assert.equal(result.error?.mutationOutcome, "not_sent");
      assert.equal(fixtureValue.calls.length, 0);
    } finally {
      await fixtureValue.runtime.close();
    }
  }
  const runtime = new HcmRuntime({
    name: "readonly",
    baseUrl: "http://fixture.invalid/",
    timeoutMs: 1000,
    maxResponseBytes: 1024,
    outputLimitBytes: 1024,
    runtimeDir: ".runtime",
    permissions: { write: true, execute: false },
  });
  try {
    assert.equal(
      (await runtime.call("execute.script", { code: "RESULT=[];" })).error?.code,
      "EXECUTE_DISABLED",
    );
  } finally {
    await runtime.close();
  }
  assert.throws(() =>
    scriptResult(
      parseXml(
        resultXml(fields.replace('<result VALUE-TYPE="Array">', '<result VALUE-TYPE="Object">')),
      ),
      syntheticExecutionId,
    ),
  );
  assert.throws(
    () =>
      scriptResult(
        parseXml(
          resultXml(
            fields.replace(
              '<total VALUE-TYPE="integer">1</total>',
              '<total VALUE-TYPE="integer">-1</total>',
            ),
          ),
        ),
        syntheticExecutionId,
      ),
    /счётчиками/,
  );
  assert.throws(
    () => decodeRpcValue({ "@_VALUE-TYPE": "Array", unexpected: { "@_VALUE-TYPE": "string" } }),
    /посторонние элементы/,
  );
  for (const malformed of [
    { "@_VALUE-TYPE": "Array", "#text": "lost" },
    { "@_VALUE-TYPE": "null", child: { "@_VALUE-TYPE": "string" } },
    { "@_VALUE-TYPE": "undefined", "#text": "lost" },
    { "@_VALUE-TYPE": "XmDoc" },
    { "@_VALUE-TYPE": "future-scalar", "#text": "lost" },
    { child: "xml" },
  ])
    assert.throws(
      () => decodeRpcValue(malformed),
      (error: unknown) => (error as { code?: string }).code === "SCRIPT_RESPONSE",
    );
  assert.deepEqual(decodeRpcValue({ "@_VALUE-TYPE": "Array", "#text": " \n" }), []);
  assert.equal(decodeRpcValue({ "@_VALUE-TYPE": "null" }), null);
  assert.throws(
    () =>
      scriptResult(
        parseXml(
          resultXml(
            fields.replace('<error VALUE-TYPE="integer">0</error>', '<error VALUE-TYPE="string"/>'),
          ),
        ),
        syntheticExecutionId,
      ),
    /кода ошибки/,
  );
  let nested: unknown = { "@_VALUE-TYPE": "string", "#text": "end" };
  for (let depth = 0; depth < 66; depth++) nested = { "@_VALUE-TYPE": "Array", e: nested };
  assert.throws(() => decodeRpcValue(nested), /вложен глубже/);
});
