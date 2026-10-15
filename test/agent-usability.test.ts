// Что видит агент: объём первого контакта, обзор без поиска и ошибки,
// которые говорят, что исправить.
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
} from "../src/operation-help.js";
import { parseArguments } from "../src/cli/arguments.js";
import { cliHelp, cliHelpText } from "../src/cli/help.js";
import { commandInvocation, serializeResult } from "../src/cli/run.js";
import { HcmMcpTools } from "../src/mcp/server.js";
import { guide, guideTopics } from "../src/guide.js";
import { SchemaReader } from "../src/schema.js";
import { rpcValue } from "../src/server-value.js";
import { catalogQuery, queryPage } from "../src/query.js";
import { fileContent } from "../src/files.js";
import { logMatches, logNews } from "../src/log-output.js";
import { HcmError } from "../src/errors.js";
import type { CliIo, RuntimePort } from "../src/cli/types.js";
import type { OperationMap } from "../src/operation-map.js";
import { fakeRuntime, refuse } from "./fake-server.js";
import { mcpJson } from "./mcp-json.js";

test("обзор по задачам покрывает каждую операцию один раз и остаётся небольшим", () => {
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

test("обзор не требует поиска: без выбора выдаётся обзор, по теме — короткие карточки", () => {
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
  // Формулировка задачи по-русски находит операции, чьи идентификаторы английские.
  for (const [query, expected] of [
    ["файл", "files.read"],
    ["фонов", "web.spxml.getAsyncMethodStatus"],
    ["функци", "rpc.list"],
    ["upload", "web.pages.uploadFile"],
  ] as const)
    assert.ok(
      listHcmOperations({ query, limit: 100 }).operations.some((item) => item.id === expected),
      query,
    );
  assert.equal(operationTopic("native.lds.idle"), "protocol");
  assert.throws(() => listHcmOperations({ topic: "missing" }), { code: "UNKNOWN_TOPIC" });
});

test("справка CLI начинается с короткого списка команд; подробности — по каждой команде", () => {
  const top = cliHelp();
  const commands = Object.keys(top.commands as Record<string, string>);
  assert.ok(serializeResult(top).length < 3200, `top help is ${serializeResult(top).length} chars`);
  for (const command of commands) {
    const help = cliHelp(command) as { usage: string[]; notes?: string[]; error?: string };
    assert.equal(help.error, undefined, command);
    assert.ok(help.usage.length > 0, command);
    assert.ok(serializeResult(help).length < 1500, command);
    // Текст для человека: каждая строка использования и каждая заметка — на отдельной строке.
    const lines = cliHelpText(command).split("\n");
    for (const line of [...help.usage.map((usage) => `  ${usage}`), ...(help.notes ?? [])])
      assert.ok(lines.includes(line), `${command}: ${line}`);
  }
  assert.equal(typeof (cliHelp("missing") as { error: string }).error, "string");
});

test("вывод CLI — одна компактная строка, если только человек не читает его в терминале", () => {
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

test("правка принимает простой {path: value} и список путей на удаление, как бы её ни вызвали", async () => {
  const f = tools();
  await f.tools.invoke("hcm_object_patch", { id: "1", patch: { name: "N" }, remove: ["comment"] });
  await f.tools.invoke("hcm_object_patch", { id: "1", remove: ["a.b[0]"], preview: true });
  assert.deepEqual(f.calls, [
    { id: "objects.patch", args: { id: "1", patch: { name: "N" }, remove: ["comment"] } },
    { id: "objects.patch", args: { id: "1", remove: ["a.b[0]"], preview: true } },
  ]);
  // Сама операция принимает remove, поэтому его могут передать и программа, и шаг из нескольких операций.
  const { runtime } = fakeRuntime(
    {
      "native.lds.loadDoc": {
        kind: "binary",
        bytes: new TextEncoder().encode(
          "<group><id>1</id><name>G</name><comment>c</comment><code>k</code></group>",
        ),
      },
    },
    { permissions: { write: true, execute: false } },
  );
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

test("отклонённый вызов инструмента говорит, какое правило или ограничение нарушено", async () => {
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
  // Список ID заменяет id: вызов проходит со списком в том виде, как он передан.
  await f.tools.invoke("hcm_object_get", { ids: ["1", "2"], fields: ["name"] });
  assert.deepEqual(f.calls, [{ id: "objects.get", args: { ids: ["1", "2"], fields: ["name"] } }]);
});

test("вызов функции библиотеки возвращает значение простым JSON", () => {
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
  // У документа или элемента формы нет простого вида: возвращается разобранный ответ как есть.
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

test("schema показывает поля, которые есть только в строке каталога, чтобы поиск мог их использовать", async () => {
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

test("отказ в запросе по каталогу объясняется каталогом или полем, которого нет", async () => {
  const catalog = await reader().explainQuery("person", []);
  assert.equal(catalog?.code, "UNKNOWN_CATALOG");
  assert.match(catalog!.hint!, /^Похожие: people, person_groups\./);
  const field = await reader().explainQuery("people", ["lastname", "note", "missing"]);
  assert.equal(field?.code, "UNKNOWN_CATALOG_FIELD");
  assert.deepEqual(field?.details, { fields: ["note", "missing"] });
  assert.equal(await reader().explainQuery("people", ["lastname", "role_id"]), undefined);
  assert.equal(await reader().explainQuery("people", []), undefined);
  // Без формы каталога имена оценить нельзя; остаётся отказ сервера.
  assert.equal(await reader().explainQuery("person_groups", ["anything"]), undefined);
});

test("неизвестный тип так и назван, а не выдан голым отказом сервера", async () => {
  await assert.rejects(reader().get({ type: "persons" }), (error: unknown) => {
    assert.ok(error instanceof HcmError);
    assert.equal(error.code, "UNKNOWN_TYPE");
    assert.match(error.hint!, /Похожие: person/);
    return true;
  });
  // У имени каталога своя форма; ответ говорит, какой тип имелся в виду.
  assert.ok(
    (await reader().get({ type: "people" })).notes.includes(
      'people — имя каталога; поля его объектов показывает тип person, поля строки каталога — path:"person".',
    ),
  );
});

test("runtime объясняет отказ в поиске, а при голом HTTP 500 отсылает к логу сервера", async () => {
  const { runtime } = fakeRuntime(
    {
      "native.spxml2.getAppInfo": {
        default_db_name: "sample",
        databases: [{ id: "sample", catalogs: [{ id: "people", object_type: "person" }] }],
      },
      "*": refuse(),
    },
    { outputLimitBytes: 4096, permissions: { write: false, execute: true } },
  );
  try {
    const unknown = await runtime.call("runtime.query", { catalog: "persons" });
    assert.equal(unknown.error?.code, "UNKNOWN_CATALOG");
    assert.match(unknown.error!.hint!, /Похожие: people/);
    // Текст запроса называет настоящий каталог: причина не в именах.
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

test("ID, переданный строкой 0x, сравнивается как число, поэтому поиск по ID находит объект", () => {
  assert.equal(
    catalogQuery("collaborators", { id: "0x5555555555555501" }),
    "for $elem in collaborators where ($elem/id = 6148914691236517121) return $elem",
  );
  assert.equal(
    catalogQuery("collaborators", { org_id: { in: ["0x10", "0xFFFFFFFFFFFFFFFF"] }, code: "0x" }),
    "for $elem in collaborators where (($elem/org_id = 16 or $elem/org_id = 0xFFFFFFFFFFFFFFFF)) and ($elem/code = '0x') return $elem",
  );
});

test("неверный оператор условия получает подсказку, а «начинается с» — что его нет и чем обойтись", () => {
  for (const operator of ["startsWith", "$regex"])
    assert.throws(() => catalogQuery("collaborators", { fullname: { [operator]: "И" } }), {
      code: "INVALID_FILTER_OPERATOR",
      hint: /^Условий «начинается с» и шаблонов нет: .* Подходит contains/,
    });
  assert.throws(() => catalogQuery("collaborators", { role_id: { in: [] } }), {
    hint: /^Пример: \{role_id: \{in: /,
  });
  for (const condition of [{ nin: ["И"] }, {}])
    assert.throws(() => catalogQuery("collaborators", { fullname: condition }), {
      code: "INVALID_FILTER_OPERATOR",
      hint: /^Условие пишется как \{поле: \{оператор: значение\}\}/,
    });
});

test("пустое поле запрашивается в виде, на который все базы данных отвечают одинаково", () => {
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

test("дата попадает в поле даты как date('…'): дата в кавычках на PostgreSQL ничего не находит", () => {
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
  // Без формы о поле ничего не известно, а значение, не являющееся датой, остаётся строкой.
  assert.equal(
    catalogQuery("collaborators", { hire_date: "2024-01-01" }),
    "for $elem in collaborators where ($elem/hire_date = '2024-01-01') return $elem",
  );
  assert.equal(
    catalogQuery("collaborators", { hire_date: "yesterday" }, dates),
    "for $elem in collaborators where ($elem/hire_date = 'yesterday') return $elem",
  );
});

test("сырой запрос, который ничего не нашёл, — пустая страница, а не ошибка", () => {
  const blank = "\n\t\t\t";
  for (const response of [
    { Data: blank, TotalCount: "0", EOF: "true" },
    { Data: blank, EOF: "true" },
    { Data: { "#text": blank }, TotalCount: "0" },
  ])
    assert.deepEqual(queryPage(response, 0, 20, undefined, true).items, []);
  // Пробелы с положительным числом — это одно или несколько отдельных значений, которых страница строк вместить не может.
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

test("файл сервера возвращается текстом, если это UTF-8, и как base64 в остальных случаях", () => {
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
  // Десять байтов 00…09 — корректный UTF-8, но не текст; текст выдаётся байтами по запросу.
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

test("ответы лога умещаются в одну страницу, поэтому курсор и следующее смещение никогда не скрываются", () => {
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
  // Первый вызов только берёт позицию: последние десять событий, о пропущенных не сообщается.
  const first = logNews(follow as never, true, 100_000);
  assert.deepEqual(
    first.events.map((item) => item.sequence),
    events.slice(-10).map((item) => item.sequence),
  );
  assert.equal(first.omitted, undefined);
  // Следующие вызовы возвращают новое; если оно не умещается, остаются самые новые, а остальные считаются.
  const later = logNews(follow as never, false, 1000);
  assert.ok(later.events.length < 40 && later.events.length > 0);
  assert.equal(later.events.at(-1)?.sequence, 39);
  assert.equal(later.omitted, 40 - later.events.length);
  assert.equal(later.cursor, "c");
  assert.equal(logNews(follow as never, false, 100_000).omitted, undefined);
  // Страница поиска, которая не умещается, заканчивается раньше, и следующее смещение сдвигается назад вместе с ней.
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
  // Одно событие больше бюджета всё равно возвращается: пустая страница никогда бы не продвинулась.
  assert.equal(logMatches(search as never, 10).events.length, 1);
});

test("описание одной операции говорит, как передать данные, и не содержит служебных сведений реестра", () => {
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
  }
  assert.match(operationHelp(describeHcmOperation("native.lds.loadDoc")).details!, /files\.read/);
  // Обычная операция сохраняет схему реестра как есть.
  assert.deepEqual(
    operationHelp(describeHcmOperation("native.lds.deleteDoc")).inputSchema,
    describeHcmOperation("native.lds.deleteDoc").inputSchema,
  );
});

test("описания операций, инструментов MCP-сервера и тем гайда написаны по-русски", () => {
  const texts = [
    ...operations.map((item) => [item.id, item.description]),
    ...operations.map((item) => [item.id, operationHelp(item).description]),
    ...operations.map((item) => [item.id, operationHelp(item).details ?? "я"]),
    ...tools()
      .tools.list()
      .map((tool) => [tool.name, tool.description]),
    ...guideTopics().map((topic) => [topic, guide(topic).text]),
  ];
  for (const [name, text] of texts) assert.match(String(text), /[а-яё]/i, name);
});

test("сырой ответ сервера приходит без отступов XML и атрибутов пространств имён", async () => {
  const { runtime } = fakeRuntime(
    {
      "*": {
        Data: { group: { name: "A", note: " ", "#text": "\n\t\n" }, "#text": "\n" },
        "#text": "kept",
        "@_xmlns": "http://www.datex-soft.com/",
      },
    },
    { outputLimitBytes: 4096, permissions: { write: false, execute: false } },
  );
  try {
    const result = await runtime.call("native.lds.loadDoc", { url: "x-local://a.xml" });
    assert.deepEqual(result.data, { Data: { group: { name: "A", note: " " } }, "#text": "kept" });
  } finally {
    await runtime.close();
  }
});

test("загрузка отвечает адресом файла; файл, прочитанный как base64, приходит целиком", async () => {
  const { runtime } = fakeRuntime(
    { "web.pages.uploadFile": { Url: "123/report.txt" }, "*": { Data: "\nAAEC\nAwQF\n\t\t\t" } },
    {
      outputLimitBytes: 4096,
      runtimeDir: await mkdtemp(join(tmpdir(), "wtctl-upload-")),
      permissions: { write: true, execute: false },
    },
  );
  try {
    const uploaded = await runtime.call("web.pages.uploadFile", {
      filename: "report.txt",
      data: "x",
    });
    assert.deepEqual(uploaded.data, {
      url: "x-local://share/uploaded_files/123/report.txt",
      folderUrl: "x-local://share/uploaded_files/123",
    });
    const loaded = await runtime.call("files.read", { url: "x-local://a.bin" });
    assert.deepEqual(loaded.data, { base64: "AAECAwQF", bytes: 6 });
  } finally {
    await runtime.close();
  }
});

test("условия поиска можно брать из файла, чтобы кавычки JSON не зависели от оболочки", async () => {
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
  // Без --catalog объект JSON — весь набор аргументов; одни условия — ошибка.
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
