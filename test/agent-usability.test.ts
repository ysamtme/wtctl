// What an agent sees: the size of the first contact, discovery without search, and errors
// that say what to fix.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { describeHcmOperation, listHcmOperations } from "../src/catalog.js";
import { operationMap, operationTopic } from "../src/operation-map.js";
import { operations } from "../src/operations.js";
import {
  discoverOperations,
  operationHelp,
  type CompactOperationPage,
} from "../src/cli/discovery.js";
import { parseArguments } from "../src/cli/arguments.js";
import { cliHelp, cliHelpText } from "../src/cli/help.js";
import { commandInvocation, serializeResult } from "../src/cli/run.js";
import { HcmMcpTools } from "../src/mcp/server.js";
import { SchemaReader } from "../src/schema.js";
import { rpcValue } from "../src/scripts.js";
import { catalogQuery, queryPage } from "../src/query.js";
import { fileContent } from "../src/files.js";
import { logMatches, logNews } from "../src/log-output.js";
import { HcmRuntime } from "../src/runtime.js";
import { HcmError } from "../src/errors.js";
import { WsHcmApiError } from "../src/protocol/error.js";
import type { CliIo, RuntimePort } from "../src/cli/types.js";
import type { OperationMap } from "../src/operation-map.js";
import { mcpJson } from "./mcp-json.js";

test("the overview by task covers every operation once and stays small", () => {
  const map = operationMap();
  const known = new Set(operations.map((operation) => operation.id));
  const listed = map.topics.flatMap((topic) => topic.operations ?? []);
  assert.equal(new Set(listed).size, listed.length);
  for (const id of listed) assert.ok(known.has(id), id);
  const counted = map.topics.reduce(
    (sum, topic) => sum + (topic.operations?.length ?? topic.count ?? 0),
    0,
  );
  assert.equal(counted, operations.length, "no operation is outside the overview");
  assert.equal(map.total, operations.length);
  assert.equal(
    Object.values(map.effects).reduce((sum, count) => sum + count, 0),
    operations.length,
  );
  for (const topic of map.topics)
    assert.equal(
      listHcmOperations({ topic: topic.topic, limit: 1000 }).total,
      topic.operations?.length ?? topic.count,
      topic.topic,
    );
  assert.ok(JSON.stringify(map).length < 3000, `overview is ${JSON.stringify(map).length} chars`);
});

test("discovery needs no search: no selection gives the overview, a topic gives short cards", () => {
  const overview = discoverOperations(listHcmOperations, {}) as OperationMap;
  assert.ok(overview.topics.length >= 5);
  assert.ok("topics" in discoverOperations(listHcmOperations, { limit: 100 }));
  const files = discoverOperations(listHcmOperations, { topic: "files" }) as CompactOperationPage;
  assert.deepEqual(
    files.operations.map((card) => card.id),
    overview.topics.find((topic) => topic.topic === "files")?.operations,
    "a topic lists its operations in the order of the overview",
  );
  for (const card of files.operations) {
    assert.deepEqual(Object.keys(card), ["id", "topic", "effect", "description"]);
    assert.ok(card.description.length <= 200);
    assert.match(card.description, /[а-яё]/i);
  }
  // Task wording in Russian finds operations whose identifiers are English.
  for (const [query, expected] of [
    ["файл", "native.lds.loadUrl"],
    ["фонов", "web.spxml.getAsyncMethodStatus"],
    ["функци", "rpc.list"],
    ["upload", "web.pages.uploadFile"],
  ] as const)
    assert.ok(
      listHcmOperations({ query, limit: 100 }).operations.some((item) => item.id === expected),
      query,
    );
  assert.equal(operationTopic("web.lds.eval"), "protocol");
  assert.throws(() => listHcmOperations({ topic: "missing" }), { code: "UNKNOWN_TOPIC" });
});

test("CLI help opens with a short command list; details are per command", () => {
  const top = cliHelp();
  const commands = Object.keys(top.commands as Record<string, string>);
  assert.ok(serializeResult(top).length < 3200, `top help is ${serializeResult(top).length} chars`);
  for (const command of commands) {
    const help = cliHelp(command) as { usage: string[]; notes?: string[]; error?: string };
    assert.equal(help.error, undefined, command);
    assert.ok(help.usage.length > 0, command);
    assert.ok(serializeResult(help).length < 1500, command);
    // The text a person reads has every usage line and every note on a line of its own.
    const lines = cliHelpText(command).split("\n");
    for (const line of [...help.usage.map((usage) => `  ${usage}`), ...(help.notes ?? [])])
      assert.ok(lines.includes(line), `${command}: ${line}`);
  }
  assert.equal(typeof (cliHelp("missing") as { error: string }).error, "string");
});

test("CLI output is one compact line unless a person reads it at a terminal", () => {
  const value = { ok: true, data: { items: [{ id: "0x1" }] } };
  assert.equal(serializeResult(value), `${JSON.stringify(value)}\n`);
  assert.equal(serializeResult(value, true), `${JSON.stringify(value, null, 2)}\n`);
});

function tools() {
  const calls: { id: string; args: Record<string, unknown> }[] = [];
  const runtime: RuntimePort = {
    listOperations: listHcmOperations,
    describe: () => {
      throw new Error("unused");
    },
    getOperationEffect: () => "read",
    call: async (id, args = {}) => {
      calls.push({ id, args });
      return { ok: true, data: {}, meta: { operationId: id, connection: "t", durationMs: 0 } };
    },
    close: async () => undefined,
  };
  return { calls, tools: new HcmMcpTools(runtime, { connectionName: "t" }) };
}

test("a patch takes plain {path: value} and a list of paths to remove, whichever way it is called", async () => {
  const f = tools();
  await f.tools.invoke("hcm_object_patch", { id: "1", patch: { name: "N" }, remove: ["comment"] });
  await f.tools.invoke("hcm_object_patch", { id: "1", remove: ["a.b[0]"], preview: true });
  assert.deepEqual(f.calls, [
    { id: "objects.patch", args: { id: "1", patch: { name: "N" }, remove: ["comment"] } },
    { id: "objects.patch", args: { id: "1", remove: ["a.b[0]"], preview: true } },
  ]);
  // The operation itself takes remove, so a program and a step of several operations can pass it too.
  const runtime = new HcmRuntime({
    name: "t",
    baseUrl: "http://fixture.invalid/",
    timeoutMs: 1000,
    maxResponseBytes: 1024 * 1024,
    outputLimitBytes: 65536,
    runtimeDir: ".unused",
    permissions: { write: true, execute: false },
  });
  runtime.gateway.close = async () => undefined;
  runtime.gateway.call = async (id) => {
    assert.equal(id, "native.lds.loadDoc");
    return {
      kind: "binary",
      bytes: new TextEncoder().encode(
        "<group><id>1</id><name>G</name><comment>c</comment><code>k</code></group>",
      ),
    };
  };
  try {
    const changes = async (args: Record<string, unknown>) =>
      ((await runtime.call("objects.patch", { id: "1", preview: true, ...args })).data as any)
        .changes;
    assert.deepEqual(await changes({ patch: { name: "N" }, remove: ["comment"] }), [
      { op: "set", path: "name", before: "G", after: "N" },
      { op: "remove", path: "comment", before: "c" },
    ]);
    assert.deepEqual(await changes({ remove: ["code"] }), [
      { op: "remove", path: "code", before: "k" },
    ]);
    const neither = await runtime.call("objects.patch", { id: "1", preview: true });
    assert.equal(neither.error?.code, "INVALID_ARGUMENT");
    assert.match(neither.error!.message, /patch, remove или оба/);
    const wrong = await runtime.call("objects.patch", { id: "1", remove: "comment" });
    assert.notEqual(wrong.ok, true);
  } finally {
    await runtime.close();
  }
});

test("a rejected tool call says which rule or limit was broken", async () => {
  const f = tools();
  const validation = async (name: string, args: unknown) =>
    (mcpJson(await f.tools.invoke(name, args)).error?.details as { validation: unknown[] })
      .validation;
  assert.deepEqual(await validation("hcm_object_get", {}), [
    { path: "", code: "custom", message: "Укажи id, url или ids." },
  ]);
  assert.deepEqual(await validation("hcm_schema", { search: "x" }), [
    {
      path: "",
      code: "custom",
      message:
        "Укажи type или url: search ищет поля внутри типа, сам тип по словам ищет hcm_types.",
    },
  ]);
  assert.deepEqual(await validation("hcm_log_read", { file: "a.log", full: true, tailBytes: 1 }), [
    { path: "", code: "custom", message: "Укажи full или tailBytes, но не оба." },
  ]);
  assert.deepEqual(await validation("hcm_query", { catalog: "c", limit: 5000 }), [
    { path: "limit", code: "too_big", maximum: 1000 },
  ]);
  assert.equal(f.calls.length, 0);
  // A list of IDs stands for id: the call goes through with the list as it was given.
  await f.tools.invoke("hcm_object_get", { ids: ["1", "2"], fields: ["name"] });
  assert.deepEqual(f.calls, [{ id: "objects.get", args: { ids: ["1", "2"], fields: ["name"] } }]);
});

test("a library function call returns its value as plain JSON", () => {
  const typed = (result: unknown) => ({ valueType: "x", xml: { ResultData: { Result: result } } });
  assert.deepEqual(rpcValue(typed({ "#text": "2025.2", "@_VALUE-TYPE": "string" })), {
    value: "2025.2",
  });
  assert.deepEqual(
    rpcValue(
      typed({
        "@_VALUE-TYPE": "Object",
        count: { "#text": "3", "@_VALUE-TYPE": "integer" },
        names: { "@_VALUE-TYPE": "Array", e: [{ "#text": "a", "@_VALUE-TYPE": "string" }] },
      }),
    ),
    { value: { count: "3", names: ["a"] } },
  );
  // A document or form element has no plain form: the parsed response is returned as it is.
  const document = typed({ "@_VALUE-TYPE": "XmDoc", root: { name: "x" } });
  assert.equal(rpcValue(document), document);
});

const catalogForm = "x-local://wtv/wtv_people.xmd";
function reader() {
  const forms = new Map([
    [
      "x-local://wtv/wtv_person.xmd",
      '<SPXML-FORM><person><id TYPE="integer"/><lastname TYPE="string"/><note TYPE="string"/></person></SPXML-FORM>',
    ],
    [
      catalogForm,
      '<SPXML-FORM><people><person MULTIPLE="1" PRIMARY-KEY="id"><id TYPE="integer"/><lastname TYPE="string"/><role_id TYPE="string" TITLE="##\'Роль\'##"/></person></people></SPXML-FORM>',
    ],
  ]);
  return new SchemaReader(
    async () => ({
      default_db_name: "sample",
      databases: [
        {
          id: "sample",
          catalogs: [
            { id: "people", object_type: "person", form_url: catalogForm },
            { id: "person_groups", object_type: "person_group" },
          ],
        },
      ],
      shared_docs: [],
    }),
    async (url) => {
      const source = forms.get(url);
      if (source === undefined) throw new Error("Fixture form is unavailable");
      return source;
    },
    async () => ({}),
  );
}

test("schema shows fields that exist only in the catalog row, so a search can use them", async () => {
  const schema = await reader().get({ type: "person" });
  assert.deepEqual(
    schema.fields.map((field) => [field.path, field.origin, field.query ?? false]),
    [
      ["id", "own", true],
      ["lastname", "own", true],
      ["note", "own", false],
      ["role_id", "catalog", true],
    ],
  );
  assert.equal(schema.fields.at(-1)?.title, "Роль");
  assert.deepEqual(
    (await reader().get({ type: "person", origin: ["catalog"] })).fields.map((field) => field.path),
    ["role_id"],
  );
});

test("a refused catalog query is explained by the catalog or the field that does not exist", async () => {
  const catalog = await reader().explainQuery("person", []);
  assert.equal(catalog?.code, "UNKNOWN_CATALOG");
  assert.match(catalog!.hint!, /^Похожие: people, person_groups\./);
  const field = await reader().explainQuery("people", ["lastname", "note", "missing"]);
  assert.equal(field?.code, "UNKNOWN_CATALOG_FIELD");
  assert.deepEqual(field?.details, { fields: ["note", "missing"] });
  assert.equal(await reader().explainQuery("people", ["lastname", "role_id"]), undefined);
  assert.equal(await reader().explainQuery("people", []), undefined);
  // Without a catalog form the names cannot be judged; the server's refusal stands.
  assert.equal(await reader().explainQuery("person_groups", ["anything"]), undefined);
});

test("an unknown type is named as such instead of a bare server failure", async () => {
  await assert.rejects(reader().get({ type: "persons" }), (error: unknown) => {
    assert.ok(error instanceof HcmError);
    assert.equal(error.code, "UNKNOWN_TYPE");
    assert.match(error.hint!, /Похожие: person/);
    return true;
  });
  // A catalog name has a form of its own; the answer says which type was meant.
  assert.ok(
    (await reader().get({ type: "people" })).notes.includes(
      'people — имя каталога; поля его объектов показывает тип person, поля строки каталога — path:"person".',
    ),
  );
});

test("the runtime explains a refused search and points a bare HTTP 500 to the server log", async () => {
  const runtime = new HcmRuntime({
    name: "t",
    baseUrl: "http://fixture.invalid/",
    timeoutMs: 1000,
    maxResponseBytes: 1024 * 1024,
    outputLimitBytes: 4096,
    runtimeDir: ".unused",
    permissions: { write: false, execute: true },
  });
  const refusal = () =>
    new WsHcmApiError("soap-fault", "Internal Server Error", { operation: "XQuery", status: 500 });
  runtime.gateway.call = async (id) => {
    if (id === "native.spxml2.getAppInfo")
      return {
        default_db_name: "sample",
        databases: [{ id: "sample", catalogs: [{ id: "people", object_type: "person" }] }],
      };
    throw refusal();
  };
  runtime.gateway.close = async () => undefined;
  try {
    const unknown = await runtime.call("runtime.query", { catalog: "persons" });
    assert.equal(unknown.error?.code, "UNKNOWN_CATALOG");
    assert.match(unknown.error!.hint!, /Похожие: people/);
    // A query text that names a real catalog: the cause is not in the names.
    const raw = await runtime.call("runtime.query", {
      query: "for $e in people where no_such($e/id) return $e",
    });
    assert.equal(raw.error?.code, "PLATFORM_SOAP-FAULT");
    assert.match(raw.error!.hint!, /нет такого каталога или поля.*логе xhttp/);
    const object = await runtime.call("objects.get", { id: "1" });
    assert.match(object.error!.hint!, /объекта с таким ID.*логе xhttp/);
  } finally {
    await runtime.close();
  }
});

test("an ID passed as a 0x string is compared as a number, so a search by ID finds the object", () => {
  assert.equal(
    catalogQuery("collaborators", { id: "0x5555555555555501" }),
    "for $elem in collaborators where ($elem/id = 6148914691236517121) return $elem",
  );
  assert.equal(
    catalogQuery("collaborators", { org_id: { in: ["0x10", "0xFFFFFFFFFFFFFFFF"] }, code: "0x" }),
    "for $elem in collaborators where (($elem/org_id = 16 or $elem/org_id = 0xFFFFFFFFFFFFFFFF)) and ($elem/code = '0x') return $elem",
  );
});

test("an empty field is asked in the form that every database answers the same way", () => {
  assert.equal(
    catalogQuery("resources", {
      code: "",
      role_id: null,
      size: { eq: "" },
      name: { ne: "" },
      type: { ne: null, in: ["img", ""] },
    }),
    "for $elem in resources where (($elem/code = '' or IsEmpty($elem/code) = true()))" +
      " and (($elem/role_id = '' or IsEmpty($elem/role_id) = true()))" +
      " and (($elem/size = '' or IsEmpty($elem/size) = true())) and (IsEmpty($elem/name) = false())" +
      " and (IsEmpty($elem/type) = false())" +
      " and (($elem/type = 'img' or ($elem/type = '' or IsEmpty($elem/type) = true()))) return $elem",
  );
});

test("a date reaches a date field as date('…'): a quoted date finds nothing on PostgreSQL", () => {
  const dates = new Set(["hire_date", "birth_date"]);
  assert.equal(
    catalogQuery(
      "collaborators",
      {
        hire_date: { gte: "2024-01-01", lt: "2024-02-01T10:30:00" },
        birth_date: { in: ["1990-05-01", ""] },
        code: "2024-01-01",
      },
      dates,
    ),
    "for $elem in collaborators where ($elem/hire_date >= date('2024-01-01')) and ($elem/hire_date < date('2024-02-01T10:30:00'))" +
      " and (($elem/birth_date = date('1990-05-01') or ($elem/birth_date = '' or IsEmpty($elem/birth_date) = true()))) and ($elem/code = '2024-01-01') return $elem",
  );
  // Without the form nothing is known about the field, and a value that is not a date stays a string.
  assert.equal(
    catalogQuery("collaborators", { hire_date: "2024-01-01" }),
    "for $elem in collaborators where ($elem/hire_date = '2024-01-01') return $elem",
  );
  assert.equal(
    catalogQuery("collaborators", { hire_date: "yesterday" }, dates),
    "for $elem in collaborators where ($elem/hire_date = 'yesterday') return $elem",
  );
});

test("a raw query that finds nothing is an empty page, not an error", () => {
  const blank = "\n\t\t\t";
  for (const response of [
    { Data: blank, TotalCount: "0", EOF: "true" },
    { Data: blank, EOF: "true" },
    { Data: { "#text": blank }, TotalCount: "0" },
  ])
    assert.deepEqual(queryPage(response, 0, 20, undefined, true).items, []);
  // Whitespace with a positive count is one or more separate values, which a row page cannot hold.
  assert.throws(
    () => queryPage({ Data: blank, TotalCount: "1", EOF: "true" }, 0, 20, undefined, true),
    {
      code: "QUERY_REPRESENTATION",
    },
  );
  assert.throws(() => queryPage({ Data: blank }, 0, 20, undefined, true), {
    code: "QUERY_REPRESENTATION",
  });
});

test("a server file is returned as text when it is UTF-8 and as base64 otherwise", () => {
  const lines = (bytes: Buffer) =>
    `\n${bytes.toString("base64").replace(/(.{20})/g, "$1\n")}\n\t\t`;
  const text = Buffer.from("﻿<a>Привет</a>", "utf8");
  assert.deepEqual(fileContent({ Data: lines(text), "#text": "\n" }), {
    text: "<a>Привет</a>",
    bytes: text.length,
  });
  assert.deepEqual(fileContent({ Data: "" }), { text: "", bytes: 0 });
  const binary = Buffer.from([0xff, 0xfe, 0x00, 0x80]);
  assert.deepEqual(fileContent({ Data: lines(binary) }), {
    base64: binary.toString("base64"),
    bytes: 4,
  });
  // Ten bytes 00…09 are valid UTF-8 and still not a text; a text is given as bytes on request.
  const low = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(fileContent({ Data: lines(low) }), { base64: "AAECAwQFBgcICQ==", bytes: 10 });
  assert.deepEqual(fileContent({ Data: lines(Buffer.from("a\tb\r\nc")) }), {
    text: "a\tb\r\nc",
    bytes: 6,
  });
  assert.deepEqual(fileContent({ Data: lines(Buffer.from("ab")) }, "base64"), {
    base64: "YWI=",
    bytes: 2,
  });
  assert.throws(() => fileContent({ Data: "" }, "hex"), { code: "INVALID_ARGUMENT" });
  assert.throws(() => fileContent({ Data: { nested: "x" } }), { code: "FILE_READ_RESPONSE" });
});

test("log replies stay within one page, so the cursor and the next offset are never hidden", () => {
  const file = {
    name: "a.log",
    url: "x-local://Logs/a.log",
    type: "a",
    title: "A",
    sizeBytes: "1",
  };
  const event = (sequence: number) => ({
    sequence,
    level: "error" as const,
    message: "m".repeat(90),
    text: "m".repeat(90),
    line: sequence,
  });
  const events = Array.from({ length: 40 }, (_, index) => event(index));
  const follow = {
    file,
    events,
    cursor: "c",
    changed: true,
    gapPossible: false,
    windowTruncated: false,
  };
  // The first call only takes a position: the last ten events, nothing reported as left out.
  const first = logNews(follow as never, true, 100_000);
  assert.deepEqual(
    first.events.map((item) => item.sequence),
    events.slice(-10).map((item) => item.sequence),
  );
  assert.equal(first.omitted, undefined);
  // Later calls return what is new; when it does not fit, the newest are kept and the rest counted.
  const later = logNews(follow as never, false, 1000);
  assert.ok(later.events.length < 40 && later.events.length > 0);
  assert.equal(later.events.at(-1)?.sequence, 39);
  assert.equal(later.omitted, 40 - later.events.length);
  assert.equal(later.cursor, "c");
  assert.equal(logNews(follow as never, false, 100_000).omitted, undefined);
  // A search page that does not fit ends earlier and its next offset moves back with it.
  const search = {
    file,
    events: events.slice(0, 20),
    totalEvents: 40,
    matches: 40,
    fingerprint: "f",
    truncated: false,
    nextOffset: 30,
  };
  const page = logMatches(search as never, 1000);
  assert.ok(page.events.length < 20);
  assert.equal(page.nextOffset, 10 + page.events.length);
  assert.equal(logMatches(search as never, 100_000).nextOffset, 30);
  const last = logMatches({ ...search, nextOffset: undefined } as never, 100_000);
  assert.equal(last.nextOffset, undefined);
  // One event larger than the budget is still returned: an empty page would never advance.
  assert.equal(logMatches(search as never, 10).events.length, 1);
});

test("the description of one operation says how to pass data and leaves registry bookkeeping out", () => {
  const upload = operationHelp(describeHcmOperation("web.pages.uploadFile"));
  assert.deepEqual(Object.keys(upload), [
    "id",
    "topic",
    "effect",
    "description",
    "details",
    "inputSchema",
  ]);
  assert.match(upload.description, /[а-яё]/i);
  const properties = (name: string) =>
    (operationHelp(describeHcmOperation(name)).inputSchema.properties ?? {}) as Record<
      string,
      Record<string, unknown>
    >;
  assert.match(String(properties("web.pages.uploadFile").data?.description), /base64/);
  assert.deepEqual(properties("native.lds.putDoc").data, {
    type: "string",
    description: "Текст XML.",
  });
  for (const operation of operations) {
    const help = operationHelp(operation);
    assert.doesNotMatch(JSON.stringify(help), /x-normalization/, operation.id);
    // An operation of the overview is described for its caller: in Russian, without registry prose.
    if (operationTopic(operation.id) !== "protocol")
      for (const text of [help.description, help.details ?? "я"])
        assert.match(text, /[а-яё]/i, operation.id);
  }
  assert.match(operationHelp(describeHcmOperation("native.lds.loadDoc")).details!, /files\.read/);
  // A plain operation keeps its registry schema as it is.
  assert.deepEqual(
    operationHelp(describeHcmOperation("native.lds.deleteUrl")).inputSchema,
    describeHcmOperation("native.lds.deleteUrl").inputSchema,
  );
});

test("a raw server answer comes without XML indentation and namespace attributes", async () => {
  const runtime = new HcmRuntime({
    name: "t",
    baseUrl: "http://fixture.invalid/",
    timeoutMs: 1000,
    maxResponseBytes: 1024 * 1024,
    outputLimitBytes: 4096,
    runtimeDir: ".unused",
    permissions: { write: false, execute: false },
  });
  runtime.gateway.call = async () => ({
    Data: { group: { name: "A", note: " ", "#text": "\n\t\n" }, "#text": "\n" },
    "#text": "kept",
    "@_xmlns": "http://www.datex-soft.com/",
  });
  runtime.gateway.close = async () => undefined;
  try {
    const result = await runtime.call("native.lds.loadDoc", { url: "x-local://a.xml" });
    assert.deepEqual(result.data, { Data: { group: { name: "A", note: " " } }, "#text": "kept" });
  } finally {
    await runtime.close();
  }
});

test("an upload answers with the address of the file; a file read as base64 comes in one piece", async () => {
  const runtime = new HcmRuntime({
    name: "t",
    baseUrl: "http://fixture.invalid/",
    timeoutMs: 1000,
    maxResponseBytes: 1024 * 1024,
    outputLimitBytes: 4096,
    runtimeDir: await mkdtemp(join(tmpdir(), "wtctl-upload-")),
    permissions: { write: true, execute: false },
  });
  runtime.gateway.call = async (id) =>
    id === "web.pages.uploadFile" ? { Url: "123/report.txt" } : { Data: "\nAAEC\nAwQF\n\t\t\t" };
  runtime.gateway.close = async () => undefined;
  try {
    const uploaded = await runtime.call("web.pages.uploadFile", {
      filename: "report.txt",
      data: "x",
    });
    assert.deepEqual(uploaded.data, {
      url: "x-local://share/uploaded_files/123/report.txt",
      folderUrl: "x-local://share/uploaded_files/123",
    });
    const loaded = await runtime.call("native.lds.loadUrl", { url: "x-local://a.bin" });
    assert.deepEqual(loaded.data, { Data: "AAECAwQF" });
  } finally {
    await runtime.close();
  }
});

test("search conditions can come from a file, so JSON quoting does not depend on the shell", async () => {
  const io = {
    readFile: async () => '{"is_dismiss":false}',
  } as unknown as CliIo;
  const fromFile = await commandInvocation(
    parseArguments(["query", "--catalog", "people", "--input-file", "where.json"]),
    io,
  );
  assert.deepEqual(fromFile.args, { catalog: "people", where: { is_dismiss: false } });
  await assert.rejects(
    commandInvocation(
      parseArguments(["query", "--catalog", "people", "--input-file", "w.json", "--where", "{}"]),
      io,
    ),
    /Условия заданы/,
  );
  // Without --catalog a JSON object is the whole set of arguments; conditions alone are a mistake.
  await assert.rejects(
    commandInvocation(parseArguments(["query", "--input-file", "where.json"]), io),
    /нет ни catalog, ни query/,
  );
  const whole = await commandInvocation(parseArguments(["query", "--input-file", "q.json"]), {
    readFile: async () => '{"catalog":"people","where":{"is_dismiss":false},"fields":["id"]}',
  } as unknown as CliIo);
  assert.deepEqual(whole.args, {
    catalog: "people",
    where: { is_dismiss: false },
    fields: ["id"],
  });
});
