import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNativeLdsApi, createWebLdsApi } from "../src/protocol/api.js";
import { HttpTransport } from "../src/protocol/transport.js";
import { rawXml, findXmlNode, parseXml } from "../src/protocol/xml.js";
import { getNativeOperations } from "../src/native/index.js";
import { HcmRuntime } from "../src/runtime.js";
import { HcmClient } from "../src/sdk.js";
import { HcmMcpTools } from "../src/mcp/server.js";
import { runCli } from "../src/cli/run.js";
import type { ConnectionConfig, OperationResult } from "../src/contracts.js";
import type { CliIo } from "../src/cli/types.js";
import { mcpJson } from "./mcp-json.js";

const children =
  '<sTypeParam VALUE-TYPE="string">wtv &amp; exact 😀</sTypeParam>' +
  '<bDateFlag VALUE-TYPE="bool">0</bDateFlag>';
const args = { libName: "tools", methodName: "get_version", runAsync: false, argData: children };
const resultXml =
  '<ResultData><Result VALUE-TYPE="string">1171 &amp; exact 😀</Result></ResultData>';
function soap(method: string, inner = "") {
  // Штатный сервис может ответить SOAP 1.2 на запрос SOAP 1.1.
  return new Response(
    `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope/"><soap:Body><${method}Response>${inner}</${method}Response></soap:Body></soap:Envelope>`,
    { headers: { "content-type": "application/soap+xml" } },
  );
}

test("LDS в профилях native и web принимают одинаковые упорядоченные встроенные аргументы и сохраняют неотслеживаемые подтверждения undefined", async () => {
  for (const profile of ["native", "web"] as const) {
    let calls = 0;
    const transport = new HttpTransport({
      baseUrl: "http://fixture.invalid/mount/",
      timeoutMs: 1000,
      maxResponseBytes: 65536,
      fetch: async (input, init = {}) => {
        calls++;
        assert.equal(new URL(String(input)).pathname, "/mount/services/LdsService");
        assert.equal(init.method, "POST");
        assert.match(new Headers(init.headers).get("content-type")!, /^application\/soap\+xml/);
        const body = String(init.body);
        assert.match(
          body,
          profile === "native"
            ? /xmlns:soap="http:\/\/www\.w3\.org\/2003\/05\/soap-envelope\/"/
            : /xmlns:soap="http:\/\/schemas\.xmlsoap\.org\/soap\/envelope\/"/,
        );
        const node = findXmlNode(parseXml(body), "RunMethod") as Record<string, unknown>;
        const withFlags = calls !== 1;
        assert.deepEqual(
          Object.keys(node).filter((key) => !key.startsWith("@_")),
          [
            "LibName",
            "MethodName",
            ...(withFlags ? ["RunAsync", "ErrorLogName"] : []),
            "SessionID",
            "ArgData",
          ],
        );
        assert.equal(node.SessionID, profile === "native" ? "42" : "52");
        assert.ok(
          body.endsWith(`<ArgData>${children}</ArgData></RunMethod></soap:Body></soap:Envelope>`),
        );
        assert.doesNotMatch(body, /xop:Include|mime:|cid:/);
        if (withFlags) {
          assert.equal(node.RunAsync, calls === 2 ? "false" : "true");
          assert.equal(node.ErrorLogName, "diagnostic & exact");
        }
        return soap("RunMethod", '<ResultData><Result VALUE-TYPE="undefined"/></ResultData>');
      },
    });
    const api =
      profile === "native"
        ? createNativeLdsApi(transport, () => "42")
        : createWebLdsApi(transport, () => "52");
    try {
      for (const flag of [undefined, false, true]) {
        const response = await api.runMethod({
          libName: "tools",
          methodName: "get_version",
          argData: rawXml(children),
          ...(flag === undefined ? {} : { runAsync: flag, errorLogName: "diagnostic & exact" }),
        });
        const value = findXmlNode(response.data, "Result") as Record<string, unknown>;
        assert.equal(value["@_VALUE-TYPE"], "undefined");
        assert.doesNotMatch(
          JSON.stringify(response.data),
          /TrackingID|trackingId|IsRunning|completed/,
        );
      }
      assert.throws(
        () => api.runMethod({ ...args, argData: children as never }),
        /argData: нужен проверенный XML/,
      );
      assert.equal(calls, 3, "Unbranded XML must not reach transport or task APIs");
    } finally {
      transport.dispose();
    }
  }
});

function fixture(directory: string, execute = true, fault = false) {
  const requests: string[] = [];
  const config: ConnectionConfig = {
    name: "run-method-fixture",
    baseUrl: "http://fixture.invalid/mount/",
    username: "fixture-admin",
    password: "fixture-password",
    timeoutMs: 1000,
    maxResponseBytes: 65536,
    outputLimitBytes: 16384,
    runtimeDir: directory,
    permissions: { write: false, execute },
    fetch: async (input, init = {}) => {
      const path = new URL(String(input)).pathname;
      const body = String(init.body ?? "");
      const method = /<soap:Body><(\w+)/.exec(body)?.[1];
      requests.push(method ?? path);
      if (path === "/mount/spxml_web/main.htm")
        return new Response("", { headers: { "set-cookie": "SessionID=web-owned; Path=/" } });
      assert.equal(new Headers(init.headers).get("cookie"), "SessionID=web-owned");
      if (method === "OpenSession") return soap(method, "<SessionID>52</SessionID>");
      if (method === "RunMethod") {
        assert.equal(path, "/mount/services/LdsService");
        assert.match(body, /xmlns:soap="http:\/\/schemas\.xmlsoap\.org\/soap\/envelope\/"/);
        assert.match(body, /<RunMethod xmlns="http:\/\/www\.datex-soft\.com\/soap\/">/);
        assert.ok(body.includes(`<SessionID>52</SessionID><ArgData>${children}</ArgData>`));
        assert.doesNotMatch(body, /xop:Include/);
        if (fault)
          return new Response(
            '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope/"><soap:Body><soap:Fault><soap:Code><soap:Value>soap:Receiver</soap:Value></soap:Code><soap:Reason><soap:Text xml:lang="en">fixture rejection</soap:Text></soap:Reason></soap:Fault></soap:Body></soap:Envelope>',
            { status: 500, headers: { "content-type": "application/soap+xml" } },
          );
        return soap(method, resultXml);
      }
      if (method === "CloseSession") {
        assert.ok(body.includes("<SessionID>52</SessionID>"));
        return soap(method);
      }
      if (path === "/mount/spxml_web/logout.htm")
        return new Response(null, {
          status: 302,
          headers: { location: "/mount/spxml_web/logout2.htm" },
        });
      if (path === "/mount/spxml_web/logout2.htm") return new Response("");
      assert.fail(`Unexpected request: ${path}`);
    },
  };
  return { config, requests };
}

async function cli(runtime: HcmRuntime, config: ConnectionConfig, input: unknown) {
  let stdout = "";
  let stderr = "";
  const unused = async (): Promise<never> => {
    throw new Error("Unexpected local I/O");
  };
  const io: CliIo = {
    writeOut: (text) => {
      stdout += text;
    },
    writeError: (text) => {
      stderr += text;
    },
    readStdin: async () => JSON.stringify(input),
    readFile: unused,
    writeFile: unused,
  };
  const code = await runCli(["api", "call", "web.lds.runMethod", "--stdin"], io, {
    loadConfiguration: () => config,
    createRuntime: () => runtime,
    runMcp: unused,
  });
  assert.equal(code, 0, stderr);
  return JSON.parse(stdout) as OperationResult;
}

test("RunMethod в web LDS сохраняет точный типизированный результат и собственную очистку через SDK, CLI и MCP", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hcm-web-run-method-"));
  try {
    const operation = getNativeOperations().find((item) => item.id === "web.lds.runMethod")!;
    assert.equal(operation.effect, "execute");
    for (const frontend of ["sdk", "cli", "mcp"]) {
      const f = fixture(directory);
      const runtime = new HcmRuntime(f.config);
      try {
        const input = { ...args, argData: frontend === "sdk" ? children : { xml: children } };
        const response =
          frontend === "sdk"
            ? await new HcmClient(runtime).call("web.lds.runMethod", input)
            : frontend === "cli"
              ? await cli(runtime, f.config, input)
              : mcpJson(
                  await new HcmMcpTools(runtime).invoke("hcm_api_execute", {
                    operationId: "web.lds.runMethod",
                    args: input,
                  }),
                );
        assert.equal(response.ok, true, JSON.stringify(response));
        const node = findXmlNode(response.data, "Result") as Record<string, unknown>;
        assert.deepEqual(node, { "#text": "1171 & exact 😀", "@_VALUE-TYPE": "string" });
        assert.doesNotMatch(
          JSON.stringify(response),
          /fixture-password|web-owned|SessionID|TrackingID/,
        );
      } finally {
        await runtime.close();
      }
      assert.deepEqual(f.requests, [
        "/mount/spxml_web/main.htm",
        "OpenSession",
        "RunMethod",
        "CloseSession",
        "/mount/spxml_web/logout.htm",
        "/mount/spxml_web/logout2.htm",
      ]);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("RunMethod в профиле web отклоняет отсутствие права execute, неверный встроенный XML и ID сессии от вызывающего до bootstrap", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hcm-web-run-method-policy-"));
  try {
    for (const execute of [false, true]) {
      const f = fixture(directory, execute);
      const runtime = new HcmRuntime(f.config);
      try {
        if (!execute) {
          const denied = await runtime.call("web.lds.runMethod", args);
          assert.equal(denied.ok, false);
          assert.equal(denied.error?.code, "EXECUTE_DISABLED");
          assert.equal(denied.error?.mutationOutcome, "not_sent");
        } else {
          for (const input of [
            { ...args, argData: { base64: "YQ==" } },
            { ...args, argData: "<arg><unclosed></arg>" },
            { ...args, sessionId: "other-owned-id" },
          ]) {
            const rejected = await runtime.call("web.lds.runMethod", input);
            assert.equal(rejected.ok, false);
            assert.equal(rejected.error?.mutationOutcome, "not_sent");
          }
        }
        const mismatch = await new HcmMcpTools(runtime).invoke("hcm_api_read", {
          operationId: "web.lds.runMethod",
          args,
        });
        assert.equal(mcpJson(mismatch).error?.code, "mcp.effect_mismatch");
      } finally {
        await runtime.close();
      }
      assert.deepEqual(f.requests, []);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("SOAP fault при RunMethod в web сохраняет основную ошибку и закрывает только собственный контекст без повтора", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hcm-web-run-method-fault-"));
  const f = fixture(directory, true, true);
  const client = new HcmClient(f.config);
  try {
    const response = await client.call("web.lds.runMethod", args);
    assert.equal(response.ok, false);
    assert.equal(response.error?.code, "PLATFORM_SOAP-FAULT");
    assert.equal(response.error?.mutationOutcome, "indeterminate");
    assert.equal(response.error?.retryable, false);
    await client.close();
    assert.deepEqual(f.requests, [
      "/mount/spxml_web/main.htm",
      "OpenSession",
      "RunMethod",
      "CloseSession",
      "/mount/spxml_web/logout.htm",
      "/mount/spxml_web/logout2.htm",
    ]);
  } finally {
    await client.close();
    await rm(directory, { recursive: true, force: true });
  }
});
