import assert from "node:assert/strict";
import { test } from "node:test";
import { WsHcmApiError, WsHcmClient, rawXml, rpc } from "../../src/protocol/index.js";
import { ArgumentError } from "../../src/protocol/error.js";
import { soapBody, soapEnvelope, soapFragments } from "../../src/protocol/protocol.js";
import { HttpTransport } from "../../src/protocol/transport.js";
import { escapeXml } from "../../src/protocol/xml.js";

function bodyText(init: RequestInit): string {
  if (typeof init.body === "string") return init.body;
  if (init.body instanceof Uint8Array) return new TextDecoder().decode(init.body);
  return "";
}

function soap(method: string, inner = "", profile: "native" | "web" = "native"): Response {
  const envelope =
    profile === "native"
      ? "http://www.w3.org/2003/05/soap-envelope/"
      : "http://schemas.xmlsoap.org/soap/envelope/";
  const operation =
    profile === "native" ? "http://www.datex-soft.com/" : "http://www.datex-soft.com/soap/";
  return new Response(
    `<soap:Envelope xmlns:soap="${envelope}"><soap:Body><${method}Response xmlns="${operation}">${inner}</${method}Response></soap:Body></soap:Envelope>`,
    { status: 200, headers: { "content-type": "application/soap+xml" } },
  );
}

function nativeLifecycle(
  handler: (url: URL, init: RequestInit) => Response | undefined,
): typeof globalThis.fetch {
  return (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const handled = handler(url, init);
    if (handled !== undefined) return handled;
    const body = bodyText(init);
    if (url.pathname === "/services/LdsService" && body.includes("<OpenSession")) {
      return soap("OpenSession", "<SessionID>42</SessionID>");
    }
    if (url.pathname === "/services/LdsService" && body.includes("<CloseSession"))
      return soap("CloseSession");
    if (url.pathname === "/loggedoff.html") return new Response("", { status: 200 });
    assert.fail(`unexpected request: ${init.method ?? "GET"} ${url.pathname}${url.search}`);
  }) as typeof globalThis.fetch;
}

function webLifecycle(
  handler: (url: URL, init: RequestInit) => Response | undefined,
): typeof globalThis.fetch {
  return (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const handled = handler(url, init);
    if (handled !== undefined) return handled;
    const body = bodyText(init);
    if (url.pathname === "/spxml_web/main.htm") {
      return new Response("", {
        status: 200,
        headers: { "set-cookie": "SessionID=web-cookie; Path=/" },
      });
    }
    if (url.pathname === "/services/LdsService" && body.includes("<OpenSession")) {
      return soap("OpenSession", "<SessionID>52</SessionID>", "web");
    }
    if (url.pathname === "/services/LdsService" && body.includes("<CloseSession"))
      return soap("CloseSession", "", "web");
    if (url.pathname === "/spxml_web/logout.htm")
      return new Response(null, { status: 302, headers: { location: "/spxml_web/logout2.htm" } });
    if (url.pathname === "/spxml_web/logout2.htm") return new Response("", { status: 200 });
    assert.fail(`unexpected request: ${init.method ?? "GET"} ${url.pathname}${url.search}`);
  }) as typeof globalThis.fetch;
}

test("RPC native сохраняет точную цель, VALUE-TYPE, RawXml и типизацию результата", async () => {
  let calls = 0;
  const client = new WsHcmClient({
    baseUrl: "http://wt.test/",
    auth: { username: "user", password: "secret" },
    fetch: nativeLifecycle((url, init) => {
      if (url.pathname !== "/api/spxml/CallMethod") return undefined;
      calls += 1;
      assert.equal(init.method, "POST");
      assert.equal(new Headers(init.headers).get("content-type"), "application/soap+xml");
      const body = bodyText(init);
      assert.match(body, /<LibName>tools<\/LibName><MethodName>get_version<\/MethodName><ArgData>/);
      assert.match(body, /<arg-0 VALUE-TYPE="string">wtv &amp; exact<\/arg-0>/);
      assert.match(body, /<arg-1 VALUE-TYPE="integer"><value>7<\/value><\/arg-1>/);
      return soap(
        "CallMethod",
        '<ResultData><Result VALUE-TYPE="string">2025.1.1171</Result></ResultData>',
      );
    }),
  });

  await client.withNativeSession(async (session) => {
    const response = await session.rpc.call({
      target: "tools.get_version",
      args: [rpc.string("wtv & exact"), rpc.typed("integer", rawXml("<value>7</value>"))],
    });
    assert.equal(response.data.valueType, "string");
    assert.equal(response.data.lexicalValue, "2025.1.1171");
  });
  assert.equal(calls, 1);
});

test("RPC отличает существующую пустую типизированную строку от отсутствующего Result", async () => {
  for (const profile of ["native", "web"] as const) {
    let inner = '<ResultData><Result VALUE-TYPE="string"/></ResultData>';
    const lifecycle = profile === "native" ? nativeLifecycle : webLifecycle;
    const client = new WsHcmClient({
      baseUrl: "http://wt.test/",
      auth: { username: "fixture", password: "fixture" },
      fetch: lifecycle((url) =>
        url.pathname === "/api/spxml/CallMethod" ? soap("CallMethod", inner, profile) : undefined,
      ),
    });
    const session =
      profile === "native" ? await client.openNativeSession() : await client.openWebSession();
    try {
      assert.equal((await session.rpc.call({ target: "tools.get_version" })).data.lexicalValue, "");
      inner = "<ResultData/>";
      await assert.rejects(session.rpc.call({ target: "tools.get_version" }), /нет Result/);
    } finally {
      await session.close();
      client.close();
    }
  }
});

test("native get_app_info передаёт точные параметры строки запроса", async () => {
  const seen: string[] = [];
  const client = new WsHcmClient({
    baseUrl: "http://wt.test/",
    auth: { username: "user", password: "secret" },
    fetch: nativeLifecycle((url, init) => {
      if (url.pathname === "/api/spxml2/get_app_info") {
        seen.push("app-info");
        assert.equal(init.method ?? "GET", "GET");
        assert.equal(url.search, "?fast_start=1&anonymous=1&open_session=1&rnd=123");
        return Response.json({ Success: 1 });
      }
      return undefined;
    }),
  });

  await client.withNativeSession(async (session) => {
    await session.spxml2.getAppInfo({
      fastStart: true,
      anonymous: true,
      openSession: true,
      rnd: 123,
    });
  });
  assert.deepEqual(seen, ["app-info"]);
});

test("асинхронный жизненный цикл сохраняет шестнадцатеричный TrackingID 1171 в том виде, как он записан", async () => {
  const trackingId = "0x28865C2947AC3BF9";
  const seen: string[] = [];
  const client = new WsHcmClient({
    baseUrl: "http://wt.test/",
    auth: { username: "user", password: "secret" },
    fetch: webLifecycle((url, init) => {
      if (
        url.pathname !== "/api/spxml/GetAsyncMethodStatus" &&
        url.pathname !== "/api/spxml/KillAsyncMethod"
      )
        return undefined;
      const method = url.pathname.endsWith("GetAsyncMethodStatus")
        ? "GetAsyncMethodStatus"
        : "KillAsyncMethod";
      assert.match(bodyText(init), new RegExp(`<TrackingID>${trackingId}</TrackingID>`));
      seen.push(method);
      return soap(
        method,
        method === "GetAsyncMethodStatus" ? "<IsRunning>false</IsRunning>" : "",
        "web",
      );
    }),
  });

  await client.withWebSession(async (session) => {
    await session.spxml.getAsyncMethodStatus(trackingId);
    await session.spxml.killAsyncMethod(trackingId);
  });
  assert.deepEqual(seen, ["GetAsyncMethodStatus", "KillAsyncMethod"]);
});

test("потоковые XML-параметры native используют точную разметку multipart XOP", async () => {
  let calls = 0;
  const client = new WsHcmClient({
    baseUrl: "http://wt.test/",
    auth: { username: "user", password: "secret" },
    fetch: nativeLifecycle((url, init) => {
      const body = bodyText(init);
      if (url.pathname !== "/services/LdsService" || !body.includes("<PutDoc")) return undefined;
      calls += 1;
      const contentType = new Headers(init.headers).get("content-type") ?? "";
      const boundary = /boundary="([^"]+)"/.exec(contentType)?.[1];
      assert.ok(boundary);
      assert.match(
        contentType,
        /^multipart\/related; boundary="[^"]+"; type="application\/xop\+xml"; start-info="text\/xml"$/,
      );
      assert.ok(body.startsWith(`\r\n--${boundary}\r\nContent-Type: application/soap+xml\r\n`));
      assert.match(
        body,
        /<Url>x-local:\/\/wt_data\/objects\/AA\/01\.xml<\/Url><WriteDocInfo>true<\/WriteDocInfo><NeverSaved>true<\/NeverSaved><SessionID>42<\/SessionID><Data><xop:Include xmlns:xop="http:\/\/www\.w3\.org\/2004\/08\/xop\/include" href="cid:(0x[0-9a-f]+)"\/><\/Data>/,
      );
      const contentId = /href="cid:(0x[0-9a-f]+)"/.exec(body)?.[1];
      assert.ok(contentId);
      assert.ok(
        body.includes(
          `\r\n--${boundary}\r\nContent-ID: ${contentId}\r\n\r\n<collaborator><id>1</id></collaborator>`,
        ),
      );
      assert.ok(body.endsWith(`\r\n--${boundary}--\r\n`));
      return soap("PutDoc");
    }),
  });

  await client.withNativeSession(async (session) => {
    assert.throws(
      () =>
        session.lds.putDoc({
          url: "x-local://wt_data/objects/AA/01.xml",
          data: "<collaborator/>" as never,
        }),
      /data: нужен проверенный XML/,
    );
    await session.lds.putDoc({
      url: "x-local://wt_data/objects/AA/01.xml",
      writeDocInfo: true,
      neverSaved: true,
      data: rawXml("<collaborator><id>1</id></collaborator>"),
    });
  });
  assert.equal(calls, 1);
});

test("потоковые флаги native сохраняют подставные тела LoadUrl и LoadDoc потоками", async () => {
  const binary = Uint8Array.of(0, 255, 60, 120, 109, 108, 62);
  const multipart = new TextEncoder().encode(
    "\r\n--response-boundary\r\nContent-Type: application/soap+xml\r\n\r\n<Envelope/>\r\n--response-boundary--\r\n",
  );
  const client = new WsHcmClient({
    baseUrl: "http://wt.test/",
    auth: { username: "user", password: "secret" },
    fetch: nativeLifecycle((url, init) => {
      if (url.pathname !== "/services/LdsService") return undefined;
      const body = bodyText(init);
      if (!body.includes("<LoadUrl") && !body.includes("<LoadDoc")) return undefined;
      if (body.includes("<UseBinaryResponse>true</UseBinaryResponse>")) {
        return new Response(binary, {
          status: 200,
          headers: { "content-type": "application/binary" },
        });
      }
      assert.match(body, /<UseMultipartResponse>true<\/UseMultipartResponse>/);
      return new Response(multipart, {
        status: 200,
        headers: {
          "content-type":
            'multipart/related; boundary="response-boundary"; type="application/xop+xml"',
        },
      });
    }),
  });

  await client.withNativeSession(async (session) => {
    const binaryResponse = await session.lds.loadUrl({
      url: "x-local://wt/file.xml",
      useBinaryResponse: true,
    });
    assert.deepEqual(new Uint8Array(await new Response(binaryResponse.body).arrayBuffer()), binary);
    const multipartResponse = await session.lds.loadUrl({
      url: "x-local://wt/file.xml",
      useMultipartResponse: true,
    });
    assert.deepEqual(
      new Uint8Array(await new Response(multipartResponse.body).arrayBuffer()),
      multipart,
    );
    const docResponse = await session.lds.loadDoc({
      url: "x-local://wt/doc.xml",
      useBinaryResponse: true,
    });
    assert.deepEqual(new Uint8Array(await new Response(docResponse.body).arrayBuffer()), binary);
  });
});

test("потоковые ошибки SOAP разбирают малые fault и отменяют слишком большие тела", async () => {
  let loadCalls = 0;
  let cancelled = false;
  const client = new WsHcmClient({
    baseUrl: "http://wt.test/",
    auth: { username: "user", password: "secret" },
    fetch: nativeLifecycle((url, init) => {
      if (url.pathname !== "/services/LdsService" || !bodyText(init).includes("<LoadUrl"))
        return undefined;
      loadCalls += 1;
      if (loadCalls === 1) {
        return new Response(
          "<Fault><faultcode>Server</faultcode><faultstring>Small fault</faultstring></Fault>",
          {
            status: 500,
            headers: { "content-type": "application/soap+xml" },
          },
        );
      }
      const oversized = new Uint8Array(70_000);
      oversized.fill(120);
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(oversized);
          },
          cancel() {
            cancelled = true;
          },
        }),
        { status: 500, headers: { "content-type": "application/binary" } },
      );
    }),
  });

  await client.withNativeSession(async (session) => {
    await assert.rejects(
      session.lds.loadUrl({ url: "x-local://wt/file.xml", useBinaryResponse: true }),
      (error: unknown) =>
        error instanceof WsHcmApiError &&
        error.kind === "soap-fault" &&
        error.message === "Small fault",
    );
    await assert.rejects(
      session.lds.loadUrl({ url: "x-local://wt/file.xml", useBinaryResponse: true }),
      (error: unknown) =>
        error instanceof WsHcmApiError && error.kind === "http" && error.status === 500,
    );
  });
  assert.equal(cancelled, true);
});

test("буферизованный XML web учитывает charset ответа", async () => {
  const word = Uint8Array.of(0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2);
  const encodedXml = (root: string): Uint8Array<ArrayBuffer> => {
    const start = new TextEncoder().encode(`<${root}><name>`);
    const end = new TextEncoder().encode(`</name></${root}>`);
    const bytes = new Uint8Array(start.length + word.length + end.length);
    bytes.set(start);
    bytes.set(word, start.length);
    bytes.set(end, start.length + word.length);
    return bytes;
  };
  const client = new WsHcmClient({
    baseUrl: "http://wt.test/",
    auth: { username: "user", password: "secret" },
    fetch: webLifecycle((url) => {
      if (url.pathname === "/spxml_web/service/get_ui_text.htm") {
        return new Response(encodedXml("texts"), {
          headers: { "content-type": "text/xml; charset=windows-1251" },
        });
      }
      return undefined;
    }),
  });

  await client.withWebSession(async (session) => {
    assert.match(JSON.stringify((await session.pages.getUiText()).data), /Привет/);
  });
});

test("голый SOAP Fault становится ограниченной ошибкой soap-fault", async () => {
  const client = new WsHcmClient({
    baseUrl: "http://wt.test/",
    auth: { username: "user", password: "secret" },
    fetch: (async () =>
      new Response(
        "<Fault><faultcode>Server</faultcode><faultstring>Internal Server Error</faultstring></Fault>",
        { status: 500, headers: { "content-type": "application/soap+xml" } },
      )) as typeof globalThis.fetch,
  });

  await assert.rejects(client.openNativeSession(), (error: unknown) => {
    assert.ok(error instanceof WsHcmApiError);
    assert.equal(error.kind, "soap-fault");
    assert.equal(error.operation, "OpenSession");
    assert.equal(error.status, 500);
    assert.equal(error.message, "Internal Server Error");
    assert.deepEqual(error.details, { faultCode: "Server" });
    return true;
  });
});

test("причина и код SOAP 1.2 Fault сохраняются", async () => {
  const client = new WsHcmClient({
    baseUrl: "http://wt.test/",
    auth: { username: "user", password: "secret" },
    fetch: (async () =>
      new Response(
        '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope/">' +
          "<soap:Body><soap:Fault>" +
          "<soap:Code><soap:Value>soap:Receiver</soap:Value></soap:Code>" +
          '<soap:Reason><soap:Text xml:lang="en">Object type is unavailable</soap:Text><soap:Text xml:lang="ru">Тип недоступен</soap:Text></soap:Reason>' +
          "</soap:Fault></soap:Body></soap:Envelope>",
        { status: 500, headers: { "content-type": "application/soap+xml" } },
      )) as typeof globalThis.fetch,
  });

  await assert.rejects(client.openNativeSession(), (error: unknown) => {
    assert.ok(error instanceof WsHcmApiError);
    assert.equal(error.kind, "soap-fault");
    assert.equal(error.message, "Object type is unavailable");
    assert.deepEqual(error.details, { faultCode: "soap:Receiver" });
    return true;
  });
});

test("элементы Fault прикладного уровня не считаются SOAP fault", async () => {
  const client = new WsHcmClient({
    baseUrl: "http://wt.test/",
    auth: { username: "user", password: "secret" },
    fetch: nativeLifecycle((url, init) => {
      if (url.pathname !== "/services/LdsService" || !bodyText(init).includes("<LoadDoc"))
        return undefined;
      return soap(
        "LoadDoc",
        "<ResultData><Fault><message>application value</message></Fault></ResultData>",
      );
    }),
  });

  await client.withNativeSession(async (session) => {
    const response = await session.lds.loadDoc({ url: "x-local://wt/doc.xml" });
    assert.match(JSON.stringify(response.data), /application value/);
  });
});

test("успешный ответ SOAP обязан быть прямым потомком Body", async () => {
  const invalid = [
    '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope/"><soap:Body><wrapper><OpenSessionResponse><SessionID>42</SessionID></OpenSessionResponse></wrapper></soap:Body></soap:Envelope>',
    "<OpenSessionResponse><SessionID>42</SessionID></OpenSessionResponse>",
  ];
  for (const body of invalid) {
    const client = new WsHcmClient({
      baseUrl: "http://wt.test/",
      auth: { username: "user", password: "secret" },
      fetch: (async () =>
        new Response(body, {
          status: 200,
          headers: { "content-type": "application/soap+xml" },
        })) as typeof globalThis.fetch,
    });
    await assert.rejects(
      client.openNativeSession(),
      (error: unknown) =>
        error instanceof WsHcmApiError &&
        error.kind === "protocol" &&
        /нет OpenSessionResponse/.test(error.message),
    );
  }
});

test("сообщения SOAP fault ограничены по длине и скрывают типичные секретные поля", async () => {
  const secret = "do-not-expose";
  const oversized = `Password=${secret} ${"x".repeat(700)}`;
  const client = new WsHcmClient({
    baseUrl: "http://wt.test/",
    auth: { username: "user", password: "secret" },
    fetch: (async () =>
      new Response(
        `<Fault><faultcode>Server</faultcode><faultstring>${oversized}</faultstring></Fault>`,
        { status: 500, headers: { "content-type": "application/soap+xml" } },
      )) as typeof globalThis.fetch,
  });

  await assert.rejects(client.openNativeSession(), (error: unknown) => {
    assert.ok(error instanceof WsHcmApiError);
    assert.equal(error.kind, "soap-fault");
    assert.doesNotMatch(error.message, new RegExp(secret));
    assert.ok(error.message.length <= 512);
    assert.match(error.message, /^Password=\[redacted\]/);
    return true;
  });
});

test("обычная Error операции остаётся основной, когда очистка тоже падает", async () => {
  const primary = new Error("plain operation failure") as Error & { cleanupError?: unknown };
  const client = new WsHcmClient({
    baseUrl: "http://wt.test/",
    auth: { username: "user", password: "secret" },
    fetch: nativeLifecycle((url, init) => {
      if (url.pathname === "/services/LdsService" && bodyText(init).includes("<CloseSession")) {
        return new Response("not XML", { status: 500 });
      }
      return undefined;
    }),
  });

  await assert.rejects(
    client.withNativeSession(async () => {
      throw primary;
    }),
    (error: unknown) => {
      assert.equal(error, primary);
      assert.ok(primary.cleanupError instanceof WsHcmApiError);
      assert.equal(primary.cleanupError.kind, "cleanup");
      return true;
    },
  );
});

test("транспорт отклоняет встроенные учётные данные и запросы на другой origin до fetch", async () => {
  assert.throws(
    () => new WsHcmClient({ baseUrl: "http://user:password@wt.test/" }),
    /без имени и пароля в адресе/,
  );

  let fetchCalls = 0;
  const transport = new HttpTransport({
    baseUrl: "http://wt.test/",
    timeoutMs: 1000,
    fetch: (async () => {
      fetchCalls += 1;
      return new Response("unexpected");
    }) as typeof globalThis.fetch,
  });
  try {
    await assert.rejects(
      transport.send("http://other.test/xhttp_info"),
      (error: unknown) => error instanceof WsHcmApiError && error.kind === "protocol",
    );
    await assert.rejects(
      transport.send("http://user:secret@wt.test/xhttp_info"),
      (error: unknown) => error instanceof WsHcmApiError && error.kind === "protocol",
    );
    assert.equal(fetchCalls, 0);
  } finally {
    transport.dispose();
  }
});

test("транспорт выставляет Node duplex для тел ReadableStream", async () => {
  let duplex: unknown;
  const transport = new HttpTransport({
    baseUrl: "http://wt.test/",
    timeoutMs: 1000,
    fetch: (async (input, init) => {
      duplex = (init as RequestInit & { duplex?: unknown }).duplex;
      const request = new Request(input, init);
      await request.body?.cancel();
      return new Response("ok");
    }) as typeof globalThis.fetch,
  });
  try {
    const response = await transport.send("/upload", {
      method: "POST",
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("stream"));
          controller.close();
        },
      }),
    });
    await response.body?.cancel();
    assert.equal(duplex, "half");
  } finally {
    transport.dispose();
  }
});

test("диагностика использует необязательную аутентификацию Basic, когда учётные данные есть", async () => {
  const headers: Array<string | null> = [];
  const fetch = (async (_input, init) => {
    headers.push(new Headers(init?.headers).get("authorization"));
    return new Response("info", { status: 200 });
  }) as typeof globalThis.fetch;
  await new WsHcmClient({ baseUrl: "http://wt.test/", fetch }).diagnostics.xhttpInfo();
  await new WsHcmClient({
    baseUrl: "http://wt.test/",
    auth: { username: "user", password: "secret" },
    fetch,
  }).diagnostics.xhttpInfo();
  assert.equal(headers[0], null);
  assert.match(headers[1] ?? "", /^Basic /);
});

test("жизненный цикл web пробует logout2 после сбоя logout и остаётся идемпотентным", async () => {
  const logoutCalls: string[] = [];
  const client = new WsHcmClient({
    baseUrl: "http://wt.test/",
    auth: { username: "user", password: "secret" },
    fetch: webLifecycle((url) => {
      if (url.pathname === "/spxml_web/logout.htm") {
        logoutCalls.push("logout");
        return new Response("failure", { status: 500 });
      }
      if (url.pathname === "/spxml_web/logout2.htm") {
        logoutCalls.push("logout2");
        return new Response("", { status: 200 });
      }
      return undefined;
    }),
  });

  const session = await client.openWebSession();
  await assert.rejects(session.close(), (error: unknown) => {
    assert.ok(error instanceof WsHcmApiError);
    assert.equal(error.kind, "cleanup");
    return true;
  });
  assert.deepEqual(logoutCalls, ["logout", "logout2"]);
  await session.close();
  assert.deepEqual(logoutCalls, ["logout", "logout2"]);
});

test("регрессии транспорта скрывают секреты из ошибок fetch и отменяют тело при HTTP 500", async () => {
  const secretUrl = "http://secret-user:secret-password@private.example/hidden";
  const failed = new WsHcmClient({
    baseUrl: "http://wt.test/",
    fetch: (async () => {
      throw new TypeError(`fetch failed for ${secretUrl}`);
    }) as typeof globalThis.fetch,
  });
  await assert.rejects(failed.diagnostics.xhttpInfo(), (error: unknown) => {
    assert.ok(error instanceof WsHcmApiError);
    assert.equal(error.kind, "http");
    assert.doesNotMatch(
      `${String(error)} ${JSON.stringify(error)}`,
      /secret-user|secret-password|private\.example/,
    );
    return true;
  });

  let cancelled = false;
  const client = new WsHcmClient({
    baseUrl: "http://wt.test/",
    auth: { username: "user", password: "secret" },
    fetch: nativeLifecycle((url) =>
      url.pathname === "/lds/get_resource_image.html"
        ? new Response(
            new ReadableStream({
              cancel() {
                cancelled = true;
              },
            }),
            { status: 500 },
          )
        : undefined,
    ),
  });
  await client.withNativeSession(async (session) => {
    await assert.rejects(
      session.resources.getImage({ resourceId: "1" }),
      (error: unknown) =>
        error instanceof WsHcmApiError && error.kind === "http" && error.status === 500,
    );
  });
  assert.equal(cancelled, true);
});

test("maxResponseBytes отдельного SOAP-вызова заменяет предел клиента: меньший отклоняет большой ответ, Infinity снимает предел", async () => {
  const client = (maxResponseBytes: number) =>
    new WsHcmClient({
      baseUrl: "http://wt.test/",
      auth: { username: "user", password: "secret" },
      maxResponseBytes,
      fetch: nativeLifecycle((_url, init) =>
        bodyText(init).includes("<XQuery")
          ? soap("XQuery", `<Result>${"x".repeat(4096)}</Result>`)
          : undefined,
      ),
    });
  await client(16 * 1024 * 1024).withNativeSession(async (session) => {
    await assert.rejects(
      session.lds.xQuery({ query: "1" }, { maxResponseBytes: 1024 }),
      /предел в байтах/,
    );
  });
  await client(1024).withNativeSession(async (session) => {
    const response = await session.lds.xQuery({ query: "1" }, { maxResponseBytes: Infinity });
    assert.equal(response.status, 200);
  });
});

test("escapeXml и soapBody сохраняют точное экранирование, проверку символов XML и кодировку UTF-8 для крупных тел", async () => {
  // Быстрый путь без спецсимволов (ASCII и кириллица) и обход суррогатной пары.
  assert.equal(escapeXml("ABCabc012+/= Привет"), "ABCabc012+/= Привет");
  assert.equal(escapeXml("Привет 🙂"), "Привет 🙂");
  assert.equal(
    escapeXml(`a&b<c>d"e'f\rg\nh\ti🙂`),
    "a&amp;b&lt;c&gt;d&quot;e&apos;f&#13;g&#10;h&#9;i🙂",
  );
  for (const invalid of ["\u0000", "\u000b", "\ud800", "\udc00", "\ufffe", "\uffff"])
    assert.throws(() => escapeXml(`ok${invalid}`), ArgumentError);

  const small = soapBody(
    "CallMethod",
    [["ArgData", soapFragments(["<arg-0>Привет</arg-0>"])]],
    "native",
  );
  assert.equal(typeof small, "string");
  assert.equal(
    small,
    soapEnvelope("CallMethod", [["ArgData", rawXml("<arg-0>Привет</arg-0>")]], "native"),
  );

  const payload = "Привет🙂&<>".repeat(8000);
  const large = soapBody(
    "CallMethod",
    [
      ["LibName", "tools"],
      ["ArgData", soapFragments(["<arg-0>", escapeXml(payload), "</arg-0>"])],
    ],
    "native",
  );
  assert.ok(Buffer.isBuffer(large));
  assert.deepEqual(
    large,
    Buffer.from(
      soapEnvelope(
        "CallMethod",
        [
          ["LibName", "tools"],
          ["ArgData", rawXml(`<arg-0>${escapeXml(payload)}</arg-0>`)],
        ],
        "native",
      ),
      "utf8",
    ),
  );

  // Публичные вызовы: обычный массив в скалярном поле экранируется, разреженный массив аргументов
  // сохраняет индексы arg-N, а крупный RPC уходит буфером UTF-8 с тем же XML.
  const bodies: Array<RequestInit["body"]> = [];
  const client = new WsHcmClient({
    baseUrl: "http://wt.test/",
    auth: { username: "user", password: "secret" },
    fetch: nativeLifecycle((_url, init) => {
      const text = bodyText(init);
      if (text.includes("<LoadDoc")) {
        bodies.push(init.body);
        return soap("LoadDoc", "<Data><doc/></Data>");
      }
      if (text.includes("<CallMethod")) {
        bodies.push(init.body);
        return soap(
          "CallMethod",
          '<ResultData><Result VALUE-TYPE="string">ok</Result></ResultData>',
        );
      }
      return undefined;
    }),
  });
  await client.withNativeSession(async (session) => {
    await session.lds.loadDoc({ url: ["<injected/>"] as unknown as string });
    const sparse: ReturnType<typeof rpc.string>[] = [];
    sparse[1] = rpc.string("second");
    await session.rpc.call({ target: "tools.fn", args: sparse });
    await session.rpc.call({ target: "tools.big", args: [rpc.string(payload)] });
  });
  assert.match(String(bodies[0]), /<Url>&lt;injected\/&gt;<\/Url>/);
  assert.match(String(bodies[1]), /<ArgData><arg-1 VALUE-TYPE="string">second<\/arg-1><\/ArgData>/);
  assert.ok(Buffer.isBuffer(bodies[2]));
  assert.ok(String(bodies[2]).includes(`<arg-0 VALUE-TYPE="string">${escapeXml(payload)}</arg-0>`));
});
