// С чем агенты столкнулись на пробных задачах: ответ, в котором пропал факт, отказ без названной
// причины, исход, который отправил вызывающего проверять запись, которой не было.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseArguments } from "../src/cli/arguments.js";
import { cliHelp } from "../src/cli/help.js";
import { commandInvocation } from "../src/cli/run.js";
import { HcmError } from "../src/errors.js";
import { logMatches } from "../src/log-output.js";
import { HcmMcpTools } from "../src/mcp/server.js";
import { platformFailure } from "../src/platform-errors.js";
import { WsHcmApiError } from "../src/protocol/error.js";
import { errorInFrontendTerms } from "../src/frontend-names.js";
import { catalogQuery, withoutFalseOffset, xqueryNames } from "../src/query.js";
import { SchemaReader } from "../src/schema.js";
import type { CliIo } from "../src/cli/types.js";
import { fakeRuntime, refuse, refusal, type Script } from "./fake-server.js";
import { mcpJson } from "./mcp-json.js";

const forms: Record<string, string> = {
  "x-local://wtv/wtv_person.xmd":
    '<SPXML-FORM><person><id TYPE="integer"/><lastname TYPE="string"/><comment TYPE="string"/><class TYPE="attr" DEFAULT="x"/><roles><role MULTIPLE="1" PRIMARY-KEY="role_id"><role_id TYPE="string"/><since TYPE="date"/></role></roles><access><INHERIT TYPE="access_base"/></access></person><access_base SAMPLE="1"><is_admin TYPE="bool"/></access_base></SPXML-FORM>',
  "x-local://wtv/wtv_people.xmd":
    '<SPXML-FORM CATALOG="1"><people><person MULTIPLE="1" PRIMARY-KEY="id"><id TYPE="integer"/><lastname TYPE="string"/><fullname TYPE="string"/><boss_name TYPE="string"/><role_id TYPE="string" MULTIPLE="1"/></person></people></SPXML-FORM>',
};
const info = {
  default_db_name: "wt_data",
  shared_docs: [],
  databases: [
    {
      id: "wt_data",
      catalogs: [{ id: "people", object_type: "person", form_url: "x-local://wtv/wtv_people.xmd" }],
    },
  ],
};
const form = async (url: string) => {
  const source = forms[url];
  if (source === undefined) throw new Error("Fixture form is unavailable");
  return source;
};
const xml = (text: string) => ({ kind: "binary", bytes: new TextEncoder().encode(text) });

const base: Script = {
  "native.spxml2.getAppInfo": info,
  "native.spxml2.getForm": (args) => form(String(args.url)),
};
const manyRows = () => ({
  Data: {
    person: Array.from({ length: 200 }, (_, id) => ({ id: String(id), lastname: "Фамилия" })),
  },
  TotalCount: "200",
  EOF: "true",
});

test("запрошенное поле, которое есть только в каталоге, берётся из строки каталога под своим именем", async () => {
  const queries: string[] = [];
  const { runtime } = fakeRuntime({
    ...base,
    "native.lds.loadDoc": xml("<person><id>1</id><lastname>Иванов</lastname></person>"),
    "native.lds.xQuery": (args) => {
      queries.push(String(args.query));
      return {
        Data: { person: [{ id: "1", lastname: "Иванов", fullname: "Иванов Пётр" }] },
        TotalCount: "1",
        EOF: "true",
      };
    },
  });
  try {
    const got = await runtime.call("objects.get", {
      id: "1",
      fields: ["lastname", "fullname", "boss_name", "comment", "nope"],
    });
    const data = got.data as Record<string, unknown>;
    assert.deepEqual(data.data, { lastname: "Иванов" });
    // boss_name — поле каталога без значения в этой строке; comment в документе пуст.
    assert.deepEqual(data.fromCatalog, { fullname: "Иванов Пётр" });
    assert.deepEqual(data.unknownFields, ["nope"]);
    assert.deepEqual(queries, ["for $elem in people where $elem/id = 1 return $elem"]);
    // Каталог не запрашивается, когда документ отвечает на всё.
    await runtime.call("objects.get", { id: "1", fields: ["lastname"] });
    await runtime.call("objects.get", { id: "1" });
    assert.equal(queries.length, 1);
  } finally {
    await runtime.close();
  }
});

test("правка, которая ничего не меняет, — не предпросмотр; resave записывает документ как есть", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hcm-mock-runs-"));
  const written: string[] = [];
  const { runtime } = fakeRuntime(
    {
      ...base,
      // После сохранения сервер сам заполняет своё поле.
      "native.lds.loadDoc": () =>
        xml(
          `<person><id>1</id><lastname>Иванов</lastname>${written.length ? "<comment>от сервера</comment>" : ""}</person>`,
        ),
      "native.lds.putDoc": (args) => {
        written.push(String(args.data));
        return {};
      },
    },
    { runtimeDir: directory },
  );
  try {
    const same = await runtime.call("objects.patch", { id: "1", patch: { lastname: "Иванов" } });
    const answer = same.data as Record<string, unknown>;
    assert.equal(answer.preview, false);
    assert.equal(answer.noop, true);
    assert.equal(written.length, 0);
    // Инструмент принимает один resave, как записано в гайде.
    const asked = mcpJson(
      await new HcmMcpTools(runtime).invoke("hcm_object_patch", {
        id: "1",
        resave: true,
        preview: true,
      }),
    );
    // Предпросмотр сохранения без изменений: изменений вызывающего нет, но документ будет записан.
    assert.deepEqual(
      [(asked.data as any).preview, (asked.data as any).noop, written.length],
      [true, false, 0],
    );
    const saved = await runtime.call("objects.patch", { id: "1", resave: true });
    assert.equal((saved.data as any).mutationOutcome, "confirmed");
    assert.deepEqual((saved.data as any).changes, []);
    assert.deepEqual((saved.data as any).serverChanged, ["comment"]);
    assert.equal(written.length, 1);
    assert.match(written[0]!, /<lastname>Иванов<\/lastname>/);
    // Без resave должно быть что менять.
    const nothing = await runtime.call("objects.patch", { id: "1" });
    assert.equal(nothing.error?.code, "INVALID_ARGUMENT");
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("ссылка, под которой лежит копия объекта, сохраняется при правке другого поля", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hcm-mock-runs-"));
  const written: string[] = [];
  const { runtime } = fakeRuntime(
    {
      ...base,
      // Сервер раскладывает документ по строкам; под ссылкой он оставляет sd.
      "native.lds.loadDoc": () =>
        xml(
          written.at(-1) ??
            "<person>\n\t<id>1</id>\n\t<lastname>Иванов</lastname>\n\t<boss_id>5\n\t\t<sd>\n\t\t\t<name>Пётр</name>\n\t\t</sd>\n\t</boss_id>\n\t<comment>первая\nвторая</comment>\n</person>",
        ),
      "native.lds.putDoc": (args) => {
        written.push(String(args.data));
        return {};
      },
    },
    { runtimeDir: directory },
  );
  try {
    const saved = await runtime.call("objects.patch", { id: "1", patch: { lastname: "Петров" } });
    assert.equal((saved.data as any).mutationOutcome, "confirmed");
    // Перенос строки, записанный ссылкой сразу после значения, заставляет сервер выбросить поле.
    assert.equal(
      written[0],
      "<person><id>1</id><lastname>Петров</lastname><boss_id>5<sd><name>Пётр</name></sd></boss_id><comment>первая&#10;вторая</comment></person>",
    );
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("проверка после записи знает поля, которые даёт базовый тип; при расхождении называет, что отличается", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hcm-mock-runs-"));
  let stored = "<person><id>1</id><lastname>Иванов</lastname></person>";
  const { runtime } = fakeRuntime(
    {
      ...base,
      "native.lds.loadDoc": () => xml(stored),
      "native.lds.putDoc": (args) => {
        // Сервер хранит логическое значение как 1 и здесь не принимает новую фамилию.
        stored = String(args.data)
          .replace("<is_admin>true<", "<is_admin>1<")
          .replace("Петров", "Иванов");
        return {};
      },
    },
    { runtimeDir: directory },
  );
  try {
    const flag = await runtime.call("objects.patch", {
      id: "1",
      patch: { access: { is_admin: true } },
    });
    assert.equal((flag.data as any).mutationOutcome, "confirmed");
    const renamed = await runtime.call("objects.patch", { id: "1", patch: { lastname: "Петров" } });
    assert.equal(renamed.error?.code, "READ_BACK_MISMATCH");
    assert.deepEqual((renamed.error?.details as any).differences, [
      { path: "lastname", requested: "Петров", actual: "Иванов" },
    ]);
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("у поля элемента списка, созданного той же правкой, нет прежнего значения", async () => {
  let document = "<person><id>1</id><roles></roles></person>";
  const { runtime } = fakeRuntime({ ...base, "native.lds.loadDoc": () => xml(document) });
  try {
    const changes = async (patch: Record<string, unknown>) =>
      ((await runtime.call("objects.patch", { id: "1", preview: true, patch })).data as any)
        .changes;
    assert.deepEqual(
      await changes({
        "roles.role[role_id=admin].role_id": "admin",
        "roles.role[role_id=admin].since": "2026-01-01",
      }),
      [
        { op: "set", path: "roles.role[role_id=admin].role_id", after: "admin" },
        { op: "set", path: "roles.role[role_id=admin].since", after: "2026-01-01" },
      ],
    );
    document =
      "<person><id>1</id><roles><role><role_id>admin</role_id><since>2025-01-01</since></role></roles></person>";
    assert.deepEqual(await changes({ "roles.role[role_id=admin].since": "2026-01-01" }), [
      {
        op: "set",
        path: "roles.role[role_id=admin].since",
        before: "2025-01-01",
        after: "2026-01-01",
      },
    ]);
  } finally {
    await runtime.close();
  }
});

test("отклонённый текст XQuery объясняется каталогом или полем, которое в нём названо", async () => {
  assert.deepEqual(
    xqueryNames(
      "for $a in people, $b in groups where $a/id = $b/person_id and $a/name != '' return $a",
    ),
    [
      ["people", ["id", "name"]],
      ["groups", ["person_id"]],
    ],
  );
  const { runtime } = fakeRuntime({ ...base, "*": refuse() });
  try {
    const query = (text: string) => runtime.call("runtime.query", { query: text });
    const field = await query("for $e in people where $e/comment = 'x' return $e");
    assert.equal(field.error?.code, "UNKNOWN_CATALOG_FIELD");
    assert.deepEqual(field.error?.details, { fields: ["comment"] });
    let logged = 0;
    (runtime as any).logs.serverWroteLog = () => logged++;
    const catalog = await query("for $e in persons return $e");
    assert.equal(catalog.error?.code, "UNKNOWN_CATALOG");
    // Сервер записал отказ в свой лог: следующее чтение лога должно дождаться файла.
    assert.equal(logged, 1);
    // Имена верны: причина в другом, и отказ сервера остаётся.
    const other = await query("for $e in people where no_such($e/lastname) return $e");
    assert.equal(other.error?.code, "PLATFORM_SOAP-FAULT");
  } finally {
    await runtime.close();
  }
});

test("причина сбоя скрипта сохраняется длинной, а обрезанный текст говорит, что он обрезан", async () => {
  const { runtime } = fakeRuntime({
    "*": () => {
      throw new HcmError("SCRIPT_FAILED", "m", undefined, {
        scriptError: "e".repeat(3000),
        other: "o".repeat(300),
        short: "s",
      });
    },
  });
  try {
    const failed = await runtime.call("native.lds.loadDoc", { url: "x-local://a.xml" });
    const details = failed.error!.details as Record<string, string>;
    assert.equal(details.scriptError!.length, 2048);
    assert.ok(details.scriptError!.endsWith("e…"));
    assert.equal(details.other!.length, 256);
    assert.ok(details.other!.endsWith("o…"));
    assert.equal(details.short, "s");
  } finally {
    await runtime.close();
  }
});

test("завершённая фоновая задача отдаёт результат простым значением, как прямой вызов", async () => {
  let answer: unknown = { IsRunning: "1" };
  const { runtime } = fakeRuntime({ "*": () => answer });
  try {
    const status = () => runtime.call("web.spxml.getAsyncMethodStatus", { trackingId: "0x1" });
    assert.deepEqual((await status()).data, { IsRunning: "1" });
    answer = {
      IsRunning: "0",
      ResultData: { Result: { "#text": "done", "@_VALUE-TYPE": "string" } },
    };
    assert.deepEqual((await status()).data, { IsRunning: "0", value: "done" });
    // У документа нет простого вида: ответ остаётся таким, как его дал сервер.
    answer = { IsRunning: "0", ResultData: { Result: { "@_VALUE-TYPE": "XmDoc", root: "x" } } };
    assert.deepEqual((await status()).data, answer);
  } finally {
    await runtime.close();
  }
});

test("схема по пути описывает сам элемент: список, его ключ", async () => {
  const reader = new SchemaReader(
    async () => info,
    form,
    async () => ({}),
  );
  const inside = await reader.get({ type: "person", path: "roles.role" });
  assert.deepEqual(inside.element, {
    path: "roles.role",
    type: "element",
    origin: "own",
    multiple: true,
    key: "role_id",
    children: 2,
  });
  assert.deepEqual(
    inside.fields.map((field) => field.path),
    ["roles.role.role_id", "roles.role.since"],
  );
  const missing = await reader.get({ type: "person", path: "roles.rol" });
  assert.equal(missing.element, undefined);
  assert.ok(missing.notes.includes("Поля roles.rol в типе person нет: путь ищет search."));
  const whole = await reader.get({ type: "person" });
  assert.equal(whole.element, undefined);
  // attr — вид значения, а не базовый тип, у которого пропали поля.
  assert.ok(!whole.notes.some((note) => note.includes("Базовый тип")));
  assert.equal(whole.fields.find((field) => field.path === "class")?.type, "attr");
});

test("страница поиска по логу короче запрошенной говорит об этом; сначала новые — параметр", async () => {
  const file = {
    name: "a.log",
    url: "x-local://Logs/a.log",
    type: "a",
    title: "A",
    sizeBytes: "1",
  };
  const events = Array.from({ length: 20 }, (_, sequence) => ({
    sequence,
    level: "error" as const,
    message: "m".repeat(90),
    text: "m".repeat(90),
    line: sequence,
  }));
  const search = {
    file,
    events,
    totalEvents: 40,
    matches: 40,
    fingerprint: "f",
    truncated: false,
    nextOffset: 20,
  };
  const cut = logMatches(search as never, 1000);
  assert.ok(cut.events.length < 20);
  assert.equal(cut.cutBySize, true);
  assert.equal(cut.nextOffset, cut.events.length);
  assert.equal(logMatches(search as never, 100_000).cutBySize, undefined);

  const { runtime } = fakeRuntime();
  const log = ["10:00:01 first", "10:00:02 second", "10:00:03 third"].join("\r\n");
  runtime.logs.read = async () =>
    ({
      file,
      text: log,
      truncated: false,
      fingerprint: "f",
      sizeBytesAfter: String(log.length),
    }) as never;
  try {
    const texts = async (args: Record<string, unknown>) =>
      ((await runtime.call("logs.search", { file: "a.log", ...args })).data as any).events.map(
        (event: { text: string }) => event.text,
      );
    assert.deepEqual(await texts({}), ["first", "second", "third"]);
    assert.deepEqual(await texts({ newestFirst: true }), ["third", "second", "first"]);
    assert.deepEqual(await texts({ newestFirst: true, limit: 1, offset: 1 }), ["second"]);
  } finally {
    await runtime.close();
  }
});

test("CLI: правка может быть одним --resave; справка называет ограничения и способы передать JSON", async () => {
  const io = {} as CliIo;
  const patch = await commandInvocation(
    parseArguments(["object", "patch", "person", "0x1", "--resave"]),
    io,
  );
  assert.deepEqual(patch, {
    operationId: "objects.patch",
    args: { type: "person", id: "0x1", resave: true },
  });
  const both = await commandInvocation(
    parseArguments(["object", "patch", "person", "0x1", "--args", '{"lastname":"N"}', "--resave"]),
    io,
  );
  assert.deepEqual(both.args, {
    type: "person",
    id: "0x1",
    patch: { lastname: "N" },
    resave: true,
  });
  const search = await commandInvocation(
    parseArguments(["logs", "search", "a.log", "--text", "x", "--newest-first"]),
    io,
  );
  assert.deepEqual(search.args, { file: "a.log", text: "x", newestFirst: true });
  for (const [command, text] of [
    ["query", /по умолчанию 20, не больше 1000/],
    ["object", /--input-file, --stdin, --args/],
    ["logs", /--newest-first/],
  ] as const)
    assert.match(JSON.stringify(cliHelp(command)), text, command);
});

test("запрос по каталогу сортирует по полям каталога; неверный порядок отклоняется до сервера", async () => {
  assert.equal(
    catalogQuery("people", { lastname: "A" }, ["fullname", "hire_date desc", "id ASC"]),
    "for $elem in people where ($elem/lastname = 'A') order by $elem/fullname, $elem/hire_date descending, $elem/id return $elem",
  );
  assert.equal(
    catalogQuery("people", {}, "fullname"),
    "for $elem in people order by $elem/fullname return $elem",
  );
  for (const order of [[], ["a b c"], ["a down"], ["a;b"], [1], ["a", "b", "c", "d", "e", "f"], {}])
    assert.throws(() => catalogQuery("people", {}, order), HcmError, JSON.stringify(order));
  const sent: string[] = [];
  const { runtime } = fakeRuntime({
    ...base,
    "native.lds.xQuery": (args, id) => {
      sent.push(String(args.query));
      if (sent.length > 1) throw refusal(id);
      return { Data: { person: [{ id: "1", lastname: "A" }] }, TotalCount: "1", EOF: "true" };
    },
  });
  try {
    // Инструмент принимает порядок списком, как записано в гайде.
    const sorted = mcpJson(
      await new HcmMcpTools(runtime).invoke("hcm_query", {
        catalog: "people",
        order: ["lastname"],
      }),
    );
    assert.equal(sorted.ok, true);
    assert.deepEqual(sent, ["for $elem in people order by $elem/lastname return $elem"]);
    // Поле, которого нет в каталоге, названо, как и для условия.
    const unknown = await runtime.call("runtime.query", { catalog: "people", order: "comment" });
    assert.equal(unknown.error?.code, "UNKNOWN_CATALOG_FIELD");
    assert.deepEqual(unknown.error?.details, { fields: ["comment"] });
    const raw = await runtime.call("runtime.query", {
      query: "for $e in people return $e",
      order: "id",
    });
    assert.equal(raw.error?.code, "QUERY_ARGUMENT");
    assert.match(raw.error!.hint!, /order by \$e\/поле/);
    // MS SQL отказывает в сортировке по полю с несколькими значениями, PostgreSQL отвечает: не запрашивается ни то ни другое.
    const several = await runtime.call("runtime.query", { catalog: "people", order: ["role_id"] });
    assert.equal(several.error?.code, "INVALID_ARGUMENT");
    assert.deepEqual(several.error?.details, { fields: ["role_id"] });
    assert.equal(sent.length, 2);
  } finally {
    await runtime.close();
  }
});

test("дата приходит без смещения, которое сервер добавляет к своему местному времени", async () => {
  assert.deepEqual(
    withoutFalseOffset({
      a: "2026-10-02T16:42:00+00:00",
      list: [{ b: "2026-10-02T16:42+00:00" }],
      text: "встреча 2026-10-02T16:42:00+00:00",
      zone: "2026-10-02T16:42:00+03:00",
      n: null,
    }),
    {
      a: "2026-10-02T16:42:00",
      list: [{ b: "2026-10-02T16:42" }],
      text: "встреча 2026-10-02T16:42:00+00:00",
      zone: "2026-10-02T16:42:00+03:00",
      n: null,
    },
  );
  const { runtime } = fakeRuntime({
    ...base,
    "native.lds.loadDoc": xml(
      "<person><id>1</id><lastname>A</lastname><roles><role><role_id>x</role_id><since>2025-01-01T00:00:00+00:00</since></role></roles></person>",
    ),
    "native.lds.xQuery": {
      Data: { person: [{ id: "1", hire_date: "2024-08-04T00:00:00+00:00" }] },
      TotalCount: "1",
      EOF: "true",
    },
  });
  try {
    const row = await runtime.call("runtime.query", { catalog: "people", fields: ["hire_date"] });
    assert.deepEqual((row.data as any).items, [{ hire_date: "2024-08-04T00:00:00" }]);
    const doc = await runtime.call("objects.get", { id: "1", fields: ["roles"] });
    assert.deepEqual((doc.data as any).data, {
      roles: { role: [{ role_id: "x", since: "2025-01-01T00:00:00" }] },
    });
    // Дата, записанная обратно как прочитана, ничего не меняет; значение до показано как прочитано.
    const since = async (value: string) =>
      (
        await runtime.call("objects.patch", {
          id: "1",
          preview: true,
          patch: { "roles.role[role_id=x].since": value },
        })
      ).data as any;
    assert.equal((await since("2025-01-01T00:00:00")).noop, true);
    assert.deepEqual((await since("2026-01-01T00:00:00")).changes, [
      {
        op: "set",
        path: "roles.role[role_id=x].since",
        before: "2025-01-01T00:00:00",
        after: "2026-01-01T00:00:00",
      },
    ]);
  } finally {
    await runtime.close();
  }
});

test("ответ, который не поместился, называет операции, которые его читают, именами вызывающего", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hcm-mock-runs-"));
  const { runtime, server } = fakeRuntime(
    { "*": manyRows },
    { runtimeDir: directory, outputLimitBytes: 2048 },
  );
  try {
    const big = await runtime.call("runtime.query", { catalog: "people", limit: 1000 });
    assert.equal(big.meta.truncated, true);
    const stored = big.data as { hint: string; resultId: string };
    assert.equal(stored.resultId, big.meta.resultId);
    assert.match(stored.hint, /results\.read .* results\.export/);
    const tool = errorInFrontendTerms(big, "mcp").data as { hint: string };
    assert.match(tool.hint, /hcm_result_read .* hcm_result_export/);
    const command = errorInFrontendTerms(big, "cli").data as { hint: string };
    assert.match(command.hint, /wtctl result read .* wtctl result export/);
    // Слишком длинные даже для предпросмотра строки оставляют в нём счётчики ответа.
    server.on("*", () => ({
      Data: { person: ["1", "2"].map((id) => ({ id, lastname: "Ф".repeat(1500) })) },
      TotalCount: "2",
      EOF: "true",
    }));
    const long = await runtime.call("runtime.query", { catalog: "people", limit: 1000 });
    // Предпросмотр сохранённого ответа называет его ключи: список — по размеру.
    assert.deepEqual((long.data as any).preview, {
      kind: "stored-result",
      items: "[список: 2]",
      total: 2,
    });
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("отключённое право называет, кто его включает", async () => {
  const { runtime } = fakeRuntime(
    {},
    { outputLimitBytes: 4096, permissions: { write: false, execute: false } },
  );
  try {
    const write = await runtime.call("objects.patch", { id: "1", patch: { name: "N" } });
    assert.equal(write.error?.code, "WRITE_DISABLED");
    assert.match(write.error!.hint!, /владелец подключения.*permissions\.write/);
    const execute = await runtime.call("execute.script", { code: "RESULT = [];" });
    assert.equal(execute.error?.code, "EXECUTE_DISABLED");
    assert.match(execute.error!.hint!, /владелец подключения.*permissions\.execute/);
  } finally {
    await runtime.close();
  }
});

test("пакет, который шёл дальше после сбоев, называет упавшие шаги в ошибке", async () => {
  const { runtime } = fakeRuntime({
    ...base,
    "native.lds.xQuery": (args, id) => {
      if (String(args.query).includes("comment")) throw refusal(id);
      return { Data: { person: [{ id: "1", lastname: "A" }] }, TotalCount: "1", EOF: "true" };
    },
  });
  try {
    const named = await runtime.call("runtime.batch", {
      steps: [{ id: "runtime.status" }, { id: "runtime.status", as: "mt-p-005" }],
    });
    assert.equal(
      named.error?.message,
      "steps[1].as: «mt-p-005» не подходит — нужно имя из латинских букв, цифр и _, первой не цифра.",
    );
    const twice = await runtime.call("runtime.batch", {
      steps: [
        { id: "runtime.status", as: "one" },
        { id: "runtime.status", as: "one" },
      ],
    });
    assert.deepEqual(twice.error?.details, { path: "steps[1].as" });
    const batch = await runtime.call("runtime.batch", {
      stopOnError: false,
      steps: [
        { id: "runtime.query", args: { catalog: "people", where: { lastname: "A" } } },
        { id: "runtime.query", args: { catalog: "people", where: { comment: "x" } } },
        { id: "runtime.query", args: { catalog: "people", order: "comment desc" } },
      ],
    });
    assert.equal(batch.error?.code, "BATCH_FAILED");
    assert.match(batch.error!.message, /2 из 3/);
    assert.deepEqual(batch.error?.details, {
      failed: [
        { index: 1, id: "runtime.query", code: "UNKNOWN_CATALOG_FIELD" },
        { index: 2, id: "runtime.query", code: "UNKNOWN_CATALOG_FIELD" },
      ],
    });
    assert.equal((batch.data as any).results.length, 3);
    const stopped = await runtime.call("runtime.batch", {
      steps: [
        { id: "runtime.query", args: { catalog: "people", where: { comment: "x" } } },
        { id: "runtime.query", args: { catalog: "people" } },
      ],
    });
    assert.match(stopped.error!.message, /шагов пакета: 1 из 2; после отказа не запускались: 1\./);
  } finally {
    await runtime.close();
  }
});

test("упавший пакет с сохранённым ответом говорит, чем читать шаги", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hcm-mock-runs-"));
  const { runtime } = fakeRuntime(
    { "*": manyRows },
    { runtimeDir: directory, outputLimitBytes: 2048 },
  );
  try {
    const batch = await runtime.call("runtime.batch", {
      stopOnError: false,
      steps: [
        { id: "runtime.query", args: { catalog: "people", limit: 1000 } },
        { id: "runtime.query", args: { catalog: "people", limit: 0 } },
      ],
    });
    assert.equal(batch.error?.code, "BATCH_FAILED");
    assert.equal(batch.meta.truncated, true);
    // Предпросмотр говорит про каждый шаг, прошёл ли он и сколько вернул.
    assert.deepEqual((batch.data as any).preview.results, [
      { ok: true, total: 200, rows: 200 },
      { ok: false, code: "INVALID_ARGUMENT" },
    ]);
    assert.match(
      batch.error!.hint!,
      /error\.details\.failed; ответы шагов сохранены, их читает results\.read/,
    );
    assert.match(errorInFrontendTerms(batch, "mcp").error!.hint!, /их читает hcm_result_read/);
    const steps = (
      await runtime.call("results.read", { resultId: batch.meta.resultId!, offset: 1 })
    ).data as any;
    assert.deepEqual([steps.list, steps.total], ["results", 2]);
    assert.equal(steps.items[0].error.code, "INVALID_ARGUMENT");
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("превью сохранённого пакета из 100 шагов помещается в предел и говорит, сколько шагов показано", async () => {
  const limit = 4096;
  const directory = await mkdtemp(join(tmpdir(), "hcm-mock-runs-"));
  const { runtime } = fakeRuntime(
    { "*": manyRows },
    { runtimeDir: directory, outputLimitBytes: limit },
  );
  try {
    const batch = await runtime.call("runtime.batch", {
      steps: Array.from({ length: 100 }, (_, index) => ({
        id: "runtime.query",
        as: `step${index}`,
        args: { catalog: "people" },
      })),
    });
    assert.equal(batch.meta.truncated, true);
    assert.ok(Buffer.byteLength(JSON.stringify(batch)) <= limit);
    const { preview, hint } = batch.data as any;
    assert.ok(preview.results.length > 0 && preview.results.length < 100);
    assert.deepEqual([preview.results[0].as, preview.results[0].ok], ["step0", true]);
    assert.match(hint, new RegExp(`первые ${preview.results.length} из 100\\)`));
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("сохранённый ответ пакета из одного шага читается по шагам и выгружается в JSONL одной строкой", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hcm-mock-runs-"));
  const { runtime } = fakeRuntime(
    { "*": manyRows },
    { runtimeDir: directory, outputLimitBytes: 2048 },
  );
  try {
    const batch = await runtime.call("runtime.batch", {
      steps: [{ id: "runtime.query", args: { catalog: "people", limit: 1000 } }],
    });
    const resultId = batch.meta.resultId!;
    assert.deepEqual((batch.data as any).preview.results, [{ ok: true, total: 200, rows: 200 }]);
    assert.match((batch.data as any).hint, /results\.read читает список results по элементам,/);
    // Шаг больше страницы чтения: он назван, а не пропущен.
    const steps = (await runtime.call("results.read", { resultId })).data as any;
    assert.deepEqual([steps.list, steps.total, steps.blockedItem.index], ["results", 1, 0]);
    const path = join(directory, "one.jsonl");
    const exported = await runtime.call("results.export", { resultId, path, format: "jsonl" });
    assert.equal((exported.data as any).items, 1);
    const line = JSON.parse(await readFile(path, "utf8"));
    assert.equal(line.data.items.length, 200);
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("список сохранённого ответа читается по элементам и экспортируется по строкам", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hcm-mock-runs-"));
  const { runtime } = fakeRuntime(
    { "*": manyRows },
    { runtimeDir: directory, outputLimitBytes: 2048 },
  );
  try {
    const big = await runtime.call("runtime.query", { catalog: "people", limit: 1000 });
    assert.match((big.data as any).hint, /список items по элементам/);
    const resultId = big.meta.resultId!;
    // Страница состоит из целых строк; та, что короче запрошенного, говорит, что её обрезал размер.
    const cut = (await runtime.call("results.read", { resultId, limit: 65536 })).data as any;
    assert.equal(cut.list, "items");
    assert.equal(cut.total, 200);
    assert.deepEqual(cut.items[0], { id: "0", lastname: "Фамилия" });
    assert.equal(cut.cutBySize, true);
    assert.equal(cut.nextOffset, cut.items.length);
    const asked = (await runtime.call("results.read", { resultId, offset: 198, limit: 5 }))
      .data as any;
    assert.deepEqual(
      asked.items.map((item: { id: string }) => item.id),
      ["198", "199"],
    );
    assert.equal(asked.cutBySize, undefined);
    // Весь ответ остаётся доступен как текст JSON, вместе с полями, не входящими в список.
    const text = (await runtime.call("results.read", { resultId, format: "json", limit: 41 }))
      .data as any;
    assert.equal(text.text, '{"items":[{"id":"0","lastname":"Фамилия"}');
    const lines = join(directory, "rows.jsonl");
    const exported = await runtime.call("results.export", {
      resultId,
      path: lines,
      format: "jsonl",
    });
    assert.equal((exported.data as any).items, 200);
    assert.equal(
      (await readFile(lines, "utf8")).split("\n")[199],
      '{"id":"199","lastname":"Фамилия"}',
    );
    const whole = join(directory, "whole.json");
    await runtime.call("results.export", { resultId, path: whole });
    const saved = JSON.parse(await readFile(whole, "utf8"));
    assert.equal(saved.items.length, 200);
    assert.equal(saved.total, 200);
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("сохранённый ответ со списком под другим именем читается по этому списку", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hcm-mock-runs-"));
  const { runtime } = fakeRuntime({}, { runtimeDir: directory, outputLimitBytes: 2048 });
  try {
    const stored = await runtime.results.put({
      total: 300,
      notes: ["n"],
      types: Array.from({ length: 300 }, (_, index) => ({ type: `t${index}` })),
    });
    assert.equal(stored.list, "types");
    const page = (await runtime.call("results.read", { resultId: stored.resultId, limit: 2 }))
      .data as any;
    assert.deepEqual(page, {
      items: [{ type: "t0" }, { type: "t1" }],
      total: 300,
      nextOffset: 2,
      list: "types",
    });
    const path = join(directory, "types.jsonl");
    const exported = await runtime.call("results.export", {
      resultId: stored.resultId,
      path,
      format: "jsonl",
    });
    assert.equal((exported.data as any).items, 300);
    // Ответ без собственного списка и ответ из одного текста читаются как раньше.
    const plain = await runtime.results.put({
      data: { a: "x".repeat(50) },
      unknownFields: ["a", "b"],
    });
    assert.equal(plain.list, undefined);
    // Берётся список, который составляет основную часть ответа, а не тот, где больше элементов.
    const rows = await runtime.results.put({
      items: [1, 2, 3].map((id) => ({ id, text: "x".repeat(40) })),
      unknownFields: ["a", "b", "c", "d"],
    });
    assert.equal(rows.list, "items");
    // Имя списка, записанное в тексте JSON через escape-последовательность, всё равно находится.
    const odd = await runtime.results.put({ 'a"b': [{ n: 1 }, { n: 2 }] });
    const oddPath = join(directory, "odd.jsonl");
    await runtime.call("results.export", {
      resultId: odd.resultId,
      path: oddPath,
      format: "jsonl",
    });
    assert.equal(await readFile(oddPath, "utf8"), '{"n":1}\n{"n":2}\n');
    const log = await runtime.results.put({ text: "line\n".repeat(10), events: [1, 2, 3] });
    assert.equal(log.list, undefined);
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("ответ, который клиент не смог прочитать, не называется ошибкой HTTP 200", () => {
  const explained = platformFailure(
    new WsHcmApiError("protocol", "Unexpected response", {
      operation: "GetModObjects",
      status: 200,
    }),
    "http://fixture.invalid/",
    "native.lds.getModObjects",
  );
  assert.equal(explained.message, "Сервер ответил HTTP 200, но разобрать ответ не удалось.");
});

test("весь набор аргументов запроса рядом с --catalog отклоняется с указанием, как его передать", async () => {
  const io = {} as CliIo;
  for (const source of [
    '{"catalog":"people","where":{"lastname":"A"}}',
    '{"fields":["id"]}',
    '{"order":["id"]}',
  ])
    await assert.rejects(
      commandInvocation(parseArguments(["query", "--catalog", "people", "--where", source]), io),
      /без --catalog/,
      source,
    );
  const plain = await commandInvocation(
    parseArguments(["query", "--catalog", "people", "--where", '{"where":{"eq":"A"}}']),
    io,
  );
  assert.deepEqual(plain.args, { catalog: "people", where: { where: { eq: "A" } } });
});

test("файл, прочитанный как объект по адресу, говорит, чем его читать", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hcm-mock-runs-"));
  const { runtime } = fakeRuntime({ "*": xml("<!-- form --><a/><b/>") }, { runtimeDir: directory });
  try {
    const failed = await runtime.call("objects.get", { url: "x-local://wtv/wtv_person.xmd" });
    assert.deepEqual(
      [failed.error?.message, failed.error?.hint],
      [
        "В ответе сервера не один документ XML.",
        "Если по адресу не документ объекта: файл читает files.read, поля формы — schema.get с url.",
      ],
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("текст файла, который помещается в ответ, всё равно сохраняется и экспортируется в файл", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hcm-mock-runs-"));
  const { runtime } = fakeRuntime(
    { "*": Buffer.from("строка 1\nстрока 2\n") },
    { runtimeDir: directory },
  );
  try {
    const read = await runtime.call("files.read", { url: "x-local://Logs/a.log" });
    assert.equal(read.meta.truncated, undefined);
    const path = join(directory, "a.log");
    await runtime.call("results.export", { resultId: read.meta.resultId, path, format: "text" });
    assert.equal(await readFile(path, "utf8"), "строка 1\nстрока 2\n");
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});

const logName = "xhttp_2026-09-30.log";
/** Сервер логов: один файл заданного размера; requested собирает размеры прочитанных концов. */
function logServer(size: number, requested: number[] = []): Script {
  const cells = ["Основной журнал", "30.09.2026", logName, String(size), "xhttp", "false"];
  const report = `<data><rs><r><cs>${[...cells, `x-local://Logs/${logName}`].map((value) => `<c><t>${value}</t></c>`).join("")}</cs></r></rs></data>`;
  return {
    "native.rpc.call": (args) => {
      if (args.target === "tools_report.server_log_report")
        return { valueType: "string", lexicalValue: report };
      const bytes = Number((args.args as { lexicalValue: string }[])[1]!.lexicalValue);
      requested.push(bytes);
      return {
        valueType: "string",
        lexicalValue: `Показано последние ${bytes} байт файла. Для просмотра всего файла его нужно сохранить.\n10:00:01 text`,
      };
    },
  };
}

test("текст лога сохраняется, даже когда помещается в ответ", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hcm-mock-runs-"));
  const { runtime } = fakeRuntime(logServer(100), { runtimeDir: directory });
  try {
    const read = await runtime.call("logs.read", { file: logName, tailBytes: 512 });
    assert.equal(read.ok, true);
    assert.equal(read.meta.truncated, undefined);
    assert.equal(typeof read.meta.resultId, "string");
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("чтение лога без размера берёт конец файла размером в страницу ответа", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hcm-mock-runs-"));
  const requested: number[] = [];
  const { runtime } = fakeRuntime(logServer(100_000, requested), {
    outputLimitBytes: 1000,
    runtimeDir: directory,
  });
  try {
    assert.equal((await runtime.call("logs.read", { file: logName })).ok, true);
    assert.equal((await runtime.call("logs.read", { file: logName, tailBytes: 300 })).ok, true);
    // Страница ответа — 60% предела: 600 байт; явный размер сильнее.
    assert.deepEqual(requested, [600, 300]);
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});
