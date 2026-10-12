import test from "node:test";
import assert from "node:assert/strict";
import {
  HcmClient,
  HcmCleanupError,
  HcmOperationError,
  HcmStoredResultError,
  getCleanupError,
  unwrap,
  withHcm,
  withHcmClient,
  type HcmResult,
  type HcmSdkRuntime,
  type ObjectData,
} from "../src/sdk.js";
import { HcmError } from "../src/errors.js";
import type { ConnectionConfig, OperationDefinition, OperationResult } from "../src/contracts.js";

const config: ConnectionConfig = {
  name: "synthetic",
  baseUrl: "http://synthetic.invalid/",
  timeoutMs: 1000,
  maxResponseBytes: 65536,
  outputLimitBytes: 4096,
  runtimeDir: ".unused",
  permissions: { write: false, execute: false },
};
const meta = { operationId: "synthetic.operation", connection: "synthetic", durationMs: 1 };
const definition: OperationDefinition = {
  id: "synthetic.operation",
  group: "synthetic",
  title: "Synthetic",
  description: "Synthetic fixture",
  effect: "read",
  status: "implemented",
  inputSchema: { type: "object" },
};
function fixture() {
  const calls: { id: string; args: unknown }[] = [];
  let closes = 0;
  const runtime: HcmSdkRuntime = {
    listOperations: () => ({ operations: [definition], total: 1 }),
    describe: () => definition,
    call: async (id, args = {}) => {
      calls.push({ id, args });
      return { ok: true, data: { fixture: true }, meta: { ...meta, operationId: id } };
    },
    close: async () => {
      closes++;
    },
  };
  return { runtime, client: HcmClient.fromRuntime(runtime), calls, closes: () => closes };
}

const cases: {
  name: string;
  run: (client: HcmClient) => Promise<OperationResult>;
  id: string;
  args: unknown;
}[] = [
  { name: "status", run: (c) => c.status(), id: "runtime.status", args: {} },
  {
    name: "structured query",
    run: (c) =>
      c.query({ catalog: "collaborators", where: { code: "synthetic" }, fields: ["id"], limit: 1 }),
    id: "runtime.query",
    args: { catalog: "collaborators", where: { code: "synthetic" }, fields: ["id"], limit: 1 },
  },
  {
    name: "raw query",
    run: (c) => c.query({ query: "(1)", startPosition: 2 }),
    id: "runtime.query",
    args: { query: "(1)", startPosition: 2 },
  },
  {
    name: "get",
    run: (c) => c.get({ type: "collaborator", id: "9007199254740993", fields: ["id"] }),
    id: "objects.get",
    args: { type: "collaborator", id: "9007199254740993", fields: ["id"] },
  },
  {
    name: "ID-only get",
    run: (c) => c.get({ id: "9007199254740993" }),
    id: "objects.get",
    args: { id: "9007199254740993" },
  },
  {
    name: "create",
    run: (c) =>
      c.create({
        type: "education_mode",
        data: { name: "Synthetic" },
        dbName: "wt_data",
        formUrl: "x-local://wtv/wtv_education_mode.xmd",
      }),
    id: "objects.create",
    args: {
      type: "education_mode",
      data: { name: "Synthetic" },
      dbName: "wt_data",
      formUrl: "x-local://wtv/wtv_education_mode.xmd",
    },
  },
  {
    name: "patch",
    run: (c) =>
      c.patch({
        url: "x-local://wt_data/synthetic.xml",
        patch: [{ op: "set", path: "name", value: "Changed" }],
        expectedFingerprint: "synthetic",
        preview: true,
      }),
    id: "objects.patch",
    args: {
      url: "x-local://wt_data/synthetic.xml",
      patch: [{ op: "set", path: "name", value: "Changed" }],
      expectedFingerprint: "synthetic",
      preview: true,
    },
  },
  {
    name: "delete",
    run: (c) =>
      c.delete({ type: "education_mode", id: "1", permanent: true, catalog: "education_modes" }),
    id: "objects.delete",
    args: { type: "education_mode", id: "1", permanent: true, catalog: "education_modes" },
  },
  {
    name: "schema",
    run: (c) =>
      c.schema({
        type: "education_mode",
        search: "name",
        path: "doc_info",
        origin: ["own"],
        kind: "9007199254740993",
        include: ["methods"],
        language: "english",
        limit: 5,
        cursor: 2,
      }),
    id: "schema.get",
    args: {
      type: "education_mode",
      search: "name",
      path: "doc_info",
      origin: ["own"],
      kind: "9007199254740993",
      include: ["methods"],
      language: "english",
      limit: 5,
      cursor: 2,
    },
  },
  {
    name: "types",
    run: (c) => c.types({ search: "collab", limit: 5, cursor: 2 }),
    id: "schema.types",
    args: { search: "collab", limit: 5, cursor: 2 },
  },
  {
    name: "rpc",
    run: (c) =>
      c.rpc({
        library: "tools",
        method: "synthetic",
        arguments: [{ valueType: "integer", lexicalValue: "9007199254740993" }],
        async: true,
      }),
    id: "rpc.call",
    args: {
      library: "tools",
      method: "synthetic",
      arguments: [{ valueType: "integer", lexicalValue: "9007199254740993" }],
      async: true,
    },
  },
  {
    name: "RPC discovery",
    run: (c) => c.listRpc({ query: "version", library: "tools", builtIn: true, limit: 10 }),
    id: "rpc.list",
    args: { query: "version", library: "tools", builtIn: true, limit: 10 },
  },
  {
    name: "RPC target contract",
    run: (c) => c.describeRpc("tools.get_version", { builtIn: true, source: true }),
    id: "rpc.describe",
    args: { targetId: "tools.get_version", builtIn: true, source: true },
  },
  {
    name: "execute",
    run: (c) => c.execute("RESULT=[{value:42}];"),
    id: "execute.script",
    args: { code: "RESULT=[{value:42}];" },
  },
  {
    name: "runAgent",
    run: (c) => c.runAgent({ id: "0x1", objectId: "0x2" }),
    id: "agents.run",
    args: { id: "0x1", objectId: "0x2" },
  },
  {
    name: "execute with params",
    run: (c) => c.execute("RESULT=[PARAMS.n];", { n: 42 }),
    id: "execute.script",
    args: { code: "RESULT=[PARAMS.n];", params: { n: 42 } },
  },
  {
    name: "batch",
    run: (c) =>
      c.batch({
        steps: [
          { id: "objects.get", args: { type: "collaborator", id: "1" }, as: "person" },
          {
            id: "objects.patch",
            args: { id: { $ref: "person.data.id" }, patch: { name: "Changed" } },
          },
        ],
        stopOnError: true,
      }),
    id: "runtime.batch",
    args: {
      steps: [
        { id: "objects.get", args: { type: "collaborator", id: "1" }, as: "person" },
        {
          id: "objects.patch",
          args: { id: { $ref: "person.data.id" }, patch: { name: "Changed" } },
        },
      ],
      stopOnError: true,
    },
  },
  {
    name: "result export",
    run: (c) => c.exportResult({ resultId: "synthetic-result", path: "out.json" }),
    id: "results.export",
    args: { resultId: "synthetic-result", path: "out.json" },
  },
  {
    name: "result read",
    run: (c) =>
      c.readResult({ resultId: "synthetic-result", offset: 10, limit: 20, format: "json" }),
    id: "results.read",
    args: { resultId: "synthetic-result", offset: 10, limit: 20, format: "json" },
  },
  {
    name: "file upload",
    run: (c) =>
      c.uploadFile({
        filename: "synthetic.bin",
        data: { base64: "AP8=" },
        contentType: "application/octet-stream",
      }),
    id: "web.pages.uploadFile",
    args: {
      filename: "synthetic.bin",
      data: { base64: "AP8=" },
      contentType: "application/octet-stream",
    },
  },
  {
    name: "full generic call",
    run: (c) =>
      c.call("native.lds.loadDoc", {
        url: "x-local://wt_data/synthetic.xml",
        useBinaryResponse: true,
      }),
    id: "native.lds.loadDoc",
    args: { url: "x-local://wt_data/synthetic.xml", useBinaryResponse: true },
  },
  {
    name: "log listing",
    run: (c) =>
      c.listLogs({ type: "xhttp", nameContains: "http", startDate: "2026-09-30", limit: 10 }),
    id: "logs.list",
    args: { type: "xhttp", nameContains: "http", startDate: "2026-09-30", limit: 10 },
  },
  {
    name: "log reading",
    run: (c) => c.readLog({ file: "xhttp_2026-09-30.log", tailBytes: 1024 }),
    id: "logs.read",
    args: { file: "xhttp_2026-09-30.log", tailBytes: 1024 },
  },
  {
    name: "log search",
    run: (c) =>
      c.searchLogs({
        file: "xhttp_2026-09-30.log",
        level: "error",
        expectedFingerprint: "synthetic",
      }),
    id: "logs.search",
    args: { file: "xhttp_2026-09-30.log", level: "error", expectedFingerprint: "synthetic" },
  },
  {
    name: "log following",
    run: (c) => c.followLog({ file: "xhttp_2026-09-30.log", cursor: "opaque" }),
    id: "logs.follow",
    args: { file: "xhttp_2026-09-30.log", cursor: "opaque" },
  },
];
test("typed shortcuts preserve documented operation IDs and wire argument names", async () => {
  for (const entry of cases) {
    const f = fixture();
    const result = await entry.run(f.client);
    assert.deepEqual(f.calls, [{ id: entry.id, args: entry.args }], entry.name);
    assert.equal(result.ok, true, entry.name);
    assert.equal(f.closes(), 0, entry.name);
  }
});

test("discovery and explicit close use the same borrowed runtime", async () => {
  const f = fixture();
  assert.equal(f.client.runtime, f.runtime);
  assert.equal(f.client.describe(definition.id), definition);
  assert.equal(f.client.listOperations().operations[0], definition);
  await f.client.close();
  assert.equal(f.closes(), 1);
  assert.equal(f.calls.length, 0);
});

test("unwrap returns a complete typed value and retains precise mutation and partial outcomes", () => {
  const success: HcmResult<ObjectData<{ id: string; name: string }>> = {
    ok: true,
    data: {
      id: "9007199254740993",
      type: "education_mode",
      url: "x-local://wt_data/synthetic.xml",
      data: { id: "9007199254740993", name: "Synthetic" },
      fingerprint: "synthetic",
    },
    meta,
  };
  const typed: ObjectData<{ id: string; name: string }> = unwrap(success);
  assert.equal(typed.data.id, "9007199254740993");
  const failed: OperationResult = {
    ok: false,
    data: {
      results: [{ ok: true, data: { id: "1", mutationOutcome: "confirmed" } }, { ok: false }],
    },
    error: {
      code: "BATCH_FAILED",
      message: "Partial failure",
      mutationOutcome: "indeterminate",
      details: { mutationId: "synthetic-mutation" },
      hint: "Inspect state.",
    },
    meta,
  };
  assert.throws(
    () => unwrap(failed),
    (error: unknown) => {
      assert.ok(error instanceof HcmOperationError && error instanceof HcmError);
      assert.equal(error.result, failed);
      assert.equal(error.code, "BATCH_FAILED");
      assert.equal(error.mutationOutcome, "indeterminate");
      assert.deepEqual(error.details, { mutationId: "synthetic-mutation" });
      assert.equal(Object.keys(error).includes("result"), false);
      assert.doesNotMatch(JSON.stringify(error), /"results"/);
      return true;
    },
  );
});

test("unwrap never presents a stored preview as full typed data", () => {
  for (const result of [
    {
      ok: true,
      data: { preview: { name: "partial" }, resultId: "synthetic-id" },
      meta: { ...meta, truncated: true, resultId: "synthetic-id" },
    },
    {
      ok: true,
      data: { preview: "partial", resultId: "synthetic-id" },
      meta: { ...meta, truncated: true },
    },
  ] satisfies OperationResult[])
    assert.throws(
      () => unwrap(result),
      (error: unknown) => {
        assert.ok(error instanceof HcmStoredResultError);
        assert.equal(error.resultId, "synthetic-id");
        assert.equal(error.result, result);
        assert.equal(error.code, "RESULT_STORED");
        return true;
      },
    );
  assert.throws(
    () => unwrap({ ok: true, data: { preview: "partial" }, meta: { ...meta, truncated: true } }),
    (error: unknown) => error instanceof HcmOperationError && error.code === "RESULT_TRUNCATED",
  );
});

test("scoped SDK closes exactly once after success and operation failure", async () => {
  const f = fixture();
  assert.equal(
    await f.client.use(async (client) => {
      await client.status();
      return "complete";
    }),
    "complete",
  );
  assert.equal(f.closes(), 1);
  const g = fixture();
  const primary = new HcmError("SYNTHETIC_FAILURE", "Synthetic operation failure.");
  await assert.rejects(
    g.client.use(async () => {
      throw primary;
    }),
    (error: unknown) => error === primary,
  );
  assert.equal(g.closes(), 1);
});

test("cleanup failure retains a successful value and hides transport error text", async () => {
  const f = fixture();
  f.runtime.close = async () => {
    throw new Error("synthetic-private-transport-value");
  };
  const value = { applied: true, id: "9007199254740993" };
  await assert.rejects(
    f.client.use(async () => value),
    (error: unknown) => {
      assert.ok(error instanceof HcmCleanupError);
      assert.equal(error.value, value);
      assert.equal(error.code, "CLEANUP_FAILED");
      assert.equal(error.details?.operationSucceeded, true);
      assert.doesNotMatch(
        JSON.stringify(error),
        /synthetic-private-transport-value|9007199254740993/,
      );
      return true;
    },
  );
});

test("operation and cleanup failure preserve original error, partial results and secondary evidence", async () => {
  const f = fixture();
  f.runtime.close = async () => {
    throw new Error("synthetic-private-cleanup");
  };
  const result: OperationResult = {
    ok: false,
    data: { completed: 1 },
    error: { code: "WRITE_UNKNOWN", message: "Inspect write", mutationOutcome: "indeterminate" },
    meta,
  };
  const primary = new HcmOperationError(result);
  await assert.rejects(
    f.client.use(async () => {
      throw primary;
    }),
    (error: unknown) => {
      assert.equal(error, primary);
      assert.equal(primary.result, result);
      assert.equal(primary.cleanupError?.code, "CLEANUP_FAILED");
      assert.equal(getCleanupError(error), primary.cleanupError);
      assert.doesNotMatch(JSON.stringify(error), /synthetic-private-cleanup|"completed"/);
      return true;
    },
  );
  for (const original of [
    Object.freeze(new Error("Synthetic frozen operation")),
    "synthetic-primitive-error",
  ]) {
    await assert.rejects(
      f.client.use(async () => {
        throw original;
      }),
      (error: unknown) => {
        assert.ok(error instanceof AggregateError);
        assert.equal(error.errors[0], original);
        assert.equal(getCleanupError(error)?.code, "CLEANUP_FAILED");
        return true;
      },
    );
  }
  assert.equal(getCleanupError(null), undefined);
  assert.equal(getCleanupError({ cleanupError: "bad" }), undefined);
  await assert.rejects(
    f.client.use(async () => result),
    (error: unknown) => {
      assert.ok(error instanceof HcmOperationError);
      assert.equal(error.result, result);
      assert.equal(error.mutationOutcome, "indeterminate");
      assert.equal(getCleanupError(error)?.code, "CLEANUP_FAILED");
      return true;
    },
  );
});

test("typed config facade and raw scoped helper never expand permissions or attempt denied writes", async () => {
  let requests = 0;
  const options = {
    ...config,
    fetch: async () => {
      requests++;
      throw new Error("Unexpected network call");
    },
  };
  await withHcmClient(options, async (client) => {
    const write = await client.create({ type: "education_mode", data: { name: "Denied" } });
    assert.equal(write.error?.code, "WRITE_DISABLED");
    assert.equal(write.error?.mutationOutcome, "not_sent");
    const execute = await client.execute("RESULT=[{value:1}];");
    assert.equal(execute.error?.code, "EXECUTE_DISABLED");
    assert.deepEqual(
      (client.runtime as { config?: ConnectionConfig }).config?.permissions,
      config.permissions,
    );
  });
  await assert.rejects(
    withHcm(options, async (runtime) =>
      unwrap(await runtime.call("execute.script", { code: "RESULT=[{value:1}];" })),
    ),
    (error: unknown) => error instanceof HcmOperationError && error.code === "EXECUTE_DISABLED",
  );
  assert.equal(requests, 0);
});

test("typed status returns connected version and scoped cleanup accepts a logout HTTP 500", async () => {
  const methods: string[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const method = /<soap:Body><([A-Za-z0-9]+)/.exec(String(init?.body ?? ""))?.[1];
    if (!method) {
      assert.equal(new URL(String(input)).pathname, "/loggedoff.html");
      return new Response("", { status: 500 });
    }
    methods.push(method);
    const payload =
      method === "OpenSession"
        ? "<SessionID>42</SessionID>"
        : method === "CallMethod"
          ? '<ResultData><Result VALUE-TYPE="string">2025.2.1535.synthetic</Result></ResultData>'
          : "";
    return new Response(
      '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope/"><soap:Body><' +
        method +
        'Response xmlns="http://www.datex-soft.com/">' +
        payload +
        "</" +
        method +
        "Response></soap:Body></soap:Envelope>",
      {
        headers: {
          "content-type": "application/soap+xml",
          "set-cookie": "SessionID=synthetic; Path=/",
        },
      },
    );
  };
  const status = await withHcmClient(
    { ...config, username: "synthetic-account", password: "synthetic-only", fetch },
    async (client) => unwrap(await client.status()),
  );
  assert.deepEqual(Object.keys(status).sort(), [
    "baseUrl",
    "connection",
    "operationCount",
    "permissions",
    "version",
  ]);
  assert.equal(status.connection, config.name);
  assert.equal(status.version, "2025.2.1535.synthetic");
  assert.ok(status.operationCount > 0);
  assert.deepEqual(status.permissions, config.permissions);
  assert.deepEqual(methods, ["OpenSession", "CallMethod", "CallMethod", "CloseSession"]);
});
