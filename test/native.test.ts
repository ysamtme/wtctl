import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NativeGateway,
  getNativeOperations,
  getEffectiveNativeEffect,
} from "../src/native/index.js";
import { WsHcmClient } from "../src/protocol/client.js";
import { HttpTransport } from "../src/protocol/transport.js";
import { validate } from "../src/native/validation.js";
import { HcmRuntime } from "../src/runtime.js";
import { rawXml, parseXml, escapeXml, buildXml } from "../src/protocol/xml.js";
import { parseSoapBody } from "../src/protocol/protocol.js";
import { createNativeLdsApi, WebSpXmlApi } from "../src/protocol/api.js";
import { LogReader } from "../src/logs.js";

const base = {
  baseUrl: "http://fixture.invalid/hcm/",
  username: "fixture",
  password: "fixture",
  timeoutMs: 1000,
  maxResponseBytes: 1024 * 1024,
};

function soap(method: string, inner = ""): Response {
  return new Response(
    `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope/"><soap:Body><${method}Response>${inner}</${method}Response></soap:Body></soap:Envelope>`,
    {
      headers: {
        "content-type": "application/soap+xml",
        "set-cookie": "SessionID=synthetic; Path=/",
      },
    },
  );
}
function fixture() {
  const calls: Array<{ url: URL; body: string; headers: Headers; method: string }> = [];
  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const body =
      typeof init.body === "string"
        ? init.body
        : init.body instanceof Uint8Array
          ? new TextDecoder().decode(init.body)
          : "";
    calls.push({ url, body, headers: new Headers(init.headers), method: init.method ?? "GET" });
    assert.ok(url.pathname.startsWith("/hcm/"));
    const method = /<soap:Body><([A-Za-z0-9]+)/.exec(body)?.[1];
    if (method) {
      if (method === "OpenSession") return soap(method, "<SessionID>42</SessionID>");
      if (method === "GetNewObjectID") return soap(method, "<ObjectID>41</ObjectID>");
      if (method === "LoadDoc")
        return soap(method, "<Data><collaborator><id>41</id></collaborator></Data>");
      if (method === "CallMethod")
        return soap(
          method,
          '<ResultData><Result VALUE-TYPE="string">fixture</Result></ResultData>',
        );
      if (method === "CallMethodAsync") return soap(method, "<TrackingID>0x42</TrackingID>");
      return soap(method, "<Result>fixture</Result>");
    }
    if (url.pathname.endsWith("/main.htm"))
      return new Response('<script>gFaApp.webSessionToken="fixture-upload-token";</script>', {
        headers: { "set-cookie": "SessionID=web-fixture; Path=/" },
      });
    if (
      url.pathname.endsWith("/upload_file.htm") &&
      url.searchParams.get("action") === "upload_chunk"
    )
      return Response.json({
        error: 0,
        Url: `fixture-folder/${url.searchParams.get("file_name")}`,
      });
    if (
      url.pathname.endsWith("/upload_file.htm") &&
      url.searchParams.get("action") === "clear_chunks"
    )
      return new Response("\r\n");
    if (url.pathname.endsWith("/upload_file.htm"))
      return Response.json({
        Url: `fixture-folder/${(init.body as FormData).get("f") instanceof File ? ((init.body as FormData).get("f") as File).name : "fixture"}`,
      });
    if (url.pathname.endsWith("/admin"))
      return new Response(null, { status: 301, headers: { location: "/hcm/spxml_web/main.htm" } });
    if (
      url.pathname.endsWith("/GetDoc") ||
      url.pathname.endsWith("/create_doc.htm") ||
      url.pathname.endsWith("/get_ui_text.htm")
    )
      return new Response("<collaborator><id>41</id></collaborator>");
    if (
      /(?:PutDoc|PutLargeField|PutLargeFieldFromUrl|get_app_info|std_encrypt|authenticate)$/.test(
        url.pathname,
      )
    )
      return Response.json({ ok: true });
    return new Response("fixture");
  };
  return { fetch, calls };
}
function sample(schema: Record<string, unknown>, key = ""): unknown {
  if ("const" in schema) return schema.const;
  if (Array.isArray(schema.anyOf)) return sample(schema.anyOf[0] as Record<string, unknown>, key);
  if (schema.type === "object")
    return Object.fromEntries(
      Object.entries((schema.properties ?? {}) as Record<string, Record<string, unknown>>)
        .filter(([name]) => ((schema.required ?? []) as string[]).includes(name))
        .map(([name, child]) => [name, sample(child, name)]),
    );
  if (schema.type === "array") return [];
  if (schema.type === "number" || schema.type === "integer") return 1;
  if (schema.type === "boolean") return false;
  if (schema.type === "null") return null;
  if (schema["x-normalization"] === "xml") return "<fixture/>";
  if (key === "target") return "custom.unlisted";
  if (key === "document") return "<fixture/>";
  if (key === "documentXmlTemplate") return "<collaborator><id>{{objectId}}</id></collaborator>";
  if (key === "path") return "/raw-fixture";
  if (schema.pattern === "^x-db-obj://")
    return "x-db-obj://fixture/registered_type/0x0000000000000042.xml";
  if (typeof schema.pattern === "string" && schema.pattern.endsWith("\\.ico$"))
    return "x-local://app/pict/fixture.ico";
  if (/url/i.test(key)) return "x-local://wtv/fixture.xml";
  if (schema.pattern) return "42";
  return "fixture";
}
function operationSample(id: string, schema: Record<string, unknown>): Record<string, unknown> {
  const fileId = "00112233445566778899aabbccddeeff";
  if (id === "web.pages.uploadChunk")
    return {
      fileId,
      filename: "fixture.bin",
      index: 0,
      chunksTotal: 1,
      totalBytes: 1,
      offset: 0,
      data: { base64: "eA==" },
    };
  if (id === "web.pages.clearUploadChunks") return { fileId, chunksTotal: 1 };
  return sample(schema) as Record<string, unknown>;
}

for (const operation of ["web.lifecycle.logout", "web.lifecycle.logout2"])
  test(`failed ${operation} disposes the old context and the next call bootstraps again`, async () => {
    const mock = fixture();
    const gateway = new NativeGateway({
      ...base,
      fetch: async (input, init) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith(operation.endsWith("logout2") ? "/logout2.htm" : "/logout.htm"))
          return new Response("failed logout", { status: 500 });
        return mock.fetch(input, init);
      },
    });
    const previous = await gateway.web();
    try {
      await assert.rejects(
        gateway.call(operation, {}),
        (error) => error instanceof Error && (error as { status?: number }).status === 500,
      );
      await assert.rejects(previous.lds.xQuery({ query: "1" }), /disposed|closed/);
      await gateway.call("web.lds.xQuery", { query: "1" });
      assert.equal(mock.calls.filter((call) => call.url.pathname.endsWith("/main.htm")).length, 2);
    } finally {
      await gateway.close().catch(() => undefined);
    }
  });

test("all LOB gateway schemas and direct vendor APIs reject classic document URLs before transport", async () => {
  const mock = fixture();
  const gateway = new NativeGateway({ ...base, fetch: mock.fetch });
  try {
    const operations = getNativeOperations().filter((operation) =>
      /LargeField/.test(operation.method),
    );
    assert.equal(operations.length, 9);
    for (const operation of operations) {
      assert.equal(
        (operation.inputSchema.properties as Record<string, Record<string, unknown>>).docUrl!
          .pattern,
        "^x-db-obj://",
      );
      await assert.rejects(
        gateway.call(operation.id, {
          ...operationSample(operation.id, operation.inputSchema),
          docUrl: "x-local://wt_data/objects/own.xml",
        }),
        /значение записано неверно/,
      );
    }
    const transport = new HttpTransport({ ...base, fetch: mock.fetch });
    const native = createNativeLdsApi(transport, () => "42");
    const web = new WebSpXmlApi(transport);
    const args = {
      docUrl: "x-local://wt_data/objects/own.xml",
      fieldId: "42",
      fieldPathname: "data",
      contentType: "application/octet-stream",
      size: "4",
      data: new Uint8Array(4),
      body: new Uint8Array(4),
      srcUrl: "x-local://share/own.bin",
    };
    for (const action of [
      () => native.loadLargeField(args),
      () => native.putLargeField(args),
      () => native.deleteLargeField(args),
      () => web.getLargeField(args),
      () => web.putLargeField(args),
      () => web.putLargeFieldFromUrl(args),
    ])
      await assert.rejects(
        Promise.resolve().then((): Promise<unknown> => action()),
        (error) =>
          error instanceof Error &&
          /зарегистрированного типа/.test(error.message) &&
          (error as { requestSent?: boolean }).requestSent === false,
      );
    transport.dispose();
    assert.equal(mock.calls.length, 0);
  } finally {
    await gateway.close();
  }
});

test("binary result carries only kind, bytes and contentType, never HTTP headers", async () => {
  const mock = fixture();
  const gateway = new NativeGateway({
    ...base,
    fetch: async (input, init) =>
      String(input).includes("/get_url.htm")
        ? new Response(Uint8Array.of(0, 255), { headers: { "x-private-fixture": "private" } })
        : mock.fetch(input, init),
  });
  const result = await gateway.call("web.pages.getUrl", { url: "x-local://wtv/fixture.png" });
  assert.deepEqual(Object.keys(result as object), ["kind", "bytes", "contentType"]);
  await gateway.close();
});

test("operation registry has unique IDs and excludes reflective private dispatch", async () => {
  const operations = getNativeOperations();
  assert.equal(new Set(operations.map((item) => item.id)).size, operations.length);
  assert.ok(operations.length > 80);
  assert.equal(operations.find((item) => item.id === "native.lds.xQuery")?.effect, "execute");
  const mock = fixture();
  const gateway = new NativeGateway({ ...base, fetch: mock.fetch });
  await assert.rejects(
    gateway.call("native.lds.constructor", { $args: [] }),
    /Unknown native operation/,
  );
  assert.equal(mock.calls.length, 0);
  await gateway.close();
});

// This fixture speaks HTTP/SOAP only. Socket operations have independent real
// loopback fixtures in websocket-protocol.test.ts and websocket-frontends.test.ts.
for (const operation of getNativeOperations().filter((item) => item.group !== "websocket"))
  test(`synthetic request/response: ${operation.id}`, async () => {
    const mock = fixture();
    const gateway = new NativeGateway({ ...base, fetch: mock.fetch });
    try {
      const result = await gateway.call(
        operation.id,
        operationSample(operation.id, operation.inputSchema),
      );
      assert.notEqual(result, undefined);
      if (operation.id.endsWith(".rawRequest")) {
        const request = mock.calls.find((call) => call.url.pathname.endsWith("/raw-fixture"))!;
        if (operation.profile === "anonymous")
          assert.match(request.headers.get("authorization") ?? "", /^Basic /);
        else {
          assert.equal(request.headers.get("authorization"), null);
          assert.match(request.headers.get("cookie") ?? "", /^SessionID=/);
        }
        assert.equal((result as { kind: string }).kind, "binary");
      }
      if (operation.id.endsWith(".call"))
        assert.equal((result as { lexicalValue: string }).lexicalValue, "fixture");
    } finally {
      await gateway.close();
    }
  });

test("native calls share one session and cursor context; close rejects further network access", async () => {
  const mock = fixture();
  const gateway = new NativeGateway({ ...base, fetch: mock.fetch });
  await gateway.call("native.lds.xQuery", {
    query: "for $x in collaborators return $x",
    keepCursor: true,
  });
  await gateway.call("native.lds.xQuery", {
    query: "",
    cursorId: "9007199254740993",
    startPos: 1,
    maxCount: 1,
  });
  assert.equal(mock.calls.filter((call) => call.body.includes("<OpenSession ")).length, 1);
  assert.ok(mock.calls.some((call) => call.body.includes("<CursorID>9007199254740993</CursorID>")));
  await gateway.close();
  const count = mock.calls.length;
  await assert.rejects(gateway.call("native.lds.idle", {}), /closed/);
  assert.equal(mock.calls.length, count);
});

test("invalid XML, missing arguments and unknown fields are rejected without persistent mutation", async () => {
  const mock = fixture();
  const gateway = new NativeGateway({ ...base, fetch: mock.fetch });
  await assert.rejects(gateway.call("native.lds.deleteDoc", {}), /обязательное значение не задано/);
  await assert.rejects(
    gateway.call("native.lds.deleteDoc", { url: "x-local://wtv/test.xml", extra: true }),
    /такого аргумента у операции нет/,
  );
  await assert.rejects(
    gateway.call("native.lds.putDoc", { url: "x-local://wtv/test.xml", data: "<!DOCTYPE a><a/>" }),
    /DOCTYPE/,
  );
  assert.ok(!mock.calls.some((call) => call.body.includes("<PutDoc ")));
  await gateway.close();
});

test("all response consumers are byte-bounded and cancel oversized streams", async () => {
  let cancelled = false;
  const fetch: typeof globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(33));
        },
        cancel() {
          cancelled = true;
        },
      }),
    );
  const transport = new HttpTransport({
    baseUrl: base.baseUrl,
    timeoutMs: 1000,
    maxResponseBytes: 32,
    fetch,
  });
  const response = await transport.send("/bounded");
  await assert.rejects(response.arrayBuffer(), /byte limit/);
  assert.equal(cancelled, true);
});

test("redirects preserve mount path and cookies; external redirects and write redirects are refused", async () => {
  const urls: string[] = [];
  const headers: Headers[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    urls.push(String(input));
    headers.push(new Headers(init?.headers));
    return urls.length === 1
      ? new Response(null, {
          status: 302,
          headers: { location: "/hcm/next", "set-cookie": "SessionID=redirect-fixture" },
        })
      : new Response("done");
  };
  const transport = new HttpTransport({ baseUrl: base.baseUrl, timeoutMs: 1000, fetch });
  assert.equal(await (await transport.send("/first")).text(), "done");
  assert.deepEqual(urls, ["http://fixture.invalid/hcm/first", "http://fixture.invalid/hcm/next"]);
  assert.equal(headers[1]!.get("cookie"), "SessionID=redirect-fixture");
  const external = new HttpTransport({
    baseUrl: base.baseUrl,
    timeoutMs: 1000,
    fetch: async () =>
      new Response(null, { status: 302, headers: { location: "https://outside.invalid/" } }),
  });
  await assert.rejects(external.send("/first"), /Redirect leaves the configured server/);
  await assert.rejects(
    external.send("/first", { method: "POST", body: "fixture" }),
    /Write redirect/,
  );
});

test("partial web bootstrap logs out and disposed sessions refuse reuse", async () => {
  const mock = fixture();
  const fetch: typeof globalThis.fetch = async (input, init) =>
    typeof init?.body === "string" && init.body.includes("<OpenSession ")
      ? new Response("broken")
      : mock.fetch(input, init);
  const client = new WsHcmClient({
    ...base,
    auth: { username: "fixture", password: "fixture" },
    fetch,
  });
  await assert.rejects(client.openWebSession(), /Invalid XML|Missing/);
  assert.ok(mock.calls.some((call) => call.url.pathname.endsWith("/logout.htm")));
  assert.ok(mock.calls.some((call) => call.url.pathname.endsWith("/logout2.htm")));
  const normal = new WsHcmClient({
    ...base,
    auth: { username: "fixture", password: "fixture" },
    fetch: mock.fetch,
  });
  const session = await normal.openNativeSession();
  await session.close();
  const count = mock.calls.length;
  await assert.rejects(session.lds.idle(), /closed/);
  assert.equal(mock.calls.length, count);
});

test("web and native SPXML GetDoc omit a false TryLock rather than enabling a presence flag", async () => {
  for (const id of ["web.spxml.getDoc", "native.experimental.spxml.getDoc"]) {
    const mock = fixture();
    const gateway = new NativeGateway({ ...base, fetch: mock.fetch });
    await gateway.call(id, { docUrl: "x-local://wtv/fixture.xml", tryLock: false });
    assert.equal(
      mock.calls
        .find((call) => call.url.pathname.endsWith("/GetDoc"))
        ?.url.searchParams.get("TryLock"),
      null,
    );
    await gateway.close();
  }
});

test("concurrent close calls await the same cleanup and drain accepted queued operations", async () => {
  const mock = fixture();
  const gateway = new NativeGateway({ ...base, fetch: mock.fetch });
  const accepted = gateway.call("native.lds.idle", {});
  const first = gateway.close();
  const second = gateway.close();
  assert.equal(first, second);
  await accepted;
  await first;
  assert.equal(mock.calls.filter((call) => call.body.includes("<OpenSession ")).length, 1);
  assert.equal(mock.calls.filter((call) => call.body.includes("<CloseSession ")).length, 1);
});

test("queued native calls snapshot reused URLs and nested binary/XML boxes at acceptance", async () => {
  const mock = fixture();
  const gateway = new NativeGateway({ ...base, fetch: mock.fetch });
  const input = { url: "x-local://share/original-a.bin", data: { base64: "QQ==" } };
  const first = gateway.call("native.lds.putUrl", input);
  input.url = "x-local://share/original-b.bin";
  input.data.base64 = "Qg==";
  const second = gateway.call("native.lds.putUrl", input);
  input.url = "x-local://share/unaccepted-c.bin";
  input.data.base64 = "Qw==";
  const rpc = {
    target: "custom.original",
    args: [
      { valueType: "object", lexicalValue: { xml: '<Item VALUE-TYPE="string">original</Item>' } },
    ],
  };
  const third = gateway.call("native.rpc.call", rpc);
  rpc.target = "custom.unaccepted";
  rpc.args[0]!.lexicalValue.xml = '<Item VALUE-TYPE="string">unaccepted</Item>';
  await Promise.all([first, second, third]);
  const writes = mock.calls.filter((call) => call.body.includes("<PutUrl "));
  assert.equal(writes.length, 2);
  assert.ok(writes[0]!.body.includes("<Url>x-local://share/original-a.bin</Url>"));
  assert.ok(writes[0]!.body.includes("\r\n\r\nA\r\n--"));
  assert.ok(writes[1]!.body.includes("<Url>x-local://share/original-b.bin</Url>"));
  assert.ok(writes[1]!.body.includes("\r\n\r\nB\r\n--"));
  const call = mock.calls.find((request) => request.body.includes("<CallMethod "))!;
  assert.ok(call.body.includes("<MethodName>original</MethodName>"));
  assert.ok(call.body.includes(">original</Item>"));
  assert.ok(!call.body.includes("unaccepted"));
  await gateway.close();
});

test("native registry describes 1171 async terminal result consumption for both SOAP profiles", () => {
  for (const id of [
    "web.spxml.getAsyncMethodStatus",
    "native.experimental.spxml.getAsyncMethodStatus",
  ]) {
    const description = getNativeOperations().find((operation) => operation.id === id)!.description;
    assert.match(description, /1171/);
    assert.match(description, /terminal response consumes/);
    assert.match(description, /lost HTTP/);
  }
});

test("dynamic RPC preserves explicitly boxed XML arguments without forcing an upstream target allowlist", async () => {
  const mock = fixture();
  const gateway = new NativeGateway({ ...base, fetch: mock.fetch });
  await gateway.call("native.rpc.call", {
    target: "custom.unlisted",
    args: [{ valueType: "object", lexicalValue: { xml: '<Item VALUE-TYPE="string">safe</Item>' } }],
  });
  const call = mock.calls.find((request) => request.body.includes("<CallMethod "));
  assert.ok(call?.body.includes('<Item VALUE-TYPE="string">safe</Item>'));
  assert.ok(!call?.body.includes("&lt;Item"));
  await gateway.close();
});

test("a failed bounded stream releases ownership of the original response reader", async () => {
  const original = new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("synthetic broken stream"));
      },
    }),
  );
  const transport = new HttpTransport({
    baseUrl: base.baseUrl,
    timeoutMs: 1000,
    maxResponseBytes: 32,
    fetch: async () => original,
  });
  const response = await transport.send("/read");
  await assert.rejects(
    response.arrayBuffer(),
    (error) =>
      error instanceof Error &&
      (error as { kind?: string }).kind === "http" &&
      error.message === "HTTP response body failed",
  );
  assert.equal(original.body?.locked, false);
});

test("invalid dynamic RPC target syntax is rejected before even opening a session", async () => {
  const mock = fixture();
  const gateway = new NativeGateway({ ...base, fetch: mock.fetch });
  await assert.rejects(
    gateway.call("native.rpc.call", { target: "library.method.extra", args: [] }),
    /значение записано неверно/,
  );
  assert.equal(mock.calls.length, 0);
  await gateway.close();
});

test("schema bounds and enum values are validated, including Unicode string length", () => {
  const rejected: Array<[unknown, Record<string, unknown>]> = [
    ["1", { type: "integer" }],
    [1.5, { type: "integer" }],
    [-1, { type: "integer", minimum: 0 }],
    [11, { type: "number", maximum: 10 }],
    [NaN, { type: "number" }],
    [Infinity, { type: "integer" }],
    ["", { type: "string", minLength: 1 }],
    ["ab", { type: "string", maxLength: 1 }],
    [[], { type: "array", minItems: 1 }],
    [[1, 2], { type: "array", maxItems: 1 }],
    ["wrong", { type: "string", enum: ["right"] }],
  ];
  for (const [value, schema] of rejected) assert.throws(() => validate(value, schema), TypeError);
  validate("😀", { type: "string", minLength: 1, maxLength: 1 });
  validate({ a: [1] }, { enum: [{ a: [1] }] });
  validate(0, { type: "integer", minimum: 0, maximum: 0 });
  const objectSchema = {
    type: "object",
    properties: { url: { type: "string" } },
    required: ["url"],
    additionalProperties: false,
  };
  assert.throws(
    () => validate(Object.create({ url: "inherited" }), objectSchema),
    /обязательное значение не задано/,
  );
  for (const key of ["__proto__", "constructor", "toString"])
    assert.throws(
      () => validate(JSON.parse(`{"url":"fixture","${key}":"unexpected"}`), objectSchema),
      /такого аргумента у операции нет/,
    );
});

test("composite integer and batch limits fail before opening a native context", async () => {
  const mock = fixture();
  const runtime = new HcmRuntime({
    ...base,
    fetch: mock.fetch,
    name: "synthetic-validation",
    outputLimitBytes: 1024,
    runtimeDir: ".work/synthetic-validation",
    permissions: { write: true, execute: true },
  });
  for (const [id, args] of [
    ["runtime.query", { catalog: "presence_states", startPosition: 1.5 }],
    ["runtime.query", { catalog: "presence_states", startPosition: -1 }],
    ["runtime.batch", { steps: [] }],
    ["runtime.batch", { steps: Array.from({ length: 101 }, () => ({ id: "runtime.status" })) }],
  ] as const) {
    const result = await runtime.call(id, args);
    assert.equal(result.ok, false);
    assert.equal(result.error?.mutationOutcome, "not_sent");
  }
  assert.equal(mock.calls.length, 0);
  await runtime.close();
});

test("XML literals and references reject invalid XML 1.0 characters before transport", async () => {
  for (const source of [
    "<a>\u0000</a>",
    "<a>\ud800</a>",
    "<a>\udfff</a>",
    "<a>&#0;</a>",
    "<a>&#xD800;</a>",
    "<a>&#x110000;</a>",
  ]) {
    assert.throws(() => rawXml(source), /недопустимый символ/);
    assert.throws(() => parseXml(source), /недопустимый символ/);
  }
  assert.throws(() => escapeXml("\u0001"), /недопустимый символ/);
  for (const source of [
    "<a>😀\t\n\r</a>",
    "<a><![CDATA[&#0;]]></a>",
    "<a><!--&#xD800;--></a>",
    "<a><?test &#0;?></a>",
  ])
    assert.doesNotThrow(() => rawXml(source));
  const mock = fixture();
  const gateway = new NativeGateway({ ...base, fetch: mock.fetch });
  await assert.rejects(
    gateway.call("native.lds.putDoc", { url: "x-local://fixture.xml", data: "<a>&#0;</a>" }),
    /недопустимый символ/,
  );
  assert.equal(mock.calls.length, 0);
  await gateway.close();
});

test("present empty SOAP response nodes are accepted while missing nodes still fail", () => {
  for (const method of ["PutDoc", "PutUrl", "CloseSession"]) {
    for (const node of [`<${method}Response/>`, `<${method}Response></${method}Response>`])
      assert.deepEqual(
        parseSoapBody(
          method,
          `<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope/"><s:Body>${node}</s:Body></s:Envelope>`,
          200,
        ),
        {},
      );
    assert.throws(
      () =>
        parseSoapBody(
          method,
          '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope/"><s:Body/></s:Envelope>',
          200,
        ),
      /Missing/,
    );
  }
});

test("XML character references decode exactly once in text and attributes without HTML entities", () => {
  assert.deepEqual(parseXml('<x a="&#13;&#xD;&#9;&#x1F600;">&#13;&#xD;&#10;&#00000000065;</x>'), {
    x: { "#text": "\r\r\nA", "@_a": "\r\r\t😀" },
  });
  for (const [source, expected] of [
    ["&amp;#10;", "&#10;"],
    ["&#38;#xA;", "&#xA;"],
    ["&#x26;#10;", "&#10;"],
    ["&#0000038;#10;", "&#10;"],
    ["&amp;lt;", "&lt;"],
  ])
    assert.equal(parseXml(`<x>${source}</x>`).x, expected);
  assert.equal(parseXml("<x>&#10;<![CDATA[&#10;&nbsp;]]>&#13;</x>").x, "\n&#10;&nbsp;\r");
  assert.equal(parseXml("<x><!-- &#10;&nbsp; -->A&#10;</x>").x, "A\n");
  assert.throws(() => parseXml("<x>&nbsp;</x>"), /нет среди допустимых/);
  assert.throws(() => parseXml('<x a="&#xD800;"/>'), /недопустимый символ/);
  assert.throws(() => parseXml("<x>&raw</x>"), /одиночный знак &/);
  assert.equal(
    parseXml("<x><![CDATA[<!DOCTYPE html><html>&nbsp;</html>]]></x>").x,
    "<!DOCTYPE html><html>&nbsp;</html>",
  );
  assert.deepEqual(parseXml(buildXml({ x: { "@_a": "\r😀", "#text": "\r\n&literal" } })), {
    x: { "#text": "\r\n&literal", "@_a": "\r😀" },
  });
});

test("unresolved batch references require write permission for conditional lock operations", () => {
  for (const operation of getNativeOperations().filter((operation) =>
    ["loadDoc", "loadUrl", "getDoc"].includes(operation.method),
  )) {
    assert.equal(getEffectiveNativeEffect(operation, { tryLock: true }), "write", operation.id);
    assert.equal(
      getEffectiveNativeEffect(operation, { tryLock: { $ref: "policy.data.lock" } }),
      "write",
      operation.id,
    );
    assert.equal(
      getEffectiveNativeEffect(operation, { $ref: "metadata.data.arguments" }),
      "write",
      operation.id,
    );
    assert.equal(
      getEffectiveNativeEffect(operation, { tryLock: false }),
      operation.effect,
      operation.id,
    );
    assert.equal(
      getEffectiveNativeEffect(operation, { tryLock: { $ref: "policy.data.lock", extra: false } }),
      operation.effect,
      operation.id,
    );
  }
});

test("zero-byte logs pass through the native RPC XML decoder as empty text and events", async () => {
  const mock = fixture();
  const gateway = new NativeGateway({
    ...base,
    fetch: async (input, init) => {
      if (String(input).endsWith("/api/spxml/CallMethod")) {
        const body =
          typeof init?.body === "string"
            ? init.body
            : new TextDecoder().decode(init?.body as Uint8Array);
        const report =
          "<data><rs><r><cs><c><t>Fixture</t></c><c/><c><t>empty.log</t></c><c><t>0</t></c><c><t>xhttp</t></c><c/><c><t>x-local://Logs/empty.log</t></c></cs></r></rs></data>";
        return soap(
          "CallMethod",
          body.includes("<MethodName>server_log_report</MethodName>")
            ? `<ResultData><Result VALUE-TYPE="string">${escapeXml(report)}</Result></ResultData>`
            : body.includes('<arg-1 VALUE-TYPE="integer">0</arg-1>')
              ? `<ResultData><Result VALUE-TYPE="string">${escapeXml("Показано последние 0 байт файла. Для просмотра всего файла его нужно сохранить.\n")}</Result></ResultData>`
              : '<ResultData><Result VALUE-TYPE="string"/></ResultData>',
        );
      }
      return mock.fetch(input, init);
    },
  });
  try {
    const directEmpty = await gateway.call("native.rpc.call", {
      target: "tools.load_url_data_server",
      args: [
        { valueType: "string", lexicalValue: "x-local://Logs/empty.log" },
        { valueType: "null", lexicalValue: "" },
      ],
    });
    const typedEmpty = directEmpty as { valueType: string; lexicalValue: string };
    assert.equal(typedEmpty.valueType, "string");
    assert.equal(typedEmpty.lexicalValue, "");
    const reader = new LogReader(gateway, { maxResponseBytes: 1024 * 1024 });
    const read = await reader.read({ file: "empty.log", full: true });
    assert.equal(read.text, "");
    assert.equal(read.returnedChars, 0);
    const search = await reader.search({ file: "empty.log", full: true });
    assert.deepEqual(search.events, []);
    assert.equal(search.totalEvents, 0);
  } finally {
    await gateway.close();
  }
});

test("native count fields and image effect scalars reject invalid inputs before any transport", async () => {
  const mock = fixture();
  const gateway = new NativeGateway({ ...base, fetch: mock.fetch });
  for (const operation of ["native.lds.xQuery", "web.lds.xQuery"])
    for (const field of ["startPos", "maxCount"])
      for (const value of [
        0.5,
        Number.MAX_SAFE_INTEGER + 1,
        Number.MIN_SAFE_INTEGER - 1,
        NaN,
        Infinity,
      ])
        await assert.rejects(
          gateway.call(operation, { query: "presence_states", [field]: value }),
          /нужно целое число|число больше допустимого|число меньше допустимого|нужно число/,
        );
  for (const value of [{ nested: true }, ["nested"]])
    await assert.rejects(
      gateway.call("web.spxml2.getImage", {
        url: "x-local://fixture.jpg",
        effects: { width: value },
      }),
      /ни под один из допустимых вариантов/,
    );
  for (const filename of [
    "",
    "../fixture",
    "..fixture",
    "fixture..",
    ".",
    "a/b",
    "a\\b",
    "a\u0000b",
    "x".repeat(256),
  ])
    await assert.rejects(
      gateway.call("web.pages.uploadFile", { filename, data: "fixture" }),
      /строка короче допустимого|строка длиннее допустимого|значение записано неверно/,
    );
  for (const contentType of ["", "bad\nvalue", "x".repeat(257)])
    await assert.rejects(
      gateway.call("web.pages.uploadFile", {
        filename: "fixture.txt",
        data: "fixture",
        contentType,
      }),
      /строка короче допустимого|строка длиннее допустимого|значение записано неверно/,
    );
  assert.equal(mock.calls.length, 0);
  await gateway.close();
});
