import assert from "node:assert/strict";
import { test } from "node:test";
import { WebPageApi } from "../src/protocol/api.js";
import { HttpTransport } from "../src/protocol/transport.js";
import { WsHcmApiError } from "../src/protocol/error.js";
import { NativeGateway, getNativeOperations } from "../src/native/index.js";

test("stock icon page uses its exact GET route and source encoding, preserving PNG bytes and media", async () => {
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 255]);
  const source = "x-app://fixture/цвет &'😀.ico";
  let requests = 0;
  const transport = new HttpTransport({
    baseUrl: "http://fixture.invalid/mount/",
    timeoutMs: 1000,
    maxResponseBytes: 1024,
    fetch: async (input, init) => {
      requests++;
      const url = new URL(String(input));
      assert.equal(url.pathname, "/mount/spxml_web/service/get_icon.htm");
      assert.equal(url.searchParams.size, 1);
      assert.equal(url.searchParams.get("url"), source);
      assert.equal(init?.method ?? "GET", "GET");
      assert.equal(init?.body, undefined);
      assert.equal(new Headers(init?.headers).get("cookie"), "SessionID=fixture-icon");
      return new Response(bytes, { headers: { "content-type": "image/png" } });
    },
  });
  transport.cookie.capture(new Headers({ "set-cookie": "SessionID=fixture-icon; Path=/" }));
  try {
    const response = await new WebPageApi(transport).getIcon({ url: source });
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.deepEqual(new Uint8Array(await new Response(response.body).arrayBuffer()), bytes);
    assert.equal(requests, 1);
  } finally {
    transport.dispose();
  }
});

test("icon source/schema preflight rejects unsupported variants before transport or managed authentication", async () => {
  let requests = 0;
  const fetch = async () => {
    requests++;
    throw Error("Unexpected icon/auth request");
  };
  const transport = new HttpTransport({
    baseUrl: "http://fixture.invalid/",
    timeoutMs: 1000,
    fetch,
  });
  const gateway = new NativeGateway({
    baseUrl: "http://fixture.invalid/",
    timeoutMs: 1000,
    maxResponseBytes: 1024,
    fetch,
  });
  try {
    for (const source of [
      "http://other.invalid/own.ico",
      "x-db-obj://db/type/1",
      "x-local://wtv/own.png",
      "x-app://fixture/own.ICO",
      "x-app://fixture/own.ico?resize=32",
      "x-app://fixture/own.ico#fragment",
      "x-app://fixture/own\n.ico",
      "",
    ]) {
      await assert.rejects(new WebPageApi(transport).getIcon({ url: source }), TypeError);
      await assert.rejects(gateway.call("web.pages.getIcon", { url: source }), TypeError);
    }
    await assert.rejects(
      gateway.call("web.pages.getIcon", { url: "x-app://fixture/own.ico", size: 32 }),
      TypeError,
    );
    const operation = getNativeOperations().find((item) => item.id === "web.pages.getIcon")!;
    assert.equal(operation.effect, "write");
    assert.equal(operation.status, "implemented");
    assert.match(operation.description, /cache miss/);
    assert.match(operation.description, /image_convert\.exe/);
    assert.equal(requests, 0);
  } finally {
    await gateway.close();
    transport.dispose();
  }
});

test("icon HTTP faults and oversized streams cancel their underlying body", async () => {
  for (const status of [500, 200]) {
    let cancelled = false;
    const transport = new HttpTransport({
      baseUrl: "http://fixture.invalid/",
      timeoutMs: 1000,
      maxResponseBytes: 4,
      fetch: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              controller.enqueue(new Uint8Array(5));
            },
            cancel() {
              cancelled = true;
            },
          }),
          { status },
        ),
    });
    try {
      const call = new WebPageApi(transport).getIcon({ url: "x-app://fixture/own.ico" });
      if (status === 500)
        await assert.rejects(
          call,
          (error) =>
            error instanceof WsHcmApiError &&
            error.status === 500 &&
            error.operation === "get_icon.htm",
        );
      else {
        const response = await call;
        await assert.rejects(
          new Response(response.body).arrayBuffer(),
          /exceeds.*limit|exceed.*byte|limit/i,
        );
      }
      assert.equal(cancelled, true);
    } finally {
      transport.dispose();
    }
  }
});
