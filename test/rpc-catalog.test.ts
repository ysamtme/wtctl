import test from "node:test";
import assert from "node:assert/strict";
import {
  RpcCatalog,
  RPC_CATALOG_PAGE_MAX_BYTES,
  type RpcCatalogFilter,
} from "../src/rpc-catalog.js";
import { HcmError } from "../src/errors.js";
import { fakeRuntime } from "./fake-server.js";

const library = `<SPXML-INLINE-FORM><tools>
  <!-- <fake ALLOW-CALL-FROM-CLIENT="1"/> -->
  <get_version PROPERTY="1" ALLOW-CALL-FROM-CLIENT="1" PARAM="a" Param="b" EXPR="return a && b;"/>
  <echo PROPERTY="1" PROPERTY="1" ALLOW-CALL-FROM-CLIENT="1" PARAM="text" EXPR="return &quot;Привет &amp; мир &nbsp;&quot;;"/>
  <hidden PARAM="secret" EXPR="throw 'never execute';"/>
  <server_side PROPERTY="1" PARAM="id" EXPR="return id;"/>
  <denied ALLOW-CALL-FROM-CLIENT="0" EXPR="return false;"/>
</tools></SPXML-INLINE-FORM>`;
const response = (source: string) => ({
  Data: Buffer.from(source).toString("base64").replace(/.{60}/g, "$&\n"),
});
test("built-in discovery retains pagination, compact cards, filters and immutable parameters", async () => {
  const catalog = new RpcCatalog();
  const page = await catalog.list();
  assert.equal(page.source, "built-in 2025.1.1171");
  assert.equal(page.total, 263);
  assert.equal(page.targets.length, 30);
  assert.equal(page.nextCursor, 30);
  assert.deepEqual(page.targets[0], {
    id: "i18n.obtain_const_translate_data",
    parameters: [],
    allowed: null,
  });
  const version = await catalog.describe("tools.get_version", { source: true });
  assert.deepEqual(version, {
    id: "tools.get_version",
    parameters: ["sTypeParam", "bDateFlag"],
    allowed: true,
    source: page.source,
  });
  assert.equal((await catalog.describe("tools_report.fnSaveFile")).allowed, false);
  assert.equal((await catalog.list({ query: " GET_VERSION " })).total, 1);
  assert.equal((await catalog.list({ library: "tools", method: "get_version" })).total, 1);
  assert.ok(
    (await catalog.list({ query: "iPageSize" })).targets.some(
      (item) => item.id === "ms_tools.evaluate_remote_collection_obj",
    ),
  );
  const ids: string[] = [];
  let cursor = 0;
  for (;;) {
    const next = await catalog.list({ cursor, limit: 100 });
    assert.ok(Buffer.byteLength(JSON.stringify(next, null, 2)) <= RPC_CATALOG_PAGE_MAX_BYTES);
    ids.push(...next.targets.map((target) => target.id));
    if (next.nextCursor === undefined) break;
    assert.equal(next.nextCursor, cursor + next.targets.length);
    cursor = next.nextCursor;
  }
  assert.equal(ids.length, 263);
  assert.equal(new Set(ids).size, 263);
  assert.equal((await catalog.list({ cursor: Number.MAX_SAFE_INTEGER })).targets.length, 0);
  assert.equal((await catalog.list({ library: "synthetic_unknown" })).total, 0);
  assert.ok(Object.isFrozen(version) && Object.isFrozen(version.parameters));
  assert.throws(() => (version.parameters as string[]).push("tamper"), TypeError);
  assert.deepEqual((await catalog.describe(version.id)).parameters, ["sTypeParam", "bDateFlag"]);
});

test("invalid catalog inputs are rejected before reading metadata without echoing values", async () => {
  const catalog = new RpcCatalog(
    async () => {
      throw new Error("must not read");
    },
    async () => {
      throw new Error("must not read");
    },
  );
  for (const filter of [
    null,
    [],
    { limit: 0 },
    { limit: 101 },
    { limit: 1.5 },
    { cursor: -1 },
    { cursor: Number.MAX_SAFE_INTEGER + 1 },
    { cursor: "0" },
    { query: "x".repeat(513) },
    { library: "tools.extra" },
    { method: "" },
    { builtIn: "yes" },
    { arbitrary: "synthetic_secret" },
  ])
    await assert.rejects(
      catalog.list(filter as RpcCatalogFilter),
      (error: unknown) =>
        error instanceof HcmError &&
        error.code === "INVALID_ARGUMENT" &&
        !JSON.stringify(error.toJSON()).includes("synthetic_secret"),
    );
  for (const id of [
    undefined,
    null,
    "",
    "tools",
    "tools.get.version",
    " tools.get_version",
    "tools.synthetic-secret",
  ])
    await assert.rejects(catalog.describe(id as string), { code: "INVALID_ARGUMENT" });
  await assert.rejects(new RpcCatalog().describe("tools.missing"), { code: "UNKNOWN_RPC_TARGET" });
  await assert.rejects(catalog.describe("tools.get_version", { source: "yes" } as never), {
    code: "INVALID_ARGUMENT",
  });
});

test("runtime reads filtered library files once, skips broken files, and built-in discovery makes zero requests", async () => {
  const files = new Map([
    ["x-local://libs/tools.xml", library],
    [
      "x-local://libs/extension.xml",
      '<SPXML-INLINE-FORM><tools><extra ALLOW-CALL-FROM-CLIENT="1"/></tools></SPXML-INLINE-FORM>',
    ],
    ["x-local://libs/malformed.xml", "<SPXML-INLINE-FORM><tools>"],
    ["x-local://libs/data.xml", "<data><name>Not a library</name></data>"],
  ]);
  const { runtime, server } = fakeRuntime(
    {
      "native.spxml2.getAppInfo": {
        default_db_name: "sample",
        shared_docs: [
          { id: "tools", url: "x-local://libs/tools.xml" },
          { id: "tools", url: "x-local://libs/extension.xml" },
          { id: "alias", url: "x-local://libs/tools.xml" },
          { id: "broken", url: "x-local://libs/malformed.xml" },
          { id: "missing", url: "x-local://libs/missing.xml" },
          { id: "data", url: "x-local://libs/data.xml" },
          { id: "tools", url: "x-local://sample/common.xml" },
          { id: "tools", url: "x-local://data_local/config.xml" },
        ],
      },
      "native.lds.loadUrl": (args) => {
        const source = files.get(String(args.url));
        if (!source) throw new Error("Synthetic missing file");
        return response(source);
      },
    },
    { permissions: { write: false, execute: false } },
  );
  const calls = () => server.calls.map(({ id, args }) => String(args.url ?? id));
  try {
    for (const [id, args] of [
      ["rpc.list", { builtIn: true, limit: 3 }],
      ["rpc.describe", { targetId: "tools.get_version", builtIn: true, source: true }],
    ] as const) {
      const builtIn = await runtime.call(id, args);
      assert.equal(builtIn.ok, true);
      assert.equal((builtIn.data as { source: string }).source, "built-in 2025.1.1171");
    }
    assert.deepEqual(calls(), []);
    const first = await runtime.call("rpc.list", { library: "tools" });
    assert.equal(first.ok, true, JSON.stringify(first.error));
    assert.deepEqual(calls(), [
      "native.spxml2.getAppInfo",
      "x-local://libs/tools.xml",
      "x-local://libs/extension.xml",
    ]);
    assert.deepEqual(first.data, {
      source: "server",
      targets: [
        { id: "tools.denied", parameters: [], allowed: false },
        { id: "tools.echo", parameters: ["text"], allowed: true },
        { id: "tools.extra", parameters: [], allowed: true },
        { id: "tools.get_version", parameters: ["a", "b"], allowed: true },
      ],
      total: 4,
      // tools.server_side matches too, but a client cannot call it.
      serverOnlyHidden: 1,
    });
    const before = calls().length;
    assert.deepEqual((await runtime.call("rpc.list", { library: "tools" })).data, first.data);
    assert.equal(calls().length, before);
    assert.deepEqual(
      (await runtime.call("rpc.describe", { targetId: "tools.get_version", source: true })).data,
      {
        id: "tools.get_version",
        parameters: ["a", "b"],
        allowed: true,
        source: "server",
        code: "return a && b;",
      },
    );
    assert.equal(calls().length, before);
    // A function without the client gate is left out of the list unless asked for, and can be described.
    const everything = await runtime.call("rpc.list", { library: "tools", all: true });
    assert.deepEqual(
      (everything.data as { targets: { id: string; serverOnly?: true }[] }).targets
        .filter((target) => target.serverOnly)
        .map((target) => target.id),
      ["tools.server_side"],
    );
    assert.equal((everything.data as { total: number }).total, 5);
    assert.equal((everything.data as { serverOnlyHidden?: number }).serverOnlyHidden, undefined);
    const serverSide = await runtime.call("rpc.describe", {
      targetId: "tools.server_side",
      source: true,
    });
    assert.deepEqual(serverSide.data, {
      id: "tools.server_side",
      parameters: ["id"],
      allowed: false,
      serverOnly: true,
      note: "С клиента функция не вызывается (нет ALLOW-CALL-FROM-CLIENT). Вызывать её нужно из кода на сервере: tools.server_side(…).",
      source: "server",
      code: "return id;",
    });
    const mistyped = await runtime.call("rpc.describe", { targetId: "tools.get_vers" });
    assert.equal(mistyped.error?.code, "UNKNOWN_RPC_TARGET");
    assert.match(mistyped.error!.message, /В библиотеке tools нет функции get_vers/);
    assert.match(mistyped.error!.hint!, /Похожие: get_version/);
    assert.equal(calls().length, before);
    const all = await runtime.call("rpc.list");
    assert.equal(all.ok, true);
    assert.equal((all.data as { total: number }).total, 7);
    assert.deepEqual((all.data as { skipped: string[] }).skipped, ["broken", "missing"]);
    assert.equal(calls().filter((url) => url === "x-local://libs/tools.xml").length, 1);
    const complete = calls().length;
    assert.deepEqual((await runtime.call("rpc.list")).data, all.data);
    assert.deepEqual(calls().slice(complete), ["x-local://libs/missing.xml"]);
  } finally {
    await runtime.close();
  }
});

test("all-library reads use at most four requests; source truncation preserves UTF-8 and skips no valid cards", async () => {
  let active = 0;
  let maximum = 0;
  const shared_docs = Array.from({ length: 9 }, (_, index) => ({
    id: `lib${index}`,
    url: `x-local://libs/${index}.xml`,
  }));
  const catalog = new RpcCatalog(
    async () => ({ shared_docs }),
    async () => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return response(library.replace("return a && b;", "я".repeat(5000)));
    },
  );
  const page = await catalog.list();
  assert.equal(maximum, 4);
  assert.equal(page.total, 27);
  const full = await catalog.describe("lib0.echo", { source: true });
  assert.equal(full.code, 'return "Привет & мир &nbsp;";');
  assert.equal(full.codeTruncated, undefined);
  const long = await catalog.describe("lib0.get_version", { source: true });
  assert.equal(long.codeTruncated, true);
  assert.ok(Buffer.byteLength(long.code!) <= 8192);
  assert.equal(long.code, "я".repeat(4096));
  assert.equal((await catalog.describe("lib0.get_version")).code, undefined);
});

test("only application metadata failure falls back; unreadable libraries retain server source", async () => {
  let reads = 0;
  const fallback = new RpcCatalog(
    async () => {
      throw new Error("Synthetic unavailable metadata");
    },
    async () => {
      reads++;
    },
  );
  assert.equal((await fallback.list()).source, "built-in 2025.1.1171");
  assert.equal((await fallback.describe("tools.get_version", { source: true })).code, undefined);
  assert.equal(reads, 0);
  const empty = new RpcCatalog(
    async () => ({ shared_docs: [{ id: "tools", url: "x-local://libs/missing.xml" }] }),
    async () => {
      throw new Error("Synthetic unavailable file");
    },
  );
  assert.deepEqual(await empty.list(), {
    source: "server",
    skipped: ["tools"],
    targets: [],
    total: 0,
  });
  await assert.rejects(empty.describe("tools.get_version"), { code: "UNKNOWN_RPC_TARGET" });
});
