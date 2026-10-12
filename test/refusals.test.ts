// A call that cannot work is named for what it is: before anything is written where the client
// can tell, and from the server's own lists where only the server's bare HTTP 500 is left.
import assert from "node:assert/strict";
import { test } from "node:test";
import { HcmRuntime } from "../src/runtime.js";
import { WsHcmApiError } from "../src/protocol/error.js";
import { WebPageApi } from "../src/protocol/api.js";
import { errorInFrontendTerms } from "../src/frontend-names.js";
import type { HttpTransport } from "../src/protocol/transport.js";

function fixture(execute = true) {
  const runtime = new HcmRuntime({
    name: "t",
    baseUrl: "http://fixture.invalid/",
    timeoutMs: 1000,
    maxResponseBytes: 1024 * 1024,
    outputLimitBytes: 65536,
    runtimeDir: ".unused",
    permissions: { write: true, execute },
  });
  runtime.gateway.close = async () => undefined;
  return runtime;
}
const refusal = (operation: string) =>
  new WsHcmApiError("soap-fault", "Internal Server Error", { operation, status: 500 });
const library = `<SPXML-INLINE-FORM><tools>
  <get_version PROPERTY="1" ALLOW-CALL-FROM-CLIENT="1" PARAM="kind" EXPR="return kind;"/>
  <server_side PROPERTY="1" PARAM="id" EXPR="return id;"/>
</tools></SPXML-INLINE-FORM>`;

test("an object of a type the server does not have is refused before anything is written", async () => {
  const runtime = fixture();
  const calls: string[] = [];
  runtime.gateway.call = async (id, args = {}) => {
    calls.push(id);
    if (id === "native.spxml2.getAppInfo")
      return {
        default_db_name: "sample",
        shared_docs: [{ id: "common", url: "x-local://wtv/common.xml" }],
        databases: [
          {
            id: "sample",
            catalogs: [
              { id: "groups", object_type: "group" },
              // The server leaves this catalog without the type of its objects.
              { id: "events", object_type: "", form_url: "x-local://wtv/wtv_events.xmd" },
            ],
          },
        ],
      };
    if (id === "native.spxml2.getForm" && declared && args.url === "x-local://wtv/common.xml")
      return `<common><exchange_object_types>
        <exchange_object_type><name>event</name></exchange_object_type>
      </exchange_object_types></common>`;
    throw refusal(id);
  };
  let declared = true;
  const create = (type: string) => runtime.call("objects.create", { type, data: { name: "x" } });
  try {
    // The catalog name has a form of its own, so the form alone would not stop the write.
    const catalog = await create("groups");
    assert.equal(catalog.error?.code, "UNKNOWN_TYPE");
    assert.match(catalog.error!.hint!, /Похожие: group\./);
    assert.equal(catalog.error?.mutationOutcome, "not_sent");
    assert.match((await create("events")).error!.hint!, /Похожие: event\./);
    assert.equal((await create("no_such")).error?.code, "UNKNOWN_TYPE");
    assert.equal(calls.filter((id) => /putDoc|getNewObjectId/.test(id)).length, 0);
    // A type the server declares without naming its catalog is a type: the refusal that follows
    // is the fixture's missing form, not the check.
    assert.equal((await create("event")).error?.code, "PLATFORM_SOAP-FAULT");
    // Without the server's declaration only a catalog name can be told from a type.
    declared = false;
    const fresh = fixture();
    fresh.gateway.call = runtime.gateway.call;
    try {
      assert.equal(
        (await fresh.call("objects.create", { type: "no_such", data: { name: "x" } })).error?.code,
        "PLATFORM_SOAP-FAULT",
      );
      assert.equal(
        (await fresh.call("objects.create", { type: "groups", data: { name: "x" } })).error?.code,
        "UNKNOWN_TYPE",
      );
    } finally {
      await fresh.close();
    }
    const empty = await runtime.call("objects.create", { type: "group", data: {} });
    assert.equal(empty.error?.code, "INVALID_ARGUMENT");
    assert.match(empty.error!.message, /^data: нет ни одного поля/);
    assert.equal(empty.error?.mutationOutcome, "not_sent");
  } finally {
    await runtime.close();
  }
});

test("a refused library call is explained from the server's list of functions", async () => {
  const runtime = fixture();
  let known = true;
  runtime.gateway.call = async (id, args = {}) => {
    if (id === "native.spxml2.getAppInfo") {
      if (!known) throw refusal(id);
      return {
        default_db_name: "sample",
        shared_docs: [{ id: "tools", url: "x-local://l/t.xml" }],
      };
    }
    if (id === "native.lds.loadUrl") return { Data: Buffer.from(library).toString("base64") };
    assert.match(id, /^(native\.rpc\.call|web\.spxml\.callMethodAsync)$/);
    assert.match(String(args.target), /^tools\./);
    throw refusal(id);
  };
  try {
    const call = (method: string, extra = {}) =>
      runtime.call("rpc.call", { library: "tools", method, arguments: [], ...extra });
    const misspelt = await call("get_versio");
    assert.equal(misspelt.error?.code, "UNKNOWN_RPC_TARGET");
    assert.match(misspelt.error!.hint!, /^Похожие: get_version\./);
    // The server ran nothing: there is no write to look for.
    assert.equal(misspelt.error?.mutationOutcome, "not_sent");
    assert.equal((await call("get_versio", { async: true })).error?.code, "UNKNOWN_RPC_TARGET");
    const closed = await call("server_side");
    assert.equal(closed.error?.code, "RPC_SERVER_ONLY");
    assert.equal(closed.error?.mutationOutcome, "not_sent");
    assert.match(closed.error!.hint!, /execute\.script.*tools\.server_side\(/);
    // The function exists and may be called: the refusal came from inside it and stays as it is.
    const inside = await call("get_version");
    assert.equal(inside.error?.code, "PLATFORM_SOAP-FAULT");
    assert.equal(inside.error?.mutationOutcome, "indeterminate");
  } finally {
    await runtime.close();
  }
  // Without the server's list there is nothing to judge by.
  const blind = fixture();
  known = false;
  blind.gateway.call = runtime.gateway.call;
  try {
    const result = await blind.call("rpc.call", { library: "tools", method: "nope" });
    assert.equal(result.error?.code, "PLATFORM_SOAP-FAULT");
  } finally {
    await blind.close();
  }
});

test("a malformed function argument is named by its place in arguments", async () => {
  const runtime = fixture();
  runtime.gateway.call = async () => {
    throw new Error("nothing may be sent");
  };
  try {
    const object = await runtime.call("rpc.call", {
      library: "tools",
      method: "get_version",
      arguments: ["wtv", { a: 1 }],
    });
    assert.equal(object.error?.code, "INVALID_RPC_ARGUMENT");
    assert.match(object.error!.message, /^arguments\[1\]: /);
    assert.equal(object.error?.mutationOutcome, "not_sent");
    const real = await runtime.call("rpc.call", {
      library: "tools",
      method: "get_version",
      arguments: [1.5],
    });
    assert.equal(real.error?.code, "INVALID_RPC_ARGUMENT");
  } finally {
    await runtime.close();
  }
});

test("copying a file sends the page token of the web session; without one nothing is sent", async () => {
  const sent: string[] = [];
  const transport = {
    send: async (path: string) => {
      sent.push(path);
      return new Response("", { status: 200 });
    },
  } as unknown as HttpTransport;
  await new WebPageApi(transport, () => "token-1").copyUrl({
    srcUrl: "x-local://wt/a.txt",
    destUrl: "x-local://wt/b.txt",
  });
  assert.equal(sent.length, 1);
  const url = new URL(sent[0]!, "http://fixture.invalid");
  assert.equal(url.pathname, "/spxml_web/service/copy_url.htm");
  assert.equal(url.searchParams.get("session_token"), "token-1");
  assert.equal(url.searchParams.get("src_url"), "x-local://wt/a.txt");
  assert.equal(url.searchParams.get("dest_url"), "x-local://wt/b.txt");
  await assert.rejects(
    new WebPageApi(transport, () => undefined).copyUrl({
      srcUrl: "x-local://a",
      destUrl: "x-local://b",
    }),
    (error: unknown) => error instanceof WsHcmApiError && error.requestSent === false,
  );
  assert.equal(sent.length, 1);
});

test("a failed step inside a batch and the operation lists are named in the caller's terms", () => {
  const meta = (operationId: string) => ({ operationId, connection: "t", durationMs: 0 });
  const step = {
    ok: false,
    error: { code: "X", message: "m", hint: "Строки показывает logs.follow.", retryable: false },
    meta: meta("objects.get"),
  };
  const batch = {
    ok: false,
    error: {
      code: "BATCH_FAILED",
      message: "m",
      hint: "Исходы шагов — в data.results.",
      retryable: false,
    },
    data: { results: [{ ok: true, data: {}, meta: meta("runtime.status") }, step], completed: 2 },
    meta: meta("runtime.batch"),
  };
  const mcp = errorInFrontendTerms(batch, "mcp").data as {
    results: (typeof step)[];
    completed: number;
  };
  assert.equal(mcp.results[1]!.error.hint, "Строки показывает hcm_log_follow.");
  assert.equal(mcp.completed, 2);
  const cli = errorInFrontendTerms(batch, "cli").data as { results: (typeof step)[] };
  assert.equal(cli.results[1]!.error.hint, "Строки показывает wtctl logs follow.");
  const described = errorInFrontendTerms(
    {
      ok: false,
      error: {
        code: "INVALID_ARGUMENT",
        message: "m",
        hint: "Аргументы операции описывает api.describe.",
        retryable: false,
      },
      meta: meta("files.read"),
    },
    "mcp",
  );
  assert.equal(described.error?.hint, "Аргументы операции описывает hcm_api_describe.");
});
