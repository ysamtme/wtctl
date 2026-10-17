import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SchemaReader, type SchemaResult, type SchemaTypesResult } from "../src/schema.js";
import { buildXml, type XmlObject } from "../src/protocol/xml.js";
import { fakeRuntime, refusal, type Script } from "./fake-server.js";

const personUrl = "x-local://wtv/wtv_person.xmd";
const catalogUrl = "x-local://wtv/wtv_people.xmd";
const commonUrl = "x-local://wtv/wtv_common.xml";
const customUrl = "x-local://sample/lists/wtv_custom_templates.xml";
const languageUrl = "x-local://lngs/russian/const.xml";
const kindId = "9223372036854775807";
const wrap = (source: string) => `<SPXML-FORM>${source}</SPXML-FORM>`;
const forms = new Map([
  [
    personUrl,
    wrap(`<USE FORM="//wtv/base/person.xmd"/><person>
      <INHERIT TYPE="person_base"/>
      <manager_id TYPE="integer" FOREIGN-ARRAY="people" NOT-NULL="1" TITLE="Менеджер"/>
      <doc_info TYPE="doc_info_base" TITLE="Информация"><comment TYPE="string"/></doc_info>
      <codes MULTIPLE="1" PRIMARY-KEY="code"><code TYPE="string"/></codes>
      <status PROPERTY="1" TYPE="string" TITLE="##'Статус'##"/>
      <untranslated TYPE="string" TITLE="const=c_missing"/>
      <assign PROPERTY="1" PARAM="course_id" PARAM="date" PARAM="date"/>
      <get_groups PROPERTY="1"/><cached TEMP="1" TYPE="string"/><OnCreate/><DocDesc/>
    </person>`),
  ],
  [
    "x-local://wtv/base/person.xmd",
    wrap(`<USE FORM="name.xmd"/><person_base SAMPLE="1">
      <INHERIT TYPE="person_name_base"/><email TYPE="string" TITLE="Электронная почта"/>
      <fullname PROPERTY="1" EXPR="lastname &amp;&amp; firstname && middlename"/>
      <get_courses PROPERTY="1" PARAM="filter"/>
    </person_base>`),
  ],
  [
    "x-local://wtv/base/name.xmd",
    wrap(`<person_name_base SAMPLE="1"><lastname TYPE="string" TITLE="const=c_last"/></person_name_base>
      <doc_info_base><owner TYPE="integer"/><created TYPE="date"/></doc_info_base>`),
  ],
  [
    catalogUrl,
    wrap(`<people><person MULTIPLE="1" PRIMARY-KEY="id">
      <lastname TYPE="string"/><email TYPE="string"/><fullname TYPE="string" TITLE="const=c_full"/>
      <manager_id TYPE="integer"/>
    </person></people>`),
  ],
  ["x-local://wtv/wtv_request.xmd", wrap('<request><name TYPE="string"/></request>')],
  ["x-local://qti/assessment.xmd", wrap('<assessment><title TYPE="string"/></assessment>')],
]);
const applicationInfo = {
  default_db_name: "sample",
  ui_lang_id: "ru",
  databases: [
    {
      id: "sample",
      catalogs: [
        { id: "people", object_type: "person", form_url: catalogUrl },
        { id: "requests", object_type: "request" },
        { id: "components", object_type: "component" },
      ],
    },
  ],
  shared_docs: [
    { id: "common", url: commonUrl },
    { id: "custom_templates", url: customUrl },
  ],
};
const documents = new Map<string, XmlObject>([
  [
    commonUrl,
    {
      exchange_object_types: {
        exchange_object_type: [
          { name: "person", web_const: "c_person", form_url: personUrl },
          { name: "request", web_const: "c_request" },
          { name: "assessment", form_url: "x-local://qti/assessment.xmd" },
        ],
      },
    },
  ],
  [
    languageUrl,
    {
      items: {
        item: [
          { id: "c_last", val: "Фамилия" },
          { id: "c_full", val: "ФИО" },
          { id: "c_person", val: "Сотрудник" },
          { id: "c_request", val: "Заявка" },
        ],
      },
    },
  ],
  ["x-local://lngs/english/const.xml", { item: { id: "c_last", val: "Surname" } }],
  [
    customUrl,
    {
      person: {
        fields: {
          field: {
            name: "tab_num",
            type: "string",
            title: "Табельный номер",
            is_required: "1",
            entries: { entry: [{ value: "A" }, { value: "Б" }] },
            sheet_id: "main",
          },
        },
        sheets: { sheet: { id: "main", title: "Кадры" } },
      },
      request: {
        template_field: "request_type",
        fields: { field: { name: "shared", type: "bool", title: "Общее" } },
      },
      request_type: {
        items: {
          item: [
            {
              id: kindId,
              fields: {
                field: {
                  name: "position_name",
                  type: "string",
                  title: "Должность",
                  catalog: "positions",
                },
              },
            },
            { id: "2", fields: { field: { name: "other", type: "integer" } } },
          ],
        },
      },
    },
  ],
]);

function fixture(options: { forms?: Map<string, string>; documents?: typeof documents } = {}) {
  const formCalls: string[] = [];
  const documentCalls: string[] = [];
  const sourceForms = options.forms ?? forms;
  const sourceDocuments = options.documents ?? documents;
  const reader = new SchemaReader(
    async () => structuredClone(applicationInfo),
    async (url) => {
      formCalls.push(url);
      if (url === commonUrl) return buildXml({ common: sourceDocuments.get(url)! });
      const source = sourceForms.get(url);
      if (source === undefined) throw new Error("Fixture form is unavailable");
      return source;
    },
    async (url) => {
      documentCalls.push(url);
      const document = sourceDocuments.get(url);
      if (document === undefined) throw new Error("Fixture document is unavailable");
      return structuredClone(document);
    },
  );
  return { reader, formCalls, documentCalls };
}

test("вложенные USE и наследование сохраняют базовое происхождение основной формы и семантику каталога", async () => {
  const { reader, formCalls } = fixture();
  const result = await reader.get({ type: "person" });
  assert.equal(result.type, "person");
  assert.equal(result.catalog, "people");
  assert.equal(result.formUrl, personUrl);
  assert.deepEqual(result.notes, []);
  assert.deepEqual(
    result.fields.find((field) => field.path === "lastname"),
    {
      path: "lastname",
      type: "string",
      title: "Фамилия",
      origin: "inherited:person_base",
      query: true,
    },
  );
  assert.deepEqual(
    result.fields.find((field) => field.path === "fullname"),
    {
      path: "fullname",
      type: "string",
      title: "ФИО",
      origin: "inherited:person_base",
      computed: true,
      query: true,
    },
  );
  const manager = result.fields.find((field) => field.path === "manager_id");
  assert.equal(manager?.references, "people");
  assert.equal(manager?.required, true);
  assert.equal(manager?.origin, "own");
  assert.equal(manager?.query, true);
  assert.equal(result.fields.find((field) => field.path === "status")?.computed, true);
  assert.equal(result.fields.find((field) => field.path === "status")?.title, "Статус");
  // Название, которого нет в языковом файле, названием не считается.
  assert.equal(result.fields.find((field) => field.path === "untranslated")?.title, undefined);
  assert.equal(result.fields.find((field) => field.path === "doc_info")?.children, 3);
  // Структура, заданная базовым типом, — такая же структура, как остальные.
  assert.equal(result.fields.find((field) => field.path === "doc_info")?.type, "element");
  const codes = result.fields.find((field) => field.path === "codes");
  assert.equal(codes?.multiple, true);
  assert.equal(codes?.key, "code");
  assert.equal(result.methods, undefined);
  assert.ok(
    result.fields.every(
      (field) => !/assign|get_groups|get_courses|cached|OnCreate|DocDesc/.test(field.path),
    ),
  );
  assert.ok(result.fields.every((field) => !field.path.startsWith("doc_info.")));
  assert.equal(formCalls.filter((url) => url === "x-local://wtv/base/name.xmd").length, 1);
});

test("можно выбирать путь, глубокий поиск без учёта регистра, происхождение и повторяющиеся параметры метода", async () => {
  const { reader } = fixture();
  const children = await reader.get({ type: "person", path: "doc_info" });
  assert.deepEqual(
    children.fields.map((field) => field.path),
    ["doc_info.owner", "doc_info.created", "doc_info.comment"],
  );
  const search = await reader.get({ type: "person", search: "CREATED" });
  assert.deepEqual(
    search.fields.map((field) => field.path),
    ["doc_info.created"],
  );
  const inherited = await reader.get({ type: "person", origin: ["inherited"], search: "email" });
  assert.equal(inherited.fields.length, 1);
  assert.equal(inherited.fields[0]?.query, true);
  assert.equal(inherited.fields[0]?.computed, undefined);
  assert.equal((await reader.get({ type: "person", origin: ["own"], search: "email" })).total, 0);
  // search сужает методы; найденный метод — это не «ничего не найдено».
  const sought = await reader.get({ type: "person", include: ["methods"], search: "assign" });
  assert.deepEqual([sought.methods?.map((method) => method.name), sought.notes], [["assign"], []]);
  const methods = await reader.get({ type: "person", include: ["methods"] });
  assert.deepEqual(
    methods.methods?.find((method) => method.name === "assign"),
    { name: "assign", parameters: ["course_id", "date", "date"] },
  );
  assert.deepEqual(
    methods.methods?.find((method) => method.name === "get_groups"),
    { name: "get_groups", parameters: [] },
  );
  assert.ok(methods.methods?.some((method) => method.name === "get_courses"));
  assert.ok(
    !methods.methods?.some((method) => method.name === "fullname" || method.name === "status"),
  );
  assert.equal(
    (await reader.get({ url: personUrl, search: "lastname", language: "english" })).fields[0]
      ?.title,
    "Surname",
  );
  // Короткое имя языка — та же папка.
  assert.equal(
    (await reader.get({ url: personUrl, search: "lastname", language: "en" })).fields[0]?.title,
    "Surname",
  );
});

test("настраиваемые поля включают значения и листы; kind, переданный как записан, добавляет только свои выбранные поля", async () => {
  const { reader } = fixture();
  const custom = await reader.get({ type: "person", search: "ТАБЕЛЬНЫЙ", origin: ["custom"] });
  assert.deepEqual(custom.fields, [
    {
      path: "custom_elems.custom_elem[name=tab_num].value",
      name: "tab_num",
      type: "string",
      title: "Табельный номер",
      origin: "custom",
      required: true,
      values: ["A", "Б"],
      sheet: "Кадры",
    },
  ]);
  const missingKind = await reader.get({ type: "request" });
  assert.equal(missingKind.notes.length, 1);
  assert.match(missingKind.notes[0]!, /request_type_id/);
  assert.match(missingKind.notes[0]!, /kind/);
  assert.ok(missingKind.fields.some((field) => field.name === "shared"));
  const selected = await reader.get({ type: "request", kind: kindId, origin: ["custom"] });
  assert.deepEqual(selected.fields.map((field) => field.name).sort(), ["position_name", "shared"]);
  assert.equal(
    selected.fields.find((field) => field.name === "position_name")?.references,
    "positions",
  );
  assert.deepEqual(selected.notes, []);
  const unknown = await reader.get({ type: "request", kind: "missing" });
  assert.equal(unknown.notes.length, 1);
  assert.match(unknown.notes[0]!, /missing/);
  assert.ok(unknown.fields.some((field) => field.name === "shared"));
  assert.ok(!unknown.fields.some((field) => field.name === "position_name"));
});

test("названия типов разбирают выражения без выполнения; прочитанные переводы JSON кэшируются, непрочитанные читаются заново", async () => {
  const definitions = new Map(documents);
  definitions.set(commonUrl, {
    exchange_object_types: {
      exchange_object_type: [
        { name: "person", title: " i18n.t( 'worker' ) ", web_const: "c_request" },
        { name: "request", title: "ms_tools.get_const('c_request')" },
        { name: "component", title: "'Компонент'" },
      ],
    },
  });
  const translatedForms = new Map(forms);
  const url = "x-local://i18n/common/ru/const.json";
  translatedForms.set(url, JSON.stringify({ worker: "Сотрудник" }));
  const { reader, formCalls } = fixture({ forms: translatedForms, documents: definitions });
  assert.deepEqual(
    (await reader.types()).types.map((item) => item.title),
    ["Сотрудник", "Заявка", "Компонент"],
  );
  assert.equal((await reader.types({ search: "сотрудник" })).types[0]?.type, "person");
  assert.equal(formCalls.filter((call) => call === url).length, 1);
  const missing = fixture({ documents: definitions });
  assert.equal((await missing.reader.types()).types[0]?.title, undefined);
  await missing.reader.types();
  assert.equal(missing.formCalls.filter((call) => call === url).length, 2);
  definitions.set(commonUrl, {
    exchange_object_types: {
      exchange_object_type: { name: "person", title: "unrecognized()", web_const: "c_person" },
    },
  });
  assert.equal(
    (await fixture({ documents: definitions }).reader.types()).types[0]?.title,
    "Сотрудник",
  );
});

test("отсутствующие именованные базы добавляют по одному примечанию на тип и сохраняют поля и собственные дочерние элементы", async () => {
  const incomplete = new Map(forms);
  incomplete.set(
    personUrl,
    wrap(`<person><INHERIT TYPE="absent"/><INHERIT TYPE="absent"/>
    <group TYPE="absent"><name TYPE="string"/></group><other TYPE="another"/>
    <dynamic TYPE="variant"/><record TYPE="record"/></person>`),
  );
  const { reader } = fixture({ forms: incomplete });
  const result = await reader.get({ type: "person", search: "group" });
  assert.equal(result.fields.map((field) => field.path).join(","), "group,group.name");
  assert.equal(result.fields[0]?.children, 1);
  assert.equal(result.notes.length, 2);
  assert.match(result.notes[0]!, /absent/);
  assert.match(result.notes[1]!, /another/);
});

test("обзор типов использует метаданные подключённого сервера, локализованные названия и числа настраиваемых полей", async () => {
  const { reader } = fixture();
  const result = await reader.types({ search: "PEOPLE" });
  assert.deepEqual(result.types, [
    { type: "person", catalog: "people", title: "Сотрудник", customFields: 1 },
  ]);
  assert.equal(result.total, 1);
  assert.equal((await reader.types({ search: "сотруд" })).types[0]?.type, "person");
  assert.equal((await reader.types({ search: "request" })).types[0]?.customFields, "by kind");
  const component = (await reader.types({ search: "component" })).types[0];
  assert.equal(component?.catalog, "components");
  assert.equal(component?.title, undefined);
  const page = await reader.types({ limit: 1 });
  assert.equal(page.types.length, 1);
  assert.equal(page.nextCursor, 1);
  assert.notEqual(
    (await reader.types({ limit: 1, cursor: page.nextCursor })).types[0]?.type,
    page.types[0]?.type,
  );
});

test("формы вне обычной папки берутся из common, а необязательные сбои чтения становятся примечаниями", async () => {
  const { reader, formCalls } = fixture();
  const assessment = await reader.get({ type: "assessment" });
  assert.equal(assessment.formUrl, "x-local://qti/assessment.xmd");
  assert.equal(assessment.fields[0]?.path, "title");
  assert.ok(formCalls.includes("x-local://wtv/wtv_assessment.xmd"));
  const unavailable = new Map(documents);
  unavailable.delete(languageUrl);
  unavailable.delete(customUrl);
  const result = await fixture({ documents: unavailable }).reader.get({ type: "person" });
  assert.equal(result.notes.length, 2);
  assert.ok(result.notes[0]?.startsWith(`Файл языка ${languageUrl} прочитать не удалось`));
  assert.equal(result.fields.find((field) => field.path === "lastname")?.title, "const=c_last");
});

test("страницы схемы соблюдают числа по умолчанию и потолок 16 КиБ в UTF-8, не теряя поля", async () => {
  const many = new Map(forms);
  const fields = Array.from(
    { length: 100 },
    (_, index) => `<f${index} TYPE="string" TITLE="${"Ж🙂".repeat(80)}"/>`,
  ).join("");
  many.set("x-local://wtv/wtv_many.xmd", wrap(`<many>${fields}</many>`));
  const { reader } = fixture({ forms: many });
  const first = await reader.get({ type: "many" });
  assert.equal(first.total, 100);
  assert.ok(first.fields.length > 0 && first.fields.length < 80);
  const paths: string[] = [];
  let cursor = 0;
  for (;;) {
    const page = await reader.get({ type: "many", cursor });
    assert.ok(Buffer.byteLength(JSON.stringify(page), "utf8") <= 16 * 1024);
    paths.push(...page.fields.map((field) => field.path));
    if (page.nextCursor === undefined) break;
    assert.equal(page.nextCursor, cursor + page.fields.length);
    cursor = page.nextCursor;
  }
  assert.deepEqual(
    paths,
    Array.from({ length: 100 }, (_, index) => `f${index}`),
  );
  many.set(
    "x-local://wtv/wtv_short.xmd",
    wrap(
      `<short>${Array.from({ length: 100 }, (_, index) => `<f${index} TYPE="string"/>`).join("")}</short>`,
    ),
  );
  const short = await reader.get({ type: "short" });
  assert.equal(short.fields.length, 80);
  assert.equal(short.nextCursor, 80);
});

test("разбор форм отклоняет неверный XML и циклическое наследование, не выполняя выражения", async () => {
  for (const source of [
    "<SPXML-FORM><person></SPXML-FORM>",
    '<!DOCTYPE SPXML-FORM [<!ENTITY x SYSTEM "fixture">]><SPXML-FORM><person/></SPXML-FORM>',
    wrap(
      '<a SAMPLE="1"><INHERIT TYPE="b"/></a><b SAMPLE="1"><INHERIT TYPE="a"/></b><person><INHERIT TYPE="a"/></person>',
    ),
  ]) {
    const invalid = new Map(forms);
    invalid.set(personUrl, source);
    await assert.rejects(fixture({ forms: invalid }).reader.get({ type: "person" }));
  }
});

test("формы, язык и common живут, пока жив reader; настраиваемые поля обновляются через 60 секунд", async (t) => {
  let now = 1000;
  t.mock.method(Date, "now", () => now);
  const { reader, formCalls, documentCalls } = fixture({
    forms: new Map([...forms, ["x-local://i18n/common/ru/const.json", "{}"]]),
  });
  await reader.get({ type: "person" });
  await reader.types();
  const beforeForms = [...formCalls];
  const beforeDocuments = [...documentCalls];
  now += 59000;
  await reader.get({ type: "person" });
  await reader.types();
  assert.deepEqual(formCalls, beforeForms);
  assert.deepEqual(documentCalls, beforeDocuments);
  now += 1001;
  await reader.get({ type: "person" });
  await reader.types();
  assert.deepEqual(formCalls, beforeForms);
  for (const url of [languageUrl, commonUrl])
    assert.equal([...formCalls, ...documentCalls].filter((value) => value === url).length, 1);
  assert.equal(documentCalls.filter((url) => url === customUrl).length, 2);
});

test("повторные вызовы schema.get в runtime читают каждую форму и языковой файл один раз за процесс", async () => {
  const { runtime, server } = fakeRuntime(
    {
      "native.spxml2.getAppInfo": applicationInfo,
      "native.spxml2.getForm": (args) => {
        const source = forms.get(String(args.url));
        assert.ok(source, "Only handwritten forms are read");
        return source;
      },
      "native.lds.loadDoc": (args) => {
        const document = documents.get(String(args.url));
        assert.ok(document, "Only handwritten documents are read");
        const root =
          args.url === commonUrl ? "common" : args.url === customUrl ? "custom_templates" : "const";
        return { kind: "binary", bytes: Buffer.from(buildXml({ [root]: document })) };
      },
    },
    { permissions: { write: false, execute: false } },
  );
  try {
    const first = await runtime.call("schema.get", { type: "person" });
    assert.equal(first.ok, true, JSON.stringify(first.error));
    const readCount = server.calls.length;
    const second = await runtime.call("schema.get", { type: "person" });
    assert.equal(second.ok, true, JSON.stringify(second.error));
    assert.deepEqual(second.data, first.data);
    assert.equal(server.calls.length, readCount);
    assert.equal(server.calls.filter((call) => call.args.url === languageUrl).length, 1);
    for (const url of [
      personUrl,
      catalogUrl,
      "x-local://wtv/base/person.xmd",
      "x-local://wtv/base/name.xmd",
    ])
      assert.equal(server.calls.filter((call) => call.args.url === url).length, 1);
  } finally {
    await runtime.close();
  }
});

const translationsUrl = "x-local://i18n/common/ru/const.json";
/** runtime над формами и документами этого файла; адреса из down отказывают, как сервер в сбое. */
function schemaRuntime(down: Set<string>) {
  const answer = (args: Record<string, unknown>, id: string, read: () => unknown) => {
    if (down.has(String(args.url))) throw refusal(id);
    return read();
  };
  return fakeRuntime(
    {
      "native.spxml2.getAppInfo": applicationInfo,
      "native.spxml2.getForm": (args, id) =>
        answer(args, id, () => {
          if (args.url === commonUrl) return buildXml({ common: documents.get(commonUrl)! });
          if (args.url === translationsUrl) return "{}";
          const source = forms.get(String(args.url));
          if (source === undefined) throw refusal(id);
          return source;
        }),
      "native.lds.loadDoc": (args, id) =>
        answer(args, id, () => {
          const document = documents.get(String(args.url));
          if (document === undefined) throw refusal(id);
          const root = args.url === customUrl ? "custom_templates" : "const";
          return { kind: "binary", bytes: Buffer.from(buildXml({ [root]: document })) };
        }),
    },
    { permissions: { write: false, execute: false } },
  );
}

for (const [operation, args] of [
  ["schema.get", { type: "fixture" }],
  ["objects.create", { type: "fixture", data: { name: "новый" } }],
] as const)
  test(`${operation}: после временного отказа чтения формы форма читается заново`, async () => {
    const formUrl = "x-local://wtv/wtv_fixture.xmd";
    const objectUrl = "x-local://wt_data/objects/10000000000000/29.xml";
    const directory = await mkdtemp(join(tmpdir(), "hcm-form-"));
    let down = true;
    let formReads = 0;
    let source = "";
    const script: Script = {
      "native.spxml2.getAppInfo": {
        default_db_name: "wt_data",
        databases: [{ id: "wt_data", catalogs: [{ id: "fixtures", object_type: "fixture" }] }],
      },
      "native.spxml2.getForm": (args) => {
        if (args.url !== formUrl) throw refusal("native.spxml2.getForm");
        formReads++;
        // Первый запрос попадает на временный сбой сервера, дальше сервер отвечает.
        if (down) throw refusal("native.spxml2.getForm");
        return '<SPXML-FORM><fixture><id TYPE="integer"/><name TYPE="string"/></fixture></SPXML-FORM>';
      },
      "native.lds.getNewObjectId": { ObjectID: "0x1000000000000029" },
      "native.lds.putDoc": (args) => {
        source = String(args.data);
        return { completed: true };
      },
      "native.lds.loadDoc": (args) => {
        if (args.url !== objectUrl) throw refusal("native.lds.loadDoc");
        return { kind: "binary", bytes: Buffer.from(source), contentType: "application/xml" };
      },
    };
    const { runtime } = fakeRuntime(script, { runtimeDir: directory, outputLimitBytes: 24000 });
    try {
      const failed = await runtime.call(operation, args);
      assert.equal(failed.ok, false, JSON.stringify(failed));
      assert.equal(formReads, 1);
      down = false;
      const recovered = await runtime.call(operation, args);
      assert.equal(formReads, 2, "после отказа форма должна читаться с сервера заново");
      assert.equal(recovered.ok, true, JSON.stringify(recovered));
    } finally {
      await runtime.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

test("адрес формы из common запоминается: обычный адрес читается один раз", async () => {
  const { runtime, server } = schemaRuntime(new Set());
  try {
    for (let call = 0; call < 2; call++) {
      const result = await runtime.call("schema.get", { type: "assessment" });
      assert.equal((result.data as SchemaResult).formUrl, "x-local://qti/assessment.xmd");
    }
    const usual = "x-local://wtv/wtv_assessment.xmd";
    assert.equal(server.calls.filter((call) => call.args.url === usual).length, 1);
  } finally {
    await runtime.close();
  }
});

test("schema.types: непрочитанные настраиваемые поля не показаны нулём, и после сбоя метаданные читаются заново", async () => {
  const down = new Set([languageUrl, translationsUrl, customUrl]);
  const { runtime, server } = schemaRuntime(down);
  const types = async () =>
    (await runtime.call("schema.types", { search: "people" })).data as SchemaTypesResult;
  try {
    const failed = await types();
    assert.deepEqual(
      [failed.types, failed.notes],
      [
        [{ type: "person", catalog: "people", title: "const=c_person" }],
        [
          "Документ с настраиваемыми полями прочитать не удалось: настраиваемых полей в ответе нет.",
        ],
      ],
    );
    down.clear();
    const recovered = await types();
    assert.deepEqual(
      [recovered.types, recovered.notes],
      [[{ type: "person", catalog: "people", title: "Сотрудник", customFields: 1 }], undefined],
    );
    for (const url of [languageUrl, translationsUrl, customUrl])
      assert.equal(server.calls.filter((call) => call.args.url === url).length, 2, url);
  } finally {
    await runtime.close();
  }
});

test("runtime.query читает отказавшую форму каталога один раз за вызов", async () => {
  const { runtime, server } = schemaRuntime(new Set([catalogUrl]));
  server.on("native.lds.xQuery", { Data: "", EOF: "true", TotalCount: "0" });
  try {
    const result = await runtime.call("runtime.query", {
      catalog: "people",
      where: { manager_id: "0x1000000000000001" },
      order: "lastname",
      fields: ["lastname"],
    });
    assert.equal(result.ok, true, JSON.stringify(result.error));
    assert.equal(server.calls.filter((call) => call.args.url === catalogUrl).length, 1);
  } finally {
    await runtime.close();
  }
});

test("форма каталога с необычным адресом запоминается: обычный адрес по имени каталога читается один раз", async () => {
  const staffForm = "x-local://wtv/catalogs/staff.xmd";
  const { runtime, server } = fakeRuntime(
    {
      "native.spxml2.getAppInfo": {
        default_db_name: "sample",
        databases: [{ id: "sample", catalogs: [{ id: "staff", form_url: staffForm }] }],
      },
      "native.spxml2.getForm": (args, id) => {
        if (args.url !== staffForm) throw refusal(id);
        return '<SPXML-FORM CATALOG="1"><staff><member MULTIPLE="1" PRIMARY-KEY="id"><id TYPE="integer"/></member></staff></SPXML-FORM>';
      },
      "native.lds.loadDoc": (_, id) => {
        throw refusal(id);
      },
    },
    { permissions: { write: false, execute: false } },
  );
  try {
    for (let call = 0; call < 2; call++) {
      const result = await runtime.call("schema.get", { type: "staff" });
      assert.equal((result.data as SchemaResult).formUrl, staffForm, JSON.stringify(result));
    }
    const usual = "x-local://wtv/wtv_staff.xmd";
    assert.equal(server.calls.filter((call) => call.args.url === usual).length, 1);
  } finally {
    await runtime.close();
  }
});
