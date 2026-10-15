// Что нашла первая проба на настоящей задаче: сессия, которую сервер сбросил, ответы, форма которых
// зависела от данных, и ошибки, указывавшие не туда.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeHcmOperation } from "../src/catalog.js";
import { operationHelp } from "../src/operation-help.js";
import { NAMES, errorInFrontendTerms } from "../src/frontend-names.js";
import { cliHelp } from "../src/cli/help.js";
import { operationDefinition } from "../src/operations.js";
import { WsHcmApiError } from "../src/protocol/error.js";
import { LogReader, logKind, parseLogEvents, type LogGateway } from "../src/logs.js";
import { HcmMcpTools } from "../src/mcp/server.js";
import { escapeXml, findXmlNode, parseXml } from "../src/protocol/xml.js";
import { ResultStore } from "../src/results.js";
import { HcmRuntime } from "../src/runtime.js";
import { withRepeated } from "../src/schema.js";
import type { ConnectionConfig, OperationResult } from "../src/contracts.js";
import type { RuntimePort } from "../src/cli/types.js";
import { fakeRuntime, refusal, type Answer } from "./fake-server.js";
import { mcpJson } from "./mcp-json.js";

const base = {
  name: "t",
  baseUrl: "http://fixture.invalid/",
  timeoutMs: 1000,
  maxResponseBytes: 1024 * 1024,
  outputLimitBytes: 4096,
  runtimeDir: ".unused",
  logBusyMs: 1,
} as const;
const readOnly = { outputLimitBytes: 4096, permissions: { write: false, execute: false } };

/** Сервер, который знает только сессии, открытые не раньше `validFrom`; старые получают HTTP 401. */
function sessionServer(options: { refuseLogin?: boolean } = {}) {
  const state = { opened: 0, validFrom: 1, calls: [] as string[] };
  const soap = (method: string, body = ""): Response =>
    new Response(
      `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope/"><soap:Body><${method}Response>${body}</${method}Response></soap:Body></soap:Envelope>`,
      { headers: { "content-type": "application/soap+xml", "set-cookie": "SessionID=c" } },
    );
  const config: ConnectionConfig = {
    ...base,
    username: "admin",
    password: "secret",
    permissions: { write: true, execute: true },
    fetch: async (input, init) => {
      const path = new URL(String(input)).pathname;
      const method = /<soap:Body><([A-Za-z0-9]+)/.exec(String(init?.body ?? ""))?.[1];
      state.calls.push(method ?? path);
      if (path === "/loggedoff.html") return new Response("");
      if (method === "OpenSession") {
        if (options.refuseLogin) return new Response("", { status: 401 });
        state.opened++;
        return soap(method, `<SessionID>${40 + state.opened}</SessionID>`);
      }
      if (state.opened < state.validFrom) return new Response("", { status: 401 });
      if (method === "CloseSession") return soap(method);
      assert.equal(method, "CallMethod");
      const document = parseXml(String(init?.body));
      assert.equal(findXmlNode(document, "MethodName"), "get_version");
      return soap(
        method,
        `<ResultData><Result VALUE-TYPE="string">${escapeXml("2025.2")}</Result></ResultData>`,
      );
    },
  };
  return { config, state };
}

test("сессия, которую сервер сбросил, заменяется новым входом, и запрос отправляется снова", async () => {
  const f = sessionServer();
  const runtime = new HcmRuntime(f.config);
  assert.equal((await runtime.call("runtime.status", {})).ok, true);
  f.state.validFrom = 2; // сервер забывает первую сессию, как после простоя
  const again = await runtime.call("runtime.status", {});
  assert.equal(again.ok, true, JSON.stringify(again.error));
  assert.equal(f.state.opened, 2);
  // status дополнительно спрашивает сервер, кто вошёл и какая у него база данных.
  assert.deepEqual(f.state.calls, [
    "OpenSession",
    "CallMethod",
    "/api/spxml2/get_app_info",
    "CallMethod",
    "CallMethod",
    "OpenSession",
    "CallMethod",
    "/api/spxml2/get_app_info",
    "CallMethod",
  ]);
  // Сервер снова забывает сессию, и ничего не вызывается: закрытие не должно из-за этого падать.
  f.state.validFrom = 3;
  await runtime.close();
});

test("отказ во входе окончателен: одна попытка, подсказка про учётные данные, ничего не сообщено как выполненное", async () => {
  const refused = sessionServer({ refuseLogin: true });
  const first = new HcmRuntime(refused.config);
  const login = await first.call("runtime.status", {});
  assert.equal(login.error?.code, "PLATFORM_AUTH");
  assert.match(login.error!.hint!, /user name and password|парол/i);
  assert.equal(refused.state.calls.filter((call) => call === "OpenSession").length, 1);
  await first.close();

  // Сессию отклоняют и после нового входа: ошибка сообщается, без цикла.
  const f = sessionServer();
  const runtime = new HcmRuntime(f.config);
  await runtime.call("runtime.status", {});
  f.state.validFrom = 9;
  const failed = await runtime.call("rpc.call", { library: "tools", method: "get_version" });
  assert.equal(failed.error?.code, "PLATFORM_AUTH");
  assert.equal(failed.error?.mutationOutcome, "not_sent");
  assert.equal(f.state.opened, 2);
  await runtime.close();
});

test("отказ, который сервер пишет в лог по-русски, — событие уровня error", () => {
  const levels = parseLogEvents(
    [
      "16:42:08 [A:1] Неизвестная ошибка",
      "16:42:09 [A:2] Элемент не найден",
      "16:42:10 [A:3] Database is not allowed: objects",
      "16:42:11 [A:4] Global Neural Handler initialized...",
      "16:42:12 [A:5] Импорт завершён, ошибок: 0",
    ].join("\n"),
  ).map((event) => event.level);
  assert.deepEqual(levels, ["error", "error", "error", "normal", "normal"]);
});

function logReport(files: readonly [name: string, serverType: string][]): string {
  const row = ([name, type]: readonly [string, string]) =>
    `<r><cs>${["Журнал", "", name, "10", type, "false", `x-local://Logs/${name}`]
      .map((value) => `<c><t>${escapeXml(value)}</t></c>`)
      .join("")}</cs></r>`;
  return `<data><rs>${files.map(row).join("")}</rs></data>`;
}

test("список логов начинается с новейших файлов и называет каждый лог по имени файла", async () => {
  const gateway: LogGateway = {
    call: async () => ({
      valueType: "string",
      lexicalValue: logReport([
        ["agent_2026-01-26.log", "agent"],
        ["auth-events_2026-10-02.log", "sql"],
        ["xhttp_2026-10-01.log", "xhttp"],
        ["xhttp_2026-10-02.log", "xhttp"],
        ["xhttp_middleware_2026-10-02.log", "xhttp"],
      ]),
    }),
  };
  const reader = new LogReader(gateway, { maxResponseBytes: 65536 });
  const all = await reader.list();
  assert.deepEqual(
    all.files.map((file) => [file.name, file.type]),
    [
      ["auth-events_2026-10-02.log", "auth-events"],
      ["xhttp_2026-10-02.log", "xhttp"],
      ["xhttp_middleware_2026-10-02.log", "xhttp_middleware"],
      ["xhttp_2026-10-01.log", "xhttp"],
      ["agent_2026-01-26.log", "agent"],
    ],
  );
  assert.deepEqual(
    (await reader.list({ type: "xhttp" })).files.map((file) => file.name),
    ["xhttp_2026-10-02.log", "xhttp_2026-10-01.log"],
  );
  assert.equal(logKind("spxml_unibridge_2026-10-02_none_24188.log"), "spxml_unibridge");
  assert.equal(logKind("plain.log"), "plain");
});

test("сохранённый лог читается и экспортируется как текст, а ответ показывает, как он начинается", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hcm-trial-"));
  try {
    const text = Array.from({ length: 400 }, (_, index) => `12:00:00 line ${index} «ё»`).join("\n");
    const { runtime } = fakeRuntime(
      { "*": { file: "a.log", text, rows: [1, 2, 3, 4, 5] } },
      { ...readOnly, runtimeDir: directory },
    );
    const stored = await runtime.call("native.lds.loadDoc", { url: "x-local://a.xml" });
    assert.equal(stored.meta.truncated, true);
    const data = stored.data as { preview: Record<string, unknown>; resultId: string };
    assert.deepEqual(data.preview, {
      file: "a.log",
      text: text.slice(0, 1000),
      rows: [1, 2, 3, 4, 5],
    });
    const page = (await runtime.call("results.read", { resultId: data.resultId, limit: 50 }))
      .data as Record<string, unknown>;
    assert.equal(page.format, "text");
    assert.equal(page.text, text.slice(0, 50));
    assert.equal(page.totalChars, text.length);
    const json = (
      await runtime.call("results.read", { resultId: data.resultId, limit: 9, format: "json" })
    ).data as Record<string, unknown>;
    assert.equal(json.text, '{"file":"');
    const path = join(directory, "a.txt");
    const exported = await runtime.call("results.export", {
      resultId: data.resultId,
      path,
      format: "text",
    });
    assert.equal(exported.ok, true, JSON.stringify(exported.error));
    assert.equal(await readFile(path, "utf8"), text);
    await runtime.close();

    // У результата без текста нет текстовой формы: отказ говорит, какие формы подходят.
    const store = new ResultStore({
      ...base,
      runtimeDir: directory,
      permissions: { write: false, execute: false },
    });
    const { resultId } = await store.put({ items: [1] });
    await assert.rejects(store.read(resultId, 0, 10, "text"), { code: "INVALID_RESULT_FORMAT" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

const groupForm = "x-local://wtv/wtv_group.xmd";
const peopleForm = "x-local://wtv/wtv_people.xmd";
function shapedRuntime(refuses?: (id: string, args: Record<string, unknown>) => boolean) {
  const forms: Record<string, string> = {
    [groupForm]:
      '<SPXML-FORM><group><id TYPE="integer"/><name TYPE="string"/><code TYPE="string"/>' +
      '<collaborators><collaborator MULTIPLE="1" PRIMARY-KEY="collaborator_id"><collaborator_id TYPE="integer"/></collaborator></collaborators>' +
      '<INHERIT TYPE="tagged"/></group>' +
      '<tagged SAMPLE="1"><tags><tag MULTIPLE="1"><name TYPE="string"/></tag></tags></tagged></SPXML-FORM>',
    [peopleForm]:
      '<SPXML-FORM><people><person MULTIPLE="1" PRIMARY-KEY="id"><id TYPE="integer"/><lastname TYPE="string"/><hire_date TYPE="date"/>' +
      '<roles><role MULTIPLE="1"><role_id TYPE="string"/></role></roles></person></people></SPXML-FORM>',
  };
  const answering =
    (answer: Answer): Answer =>
    (args, id) => {
      if (refuses?.(id, args)) throw refusal(id);
      return typeof answer === "function" ? answer(args, id) : answer;
    };
  return fakeRuntime(
    {
      "native.spxml2.getAppInfo": answering({
        default_db_name: "sample",
        databases: [
          {
            id: "sample",
            catalogs: [{ id: "people", object_type: "person", form_url: peopleForm }],
          },
        ],
      }),
      "native.spxml2.getForm": answering((args) => {
        const form = forms[String(args.url)];
        if (form === undefined) throw new Error("no such form");
        return form;
      }),
      "native.lds.loadDoc": answering({
        kind: "binary",
        bytes: new TextEncoder().encode(
          `<group SPXML-FORM="${groupForm}"><id>1</id><name>G</name>` +
            "<collaborators><collaborator><collaborator_id>5</collaborator_id></collaborator></collaborators>" +
            "<tags><tag><name>a</name></tag><tag><name>b</name></tag></tags></group>",
        ),
      }),
      "native.lds.xQuery": answering({
        Data: { person: [{ id: "1", roles: { role: { role_id: "admin" } } }, { id: "2" }] },
        TotalCount: "2",
        EOF: "true",
      }),
    },
    { outputLimitBytes: 4096, permissions: { write: false, execute: true } },
  );
}

test("повторяющийся элемент — список и тогда, когда у объекта один элемент", async () => {
  assert.deepEqual(
    withRepeated(
      { a: { b: { c: "1" } }, d: [{ e: "x" }, { e: ["y"] }], f: "" },
      new Set(["a.b", "d.e"]),
    ),
    { a: { b: [{ c: "1" }] }, d: [{ e: ["x"] }, { e: ["y"] }], f: "" },
  );
  const f = shapedRuntime();
  const object = (await f.runtime.call("objects.get", { id: "1" })).data as Record<string, any>;
  assert.deepEqual(object.data.collaborators, { collaborator: [{ collaborator_id: "5" }] });
  assert.deepEqual(object.data.tags, { tag: [{ name: "a" }, { name: "b" }] }, "inherited");
  assert.equal(object.unknownFields, undefined);
  // Только скалярные поля: форма не нужна и повторно не запрашивается.
  const before = f.server.calls.length;
  const scalar = (await f.runtime.call("objects.get", { id: "1", fields: ["name"] })).data;
  assert.deepEqual((scalar as Record<string, unknown>).data, { name: "G" });
  assert.deepEqual(
    f.server.calls.slice(before).map(({ id }) => id),
    ["native.lds.loadDoc"],
  );
  await f.runtime.close();
});

test("запрошенное поле, которого нет у типа, названо, пустое тоже; в строке поиска есть каждое запрошенное поле", async () => {
  const f = shapedRuntime();
  const object = (
    await f.runtime.call("objects.get", { id: "1", fields: ["name", "code", "nope"] })
  ).data as Record<string, unknown>;
  assert.deepEqual(object.data, { name: "G" });
  assert.deepEqual([object.emptyFields, object.unknownFields], [["code"], ["nope"]]);
  for (const args of [
    { catalog: "people", fields: ["lastname", "id", "roles", "nope"] },
    { query: "for $e in people return $e", fields: ["lastname", "id", "roles", "nope"] },
  ]) {
    const page = (await f.runtime.call("runtime.query", args)).data as Record<string, any>;
    // Пустое поле, запрошенное по имени, приходит как ""; структура остаётся такой, как её дал сервер.
    assert.deepEqual(page.items, [
      { id: "1", roles: { role: [{ role_id: "admin" }] }, lastname: "" },
      { id: "2", lastname: "" },
    ]);
    // Столбцы выгрузки идут в порядке fields.
    assert.deepEqual(page.items.map(Object.keys), [
      ["lastname", "id", "roles"],
      ["lastname", "id"],
    ]);
    assert.deepEqual(page.unknownFields, ["nope"]);
    assert.match(page.hint, /нет в строке каталога.*objects\.get/);
  }
  await f.runtime.close();
});

test("несколько объектов читаются одним вызовом; не прочитанный назван в своём элементе", async () => {
  let loads = 0;
  const f = shapedRuntime((id) => id === "native.lds.loadDoc" && ++loads === 2);
  const many = (await f.runtime.call("objects.get", { ids: ["1", "2", "1"], fields: ["name"] }))
    .data as Record<string, any>;
  assert.deepEqual([many.total, many.failed], [3, 1]);
  assert.deepEqual(
    many.items.map((item: Record<string, any>) => item.data?.name ?? item.error.code),
    ["G", "PLATFORM_SOAP-FAULT", "G"],
  );
  assert.equal(many.items[1].id, "2");
  for (const args of [{ id: "1", ids: ["2"] }, { ids: [] }, { ids: [2] }])
    assert.equal((await f.runtime.call("objects.get", args)).error?.code, "INVALID_ARGUMENT");
  await f.runtime.close();
});

test("сервер, который не отвечает или отказывает во входе, обрывает чтение нескольких объектов ошибкой вызова", async () => {
  for (const kind of ["http", "auth"] as const) {
    const f = shapedRuntime();
    f.server.on("native.lds.loadDoc", () => {
      throw new WsHcmApiError(kind, "нет связи");
    });
    const many = await f.runtime.call("objects.get", { ids: ["1", "2"], fields: ["name"] });
    assert.equal(many.ok, false);
    assert.equal(many.error?.code, `PLATFORM_${kind.toUpperCase()}`);
    assert.equal(many.data, undefined);
    // Второй объект не читался: вызов прерван на первом.
    assert.equal(f.server.calls.filter(({ id }) => id === "native.lds.loadDoc").length, 1);
    await f.runtime.close();
  }
});

test("status называет вошедшего пользователя, когда сервер сообщает его документ; шаг пакета сохраняет своё имя", async () => {
  let user: string | undefined = "x-local://wt_data/objects/6aa1b2c3d4e5f6/07.xml";
  const { runtime, server } = fakeRuntime(
    { "native.rpc.call": { Result: "2025.2" }, "*": () => ({ auth_object_url: user }) },
    readOnly,
  );
  const status = (await runtime.call("runtime.status", {})).data as Record<string, unknown>;
  assert.equal(status.userId, "0x6AA1B2C3D4E5F607");
  const batch = (
    await runtime.call("runtime.batch", {
      steps: [{ id: "runtime.status", as: "first" }, { id: "runtime.status" }],
    })
  ).data as { results: Record<string, unknown>[] };
  assert.deepEqual(
    batch.results.map((step) => step.as),
    ["first", undefined],
  );
  await runtime.close();
  user = undefined;
  const { runtime: silent } = fakeRuntime(server, readOnly);
  assert.equal(
    Object.hasOwn((await silent.call("runtime.status", {})).data as object, "userId"),
    false,
  );
  await silent.close();
});

test("условие по полю даты отправляется как date('…'); форма читается только для значения, записанного как дата", async () => {
  const f = shapedRuntime();
  const sent = () =>
    f.server.calls.filter(({ id }) => id === "native.lds.xQuery").map(({ args }) => args.query);
  await f.runtime.call("runtime.query", {
    catalog: "people",
    where: { lastname: "Иванов" },
    fields: ["id"],
  });
  assert.deepEqual(
    f.server.calls.map(({ id }) => id),
    ["native.lds.xQuery"],
    "no date in the condition: the form is not needed",
  );
  await f.runtime.call("runtime.query", {
    catalog: "people",
    where: { hire_date: { gte: "2024-01-01" }, lastname: "2024-01-01" },
    fields: ["id"],
  });
  assert.equal(
    sent()[1],
    "for $elem in people where ($elem/hire_date >= date('2024-01-01')) and ($elem/lastname = '2024-01-01') return $elem",
  );
  // Каталог, которого у сервера нет: запрос уходит как написан, а отказ сервера объясняется.
  await f.runtime.call("runtime.query", { catalog: "nobody", where: { hire_date: "2024-01-01" } });
  assert.equal(
    sent()[2],
    "for $elem in nobody where ($elem/hire_date = '2024-01-01') return $elem",
  );
  await f.runtime.close();
});

test("неверный ожидаемый тип называет фактический", async () => {
  const f = shapedRuntime();
  const result = await f.runtime.call("objects.get", { id: "1", type: "collaborator" });
  assert.equal(result.error?.code, "TYPE_MISMATCH");
  assert.deepEqual(result.error?.details, { actualType: "group" });
  assert.match(result.error!.message, /group/);
  await f.runtime.close();
});

test("отклонённый запрос не считается возможной записью, если только не передаёт SQL базе данных", async () => {
  const f = shapedRuntime((id) => id === "native.lds.xQuery");
  const query = await f.runtime.call("runtime.query", { query: "for $e in people retrun $e" });
  assert.equal(query.error?.code, "PLATFORM_SOAP-FAULT");
  assert.equal(query.error?.mutationOutcome, undefined);
  const sql = await f.runtime.call("runtime.query", { query: "sql: update t set a = 1" });
  assert.equal(sql.error?.mutationOutcome, "indeterminate");
  await f.runtime.close();
});

test("пустой элемент сырого ответа — пустая строка, а не его отступ", async () => {
  const { runtime } = fakeRuntime(
    { "*": { Catalogs: "\n\t\t\t", note: " ", lines: "a\n\tb" } },
    readOnly,
  );
  const result = await runtime.call("native.lds.getCatalogsStat", {});
  assert.deepEqual(result.data, { Catalogs: "", note: " ", lines: "a\n\tb" });
  await runtime.close();
});

test("несколько операций в одном вызове: шаги описываются, проверяются и классифицируются по сильнейшему шагу", async () => {
  const help = operationHelp(describeHcmOperation("runtime.batch"));
  const steps = (help.inputSchema.properties as Record<string, any>).steps;
  assert.deepEqual(Object.keys(steps.items.properties), ["id", "args", "as"]);
  assert.match(help.description, /\$ref/);
  assert.equal(help.details, undefined);
  const { runtime } = fakeRuntime({}, readOnly);
  assert.equal(
    runtime.getOperationEffect("runtime.batch", {
      steps: [{ id: "runtime.query", args: { catalog: "people" } }, { id: "objects.get" }],
    }),
    "read",
  );
  assert.equal(
    runtime.getOperationEffect("runtime.batch", {
      steps: [{ id: "objects.get" }, { id: "execute.script" }],
    }),
    "execute",
  );
  const wrong = await runtime.call("runtime.batch", { steps: [{ id: "objects.get", arg: {} }] });
  assert.equal(wrong.error?.code, "INVALID_ARGUMENT");
  assert.match(wrong.error!.message, /steps\[0\]\.arg/);
  await runtime.close();
});

test("пакет с записью и выполнением кода требует оба права; неизвестная операция шага отказывает раньше его аргументов", async () => {
  const steps = [
    { id: "objects.create", args: { type: "person", data: {} } },
    { id: "execute.script", args: { code: "RESULT=[];" } },
  ];
  for (const [permissions, code] of [
    [{ write: false, execute: true }, "WRITE_DISABLED"],
    [{ write: true, execute: false }, "EXECUTE_DISABLED"],
  ] as const) {
    const { runtime, server } = fakeRuntime({}, { permissions });
    assert.equal(runtime.getOperationEffect("runtime.batch", { steps }), "unknown");
    assert.equal((await runtime.call("runtime.batch", { steps })).error?.code, code);
    assert.equal(server.calls.length, 0);
    await runtime.close();
  }
  const { runtime } = fakeRuntime();
  assert.throws(
    () => runtime.getOperationEffect("runtime.batch", { steps: [{ id: "no.such", args: "x" }] }),
    { code: "UNKNOWN_OPERATION" },
  );
  await runtime.close();
});

test("ошибка называет инструмент MCP или команду CLI, а не ID операции", async () => {
  const failed: OperationResult = {
    ok: false,
    error: {
      code: "X",
      message: "schema.get failed.",
      hint: "schema.types lists the types; logs.follow shows the log; native.lds.xQuery stays.",
    },
    meta: { operationId: "runtime.query", connection: "t", durationMs: 0 },
  };
  assert.equal(
    errorInFrontendTerms(failed, "cli").error?.hint,
    "wtctl types lists the types; wtctl logs follow shows the log; native.lds.xQuery stays.",
  );
  assert.equal(errorInFrontendTerms(failed, "cli").error?.message, "wtctl schema failed.");
  const runtime: RuntimePort = {
    listOperations: () => ({ operations: [], total: 0 }),
    describe: () => {
      throw new Error("unused");
    },
    getOperationEffect: () => "read",
    call: async () => failed,
    close: async () => undefined,
  };
  const answer = mcpJson(await new HcmMcpTools(runtime).invoke("hcm_query", { catalog: "people" }));
  assert.equal(
    answer.error?.hint,
    "hcm_types lists the types; hcm_log_follow shows the log; native.lds.xQuery stays.",
  );
  assert.equal(answer.meta.operationId, "runtime.query");
  const closing = (hint: string, frontend: "mcp" | "cli") =>
    errorInFrontendTerms({ ...failed, error: { ...failed.error!, hint } }, frontend).error?.hint;
  assert.equal(
    closing("Каталоги и их типы объектов показывает schema.types.", "mcp"),
    "Каталоги и их типы объектов показывает hcm_types.",
  );
  assert.equal(
    closing("См. schema.types.extra и schema.types.", "cli"),
    "См. schema.types.extra и wtctl types.",
  );
});

test("неизвестный ID и похожие на него показываются как ID операций, а api.list — как вход вызывающего", async () => {
  const { runtime } = fakeRuntime();
  const unknown = await runtime.call("logs.lst");
  const own = await runtime.call("api.list");
  await runtime.close();
  const error = errorInFrontendTerms(unknown, "cli").error!;
  assert.equal(error.message, "Операции logs.lst нет.");
  assert.match(error.hint!, /^Похожие: (?:[a-z]+\.list, )*[a-z]+\.list\. /);
  assert.match(error.hint!, /Список операций показывает wtctl api list\.$/);
  // Подсказка строится по ID из details, а не разбором текста: другая формулировка ничего не меняет.
  const reworded = {
    ...unknown,
    error: { ...unknown.error!, hint: "Похожие операции: logs.list." },
  };
  assert.equal(errorInFrontendTerms(reworded, "cli").error?.hint, error.hint);
  assert.match(errorInFrontendTerms(unknown, "mcp").error!.hint!, /\.list\. .*hcm_api_list\.$/);
  assert.equal(
    errorInFrontendTerms(own, "mcp").error?.hint,
    "api.list вызывается как hcm_api_list, а не по ID операции.",
  );
});

test("каждая строка словаря имён входов называет операцию реестра, инструмент MCP-сервера и команду CLI", async () => {
  const { runtime } = fakeRuntime();
  const tools = new Set(new HcmMcpTools(runtime).list().map((tool) => tool.name));
  for (const [id, [tool, command]] of Object.entries(NAMES)) {
    // Эти две операции отвечают сами входы, в реестре их нет.
    if (id !== "api.list" && id !== "api.describe")
      assert.ok(operationDefinition(id), `${id}: нет в реестре`);
    assert.ok(tools.has(tool), `${id}: MCP-сервер не знает инструмента ${tool}`);
    const usage = (cliHelp(command.split(" ")[1]).usage ?? []) as string[];
    assert.ok(
      usage.some((line) => line === command || line.startsWith(`${command} `)),
      `${id}: справка CLI не знает команды ${command}`,
    );
  }
  await runtime.close();
});
