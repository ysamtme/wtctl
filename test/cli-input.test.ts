import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { CliInputError, parseArguments } from "../src/cli/arguments.js";
import { commandInvocation, runCli } from "../src/cli/run.js";
import type { CliDependencies, CliIo, RuntimePort } from "../src/cli/types.js";
import type { ConnectionConfig } from "../src/contracts.js";
import { XmlDocument } from "../src/documents.js";
import { scratchRuntimeDir } from "./fake-server.js";

const config: ConnectionConfig = {
  name: "synthetic",
  baseUrl: "http://example.invalid",
  timeoutMs: 1000,
  maxResponseBytes: 1024,
  outputLimitBytes: 1024,
  runtimeDir: scratchRuntimeDir,
  permissions: { write: true, execute: true },
};

function makeFixture(input = "{}") {
  const calls: { id: string; args: Record<string, unknown> }[] = [];
  let stderr = "";
  let stdout = "";
  const io: CliIo = {
    writeOut: (text) => {
      stdout += text;
    },
    writeError: (text) => {
      stderr += text;
    },
    readFile: async () => input,
    readStdin: async () => input,
    readBinaryFile: async () => Buffer.from(input, "utf8"),
    readBinaryStdin: async () => Buffer.from(input, "utf8"),
    writeFile: async () => undefined,
  };
  const runtime: RuntimePort = {
    listOperations: () => ({ operations: [], total: 0 }),
    describe: () => {
      throw new Error("unused");
    },
    getOperationEffect: () => "read",
    call: async (id, args = {}) => {
      calls.push({ id, args });
      return {
        ok: true,
        data: args,
        meta: { operationId: id, connection: "synthetic", durationMs: 0 },
      };
    },
    close: async () => undefined,
  };
  const dependencies: CliDependencies = {
    loadConfiguration: () => config,
    createRuntime: () => runtime,
    runMcp: async () => undefined,
  };
  return { io, dependencies, calls, getStdout: () => stdout, getStderr: () => stderr };
}

async function invoke(argv: string[], input = "{}") {
  return commandInvocation(parseArguments(argv), makeFixture(input).io);
}

async function expectError(argv: string[], pattern: RegExp, input = "{}") {
  const f = makeFixture(input);
  const code = await runCli(argv, f.io, f.dependencies);
  assert.equal(code, 2, argv.join(" "));
  const err = JSON.parse(f.getStderr()).error as { code: string; message: string };
  assert.equal(err.code, "cli.invalid_input");
  assert.match(err.message, pattern, argv.join(" "));
}

test("query: позиционный каталог, символьные и shell-safe фильтры -w и их объединение", async () => {
  assert.deepEqual(
    await invoke([
      "query",
      "collaborators",
      "-w",
      "is_dismiss=false",
      "-w",
      "fullname~Иван",
      "-w",
      "code!=admin",
      "-f",
      "id,fullname",
      "-n",
      "5",
    ]),
    {
      operationId: "runtime.query",
      args: {
        catalog: "collaborators",
        where: { is_dismiss: false, fullname: { contains: "Иван" }, code: { ne: "admin" } },
        fields: ["id", "fullname"],
        limit: 5,
      },
    },
  );

  // Объединение нескольких операторов на одно поле и shell-safe операторы с двоеточием.
  assert.deepEqual(
    await invoke([
      "query",
      "collaborators",
      "-w",
      "hire_date:gte=2025-01-01",
      "-w",
      "hire_date:lt=2026-01-01",
      "-w",
      "role_id:in=admin,user,null",
      "-w",
      "org_id:eq=0x10",
      "-w",
      "org_id:ne=0x20",
      "-w",
      "note=",
      "-w",
      "score>=1.5",
      "-w",
      "score<=9.5",
      "-w",
      "rank>0",
      "-w",
      "rank<10",
      "-w",
      "url=x-local://share/a=b",
    ]),
    {
      operationId: "runtime.query",
      args: {
        catalog: "collaborators",
        where: {
          hire_date: { gte: "2025-01-01", lt: "2026-01-01" },
          role_id: { in: ["admin", "user", null] },
          org_id: { eq: "0x10", ne: "0x20" },
          note: "",
          score: { gte: "1.5", lte: "9.5" },
          rank: { gt: "0", lt: "10" },
          url: "x-local://share/a=b",
        },
      },
    },
  );

  // Смешивание JSON-объекта (включая экранированный \") с выражением -w и файлом условий.
  assert.deepEqual(
    await invoke([
      "query",
      "collaborators",
      "-w",
      '{\\"is_dismiss\\":false,\\"hire_date\\":{\\"gte\\":\\"2025-01-01\\"}}',
      "-w",
      "hire_date:lt=2026-01-01",
      "-w",
      "fullname:contains=true",
    ]),
    {
      operationId: "runtime.query",
      args: {
        catalog: "collaborators",
        where: {
          is_dismiss: false,
          hire_date: { gte: "2025-01-01", lt: "2026-01-01" },
          fullname: { contains: "true" },
        },
      },
    },
  );
  assert.deepEqual(
    await invoke(["query", "collaborators", "--input-file", "where.json"], '{"code":"abc"}'),
    {
      operationId: "runtime.query",
      args: { catalog: "collaborators", where: { code: "abc" } },
    },
  );

  // :in= из PowerShell-обёртки npm (через пробел без запятой), пробелы вокруг запятых и пробел внутри значения.
  assert.deepEqual(
    await invoke([
      "query",
      "collaborators",
      "-w",
      "code:in=a b c",
      "-w",
      "status:in=open, closed",
      "-w",
      "fullname:in=Иван Петров, Пётр Иванов",
    ]),
    {
      operationId: "runtime.query",
      args: {
        catalog: "collaborators",
        where: {
          code: { in: ["a", "b", "c"] },
          status: { in: ["open", "closed"] },
          fullname: { in: ["Иван Петров", "Пётр Иванов"] },
        },
      },
    },
  );

  // Прежний JSON с полями constructor/__proto__ и пустой файл условий с --catalog работают как раньше.
  const compatWhere = (
    await invoke(["query", "collaborators", "-w", '{"constructor":"example","__proto__":"p"}'])
  ).args.where as Record<string, unknown>;
  assert.equal(Object.getPrototypeOf(compatWhere), Object.prototype);
  assert.equal(compatWhere.constructor, "example");
  assert.equal(Object.getOwnPropertyDescriptor(compatWhere, "__proto__")?.value, "p");
  assert.deepEqual(
    await invoke(["query", "--catalog", "collaborators", "--input-file", "empty.json"], "   \n"),
    {
      operationId: "runtime.query",
      args: { catalog: "collaborators" },
    },
  );

  // Строка не-идентификатор по-прежнему остаётся XQuery.
  assert.deepEqual(await invoke(["query", "sql:SELECT 1"]), {
    operationId: "runtime.query",
    args: { query: "sql:SELECT 1" },
  });

  // Конфликты и ошибки разбора -w.
  await expectError(
    ["query", "collaborators", "--catalog", "collaborators"],
    /Каталог задан и аргументом, и в --catalog/,
  );
  await expectError(
    ["query", "collaborators", "-w", "code=a", "-w", "code=b"],
    /оператор eq задан больше одного раза/,
  );
  await expectError(
    ["query", "collaborators", "-w", "hire_date:gte=2025-01-01", "-w", "hire_date>=2025-02-01"],
    /оператор gte задан больше одного раза/,
  );
  await expectError(
    ["query", "collaborators", "-w", '{"a":1}', "-w", '{"a":{"eq":2}}'],
    /оператор eq задан больше одного раза/,
  );
  await expectError(
    ["query", "collaborators", "-w", '{"a":[]}', "-w", "a=1"],
    /Конфликтующие условия/,
  );
  await expectError(["query", "collaborators", "-w", "role:in="], /непустой список/);
  await expectError(["query", "collaborators", "-w", "role:in=,"], /не допускает пустые значения/);
  await expectError(
    ["query", "collaborators", "-w", "role:in=a,,b"],
    /не допускает пустые значения/,
  );
  await expectError(
    ["query", "collaborators", "-w", "role:in=a, ,b"],
    /не допускает пустые значения/,
  );
  await expectError(
    ["query", "collaborators", "-w", "code:startsWith=abc"],
    /Неизвестный оператор условия/,
  );
  await expectError(["query", "collaborators", "-w", "bad_without_op"], /Неверный формат --where/);
  await expectError(
    ["query", "collaborators", "-w", "code=a", "--input-file", "w.json"],
    /Условия заданы и в --where, и отдельным источником/,
  );
  await expectError(["query", "(1)", "-w", "code=a"], /--where требует каталог/);
});

test("object patch и object create: --set, --set-json, --remove, вложенные пути и объединение с вводом", async () => {
  // Только флаги в patch, включая очистку comment=, 64-битный ID строкой и путь со скобками [name=код].
  assert.deepEqual(
    await invoke([
      "object",
      "patch",
      "0x1",
      "-s",
      "name=Новое имя",
      "-s",
      "comment=",
      "-s",
      "person_id=9007199254740993",
      "-s",
      "code=007",
      "-s",
      "custom_elems.custom_elem[name=my_code].value=a=b",
      "--set-json",
      "is_dismiss=false",
      "--remove",
      "old_note",
      "--remove",
      "items[0]",
      "--preview",
      "--resave",
    ]),
    {
      operationId: "objects.patch",
      args: {
        id: "0x1",
        patch: {
          name: "Новое имя",
          comment: "",
          person_id: "9007199254740993",
          code: "007",
          "custom_elems.custom_elem[name=my_code].value": "a=b",
          is_dismiss: false,
        },
        remove: ["old_note", "items[0]"],
        preview: true,
        resave: true,
      },
    },
  );

  // Только --remove без --set.
  assert.deepEqual(await invoke(["object", "patch", "group", "0x1", "--remove", "comment"]), {
    operationId: "objects.patch",
    args: { id: "0x1", type: "group", remove: ["comment"] },
  });

  // Комбинирование с базовым JSON-объектом, {patch, remove} и массивом операций сохраняет строгий порядок.
  assert.deepEqual(
    await invoke(
      ["object", "patch", "0x1", "--input-file", "p.json", "-s", "name=Override", "--remove", "c"],
      '{"name":"Base","code":"k"}',
    ),
    {
      operationId: "objects.patch",
      args: {
        id: "0x1",
        patch: [
          { op: "set", path: "name", value: "Base" },
          { op: "set", path: "code", value: "k" },
          { op: "set", path: "name", value: "Override" },
          { op: "remove", path: "c" },
        ],
      },
    },
  );
  // Проверка реального применения на XmlDocument: CLI-флаги всегда выполняются после всех операций из файла.
  const nestedOverride = await invoke(
    ["object", "patch", "0x1", "--input-file", "p.json", "--set-json", 'a={"b":"cli"}'],
    '{"a":{"b":"first"},"a.b":"file"}',
  );
  assert.equal(
    (
      XmlDocument.parse("<group><id>1</id></group>").patch(nestedOverride.args.patch).after.data
        .a as Record<string, unknown>
    ).b,
    "cli",
  );
  const removeThenCli = await invoke(
    ["object", "patch", "0x1", "--input-file", "p.json", "--set-json", 'a={"b":"cli"}'],
    '{"patch":{"a":{"b":"first"}},"remove":["a.b"]}',
  );
  assert.equal(
    (
      XmlDocument.parse("<group><id>1</id></group>").patch(removeThenCli.args.patch).after.data
        .a as Record<string, unknown>
    ).b,
    "cli",
  );

  // Порядок разных флагов --remove и -s и символ «[» внутри значения ключа.
  assert.deepEqual(
    await invoke(["object", "patch", "0x1", "--remove", "items[0]", "-s", "items[0]=x"]),
    {
      operationId: "objects.patch",
      args: {
        id: "0x1",
        patch: [
          { op: "remove", path: "items[0]" },
          { op: "set", path: "items[0]", value: "x" },
        ],
      },
    },
  );
  const bracketInKey = await invoke([
    "object",
    "patch",
    "0x1",
    "-s",
    "items.item[name=a[b].value=next",
  ]);
  assert.deepEqual(bracketInKey.args.patch, { "items.item[name=a[b].value": "next" });
  const bracketDoc = XmlDocument.parse(
    "<group><id>1</id><items><item><name>a[b</name><value>old</value></item></items></group>",
  ).patch(bracketInKey.args.patch);
  assert.equal(
    ((bracketDoc.after.data.items as Record<string, unknown>).item as Record<string, unknown>)
      .value,
    "next",
  );
  assert.deepEqual(
    await invoke(
      ["object", "patch", "0x1", "--stdin", "-s", "b=2", "--remove", "d"],
      '[{"op":"set","path":"a","value":"1"}]',
    ),
    {
      operationId: "objects.patch",
      args: {
        id: "0x1",
        patch: [
          { op: "set", path: "a", value: "1" },
          { op: "set", path: "b", value: "2" },
          { op: "remove", path: "d" },
        ],
      },
    },
  );
  assert.deepEqual(
    await invoke(
      ["object", "patch", "0x1", "--stdin", "-s", "comment=restored"],
      '{"remove":["comment"]}',
    ),
    {
      operationId: "objects.patch",
      args: {
        id: "0x1",
        patch: [
          { op: "remove", path: "comment" },
          { op: "set", path: "comment", value: "restored" },
        ],
      },
    },
  );

  // object create: плоские и вложенные пути через точку, --set-json, наложение на файл.
  assert.deepEqual(
    await invoke([
      "object",
      "create",
      "group",
      "-s",
      "code=001",
      "-s",
      "meta.owner.id=9007199254740993",
      "--set-json",
      "active=true",
      "--set-json",
      'tags=[\\"a\\",\\"b\\"]',
    ]),
    {
      operationId: "objects.create",
      args: {
        type: "group",
        data: {
          code: "001",
          meta: { owner: { id: "9007199254740993" } },
          active: true,
          tags: ["a", "b"],
        },
      },
    },
  );
  assert.deepEqual(
    await invoke(
      ["object", "create", "group", "--input-file", "base.json", "-s", "name=New", "-s", "a.c=3"],
      '{"name":"Old","a":{"b":"2"}}',
    ),
    {
      operationId: "objects.create",
      args: { type: "group", data: { name: "New", a: { b: "2", c: "3" } } },
    },
  );
  // Порядок --set-json и -s сохраняется: a.c дописывается в объект, заданный ранее через --set-json.
  assert.deepEqual(
    await invoke(["object", "create", "group", "--set-json", 'a={"b":1}', "-s", "a.c=2"]),
    {
      operationId: "objects.create",
      args: { type: "group", data: { a: { b: 1, c: "2" } } },
    },
  );

  // Ошибки --set/--set-json/--remove и защита от prototype pollution и конфликтов пути.
  await expectError(["object", "patch", "0x1", "-s", "no_equals"], /ПУТЬ=ЗНАЧЕНИЕ/);
  await expectError(["object", "patch", "0x1", "-s", "=val"], /ПУТЬ=ЗНАЧЕНИЕ/);
  await expectError(["object", "patch", "0x1", "--set-json", "a=not-json"], /не JSON/);
  await expectError(["object", "patch", "0x1", "--remove", "   "], /не может быть пустым/);
  await expectError(["object", "create", "group"], /--set\/--set-json/);
  await expectError(
    ["object", "create", "group", "-s", "__proto__.polluted=1"],
    /Недопустимое имя/,
  );
  await expectError(["object", "create", "group", "-s", "constructor.x=1"], /Недопустимое имя/);
  await expectError(["object", "create", "group", "-s", "a..b=1"], /сегмент не может быть пустым/);
  await expectError(
    ["object", "create", "group", "-s", "a=1", "-s", "a.b=2"],
    /уже содержит не объект/,
  );
  await expectError(
    ["object", "create", "group", "-s", "a.b=2", "-s", "a=1"],
    /уже содержит вложенные поля/,
  );
});

test("object get: несколько ID позиционно с типом и без, а также проверка конфликтов и предела", async () => {
  assert.deepEqual(await invoke(["object", "get", "0x1", "0x2", "-f", "id,name"]), {
    operationId: "objects.get",
    args: { ids: ["0x1", "0x2"], fields: ["id", "name"] },
  });
  assert.deepEqual(await invoke(["object", "get", "0x1", "7", "0x3", "--type", "collaborator"]), {
    operationId: "objects.get",
    args: { ids: ["0x1", "7", "0x3"], type: "collaborator" },
  });
  assert.deepEqual(
    await invoke(["object", "get", "collaborator", "0x1", "0x2", "-f", "fullname"]),
    {
      operationId: "objects.get",
      args: { ids: ["0x1", "0x2"], type: "collaborator", fields: ["fullname"] },
    },
  );

  // 100 ID проходят, 101 отклоняется.
  const hundred = Array.from({ length: 100 }, (_, i) => String(i + 1));
  assert.equal(((await invoke(["object", "get", ...hundred])).args.ids as string[]).length, 100);
  await expectError(["object", "get", ...hundred, "101"], /не больше 100/);

  await expectError(
    ["object", "get", "collaborator", "0x1", "0x2", "--type", "group"],
    /Тип задан и аргументом, и в --type/,
  );
  await expectError(["object", "get", "0x1", "0x2", "--ids", "0x3"], /--ids задаётся без/);
  await expectError(
    ["object", "get", "0x1", "0x2", "--id", "0x3"],
    /и аргументом, и через --id или --url/,
  );
  await expectError(
    ["object", "get", "0x1", "0x2", "--url", "x-local://wt_data/1.xml"],
    /и аргументом, и через --id или --url/,
  );
  await expectError(["object", "get", "0x1", "bad"], /ID объекта записан неверно/);
  await expectError(["object", "get", "--ids", "0x1,bad"], /ID объекта записан неверно/);
  await expectError(["object", "get", "0xGG", "0x1", "0x2"], /ID объекта записан неверно/);
  await expectError(
    ["object", "get", "0x1", "0x10000000000000000"],
    /ID объекта не помещается в 64 бита/,
  );
  await expectError(
    ["object", "get", "--ids", "0x1,0x10000000000000000"],
    /ID объекта не помещается в 64 бита/,
  );
});

test("позиционный поиск в types, schema, rpc list, files list и logs search", async () => {
  assert.deepEqual(await invoke(["types", "сотрудник", "-n", "10"]), {
    operationId: "schema.types",
    args: { search: "сотрудник", limit: 10 },
  });
  assert.deepEqual(await invoke(["schema", "collaborator", "логин"]), {
    operationId: "schema.get",
    args: { type: "collaborator", search: "логин" },
  });
  assert.deepEqual(await invoke(["rpc", "list", "get_version"]), {
    operationId: "rpc.list",
    args: { query: "get_version" },
  });
  assert.deepEqual(await invoke(["rpc", "list", "-s", "get_version"]), {
    operationId: "rpc.list",
    args: { query: "get_version" },
  });
  assert.deepEqual(await invoke(["files", "list", "x-local://wtv", "form"]), {
    operationId: "files.list",
    args: { url: "x-local://wtv", search: "form" },
  });
  assert.deepEqual(
    await invoke(["logs", "search", "xhttp_2026.log", "timeout", "--level", "error"]),
    {
      operationId: "logs.search",
      args: { file: "xhttp_2026.log", text: "timeout", level: "error" },
    },
  );

  // Конфликт позиционного поиска с флагом и запрет позиционного поиска при schema --url.
  await expectError(["types", "a", "--search", "b"], /Поиск задан и аргументом, и в --search/);
  await expectError(
    ["schema", "collaborator", "a", "-s", "b"],
    /Поиск задан и аргументом, и в --search/,
  );
  await expectError(
    ["schema", "collaborator", "a", "--url", "x-local://wtv/c.xmd"],
    /С --url поиск задаётся флагом --search/,
  );
  await expectError(["rpc", "list", "a", "--query", "b"], /Поиск задан и аргументом, и в --query/);
  await expectError(
    ["files", "list", "x-local://wtv", "a", "-s", "b"],
    /Поиск задан и аргументом, и в --search/,
  );
  await expectError(
    ["logs", "search", "x.log", "a", "--text", "b"],
    /Поиск задан и аргументом, и в --text/,
  );
});

test("rpc: БИБ.ФУНКЦИЯ, БИБ ФУНКЦИЯ, позиционные скалярные аргументы и конфликты", async () => {
  assert.deepEqual(await invoke(["rpc", "tools.get_version"]), {
    operationId: "rpc.call",
    args: { library: "tools", method: "get_version", arguments: [] },
  });
  assert.deepEqual(
    await invoke([
      "rpc",
      "tools.sample_fn",
      "wtv",
      "true",
      "false",
      "null",
      "0",
      "-7",
      "999999999999999",
      "9007199254740993",
      "0x8000000000000001",
      "007",
      "1.5",
      "--async",
    ]),
    {
      operationId: "rpc.call",
      args: {
        library: "tools",
        method: "sample_fn",
        arguments: [
          "wtv",
          true,
          false,
          null,
          0,
          -7,
          999999999999999,
          "9007199254740993",
          "0x8000000000000001",
          "007",
          "1.5",
        ],
        async: true,
      },
    },
  );
  assert.deepEqual(await invoke(["rpc", "tools", "get_version", "wtv"]), {
    operationId: "rpc.call",
    args: { library: "tools", method: "get_version", arguments: ["wtv"] },
  });
  assert.deepEqual(await invoke(["rpc", "tools.get_version", "--args", '["wtv"]']), {
    operationId: "rpc.call",
    args: { library: "tools", method: "get_version", arguments: ["wtv"] },
  });

  // Конфликт позиционных аргументов с --args, лишний флаг у БИБ.ФУНКЦИЯ и прежняя ошибка rpc foo.
  await expectError(
    ["rpc", "tools.get_version", "wtv", "--args", '["wtv"]'],
    /заданы и позиционно/,
  );
  await expectError(["rpc", "tools.get_version", "--source"], /Команда rpc не принимает: --source/);
  await expectError(
    ["rpc", "foo"],
    /^Команды wtctl rpc foo нет: есть list, describe или вызов БИБЛИОТЕКА ФУНКЦИЯ\.$/,
  );
});

test("exec: повторяемые -p ключ=значение, JSON в -p и --param-json", async () => {
  assert.deepEqual(
    await invoke([
      "exec",
      "RESULT = [PARAMS];",
      "-p",
      "who=tester",
      "-p",
      "n=7",
      "-p",
      "neg=-3",
      "-p",
      "flag=true",
      "-p",
      "empty=",
      "-p",
      "big=9007199254740993",
      "-p",
      "code=007",
      "--param-json",
      'ids=[\\"0x1\\",\\"0x2\\"]',
    ]),
    {
      operationId: "execute.script",
      args: {
        code: "RESULT = [PARAMS];",
        params: {
          who: "tester",
          n: 7,
          neg: -3,
          flag: true,
          empty: "",
          big: "9007199254740993",
          code: "007",
          ids: ["0x1", "0x2"],
        },
      },
    },
  );

  // Смешивание JSON в -p и ключ=значение, точный порядок --param-json и -p, поле constructor.
  assert.deepEqual(
    await invoke([
      "exec",
      "RESULT=[];",
      "-p",
      '{"a":1,"b":2,"constructor":"example"}',
      "-p",
      "b=3",
      "--param-json",
      "c=null",
      "--param-json",
      "a=true",
      "-p",
      "a=two=x",
    ]),
    {
      operationId: "execute.script",
      args: {
        code: "RESULT=[];",
        params: { a: "two=x", b: 3, c: null, constructor: "example" },
      },
    },
  );

  await expectError(
    ["exec", "RESULT=[];", "-p", "a=1", "--params-file", "p.json"],
    /--params, и в --params-file/,
  );
  await expectError(
    ["exec", "RESULT=[];", "--param-json", "a=1", "--params-file", "p.json"],
    /--params-file/,
  );
  await expectError(["exec", "RESULT=[];", "-p", "bad"], /КЛЮЧ=ЗНАЧЕНИЕ/);
  await expectError(["exec", "RESULT=[];", "--param-json", "a=bad"], /не JSON/);

  // __proto__ в JSON и -p записывается собственным свойством без изменения прототипа.
  const protoParams = (await invoke(["exec", "RESULT=[];", "-p", '{"__proto__":"example"}'])).args
    .params as Record<string, unknown>;
  assert.equal(Object.getPrototypeOf(protoParams), Object.prototype);
  assert.equal(Object.getOwnPropertyDescriptor(protoParams, "__proto__")?.value, "example");
});

test("files write и files upload: позиционный локальный файл, --name и обработка ошибок чтения", async () => {
  assert.deepEqual(await invoke(["files", "write", "x-local://share/a.txt", "local.txt"]), {
    operationId: "files.write",
    args: { url: "x-local://share/a.txt", file: resolve("local.txt") },
  });
  await expectError(
    ["files", "write", "x-local://share/a.txt", "local.txt", "--input-file", "other.txt"],
    /Файл задан и аргументом/,
  );
  await expectError(
    ["files", "write", "x-local://share/a.txt", "local.txt", "--stdin"],
    /Файл задан и аргументом/,
  );

  // Позиционный файл в files upload и file upload, с --name и без него.
  assert.deepEqual(
    await invoke(["files", "upload", "dir/report.txt", "--content-type", "text/plain"], "Hi"),
    {
      operationId: "web.pages.uploadFile",
      args: {
        filename: "report.txt",
        data: { base64: Buffer.from("Hi").toString("base64") },
        contentType: "text/plain",
      },
    },
  );
  assert.deepEqual(
    await invoke(["files", "upload", "dir/local.bin", "--name", "custom.txt"], "Hi"),
    {
      operationId: "web.pages.uploadFile",
      args: { filename: "custom.txt", data: { base64: Buffer.from("Hi").toString("base64") } },
    },
  );
  assert.deepEqual(await invoke(["file", "upload", "dir/report.txt"], "Hi"), {
    operationId: "web.pages.uploadFile",
    args: { filename: "report.txt", data: { base64: Buffer.from("Hi").toString("base64") } },
  });
  assert.deepEqual(await invoke(["files", "upload", "--input-file", "dir/report.txt"], "Hi"), {
    operationId: "web.pages.uploadFile",
    args: { filename: "report.txt", data: { base64: Buffer.from("Hi").toString("base64") } },
  });
  assert.deepEqual(await invoke(["files", "upload", "--stdin", "--name", "piped.txt"], "Hi"), {
    operationId: "web.pages.uploadFile",
    args: { filename: "piped.txt", data: { base64: Buffer.from("Hi").toString("base64") } },
  });
  // Имя локального файла, похожее на длинный флаг с одним дефисом (-remove), принимается после --input-file.
  assert.deepEqual(
    await invoke(["files", "upload", "report.txt", "--input-file", "-remove"], "Hi"),
    {
      operationId: "web.pages.uploadFile",
      args: { filename: "report.txt", data: { base64: Buffer.from("Hi").toString("base64") } },
    },
  );
  assert.deepEqual(
    await invoke(["files", "write", "x-local://share/a.txt", "--input-file", "-remove"]),
    {
      operationId: "files.write",
      args: { url: "x-local://share/a.txt", file: resolve("-remove") },
    },
  );
  // А флаги CLI (-json, -preview) и секретные слова (-password=…) не съедаются как имя файла после -o.
  await expectError(["help", "-o", "-json"], /Для --output требуется значение/);
  await expectError(["help", "-o", "-preview"], /Для --output требуется значение/);
  await expectError(["help", "-o", "-password=secret"], /Для --output требуется значение/);

  // Конфликт позиционного имени и --name при --input-file / --stdin.
  await expectError(
    ["files", "upload", "a.txt", "--name", "b.txt", "--input-file", "c.txt"],
    /Имя файла задано и аргументом, и в --name/,
  );
  await expectError(
    ["files", "upload", "a.txt", "--name", "b.txt", "--stdin"],
    /Имя файла задано и аргументом, и в --name/,
  );

  // Отказ файловой системы при позиционном файле — CliInputError без «из --аргумент».
  const missing = makeFixture();
  missing.io.readBinaryFile = async () => {
    throw Object.assign(new Error("ENOENT"), { code: "ENOENT", syscall: "open" });
  };
  await assert.rejects(
    commandInvocation(parseArguments(["files", "upload", "absent.txt"]), missing.io),
    (error: unknown) =>
      error instanceof CliInputError &&
      error.message === `Файл не найден: ${resolve("absent.txt")}.`,
  );
});
