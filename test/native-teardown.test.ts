import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { NativeGateway } from "../src/native/index.js";
import { WsHcmApiError, isTransportFailure } from "../src/protocol/error.js";

const nativeNamespace = "http://www.w3.org/2003/05/soap-envelope/";
const webNamespace = "http://schemas.xmlsoap.org/soap/envelope/";
const envelope = (namespace: string, body: string): string =>
  `<soap:Envelope xmlns:soap="${namespace}"><soap:Body>${body}</soap:Body></soap:Envelope>`;

for (const variant of [
  "success",
  "logout-http-500",
  "logout-loss",
  "soap-fault",
  "body-loss",
  "fault-then-logout-loss",
] as const)
  test(`gateway teardown waits for complete native body before other profiles: ${variant}`, async () => {
    const requests: string[] = [];
    let nativeCloseController: ReadableStreamDefaultController<Uint8Array> | undefined;
    let signalNativeClose!: () => void;
    const nativeCloseStarted = new Promise<void>((resolve) => {
      signalNativeClose = resolve;
    });
    const soapFault = variant === "soap-fault" || variant === "fault-then-logout-loss";
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      const body =
        typeof init?.body === "string"
          ? init.body
          : init?.body instanceof Uint8Array
            ? new TextDecoder().decode(init.body)
            : "";
      const method = /<soap:Body><([A-Za-z0-9]+)/.exec(body)?.[1];
      const action = /(?:^|\r\n)Action: ([^\r\n]+)/.exec(body)?.[1];
      const native = body.includes(nativeNamespace);
      const operation = method
        ? `${native ? "native" : "web"}.${method}`
        : action
          ? `legacy.${action}`
          : `http:${url.pathname}`;
      requests.push(operation);
      if (method === "CloseSession" && native) {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            nativeCloseController = controller;
            controller.enqueue(
              new TextEncoder().encode(
                `<soap:Envelope xmlns:soap="${nativeNamespace}"><soap:Body>`,
              ),
            );
          },
        });
        signalNativeClose();
        return new Response(stream, {
          status: soapFault ? 500 : 200,
          headers: { "content-type": "application/soap+xml" },
        });
      }
      if (
        (variant === "logout-loss" || variant === "fault-then-logout-loss") &&
        url.pathname === "/loggedoff.html"
      )
        throw new TypeError("lost fallback response");
      if (action)
        return new Response("Result: ok\r\n\r\n", {
          headers: { "set-cookie": "SessionID=fixture-legacy; Path=/" },
        });
      if (method)
        return new Response(
          envelope(
            native ? nativeNamespace : webNamespace,
            `<${method}Response>${method === "OpenSession" ? `<SessionID>${native ? "41" : "43"}</SessionID>` : ""}</${method}Response>`,
          ),
          {
            headers: {
              "content-type": "application/soap+xml",
              "set-cookie": "SessionID=fixture-session; Path=/",
            },
          },
        );
      return new Response("<html>fixture</html>", {
        status: variant === "logout-http-500" && url.pathname === "/loggedoff.html" ? 500 : 200,
        headers: { "set-cookie": "SessionID=fixture-http; Path=/" },
      });
    };
    const gateway = new NativeGateway({
      baseUrl: "http://fixture.invalid/",
      username: "fixture",
      password: "fixture",
      installationId: "1234567890ABCDEF",
      timeoutMs: 1000,
      maxResponseBytes: 1024 * 1024,
      fetch,
    });
    const native = await gateway.native();
    const web = await gateway.web();
    const legacy = await gateway.legacy();
    requests.length = 0;
    const closing = gateway.close();
    assert.equal(
      gateway.close(),
      closing,
      "repeated gateway close shares the original pending promise",
    );
    // Attach a rejection handler before releasing the failing body, avoiding an unhandled promise.
    const outcome = closing.then(
      () => undefined,
      (error: unknown) => error,
    );
    await nativeCloseStarted;
    await nextTurn();
    assert.deepEqual(
      requests,
      ["native.CloseSession"],
      "no other profile request while native cleanup body is held",
    );
    if (variant === "body-loss") nativeCloseController!.error(new TypeError("terminated body"));
    else {
      nativeCloseController!.enqueue(
        new TextEncoder().encode(
          soapFault
            ? "<soap:Fault><soap:Code><soap:Value>soap:Receiver</soap:Value></soap:Code><soap:Reason><soap:Text>Fixture unavailable</soap:Text></soap:Reason></soap:Fault></soap:Body></soap:Envelope>"
            : "<CloseSessionResponse/></soap:Body></soap:Envelope>",
        ),
      );
      nativeCloseController!.close();
    }
    const error = await outcome;
    if (variant === "success" || variant === "logout-http-500") assert.equal(error, undefined);
    else assert.ok(error instanceof WsHcmApiError && error.kind === "cleanup");
    const transportLost =
      variant === "body-loss" || variant === "logout-loss" || variant === "fault-then-logout-loss";
    if (transportLost) {
      assert.equal(isTransportFailure(error), true);
      assert.equal((error as WsHcmApiError).details?.remoteCleanupStopped, true);
      assert.deepEqual(
        requests,
        variant === "body-loss"
          ? ["native.CloseSession"]
          : ["native.CloseSession", "http:/loggedoff.html"],
      );
    } else {
      assert.equal(isTransportFailure(error), false);
      assert.deepEqual(requests, [
        "native.CloseSession",
        "http:/loggedoff.html",
        "web.CloseSession",
        "http:/spxml_web/logout.htm",
        "http:/spxml_web/logout2.htm",
        "legacy.QuitSession",
        "http:/loggedoff.html",
      ]);
    }
    const completedRequests = requests.length;
    await assert.rejects(native.lds.idle(), /closed/);
    await assert.rejects(web.rpc.call({ target: "tools.get_version", args: [] }), /closed/);
    await assert.rejects(legacy.xhttp.idle(legacy.installationId));
    assert.equal(
      legacy.sessionId,
      undefined,
      "local disposal removes access, without proving server Quit",
    );
    await assert.rejects(gateway.call("web.lds.idle", {}), /closed/);
    assert.equal(
      requests.length,
      completedRequests,
      "all closed or skipped local contexts reject before fetch",
    );
  });
