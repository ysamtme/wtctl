import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HcmRuntime } from "../src/runtime.js";
import { HcmClient, unwrap } from "../src/sdk.js";
import type { OperationResult } from "../src/contracts.js";
import { WsHcmClient } from "../src/protocol/client.js";
import { WsHcmApiError } from "../src/protocol/error.js";
import { WebPageApi } from "../src/protocol/api.js";
import { HttpTransport } from "../src/protocol/transport.js";
import { rawXml } from "../src/protocol/xml.js";

const tokenOne = "synthetic_upload_token_01";
const tokenTwo = "synthetic_upload_token_02";
const html = (token: string): string =>
  `<script>gFaApp.webSessionToken = ${JSON.stringify(token)};</script>`;
const soap = (method: string, body = ""): string =>
  `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><${method}Response xmlns="http://www.datex-soft.com/soap/">${body}</${method}Response></soap:Body></soap:Envelope>`;

function fixture(mainHtml = html(tokenOne), maximumBytes = 4096) {
  const requests: string[] = [];
  const uploads: { filename: string; bytes: Uint8Array; type: string; token: string }[] = [];
  let currentHtml = mainHtml;
  let mainFailure = false;
  let mainBrokenBody = false;
  let uploadStatus = 200;
  let uploadBody: unknown = undefined;
  let logoutFailure = false;
  let uploadNetworkFailure = false;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    if (url.pathname === "/spxml_web/main.htm") {
      requests.push("main");
      if (mainFailure) return new Response("safe fixture failure", { status: 500 });
      if (mainBrokenBody)
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(html(tokenTwo)));
              controller.error(new Error("synthetic-private-body-error"));
            },
          }),
        );
      return new Response(currentHtml, {
        headers: { "set-cookie": "SessionID=synthetic-web-cookie; Path=/" },
      });
    }
    if (url.pathname === "/services/LdsService") {
      const method = /<soap:Body><([A-Za-z0-9]+)/.exec(String(init?.body))?.[1];
      assert.ok(method);
      requests.push(method);
      assert.equal(headers.get("cookie"), "SessionID=synthetic-web-cookie");
      return new Response(
        soap(method, method === "OpenSession" ? "<SessionID>42</SessionID>" : ""),
      );
    }
    if (url.pathname === "/spxml_web/service/upload_file.htm") {
      requests.push("upload");
      if (uploadNetworkFailure) throw new Error("synthetic-private-network-detail");
      assert.equal(init?.method, "POST");
      assert.equal(url.search, "?json_response=1");
      assert.equal(headers.get("cookie"), "SessionID=synthetic-web-cookie");
      assert.equal(headers.get("x-spxml-client"), "SP-XML Web client 1.0");
      assert.equal(headers.has("content-type"), false, "fetch must create the multipart boundary");
      assert.ok(init?.body instanceof FormData);
      assert.deepEqual([...init.body.keys()], ["f", "session_token"]);
      const file = init.body.get("f");
      assert.ok(file instanceof File);
      const token = init.body.get("session_token");
      assert.equal(typeof token, "string");
      uploads.push({
        filename: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
        type: file.type,
        token: token as string,
      });
      return new Response(JSON.stringify(uploadBody ?? { Url: "123/" + file.name }), {
        status: uploadStatus,
        headers: { "content-type": "application/json" },
      });
    }
    assert.ok(
      url.pathname === "/spxml_web/logout.htm" || url.pathname === "/spxml_web/logout2.htm",
    );
    requests.push(url.pathname.endsWith("logout2.htm") ? "logout2" : "logout");
    return new Response("", { status: logoutFailure ? 500 : 200 });
  };
  const client = new WsHcmClient({
    baseUrl: "http://synthetic.invalid/",
    auth: { username: "synthetic-account", password: "synthetic-only" },
    fetch,
    maxResponseBytes: maximumBytes,
  });
  return {
    client,
    fetch,
    requests,
    uploads,
    setHtml: (value: string) => {
      currentHtml = value;
    },
    failMain: () => {
      mainFailure = true;
    },
    breakMain: () => {
      mainBrokenBody = true;
    },
    failLogout: (value = true) => {
      logoutFailure = value;
    },
    failUploadNetwork: () => {
      uploadNetworkFailure = true;
    },
    setUpload: (value: unknown, status = 200) => {
      uploadBody = value;
      uploadStatus = status;
    },
  };
}

const runtimeOver = (f: ReturnType<typeof fixture>): HcmRuntime =>
  new HcmRuntime({
    name: "synthetic-upload",
    baseUrl: "http://synthetic.invalid/",
    username: "synthetic-account",
    password: "synthetic-only",
    timeoutMs: 1000,
    maxResponseBytes: 1024,
    outputLimitBytes: 4096,
    runtimeDir: ".unused",
    permissions: { write: true, execute: false },
    fetch: f.fetch,
  });

test("загрузка одного файла сохраняет точные байты, использует текущий закрытый токен и исходный контракт multipart", async () => {
  const f = fixture(html(tokenOne).replace("synthetic", "\\u0073ynthetic"));
  try {
    const session = await f.client.openWebSession();
    try {
      const bytes = new Uint8Array([0, 255, 254, 65]);
      const response = await session.pages.uploadFile({
        filename: "synthetic.bin",
        data: bytes,
        contentType: "application/octet-stream",
      });
      assert.deepEqual(response.data, { Url: "123/synthetic.bin" });
      assert.deepEqual(f.uploads, [
        { filename: "synthetic.bin", bytes, type: "application/octet-stream", token: tokenOne },
      ]);
      assert.deepEqual(f.requests, ["main", "OpenSession", "upload"]);
      assert.doesNotMatch(
        JSON.stringify(response.data) + JSON.stringify(session),
        /synthetic_upload_token/,
      );
      f.setHtml(html(tokenTwo));
      await session.lifecycle.main();
      await session.pages.uploadFile({
        filename: "synthetic.xml",
        data: rawXml("<r>Текст</r>"),
        contentType: "text/xml",
      });
      assert.equal(f.uploads[1]?.token, tokenTwo);
      assert.deepEqual(f.uploads[1]?.bytes, new TextEncoder().encode("<r>Текст</r>"));
      assert.equal(
        f.requests.filter((item) => item === "main").length,
        2,
        "upload must not rotate the token by re-fetching main",
      );
    } finally {
      await session.close();
    }
    assert.deepEqual(f.requests.slice(-3), ["CloseSession", "logout", "logout2"]);
  } finally {
    f.client.close();
  }
});

test("отсутствующий, неверный, неоднозначный и похожий на код токен страницы никогда не вызывает запасных запросов загрузки", async () => {
  for (const source of [
    "<html>Legacy main without token</html>",
    html(tokenOne) + html(tokenTwo),
    '<script>gFaApp.webSessionToken = "bad\\nline";</script>',
    '<script>gFaApp.webSessionToken = (() => "' + tokenOne + '")();</script>',
    "<!-- " + html(tokenOne) + " -->",
    '<script>/* gFaApp.webSessionToken = "' + tokenOne + '"; */</script>',
    '<script>// gFaApp.webSessionToken = "' + tokenOne + '";\n</script>',
    '<script>const example = `\ngFaApp.webSessionToken = "' + tokenOne + '";`;</script>',
    '<script type="application/json">gFaApp.webSessionToken = "' + tokenOne + '";</script>',
    '<script src="external.js">gFaApp.webSessionToken = "' + tokenOne + '";</script>',
    '<script>gFaApp.webSessionToken = "' +
      tokenOne +
      '"; gFaApp.webSessionToken = "' +
      tokenTwo +
      '";</script>',
  ]) {
    const f = fixture(source);
    try {
      const session = await f.client.openWebSession();
      try {
        await assert.rejects(
          session.pages.uploadFile({ filename: "synthetic.bin", data: "safe" }),
          (error: unknown) =>
            error instanceof WsHcmApiError &&
            error.kind === "protocol" &&
            !JSON.stringify(error).includes(tokenOne),
        );
        assert.equal(f.uploads.length, 0);
      } finally {
        await session.close();
      }
    } finally {
      f.client.close();
    }
  }
});

test("токен CodeLiteral в одинарных кавычках и экранирование декодируются без выполнения скрипта", async () => {
  const f = fixture("<script>gFaApp.webSessionToken = '\\x73ynthetic_upload_token_01';</script>");
  try {
    const session = await f.client.openWebSession();
    try {
      await session.pages.uploadFile({ filename: "synthetic.txt", data: "x" });
      assert.equal(f.uploads[0]?.token, tokenOne);
    } finally {
      await session.close();
    }
  } finally {
    f.client.close();
  }
});

test("неудачный статус и тело основного ответа делают прежний токен недействительным до любой загрузки", async () => {
  for (const mode of ["status", "body"] as const) {
    const f = fixture();
    try {
      const session = await f.client.openWebSession();
      try {
        if (mode === "status") f.failMain();
        else f.breakMain();
        await assert.rejects(session.lifecycle.main());
        const before = f.requests.length;
        await assert.rejects(
          session.pages.uploadFile({ filename: "synthetic.txt", data: "x" }),
          WsHcmApiError,
        );
        assert.equal(f.requests.length, before);
        assert.equal(f.uploads.length, 0);
      } finally {
        await session.close();
      }
    } finally {
      f.client.close();
    }
  }
});

test("прямой завершающий выход делает токен загрузки недействительным до успешных и неудачных запросов", async () => {
  for (const leg of ["logout", "logout2"] as const)
    for (const failed of [false, true]) {
      const f = fixture();
      try {
        const session = await f.client.openWebSession();
        try {
          if (failed) f.failLogout();
          if (failed) await assert.rejects(session.lifecycle[leg]());
          else await session.lifecycle[leg]();
          const before = f.requests.length;
          await assert.rejects(
            session.pages.uploadFile({ filename: "synthetic.txt", data: "x" }),
            WsHcmApiError,
          );
          assert.equal(f.requests.length, before);
          assert.equal(f.uploads.length, 0);
        } finally {
          f.failLogout(false);
          await session.close();
        }
      } finally {
        f.client.close();
      }
    }
});

test("лимиты имени файла, MIME и байтов отклоняют запрос до записи; лимиты UTF-8 считаются в байтах", async () => {
  const f = fixture(html(tokenOne), 256);
  try {
    const session = await f.client.openWebSession();
    try {
      const before = f.requests.length;
      const notSent = (error: unknown): boolean =>
        error instanceof WsHcmApiError &&
        error.operation === "uploadFile" &&
        error.requestSent === false;
      for (const filename of [
        "",
        ".",
        "..file",
        "file..",
        "../file",
        "dir/file",
        "dir\\file",
        "bad\0file",
        "x".repeat(256),
      ])
        await assert.rejects(session.pages.uploadFile({ filename, data: "x" }), notSent);
      await assert.rejects(
        session.pages.uploadFile({ filename: "synthetic.txt", data: "я".repeat(129) }),
        notSent,
      );
      await assert.rejects(
        session.pages.uploadFile({ filename: "synthetic.bin", data: new Uint8Array(257) }),
        notSent,
      );
      await assert.rejects(
        session.pages.uploadFile({
          filename: "synthetic.txt",
          data: "x",
          contentType: "text/plain\r\ninvalid: x",
        }),
        notSent,
      );
      assert.equal(f.requests.length, before);
      assert.equal(f.uploads.length, 0);
      await session.pages.uploadFile({ filename: "synthetic.txt", data: "я".repeat(128) });
      assert.equal(f.uploads[0]?.bytes.byteLength, 256);
    } finally {
      await session.close();
    }
  } finally {
    f.client.close();
  }
});

test("ограниченный сбой bootstrap закрывает контекст и не доходит ни до LDS, ни до загрузки", async () => {
  const f = fixture("x".repeat(257), 256);
  try {
    await assert.rejects(f.client.openWebSession(), WsHcmApiError);
    assert.deepEqual(f.requests, ["main", "logout", "logout2"]);
  } finally {
    f.client.close();
  }
});

test("ошибки ответа загрузки остаются безопасными, запись не повторяется, строгий критерий успеха сохраняется", async () => {
  for (const [body, status] of [
    [{ error: 1, error_text: tokenOne }, 200],
    [{ Url: "", secret: tokenOne }, 200],
    [{ Url: "https://external.invalid/synthetic.txt" }, 200],
    [{ Url: "../synthetic.txt" }, 200],
    [{ Url: "123/wrong.txt" }, 200],
    [{ Url: "123?x/synthetic.txt" }, 200],
    [[], 200],
    [{ error: tokenOne }, 415],
  ] as const) {
    const f = fixture();
    f.setUpload(body, status);
    try {
      const session = await f.client.openWebSession();
      try {
        await assert.rejects(
          session.pages.uploadFile({ filename: "synthetic.txt", data: "x" }),
          (error: unknown) =>
            error instanceof WsHcmApiError && !JSON.stringify(error).includes(tokenOne),
        );
        assert.equal(f.uploads.length, 1);
      } finally {
        await session.close();
      }
    } finally {
      f.client.close();
    }
  }
});

test("у закрытых сессий и автономных адаптеров нет запасного токена", async () => {
  const f = fixture();
  try {
    const session = await f.client.openWebSession();
    await session.close();
    const before = f.requests.length;
    await assert.rejects(
      session.pages.uploadFile({ filename: "synthetic.txt", data: "x" }),
      WsHcmApiError,
    );
    assert.equal(f.requests.length, before);
    const transport = new HttpTransport({
      baseUrl: "http://synthetic.invalid/",
      timeoutMs: 1000,
      fetch: async () => {
        throw new Error("Unexpected network request");
      },
    });
    try {
      await assert.rejects(
        new WebPageApi(transport).uploadFile({ filename: "synthetic.txt", data: "x" }),
        WsHcmApiError,
      );
    } finally {
      transport.dispose();
    }
  } finally {
    f.client.close();
  }
});

test("runtime сохраняет доказанный not_sent при проверке до отправки и неопределённые исходы после отправки без повтора", async () => {
  for (const mode of ["token", "filename", "bytes", "response", "network"] as const) {
    const f = fixture(mode === "token" ? "<html>No current token</html>" : html(tokenOne), 1024);
    if (mode === "response") f.setUpload({ Url: "../synthetic.txt", error_text: tokenOne });
    if (mode === "network") f.failUploadNetwork();
    const runtime = runtimeOver(f);
    try {
      const result = await runtime.call("web.pages.uploadFile", {
        filename: mode === "filename" ? "../bad.txt" : "synthetic.txt",
        data: mode === "bytes" ? "я".repeat(513) : "x",
      });
      assert.equal(result.ok, false, mode);
      assert.equal(result.error?.retryable, false, mode);
      const postSent = mode === "response" || mode === "network";
      assert.equal(result.error?.mutationOutcome, postSent ? "indeterminate" : "not_sent", mode);
      assert.equal(
        f.requests.filter((request) => request === "upload").length,
        postSent ? 1 : 0,
        mode,
      );
      assert.doesNotMatch(
        JSON.stringify(result),
        /synthetic_upload_token|synthetic-private-network-detail|synthetic-only/,
      );
    } finally {
      await runtime.close();
      f.client.close();
    }
  }
});

test("отказ политики загрузки — UPLOAD_REFUSED: текста сервер не присылает, файл по своему адресу пишет files.write", async () => {
  const f = fixture(html(tokenOne), 1024);
  f.setUpload("", 415);
  const runtime = runtimeOver(f);
  let logged = 0;
  (runtime as any).logs.serverWroteLog = () => logged++;
  try {
    const result = await runtime.call("web.pages.uploadFile", { filename: "app.js", data: "x" });
    assert.equal(result.error?.code, "UPLOAD_REFUSED");
    assert.match(result.error?.message ?? "", /HTTP 415.*лог xhttp/);
    assert.match(result.error?.hint ?? "", /политики загрузки.*files\.write/);
    assert.equal(result.error?.mutationOutcome, "indeterminate");
    assert.equal(f.uploads.length, 1);
    // Причину сервер записал в свой лог: следующее чтение лога дождётся файла.
    assert.equal(logged, 1);
  } finally {
    await runtime.close();
    f.client.close();
  }
});

test(
  "загрузка через SDK и настоящий CLI отправляет ограниченный multipart HTTP с точными двоичными байтами и обычным жизненным циклом",
  { timeout: 30000 },
  async () => {
    const wire: string[] = [];
    const bytes = new Uint8Array([0, 255, 128, 65]);
    const filename = "синтетический.bin";
    let failure: unknown;
    let uploaded: Uint8Array | undefined;
    const server = createServer(async (request, response) => {
      try {
        const url = new URL(request.url!, "http://synthetic.invalid/");
        if (url.pathname === "/spxml_web/main.htm") {
          wire.push("main");
          response.setHeader("set-cookie", "SessionID=synthetic-real-http; Path=/");
          response.end(html(tokenOne));
          return;
        }
        if (url.pathname === "/services/LdsService") {
          let source = "";
          for await (const part of request) source += String(part);
          const method = /<soap:Body><([A-Za-z0-9]+)/.exec(source)?.[1];
          assert.ok(method);
          wire.push(method);
          response.setHeader("content-type", "application/soap+xml");
          response.end(soap(method, method === "OpenSession" ? "<SessionID>42</SessionID>" : ""));
          return;
        }
        if (url.pathname === "/spxml_web/service/upload_file.htm") {
          wire.push("upload");
          assert.equal(request.method, "POST");
          assert.equal(url.search, "?json_response=1");
          assert.equal(request.headers.cookie, "SessionID=synthetic-real-http");
          assert.match(request.headers["content-type"]!, /^multipart\/form-data; boundary=/);
          const parts: Buffer[] = [];
          let total = 0;
          for await (const part of request) {
            const chunk = Buffer.from(part);
            total += chunk.byteLength;
            assert.ok(total < 4096);
            parts.push(chunk);
          }
          const multipart = await new Response(Buffer.concat(parts), {
            headers: { "content-type": request.headers["content-type"]! },
          }).formData();
          assert.deepEqual([...multipart.keys()], ["f", "session_token"]);
          assert.equal(multipart.get("session_token"), tokenOne);
          const file = multipart.get("f");
          assert.ok(file instanceof File);
          assert.equal(file.name, filename);
          assert.equal(file.type, "application/octet-stream");
          uploaded = new Uint8Array(await file.arrayBuffer());
          assert.deepEqual(uploaded, bytes);
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ Url: "123/" + filename }));
          return;
        }
        assert.ok(
          url.pathname === "/spxml_web/logout.htm" || url.pathname === "/spxml_web/logout2.htm",
        );
        wire.push(url.pathname.endsWith("logout2.htm") ? "logout2" : "logout");
        response.end("");
      } catch (error) {
        failure = error;
        response.statusCode = 500;
        response.end("Synthetic fixture assertion failed.");
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const runtime = new HcmRuntime({
      name: "synthetic-upload",
      baseUrl: "http://127.0.0.1:" + address.port,
      username: "synthetic-account",
      password: "synthetic-only",
      timeoutMs: 1000,
      maxResponseBytes: 4096,
      outputLimitBytes: 4096,
      runtimeDir: ".unused",
      permissions: { write: true, execute: false },
    });
    const directory = await mkdtemp(join(tmpdir(), "wtctl-upload-"));
    try {
      const descriptor = runtime.describe("web.pages.uploadFile");
      assert.equal(descriptor.effect, "write");
      const result = await new HcmClient(runtime).uploadFile({
        filename,
        data: { base64: Buffer.from(bytes).toString("base64") },
        contentType: "application/octet-stream",
      });
      assert.equal(failure, undefined);
      assert.equal(result.ok, true);
      assert.deepEqual(result.data, {
        url: "x-local://share/uploaded_files/123/" + filename,
        folderUrl: "x-local://share/uploaded_files/123",
      });
      assert.deepEqual(uploaded, bytes);
      assert.doesNotMatch(
        JSON.stringify(result),
        /synthetic_upload_token|synthetic-real-http|synthetic-only/,
      );
      await runtime.close();
      const configPath = join(directory, "config.json");
      const inputPath = join(directory, "payload.bin");
      const profile = {
        baseUrl: "http://127.0.0.1:" + address.port,
        usernameEnv: "WTCTL_USERNAME",
        passwordEnv: "WTCTL_PASSWORD",
        permissions: { write: true, execute: false },
        timeoutMs: 2000,
        maxResponseBytes: 4096,
        outputLimitBytes: 4096,
        runtimeDir: join(directory, "runtime"),
      };
      await writeFile(
        configPath,
        JSON.stringify({
          defaultConnection: "synthetic-upload",
          connections: {
            "synthetic-upload": profile,
            readonly: { ...profile, permissions: { write: false, execute: false } },
          },
        }),
      );
      await writeFile(inputPath, bytes);
      const env = {
        ...Object.fromEntries(
          Object.entries(process.env).filter(
            ([key, value]) => value !== undefined && !/^WTCTL_/i.test(key),
          ),
        ),
        WTCTL_USERNAME: "synthetic-account",
        WTCTL_PASSWORD: "synthetic-only",
      };
      async function cli(options: string[]) {
        const child = spawn(
          process.execPath,
          [
            "--import",
            "tsx",
            fileURLToPath(new URL("../src/cli/bin.ts", import.meta.url)),
            "--config",
            configPath,
            ...options,
          ],
          {
            cwd: fileURLToPath(new URL("..", import.meta.url)),
            env,
            stdio: ["pipe", "pipe", "pipe"],
            timeout: 10000,
          },
        );
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (part: Buffer) => {
          stdout += part.toString("utf8");
        });
        child.stderr.on("data", (part: Buffer) => {
          stderr += part.toString("utf8");
        });
        child.stdin.end();
        const code = await new Promise<number | null>((resolve, reject) => {
          child.on("error", reject);
          child.on("close", resolve);
        });
        assert.doesNotMatch(
          stdout + stderr,
          /synthetic_upload_token|synthetic-real-http|synthetic-only/,
        );
        return {
          code,
          stdout,
          stderr,
          result: stdout ? (JSON.parse(stdout) as OperationResult) : undefined,
        };
      }
      const actual = await cli([
        "file",
        "upload",
        filename,
        "--input-file",
        inputPath,
        "--content-type",
        "application/octet-stream",
      ]);
      assert.equal(actual.code, 0);
      assert.equal(actual.stderr, "");
      assert.equal(actual.result?.ok, true);
      assert.equal(actual.result?.meta.operationId, "web.pages.uploadFile");
      assert.deepEqual(actual.result?.data, {
        url: "x-local://share/uploaded_files/123/" + filename,
        folderUrl: "x-local://share/uploaded_files/123",
      });
      const before = wire.length;
      const denied = await cli([
        "--connection",
        "readonly",
        "file",
        "upload",
        filename,
        "--input-file",
        inputPath,
      ]);
      assert.equal(denied.code, 1);
      assert.equal(denied.result?.ok, false);
      assert.equal(denied.result?.error?.mutationOutcome, "not_sent");
      assert.equal(wire.length, before, "disabled write must not open a server session");
      const invalid = await cli(["file", "upload", "../unsafe.bin", "--input-file", inputPath]);
      assert.equal(invalid.code, 1);
      assert.equal(invalid.result?.ok, false);
      assert.equal(wire.length, before, "bad basename must fail before a server session");
    } finally {
      await runtime.close();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      assert.equal(resolve(dirname(directory)), resolve(tmpdir()));
      assert.match(basename(directory), /^wtctl-upload-/);
      await rm(directory, { recursive: true, force: true });
    }
    assert.equal(failure, undefined);
    assert.deepEqual(wire, [
      ...Array.from({ length: 2 }, () => [
        "main",
        "OpenSession",
        "upload",
        "CloseSession",
        "logout",
        "logout2",
      ]).flat(),
    ]);
  },
);
