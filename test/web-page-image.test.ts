import test from "node:test";
import assert from "node:assert/strict";
import { WebPageApi } from "../src/protocol/api.js";
import { HttpTransport } from "../src/protocol/transport.js";
import { WsHcmApiError } from "../src/protocol/error.js";
import { HcmRuntime } from "../src/runtime.js";
import { HcmClient } from "../src/sdk.js";
import { scratchRuntimeDir } from "./fake-server.js";

test("штатная SVG-страница использует свой отдельный маршрут GET с точным кодированием URL и state и сохраняет возвращённые байты", async () => {
  const url = "x-app://local/pict/цвет & '😀.svg?variant=a&b=two";
  const source = '<svg xmlns="http://www.w3.org/2000/svg"><text>Текст 😀 &amp;</text></svg>\r\n';
  const bytes = new TextEncoder().encode(source);
  const calls: { url: URL; method: string; body: BodyInit | null | undefined }[] = [];
  const transport = new HttpTransport({
    baseUrl: "http://synthetic.invalid/hcm/",
    timeoutMs: 1000,
    maxResponseBytes: 4096,
    fetch: async (input, init) => {
      calls.push({ url: new URL(String(input)), method: init?.method ?? "GET", body: init?.body });
      return new Response(bytes, { headers: { "content-type": "image/svg+xml" } });
    },
  });
  try {
    const api = new WebPageApi(transport);
    for (const state of [undefined, "", "hover & +'😀"]) {
      const response = await api.getImage({ url, ...(state === undefined ? {} : { state }) });
      assert.equal(response.headers.get("content-type"), "image/svg+xml");
      assert.deepEqual(new Uint8Array(await new Response(response.body).arrayBuffer()), bytes);
      const call = calls.at(-1)!;
      assert.equal(call.url.pathname, "/hcm/spxml_web/service/get_image.htm");
      assert.equal(call.url.searchParams.get("url"), url);
      // Штатный обработчик напрямую читает Request.QueryString.state: его отсутствие
      // вызывает ошибку до загрузки SVG, поэтому при удобном пропуске отправляется state="".
      assert.equal(call.url.searchParams.get("state"), state ?? "");
      assert.equal(call.method, "GET");
      assert.equal(call.body, undefined);
      assert.equal(call.url.searchParams.size, 2);
    }
  } finally {
    transport.dispose();
  }
});

test("сбой доступа к SVG-странице отменяет ответ и не отдаёт успешное двоичное тело", async () => {
  let cancelled = false;
  const transport = new HttpTransport({
    baseUrl: "http://synthetic.invalid/",
    timeoutMs: 1000,
    fetch: async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          cancel() {
            cancelled = true;
          },
        }),
        { status: 403 },
      ),
  });
  try {
    await assert.rejects(
      new WebPageApi(transport).getImage({ url: "x-local://pict/fixture.svg" }),
      (error: unknown) =>
        error instanceof WsHcmApiError && error.kind === "permission" && error.status === 403,
    );
    assert.equal(cancelled, true);
  } finally {
    transport.dispose();
  }
});

test("описание SVG доходит до существующего маршрута чтения SDK и runtime с точными байтами и собственной очисткой web", async () => {
  const wire: string[] = [];
  const imageUrl = "x-app://local/pict/fixture.svg";
  const bytes = new TextEncoder().encode("<svg><text>Синтетический 😀</text></svg>");
  const runtime = new HcmRuntime({
    name: "svg-fixture",
    baseUrl: "http://synthetic.invalid/hcm/",
    username: "synthetic-svg-user",
    password: "synthetic-svg-password",
    timeoutMs: 1000,
    maxResponseBytes: 4096,
    outputLimitBytes: 4096,
    runtimeDir: scratchRuntimeDir,
    permissions: { write: false, execute: false },
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const headers = new Headers(init?.headers);
      if (url.pathname === "/hcm/spxml_web/main.htm") {
        wire.push("main");
        return new Response("<html>fixture</html>", {
          headers: { "set-cookie": "SessionID=synthetic-svg-context; Path=/" },
        });
      }
      if (url.pathname === "/hcm/services/LdsService") {
        const method = /<soap:Body><([A-Za-z]+)/.exec(String(init?.body ?? ""))?.[1];
        assert.ok(method);
        wire.push(method);
        const result = method === "OpenSession" ? "<SessionID>42</SessionID>" : "";
        return new Response(
          `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope/"><soap:Body><${method}Response>${result}</${method}Response></soap:Body></soap:Envelope>`,
          { headers: { "content-type": "application/soap+xml" } },
        );
      }
      if (url.pathname === "/hcm/spxml_web/service/get_image.htm") {
        wire.push("svg");
        assert.equal(headers.get("cookie"), "SessionID=synthetic-svg-context");
        assert.equal(url.searchParams.get("url"), imageUrl);
        assert.equal(url.searchParams.get("state"), "disabled");
        return new Response(bytes, { headers: { "content-type": "image/svg+xml" } });
      }
      assert.ok(
        url.pathname === "/hcm/spxml_web/logout.htm" ||
          url.pathname === "/hcm/spxml_web/logout2.htm",
      );
      wire.push(url.pathname.endsWith("logout2.htm") ? "logout2" : "logout");
      return new Response("");
    },
  });
  try {
    const operation = runtime.describe("web.pages.getImage");
    assert.equal(operation.effect, "read");
    const client = new HcmClient(runtime);
    const result = await client.call("web.pages.getImage", { url: imageUrl, state: "disabled" });
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, {
      kind: "binary",
      bytes: { base64: Buffer.from(bytes).toString("base64"), bytes: bytes.length },
      contentType: "image/svg+xml",
    });
  } finally {
    await runtime.close();
  }
  assert.deepEqual(wire, ["main", "OpenSession", "svg", "CloseSession", "logout", "logout2"]);
});
