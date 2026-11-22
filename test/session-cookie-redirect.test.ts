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

test("хранилище cookies сессии сохраняет sticky cookies балансировщика и удаляет только истёкшую cookie", async () => {
  const sent: (string | null)[] = [];
  let step = 0;
  const transport = new HttpTransport({
    baseUrl: "http://fixture.invalid/",
    timeoutMs: 1000,
    fetch: async (_input, init) => {
      sent.push(new Headers(init?.headers).get("cookie"));
      step++;
      if (step === 1) {
        const headers = new Headers();
        headers.append("set-cookie", "SessionID=s1; Path=/");
        headers.append("set-cookie", "AWSALB=node-a; Path=/");
        return new Response("ok", { status: 200, headers });
      }
      if (step === 2) {
        return new Response("ok", {
          status: 200,
          headers: { "set-cookie": "AWSALB=; Max-Age=0; Path=/" },
        });
      }
      return new Response("ok", { status: 200 });
    },
  });
  await transport.send("/a");
  await transport.send("/b");
  await transport.send("/c");
  assert.deepEqual(sent, [null, "SessionID=s1; AWSALB=node-a", "SessionID=s1"]);
  assert.equal(transport.cookie.value, "s1");
  transport.dispose();
  assert.equal(transport.cookie.value, undefined);
  assert.equal(transport.cookie.header(), undefined);
});

test("хранилище cookies учитывает Expires и приоритет Max-Age над Expires", async () => {
  const transport = new HttpTransport({
    baseUrl: "http://fixture.invalid/",
    timeoutMs: 1000,
    fetch: async () => new Response("ok"),
  });
  const first = new Headers();
  first.append("set-cookie", "SessionID=s1; Path=/");
  // Max-Age положительный, Expires в прошлом — по RFC 6265 §5.3 приоритет у Max-Age.
  first.append("set-cookie", "AWSALB=keep; Max-Age=3600; Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  first.append("set-cookie", "OLD=drop; Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  first.append("set-cookie", "bad name=ignored; Path=/");
  transport.cookie.capture(first);
  assert.equal(transport.cookie.header(), "SessionID=s1; AWSALB=keep");

  const second = new Headers();
  second.append("set-cookie", "AWSALB=x; Max-Age=60; Max-Age=0 ; Path=/");
  transport.cookie.capture(second);
  assert.equal(transport.cookie.header(), "SessionID=s1");

  const third = new Headers();
  third.append("set-cookie", "RETRY=ok; Max-Age=60; Max-Age=not-a-number");
  transport.cookie.capture(third);
  assert.equal(transport.cookie.header(), "SessionID=s1; RETRY=ok");
  transport.dispose();
});

test("хранилище cookies различает регистр имён и перестаёт отправлять cookies после истечения Max-Age и Expires", (t) => {
  let now = Date.UTC(2026, 10, 21, 12, 0, 0);
  t.mock.method(Date, "now", () => now);
  const transport = new HttpTransport({
    baseUrl: "http://fixture.invalid/",
    timeoutMs: 1000,
    fetch: async () => new Response("ok"),
  });
  const headers = new Headers();
  headers.append("set-cookie", "SessionID=s1; Path=/");
  headers.append("set-cookie", "node=lower; Max-Age=30; Path=/");
  headers.append("set-cookie", `NODE=upper; Expires=${new Date(now + 60_000).toUTCString()}`);
  transport.cookie.capture(headers);
  assert.equal(transport.cookie.header(), "SessionID=s1; node=lower; NODE=upper");

  now += 31_000;
  assert.equal(transport.cookie.header(), "SessionID=s1; NODE=upper");

  now += 30_000;
  assert.equal(transport.cookie.header(), "SessionID=s1");
  transport.dispose();
});
