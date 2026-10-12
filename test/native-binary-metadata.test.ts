import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HcmRuntime } from "../src/runtime.js";
import { HcmClient, unwrap } from "../src/sdk.js";
import { runCli } from "../src/cli/run.js";
import type { CliIo } from "../src/cli/types.js";
import { HcmMcpTools } from "../src/mcp/server.js";
import type { ConnectionConfig, OperationResult } from "../src/contracts.js";
import { mcpJson } from "./mcp-json.js";

const records = {
  Result: "ok",
  AlreadyLocked: "1",
  Locker: "Коллега 😀: owner & <tag>",
  UserDocUrl: "x-local://wt_data/objects/9007199254740993/00.xml",
  LosslessId: "9223372036854775807",
  "Future.Record/Case-1": "quoted 'value' + % / :",
  EmptyValue: "",
  // An unknown framed identity is data, never a replacement for the owned context.
  SessionID: "0",
};
interface BinaryData {
  kind: "binary";
  records?: Record<string, string>;
  bytes: { base64: string; bytes: number };
  contentType: string;
}
function fixture(directory: string, payload: Uint8Array, outputLimitBytes = 16_384) {
  const frames: string[] = [];
  const config: ConnectionConfig = {
    name: "binary-metadata",
    baseUrl: "http://fixture.invalid/mount/",
    username: "fixture-admin",
    password: "private-fixture-password",
    installationId: "AABBCCDDEEFF0011",
    runtimeDir: directory,
    timeoutMs: 1000,
    maxResponseBytes: 65_536,
    outputLimitBytes,
    permissions: { write: true, execute: true },
    fetch: async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/loggedoff.html")) return new Response("");
      const headers = {
        "content-type": "application/octet-stream",
        "set-cookie": "SessionID=private-fixture-cookie",
        authorization: "private-fixture-http-authorization",
        "x-private-fixture": "private-fixture-http-header",
      };
      if (path.endsWith("/raw-only")) return new Response(Buffer.from(payload), { headers });
      assert.ok(path.endsWith("/xhttp"), "Only the synthetic legacy route is allowed");
      const frame = new TextDecoder().decode(init?.body as Uint8Array);
      frames.push(frame);
      if (frame.startsWith("Action: GetUrl\r\n")) {
        const prefix = Object.entries(records)
          .map(([key, value]) => `${key}: ${value}\r\n`)
          .join("");
        return new Response(Buffer.concat([Buffer.from(prefix + "\r\n"), Buffer.from(payload)]), {
          headers,
        });
      }
      assert.match(frame, /^Action: (?:Idle|QuitSession)\r\n/);
      return new Response("Result: ok\r\n\r\n", { headers });
    },
  };
  return { config, frames };
}
async function cli(runtime: HcmRuntime, config: ConnectionConfig, args: string[], input = "{}") {
  let stdout = "";
  let stderr = "";
  const unused = async (): Promise<never> => {
    throw new Error("Unexpected fixture file operation");
  };
  const io: CliIo = {
    writeOut: (text) => {
      stdout += text;
    },
    writeError: (text) => {
      stderr += text;
    },
    readStdin: async () => input,
    readFile: unused,
    writeFile: unused,
  };
  const code = await runCli(args, io, {
    loadConfiguration: () => config,
    createRuntime: () => runtime,
    runMcp: unused,
  });
  assert.equal(code, 0, stderr);
  assert.equal(stderr, "");
  return JSON.parse(stdout) as OperationResult;
}
async function mcp(runtime: HcmRuntime, name: string, args: unknown): Promise<OperationResult> {
  const result = await new HcmMcpTools(runtime).invoke(name, args);
  const structured = mcpJson(result);
  assert.equal(result.isError, undefined);
  assert.deepEqual(JSON.parse((result.content[0] as { text: string }).text), structured);
  return structured;
}
function assertBinary(data: unknown, payload: Uint8Array, framed = true) {
  const value = data as BinaryData;
  assert.equal(value.kind, "binary");
  assert.equal(value.contentType, "application/octet-stream");
  assert.deepEqual(value.bytes, {
    base64: Buffer.from(payload).toString("base64"),
    bytes: payload.length,
  });
  if (framed) assert.deepEqual(value.records, records);
  else
    assert.ok(!Object.hasOwn(value, "records"), "Plain binary must not acquire fabricated records");
  assert.doesNotMatch(JSON.stringify(value), /private-fixture/);
  assert.ok(!Object.hasOwn(value, "headers"), "Transport HTTP headers are private");
}
function assertOwnedClose(frames: string[]) {
  const opens = frames.filter((frame) => frame.startsWith("Action: Idle\r\n"));
  const closes = frames.filter((frame) => frame.startsWith("Action: QuitSession\r\n"));
  assert.equal(opens.length, 1);
  assert.equal(closes.length, 1);
  const owned = /^SessionID: (\d+)\r$/m.exec(opens[0]!)?.[1];
  assert.ok(owned && BigInt(owned) > 0n);
  assert.equal(/^SessionID: (\d+)\r$/m.exec(closes[0]!)?.[1], owned);
}

test("SDK, CLI and MCP retain exact legacy binary records without exposing HTTP auth or replacing owned identity", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hcm-binary-records-"));
  const payload = new Uint8Array([0, 255, 13, 10, 60, 38, 0, 128]);
  try {
    for (const frontend of ["sdk", "cli", "mcp"]) {
      const mock = fixture(directory, payload);
      const runtime = new HcmRuntime(mock.config);
      const args = { url: "x-local://fixture/owned.bin", lock: true };
      try {
        const result =
          frontend === "sdk"
            ? await HcmClient.fromRuntime(runtime).call("legacy.xhttp.getUrl", args)
            : frontend === "cli"
              ? await cli(
                  runtime,
                  mock.config,
                  ["api", "call", "legacy.xhttp.getUrl", "--stdin"],
                  JSON.stringify(args),
                )
              : await mcp(runtime, "hcm_api_write", { operationId: "legacy.xhttp.getUrl", args });
        assert.equal(result.ok, true, JSON.stringify(result));
        assert.ok(!result.meta.truncated);
        assertBinary(result.data, payload);
      } finally {
        await runtime.close();
      }
      assertOwnedClose(mock.frames);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("stored binary JSON exposes framed records before payload and survives separate CLI/MCP continuation without backend requests", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hcm-binary-stored-records-"));
  const payload = new Uint8Array(4096).map((_, i) => i % 256);
  const mock = fixture(directory, payload, 1024);
  const runtime = new HcmRuntime(mock.config);
  try {
    const client = HcmClient.fromRuntime(runtime);
    const result = await client.call("legacy.xhttp.getUrl", {
      url: "x-local://fixture/owned.bin",
      lock: true,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.meta.truncated, true);
    const id = result.meta.resultId;
    assert.ok(id);
    const first = unwrap(await client.readResult({ resultId: id, format: "json", limit: 512 }));
    assert.ok("text" in first);
    assert.match(first.text!, /"AlreadyLocked":"1"/);
    assert.ok(first.text!.indexOf('"records"') < first.text!.indexOf('"bytes"'));
    const parts = [first.text!];
    let offset = first.nextOffset;
    assert.ok(offset !== undefined);
    await runtime.close();
    assertOwnedClose(mock.frames);
    let backendRequests = 0;
    const readerConfig: ConnectionConfig = {
      ...mock.config,
      permissions: { write: false, execute: false },
      fetch: async () => {
        backendRequests++;
        throw new Error("Artifact reads must remain offline");
      },
    };
    const cliRuntime = new HcmRuntime(readerConfig);
    const second = await cli(cliRuntime, readerConfig, [
      "result",
      "read",
      id,
      "--format",
      "json",
      "--offset",
      String(offset),
      "--limit",
      "512",
    ]);
    assert.equal(second.ok, true);
    const secondPage = second.data as { text: string; nextOffset?: number };
    parts.push(secondPage.text);
    offset = secondPage.nextOffset;
    const mcpRuntime = new HcmRuntime(readerConfig);
    try {
      while (offset !== undefined) {
        const page = await mcp(mcpRuntime, "hcm_result_read", {
          resultId: id,
          format: "json",
          offset,
          limit: 512,
        });
        assert.equal(page.ok, true);
        const data = page.data as { text: string; nextOffset?: number };
        parts.push(data.text);
        assert.ok(data.nextOffset === undefined || data.nextOffset > offset);
        offset = data.nextOffset;
      }
    } finally {
      await mcpRuntime.close();
    }
    assert.equal(backendRequests, 0);
    assertBinary(JSON.parse(parts.join("")), payload);
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("ordinary unframed binary keeps its shape and omits HTTP auth headers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hcm-plain-binary-"));
  const payload = new Uint8Array([0, 128, 255]);
  const mock = fixture(directory, payload);
  const runtime = new HcmRuntime(mock.config);
  try {
    const value = unwrap(
      await HcmClient.fromRuntime(runtime).call("legacy.experimental.rawRequest", {
        unsafe: true,
        path: "/raw-only",
      }),
    );
    assertBinary(value, payload, false);
  } finally {
    await runtime.close();
    assertOwnedClose(mock.frames);
    await rm(directory, { recursive: true, force: true });
  }
});
