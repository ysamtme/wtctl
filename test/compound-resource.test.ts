import test from "node:test";
import assert from "node:assert/strict";
import { ResourceApi, type CompoundResourceRequest } from "../src/protocol/api.js";
import { HttpTransport } from "../src/protocol/transport.js";
import { WsHcmApiError } from "../src/protocol/error.js";
import { NativeGateway, getNativeOperations } from "../src/native/index.js";

test("compound resources use distinct URL/document GET branches and preserve exact bytes, media and HTTP context", async () => {
  const calls: { url: URL; headers: Headers; method: string; body: BodyInit | null | undefined }[] =
    [];
  const bytes = new Uint8Array([0, 1, 13, 10, 0xff, 0xf0, 0x9f, 0x98, 0x80]);
  const transport = new HttpTransport({
    baseUrl: "http://synthetic.invalid/mounted/",
    timeoutMs: 1000,
    maxResponseBytes: 4096,
    fetch: async (input, init) => {
      calls.push({
        url: new URL(String(input)),
        headers: new Headers(init?.headers),
        method: init?.method ?? "GET",
        body: init?.body,
      });
      return new Response(bytes, { headers: { "content-type": "application/binary" } });
    },
  });
  transport.cookie.capture(
    new Headers({ "set-cookie": "SessionID=synthetic-resource-context; Path=/" }),
  );
  try {
    const api = new ResourceApi(transport);
    const requests: CompoundResourceRequest[] = [
      { url: "x-local://fixture/цвет &'😀.html", resId: "images/цвет &'😀.png" },
      {
        docUrl: "x-app://fixture/own.xml",
        elemPath: "fixture.fields.field[0].value",
        resId: "proof.txt",
      },
      {
        docUrl: "x-db-obj://fixture/types/9223372036854775806",
        elemPath: "fixture.description",
        resId: "proof.bin",
      },
    ];
    for (const request of requests) {
      const result = await api.getCompoundResource(request);
      assert.equal(result.headers.get("content-type"), "application/binary");
      assert.deepEqual(new Uint8Array(await new Response(result.body).arrayBuffer()), bytes);
      const call = calls.at(-1)!;
      assert.equal(call.url.pathname, "/mounted/xhttp_res");
      assert.equal(call.method, "GET");
      assert.equal(call.body, undefined);
      assert.equal(call.headers.get("cookie"), "SessionID=synthetic-resource-context");
      assert.equal(call.url.searchParams.get("res_id"), request.resId);
      if ("url" in request) {
        assert.equal(call.url.searchParams.get("url"), request.url);
        assert.equal(call.url.searchParams.has("doc_url"), false);
        assert.equal(call.url.searchParams.has("elem_path"), false);
        assert.equal(call.url.searchParams.size, 2);
      } else {
        assert.equal(call.url.searchParams.get("doc_url"), request.docUrl);
        assert.equal(call.url.searchParams.get("elem_path"), request.elemPath);
        assert.equal(call.url.searchParams.has("url"), false);
        assert.equal(call.url.searchParams.size, 3);
      }
    }
  } finally {
    transport.dispose();
  }
});

test("ambiguous or unsafe compound sources fail before transport and descriptor schema rejects both branches", async () => {
  let calls = 0;
  const fetch = async () => {
    calls++;
    throw new Error("Unexpected request");
  };
  const transport = new HttpTransport({
    baseUrl: "http://synthetic.invalid/",
    timeoutMs: 1000,
    fetch,
  });
  const invalid = [
    null,
    {
      url: "x-local://fixture.html",
      docUrl: "x-local://fixture.xml",
      elemPath: "name",
      resId: "proof.txt",
    },
    { url: "x-db-obj://fixture/type/1", resId: "proof.txt" },
    { url: "http://other.invalid/fixture.html", resId: "proof.txt" },
    { url: "x-local://fixture.html", resId: "" },
    { docUrl: "x-local://fixture.xml", resId: "proof.txt" },
    { docUrl: "x-local://fixture.xml", elemPath: "name\nother", resId: "proof.txt" },
    { docUrl: "x-local://fixture.xml", elemPath: "name", resId: "proof\u0000.txt" },
  ];
  try {
    for (const request of invalid)
      await assert.rejects(
        new ResourceApi(transport).getCompoundResource(request as CompoundResourceRequest),
        TypeError,
      );
    const gateway = new NativeGateway({
      baseUrl: "http://synthetic.invalid/",
      timeoutMs: 1000,
      maxResponseBytes: 4096,
      fetch,
    });
    try {
      for (const id of [
        "native.resources.getCompoundResource",
        "web.resources.getCompoundResource",
      ]) {
        const operation = getNativeOperations().find((o) => o.id === id)!;
        assert.equal(operation.effect, "read");
        await assert.rejects(gateway.call(id, invalid[1] as Record<string, unknown>), TypeError);
        await assert.rejects(
          gateway.call(id, { docUrl: "x-local://fixture.xml", resId: "proof.txt" }),
          TypeError,
        );
      }
    } finally {
      await gateway.close();
    }
    assert.equal(calls, 0);
  } finally {
    transport.dispose();
  }
});

test("compound resource HTTP failure and oversized streams release the underlying response", async () => {
  for (const status of [404, 200]) {
    let cancelled = false;
    const transport = new HttpTransport({
      baseUrl: "http://synthetic.invalid/",
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
      const operation = new ResourceApi(transport).getCompoundResource({
        url: "x-local://fixture.html",
        resId: "proof.bin",
      });
      if (status === 404)
        await assert.rejects(
          operation,
          (error: unknown) => error instanceof WsHcmApiError && error.status === 404,
        );
      else {
        const response = await operation;
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
