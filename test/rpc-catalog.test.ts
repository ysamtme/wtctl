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
const response = (source: string | Buffer) => ({
  Data: Buffer.from(source).toString("base64").replace(/.{60}/g, "$&\n"),
});
test("встроенный обзор сохраняет постраничность, краткие карточки, фильтры и неизменяемые параметры", async () => {
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

test("неверный ввод обзора отклоняется до чтения метаданных без повторения значений", async () => {
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

test("runtime читает отфильтрованные файлы библиотек один раз, пропускает сломанные файлы, а встроенный обзор не делает запросов", async () => {
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
      // tools.server_side тоже подходит, но клиент не может его вызвать.
      serverOnlyHidden: 1,
      hint: "serverOnlyHidden — сколько подходящих функций не показано: они вызываются только из кода на сервере. all:true (в CLI --all) добавит их в список.",
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
    // Функция без допуска для клиента не попадает в список, пока её не запросят явно, но её можно описать.
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

test("чтение всех библиотек обходится не более чем четырьмя запросами; усечение исходного кода сохраняет UTF-8 и не пропускает годные карточки", async () => {
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

test("на запасной вариант переходят только при сбое метаданных приложения; нечитаемые библиотеки сохраняют исходный код сервера", async () => {
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

test("файл библиотеки читается в кодировке по метке порядка байтов или объявлению, а непрочитанная библиотека так и называется", async () => {
  const cp1251 = (text: string) =>
    Buffer.from(
      [...text].map((char) => {
        const code = char.codePointAt(0)!;
        return code >= 0x410 && code <= 0x44f ? code - 0x350 : code;
      }),
    );
  const russian = `<SPXML-INLINE-FORM><lib_ru>
  <privet PROPERTY="1" ALLOW-CALL-FROM-CLIENT="1" PARAM="имя" EXPR="return 'Привет, ' + имя;"/>
</lib_ru></SPXML-INLINE-FORM>`;
  const declared = (encoding: string) => `<?xml version="1.0" encoding="${encoding}"?>\n`;
  const files = new Map<string, Buffer>([
    ["x-local://libs/cp1251.xml", cp1251(declared("windows-1251") + russian)],
    [
      "x-local://libs/bom.xml",
      Buffer.from(`﻿${declared("windows-1251")}${russian.replaceAll("lib_ru", "lib_bom")}`),
    ],
    [
      "x-local://libs/utf16.xml",
      Buffer.from(`﻿${declared("UTF-16")}${russian.replaceAll("lib_ru", "lib_utf16")}`, "utf16le"),
    ],
    [
      "x-local://libs/strange.xml",
      Buffer.from(declared("x-strange") + library.replaceAll("tools", "strange")),
    ],
    [
      "x-local://libs/strange-extra.xml",
      Buffer.from(
        '<SPXML-INLINE-FORM><strange><get_version_ex ALLOW-CALL-FROM-CLIENT="1"/></strange></SPXML-INLINE-FORM>',
      ),
    ],
    // Без объявления файл читается как UTF-8, а кириллица Windows-1251 в UTF-8 не годится.
    ["x-local://libs/invalid.xml", cp1251(russian.replaceAll("lib_ru", "lib_bad"))],
  ]);
  const { runtime } = fakeRuntime(
    {
      "native.spxml2.getAppInfo": {
        shared_docs: [
          { id: "lib_ru", url: "x-local://libs/cp1251.xml" },
          { id: "lib_bom", url: "x-local://libs/bom.xml" },
          { id: "lib_utf16", url: "x-local://libs/utf16.xml" },
          { id: "strange", url: "x-local://libs/strange.xml" },
          { id: "strange", url: "x-local://libs/strange-extra.xml" },
          { id: "lib_bad", url: "x-local://libs/invalid.xml" },
        ],
      },
      "native.lds.loadUrl": (args) => response(files.get(String(args.url))!),
    },
    { permissions: { write: false, execute: false } },
  );
  try {
    const all = await runtime.call("rpc.list");
    assert.deepEqual(all.data, {
      source: "server",
      skipped: ["strange", "lib_bad"],
      targets: [
        { id: "lib_bom.privet", parameters: ["имя"], allowed: true },
        { id: "lib_ru.privet", parameters: ["имя"], allowed: true },
        { id: "lib_utf16.privet", parameters: ["имя"], allowed: true },
        { id: "strange.get_version_ex", parameters: [], allowed: true },
      ],
      total: 4,
    });
    const privet = await runtime.call("rpc.describe", { targetId: "lib_ru.privet", source: true });
    assert.equal((privet.data as { code: string }).code, "return 'Привет, ' + имя;");
    const unread = await runtime.call("rpc.describe", { targetId: "strange.get_version" });
    assert.equal(unread.error?.code, "UNKNOWN_RPC_TARGET");
    assert.equal(
      unread.error!.message,
      "Библиотеку strange прочитать не удалось, описания функции get_version нет.",
    );
    assert.equal(
      unread.error!.hint,
      "Похожие: get_version_ex. rpc.call вызывает функцию и без описания; есть ли она, проверит сервер.",
    );
  } finally {
    await runtime.close();
  }
});
