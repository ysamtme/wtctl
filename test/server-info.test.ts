import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HcmError } from "../src/errors.js";
import { HcmRuntime } from "../src/runtime.js";
import { HcmClient, HcmStoredResultError, unwrap } from "../src/sdk.js";
import { parseServerInfo, type ServerInfoProfile } from "../src/server-info.js";
import { escapeXml, parseXml } from "../src/protocol/xml.js";

const metadataFields = (
  options: {
    capability?: string;
    limits?: string;
    version?: string;
    os?: string;
  } = {},
): string =>
  `<sys_db_capability VALUE-TYPE="integer">${escapeXml(options.capability ?? "0x10001")}</sys_db_capability>` +
  `<catalog_limits VALUE-TYPE="string">${escapeXml(options.limits ?? "<catalogs/>")}</catalog_limits>` +
  `<version_server VALUE-TYPE="string">${escapeXml(options.version ?? "2030.2.1500 (future history)")}</version_server>` +
  `<os_type VALUE-TYPE="string">${escapeXml(options.os ?? "windows")}</os_type>`;
const rpcResponse = (fields = metadataFields()) => ({
  valueType: "Object",
  xml: parseXml(`<ResultData><Result VALUE-TYPE="Object">${fields}</Result></ResultData>`),
});
const limitsXml = (name: string, limit: string): string =>
  `<catalogs><catalog><name>${escapeXml(name)}</name><max_records_num>${escapeXml(limit)}</max_records_num></catalog></catalogs>`;

test("stock metadata preserves future history and exact signed64 lexemes without interpreting capabilities as rights", () => {
  for (const [capability, limit] of [
    ["9223372036854775807", "-9223372036854775808"],
    ["0x7FFFFFFFFFFFFFFF", "0x10001"],
    ["-1", "+0005"],
  ] as const) {
    const response = rpcResponse(
      metadataFields({ capability, limits: limitsXml("a<&> 😀 &amp;", limit!) }),
    );
    const data = parseServerInfo(response, "web");
    assert.equal(data.profile, "web");
    assert.equal(data.versionServer, "2030.2.1500 (future history)");
    assert.equal(data.capabilityMask, capability);
    assert.deepEqual(data.catalogLimits, [
      { objectTypeName: "a<&> 😀 &amp;", maxRecordsNum: limit },
    ]);
    assert.ok(Object.isFrozen(data) && Object.isFrozen(data.catalogLimits));
    assert.equal(response.xml.ResultData !== undefined, true, "decoder does not mutate raw input");
  }
  assert.deepEqual(parseServerInfo(rpcResponse()).catalogLimits, []);
  assert.equal(parseServerInfo(rpcResponse(metadataFields({ os: "linux" }))).osType, "linux");
});

test("the database is told by the flags the server tells it by, PostgreSQL by the bit seen on it", () => {
  for (const [capability, database] of [
    ["118039011", "mssql"],
    ["252256739", "mssql"],
    ["0x00000002070821E3", "postgresql"],
    ["0x000000020F0821E3", "postgresql"],
    ["0x20001", "oracle"],
    ["32769", "azure"],
    ["0", "xml"],
    ["524288", "xml"],
    ["0x070821E3", "other"],
  ] as const)
    assert.equal(parseServerInfo(rpcResponse(metadataFields({ capability }))).database, database);
});

test("the nested XML byte ceiling permits its exact boundary and rejects oversize before accepting metadata", () => {
  const prefix = "<catalogs>";
  const suffix = "</catalogs>";
  const exact = prefix + " ".repeat(256 * 1024 - prefix.length - suffix.length) + suffix;
  assert.equal(Buffer.byteLength(exact), 256 * 1024);
  assert.deepEqual(
    parseServerInfo(rpcResponse(metadataFields({ limits: exact }))).catalogLimits,
    [],
  );
  assert.throws(
    () => parseServerInfo(rpcResponse(metadataFields({ limits: exact + " " }))),
    safeError,
  );
  const rows = Array.from(
    { length: 3000 },
    (_, index) => `<catalog><name>t${index}</name><max_records_num>0</max_records_num></catalog>`,
  ).join("");
  assert.equal(
    parseServerInfo(rpcResponse(metadataFields({ limits: `<catalogs>${rows}</catalogs>` })))
      .catalogLimits.length,
    3000,
  );
});

function safeError(error: unknown): boolean {
  assert.ok(error instanceof HcmError);
  assert.equal(error.code, "SERVER_INFO_RESPONSE");
  assert.equal(error.message, "Сервер вернул сведения о себе в неожиданном виде.");
  assert.equal(error.cause, undefined);
  assert.equal(error.details, undefined);
  assert.doesNotMatch(JSON.stringify(error), /PRIVATE_SECRET|PRIVATE_FIELD|PRIVATE_PATH/);
  return true;
}

test("unexpected typed fields, scalar shapes and ambiguous RPC chains fail with fixed diagnostics", () => {
  const unknown =
    metadataFields() + '<PRIVATE_FIELD VALUE-TYPE="string">PRIVATE_SECRET</PRIVATE_FIELD>';
  const malformed = [
    rpcResponse(unknown),
    rpcResponse(metadataFields().replace('VALUE-TYPE="integer"', 'VALUE-TYPE="real"')),
    rpcResponse(
      metadataFields().replace(
        'VALUE-TYPE="integer">0x10001',
        'VALUE-TYPE="integer"><child/>0x10001',
      ),
    ),
    rpcResponse(metadataFields() + '<os_type VALUE-TYPE="string">windows</os_type>'),
    rpcResponse(metadataFields().replace('<os_type VALUE-TYPE="string">windows</os_type>', "")),
    rpcResponse(metadataFields({ os: "macos" })),
    rpcResponse(metadataFields({ version: "" })),
    rpcResponse(metadataFields({ version: "x".repeat(257) })),
    { xml: { Result: (rpcResponse().xml.ResultData as Record<string, unknown>).Result } },
    { xml: { ResultData: [rpcResponse().xml.ResultData, rpcResponse().xml.ResultData] } },
    { ...rpcResponse(), PRIVATE_FIELD: "PRIVATE_SECRET" },
    { ...rpcResponse(), lexicalValue: "PRIVATE_SECRET" },
  ];
  const attributed = rpcResponse();
  ((attributed.xml.ResultData as Record<string, unknown>).Result as Record<string, unknown>)[
    "@_token"
  ] = "PRIVATE_SECRET";
  malformed.push(attributed);
  for (const value of malformed) assert.throws(() => parseServerInfo(value), safeError);
  const namespaces = rpcResponse();
  namespaces.xml["@_xmlns"] = "http://www.datex-soft.com/";
  assert.equal(parseServerInfo(namespaces).versionServer, "2030.2.1500 (future history)");
});

test("catalog XML is inert, shape checked, unique and decoded once", () => {
  const malformed = [
    "&lt;catalogs/&gt;",
    '<!DOCTYPE catalogs [<!ENTITY x SYSTEM "PRIVATE_PATH">]><catalogs/>',
    "<catalogs/><catalogs/>",
    "<catalogs><extra>PRIVATE_SECRET</extra></catalogs>",
    '<catalogs token="PRIVATE_SECRET"/>',
    "<catalogs><catalog><name>a&b</name><max_records_num>1</max_records_num></catalog></catalogs>",
    "<catalogs><catalog><name><child/></name><max_records_num>1</max_records_num></catalog></catalogs>",
    "<catalogs><catalog><name>a</name><name>b</name><max_records_num>1</max_records_num></catalog></catalogs>",
    "<catalogs><catalog><name>a</name><max_records_num>1</max_records_num><extra/></catalog></catalogs>",
    "<catalogs><catalog><name>a</name><max_records_num>1</max_records_num></catalog><catalog><name>a</name><max_records_num>2</max_records_num></catalog></catalogs>",
  ];
  for (const limits of malformed)
    assert.throws(() => parseServerInfo(rpcResponse(metadataFields({ limits }))), safeError);
  for (const integer of [
    "0x8000000000000000",
    "0xFFFFFFFFFFFFFFFF",
    "9223372036854775808",
    "-9223372036854775809",
    "-0x1",
    "1e3",
    " 1",
    "1.0",
    "",
  ])
    for (const field of ["mask", "limit"] as const)
      assert.throws(
        () =>
          parseServerInfo(
            rpcResponse(
              metadataFields(
                field === "mask" ? { capability: integer } : { limits: limitsXml("a", integer) },
              ),
            ),
          ),
        safeError,
      );
});

function fixture(
  profile: ServerInfoProfile,
  fields = metadataFields(),
  options: { rpcResponse?: () => Response; outputLimitBytes?: number; runtimeDir?: string } = {},
) {
  const calls: { path: string; method?: string; body: string }[] = [];
  const nativeNamespace = "http://www.w3.org/2003/05/soap-envelope/";
  const webNamespace = "http://schemas.xmlsoap.org/soap/envelope/";
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "http://server-info-fixture.invalid");
    const body =
      typeof init?.body === "string"
        ? init.body
        : init?.body instanceof Uint8Array
          ? new TextDecoder().decode(init.body)
          : "";
    const method = /<soap:Body><([A-Za-z]+)/.exec(body)?.[1];
    calls.push({ path: url.pathname, ...(method === undefined ? {} : { method }), body });
    if (method === undefined)
      return new Response("<html>fixture</html>", {
        headers: { "set-cookie": "SessionID=owned-info-fixture" },
      });
    if (method === "CallMethod" && options.rpcResponse) return options.rpcResponse();
    const content =
      method === "OpenSession"
        ? "<SessionID>42</SessionID>"
        : method === "CallMethod"
          ? `<ResultData><Result VALUE-TYPE="Object">${fields}</Result></ResultData>`
          : "";
    return new Response(
      `<soap:Envelope xmlns:soap="${profile === "native" ? nativeNamespace : webNamespace}"><soap:Body><${method}Response xmlns="${profile === "native" ? "http://www.datex-soft.com/" : "http://www.datex-soft.com/soap/"}">${content}</${method}Response></soap:Body></soap:Envelope>`,
      {
        headers: {
          "content-type": "application/soap+xml",
          "set-cookie": "SessionID=owned-info-fixture",
        },
      },
    );
  };
  const runtime = new HcmRuntime({
    name: "readonly-info",
    baseUrl: "http://server-info-fixture.invalid/",
    username: "fixture",
    password: "synthetic-secret",
    timeoutMs: 1000,
    maxResponseBytes: 1024 * 1024,
    outputLimitBytes: options.outputLimitBytes ?? 65536,
    runtimeDir: options.runtimeDir ?? ".runtime",
    permissions: { write: false, execute: false },
    fetch,
  });
  return { calls, runtime };
}

for (const profile of ["native", "web"] as const)
  test(`server.info ${profile} uses one fixed no-argument RPC under read-only policy and exact owned teardown`, async () => {
    const { runtime, calls } = fixture(profile);
    try {
      const before = await runtime.call("rpc.call", {
        library: "ms_tools",
        method: "get_admin_init_server_data",
      });
      assert.equal(before.error?.code, "EXECUTE_DISABLED");
      assert.equal(calls.length, 0, "generic RPC does not inherit this adapter's read policy");
      assert.equal(runtime.describe("server.info").effect, "read");
      assert.deepEqual(runtime.describe("server.info").inputSchema.properties, {
        profile: { type: "string", enum: ["native", "web"] },
      });
      const sdk = HcmClient.fromRuntime(runtime);
      const data = unwrap(await sdk.serverInfo(profile === "native" ? {} : { profile }));
      assert.equal(data.profile, profile);
      assert.equal(data.capabilityMask, "0x10001");
      assert.deepEqual(data.catalogLimits, []);
      const call = calls.find((value) => value.method === "CallMethod");
      assert.ok(call);
      assert.equal(call.path, "/api/spxml/CallMethod");
      assert.equal(
        call.body,
        '<?xml version="1.0" encoding="utf-8"?>' +
          `<soap:Envelope xmlns:soap="${profile === "native" ? "http://www.w3.org/2003/05/soap-envelope/" : "http://schemas.xmlsoap.org/soap/envelope/"}"><soap:Body><CallMethod xmlns="${profile === "native" ? "http://www.datex-soft.com/" : "http://www.datex-soft.com/soap/"}"><LibName>ms_tools</LibName><MethodName>get_admin_init_server_data</MethodName><ArgData></ArgData></CallMethod></soap:Body></soap:Envelope>`,
      );
      assert.equal(calls.filter((value) => value.method === "CallMethod").length, 1);
      const wireCount = calls.length;
      assert.equal(
        (
          await runtime.call("native.rpc.call", {
            target: "ms_tools.get_admin_init_server_data",
            args: [],
          })
        ).error?.code,
        "EXECUTE_DISABLED",
      );
      assert.equal(calls.length, wireCount, "low-level arbitrary RPC also remains execute-gated");
    } finally {
      await runtime.close();
    }
    assert.deepEqual(
      calls.map((value) => value.method ?? value.path),
      profile === "native"
        ? [
            "OpenSession",
            "CallMethod",
            "/api/spxml2/get_app_info",
            "CloseSession",
            "/loggedoff.html",
          ]
        : [
            "/spxml_web/main.htm",
            "OpenSession",
            "CallMethod",
            "CloseSession",
            "/spxml_web/logout.htm",
            "/spxml_web/logout2.htm",
          ],
    );
    assert.ok(!calls.some((value) => /PutDoc|Eval|CreateDoc|PutUrl/.test(value.body)));
  });

test("invalid inputs never bootstrap and unexpected valid RPC content becomes a safe semantic error", async () => {
  const invalid = fixture("native");
  try {
    for (const args of [
      { profile: "other" },
      { profile: 1 },
      { target: "tools.get_version" },
      { arguments: [] },
    ])
      assert.equal((await invalid.runtime.call("server.info", args)).ok, false);
    assert.equal(invalid.calls.length, 0);
  } finally {
    await invalid.runtime.close();
  }
  const unexpected = fixture(
    "native",
    metadataFields() + '<PRIVATE_FIELD VALUE-TYPE="string">PRIVATE_SECRET</PRIVATE_FIELD>',
  );
  try {
    const result = await unexpected.runtime.call("server.info");
    assert.equal(result.error?.code, "SERVER_INFO_RESPONSE");
    assert.equal(result.error?.mutationOutcome, undefined);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_SECRET|PRIVATE_FIELD/);
    assert.equal(unexpected.calls.filter((value) => value.method === "CallMethod").length, 1);
  } finally {
    await unexpected.runtime.close();
  }
});

test("server authorization and SOAP faults retain their upstream categories rather than becoming metadata shape errors", async () => {
  for (const variant of ["auth", "permission", "soap"] as const) {
    const { calls, runtime } = fixture("native", undefined, {
      rpcResponse: () =>
        variant === "soap"
          ? new Response(
              '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope/"><soap:Body><soap:Fault><soap:Reason><soap:Text>PRIVATE_SECRET</soap:Text></soap:Reason></soap:Fault></soap:Body></soap:Envelope>',
              { status: 500, headers: { "content-type": "application/soap+xml" } },
            )
          : new Response("PRIVATE_SECRET", { status: variant === "auth" ? 401 : 403 }),
    });
    try {
      const result = await runtime.call("server.info");
      assert.equal(result.ok, false);
      assert.equal(
        result.error?.code,
        variant === "soap"
          ? "PLATFORM_SOAP-FAULT"
          : variant === "auth"
            ? "PLATFORM_AUTH"
            : "PLATFORM_PERMISSION",
      );
      assert.doesNotMatch(JSON.stringify(result), /PRIVATE_SECRET/);
      assert.equal(calls.filter((value) => value.method === "CallMethod").length, 1);
    } finally {
      await runtime.close();
    }
    assert.deepEqual(
      calls.map((value) => value.method ?? value.path),
      ["OpenSession", "CallMethod", "CloseSession", "/loggedoff.html"],
    );
  }
});

test("large metadata retains exact integers through the shared stored-result continuation without another server call", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hcm-server-info-"));
  const limits = Array.from(
    { length: 200 },
    (_, index) =>
      `<catalog><name>type_${index}</name><max_records_num>0x7FFFFFFFFFFFFFFF</max_records_num></catalog>`,
  ).join("");
  const { runtime, calls } = fixture(
    "native",
    metadataFields({ limits: `<catalogs>${limits}</catalogs>`, capability: "9223372036854775807" }),
    { outputLimitBytes: 1024, runtimeDir: directory },
  );
  try {
    const sdk = HcmClient.fromRuntime(runtime);
    const result = await sdk.serverInfo();
    assert.equal(result.ok, true);
    assert.equal(result.meta.truncated, true);
    assert.ok(result.meta.resultId);
    assert.throws(
      () => unwrap(result),
      (error: unknown) =>
        error instanceof HcmStoredResultError && error.resultId === result.meta.resultId,
    );
    let offset = 0;
    let text = "";
    for (let page = 0; page < 100; page++) {
      const part = unwrap(
        await sdk.readResult({ resultId: result.meta.resultId, offset, format: "json" }),
      );
      assert.ok("text" in part && part.format === "json");
      text += part.text;
      if (part.nextOffset === undefined) break;
      assert.ok(part.nextOffset > offset);
      offset = part.nextOffset;
      assert.ok(page < 99, "bounded paging must finish");
    }
    const restored = JSON.parse(text) as ReturnType<typeof parseServerInfo>;
    assert.equal(restored.capabilityMask, "9223372036854775807");
    assert.equal(restored.catalogLimits.length, 200);
    assert.ok(
      restored.catalogLimits.every((value) => value.maxRecordsNum === "0x7FFFFFFFFFFFFFFF"),
    );
    assert.equal(calls.filter((value) => value.method === "CallMethod").length, 1);
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});
