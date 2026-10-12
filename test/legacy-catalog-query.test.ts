import test from "node:test";
import assert from "node:assert/strict";
import { LegacyXHttpApi, type LegacyCatalogKey } from "../src/protocol/api.js";
import { HttpTransport } from "../src/protocol/transport.js";
import { WsHcmApiError } from "../src/protocol/error.js";
import { getNativeOperations, NativeGateway } from "../src/native/index.js";

test("legacy key query preserves typed scalar body lines, exact headers and response XML bytes", async () => {
  const calls: { url: URL; body: string; headers: Headers }[] = [];
  const xml =
    "<presence_state><id>9223372036854775807</id><code>цвет &amp; '😀</code></presence_state>";
  const transport = new HttpTransport({
    baseUrl: "http://synthetic.invalid/mounted/",
    timeoutMs: 1000,
    maxResponseBytes: 4096,
    fetch: async (input, init) => {
      calls.push({
        url: new URL(String(input)),
        body: new TextDecoder().decode(init?.body as Uint8Array),
        headers: new Headers(init?.headers),
      });
      return new Response("Result: ok\r\n\r\n" + xml);
    },
  });
  transport.cookie.capture(new Headers({ "set-cookie": "SessionID=owned-query-http; Path=/" }));
  try {
    const api = new LegacyXHttpApi(transport, () => "42");
    const result = await api.queryCatalogByKeys({
      catalog: "presence_states",
      keyName: "code",
      keys: [
        { type: "string", value: "цвет & '😀\"\\path" },
        { type: "integer", value: "9223372036854775807" },
        { type: "integer", value: "0x7fffffffffffffff" },
        { type: "real", value: "37.125" },
        { type: "string", value: "' or true() or '" },
        { type: "string", value: "" },
      ],
    });
    assert.equal(calls[0]!.url.pathname, "/mounted/xhttp");
    assert.match(calls[0]!.url.searchParams.get("trans_id")!, /^\d+$/);
    assert.equal(calls[0]!.headers.get("cookie"), "SessionID=owned-query-http");
    assert.equal(
      calls[0]!.body,
      "Action: QueryCatalogByKeys\r\nCatalog: presence_states\r\nKeyName: code\r\nSessionID: 42\r\n\r\n'цвет & ''😀\"\\path'\r\n9223372036854775807\r\n0x7fffffffffffffff\r\n37.125\r\n''' or true() or '''\r\n''",
    );
    assert.equal(new TextDecoder().decode(result.data.body), xml);
    assert.equal(result.data.result, "ok");
    await api.queryCatalogByKeys({ catalog: "presence_states", keyName: "id", keys: [] });
    assert.ok(calls[1]!.body.endsWith("\r\n\r\n"));
    await api.queryCatalogByKeys({ catalog: "presence_states", keyName: "group/code", keys: [] });
    assert.match(calls[2]!.body, /KeyName: group\/code\r\n/);
  } finally {
    transport.dispose();
  }
});

test("legacy key query rejects header injection, multiline or executable values, loss and invalid types before its request", async () => {
  let calls = 0;
  const transport = new HttpTransport({
    baseUrl: "http://synthetic.invalid/",
    timeoutMs: 1000,
    fetch: async () => {
      calls++;
      throw new Error("Unexpected request");
    },
  });
  const api = new LegacyXHttpApi(transport, () => "42");
  const invalidKeys: unknown[] = [
    { type: "string", value: "a\rb" },
    { type: "string", value: "a\nb" },
    { type: "string", value: "a\0b" },
    { type: "string", value: "\ud800" },
    { type: "integer", value: "9223372036854775808" },
    { type: "integer", value: "0xffffffffffffffff" },
    { type: "integer", value: 9007199254740992 },
    { type: "integer", value: "-1" },
    { type: "integer", value: "1 or true()" },
    { type: "real", value: "1e3" },
    { type: "real", value: "-1.5" },
    { type: "real", value: "NaN" },
    { type: "real", value: "9".repeat(400) + ".0" },
    { type: "boolean", value: "true" },
    null,
    { type: "string", value: "a", code: "ignored" },
  ];
  try {
    for (const key of invalidKeys)
      await assert.rejects(
        api.queryCatalogByKeys({
          catalog: "presence_states",
          keyName: "code",
          keys: [key as LegacyCatalogKey],
        }),
        TypeError,
      );
    await assert.rejects(
      api.queryCatalogByKeys({
        catalog: "presence_states\r\nSessionID: foreign",
        keyName: "id",
        keys: [],
      }),
      TypeError,
    );
    await assert.rejects(
      api.queryCatalogByKeys({ catalog: "presence_states", keyName: "", keys: [] }),
      TypeError,
    );
    await assert.rejects(
      api.queryCatalogByKeys({
        catalog: "presence_states",
        keyName: "id",
        keys: new Array<LegacyCatalogKey>(1),
      }),
      TypeError,
    );
    for (const catalog of [
      "presence_states return $elem_qc",
      "presence_states[1]",
      "db.presence_states",
      "presence_states\t",
    ])
      await assert.rejects(api.queryCatalogByKeys({ catalog, keyName: "id", keys: [] }), TypeError);
    for (const keyName of [
      "id) or true() or MatchSome($elem_qc/code",
      "id[1]",
      "name//value",
      "/name",
      "name.value",
    ])
      await assert.rejects(
        api.queryCatalogByKeys({ catalog: "presence_states", keyName, keys: [] }),
        TypeError,
      );
    assert.equal(calls, 0);
    const descriptor = getNativeOperations().find(
      (o) => o.id === "legacy.xhttp.queryCatalogByKeys",
    )!;
    assert.equal(descriptor.effect, "read");
    const gateway = new NativeGateway({
      baseUrl: "http://synthetic.invalid/",
      timeoutMs: 1000,
      maxResponseBytes: 4096,
      fetch: async () => {
        calls++;
        throw new Error("Unexpected request");
      },
    });
    try {
      await assert.rejects(
        gateway.call(descriptor.id, {
          catalog: "presence_states",
          keyName: "id",
          keys: [{ type: "integer", value: 42 }],
        }),
        TypeError,
      );
      await assert.rejects(
        gateway.call(descriptor.id, {
          catalog: "presence_states return $elem_qc",
          keyName: "id",
          keys: [],
        }),
        TypeError,
      );
      await assert.rejects(
        gateway.call(descriptor.id, {
          catalog: "presence_states",
          keyName: "id) or true()",
          keys: [],
        }),
        TypeError,
      );
      await assert.rejects(
        gateway.call(descriptor.id, {
          catalog: "presence_states",
          keyName: "id",
          keys: [{ type: "boolean", value: "true" }],
        }),
        TypeError,
      );
      assert.equal(calls, 0);
    } finally {
      await gateway.close();
    }
  } finally {
    transport.dispose();
  }
});

test("legacy key query keeps HTTP, framed fault and malformed framing distinct", async () => {
  for (const fixture of [
    { status: 500, body: "stock masked fault", kind: "http" },
    { status: 200, body: "Result: denied\r\n\r\n", kind: "xhttp-result" },
    { status: 200, body: "<rows/>", kind: "protocol" },
  ]) {
    const transport = new HttpTransport({
      baseUrl: "http://synthetic.invalid/",
      timeoutMs: 1000,
      fetch: async () => new Response(fixture.body, { status: fixture.status }),
    });
    try {
      await assert.rejects(
        new LegacyXHttpApi(transport, () => "42").queryCatalogByKeys({
          catalog: "presence_states",
          keyName: "code",
          keys: [{ type: "string", value: "owned" }],
        }),
        (error: unknown) =>
          error instanceof WsHcmApiError &&
          (fixture.kind === "protocol" || error.operation === "QueryCatalogByKeys") &&
          error.kind === fixture.kind,
      );
    } finally {
      transport.dispose();
    }
  }
});
