// files.write и files.delete: права и вид папки проверяются до отправки; запись одним путём для всех папок.
import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync, truncateSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { HcmClient, unwrap } from "../src/sdk.js";
import { HcmRuntime } from "../src/runtime.js";
import { runCli } from "../src/cli/run.js";
import { createHcmMcpServer } from "../src/mcp/server.js";
import { UPLOAD_BLOCK_BYTES } from "../src/files.js";
import { WsHcmApiError } from "../src/protocol/error.js";
import { parseXml } from "../src/protocol/xml.js";
import type { CliIo } from "../src/cli/types.js";
import { fakeRuntime, refusal, type Args } from "./fake-server.js";
import { mcpJson } from "./mcp-json.js";

const entries = [
  { name: "DATA-DB", value: "share" },
  { name: "DATA-DB", value: "source" },
  { name: "DATA-DB", value: "wt_data" },
  { name: "DATA-DB", value: "trash" },
  { name: "DESIGN-DB", value: "wt" },
  { name: "DESIGN-DB", value: "source" },
  { name: "DB-STORE-HOOK", value: "wt_data x-local://fixture/sx_store_sql.xml" },
  { name: "DB-STORE-HOOK", value: "trash\tx-local://fixture/sx_store_sql.xml" },
  { name: "OTHER", value: "never read" },
];
const value = (type: string, text: string) => ({
  valueType: type,
  lexicalValue: text,
  xml: parseXml(`<ResultData><Result VALUE-TYPE="${type}">${text}</Result></ResultData>`),
});
const scriptAnswer = (text: string) =>
  parseXml(
    `<ResultData><Result VALUE-TYPE="Object"><error VALUE-TYPE="integer">0</error><ticks VALUE-TYPE="integer">1</ticks><total VALUE-TYPE="integer">1</total><result VALUE-TYPE="Array"><e VALUE-TYPE="string">${text}</e></result><columns VALUE-TYPE="Array"/><data VALUE-TYPE="Object"/></Result></ResultData>`,
  );
const infoFields =
  '<sys_db_capability VALUE-TYPE="integer">1</sys_db_capability><catalog_limits VALUE-TYPE="string">&lt;catalogs/&gt;</catalog_limits><version_server VALUE-TYPE="string">2030.1.1</version_server><os_type VALUE-TYPE="string">windows</os_type>';
const INTERRUPTED =
  "Запись прервалась: файл на сервере может быть пустым или недописанным. Запись можно повторить целиком.";

/**
 * Сервер хранит файлы, записанные upload_*, отдаёт их чтением потоком и удаляет по адресу; адрес,
 * называющий "stays", есть всегда. fail — отказ функции записи по имени; readBack — свой ответ на
 * чтение назад по записанным байтам; door — отказ на входе у проверки адреса после удаления.
 */
function fixture(
  options: {
    execute?: boolean;
    lists?: boolean;
    door?: boolean;
    fail?: (target: string) => Error | undefined;
    readBack?: (stored: Buffer) => unknown;
  } = {},
) {
  const stored = new Map<string, Buffer>();
  let upload = { url: "", data: Buffer.alloc(0) };
  let deleted = false;
  const { runtime, server } = fakeRuntime(
    {
      "native.spxml2.getAppInfo": options.lists === false ? {} : { config_entries: entries },
      "native.rpc.call": (args) => {
        const values = ((args.args ?? []) as Args[]).map((arg) => arg.lexicalValue as string);
        const failure = options.fail?.(args.target);
        if (failure) throw failure;
        switch (args.target) {
          case "tools.upload_begin":
            upload = { url: values[0]!, data: Buffer.alloc(0) };
            return value("string", "upload_file_test");
          case "tools.upload_range":
            upload.data = Buffer.concat([upload.data, Buffer.from(values[3]!, "base64")]);
            return value("bool", "1");
          case "tools.upload_end":
            stored.set(upload.url, upload.data);
            return value("bool", "1");
          case "tools.file_url_exists_server":
            if (options.door && deleted)
              throw new WsHcmApiError("http", "unauthorized", { status: 401 });
            // Есть записанные файлы и адреса, называющие "stays": их удаление не удаляет.
            return value("bool", String(+(stored.has(values[0]!) || values[0]!.includes("stays"))));
          default:
            return {
              valueType: "Object",
              xml: parseXml(
                `<ResultData><Result VALUE-TYPE="Object">${infoFields}</Result></ResultData>`,
              ),
            };
        }
      },
      "native.lds.loadUrl": (args) => {
        const data = stored.get(args.url) ?? Buffer.alloc(0);
        return options.readBack ? options.readBack(data) : data;
      },
      "native.lds.deleteUrl": (args) => {
        deleted = true;
        stored.delete(args.url);
        return {};
      },
      "*": (_args, id) => (id === "web.rpc.call" ? scriptAnswer(state.answer) : {}),
    },
    { permissions: { write: true, execute: options.execute ?? true } },
  );
  const state = {
    answer: "0",
    stored,
    // Что отправлено: функции записи — по имени; списки папок и проверки существования не считаются.
    get sent() {
      return server.calls.flatMap(({ id, args }) =>
        id === "native.spxml2.getAppInfo" || args.target === "tools.file_url_exists_server"
          ? []
          : [{ id: id === "native.rpc.call" ? (args.target as string) : id, args }],
      );
    },
  };
  return { runtime, state, server };
}
const ids = (state: { sent: { id: string }[] }) => state.sent.map((call) => call.id);
const lexical = (call: { args: Args }) =>
  (call.args.args as Args[]).map((arg) => arg.lexicalValue as string);

async function temporary<T>(action: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "wtctl-write-"));
  try {
    return await action(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("файл с диска идёт блоками по 10 000 000 байт, затем читается назад и сверяется", async () => {
  await temporary(async (directory) => {
    const { runtime, state } = fixture();
    const bytes = Buffer.alloc(UPLOAD_BLOCK_BYTES + 1, "абв");
    const file = join(directory, "big.bin");
    await writeFile(file, bytes);
    const url = "x-local://share/a/big.bin";
    const data = unwrap(await new HcmClient(runtime).writeFile({ url, file }));
    assert.deepEqual(data, { bytes: bytes.length, mutationOutcome: "confirmed" });
    assert.deepEqual(ids(state), [
      "tools.upload_begin",
      "tools.upload_range",
      "tools.upload_range",
      "tools.upload_end",
      "native.lds.loadUrl",
    ]);
    const [begin, first, second, end, read] = state.sent;
    assert.deepEqual(lexical(begin!), [url, String(bytes.length)]);
    assert.deepEqual(lexical(first!).slice(0, 3), ["upload_file_test", "0", "10000000"]);
    assert.deepEqual(lexical(second!), [
      "upload_file_test",
      "10000000",
      "10000001",
      bytes.subarray(-1).toString("base64"),
    ]);
    assert.deepEqual(lexical(end!), ["upload_file_test"]);
    assert.deepEqual(read!.args, { url, useBinaryResponse: true });
    assert.ok(state.stored.get(url)!.equals(bytes));
    await runtime.close();
  });
});

test("text, base64 и пустой файл пишутся тем же путём в папки данных, кода, wt_data и trash", async () => {
  const { runtime, state } = fixture();
  const text = "Привет\r\nмир";
  for (const [url, args] of [
    ["x-local://wt/web/a.txt", { text }],
    ["x-local://wt_data/a/b.bin", { base64: Buffer.from([0, 1, 255]).toString("base64") }],
    ["x-local://trash/a.txt", { text }],
    ["x-local://source/a.txt", { text: "" }],
  ] as const) {
    const result = await runtime.call("files.write", { url, ...args });
    assert.equal(result.ok, true, JSON.stringify(result));
  }
  assert.equal(state.stored.get("x-local://wt/web/a.txt")!.toString(), text);
  assert.deepEqual([...state.stored.get("x-local://wt_data/a/b.bin")!], [0, 1, 255]);
  // У пустого файла нет блоков: начало, конец и чтение назад.
  assert.deepEqual(ids(state).slice(-3), [
    "tools.upload_begin",
    "tools.upload_end",
    "native.lds.loadUrl",
  ]);
  await runtime.close();
});

test("отказ или обрыв на любом шаге после начала записи — indeterminate: файл может быть пустым или недописанным", async () => {
  const refuseAt = (step: string) => ({
    fail: (target: string) => (target === step ? refusal("CallMethod") : undefined),
  });
  const cases = [
    ["tools.upload_begin", fixture(refuseAt("tools.upload_begin"))],
    ["tools.upload_range", fixture(refuseAt("tools.upload_range"))],
    ["tools.upload_end", fixture(refuseAt("tools.upload_end"))],
    ["tools.upload_range", fixture()],
  ] as const;
  // Неожиданный ответ функции записи — тоже обрыв.
  cases[3][1].server.on("native.rpc.call", (args) =>
    args.target === "tools.upload_begin" ? value("string", "upload_file_test") : value("bool", "0"),
  );
  for (const [step, { runtime, state }] of cases) {
    const result = await runtime.call("files.write", { url: "x-local://share/a.txt", text: "abc" });
    assert.equal(result.error?.mutationOutcome, "indeterminate", step);
    assert.equal(result.error?.message, INTERRUPTED);
    assert.ok(result.error?.hint, step);
    assert.equal(ids(state).at(-1), step);
    await runtime.close();
  }
  // Запрос, который сервер отклонил на входе, не ушёл: исход not_sent и своё сообщение.
  const door = fixture({
    fail: (target) =>
      target === "tools.upload_begin"
        ? new WsHcmApiError("auth", "denied", { status: 401 })
        : undefined,
  });
  const refused = await door.runtime.call("files.write", { url: "x-local://share/a", text: "a" });
  assert.equal(refused.error?.mutationOutcome, "not_sent");
  assert.notEqual(refused.error?.message, INTERRUPTED);
  await door.runtime.close();
});

test("сбой чтения назад после подтверждённой записи — indeterminate: файл записан, но не сверен", async () => {
  const timeout = async function* () {
    yield Buffer.from("a");
    throw new WsHcmApiError("http", "Не удалось прочитать тело HTTP-ответа", {
      details: { network: "timeout" },
    });
  };
  const { runtime, state } = fixture({ readBack: () => timeout() });
  const result = await runtime.call("files.write", { url: "x-local://share/a.txt", text: "abc" });
  assert.equal(result.error?.mutationOutcome, "indeterminate");
  assert.equal(result.error?.message, "Файл записан, но прочитать его для сверки не удалось.");
  // Сначала что делать, затем причина сбоя: здесь — время запроса.
  assert.match(
    result.error!.hint!,
    /^Содержимое на сервере не проверено: сравнить через files\.read; запись можно повторить целиком\. .*timeoutMs/,
  );
  assert.deepEqual(ids(state), [
    "tools.upload_begin",
    "tools.upload_range",
    "tools.upload_end",
    "native.lds.loadUrl",
  ]);
  await runtime.close();
});

test("файл на диске, изменившийся во время записи: уходит названный в начале размер, укороченный — обрыв", async () => {
  await temporary(async (directory) => {
    const file = join(directory, "a.bin");
    const change = (step: string, edit: () => void) => (target: string) => {
      if (target === step) edit();
      return undefined;
    };
    await writeFile(file, "abc");
    const grown = fixture({ fail: change("tools.upload_begin", () => appendFileSync(file, "d")) });
    const url = "x-local://share/a.bin";
    assert.deepEqual((await grown.runtime.call("files.write", { url, file })).data, {
      bytes: 3,
      mutationOutcome: "confirmed",
    });
    assert.equal(grown.state.stored.get(url)!.toString(), "abc");
    await grown.runtime.close();

    await writeFile(file, Buffer.alloc(UPLOAD_BLOCK_BYTES + 1));
    const shrunk = fixture({ fail: change("tools.upload_range", () => truncateSync(file, 1)) });
    const result = await shrunk.runtime.call("files.write", { url, file });
    assert.equal(result.error?.mutationOutcome, "indeterminate");
    assert.equal(result.error?.message, INTERRUPTED);
    assert.match(result.error!.hint!, /файл стал короче/);
    await shrunk.runtime.close();
  });
});

test("файл, прочитанный назад не таким, — READ_BACK_MISMATCH без повтора записи", async () => {
  for (const [readBack, message] of [
    [
      (data: Buffer) => data.subarray(1),
      /^Файл на сервере после записи отличается от отправленного: 2 байт вместо 3\.$/,
    ],
    [
      (data: Buffer) => Buffer.from(data).reverse(),
      /^Файл на сервере после записи того же размера, что отправленный, но с другим содержимым\.$/,
    ],
  ] as const) {
    const { runtime, state } = fixture({ readBack });
    const result = await runtime.call("files.write", { url: "x-local://share/a", text: "abc" });
    assert.equal(result.error?.code, "READ_BACK_MISMATCH");
    assert.match(result.error!.message, message);
    assert.match(
      result.error!.hint!,
      /^Файл записывается целиком: запись можно повторить; .*files\.read\.$/,
    );
    assert.equal(result.error?.mutationOutcome, "indeterminate");
    assert.equal(ids(state).filter((id) => id === "tools.upload_begin").length, 1);
    await runtime.close();
  }
});

test("до начала записи отказ — not_sent: аргументы, права, вид папки и файл на диске", async () => {
  await temporary(async (directory) => {
    const { runtime, state } = fixture({ execute: false });
    const url = "x-local://share/a.txt";
    for (const args of [
      { url },
      { url, text: "x", base64: "eA==" },
      { url, text: "x", file: join(directory, "a") },
      { url, base64: "eA" },
      { url, base64: "eA==\n" },
      { url, text: "\ud800" },
      { url, file: "relative.txt" },
      { url, file: join(directory, "missing.txt") },
      { url, file: directory },
    ]) {
      const refused = await runtime.call("files.write", args);
      assert.equal(refused.error?.code, "INVALID_ARGUMENT", JSON.stringify(args));
      assert.equal(refused.error?.mutationOutcome, "not_sent");
    }
    for (const url of [
      "x-local://share/../wt/a.txt",
      "x-local://share/%2e%2E/wt/a.txt",
      "x-local://share/./a.txt",
      "x-local://share/a%2fb.txt",
      "x-local://share/a%5Cb.txt",
      "x-local://share/.. /wt/a.txt",
      "x-local://share/.../a.txt",
      "x-local://share/a%00b.txt",
      "x-local://share/a%0ab.txt",
      "x-local://share",
      "x-local://share/",
      "x-local://share//a.txt",
      "x-local://sh%61re/a.txt",
      "x-local://wt\\a.txt",
      "http://fixture.invalid/a.txt",
    ])
      for (const [id, extra] of [
        ["files.write", { text: "x" }],
        ["files.delete", {}],
      ] as const) {
        const refused = await runtime.call(id, { url, ...extra });
        assert.equal(refused.error?.code, "INVALID_ARGUMENT", url);
        assert.equal(refused.error?.mutationOutcome, "not_sent");
      }
    const none = await runtime.call("files.write", { url: "x-local://Logs/a.txt", text: "x" });
    assert.equal(none.error?.code, "FOLDER_NOT_WRITABLE");
    assert.match(
      none.error!.hint!,
      /Папки данных: share, source, wt_data, trash\. Папки кода .*: wt\./,
    );
    const code = await runtime.call("files.write", { url: "x-local://wt/a.txt", text: "x" });
    assert.equal(code.error?.code, "EXECUTE_DISABLED");
    assert.match(code.error!.message, /^Папка wt — папка кода: файл в ней — код сервера/);
    assert.equal(code.error?.mutationOutcome, "not_sent");
    assert.deepEqual(ids(state), []);
    // Папке данных execute не нужен; одиночный % — обычный символ в имени файла.
    assert.equal(
      (await runtime.call("files.write", { url: "x-local://share/50%.txt", text: "x" })).ok,
      true,
    );
    await runtime.close();
    // Без списков папок вид папки неизвестен: запись требует и execute.
    const bare = fixture({ execute: false, lists: false });
    const unlisted = await bare.runtime.call("files.write", { url, text: "x" });
    assert.equal(unlisted.error?.code, "EXECUTE_DISABLED");
    assert.match(unlisted.error!.message, /^Сервер не сообщил, какие папки — папки кода/);
    assert.deepEqual(ids(bare.state), []);
    await bare.runtime.close();
  });
});

test("чтение назад идёт потоком и не упирается в maxResponseBytes", async () => {
  const soap = (method: string, payload = "") =>
    `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope/"><soap:Body><${method}Response xmlns="http://www.datex-soft.com/">${payload}</${method}Response></soap:Body></soap:Envelope>`;
  let data = Buffer.alloc(0);
  let binaryRequest = "";
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/spxml2/get_app_info")
      return Response.json({ config_entries: [{ name: "DATA-DB", value: "share" }] });
    const body = String(init?.body);
    const method = /<soap:Body><([A-Za-z]+)/.exec(body)?.[1] ?? "loggedoff";
    const step = /<MethodName>upload_(\w+)</.exec(body)?.[1];
    if (step === "range")
      data = Buffer.concat([
        data,
        Buffer.from(/<arg-3 VALUE-TYPE="string">([^<]*)</.exec(body)![1]!, "base64"),
      ]);
    if (method === "LoadUrl") {
      binaryRequest = body;
      // Ответ частями по 1 КиБ, как сервер отдаёт файл с диска.
      return new Response(
        new ReadableStream({
          start(stream) {
            for (let start = 0; start < data.length; start += 1024)
              stream.enqueue(data.subarray(start, start + 1024));
            stream.close();
          },
        }),
        { headers: { "content-type": "application/binary" } },
      );
    }
    const payload =
      method === "OpenSession"
        ? "<SessionID>42</SessionID>"
        : step
          ? `<ResultData><Result VALUE-TYPE="${step === "begin" ? "string" : "bool"}">${step === "begin" ? "upload_file_test" : "1"}</Result></ResultData>`
          : "";
    return new Response(soap(method, payload), {
      headers: { "content-type": "application/soap+xml", "set-cookie": "SessionID=owned" },
    });
  };
  await temporary(async (directory) => {
    const runtime = new HcmRuntime({
      name: "stream",
      baseUrl: "http://stream-fixture.invalid/",
      username: "fixture",
      password: "fixture-password",
      timeoutMs: 1000,
      maxResponseBytes: 1024,
      outputLimitBytes: 4096,
      runtimeDir: directory,
      permissions: { write: true, execute: false },
      fetch,
    });
    const text = "строка\n".repeat(4096);
    const result = await runtime.call("files.write", { url: "x-local://share/a.txt", text });
    assert.deepEqual(result.data, { bytes: Buffer.byteLength(text), mutationOutcome: "confirmed" });
    assert.match(binaryRequest, /<UseBinaryResponse>true<\/UseBinaryResponse>/);
    await runtime.close();
  });
});

test("файл с диска передаётся путём из CLI, api call и MCP; --stdin — данными", async () => {
  await temporary(async (directory) => {
    const file = join(directory, "a.bin");
    await writeFile(file, Buffer.from([0, 1, 255]));
    let out = "";
    const io = {
      writeOut: (text: string) => void (out += text),
      writeError: (text: string) => void (out += text),
      readFile: async () => JSON.stringify({ url: "x-local://share/api.bin", file }),
      readStdin: async () => "",
      writeFile: async () => undefined,
      readBinaryFile: async () => assert.fail("файл читает операция, а не команда"),
      readBinaryStdin: async () => Uint8Array.from([7]),
    } as unknown as CliIo;
    // Команда закрывает свой runtime, поэтому каждой — свой.
    const cli = async (args: string[], url: string) => {
      const { runtime, state } = fixture();
      out = "";
      const code = await runCli(args, io, {
        loadConfiguration: () => runtime.config,
        createRuntime: () => runtime,
        runMcp: async () => undefined,
      });
      assert.equal(code, 0, out);
      return [...state.stored.get(url)!];
    };
    // Относительный путь команда превращает в полный от текущей папки.
    const cwd = process.cwd();
    process.chdir(directory);
    try {
      const url = "x-local://share/cli.bin";
      assert.deepEqual(
        await cli(["files", "write", url, "--input-file", "a.bin"], url),
        [0, 1, 255],
      );
    } finally {
      process.chdir(cwd);
    }
    const stdin = "x-local://share/in.bin";
    assert.deepEqual(await cli(["files", "write", stdin, "--stdin"], stdin), [7]);
    const api = ["api", "call", "files.write", "--input-file", "args.json"];
    assert.deepEqual(await cli(api, "x-local://share/api.bin"), [0, 1, 255]);

    const { runtime } = fixture();
    const server = createHcmMcpServer(runtime);
    const client = new Client({ name: "files-write", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const written = mcpJson(
      await client.callTool({
        name: "hcm_api_write",
        arguments: { operationId: "files.write", args: { url: "x-local://share/mcp.bin", file } },
      }),
    );
    assert.deepEqual(written.data, { bytes: 3, mutationOutcome: "confirmed" });
    await client.close();
    await server.close();
    await runtime.close();
  });
});

test("файл удаляется кодом в папке кода; адрес папки отклоняется и ничего не удаляет", async () => {
  const { runtime, state } = fixture();
  state.answer = "deleted";
  assert.deepEqual((await runtime.call("files.delete", { url: "x-local://wt/a.txt" })).data, {
    deleted: true,
    mutationOutcome: "confirmed",
  });
  assert.match(
    JSON.stringify(state.sent[0]!.args),
    /IsDirectory\(PARAMS\.url\)[\s\S]*DeleteUrl\(PARAMS\.url\)/,
  );
  state.answer = "directory";
  const folder = await runtime.call("files.delete", { url: "x-local://wt/web" });
  assert.equal(folder.error?.code, "FILE_IS_FOLDER");
  assert.equal(folder.error?.mutationOutcome, "not_sent");
  state.answer = "absent";
  const absent = await runtime.call("files.delete", { url: "x-local://wt/none.txt" });
  assert.equal(absent.error?.code, "FILE_NOT_FOUND");
  assert.equal(absent.error?.mutationOutcome, "not_sent");
  await runtime.close();
});

test("удаление в папке данных проверяет адрес до отправки; папка кода без execute отклоняется", async () => {
  const { runtime, state } = fixture({ execute: false });
  const refused = await runtime.call("files.delete", { url: "x-local://wt/a.txt" });
  assert.equal(refused.error?.code, "EXECUTE_DISABLED");
  assert.match(refused.error!.message, /^Папка wt на этом сервере принимает удаление только кодом/);
  assert.equal(refused.error?.mutationOutcome, "not_sent");
  const absent = await runtime.call("files.delete", { url: "x-local://share/a.txt" });
  assert.deepEqual(
    [absent.error?.code, absent.error?.mutationOutcome, absent.error?.message, absent.error?.hint],
    [
      "FILE_NOT_FOUND",
      "not_sent",
      "По адресу нет файла или папки.",
      "Адрес проверяет files.exists.",
    ],
  );
  // Папку в базе данных называет DB-STORE-HOOK, а не имя: без строк сервера wt_data — обычная папка.
  for (const lists of [true, false])
    for (const folder of ["wt_data", "trash"]) {
      const f = fixture({ lists });
      const empty = await f.runtime.call("files.delete", { url: `x-local://${folder}/x` });
      assert.equal(empty.error?.code, "FILE_NOT_FOUND");
      assert.equal(empty.error?.mutationOutcome, "not_sent");
      if (lists) {
        assert.equal(empty.error?.message, "По адресу нет файла.");
        assert.equal(
          empty.error?.hint,
          `Папку ${folder} сервер хранит в базе данных: вложенных папок в ней нет, файлы удаляются по одному. Список показывает files.list.`,
        );
      } else assert.equal(empty.error?.message, "По адресу нет файла или папки.");
      const url = `x-local://${folder}/x/a.txt`;
      assert.equal((await f.runtime.call("files.write", { url, text: "a" })).ok, true);
      assert.deepEqual((await f.runtime.call("files.delete", { url })).data, {
        deleted: true,
        mutationOutcome: "confirmed",
      });
      assert.equal(unwrap(await new HcmClient(f.runtime).fileExists({ url })).exists, false);
      assert.equal(ids(f.state).at(-1), "native.lds.deleteUrl");
      await f.runtime.close();
    }
  // Удаление в папке в базе данных проверяется по адресу, а проверка принимает до 256 знаков.
  const long = await runtime.call("files.delete", { url: `x-local://wt_data/${"a".repeat(240)}` });
  assert.equal(long.error?.code, "INVALID_ARGUMENT");
  assert.equal(
    long.error?.message,
    "url: в папке wt_data адрес для удаления — не длиннее 256 знаков.",
  );
  assert.equal(long.error?.mutationOutcome, "not_sent");
  assert.deepEqual(ids(state), []);
  await runtime.close();
});

test("удаление, после которого адрес остался, имеет исход indeterminate на обоих путях", async () => {
  const { runtime, state } = fixture();
  const data = await runtime.call("files.delete", { url: "x-local://share/stays.txt" });
  assert.equal(data.error?.code, "READ_BACK_MISMATCH");
  assert.equal(data.error?.mutationOutcome, "indeterminate");
  assert.deepEqual(ids(state), ["native.lds.deleteUrl"]);
  // В папке в базе данных остаётся только файл с копией на диске.
  const disk = await runtime.call("files.delete", { url: "x-local://wt_data/stays.txt" });
  assert.deepEqual(
    [disk.error?.code, disk.error?.mutationOutcome, disk.error?.message],
    [
      "FILE_NOT_DELETABLE",
      "indeterminate",
      "Файл остался: у него есть копия на диске сервера, а её сервер по адресу не удаляет.",
    ],
  );
  assert.match(disk.error!.hint!, /^Свою копию в базе данных сервер удалил, если она была/);
  // Слишком длинный для проверки существования адрес в обычной папке не проверяется.
  const long = `x-local://share/stays${"a".repeat(250)}`;
  assert.equal((await runtime.call("files.delete", { url: long })).ok, true);
  // В папке кода сам код смотрит на адрес: клиент больше ничего не спрашивает.
  state.answer = "deleted";
  assert.equal((await runtime.call("files.delete", { url: "x-local://wt/stays.txt" })).ok, true);
  state.answer = "remains";
  const code = await runtime.call("files.delete", { url: "x-local://wt/a.txt" });
  assert.equal(code.error?.code, "READ_BACK_MISMATCH");
  assert.equal(code.error?.mutationOutcome, "indeterminate");
  await runtime.close();
});

test("удаление, принятое и затем встретившее в проверке отказ на входе, имеет исход indeterminate", async () => {
  const { runtime, state } = fixture({ door: true });
  state.stored.set("x-local://share/a.txt", Buffer.from("a"));
  const result = await runtime.call("files.delete", { url: "x-local://share/a.txt" });
  assert.deepEqual(ids(state), ["native.lds.deleteUrl"]);
  assert.equal(result.error?.mutationOutcome, "indeterminate");
  assert.match(result.error?.hint ?? "", /запрос на запись уже ушёл/);
  await runtime.close();
});

test("адрес документа объекта files.delete и files.write отклоняют до отправки, files.read читает", async () => {
  const { runtime, server, state } = fixture();
  for (const url of [
    "x-local://wt_data/objects/607999B973FFE0/44.xml",
    "x-local://trash/objects/607999b973ffe0/4a.XML",
    "x-local://share/objects/607999B973FFE0/44.Xml",
    "x-local://wt/objects/607999B973FFE0/44.xml",
  ]) {
    const write = await runtime.call("files.write", { url, text: "<x/>" });
    const gone = await runtime.call("files.delete", { url });
    assert.deepEqual(
      [write, gone].map((answer) => [answer.error?.code, answer.error?.mutationOutcome]),
      [
        ["FILE_IS_DOCUMENT", "not_sent"],
        ["FILE_IS_DOCUMENT", "not_sent"],
      ],
      url,
    );
    assert.equal(write.error?.message, "Адрес — документ объекта: files.write его не записывает.");
    assert.match(write.error!.hint!, /^Поля объекта правит objects\.patch/);
    assert.equal(gone.error?.message, "Адрес — документ объекта: files.delete его не удаляет.");
    assert.match(gone.error!.hint!, /^Объект удаляет objects\.delete/);
  }
  // Адрес проверяется раньше аргументов: файл с диска даже не открывается.
  const local = await runtime.call("files.write", {
    url: "x-local://wt_data/objects/607999B973FFE0/44.xml",
    file: "relative.txt",
  });
  assert.equal(local.error?.code, "FILE_IS_DOCUMENT");
  assert.equal(server.calls.length, 0);
  state.stored.set("x-local://wt_data/objects/607999B973FFE0/44.xml", Buffer.from("<x/>"));
  const read = await runtime.call("files.read", {
    url: "x-local://wt_data/objects/607999B973FFE0/44.xml",
  });
  assert.equal((read.data as { text?: string }).text, "<x/>");
  // Сервер разбирает только objects строчными первой частью пути и 14 и 2 цифры с .xml в конце.
  for (const url of [
    "x-local://wt_data/objects/1/2.xml",
    "x-local://wt_data/OBJECTS/607999B973FFE0/44.xml",
    "x-local://wt_data/a/objects/607999B973FFE0/44.xml",
    "x-local://wt_data/objects/607999B973FFE0/55.xml.bak",
  ]) {
    assert.equal((await runtime.call("files.write", { url, text: "x" })).ok, true, url);
    assert.equal((await runtime.call("files.delete", { url })).ok, true, url);
  }
  await runtime.close();
});

test("server.info перечисляет папки профиля native, папку из обоих списков — среди папок данных", async () => {
  const { runtime } = fixture();
  const info = unwrap(await new HcmClient(runtime).serverInfo());
  assert.deepEqual(
    [info.dataFolders, info.codeFolders],
    [["share", "source", "wt_data", "trash"], ["wt"]],
  );
  assert.doesNotMatch(JSON.stringify(info), /never read/);
  const bare = fixture({ lists: false }).runtime;
  assert.equal(Object.hasOwn(unwrap(await new HcmClient(bare).serverInfo()), "dataFolders"), false);
  await runtime.close();
  await bare.close();
});
