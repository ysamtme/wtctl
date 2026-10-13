import assert from "node:assert/strict";
import test from "node:test";
import { HcmError } from "../src/errors.js";
import { findXmlNode, parseXml } from "../src/protocol/xml.js";
import type { OperationResult } from "../src/contracts.js";
import { fakeRuntime, type Script } from "./fake-server.js";

const budget = 1024;
function fixture(name: string, script: Script, execute = false) {
  let networkRequests = 0;
  const { runtime, server } = fakeRuntime(script, {
    name,
    maxResponseBytes: 65536,
    outputLimitBytes: budget,
    username: "fixture",
    password: "inline",
    permissions: { write: false, execute },
    fetch: async () => {
      networkRequests++;
      throw new Error("This local failure fixture must not make HTTP requests");
    },
  });
  return { runtime, server, networkRequests: () => networkRequests };
}
function assertOmitted(result: OperationResult): void {
  assert.equal(result.ok, false);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= budget, "the whole envelope is bounded");
  assert.equal(result.meta.connection, "[omitted]");
  assert.equal(result.meta.connectionOmitted, true);
  assert.equal(
    result.meta.truncated,
    undefined,
    "errors are not represented as stored success data",
  );
}

test("all ordinary error envelopes explicitly omit an oversized connection without changing diagnostics", async () => {
  for (const operation of ["server.info", "missing.operation", "rpc.call"] as const) {
    let ordinary: OperationResult | undefined;
    const script: Script = {
      "native.rpc.call": (args) => {
        assert.deepEqual(args, { target: "ms_tools.get_admin_init_server_data", args: [] });
        return { xml: { ResultData: { Result: { "@_VALUE-TYPE": "Object" } } } };
      },
    };
    for (const name of ["ordinary label Рус😀", "n".repeat(800), "😀".repeat(300)]) {
      const f = fixture(name, script);
      try {
        const result = await f.runtime.call(
          operation,
          operation === "rpc.call" ? { library: "tools", method: "get_version" } : {},
        );
        assert.equal(
          result.error?.code,
          operation === "server.info"
            ? "SERVER_INFO_RESPONSE"
            : operation === "rpc.call"
              ? "EXECUTE_DISABLED"
              : "UNKNOWN_OPERATION",
        );
        assert.equal(result.meta.operationId, operation);
        assert.equal(
          result.error?.mutationOutcome,
          operation === "rpc.call" ? "not_sent" : undefined,
        );
        assert.equal(f.server.calls.length, operation === "server.info" ? 1 : 0);
        assert.equal(f.networkRequests(), 0);
        if (name === "ordinary label Рус😀") {
          ordinary = result;
          assert.equal(result.meta.connection, name);
          assert.equal(result.meta.connectionOmitted, undefined);
          assert.ok(Buffer.byteLength(JSON.stringify(result)) <= budget);
        } else {
          assertOmitted(result);
          assert.deepEqual(
            result.error,
            ordinary?.error,
            "classification, hint and details are preserved",
          );
        }
      } finally {
        await f.runtime.close();
      }
    }
  }
});

test("common connection omission preserves the exact generated execution recovery receipt and mutation outcome", async () => {
  let expectedExecutionId: unknown;
  const f = fixture(
    "n".repeat(800),
    {
      "web.rpc.call": (args) => {
        assert.equal(args.target, "ms_tools.evaluate_remote_collection_obj");
        const argument = (args.args as { lexicalValue: { xml: string } }[])[0]!;
        expectedExecutionId = findXmlNode(parseXml(argument.lexicalValue.xml), "code");
        throw new HcmError(
          "SYNTHETIC_SCRIPT_FAILURE",
          "The synthetic script failed.",
          "Inspect the saved execution receipt.",
          { diagnostic: "ordinary diagnostic", executionId: "untrusted-inline" },
        );
      },
    },
    true,
  );
  try {
    const result = await f.runtime.call("execute.script", { code: "RESULT=[];" });
    assertOmitted(result);
    assert.equal(result.error?.code, "SYNTHETIC_SCRIPT_FAILURE");
    assert.equal(result.error?.mutationOutcome, "indeterminate");
    assert.equal(result.error?.details?.executionId, expectedExecutionId);
    assert.match(expectedExecutionId as string, /^hcm_inline_[a-f0-9]{32}$/);
    assert.equal(result.error?.details?.diagnostic, "ordinary diagnostic");
    assert.equal(f.server.calls.length, 1);
    assert.equal(f.networkRequests(), 0);
  } finally {
    await f.runtime.close();
  }
});
