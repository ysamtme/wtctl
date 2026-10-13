import assert from "node:assert/strict";
import { test } from "node:test";
import { WsHcmApiError, WsHcmClient, rawXml, rpc } from "../../src/protocol/index.js";

function bodyText(init: RequestInit): string {
  if (typeof init.body === "string") return init.body;
  if (init.body instanceof Uint8Array) return new TextDecoder().decode(init.body);
  return "";
}

function bodyBytes(init: RequestInit): Uint8Array {
  if (typeof init.body === "string") return new TextEncoder().encode(init.body);
  if (init.body instanceof Uint8Array) return init.body;
  assert.fail("request body must be a string or Uint8Array");
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

test("native RPC preserves exact target, VALUE-TYPE, RawXml and result typing", async () => {
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

test("RPC distinguishes an existing empty typed string from a missing Result", async () => {
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
      await assert.rejects(session.rpc.call({ target: "tools.get_version" }), /missing Result/);
    } finally {
      await session.close();
      client.close();
    }
  }
});

test("web get_app_info and page getUrl use exact query and preserve a non-empty stream", async () => {
  const pageBody = "non-empty page body";
  const seen: string[] = [];
  const client = new WsHcmClient({
    baseUrl: "http://wt.test/",
    auth: { username: "user", password: "secret" },
    fetch: webLifecycle((url, init) => {
      if (url.pathname === "/api/spxml2/get_app_info") {
        seen.push("app-info");
        assert.equal(init.method ?? "GET", "GET");
        assert.equal(url.search, "?fast_start=1&anonymous=1&open_session=1&rnd=123");
        return Response.json({ Success: 1 });
      }
      if (url.pathname === "/spxml_web/service/get_url.htm") {
        seen.push("page-get-url");
        assert.equal(init.method ?? "GET", "GET");
        assert.equal(
          url.search,
          "?url=x-local%3A%2F%2Fwt%2Ffile.txt&navigate=1&download=1&base64=1",
        );
        return new Response(pageBody, {
          status: 200,
          headers: { "content-type": "application/octet-stream" },
        });
      }
      return undefined;
    }),
  });

  await client.withWebSession(async (session) => {
    await session.spxml2.getAppInfo({
      fastStart: true,
      anonymous: true,
      openSession: true,
      rnd: 123,
    });
    const response = await session.pages.getUrl({
      url: "x-local://wt/file.txt",
      navigate: true,
      download: true,
      base64: true,
    });
    assert.equal(response.status, 200);
    assert.ok(response.body, "getUrl must retain a readable response body");
    assert.equal(await new Response(response.body).text(), pageBody);
  });
  assert.deepEqual(seen, ["app-info", "page-get-url"]);
});

test("async lifecycle preserves 1171 hexadecimal TrackingID lexical form", async () => {
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

test("native streaming XML parameters use exact multipart XOP framing", async () => {
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

test("native XOP preserves exact binary PutUrl data", async () => {
  const expected = Uint8Array.of(0, 255, 13, 10, 60, 38);
  const seen: string[] = [];

  function indexOfBytes(source: Uint8Array, part: Uint8Array): number {
    outer: for (let index = 0; index <= source.length - part.length; index += 1) {
      for (let offset = 0; offset < part.length; offset += 1) {
        if (source[index + offset] !== part[offset]) continue outer;
      }
      return index;
    }
    return -1;
  }

  const client = new WsHcmClient({
    baseUrl: "http://wt.test/",
    auth: { username: "user", password: "secret" },
    fetch: nativeLifecycle((url, init) => {
      if (url.pathname !== "/services/LdsService") return undefined;
      const body = bodyText(init);
      if (!body.includes("<PutUrl")) return undefined;
      const bytes = bodyBytes(init);

      const contentType = new Headers(init.headers).get("content-type") ?? "";
      const boundary = /boundary="([^"]+)"/.exec(contentType)?.[1];
      const contentId = /href="cid:(0x[0-9a-f]+)"/.exec(body)?.[1];
      assert.ok(boundary);
      assert.ok(contentId);

      assert.match(
        body,
        /<PutUrl[^>]*><Url>x-local:\/\/wt\/file\.bin<\/Url><SessionID>42<\/SessionID><Data><xop:Include[^>]+\/><\/Data><\/PutUrl>/,
      );

      const attachmentHeader = new TextEncoder().encode(
        `\r\n--${boundary}\r\nContent-ID: ${contentId}\r\n\r\n`,
      );
      const footer = new TextEncoder().encode(`\r\n--${boundary}--\r\n`);
      const start = indexOfBytes(bytes, attachmentHeader);
      assert.notEqual(start, -1);
      assert.deepEqual(bytes.subarray(bytes.length - footer.length), footer);
      assert.deepEqual(
        bytes.subarray(start + attachmentHeader.length, bytes.length - footer.length),
        expected,
      );
      seen.push("PutUrl");
      return soap("PutUrl");
    }),
  });

  await client.withNativeSession(async (session) => {
    await session.lds.putUrl({ url: "x-local://wt/file.bin", data: expected });
  });
  assert.deepEqual(seen, ["PutUrl"]);
});

test("native streaming flags preserve mocked LoadUrl and LoadDoc bodies as streams", async () => {
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

test("streaming SOAP errors parse small faults and cancel oversized bodies", async () => {
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

test("buffered web XML honors response charset and GetDoc request fallback", async () => {
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
      if (url.pathname === "/api/spxml/GetDoc") {
        return new Response(encodedXml("document"), { headers: { "content-type": "text/xml" } });
      }
      return undefined;
    }),
  });

  await client.withWebSession(async (session) => {
    assert.match(JSON.stringify((await session.pages.getUiText()).data), /Привет/);
    assert.match(
      JSON.stringify(
        (await session.spxml.getDoc({ docUrl: "x-local://wt/doc.xml", charset: "windows-1251" }))
          .data,
      ),
      /Привет/,
    );
  });
});

test("web PutDoc rejects DTD/entity input and exposes only shipped persistence flags", async () => {
  let putCalls = 0;
  const client = new WsHcmClient({
    baseUrl: "http://wt.test/",
    auth: { username: "user", password: "secret" },
    fetch: webLifecycle((url, init) => {
      if (url.pathname === "/api/spxml/PutDoc") {
        putCalls += 1;
        assert.equal(
          url.search,
          "?DocUrl=x-local%3A%2F%2Fwt%2Fdoc.xml&WriteDocInfo=false&NeverSaved=1",
        );
        assert.doesNotMatch(url.search, /SkipActions/);
        assert.equal(bodyText(init), "<doc><id>1</id></doc>");
        return Response.json({ Success: 1 });
      }
      return undefined;
    }),
  });

  await client.withWebSession(async (session) => {
    await assert.rejects(
      session.spxml.putDoc({
        docUrl: "x-local://wt/doc.xml",
        document: '<!DOCTYPE doc [<!ENTITY secret "value">]><doc>&secret;</doc>',
      }),
      /Объявления DOCTYPE и ENTITY в XML не допускаются/,
    );
    await session.spxml.putDoc({
      docUrl: "x-local://wt/doc.xml",
      document: rawXml("<doc><id>1</id></doc>"),
      writeDocInfo: false,
      neverSaved: true,
    });
  });
  assert.equal(putCalls, 1);
});

test("bare SOAP Fault becomes a bounded soap-fault error", async () => {
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

test("SOAP 1.2 Fault reason and code are preserved", async () => {
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

test("application Fault elements are not treated as SOAP faults", async () => {
  const client = new WsHcmClient({
    baseUrl: "http://wt.test/",
    auth: { username: "user", password: "secret" },
    fetch: nativeLifecycle((url, init) => {
      if (url.pathname !== "/services/LdsService" || !bodyText(init).includes("<GetCatalogsStat"))
        return undefined;
      return soap(
        "GetCatalogsStat",
        "<ResultData><Fault><message>application value</message></Fault></ResultData>",
      );
    }),
  });

  await client.withNativeSession(async (session) => {
    const response = await session.lds.getCatalogsStat();
    assert.match(JSON.stringify(response.data), /application value/);
  });
});

test("SOAP success response must be a direct Body child", async () => {
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
        /Missing OpenSessionResponse/.test(error.message),
    );
  }
});

test("SOAP fault messages are bounded and redact common secret fields", async () => {
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

test("plain operation Error remains primary when cleanup also fails", async () => {
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

test("transport rejects embedded credentials and cross-origin experimental requests before fetch", async () => {
  assert.throws(
    () => new WsHcmClient({ baseUrl: "http://user:password@wt.test/" }),
    /without embedded credentials/,
  );

  let fetchCalls = 0;
  const client = new WsHcmClient({
    baseUrl: "http://wt.test/",
    fetch: (async () => {
      fetchCalls += 1;
      return new Response("unexpected");
    }) as typeof globalThis.fetch,
  });
  await assert.rejects(
    client.experimental.rawRequest({ unsafe: false as true, path: "/xhttp_info" }),
    (error: unknown) => error instanceof WsHcmApiError && error.kind === "protocol",
  );
  await assert.rejects(
    client.experimental.rawRequest({ unsafe: true, path: "http://other.test/xhttp_info" }),
    (error: unknown) => error instanceof WsHcmApiError && error.kind === "protocol",
  );
  await assert.rejects(
    client.experimental.rawRequest({ unsafe: true, path: "http://user:secret@wt.test/xhttp_info" }),
    (error: unknown) => error instanceof WsHcmApiError && error.kind === "protocol",
  );
  assert.equal(fetchCalls, 0);
});

test("transport sets Node duplex for ReadableStream bodies", async () => {
  let duplex: unknown;
  const client = new WsHcmClient({
    baseUrl: "http://wt.test/",
    fetch: (async (input, init) => {
      duplex = (init as RequestInit & { duplex?: unknown }).duplex;
      const request = new Request(input, init);
      await request.body?.cancel();
      return new Response("ok");
    }) as typeof globalThis.fetch,
  });
  const response = await client.experimental.rawRequest({
    unsafe: true,
    path: "/upload",
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
});

test("diagnostics uses optional Basic authentication when credentials exist", async () => {
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

test("web lifecycle attempts logout2 after logout failure and remains idempotent", async () => {
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

test("transport and web experimental regressions preserve errors, secrets and required URLs", async () => {
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
  const raw = new WsHcmClient({
    baseUrl: "http://wt.test/",
    fetch: (async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
        { status: 500 },
      )) as typeof globalThis.fetch,
  });
  await assert.rejects(
    raw.experimental.rawRequest({ unsafe: true, path: "/failure" }),
    (error: unknown) =>
      error instanceof WsHcmApiError && error.kind === "http" && error.status === 500,
  );
  assert.equal(cancelled, true);

  const token = "private-auth-token";
  const seen: string[] = [];
  const web = new WsHcmClient({
    baseUrl: "http://wt.test/",
    auth: { username: "user", password: "secret" },
    fetch: webLifecycle((url, init) => {
      if (url.pathname === "/api/spxml2/authenticate") {
        seen.push("authenticate");
        assert.equal(init.method, "POST");
        assert.equal(url.search, "");
        assert.doesNotMatch(url.href, new RegExp(token));
        assert.equal(new Headers(init.headers).get("content-type"), "application/json");
        assert.deepEqual(JSON.parse(bodyText(init)), {
          login: "login",
          password: "password",
          token,
        });
        return Response.json({ Success: 1 });
      }
      if (url.pathname === "/api/spxml2/get_image") {
        seen.push("image");
        assert.equal(init.method ?? "GET", "GET");
        assert.equal(url.search, "?url=x-local%3A%2F%2Fwt%2Frequired.png&width=120");
        return new Response("image-body", { status: 200 });
      }
      return undefined;
    }),
  });

  await web.withWebSession(async (session) => {
    await session.experimental.authenticate({ login: "login", password: "password", token });
    const image = await session.spxml2.getImage({
      url: "x-local://wt/required.png",
      effects: { url: "x-local://wt/override.png", width: 120 },
    });
    assert.equal(await new Response(image.body).text(), "image-body");
  });
  assert.deepEqual(seen, ["authenticate", "image"]);
});
