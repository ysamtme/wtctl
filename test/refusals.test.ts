// Вызов, который не может сработать, называется своим именем: до записи — там, где клиент
// может это определить, и по спискам самого сервера — там, где остался только его голый HTTP 500.
import assert from "node:assert/strict";
import { test } from "node:test";
import { errorInFrontendTerms } from "../src/frontend-names.js";
import { rawXml } from "../src/protocol/index.js";
import { HcmRuntime } from "../src/runtime.js";
import { fakeRuntime, refusal, refuse } from "./fake-server.js";

const library = `<SPXML-INLINE-FORM><tools>
  <get_version PROPERTY="1" ALLOW-CALL-FROM-CLIENT="1" PARAM="kind" EXPR="return kind;"/>
  <server_side PROPERTY="1" PARAM="id" EXPR="return id;"/>
</tools></SPXML-INLINE-FORM>`;

test("объект типа, которого нет на сервере, отклоняется до любой записи", async () => {
  let declared = true;
  const { runtime, server } = fakeRuntime({
    "native.spxml2.getAppInfo": {
      default_db_name: "sample",
      shared_docs: [{ id: "common", url: "x-local://wtv/common.xml" }],
      databases: [
        {
          id: "sample",
          catalogs: [
            { id: "groups", object_type: "group" },
            // Сервер оставляет этот каталог без типа его объектов.
            { id: "events", object_type: "", form_url: "x-local://wtv/wtv_events.xmd" },
          ],
        },
      ],
    },
    "native.spxml2.getForm": (args, id) => {
      if (declared && args.url === "x-local://wtv/common.xml")
        return `<common><exchange_object_types>
        <exchange_object_type><name>event</name></exchange_object_type>
      </exchange_object_types></common>`;
      throw refusal(id);
    },
    "*": refuse(),
  });
  const create = (type: string) => runtime.call("objects.create", { type, data: { name: "x" } });
  try {
    // У имени каталога есть собственная форма, поэтому одной формы недостаточно, чтобы остановить запись.
    const catalog = await create("groups");
    assert.equal(catalog.error?.code, "UNKNOWN_TYPE");
    assert.match(catalog.error!.hint!, /Похожие: group\./);
    assert.equal(catalog.error?.mutationOutcome, "not_sent");
    assert.match((await create("events")).error!.hint!, /Похожие: event\./);
    assert.equal((await create("no_such")).error?.code, "UNKNOWN_TYPE");
    assert.equal(server.calls.filter(({ id }) => /putDoc|getNewObjectId/.test(id)).length, 0);
    // Тип, который сервер объявляет, не называя его каталог, — это тип: следующий за этим отказ —
    // недостающая форма в подставном сервере, а не проверка.
    assert.equal((await create("event")).error?.code, "PLATFORM_SOAP-FAULT");
    // Без объявления сервера отличить каталог от типа можно только по имени каталога.
    declared = false;
    const fresh = fakeRuntime(server).runtime;
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

test("отказ при вызове функции библиотеки объясняется списком функций сервера", async () => {
  let known = true;
  const { runtime, server } = fakeRuntime({
    "native.spxml2.getAppInfo": (_args, id) => {
      if (!known) throw refusal(id);
      return {
        default_db_name: "sample",
        shared_docs: [{ id: "tools", url: "x-local://l/t.xml" }],
      };
    },
    "native.lds.loadUrl": { Data: Buffer.from(library).toString("base64") },
    "*": (args, id) => {
      assert.match(id, /^(native\.rpc\.call|web\.spxml\.callMethodAsync)$/);
      assert.match(String(args.target), /^tools\./);
      throw refusal(id);
    },
  });
  try {
    const call = (method: string, extra = {}) =>
      runtime.call("rpc.call", { library: "tools", method, arguments: [], ...extra });
    const misspelt = await call("get_versio");
    assert.equal(misspelt.error?.code, "UNKNOWN_RPC_TARGET");
    assert.match(misspelt.error!.hint!, /^Похожие: get_version\./);
    // Сервер ничего не выполнил: записи, которую нужно искать, нет.
    assert.equal(misspelt.error?.mutationOutcome, "not_sent");
    assert.equal((await call("get_versio", { async: true })).error?.code, "UNKNOWN_RPC_TARGET");
    const closed = await call("server_side");
    assert.equal(closed.error?.code, "RPC_SERVER_ONLY");
    assert.equal(closed.error?.mutationOutcome, "not_sent");
    assert.match(closed.error!.hint!, /execute\.script.*tools\.server_side\(/);
    // Функция существует и может быть вызвана: отказ пришёл изнутри неё и остаётся как есть.
    const inside = await call("get_version");
    assert.equal(inside.error?.code, "PLATFORM_SOAP-FAULT");
    assert.equal(inside.error?.mutationOutcome, "indeterminate");
  } finally {
    await runtime.close();
  }
  // Без списка сервера судить не по чему.
  const blind = fakeRuntime(server).runtime;
  known = false;
  try {
    const result = await blind.call("rpc.call", { library: "tools", method: "nope" });
    assert.equal(result.error?.code, "PLATFORM_SOAP-FAULT");
  } finally {
    await blind.close();
  }
});

test("отказ функции называется отсутствием функции, только когда её библиотека прочитана целиком или её нет на сервере", async () => {
  // Своя библиотека с комментарием в windows-1251: файл не в UTF-8.
  const cp1251 = Buffer.concat([
    Buffer.from('<?xml version="1.0" encoding="windows-1251"?>\n<SPXML-INLINE-FORM><tools><!-- '),
    Buffer.from([0xcf, 0xf0, 0xe8, 0xec, 0xe5, 0xf0]),
    Buffer.from(
      ' --><get_version PROPERTY="1" ALLOW-CALL-FROM-CLIENT="1" EXPR="return 1;"/></tools></SPXML-INLINE-FORM>',
    ),
  ]);
  const cases: [string, Record<string, string>, string | Buffer | undefined, string][] = [
    ["файл библиотеки не прочитан", { tools: "x-local://l/t.xml" }, undefined, "indeterminate"],
    ["файл не в UTF-8", { tools: "x-local://l/t.xml" }, cp1251, "indeterminate"],
    // Общий документ в базе данных клиент как библиотеку не читает.
    ["библиотека в базе данных", { tools: "x-local://sample/t.xml" }, library, "indeterminate"],
    ["библиотеки нет на сервере", { other: "x-local://l/o.xml" }, library, "not_sent"],
  ];
  for (const [name, docs, file, outcome] of cases) {
    const { runtime } = fakeRuntime({
      "native.spxml2.getAppInfo": {
        default_db_name: "sample",
        shared_docs: Object.entries(docs).map(([id, url]) => ({ id, url })),
      },
      "native.lds.loadUrl":
        file === undefined ? refuse() : { Data: Buffer.from(file).toString("base64") },
      "native.rpc.call": refuse(),
    });
    try {
      const { error } = await runtime.call("rpc.call", { library: "tools", method: "nope" });
      assert.deepEqual(
        [error?.code, error?.mutationOutcome],
        [outcome === "not_sent" ? "UNKNOWN_RPC_TARGET" : "PLATFORM_SOAP-FAULT", outcome],
        name,
      );
    } finally {
      await runtime.close();
    }
  }
});

test("неверный аргумент функции называется по его месту среди аргументов", async () => {
  const { runtime } = fakeRuntime();
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

test("упавший шаг пакета и списки операций называются в терминах вызывающего", () => {
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
  assert.equal(mcp.results[1]!.error.hint, "Строки показывает hcm_logs_follow.");
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

test("native.lds.loadDoc: отказ сервера HTTP 500 называет обычную причину операции", async () => {
  const { runtime } = fakeRuntime({ "native.lds.loadDoc": refuse(500) });
  const refused = await runtime.call("native.lds.loadDoc", { url: "x-local://wt_data/x.xml" });
  assert.equal(refused.error?.code, "PLATFORM_SOAP-FAULT");
  assert.match(refused.error!.hint!, /по этому адресу ничего нет/);
  await runtime.close();
});

test("native.experimental.rawRequest: GET проходит как чтение на подключении только для чтения, остальные методы — нет", async () => {
  const { runtime } = fakeRuntime({ "*": {} }, { permissions: { write: false, execute: false } });
  const request = (method: string) =>
    runtime.call("native.experimental.rawRequest", { unsafe: true, path: "/x", method });
  assert.equal((await request("GET")).ok, true);
  assert.equal((await request("POST")).error?.code, "WRITE_DISABLED");
  await runtime.close();
});

test("сбой кода клиента отвечает INTERNAL_ERROR без текста движка, отказ по аргументу — INVALID_ARGUMENT", async () => {
  // Ошибка движка: чтение поля у undefined.
  const crash = () => (undefined as unknown as { field: unknown }).field;
  const plain = () => {
    throw new Error("x");
  };
  const reply = async (answer: () => unknown, id: string, args: Record<string, unknown> = {}) => {
    const { runtime } = fakeRuntime({ "native.lds.loadUrl": answer, "native.lds.putUrl": answer });
    const { error } = await runtime.call(id, { url: "x-local://share/a.txt", ...args });
    await runtime.close();
    return error;
  };
  assert.deepEqual(await reply(crash, "files.read"), {
    code: "INTERNAL_ERROR",
    message: "Операция не выполнена: внутренняя ошибка клиента.",
    hint: "Это дефект клиента: подбирать аргументы не нужно.",
    retryable: false,
  });
  // Исход записи тот же, что у любого другого сбоя кода клиента.
  const failedWrite = await reply(crash, "files.write", { text: "a" });
  assert.equal(failedWrite?.mutationOutcome, "indeterminate");
  assert.deepEqual(failedWrite, await reply(plain, "files.write", { text: "a" }));

  const refused = await reply(crash, "files.read", { url: 1 });
  assert.deepEqual(
    [refused?.code, refused?.message],
    ["INVALID_ARGUMENT", "args.url: нужна строка."],
  );
});

test("значение, которое не принимает Node, отклоняется до запроса с именем аргумента", async () => {
  const { runtime, server } = fakeRuntime({
    "native.lds.loadDoc": { kind: "binary", bytes: new Uint8Array([0xff, 0xfe]) },
  });
  // Адрес, заголовки и метод сырого запроса разбирает транспорт: ему нужен шлюз подключения.
  let requests = 0;
  const overHttp = new HcmRuntime({
    ...runtime.config,
    fetch: async () => (requests++, new Response("")),
  });
  const raw = (extra: Record<string, unknown>) =>
    [
      overHttp,
      "anonymous.experimental.rawRequest",
      { unsafe: true, path: "/x", ...extra },
    ] as const;
  const refusals = [
    [
      runtime,
      "execute.script",
      { code: "RESULT = [];", params: { id: 1n } },
      "params: значение нельзя записать как JSON.",
    ],
    [
      runtime,
      "results.export",
      { resultId: "0".repeat(32), path: "a\0b" },
      "path: в пути есть нулевой символ.",
    ],
    [...raw({ path: "http://[" }), "path: адрес записан неверно."],
    [
      ...raw({ headers: { "X-Name": "имя" } }),
      "headers: имя или значение заголовка записано неверно.",
    ],
    [
      ...raw({ method: "GET", body: "x" }),
      "method: метод HTTP записан неверно или не допускает тела (body).",
    ],
  ] as const;
  for (const [target, id, args, message] of refusals) {
    const { error } = await target.call(id, args);
    assert.deepEqual([error?.code, error?.message], ["INVALID_ARGUMENT", message]);
  }
  assert.equal(server.calls.length + requests, 0);
  // По адресу файл, а не документ объекта.
  const file = await runtime.call("objects.get", { url: "x-local://share/a.bin" });
  assert.equal(file.error?.code, "INVALID_XML");
  assert.match(file.error!.hint!, /files\.read/);
  await Promise.all([runtime.close(), overHttp.close()]);

  // Скрипту с wtctl/protocol отказ по аргументу приходит как TypeError.
  assert.throws(() => rawXml("<a>"), TypeError);
});
