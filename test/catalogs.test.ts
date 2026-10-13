// Сервер называет тип объекта только у некоторых каталогов. Каталог без такого имени всё равно
// каталог: основной у типа, который объявляет сервер (events), или тот, чьи строки не имеют документа.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SchemaReader } from "../src/schema.js";
import { verifyFields } from "../src/verification.js";
import { fakeRuntime, type Script } from "./fake-server.js";

const forms: Record<string, string> = {
  "x-local://wtv/common.xml": `<common><exchange_object_types>
    <exchange_object_type><name>person</name><title>'Сотрудник'</title></exchange_object_type>
    <exchange_object_type><name>event</name><title>'Мероприятие'</title></exchange_object_type>
    <exchange_object_type><name>user_data</name><title>'Данные'</title></exchange_object_type>
  </exchange_object_types></common>`,
  "x-local://wtv/wtv_event.xmd":
    '<SPXML-FORM><event><id TYPE="integer"/><name TYPE="string"/><start_date TYPE="date"/><note TYPE="string"/><label TYPE="string" PROPERTY="1" EXPR="name"/></event></SPXML-FORM>',
  "x-local://wtv/wtv_events.xmd":
    '<SPXML-FORM CATALOG="1"><events><event MULTIPLE="1" PRIMARY-KEY="id"><id TYPE="integer"/><name TYPE="string"/><start_date TYPE="date"/><place_id TYPE="integer" FOREIGN-ARRAY="places"/><days TYPE="integer" PROPERTY="1" EXPR="1"/></event></events></SPXML-FORM>',
  // Строка этого каталога названа не по его типу объекта.
  "x-local://wtv/wtv_plans.xmd":
    '<SPXML-FORM CATALOG="1"><plans><budget MULTIPLE="1" PRIMARY-KEY="id"><id TYPE="integer"/><changed TYPE="date"/></budget></plans></SPXML-FORM>',
  "x-local://wtv/wtv_event_members.xmd":
    '<SPXML-FORM CATALOG="1"><event_members><event_member MULTIPLE="1" PRIMARY-KEY="id"><id TYPE="integer"/><event_id TYPE="integer"/><person_id TYPE="integer"/></event_member></event_members></SPXML-FORM>',
};
const info = {
  default_db_name: "sample",
  shared_docs: [{ id: "common", url: "x-local://wtv/common.xml" }],
  databases: [
    {
      id: "sample",
      catalogs: [
        { id: "people", object_type: "person" },
        { id: "events", object_type: "", form_url: "x-local://wtv/wtv_events.xmd" },
        { id: "event_members", object_type: "", form_url: "x-local://wtv/wtv_event_members.xmd" },
        { id: "plans", object_type: "plan", form_url: "x-local://wtv/wtv_plans.xmd" },
        // Общий список сервера стоит в том же списке и каталогом не является.
        { id: "common.kinds", object_type: "", form_url: "x-local://wtv/websoft.common.kinds.xml" },
      ],
    },
  ],
};
const form = async (url: string) => {
  const source = forms[url];
  if (source === undefined) throw new Error("Fixture form is unavailable");
  return source;
};
const reader = () =>
  new SchemaReader(
    async () => info,
    form,
    async () => ({}),
  );

test("тип, который сервер объявляет без названия каталога, выдаётся с каталогом, названным по нему", async () => {
  const { types } = await reader().types();
  assert.deepEqual(
    types.map((item) => [item.type, item.catalog, item.title]),
    [
      ["person", "people", "Сотрудник"],
      ["plan", "plans", undefined],
      ["event", "events", "Мероприятие"],
      ["user_data", undefined, "Данные"],
    ],
  );
  const schema = await reader().get({ type: "event" });
  assert.equal(schema.catalog, "events");
  assert.deepEqual(
    schema.fields.map((field) => [field.path, field.query ?? false]),
    [
      ["id", true],
      ["name", true],
      ["start_date", true],
      ["note", false],
      ["place_id", true],
      ["days", false],
    ],
  );
  // Поле, которое есть только у каталога, сохраняет свою ссылку; свойство формы каталога вычисляется.
  assert.deepEqual(
    schema.fields.slice(-2).map((field) => [field.origin, field.references, field.computed]),
    [
      ["catalog", "places", undefined],
      ["catalog", undefined, true],
    ],
  );
  assert.equal((await reader().types()).catalogs, 4);
  // Имя строки ведёт к её каталогу.
  await assert.rejects(reader().get({ type: "event_member" }), (error: any) =>
    error.hint.includes("Каталог без своего типа объекта: event_members"),
  );
});

test("каталог без типа объекта даёт поля своей строки и говорит, являются ли его строки документами", async () => {
  const main = await reader().get({ type: "events" });
  assert.equal(
    main.notes.at(-1),
    'events — имя каталога; поля его объектов показывает тип event, поля строки каталога — path:"event".',
  );
  // Поля его строки помечены как те, по которым идёт поиск.
  assert.deepEqual(
    (await reader().get({ type: "events", path: "event" })).fields.map((field) => field.query),
    [true, true, true, true],
  );
  const rows = await reader().get({ type: "event_members" });
  assert.match(rows.notes.at(-1)!, /^event_members — каталог без своего типа объекта/);
  for (const selector of [{ catalog: "events" }, { type: "event" }]) {
    const shape = await reader().catalogShape(selector);
    assert.deepEqual([...shape!.fields], ["id", "name", "start_date", "place_id", "days"]);
    assert.deepEqual([...shape!.dates], ["start_date"]);
  }
  assert.deepEqual(
    [...(await reader().catalogShape({ catalog: "event_members" }))!.fields],
    ["id", "event_id", "person_id"],
  );
  const type = await reader().explainQuery("event", []);
  assert.equal(type?.code, "UNKNOWN_CATALOG");
  assert.match(type!.hint!, /^Похожие: events, /);
  assert.equal(await reader().explainQuery("event_members", ["event_id"]), undefined);
  const field = await reader().explainQuery("event_members", ["name"]);
  assert.equal(field?.code, "UNKNOWN_CATALOG_FIELD");
  assert.match(field!.hint!, /по имени каталога event_members/);
  assert.match(
    (await reader().explainQuery("events", ["note"]))!.hint!,
    /Поля каталога: id, name, start_date, place_id, days; в schema.get для типа event /,
  );
});

const schemaAnswers: Script = {
  "native.spxml2.getAppInfo": info,
  "native.spxml2.getForm": (args) => form(String(args.url)),
};

test("пустой ответ на имя, которое не каталог, не принимается за пустой каталог", async () => {
  // В пустой таблице базы данных сервер пропускает неверное имя.
  const { runtime, server } = fakeRuntime({
    ...schemaAnswers,
    "native.lds.xQuery": { Data: "", TotalCount: "0", EOF: "true" },
  });
  const sent = () =>
    server.calls
      .filter(({ id }) => id === "native.lds.xQuery")
      .map(({ args }) => String(args.query));
  try {
    const wrong = await runtime.call("runtime.query", { catalog: "event" });
    assert.equal(wrong.error?.code, "UNKNOWN_CATALOG");
    assert.match(wrong.error!.hint!, /Похожие: events/);
    const empty = await runtime.call("runtime.query", {
      catalog: "events",
      where: { start_date: { gte: "2026-01-01" } },
    });
    assert.deepEqual(empty.data, { items: [], total: 0 });
    assert.equal(
      sent()[1],
      "for $elem in events where ($elem/start_date >= date('2026-01-01')) return $elem",
    );
    // Поле даты известно и там, где строка каталога носит другое имя.
    await runtime.call("runtime.query", {
      catalog: "plans",
      where: { changed: { gte: "2026-01-01" } },
    });
    assert.equal(
      sent().at(-1),
      "for $elem in plans where ($elem/changed >= date('2026-01-01')) return $elem",
    );
    // ID в десятичном виде попадает в целочисленное поле числом; в строковом поле цифры остаются строкой.
    await runtime.call("runtime.query", {
      catalog: "events",
      where: { id: "7336555599450041442", name: "40702810900000001234" },
    });
    assert.equal(
      sent().at(-1),
      "for $elem in events where ($elem/id = 7336555599450041442) and ($elem/name = '40702810900000001234') return $elem",
    );
    // Общий список отклоняется до сервера, с указанием, как его прочитать.
    const before = sent().length;
    const common = await runtime.call("runtime.query", { catalog: "common.kinds" });
    assert.equal(common.error?.message, "common.kinds — общий список сервера, а не каталог.");
    assert.equal(sent().length, before);
  } finally {
    await runtime.close();
  }
});

test("дата подтверждается временем суток и отклоняется до записи, если сервер её не прочтёт", async () => {
  const stored = { start_date: "2026-12-05T09:30:00+00:00", day: "2026-12-05T00:00:00+00:00" };
  for (const value of ["2026-12-05T09:30", "2026-12-05T09:30:00.000Z", "2026-12-05T09:30:00+03:00"])
    verifyFields({ start_date: value }, stored, []);
  verifyFields({ day: "2026-12-05" }, stored, []);
  for (const value of ["2026-12-05T09:31", "2026-12-06", "2026-12-05 09:30"])
    assert.throws(() => verifyFields({ start_date: value }, stored, []), {
      code: "READ_BACK_MISMATCH",
    });

  // Последний вызов здесь доходит до журнала записей, а это файл.
  const directory = await mkdtemp(join(tmpdir(), "hcm-catalogs-"));
  const { runtime, server } = fakeRuntime(schemaAnswers, { runtimeDir: directory });
  try {
    for (const value of ["05.12.2026", "2026-12-05 09:30", "завтра"]) {
      const refused = await runtime.call("objects.create", {
        type: "event",
        data: { name: "x", start_date: value },
      });
      assert.equal(refused.error?.code, "INVALID_ARGUMENT", value);
      assert.match(refused.error!.message, /^start_date: дата записана не так/);
      assert.equal(refused.error?.mutationOutcome, "not_sent");
    }
    // Текстовое поле может хранить что угодно.
    const text = await runtime.call("objects.create", {
      type: "event",
      data: { note: "05.12.2026", start_date: "2026-12-05" },
    });
    assert.equal(text.error?.code, "INTERNAL_ERROR");
    assert.equal(server.calls.at(-1)?.id, "native.lds.getNewObjectId");
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("поле, которого нет у типа, отклоняется до записи и до предпросмотра", async () => {
  const { runtime, server } = fakeRuntime({
    ...schemaAnswers,
    "native.lds.loadDoc": {
      kind: "binary",
      bytes: new TextEncoder().encode("<event><id>1</id><name>E</name></event>"),
    },
  });
  try {
    const created = await runtime.call("objects.create", {
      type: "event",
      data: { nmae: "x", note: "n", no_such: 1 },
    });
    assert.equal(created.error?.code, "UNKNOWN_FIELD");
    assert.equal(created.error?.message, "У типа event нет поля: nmae, no_such.");
    assert.match(created.error!.hint!, /^Похожие: name\. /);
    assert.equal(created.error?.mutationOutcome, "not_sent");
    for (const preview of [true, false]) {
      const patched = await runtime.call("objects.patch", {
        id: "1",
        patch: { name: "N", nmae: "x" },
        preview,
      });
      assert.equal(patched.error?.code, "UNKNOWN_FIELD", String(preview));
      assert.deepEqual(patched.error?.details, { fields: ["nmae"] });
    }
    // Значение для поля, которое вычисляет сервер, тоже не сохранилось бы.
    for (const call of [
      () => runtime.call("objects.create", { type: "event", data: { name: "x", label: "L" } }),
      () => runtime.call("objects.patch", { id: "1", patch: { label: "L" }, preview: true }),
    ]) {
      const computed = await call();
      assert.equal(computed.error?.code, "INVALID_ARGUMENT");
      assert.equal(
        computed.error?.message,
        "label: значение вычисляет сервер, записать его нельзя.",
      );
    }
    // Удаление того, чего нет, ничего не меняет и не считается ошибкой.
    const removed = await runtime.call("objects.patch", { id: "1", remove: ["no_such"] });
    assert.equal((removed.data as { noop: boolean }).noop, true);
    assert.equal(server.calls.filter(({ id }) => /putDoc|getNewObjectId/.test(id)).length, 0);
  } finally {
    await runtime.close();
  }
});
