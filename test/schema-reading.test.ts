// What agents on mock tasks asked of the schema: a field by a Russian word, the rows of a catalog
// by its name, a whole structure in one call, the number of catalogs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { HcmMcpTools } from "../src/mcp/server.js";
import { SchemaReader, type SchemaInput, type SchemaResult } from "../src/schema.js";
import { fakeRuntime } from "./fake-server.js";
import { mcpJson } from "./mcp-json.js";

const forms: Record<string, string> = {
  "x-local://wtv/common.xml": `<common><exchange_object_types>
    <exchange_object_type><name>person</name><title>'Сотрудник'</title></exchange_object_type>
    <exchange_object_type><name>group</name><title>'Группа'</title></exchange_object_type>
    <exchange_object_type><name>user_data</name><title>'Данные'</title></exchange_object_type>
  </exchange_object_types></common>`,
  "x-local://wtv/wtv_person.xmd": `<SPXML-FORM><person>
    <hire_date TYPE="date" TITLE="Дата приема"/><email TYPE="string" TITLE="E-mail"/>
    <position_id TYPE="integer" FOREIGN-ARRAY="positions" TITLE="Должность"/>
    <position_name TYPE="string" TITLE="Название должности"/>
    <position_parent_name TYPE="string" TITLE="Название подразделения"/>
    <access><level TYPE="string"/>
      <roles><role MULTIPLE="1" PRIMARY-KEY="role_id"><role_id TYPE="string"/></role></roles>
    </access>
  </person></SPXML-FORM>`,
  "x-local://wtv/wtv_group_members.xmd": `<SPXML-FORM CATALOG="1"><group_members>
    <group_member MULTIPLE="1" PRIMARY-KEY="id">
      <id TYPE="integer"/><group_id TYPE="integer"/>
      <person_fullname TYPE="string" TITLE="ФИО сотрудника"/>
    </group_member>
  </group_members></SPXML-FORM>`,
};
forms["x-local://wtv/wtv_wide.xmd"] =
  `<SPXML-FORM><wide>${Array.from({ length: 400 }, (_, index) => `<field_with_a_long_name_${index} TYPE="string" TITLE="Поле с длинным заголовком номер ${index}"/>`).join("")}</wide></SPXML-FORM>`;
const info = {
  default_db_name: "sample",
  shared_docs: [
    { id: "common", url: "x-local://wtv/common.xml" },
    { id: "custom_templates", url: "x-local://wtv/custom_templates.xml" },
  ],
  databases: [
    {
      id: "sample",
      catalogs: [
        { id: "people", object_type: "person" },
        { id: "groups", object_type: "group" },
        { id: "wides", object_type: "wide" },
        { id: "group_members", object_type: "", form_url: "x-local://wtv/wtv_group_members.xmd" },
      ],
    },
  ],
};
const form = async (url: string) => {
  const source = forms[url];
  if (source === undefined) throw new Error("Fixture form is unavailable");
  return source;
};
const reader = new SchemaReader(
  async () => info,
  form,
  async () => ({}),
);
const paths = async (input: SchemaInput) =>
  (await reader.get({ type: "person", ...input })).fields.map((field) => field.path);
const inside = { type: "person", path: "access", deep: true };
const nested = ["access.level", "access.roles", "access.roles.role", "access.roles.role.role_id"];

test("search finds a title by its words: in another case form, with е for ё, in any order", async () => {
  assert.deepEqual(await paths({ search: "приём" }), ["hire_date"]);
  for (const search of ["должность", "должности"])
    assert.deepEqual(await paths({ search }), ["position_id", "position_name"], search);
  for (const search of ["подразделение", "подразделения"])
    assert.deepEqual(await paths({ search }), ["position_parent_name"], search);
  assert.deepEqual(await paths({ search: "Должность  название" }), ["position_name"]);
  // A word of four letters is compared as it is typed.
  assert.deepEqual(await paths({ search: "дата" }), ["hire_date"]);
  assert.deepEqual(await paths({ search: "даты" }), []);
  const types = async (search: string) =>
    (await reader.types({ search })).types.map((item) => item.type);
  for (const search of ["сотрудники", "сотрудника", "сотрудников", "сотрудникам"])
    assert.deepEqual(await types(search), ["person"], search);
  assert.deepEqual(await types("группы"), ["group"]);
});

test("a search that finds nothing says where it looks and what to try", async () => {
  const fields = await reader.get({ type: "person", search: "почта" });
  assert.equal(fields.total, 0);
  assert.deepEqual(fields.notes, [
    "Ничего не найдено: search ищет слова в пути, заголовке поля и имени каталога, на который оно ссылается. Можно попробовать слово из заголовка на языке сервера, часть имени латиницей (hire, mail) или вызов без search.",
  ]);
  assert.deepEqual((await reader.get({ type: "person", search: "mail" })).notes, []);
  // Several words must all be in one field, and the note says so; a field is found by its catalog.
  assert.match(
    (await reader.get({ type: "person", search: "должность почта" })).notes[0]!,
    /Все слова должны быть в одном поле: искать нужно по одному слову\./,
  );
  assert.deepEqual(await paths({ search: "positions" }), ["position_id"]);
  const types = await reader.types({ search: "почта" });
  assert.match(types.notes![0]!, /search ищет слова в имени типа, имени каталога и заголовке/);
  assert.equal((await reader.types({ search: "person" })).notes, undefined);
  // Catalogs whose rows are not objects are named next to the types found.
  assert.deepEqual((await reader.types({ search: "group" })).notes, [
    "Каталоги без своего типа объекта: group_members. Поля строки показывает схема по имени каталога.",
  ]);
  // A word of the title finds the type; the catalog named after the type comes with it.
  assert.match((await reader.types({ search: "группа" })).notes?.[0] ?? "", /: group_members\./);
  // A catalog whose rows are not objects has no type to list: the note names it.
  assert.deepEqual((await reader.types({ search: "group_members" })).notes, [
    "Типа с таким именем нет; есть каталоги без своего типа объекта: group_members. Поля строки показывает схема по имени каталога.",
  ]);
});

test("a catalog without its own object type shows the fields of its row at once", async () => {
  const rows = await reader.get({ type: "group_members" });
  assert.deepEqual(
    rows.fields.map((field) => field.path),
    ["group_member.id", "group_member.group_id", "group_member.person_fullname"],
  );
  assert.deepEqual(
    [rows.element?.path, rows.element?.multiple, rows.element?.key],
    ["group_member", true, "id"],
  );
  // The fields of the row are what a search in this catalog goes by.
  assert.deepEqual(
    rows.fields.map((field) => field.query),
    [true, true, true],
  );
  assert.deepEqual(rows.notes, [
    "group_members — каталог без своего типа объекта: документов у его строк нет. Поля строки — под group_member; в условиях и fields поиска их пишут без этой приставки.",
  ]);
  // A search goes over all fields as it does for a type.
  assert.deepEqual(await paths({ type: "group_members", search: "сотрудник" }), [
    "group_member.person_fullname",
  ]);
});

test("deep lists nested fields of every depth in one paged listing, under a path as well", async () => {
  assert.deepEqual(await paths({ path: "access" }), nested.slice(0, 2));
  assert.deepEqual(await paths(inside), nested);
  // A search under a path looks at every depth, as it does without a path.
  assert.deepEqual(await paths({ path: "access", search: "role" }), nested.slice(1));
  assert.deepEqual((await paths({ deep: true })).slice(-5), ["access", ...nested]);
  // A page the size cut short says so; the one cut by limit does not.
  const wide = await reader.get({ type: "wide", deep: true, limit: 500 });
  assert.equal(wide.cutBySize, true);
  assert.ok(wide.fields.length < 500 && wide.nextCursor === wide.fields.length);
  const page = await reader.get({ ...inside, limit: 2, cursor: 1 });
  assert.equal(page.cutBySize, undefined);
  assert.deepEqual(
    [page.fields.map((field) => field.path), page.total, page.nextCursor],
    [nested.slice(1, 3), 4, 3],
  );
});

test("hcm_schema and the operation behind it take deep", async () => {
  const { runtime } = fakeRuntime(
    {
      "native.spxml2.getAppInfo": info,
      "native.spxml2.getForm": (args) => form(String(args.url)),
    },
    { permissions: { write: false, execute: false } },
  );
  try {
    const answer = mcpJson(await new HcmMcpTools(runtime).invoke("hcm_schema", inside));
    assert.deepEqual(
      (answer.data as SchemaResult).fields.map((field) => field.path),
      nested,
    );
  } finally {
    await runtime.close();
  }
});

test("the list of types counts all catalogs of the server, also the ones without an object type", async () => {
  const listed = await reader.types({ search: "group" });
  assert.deepEqual(listed.types, [
    { type: "group", catalog: "groups", title: "Группа", customFields: 0 },
  ]);
  assert.deepEqual([listed.total, listed.catalogs], [1, 4]);
});
