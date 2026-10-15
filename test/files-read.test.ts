// files.read: файл приходит потоком байт; с file он сохраняется на диск без предела ответа.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { HcmClient, unwrap } from "../src/sdk.js";
import { HcmRuntime } from "../src/runtime.js";
import { runCli } from "../src/cli/run.js";
import { createHcmMcpServer } from "../src/mcp/server.js";
import { WsHcmApiError } from "../src/protocol/error.js";
import type { CliIo } from "../src/cli/types.js";
import type { FileReadInput, FileSaveData, FileSaveInput } from "../src/files.js";
import { fakeRuntime, type Answer } from "./fake-server.js";
import { mcpJson } from "./mcp-json.js";

const url = "x-local://share/a.bin";
const binary = Buffer.from([0, 1, 2, 255, 254, 10, 13]);

/** Папка теста; runtime хранит в ней свои результаты, остальное в ней — файлы чтения. */
async function temporary(action: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "wtctl-read-"));
  try {
    await action(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
const saved = async (directory: string) =>
  (await readdir(directory)).filter((name) => name !== "runtime");
function fixture(answer: Answer, directory: string) {
  return fakeRuntime(
    { "native.lds.loadUrl": answer },
    { runtimeDir: join(directory, "runtime"), permissions: { write: false, execute: false } },
  );
}

test("с file файл сохраняется байт в байт; существующий заменяется только с overwrite; неверный путь — отказ до запроса", async () => {
  await temporary(async (directory) => {
    const file = join(directory, "saved.bin");
    for (const content of [Buffer.from("строка\n"), binary]) {
      const { runtime, server } = fixture(content, directory);
      const result = await runtime.call("files.read", { url, file, overwrite: true });
      assert.deepEqual(result.data, { bytes: content.length, file });
      assert.equal(result.meta.resultId, undefined);
      assert.deepEqual(await readFile(file), content);
      assert.deepEqual(server.calls[0]!.args, { url, useBinaryResponse: true });
      await runtime.close();
    }
    const { runtime, server } = fixture(binary, directory);
    await writeFile(file, "прежнее");
    for (const [path, code] of [
      [file, "FILE_EXISTS"],
      [directory, "INVALID_ARGUMENT"],
      [join(directory, "нет", "a.bin"), "FOLDER_NOT_FOUND"],
      ["relative.bin", "INVALID_ARGUMENT"],
    ])
      assert.equal((await runtime.call("files.read", { url, file: path })).error?.code, code, path);
    assert.equal(await readFile(file, "utf8"), "прежнее");
    assert.equal(server.calls.length, 0);
    await runtime.close();
  });
});

test("прерванное чтение не оставляет файла ни под нужным именем, ни временного", async () => {
  await temporary(async (directory) => {
    const broken = async function* () {
      yield Buffer.alloc(1024, 1);
      throw new WsHcmApiError("http", "Не удалось прочитать тело HTTP-ответа");
    };
    const { runtime } = fixture(() => broken(), directory);
    const result = await runtime.call("files.read", { url, file: join(directory, "a.bin") });
    assert.equal(result.error?.code, "PLATFORM_HTTP");
    assert.deepEqual(await saved(directory), []);
    await runtime.close();
  });
});

test("без file ответ прежний: текст или base64 и сохранённый результат", async () => {
  await temporary(async (directory) => {
    const text = Buffer.from("текст");
    const { runtime } = fixture((args) => (args.url === url ? binary : text), directory);
    const read = await runtime.call("files.read", { url });
    assert.deepEqual(read.data, { base64: binary.toString("base64"), bytes: binary.length });
    assert.ok(read.meta.resultId);
    const other = "x-local://share/a.txt";
    assert.deepEqual((await runtime.call("files.read", { url: other })).data, {
      text: "текст",
      bytes: 10,
    });
    assert.deepEqual((await runtime.call("files.read", { url: other, encoding: "base64" })).data, {
      base64: text.toString("base64"),
      bytes: 10,
    });
    for (const args of [
      { url, encoding: "hex" },
      { url, overwrite: true },
      { url, file: join(directory, "x"), encoding: "base64" },
    ])
      assert.equal((await runtime.call("files.read", args)).error?.code, "INVALID_ARGUMENT");
    await runtime.close();
  });
});

test("по HTTP файл больше maxResponseBytes с file сохраняется целиком, без file — FILE_TOO_LARGE; таймаут посреди файла называет timeoutMs", async () => {
  await temporary(async (directory) => {
    let data = Buffer.alloc(3 * 1024 * 1024 + 5, "файл");
    let stall = false;
    const requests: string[] = [];
    const fetch: typeof globalThis.fetch = async (_input, init) => {
      const body = String(init?.body);
      const method = /<soap:Body><([A-Za-z]+)/.exec(body)?.[1] ?? "loggedoff";
      if (method === "LoadUrl") {
        requests.push(body);
        const signal = init!.signal!;
        const stream = new ReadableStream({
          start(controller) {
            for (let start = 0; start < data.length; start += 65536)
              controller.enqueue(data.subarray(start, start + 65536));
            // Как fetch: истёкшее время запроса обрывает и недочитанное тело.
            if (stall) signal.addEventListener("abort", () => controller.error(signal.reason));
            else controller.close();
          },
        });
        return new Response(stream, { headers: { "content-type": "application/binary" } });
      }
      const payload = method === "OpenSession" ? "<SessionID>42</SessionID>" : "";
      return new Response(
        `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope/"><soap:Body><${method}Response xmlns="http://www.datex-soft.com/">${payload}</${method}Response></soap:Body></soap:Envelope>`,
        { headers: { "content-type": "application/soap+xml", "set-cookie": "SessionID=owned" } },
      );
    };
    const connection = {
      name: "read",
      baseUrl: "http://read-fixture.invalid/",
      username: "fixture",
      password: "fixture-password",
      timeoutMs: 5000,
      maxResponseBytes: 1024 * 1024,
      outputLimitBytes: 4096,
      runtimeDir: join(directory, "runtime"),
      permissions: { write: false, execute: false },
      fetch,
    };
    const runtime = new HcmRuntime(connection);
    const file = join(directory, "big.bin");
    assert.deepEqual((await runtime.call("files.read", { url, file })).data, {
      bytes: data.length,
      file,
    });
    assert.ok((await readFile(file)).equals(data));
    assert.match(requests[0]!, /<UseBinaryResponse>true<\/UseBinaryResponse>/);
    const whole = await runtime.call("files.read", { url });
    assert.equal(whole.error?.code, "FILE_TOO_LARGE");
    assert.match(whole.error!.hint!, /files\.read с file/);
    await runtime.close();

    [data, stall] = [Buffer.alloc(1024), true];
    const slow = new HcmRuntime({ ...connection, timeoutMs: 100 });
    const result = await slow.call("files.read", { url, file: join(directory, "slow.bin") });
    assert.equal(result.error?.code, "PLATFORM_HTTP");
    assert.match(result.error!.hint!, /timeoutMs/);
    assert.deepEqual(await saved(directory), ["big.bin"]);
    await slow.close();
  });
});

test("файл сохраняется из CLI (--to, --overwrite), SDK и hcm_api_read", async () => {
  await temporary(async (directory) => {
    let out = "";
    const io = {
      writeOut: (text: string) => void (out += text),
      writeError: (text: string) => void (out += text),
    } as unknown as CliIo;
    const cli = async (...args: string[]) => {
      const { runtime } = fixture(binary, directory);
      out = "";
      const code = await runCli(["files", "read", url, ...args], io, {
        loadConfiguration: () => runtime.config,
        createRuntime: () => runtime,
        runMcp: async () => undefined,
      });
      return { code, result: JSON.parse(out) };
    };
    // Относительный путь команда превращает в полный от текущей папки.
    const cwd = process.cwd();
    process.chdir(directory);
    try {
      const first = await cli("--to", "cli.bin");
      assert.deepEqual(first.result.data, {
        bytes: binary.length,
        file: join(directory, "cli.bin"),
      });
      assert.equal((await cli("--to", "cli.bin")).result.error.code, "FILE_EXISTS");
      assert.equal((await cli("--to", "cli.bin", "--overwrite")).code, 0);
      assert.equal((await cli("--overwrite")).code, 2);
      assert.equal((await cli("--to", "x.bin", "--base64")).code, 2);
    } finally {
      process.chdir(cwd);
    }

    const { runtime } = fixture(binary, directory);
    const sdk = join(directory, "sdk.bin");
    const sdkClient = new HcmClient(runtime);
    // Путь в самом вызове: ответ — FileSaveData. Аргумент, собранный заранее как любой из двух видов
    // (и с необязательным file), даёт ответ любого из двух видов, а не ответ чтения.
    const saved: FileSaveData = unwrap(await sdkClient.readFile({ url, file: sdk }));
    const input = { url, file: sdk, overwrite: true } as FileReadInput | FileSaveInput;
    const data = unwrap(await sdkClient.readFile(input));
    const optional: { url: string; file?: string } = { url };
    const read = unwrap(await sdkClient.readFile(optional));
    type WithFile<T> = [Extract<T, FileSaveData>] extends [never] ? false : true;
    const both: [WithFile<typeof data>, WithFile<typeof read>] = [true, true];
    assert.deepEqual(saved, { bytes: binary.length, file: sdk });
    assert.deepEqual(data, saved);
    assert.deepEqual(read, { base64: binary.toString("base64"), bytes: binary.length });
    const server = createHcmMcpServer(runtime);
    const client = new Client({ name: "files-read", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const mcp = join(directory, "mcp.bin");
    const tool = {
      name: "hcm_api_read",
      arguments: { operationId: "files.read", args: { url, file: mcp } },
    };
    assert.deepEqual(mcpJson(await client.callTool(tool)).data, {
      bytes: binary.length,
      file: mcp,
    });
    for (const name of ["cli.bin", "sdk.bin", "mcp.bin"])
      assert.deepEqual(await readFile(join(directory, name)), binary, name);
    await client.close();
    await server.close();
    await runtime.close();
  });
});
