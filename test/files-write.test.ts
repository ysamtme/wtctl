// files.write and files.delete: the client picks the path from the server's folder lists before sending.
import assert from "node:assert/strict";
import test from "node:test";
import { HcmRuntime } from "../src/runtime.js";
import { HcmClient, unwrap } from "../src/sdk.js";
import { runCli } from "../src/cli/run.js";
import { WsHcmApiError } from "../src/protocol/error.js";
import { parseXml } from "../src/protocol/xml.js";
import type { CliIo } from "../src/cli/types.js";

const entries = [
  { name: "DATA-DB", value: "share" },
  { name: "DATA-DB", value: "source" },
  { name: "DESIGN-DB", value: "wt" },
  { name: "DESIGN-DB", value: "source" },
  { name: "OTHER", value: "never read" },
];
const scriptAnswer = (value: string) =>
  parseXml(
    `<ResultData><Result VALUE-TYPE="Object"><error VALUE-TYPE="integer">0</error><ticks VALUE-TYPE="integer">1</ticks><total VALUE-TYPE="integer">1</total><result VALUE-TYPE="Array"><e VALUE-TYPE="string">${value}</e></result><columns VALUE-TYPE="Array"/><data VALUE-TYPE="Object"/></Result></ResultData>`,
  );
const infoFields =
  '<sys_db_capability VALUE-TYPE="integer">1</sys_db_capability><catalog_limits VALUE-TYPE="string">&lt;catalogs/&gt;</catalog_limits><version_server VALUE-TYPE="string">2030.1.1</version_server><os_type VALUE-TYPE="string">windows</os_type>';

function fixture(options: { execute?: boolean; lists?: boolean; refuse?: boolean } = {}) {
  const runtime = new HcmRuntime({
    name: "t",
    baseUrl: "http://fixture.invalid/",
    timeoutMs: 1000,
    maxResponseBytes: 1024 * 1024,
    outputLimitBytes: 65536,
    runtimeDir: ".unused",
    permissions: { write: true, execute: options.execute ?? true },
  });
  runtime.gateway.close = async () => undefined;
  const state = { sent: [] as { id: string; args: Record<string, any> }[], answer: "0" };
  runtime.gateway.call = async (id, args = {}) => {
    if (id === "native.spxml2.getAppInfo")
      return options.lists === false ? {} : { config_entries: entries };
    if (id === "native.rpc.call" && args.target === "tools.file_url_exists_server") {
      // The existence check finds only the addresses that name "stays".
      const found = String(+JSON.stringify(args).includes("stays"));
      const xml = `<ResultData><Result VALUE-TYPE="bool">${found}</Result></ResultData>`;
      return { valueType: "bool", lexicalValue: found, xml: parseXml(xml) };
    }
    if (id === "native.rpc.call")
      return {
        valueType: "Object",
        xml: parseXml(
          `<ResultData><Result VALUE-TYPE="Object">${infoFields}</Result></ResultData>`,
        ),
      };
    state.sent.push({ id, args });
    if (options.refuse) throw new WsHcmApiError("soap-fault", "refused", { status: 500 });
    return id === "web.rpc.call" ? scriptAnswer(state.answer) : {};
  };
  return { runtime, state };
}
const ids = (state: { sent: { id: string }[] }) => state.sent.map((call) => call.id);

test("a data folder is written through LDS, a code folder by code on the server that returns the size", async () => {
  const { runtime, state } = fixture();
  const text = "Привет\r\nмир";
  const data = unwrap(
    await HcmClient.fromRuntime(runtime).writeFile({ url: "x-local://share/a/b.txt", text }),
  );
  assert.deepEqual(data, { bytes: Buffer.byteLength(text), mutationOutcome: "confirmed" });
  assert.deepEqual(ids(state), ["native.lds.putUrl"]);
  assert.equal(state.sent[0]!.args.data.base64, Buffer.from(text).toString("base64"));
  // A folder that is in both lists takes files through LDS too.
  await runtime.call("files.write", { url: "x-local://source/a.txt", text: "x" });
  assert.equal(ids(state)[1], "native.lds.putUrl");

  state.answer = "10";
  const binary = await runtime.call("files.write", {
    url: "x-local://wt/web/a.bin",
    base64: Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]).toString("base64"),
  });
  assert.deepEqual(binary.data, { bytes: 10, mutationOutcome: "confirmed" });
  assert.match(JSON.stringify(state.sent[2]!.args), /Base64Decode\(PARAMS\.base64\)/);
  state.answer = String(Buffer.byteLength(text));
  assert.equal((await runtime.call("files.write", { url: "x-local://wt/a.txt", text })).ok, true);
  assert.match(JSON.stringify(state.sent[3]!.args), /PutUrlData\(PARAMS\.url, PARAMS\.text\)/);
  await runtime.close();
});

test("a folder that takes no files, or a code folder without execute, is refused before anything is sent", async () => {
  const { runtime, state } = fixture({ execute: false });
  const none = await runtime.call("files.write", { url: "x-local://Logs/a.txt", text: "x" });
  assert.equal(none.error?.code, "FOLDER_NOT_WRITABLE");
  assert.equal(none.error?.mutationOutcome, "not_sent");
  assert.match(none.error!.hint!, /Папки данных: share, source\. Папки кода .*: wt\./);
  for (const [id, args] of [
    ["files.write", { url: "x-local://wt/a.txt", text: "x" }],
    ["files.delete", { url: "x-local://wt/a.txt" }],
  ] as const) {
    const refused = await runtime.call(id, args);
    assert.equal(refused.error?.code, "EXECUTE_DISABLED");
    assert.match(
      refused.error!.message,
      /^Папка wt на этом сервере принимает .* только кодом на сервере/,
    );
    assert.equal(refused.error?.mutationOutcome, "not_sent");
  }
  assert.deepEqual(ids(state), []);
  // The data folder needs no execute.
  assert.equal(
    (await runtime.call("files.write", { url: "x-local://share/a.txt", text: "x" })).ok,
    true,
  );
  assert.equal((await runtime.call("files.delete", { url: "x-local://share/a.txt" })).ok, true);
  assert.deepEqual(ids(state), ["native.lds.putUrl", "native.lds.deleteUrl"]);
  await runtime.close();
});

test("addresses that could get around the folder, wrong content and files too large for the script are refused unsent", async () => {
  const { runtime, state } = fixture();
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
  const url = "x-local://share/a.txt";
  for (const args of [{ url }, { url, text: "x", base64: "eA==" }, { url, base64: "eA" }])
    assert.equal((await runtime.call("files.write", args)).error?.code, "INVALID_ARGUMENT");
  const large = await runtime.call("files.write", {
    url: "x-local://wt/a.txt",
    text: "a".repeat(800_000),
  });
  assert.equal(large.error?.code, "FILE_TOO_LARGE");
  assert.match(large.error!.hint!, /750 КБ.*580 КБ/);
  assert.deepEqual(ids(state), []);
  // A lone % is a plain character of a file name.
  assert.equal(
    (await runtime.call("files.write", { url: "x-local://share/50%.txt", text: "x" })).ok,
    true,
  );
  await runtime.close();
});

test("a file is deleted by code in a code folder; the address of a folder is refused and removes nothing", async () => {
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

test("a deletion after which the address is still there is indeterminate, on both routes", async () => {
  const { runtime, state } = fixture();
  const data = await runtime.call("files.delete", { url: "x-local://share/stays.txt" });
  assert.equal(data.error?.code, "READ_BACK_MISMATCH");
  assert.equal(data.error?.mutationOutcome, "indeterminate");
  assert.deepEqual(ids(state), ["native.lds.deleteUrl"]);
  // An address too long for the existence check is not checked.
  const long = `x-local://share/stays${"a".repeat(250)}`;
  assert.equal((await runtime.call("files.delete", { url: long })).ok, true);
  // In a code folder the code itself looks at the address: the client asks nothing more.
  state.answer = "deleted";
  assert.equal((await runtime.call("files.delete", { url: "x-local://wt/stays.txt" })).ok, true);
  state.answer = "remains";
  const code = await runtime.call("files.delete", { url: "x-local://wt/a.txt" });
  assert.equal(code.error?.code, "READ_BACK_MISMATCH");
  assert.equal(code.error?.mutationOutcome, "indeterminate");
  await runtime.close();
});

test("without the server's lists LDS is used, and an HTTP 500 hint names the code folder only then", async () => {
  const hint = async (options: { lists?: boolean }, url: string) => {
    const { runtime, state } = fixture({ ...options, refuse: true });
    const result = await runtime.call("files.write", { url, text: "x" });
    assert.deepEqual(ids(state), ["native.lds.putUrl"]);
    assert.equal(result.error?.mutationOutcome, "indeterminate");
    await runtime.close();
    return result.error!.hint!;
  };
  assert.match(
    await hint({ lists: false }, "x-local://wt/a.txt"),
    /сервер не сообщил, какие папки принимают запись/,
  );
  assert.doesNotMatch(await hint({}, "x-local://share/a.txt"), /сервер не сообщил/);
});

test("server.info lists the folders of the native profile, a folder of both lists among the data ones", async () => {
  const { runtime } = fixture();
  const info = unwrap(await HcmClient.fromRuntime(runtime).serverInfo());
  assert.deepEqual([info.dataFolders, info.codeFolders], [["share", "source"], ["wt"]]);
  assert.doesNotMatch(JSON.stringify(info), /never read/);
  const bare = fixture({ lists: false }).runtime;
  assert.equal(
    Object.hasOwn(unwrap(await HcmClient.fromRuntime(bare).serverInfo()), "dataFolders"),
    false,
  );
  await runtime.close();
  await bare.close();
});

test("the command writes the bytes of a file and deletes an address", async () => {
  const { runtime, state } = fixture();
  let out = "";
  const io = {
    writeOut: (text: string) => void (out += text),
    writeError: (text: string) => void (out += text),
    readFile: async () => "",
    readStdin: async () => "",
    writeFile: async () => undefined,
    readBinaryFile: async () => Uint8Array.from([0, 1, 255]),
  } as unknown as CliIo;
  const dependencies = {
    loadConfiguration: () => runtime.config,
    createRuntime: () => runtime,
    runMcp: async () => undefined,
  };
  const code = await runCli(
    ["files", "write", "x-local://share/a.bin", "--input-file", "a.bin"],
    io,
    dependencies,
  );
  assert.equal(code, 0, out);
  assert.equal(JSON.parse(out).data.bytes, 3);
  assert.equal(state.sent[0]!.args.data.base64, "AAH/");
  // The command closes its runtime: the next one is a new one.
  const next = fixture();
  out = "";
  const code2 = await runCli(["files", "delete", "x-local://share/a.bin"], io, {
    ...dependencies,
    createRuntime: () => next.runtime,
  });
  assert.equal(code2, 0, out);
  assert.equal(JSON.parse(out).data.deleted, true);
  assert.deepEqual(ids(next.state), ["native.lds.deleteUrl"]);
});
