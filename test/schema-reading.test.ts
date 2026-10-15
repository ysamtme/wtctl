// Что агенты на подставных задачах спрашивали у схемы: поле по русскому слову, строки каталога
// по его названию, всю структуру одним вызовом, число каталогов.
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
    { id: "trash", catalogs: [{ id: "trash_docs", object_type: "" }] },
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
  // Слово из четырёх букв сравнивается как напечатано.
  assert.deepEqual(await paths({ search: "дата" }), ["hire_date"]);
  assert.deepEqual(await paths({ search: "даты" }), []);
  const types = async (search: string) =>
    (await reader.types({ search })).types.map((item) => item.type ?? item.catalog);
  for (const search of ["сотрудники", "сотрудника", "сотрудников", "сотрудникам"])
    assert.deepEqual(await types(search), ["person"], search);
  // Каталог, названный по найденному типу, идёт за ним.
  assert.deepEqual(await types("группы"), ["group", "group_members"]);
});

test("поиск, ничего не нашедший, говорит, где он искал и что попробовать", async () => {
  const fields = await reader.get({ type: "person", search: "почта" });
  assert.equal(fields.total, 0);
  assert.deepEqual(fields.notes, [
    "Ничего не найдено: search ищет слова в пути, заголовке поля и имени каталога, на который оно ссылается. Можно попробовать слово из заголовка на языке сервера, часть имени латиницей (hire, mail) или вызов без search.",
  ]);
  assert.deepEqual((await reader.get({ type: "person", search: "mail" })).notes, []);
  // Несколько слов должны быть все в одном поле, и примечание об этом говорит; поле находится по своему каталогу.
  assert.match(
    (await reader.get({ type: "person", search: "должность почта" })).notes[0]!,
    /Все слова должны быть в одном поле: искать нужно по одному слову\./,
  );
  assert.deepEqual(await paths({ search: "positions" }), ["position_id"]);
  const types = await reader.types({ search: "почта" });
  assert.match(types.notes![0]!, /search ищет слова в имени типа, имени каталога и заголовке/);
  assert.equal((await reader.types({ search: "person" })).notes, undefined);
});

test("каталог без собственного типа объектов сразу показывает поля своей строки", async () => {
  const rows = await reader.get({ type: "group_members" });
  assert.deepEqual(
    rows.fields.map((field) => field.path),
    ["group_member.id", "group_member.group_id", "group_member.person_fullname"],
  );
  assert.deepEqual(
    [rows.element?.path, rows.element?.multiple, rows.element?.key],
    ["group_member", true, "id"],
  );
  // Поиск в этом каталоге идёт по полям строки.
  assert.deepEqual(
    rows.fields.map((field) => field.query),
    [true, true, true],
  );
  assert.deepEqual(rows.notes, [
    "group_members — каталог без своего типа объекта: документов у его строк нет. Поля строки — под group_member; в условиях и fields поиска их пишут без этой приставки.",
  ]);
  // Поиск идёт по всем полям, как и для типа.
  assert.deepEqual(await paths({ type: "group_members", search: "сотрудник" }), [
    "group_member.person_fullname",
  ]);
});

test("deep выводит вложенные поля любой глубины одним постраничным списком, в том числе под путём", async () => {
  assert.deepEqual(await paths({ path: "access" }), nested.slice(0, 2));
  assert.deepEqual(await paths(inside), nested);
  // Поиск под путём смотрит на любую глубину, как и без пути.
  assert.deepEqual(await paths({ path: "access", search: "role" }), nested.slice(1));
  assert.deepEqual((await paths({ deep: true })).slice(-5), ["access", ...nested]);
  // Страница, обрезанная по размеру, об этом говорит; обрезанная по limit — нет.
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

test("hcm_schema и стоящая за ним операция принимают deep", async () => {
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

test("каталог без своего типа объекта стоит в списке типов строкой без type", async () => {
  const unnamed =
    "Строка без type — каталог без своего типа объекта: документов у его строк нет, искать в нём можно, поля строки показывает схема по имени каталога.";
  const byName = await reader.types({ search: "group_mem" });
  assert.deepEqual(
    [byName.types, byName.total, byName.notes],
    [[{ catalog: "group_members" }], 1, [unnamed]],
  );
  // Без поиска такие каталоги, в том числе из других баз, — в конце списка; примечание — только
  // на странице, где они есть.
  const first = await reader.types({ limit: 4 });
  assert.deepEqual([first.total, first.notes], [6, undefined]);
  const last = await reader.types({ limit: 4, cursor: 4 });
  assert.deepEqual(
    [last.types, last.notes],
    [[{ catalog: "group_members" }, { catalog: "trash_docs" }], [unnamed]],
  );
});
