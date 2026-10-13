import test from "node:test";
import assert from "node:assert/strict";
import { HcmRuntime } from "../src/runtime.js";
import { HcmClient, unwrap } from "../src/sdk.js";
import { WsHcmClient } from "../src/protocol/client.js";
import { WebPageApi, type UploadChunkRequest } from "../src/protocol/api.js";
import { HttpTransport } from "../src/protocol/transport.js";
import { WsHcmApiError } from "../src/protocol/error.js";
import { rawXml } from "../src/protocol/xml.js";

const fileId = "0123456789abcdef0123456789abcdef";
const otherId = "ABCDEF0123456789ABCDEF0123456789";
const soap = (method: string): string =>
  `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><${method}Response xmlns="http://www.datex-soft.com/soap/">${method === "OpenSession" ? "<SessionID>42</SessionID>" : ""}</${method}Response></soap:Body></soap:Envelope>`;
const onePart = (): UploadChunkRequest => ({
  fileId,
  filename: "chunk.bin",
  index: 0,
  chunksTotal: 1,
  totalBytes: 1,
  offset: 0,
  data: "x",
});

interface WirePart {
  url: URL;
  headers: Headers;
  fields: Record<string, string>;
  serialized: string;
}
function fixture(maximumBytes = 4096) {
  const requests: string[] = [];
  const parts: WirePart[] = [];
  let respond: (part: WirePart) => Response | Promise<Response> = (part) =>
    part.fields.action === "clear_chunks"
      ? new Response("\r\n")
      : Response.json({ error: 0, Url: `receipt_${parts.length}/${part.fields.file_name}` });
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    assert.ok(
      url.pathname.startsWith("/hcm/"),
      "every request must retain the configured base path",
    );
    if (url.pathname.endsWith("/main.htm")) {
      requests.push("main");
      assert.match(headers.get("authorization") ?? "", /^Basic /);
      // Эта ветка исходников не использует процесс загрузки f/session_token.
      return new Response("<html>No page upload token</html>", {
        headers: { "set-cookie": "SessionID=synthetic-chunk-cookie; Path=/" },
      });
    }
    if (url.pathname.endsWith("/LdsService")) {
      const method = /<soap:Body><([A-Za-z0-9]+)/.exec(String(init?.body))?.[1];
      assert.ok(method);
      requests.push(method);
      assert.equal(headers.get("cookie"), "SessionID=synthetic-chunk-cookie");
      return new Response(soap(method));
    }
    if (url.pathname.endsWith("/upload_file.htm")) {
      assert.equal(init?.method, "POST");
      assert.ok(init.body instanceof FormData);
      assert.equal(headers.has("authorization"), false);
      assert.equal(headers.get("cookie"), "SessionID=synthetic-chunk-cookie");
      assert.equal(headers.get("x-spxml-client"), "SP-XML Web client 1.0");
      assert.equal(headers.has("content-type"), false, "fetch creates the multipart boundary");
      const fields = Object.fromEntries(
        [...init.body].map(([key, value]) => {
          assert.equal(typeof value, "string");
          return [key, value as string];
        }),
      );
      const part = {
        url,
        headers,
        fields,
        serialized: await new Request(url, { ...init, signal: null }).text(),
      };
      parts.push(part);
      requests.push(fields.action!);
      return respond(part);
    }
    assert.ok(url.pathname.endsWith("/logout.htm") || url.pathname.endsWith("/logout2.htm"));
    requests.push(url.pathname.endsWith("/logout2.htm") ? "logout2" : "logout");
    return new Response("");
  };
  const client = new WsHcmClient({
    baseUrl: "http://synthetic.invalid/hcm/",
    auth: { username: "synthetic-account", password: "synthetic-only" },
    fetch,
    maxResponseBytes: maximumBytes,
  });
  const runtime = (write = true): HcmRuntime =>
    new HcmRuntime({
      name: "synthetic-chunks",
      baseUrl: "http://synthetic.invalid/hcm/",
      username: "synthetic-account",
      password: "synthetic-only",
      timeoutMs: 1000,
      maxResponseBytes: maximumBytes,
      outputLimitBytes: 4096,
      runtimeDir: ".unused",
      permissions: { write, execute: false },
      fetch,
    });
  return {
    client,
    runtime,
    requests,
    parts,
    setResponse: (value: typeof respond) => {
      respond = value;
    },
  };
}
const notSent = (error: unknown): boolean =>
  error instanceof WsHcmApiError && error.requestSent === false;

test("штатная разбивка на части сохраняет точные смешанные байты, имена и семантику подтверждения каждой части", async () => {
  const f = fixture();
  try {
    await f.client.withWebSession(async (session) => {
      const filename = "часть + name.bin";
      const chunks = [new Uint8Array([0, 255, 128]), "я", new Uint8Array([65]).buffer];
      const exact = [
        new Uint8Array([0, 255, 128]),
        new TextEncoder().encode("я"),
        new Uint8Array([65]),
      ];
      let offset = 0;
      for (const [index, data] of chunks.entries()) {
        const response = await session.pages.uploadChunk({
          fileId,
          filename,
          index,
          chunksTotal: 3,
          totalBytes: 6,
          offset,
          data,
          contentType: "application/custom;base64,ignored",
        });
        assert.deepEqual(response.data, { error: 0, Url: `receipt_${index + 1}/${filename}` });
        assert.equal("completed" in response.data, false);
        const part = f.parts[index]!;
        assert.deepEqual(
          [...part.url.searchParams],
          [
            ["json_response", "1"],
            ["action", "upload_chunk"],
            ["file_id", fileId],
            ["file_name", filename],
          ],
        );
        assert.ok(part.url.search.includes("%20"));
        assert.ok(part.url.search.includes("%2B"));
        assert.equal(
          part.headers.get("content-range"),
          `bytes ${offset}-${offset + exact[index]!.length - 1}/6`,
        );
        assert.deepEqual(Object.keys(part.fields), [
          "action",
          "file_id",
          "file_name",
          "chunk",
          "chunks_total",
          "file_size",
          "file_type",
          "file_data",
        ]);
        assert.equal(part.fields.chunk, String(index));
        assert.equal(part.fields.chunks_total, "3");
        assert.equal(part.fields.file_size, "6");
        assert.equal(part.fields.file_name, filename);
        assert.equal(part.fields.file_type, "application/custom;base64,ignored");
        assert.equal(
          part.fields.file_data,
          `data:application/octet-stream;base64,${Buffer.from(exact[index]!).toString("base64")}`,
        );
        assert.deepEqual(
          Buffer.from(part.fields.file_data!.split(";base64,")[1]!, "base64"),
          Buffer.from(exact[index]!),
        );
        assert.ok(part.serialized.includes(`name="file_data"\r\n\r\n${part.fields.file_data}\r\n`));
        assert.equal("f" in part.fields || "session_token" in part.fields, false);
        offset += exact[index]!.length;
      }
    });
    assert.deepEqual(f.requests, [
      "main",
      "OpenSession",
      "upload_chunk",
      "upload_chunk",
      "upload_chunk",
      "CloseSession",
      "logout",
      "logout2",
    ]);
  } finally {
    f.client.close();
  }
});

test("проверка загрузки до отправки отклоняет невозможные диапазоны байтов и неверно записанный ввод без единого POST", async () => {
  let posts = 0;
  const transport = new HttpTransport({
    baseUrl: "http://synthetic.invalid/",
    timeoutMs: 1000,
    fetch: async () => {
      posts++;
      return Response.json({ error: 0, Url: "receipt/chunk.bin" });
    },
  });
  const pages = new WebPageApi(transport, undefined, 8);
  const invalid: Partial<UploadChunkRequest>[] = [
    { fileId: "../" + fileId },
    { fileId: "g".repeat(32) },
    { fileId: fileId.slice(1) },
    { filename: "../bad.bin" },
    { filename: "bad\\path.bin" },
    { filename: "." },
    { filename: "x".repeat(256) },
    { filename: "bad\u0000.bin" },
    { contentType: "text/plain\r\nX: injected" },
    { contentType: "x".repeat(257) },
    { index: -1 },
    { index: 1 },
    { index: 0.5 },
    { index: Number.NaN },
    { chunksTotal: 0 },
    { chunksTotal: 100001 },
    { chunksTotal: 1.5 },
    { totalBytes: 0 },
    { totalBytes: Number.MAX_SAFE_INTEGER + 1 },
    { offset: -1 },
    { offset: Number.MAX_SAFE_INTEGER + 1 },
    { offset: 1, totalBytes: 2 },
    { chunksTotal: 2, totalBytes: 1 },
    { index: 1, chunksTotal: 2, totalBytes: 2, offset: 0 },
    { data: "xx" },
    { data: "", totalBytes: 1 },
    { data: new Uint8Array(9), totalBytes: 9 },
    { data: "я".repeat(5), totalBytes: 10 },
    { index: 1, chunksTotal: 2, offset: 1, totalBytes: 3 },
    { index: 0, chunksTotal: 2, totalBytes: 2, data: "xx" },
    {
      index: 1,
      chunksTotal: 2,
      offset: Number.MAX_SAFE_INTEGER,
      totalBytes: Number.MAX_SAFE_INTEGER,
    },
  ];
  try {
    for (const update of invalid)
      await assert.rejects(
        pages.uploadChunk({ ...onePart(), ...update }),
        notSent,
        JSON.stringify(update),
      );
    assert.equal(posts, 0);
    // Предел относится к декодированным байтам, включая UTF-8, до раздувания base64.
    await pages.uploadChunk({ ...onePart(), totalBytes: 8, data: "я".repeat(4) });
    await pages.uploadChunk({ ...onePart(), totalBytes: 4, data: rawXml("<x/>") });
    assert.equal(posts, 2);
  } finally {
    transport.dispose();
  }
});

test("clear отправляет известный допустимый ID без локального журнала и сообщает только пустое ACK", async () => {
  const f = fixture();
  try {
    await f.client.withWebSession(async (session) => {
      for (const body of ["", "\r\n", " \t\r\n"]) {
        f.setResponse(() => new Response(body));
        const response = await session.pages.clearUploadChunks({ fileId: otherId, chunksTotal: 3 });
        assert.deepEqual(response.data, {
          acknowledged: true,
          fileId: otherId,
          chunksTotal: 3,
          absenceVerified: false,
        });
        assert.equal(new TextDecoder().decode(response.rawBody), body);
        const part = f.parts.at(-1)!;
        assert.deepEqual(
          [...part.url.searchParams],
          [
            ["json_response", "1"],
            ["action", "clear_chunks"],
            ["file_id", otherId],
          ],
        );
        assert.deepEqual(part.fields, {
          action: "clear_chunks",
          file_id: otherId,
          chunks_total: "3",
        });
        assert.equal(part.headers.has("content-range"), false);
      }
      const before = f.parts.length;
      for (const request of [
        { fileId: "../bad", chunksTotal: 1 },
        { fileId, chunksTotal: 0 },
        { fileId, chunksTotal: 100001 },
        { fileId, chunksTotal: 1.1 },
      ])
        await assert.rejects(session.pages.clearUploadChunks(request), notSent);
      assert.equal(f.parts.length, before);
    });
  } finally {
    f.client.close();
  }
});

test("SDK в профиле native отклоняет каждый неверный ввод по отдельности до bootstrap и разрешает обычную запись", async () => {
  const f = fixture();
  const runtime = f.runtime();
  const client = new HcmClient(runtime);
  try {
    assert.equal(client.describe("web.pages.uploadChunk").effect, "write");
    assert.equal(client.describe("web.pages.clearUploadChunks").effect, "write");
    for (const update of [
      { fileId: "bad" },
      { filename: "../bad.bin" },
      { chunksTotal: 100001 },
      { index: 0.5 },
      { totalBytes: Number.MAX_SAFE_INTEGER + 1 },
      { offset: -1 },
      { contentType: "x\n" },
      { data: { base64: "%%%" } },
    ]) {
      const result = await client.call("web.pages.uploadChunk", { ...onePart(), ...update });
      assert.equal(result.ok, false);
      assert.equal(result.error?.mutationOutcome, "not_sent");
      assert.equal(f.requests.length, 0);
    }
    const deniedRuntime = f.runtime(false);
    try {
      const denied = new HcmClient(deniedRuntime);
      for (const result of [
        await denied.uploadChunk({ ...onePart(), data: "x" }),
        await denied.clearUploadChunks({ fileId, chunksTotal: 1 }),
      ]) {
        assert.equal(result.ok, false);
        assert.equal(result.error?.mutationOutcome, "not_sent");
      }
      assert.equal(f.requests.length, 0);
    } finally {
      await deniedRuntime.close();
    }
    const bytes = new Uint8Array([0, 255, 65]);
    assert.deepEqual(
      unwrap(
        await client.uploadChunk({
          ...onePart(),
          totalBytes: bytes.length,
          data: { base64: Buffer.from(bytes).toString("base64") },
        }),
      ),
      { error: 0, Url: "receipt_1/chunk.bin" },
    );
    assert.equal(f.parts[0]?.fields.file_data, "data:application/octet-stream;base64,AP9B");
    assert.deepEqual(
      unwrap(await client.clearUploadChunks({ fileId: otherId, chunksTotal: 100000 })),
      { acknowledged: true, fileId: otherId, chunksTotal: 100000, absenceVerified: false },
    );
  } finally {
    await client.close();
    f.client.close();
  }
  assert.deepEqual(f.requests, [
    "main",
    "OpenSession",
    "upload_chunk",
    "clear_chunks",
    "CloseSession",
    "logout",
    "logout2",
  ]);
});

test("проверки связей между полями дают not_sent, даже когда runtime уже создал веб-контекст", async () => {
  const f = fixture(1024);
  const runtime = f.runtime();
  try {
    for (const update of [
      { index: 1 },
      { offset: 1 },
      { totalBytes: 2 },
      { totalBytes: 1025, data: "x".repeat(1025) },
      { data: { base64: "" } },
    ]) {
      const result = await runtime.call("web.pages.uploadChunk", { ...onePart(), ...update });
      assert.equal(result.ok, false);
      assert.equal(result.error?.mutationOutcome, "not_sent");
      assert.equal(f.parts.length, 0);
      assert.deepEqual(f.requests, ["main", "OpenSession"]);
    }
  } finally {
    await runtime.close();
    f.client.close();
  }
});

test("ошибка после отправки, неверное подтверждение приёма, потерянное тело и сбои HTTP остаются indeterminate без повтора", async () => {
  const failures: [string, () => Response | Promise<Response>][] = [
    [
      "server error",
      () => Response.json({ error: 1, error_text: "synthetic-private-detail" }, { status: 500 }),
    ],
    ["business error", () => Response.json({ error: 1, Url: "receipt/chunk.bin" })],
    ["missing error", () => Response.json({ Url: "receipt/chunk.bin" })],
    ["false error", () => Response.json({ error: false, Url: "receipt/chunk.bin" })],
    ["string error", () => Response.json({ error: "0", Url: "receipt/chunk.bin" })],
    ["wrong filename", () => Response.json({ error: 0, Url: "receipt/wrong.bin" })],
    ["external URL", () => Response.json({ error: 0, Url: "https://external.invalid/chunk.bin" })],
    ["parent path", () => Response.json({ error: 0, Url: "../chunk.bin" })],
    ["array", () => Response.json([])],
    ["HTML", () => new Response("<html>error</html>")],
    [
      "response loss",
      () => {
        throw new Error("synthetic-private-detail");
      },
    ],
    [
      "body loss",
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('{"error":0,'));
              controller.error(new Error("synthetic-private-detail"));
            },
          }),
        ),
    ],
  ];
  for (const [label, response] of failures) {
    const f = fixture();
    f.setResponse(response);
    const client = new HcmClient(f.runtime());
    try {
      const result = await client.uploadChunk({ ...onePart(), data: "x" });
      assert.equal(result.ok, false, label);
      assert.equal(result.error?.mutationOutcome, "indeterminate", label);
      assert.equal(result.error?.retryable, false, label);
      assert.equal(f.parts.length, 1, label);
      assert.doesNotMatch(
        JSON.stringify(result),
        /synthetic-private-detail|synthetic-only|synthetic-chunk-cookie/,
      );
    } finally {
      await client.close();
      f.client.close();
    }
    assert.equal(f.parts.length, 1, `${label}: cleanup cannot repeat an upload`);
  }
});

test("clear отклоняет сбои по содержимому, HTTP и потерянному ответу, а не выдумывает отсутствие", async () => {
  for (const response of [
    () => new Response("{}"),
    () => new Response("<html>error</html>"),
    () => new Response("\u00a0"),
    () => new Response(new Uint8Array([0xef, 0xbb, 0xbf])),
    () => new Response("", { status: 500 }),
    () => {
      throw new Error("synthetic-private-clear-detail");
    },
  ]) {
    const f = fixture();
    f.setResponse(response);
    const client = new HcmClient(f.runtime());
    try {
      const result = await client.clearUploadChunks({ fileId, chunksTotal: 1 });
      assert.equal(result.ok, false);
      assert.equal(result.error?.mutationOutcome, "indeterminate");
      assert.equal(result.error?.retryable, false);
      assert.equal(f.parts.length, 1);
      assert.equal(result.data, undefined);
    } finally {
      await client.close();
      f.client.close();
    }
  }
});

test("слишком большие ответы на часть отменяют тело и сохраняют одну неопределённую запись", async () => {
  const f = fixture(1024);
  let cancelled = false;
  f.setResponse(
    () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(1025));
          },
          cancel() {
            cancelled = true;
          },
        }),
      ),
  );
  const client = new HcmClient(f.runtime());
  try {
    const result = await client.uploadChunk({ ...onePart(), data: "x" });
    assert.equal(result.ok, false);
    assert.equal(result.error?.mutationOutcome, "indeterminate");
    assert.equal(result.error?.retryable, false);
    assert.equal(cancelled, true);
    assert.equal(f.parts.length, 1);
  } finally {
    await client.close();
    f.client.close();
  }
});

test("параметры части передают отмену вызывающего через штатный POST без повтора", async () => {
  let posts = 0;
  const controller = new AbortController();
  const transport = new HttpTransport({
    baseUrl: "http://synthetic.invalid/",
    timeoutMs: 1000,
    fetch: async (_input, init) => {
      posts++;
      assert.equal(init?.signal?.aborted, true);
      throw new DOMException("synthetic-private-abort-detail", "AbortError");
    },
  });
  try {
    controller.abort();
    await assert.rejects(
      new WebPageApi(transport).uploadChunk(onePart(), { signal: controller.signal }),
      (error: unknown) =>
        error instanceof WsHcmApiError &&
        error.requestSent !== false &&
        /прерван/.test(error.message),
    );
    assert.equal(posts, 1);
  } finally {
    transport.dispose();
  }
});
