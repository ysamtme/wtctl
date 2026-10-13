// What the first trial on a real task found: a session the server dropped, answers whose form
// depended on the data, and errors that pointed the wrong way.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeHcmOperation } from "../src/catalog.js";
import { operationHelp } from "../src/operation-help.js";
import { errorInFrontendTerms } from "../src/frontend-names.js";
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

/** A server that knows only sessions opened at or after `validFrom`; older ones get HTTP 401. */
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

test("a session the server dropped is replaced by a new login and the request is sent again", async () => {
  const f = sessionServer();
  const runtime = new HcmRuntime(f.config);
  assert.equal((await runtime.call("runtime.status", {})).ok, true);
  f.state.validFrom = 2; // the server forgets the first session, as it does after idle time
  const again = await runtime.call("runtime.status", {});
  assert.equal(again.ok, true, JSON.stringify(again.error));
  assert.equal(f.state.opened, 2);
  // status also asks the server who is signed in and what its database is.
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
  // The server forgets the session again and nothing is called: closing must not fail on that.
  f.state.validFrom = 3;
  await runtime.close();
});

test("a refused login is final: one attempt, a hint about the credentials, nothing reported as run", async () => {
  const refused = sessionServer({ refuseLogin: true });
  const first = new HcmRuntime(refused.config);
  const login = await first.call("runtime.status", {});
  assert.equal(login.error?.code, "PLATFORM_AUTH");
  assert.match(login.error!.hint!, /user name and password|парол/i);
  assert.equal(refused.state.calls.filter((call) => call === "OpenSession").length, 1);
  await first.close();

  // The session is refused even after a new login: the error is reported, without a loop.
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

test("a refusal the server logs in Russian is an error-level event", () => {
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

test("the list of logs starts with the newest files and names each log by its file name", async () => {
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

test("a stored log is read and exported as its text, and the answer shows how it begins", async () => {
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
    assert.deepEqual(data.preview, { file: "a.log", text: text.slice(0, 1000), rows: [1, 2, 3] });
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

    // A result without a text has no text form: the refusal says which forms fit.
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

test("a repeated element is a list also when the object holds one item", async () => {
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
  // Scalar fields only: the form is not needed and is not requested again.
  const before = f.server.calls.length;
  const scalar = (await f.runtime.call("objects.get", { id: "1", fields: ["name"] })).data;
  assert.deepEqual((scalar as Record<string, unknown>).data, { name: "G" });
  assert.deepEqual(
    f.server.calls.slice(before).map(({ id }) => id),
    ["native.lds.loadDoc"],
  );
  await f.runtime.close();
});

test("a requested field the type does not have is named, an empty one too; a row of a search has every asked field", async () => {
  const f = shapedRuntime();
  const object = (
    await f.runtime.call("objects.get", { id: "1", fields: ["name", "code", "nope"] })
  ).data as Record<string, unknown>;
  assert.deepEqual(object.data, { name: "G" });
  assert.deepEqual([object.emptyFields, object.unknownFields], [["code"], ["nope"]]);
  for (const args of [
    { catalog: "people", fields: ["id", "roles", "lastname", "nope"] },
    { query: "for $e in people return $e", fields: ["id", "roles", "lastname", "nope"] },
  ]) {
    const page = (await f.runtime.call("runtime.query", args)).data as Record<string, any>;
    // An empty field asked by name comes as ""; a structure is left as the server gave it.
    assert.deepEqual(page.items, [
      { id: "1", roles: { role: [{ role_id: "admin" }] }, lastname: "" },
      { id: "2", lastname: "" },
    ]);
    assert.deepEqual(page.unknownFields, ["nope"]);
    assert.match(page.hint, /нет в строке каталога.*objects\.get/);
  }
  await f.runtime.close();
});

test("several objects are read in one call; one that is not read is named in its element", async () => {
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

test("status names the signed-in user when the server tells its document; a step of a batch keeps its name", async () => {
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

test("a condition on a date field is sent as date('…'); the form is read only for a value written as a date", async () => {
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
  // A catalog the server does not have: the query goes as written and the server's refusal is explained.
  await f.runtime.call("runtime.query", { catalog: "nobody", where: { hire_date: "2024-01-01" } });
  assert.equal(
    sent()[2],
    "for $elem in nobody where ($elem/hire_date = '2024-01-01') return $elem",
  );
  await f.runtime.close();
});

test("a wrong expected type names the actual one", async () => {
  const f = shapedRuntime();
  const result = await f.runtime.call("objects.get", { id: "1", type: "collaborator" });
  assert.equal(result.error?.code, "TYPE_MISMATCH");
  assert.deepEqual(result.error?.details, { actualType: "group" });
  assert.match(result.error!.message, /group/);
  await f.runtime.close();
});

test("a refused query is not reported as a possible write, unless it hands SQL to the database", async () => {
  const f = shapedRuntime((id) => id === "native.lds.xQuery");
  const query = await f.runtime.call("runtime.query", { query: "for $e in people retrun $e" });
  assert.equal(query.error?.code, "PLATFORM_SOAP-FAULT");
  assert.equal(query.error?.mutationOutcome, undefined);
  const sql = await f.runtime.call("runtime.query", { query: "sql: update t set a = 1" });
  assert.equal(sql.error?.mutationOutcome, "indeterminate");
  await f.runtime.close();
});

test("an empty element of a raw answer is an empty string, not its indentation", async () => {
  const { runtime } = fakeRuntime(
    { "*": { Catalogs: "\n\t\t\t", note: " ", lines: "a\n\tb" } },
    readOnly,
  );
  const result = await runtime.call("native.lds.getCatalogsStat", {});
  assert.deepEqual(result.data, { Catalogs: "", note: " ", lines: "a\n\tb" });
  await runtime.close();
});

test("several operations in one call: the steps are described, checked and classed by the strongest step", async () => {
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

test("an error names the tool or the command of the front end, not the operation ID", async () => {
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
