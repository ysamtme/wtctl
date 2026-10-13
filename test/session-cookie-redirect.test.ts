import assert from "node:assert/strict";
import { test } from "node:test";
import { HttpTransport } from "../src/protocol/transport.js";

interface Step {
  readonly path: string;
  readonly status?: number;
  readonly location?: string;
  readonly setCookie?: string;
}

function fixture(steps: readonly Step[], initialCookie?: string) {
  const requests: { path: string; headers: Headers; redirect: RequestRedirect | undefined }[] = [];
  const transport = new HttpTransport({
    baseUrl: "http://fixture.invalid/mount/",
    timeoutMs: 1000,
    fetch: async (input, init = {}) => {
      const path = new URL(String(input)).pathname;
      const step = steps[requests.length];
      assert.ok(step, "No request beyond the declared redirect chain");
      assert.equal(path, step.path);
      // Снимок заголовков протокола: send() переиспользует свой Headers между переходами.
      requests.push({ path, headers: new Headers(init.headers), redirect: init.redirect });
      return new Response(null, {
        status: step.status ?? 200,
        headers: {
          ...(step.location === undefined ? {} : { location: step.location }),
          ...(step.setCookie === undefined ? {} : { "set-cookie": step.setCookie }),
        },
      });
    },
  });
  if (initialCookie !== undefined)
    transport.cookie.capture(new Headers({ "set-cookie": `SessionID=${initialCookie}; Path=/` }));
  return {
    transport,
    requests,
    cookies: () => requests.map((request) => request.headers.get("cookie")),
  };
}

test("истечение при перенаправлении убирает SessionID транспорта и не восстанавливает Cookie вызывающего", async () => {
  const f = fixture(
    [
      {
        path: "/mount/start",
        status: 302,
        location: "/mount/next",
        setCookie: "SessionID=; Max-Age=0; Path=/",
      },
      { path: "/mount/next" },
    ],
    "owned-before-redirect",
  );
  const suppliedHeaders = new Headers({ Cookie: "expert=caller-cookie" });
  const response = await f.transport.send("/start", { headers: suppliedHeaders });
  assert.equal(response.status, 200);
  assert.deepEqual(f.cookies(), ["SessionID=owned-before-redirect", null]);
  assert.equal(f.transport.cookie.value, undefined);
  assert.equal(suppliedHeaders.get("cookie"), "expert=caller-cookie");
});

test("SessionID, полученный посреди цепочки, убирается после того, как позднее перенаправление прекращает его действие", async () => {
  const f = fixture([
    {
      path: "/mount/start",
      status: 302,
      location: "/mount/middle",
      setCookie: "SessionID=acquired-in-redirect; Path=/",
    },
    {
      path: "/mount/middle",
      status: 307,
      location: "/mount/next",
      setCookie: "SessionID=expired-value; Max-Age=0; Path=/",
    },
    { path: "/mount/next" },
  ]);
  await f.transport.send("/start", { headers: { Cookie: "expert=initial-caller-cookie" } });
  assert.deepEqual(f.cookies(), [
    "expert=initial-caller-cookie",
    "SessionID=acquired-in-redirect",
    null,
  ]);
  assert.equal(f.transport.cookie.value, undefined);
});

test("смена SessionID при перенаправлении заменяет собственный SessionID на каждом следующем переходе", async () => {
  const f = fixture(
    [
      {
        path: "/mount/start",
        status: 301,
        location: "/mount/middle",
        setCookie: "SessionID=rotated-once; Path=/",
      },
      {
        path: "/mount/middle",
        status: 308,
        location: "/mount/next",
        setCookie: "SessionID=rotated-twice; Path=/",
      },
      { path: "/mount/next" },
    ],
    "original",
  );
  await f.transport.send("/start");
  assert.deepEqual(f.cookies(), [
    "SessionID=original",
    "SessionID=rotated-once",
    "SessionID=rotated-twice",
  ]);
  assert.equal(f.transport.cookie.value, "rotated-twice");
});

test("анонимный исходный Cookie вызывающего переживает перенаправления, когда хранилище SessionID не применяет заголовок", async () => {
  const f = fixture([
    {
      path: "/mount/start",
      status: 302,
      location: "/mount/middle",
      setCookie: "Unrelated=server-cookie; Path=/",
    },
    {
      path: "/mount/middle",
      status: 302,
      location: "/mount/next",
      setCookie: "SessionID=; Max-Age=0; Path=/",
    },
    { path: "/mount/next" },
  ]);
  const callerCookie = "SessionID=expert-owned-raw-value; other=raw";
  await f.transport.send("/start", { headers: { cookie: callerCookie } });
  assert.deepEqual(f.cookies(), [callerCookie, callerCookie, callerCookie]);
  assert.equal(f.transport.cookie.value, undefined);
});

test("ручные перенаправления фиксируют удаление SessionID, не следуя им и не меняя заголовки вызывающего", async () => {
  const f = fixture(
    [
      {
        path: "/mount/start",
        status: 302,
        location: "/mount/never-followed",
        setCookie: "SessionID=; Max-Age=0; Path=/",
      },
      { path: "/mount/later" },
    ],
    "owned-manual",
  );
  const suppliedHeaders = new Headers({ Cookie: "expert=manual-caller-cookie" });
  const response = await f.transport.send(
    "/start",
    { headers: suppliedHeaders },
    { redirect: "manual" },
  );
  assert.equal(response.status, 302);
  assert.equal(f.requests.length, 1);
  assert.equal(f.transport.cookie.value, undefined);
  assert.equal(suppliedHeaders.get("cookie"), "expert=manual-caller-cookie");
  await f.transport.send("/later");
  assert.deepEqual(f.cookies(), ["SessionID=owned-manual", null]);
  assert.ok(f.requests.every((request) => request.redirect === "manual"));
});
