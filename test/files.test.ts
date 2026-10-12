import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HcmError } from "../src/errors.js";
import { HcmRuntime } from "../src/runtime.js";
import { HcmClient, unwrap } from "../src/sdk.js";
import { fileExistsUrl, parseFileExists } from "../src/files.js";
import { parseXml } from "../src/protocol/xml.js";

const typed = (lexical: string, type = "bool") => ({
  valueType: type,
  lexicalValue: lexical,
  xml: parseXml(`<ResultData><Result VALUE-TYPE="${type}">${lexical}</Result></ResultData>`),
});
const prefix = "x-local://Share/";
const inputUrl = prefix + "файл 😀 +% & =.txt";

test("the stock predicate decodes direct bool0/1 without interpreting existence as access or regular-file status", () => {
  for (const [lexical, exists] of [
    ["0", false],
    ["1", true],
  ] as const) {
    const response = typed(lexical);
    const before = structuredClone(response);
    const result = parseFileExists(response);
    assert.equal(result.exists, exists);
    assert.deepEqual(result, { exists });
    assert.ok(Object.isFrozen(result));
    assert.deepEqual(response, before);
    assert.equal(Object.hasOwn(result, "url"), false);
  }
});

test("malformed, nested and inconsistent RPC booleans produce a fixed semantic error without raw data", () => {
  const good = typed("1");
  const bad = [
    typed("true"),
    typed("false"),
    typed("2"),
    typed(""),
    typed(" 1 "),
    typed("1", "string"),
    { ...good, lexicalValue: "0" },
    { ...good, valueType: "Object" },
    { ...good, valueType: undefined },
    { ...good, xml: { nested: good.xml } },
    { ...good, xml: { ResultData: { Result: [good.xml.ResultData, good.xml.ResultData] } } },
    {
      ...good,
      xml: {
        ResultData: {
          Result: { "@_VALUE-TYPE": "bool", "#text": "1", PRIVATE_FIELD: "PRIVATE_SECRET" },
        },
      },
    },
    { ...good, PRIVATE_FIELD: "PRIVATE_SECRET" },
  ];
  for (const response of bad)
    assert.throws(
      () => parseFileExists(response),
      (error: unknown) => {
        assert.ok(error instanceof HcmError);
        assert.equal(error.code, "FILE_EXISTS_RESPONSE");
        assert.equal(error.message, "Сервер ответил на проверку файла в неожиданном виде.");
        assert.equal(error.details, undefined);
        assert.equal(error.cause, undefined);
        assert.doesNotMatch(JSON.stringify(error), /PRIVATE_SECRET|PRIVATE_FIELD/);
        return true;
      },
    );
});

test("URL preflight preserves path text and bounds UTF-16 length before any server use", () => {
  for (const url of [
    inputUrl,
    "x-local://Logs",
    "x-local://Share/",
    prefix + "a".repeat(256 - prefix.length),
  ])
    assert.equal(fileExistsUrl(url), url);
  const nonBmpExact = prefix + "😀".repeat((256 - prefix.length) / 2);
  assert.equal(nonBmpExact.length, 256);
  assert.equal(fileExistsUrl(nonBmpExact), nonBmpExact);
  for (const url of [
    undefined,
    null,
    1,
    "",
    "x-local://",
    "http://fixture.invalid/file",
    "x-db-obj://db/id",
    "C:\\PRIVATE_PATH",
    "X-LOCAL://Share/f",
    "x-local://user@Share/f",
    "x-local://Share:80/f",
    "x-local://bad host/f",
    prefix + "f?key=value",
    prefix + "f#fragment",
    prefix + "\\f",
    prefix + "\n",
    prefix + "\u0000",
    prefix + "\ud800",
    prefix + "\udc00",
    prefix + "\ufffe",
    prefix + "a".repeat(257 - prefix.length),
    nonBmpExact + "a",
  ])
    assert.throws(
      () => fileExistsUrl(url),
      (error: unknown) => {
        assert.ok(error instanceof HcmError);
        assert.equal(error.code, "INVALID_ARGUMENT");
        assert.doesNotMatch(JSON.stringify(error), /PRIVATE_PATH/);
        return true;
      },
    );
});

function soap(method: string, payload = "") {
  return `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope/"><soap:Body><${method}Response xmlns="http://www.datex-soft.com/">${payload}</${method}Response></soap:Body></soap:Envelope>`;
}
async function fixture(
  options: { lexical?: string; response?: () => Response; bootstrap?: () => Response } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "hcm-files-"));
  const calls: { path: string; method: string; body: string }[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "http://file-predicate-fixture.invalid");
    const body =
      typeof init?.body === "string"
        ? init.body
        : init?.body instanceof Uint8Array
          ? new TextDecoder().decode(init.body)
          : "";
    const method = /<soap:Body><([A-Za-z]+)/.exec(body)?.[1] ?? "loggedoff";
    calls.push({ path: url.pathname, method, body });
    const headers = new Headers(init?.headers);
    if (method === "OpenSession") {
      assert.equal(headers.get("cookie"), null);
      assert.equal(headers.get("authorization"), "Basic Zml4dHVyZTpzeW50aGV0aWMtc2VjcmV0");
      if (options.bootstrap) return options.bootstrap();
    } else {
      assert.equal(headers.get("authorization"), null);
      assert.equal(headers.get("cookie"), "SessionID=owned-file-predicate");
    }
    if (method === "CallMethod" && options.response) return options.response();
    const payload =
      method === "OpenSession"
        ? "<SessionID>42</SessionID>"
        : method === "CallMethod"
          ? `<ResultData><Result VALUE-TYPE="bool">${options.lexical ?? "1"}</Result></ResultData>`
          : "";
    return new Response(method === "loggedoff" ? "<html>closed</html>" : soap(method, payload), {
      headers: {
        "content-type": "application/soap+xml",
        "set-cookie": "SessionID=owned-file-predicate",
      },
    });
  };
  const runtime = new HcmRuntime({
    name: "files-readonly",
    baseUrl: "http://file-predicate-fixture.invalid/",
    username: "fixture",
    password: "synthetic-secret",
    timeoutMs: 1000,
    maxResponseBytes: 65536,
    outputLimitBytes: 1024,
    runtimeDir: directory,
    permissions: { write: false, execute: false },
    fetch,
  });
  return {
    calls,
    runtime,
    async close() {
      try {
        await runtime.close();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
}

test("SDK true and false use one exact fixed native RPC under read-only policy with owned session teardown", async () => {
  for (const lexical of ["0", "1"]) {
    const f = await fixture({ lexical });
    try {
      assert.equal(f.runtime.describe("files.exists").effect, "read");
      const result = await HcmClient.fromRuntime(f.runtime).fileExists({ url: inputUrl });
      assert.equal(result.ok, true);
      assert.equal(result.meta.truncated, undefined);
      assert.equal(unwrap(result).exists, lexical === "1");
      assert.equal(f.calls.length, 2);
      assert.equal(f.calls[1]!.path, "/api/spxml/CallMethod");
      assert.equal(
        f.calls[1]!.body,
        '<?xml version="1.0" encoding="utf-8"?>' +
          '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope/"><soap:Body><CallMethod xmlns="http://www.datex-soft.com/">' +
          '<LibName>tools</LibName><MethodName>file_url_exists_server</MethodName><ArgData><arg-0 VALUE-TYPE="string">' +
          "x-local://Share/файл 😀 +% &amp; =.txt</arg-0></ArgData></CallMethod></soap:Body></soap:Envelope>",
      );
      const before = f.calls.length;
      assert.equal(
        (
          await f.runtime.call("native.rpc.call", {
            target: "tools.file_url_exists_server",
            args: [],
          })
        ).error?.code,
        "EXECUTE_DISABLED",
      );
      assert.equal(
        (
          await f.runtime.call("rpc.call", {
            library: "tools",
            method: "file_url_exists_server",
            arguments: [inputUrl],
          })
        ).error?.code,
        "EXECUTE_DISABLED",
      );
      assert.equal(f.calls.length, before);
    } finally {
      await f.close();
    }
    assert.deepEqual(
      f.calls.map((row) => row.method),
      ["OpenSession", "CallMethod", "CloseSession", "loggedoff"],
    );
    assert.match(f.calls[2]!.body, /<SessionID>42<\/SessionID>/);
  }
});

test("invalid fixed predicate input never bootstraps or accepts target/profile injection", async () => {
  const f = await fixture();
  try {
    for (const args of [
      {},
      { url: "http://fixture.invalid" },
      { url: prefix + "a".repeat(257) },
      { url: prefix + "\ud800" },
      { url: inputUrl, profile: "web" },
      { url: inputUrl, target: "tools.get_version" },
      { url: inputUrl, helperScript: "PRIVATE_SECRET" },
    ]) {
      const result = await f.runtime.call("files.exists", args);
      assert.equal(result.ok, false);
      assert.equal(result.error?.code, "INVALID_ARGUMENT");
    }
    assert.equal(f.calls.length, 0);
  } finally {
    await f.close();
  }
  assert.equal(f.calls.length, 0);
});

test("auth, permission, SOAP, protocol and transport failures remain upstream errors rather than false predicates", async () => {
  const variants = [
    { code: "PLATFORM_AUTH", response: () => new Response("PRIVATE_SECRET", { status: 401 }) },
    {
      code: "PLATFORM_PERMISSION",
      response: () => new Response("PRIVATE_SECRET", { status: 403 }),
    },
    {
      code: "PLATFORM_SOAP-FAULT",
      response: () =>
        new Response(
          '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope/"><soap:Body><soap:Fault><soap:Reason><soap:Text>PRIVATE_SECRET</soap:Text></soap:Reason></soap:Fault></soap:Body></soap:Envelope>',
          { status: 500 },
        ),
    },
    { code: "PLATFORM_PROTOCOL", response: () => new Response(soap("CallMethod")) },
    {
      code: "PLATFORM_HTTP",
      response: () => {
        throw new TypeError("PRIVATE_SECRET");
      },
    },
    {
      code: "FILE_EXISTS_RESPONSE",
      response: () =>
        new Response(
          soap("CallMethod", '<ResultData><Result VALUE-TYPE="bool">true</Result></ResultData>'),
        ),
    },
  ];
  for (const variant of variants) {
    const f = await fixture({ response: variant.response });
    try {
      const result = await f.runtime.call("files.exists", { url: inputUrl });
      assert.equal(result.ok, false);
      assert.equal(result.error?.code, variant.code);
      assert.equal(result.error?.retryable, false);
      assert.equal(result.data, undefined);
      assert.equal(result.error?.mutationOutcome, undefined);
      assert.doesNotMatch(JSON.stringify(result), /PRIVATE_SECRET/);
      assert.equal(f.calls.filter((row) => row.method === "CallMethod").length, 1);
    } finally {
      await f.close();
    }
  }
});

test("bootstrap auth and malformed session replies remain errors and never send the predicate RPC", async () => {
  for (const variant of [
    { code: "PLATFORM_AUTH", body: "PRIVATE_SECRET", status: 401 },
    { code: "PLATFORM_PROTOCOL", body: soap("OpenSession"), status: 200 },
  ]) {
    const f = await fixture({
      bootstrap: () =>
        new Response(variant.body, {
          status: variant.status,
          headers: {
            "content-type": "application/soap+xml",
            "set-cookie": "SessionID=owned-file-predicate",
          },
        }),
    });
    try {
      const result = await f.runtime.call("files.exists", { url: inputUrl });
      assert.equal(result.ok, false);
      assert.equal(result.error?.code, variant.code);
      assert.equal(result.data, undefined);
      assert.doesNotMatch(JSON.stringify(result), /PRIVATE_SECRET/);
    } finally {
      await f.close();
    }
    assert.deepEqual(
      f.calls.map((row) => row.method),
      ["OpenSession", "loggedoff"],
    );
  }
});
