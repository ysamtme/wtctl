import assert from "node:assert/strict";
import test from "node:test";
import { WsHcmClient } from "../src/protocol/client.js";
import { WsHcmApiError, isTransportFailure } from "../src/protocol/error.js";

type Profile = "native" | "web" | "legacy";
type Phase = "request" | "body" | "web-lds-request" | "web-lds-body";
const profiles: readonly Profile[] = ["native", "web", "legacy"];
const ownedCookie = { "set-cookie": "SessionID=only-this-bootstrap" };
const base = {
  baseUrl: "http://bootstrap-fixture.invalid/",
  auth: { username: "fixture", password: "fixture" },
  timeoutMs: 1000,
  maxResponseBytes: 1024,
};
function open(client: WsHcmClient, profile: Profile) {
  if (profile === "native") return client.openNativeSession();
  if (profile === "web") return client.openWebSession();
  return client.openLegacySession({ installationId: "1234567890ABCDEF" });
}
function lostBody(error: Error = new TypeError("The fixture response body was lost")): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(error);
      },
    }),
    { headers: ownedCookie },
  );
}

test("native, web and legacy opening halt remote cleanup after request or response-body loss, including a partially opened web HTTP context", async () => {
  for (const profile of profiles) {
    const phases: readonly Phase[] =
      profile === "web"
        ? ["request", "body", "web-lds-request", "web-lds-body"]
        : ["request", "body"];
    for (const phase of phases) {
      const calls: string[] = [];
      const lateWebFailure = phase.startsWith("web-lds");
      const client = new WsHcmClient({
        ...base,
        fetch: async (input) => {
          const path = new URL(String(input)).pathname;
          calls.push(path);
          if (lateWebFailure && calls.length === 1) {
            assert.equal(path, "/spxml_web/main.htm");
            return new Response("<html>owned bootstrap</html>", { headers: ownedCookie });
          }
          if (phase.endsWith("body")) return lostBody();
          throw new TypeError("The fixture request failed before response headers");
        },
      });
      try {
        await assert.rejects(open(client, profile), (error: unknown) => {
          assert.ok(error instanceof WsHcmApiError, `${profile}/${phase}`);
          assert.equal(error.kind, "http", `${profile}/${phase}`);
          assert.equal(error.status, undefined);
          assert.equal(isTransportFailure(error), true);
          assert.equal(error.cleanupError, undefined, "no secondary cleanup was attempted");
          return true;
        });
        assert.equal(calls.length, lateWebFailure ? 2 : 1, `${profile}/${phase}`);
        assert.ok(!calls.some((path) => /logout|loggedoff/.test(path)));
      } finally {
        client.close();
      }
      assert.equal(calls.length, lateWebFailure ? 2 : 1, "local disposal sends no requests");
    }
  }
});

test("ordinary bootstrap rejection and a bounded-response violation still clean the owned HTTP context without guessing LDS or legacy identities", async () => {
  for (const profile of profiles) {
    for (const variant of ["server-rejection", "response-budget"] as const) {
      const calls: { path: string; body: string }[] = [];
      const client = new WsHcmClient({
        ...base,
        maxResponseBytes: 128,
        fetch: async (input, init) => {
          const path = new URL(String(input)).pathname;
          const body =
            typeof init?.body === "string"
              ? init.body
              : init?.body instanceof Uint8Array
                ? new TextDecoder().decode(init.body)
                : "";
          calls.push({ path, body });
          if (/logout|loggedoff/.test(path)) return new Response("");
          if (variant === "response-budget")
            return new Response("x".repeat(129), { headers: ownedCookie });
          if (profile === "web" && path === "/spxml_web/main.htm")
            return new Response("<html>owned bootstrap</html>", { headers: ownedCookie });
          if (profile === "legacy")
            return new Response("Result: denied\r\n\r\n", { headers: ownedCookie });
          return new Response(
            "<Fault><faultcode>Server</faultcode><faultstring>Internal Server Error</faultstring></Fault>",
            { status: 500, headers: ownedCookie },
          );
        },
      });
      try {
        await assert.rejects(open(client, profile), (error: unknown) => {
          assert.ok(error instanceof WsHcmApiError);
          assert.equal(isTransportFailure(error), false);
          assert.equal(error.cleanupError, undefined);
          assert.equal(
            error.kind,
            variant === "response-budget"
              ? "protocol"
              : profile === "legacy"
                ? "xhttp-result"
                : "soap-fault",
          );
          return true;
        });
        const cleanup = calls.filter(({ path }) => /logout|loggedoff/.test(path));
        assert.deepEqual(
          cleanup.map(({ path }) => path),
          profile === "web"
            ? ["/spxml_web/logout.htm", "/spxml_web/logout2.htm"]
            : ["/loggedoff.html"],
          `${profile}/${variant}`,
        );
        assert.ok(!calls.some(({ body }) => /CloseSession|QuitSession/.test(body)));
      } finally {
        client.close();
      }
    }
  }
});

test("ordinary bootstrap rejection stays primary when HTTP cleanup loses headers or body, and web logout stops before its second leg", async () => {
  for (const profile of profiles) {
    for (const cleanupPhase of ["request", "body", "typed-body"] as const) {
      const calls: { path: string; body: string; cookie: string | null }[] = [];
      const cleanupBodies: ReadableStream<Uint8Array>[] = [];
      const bodyFailure =
        cleanupPhase === "typed-body"
          ? new WsHcmApiError("http", "An already classified fixture cleanup-body failure")
          : new TypeError("The fixture response body was lost");
      const client = new WsHcmClient({
        ...base,
        fetch: async (input, init) => {
          const path = new URL(String(input)).pathname;
          const body =
            typeof init?.body === "string"
              ? init.body
              : init?.body instanceof Uint8Array
                ? new TextDecoder().decode(init.body)
                : "";
          calls.push({ path, body, cookie: new Headers(init?.headers).get("cookie") });
          if (/logout|loggedoff/.test(path)) {
            if (cleanupPhase !== "request") {
              const response = lostBody(bodyFailure);
              cleanupBodies.push(response.body!);
              return response;
            }
            throw new TypeError("The cleanup request failed before response headers");
          }
          if (profile === "web" && path === "/spxml_web/main.htm")
            return new Response("<html>owned bootstrap</html>", { headers: ownedCookie });
          if (profile === "legacy")
            return new Response("Result: denied\r\n\r\n", { headers: ownedCookie });
          return new Response(
            "<Fault><faultcode>Server</faultcode><faultstring>Internal Server Error</faultstring></Fault>",
            { status: 500, headers: ownedCookie },
          );
        },
      });
      try {
        await assert.rejects(open(client, profile), (error: unknown) => {
          assert.ok(error instanceof WsHcmApiError, `${profile}/${cleanupPhase}`);
          assert.equal(error.kind, profile === "legacy" ? "xhttp-result" : "soap-fault");
          assert.equal(error.status, profile === "legacy" ? 200 : 500);
          assert.equal(error.operation, profile === "legacy" ? "Idle" : "OpenSession");
          const cleanup = error.cleanupError;
          assert.ok(
            cleanup instanceof WsHcmApiError,
            "cleanup must not replace the bootstrap error",
          );
          assert.equal(cleanup.kind, "http");
          assert.equal(cleanup.status, undefined);
          if (cleanupPhase === "typed-body")
            assert.equal(cleanup, bodyFailure, "an existing typed body error retains its identity");
          else if (cleanupPhase === "body")
            assert.equal(
              cleanup.cause,
              bodyFailure,
              "normalized cancellation retains the body cause",
            );
          assert.equal(isTransportFailure(cleanup), true);
          assert.equal(
            isTransportFailure(error),
            true,
            "attached cleanup transport loss is retained",
          );
          return true;
        });
        assert.deepEqual(
          calls.map(({ path }) => path),
          profile === "web"
            ? ["/spxml_web/main.htm", "/services/LdsService", "/spxml_web/logout.htm"]
            : profile === "native"
              ? ["/services/LdsService", "/loggedoff.html"]
              : ["/xhttp", "/loggedoff.html"],
          `${profile}/${cleanupPhase}`,
        );
        assert.equal(calls.at(-1)?.cookie, "SessionID=only-this-bootstrap");
        assert.ok(!calls.some(({ body }) => /CloseSession|QuitSession/.test(body)));
        for (const stream of cleanupBodies)
          assert.equal(stream.locked, false, "failed cancellation releases its underlying reader");
      } finally {
        client.close();
      }
    }
  }
});
