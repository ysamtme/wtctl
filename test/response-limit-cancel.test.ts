import assert from "node:assert/strict";
import test from "node:test";
import { NativeGateway } from "../src/native/index.js";
import { WsHcmApiError, isTransportFailure } from "../src/protocol/error.js";
import { limitResponse } from "../src/protocol/transport.js";

function oversizedResponse(maxBytes: number, cancellationError?: Error) {
  let cancelCalls = 0;
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(maxBytes + 1));
    },
    cancel() {
      cancelCalls++;
      if (cancellationError !== undefined) throw cancellationError;
    },
  });
  return {
    response: new Response(source, { headers: { "content-type": "application/soap+xml" } }),
    source,
    cancelCalls: () => cancelCalls,
  };
}

test("переполнение сохраняет ошибку лимита в байтах и свидетельство отмены, reader освобождается", async () => {
  const cases = [
    { name: "successful disposal", cancellationError: undefined, unsafe: false },
    {
      name: "known HTTP body-disposal failure",
      cancellationError: new WsHcmApiError("http", "Classified fixture body loss"),
      unsafe: true,
    },
    {
      name: "status-bearing server error",
      cancellationError: new WsHcmApiError("http", "Classified fixture server rejection", {
        status: 503,
      }),
      unsafe: false,
    },
    {
      name: "unknown cancellation rejection",
      cancellationError: new TypeError("secret-cookie-fixture-must-not-be-echoed"),
      unsafe: true,
    },
  ] as const;
  for (const fixture of cases) {
    const oversized = oversizedResponse(32, fixture.cancellationError);
    const response = limitResponse(oversized.response, 32);
    await assert.rejects(response.arrayBuffer(), (error: unknown) => {
      assert.ok(error instanceof WsHcmApiError, fixture.name);
      assert.equal(error.kind, "protocol", "the byte limit remains the primary category");
      assert.equal(error.message, "Ответ превышает заданный предел в байтах");
      assert.deepEqual(error.details, { maxResponseBytes: 32 });
      assert.equal(isTransportFailure(error), fixture.unsafe, fixture.name);
      if (fixture.cancellationError === undefined) assert.equal(error.cleanupError, undefined);
      else if (fixture.cancellationError instanceof WsHcmApiError)
        assert.equal(error.cleanupError, fixture.cancellationError, "retain typed error identity");
      else {
        assert.ok(error.cleanupError instanceof WsHcmApiError);
        assert.equal(error.cleanupError.kind, "http");
        assert.equal(error.cleanupError.message, "Не удалось отменить чтение HTTP-ответа");
        assert.equal(error.cleanupError.cause, fixture.cancellationError);
        assert.ok(!JSON.stringify(error.cleanupError).includes("secret-cookie-fixture"));
      }
      if (fixture.cancellationError !== undefined)
        assert.ok(
          !Object.keys(error).includes("cleanupError"),
          "attached cleanup stays non-enumerable",
        );
      assert.ok(!JSON.stringify(error).includes("secret-cookie-fixture"));
      return true;
    });
    assert.equal(oversized.cancelCalls(), 1, fixture.name);
    assert.equal(oversized.source.locked, false, "failed cancellation still releases the reader");
  }
});

const nativeNamespace = "http://www.w3.org/2003/05/soap-envelope/";
const webNamespace = "http://schemas.xmlsoap.org/soap/envelope/";
function envelope(namespace: string, body: string): string {
  return `<soap:Envelope xmlns:soap="${namespace}"><soap:Body>${body}</soap:Body></soap:Envelope>`;
}

for (const variant of [
  "successful-cancel",
  "known-cancel-failure",
  "unknown-cancel-failure",
] as const)
  test(`два кэшированных контекста прекращают дальнейшее удалённое закрытие после небезопасного освобождения при переполнении: ${variant}`, async () => {
    const requests: string[] = [];
    const cancellationError =
      variant === "known-cancel-failure"
        ? new WsHcmApiError("http", "Classified fixture HTTP cancellation failure")
        : variant === "unknown-cancel-failure"
          ? new TypeError("secret-cookie-fixture-must-not-be-echoed")
          : undefined;
    let oversized: ReturnType<typeof oversizedResponse> | undefined;
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.origin, "http://cancel-fixture.invalid");
      const body =
        typeof init?.body === "string"
          ? init.body
          : init?.body instanceof Uint8Array
            ? new TextDecoder().decode(init.body)
            : "";
      const method = /<soap:Body><([A-Za-z0-9]+)/.exec(body)?.[1];
      const native = body.includes(nativeNamespace);
      requests.push(method ? `${native ? "native" : "web"}.${method}` : `http:${url.pathname}`);
      if (method === "CloseSession" && native) {
        oversized = oversizedResponse(1024, cancellationError);
        return oversized.response;
      }
      if (method)
        return new Response(
          envelope(
            native ? nativeNamespace : webNamespace,
            `<${method}Response>${method === "OpenSession" ? `<SessionID>${native ? "41" : "43"}</SessionID>` : ""}</${method}Response>`,
          ),
          {
            headers: { "content-type": "application/soap+xml", "set-cookie": "SessionID=fixture" },
          },
        );
      return new Response("<html>owned fixture</html>", {
        headers: { "set-cookie": "SessionID=fixture" },
      });
    };
    const gateway = new NativeGateway({
      baseUrl: "http://cancel-fixture.invalid/",
      username: "fixture",
      password: "fixture",
      timeoutMs: 1000,
      maxResponseBytes: 1024,
      fetch,
    });
    const native = await gateway.native();
    const web = await gateway.web();
    assert.deepEqual(requests, [
      "native.OpenSession",
      "http:/spxml_web/main.htm",
      "web.OpenSession",
    ]);
    requests.length = 0;
    const unsafeDisposal = variant !== "successful-cancel";
    await assert.rejects(gateway.close(), (error: unknown) => {
      assert.ok(error instanceof WsHcmApiError);
      assert.equal(error.kind, "cleanup");
      assert.equal(error.details?.remoteCleanupStopped, unsafeDisposal);
      assert.equal(isTransportFailure(error), unsafeDisposal);
      const nativeCleanup = error.cause;
      assert.ok(nativeCleanup instanceof WsHcmApiError && nativeCleanup.kind === "cleanup");
      const byteLimit = nativeCleanup.cause;
      assert.ok(byteLimit instanceof WsHcmApiError && byteLimit.kind === "protocol");
      assert.deepEqual(byteLimit.details, { maxResponseBytes: 1024 });
      if (variant === "known-cancel-failure")
        assert.equal(byteLimit.cleanupError, cancellationError);
      else if (variant === "unknown-cancel-failure") {
        assert.ok(byteLimit.cleanupError instanceof WsHcmApiError);
        assert.equal(byteLimit.cleanupError.message, "Не удалось отменить чтение HTTP-ответа");
        assert.equal(byteLimit.cleanupError.cause, cancellationError);
      } else assert.equal(byteLimit.cleanupError, undefined);
      assert.ok(!JSON.stringify(error).includes("secret-cookie-fixture"));
      return true;
    });
    assert.deepEqual(
      requests,
      unsafeDisposal
        ? ["native.CloseSession"]
        : [
            "native.CloseSession",
            "http:/loggedoff.html",
            "web.CloseSession",
            "http:/spxml_web/logout.htm",
            "http:/spxml_web/logout2.htm",
          ],
      "an unsafe native cancellation blocks its logout and all web teardown requests",
    );
    assert.ok(oversized);
    assert.equal(oversized.cancelCalls(), 1);
    assert.equal(oversized.source.locked, false);
    const completedRequests = requests.length;
    await assert.rejects(native.rpc.call({ target: "tools.get_version", args: [] }), /закрыт/);
    await assert.rejects(web.rpc.call({ target: "tools.get_version", args: [] }), /закрыт/);
    await assert.rejects(
      gateway.call("native.rpc.call", { target: "tools.get_version" }),
      /закрыт/,
    );
    await assert.rejects(gateway.close());
    assert.equal(requests.length, completedRequests, "skipped contexts stay locally closed");
  });
