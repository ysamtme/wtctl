import assert from "node:assert/strict";
import { test } from "node:test";

import {
  NativePhysicalDocumentsApi,
  WsHcmApiError,
  WsHcmClient,
  buildXml,
  rawXml,
  resolvePhysicalDocumentLocation,
} from "../../src/protocol/index.js";

function bodyText(init: RequestInit): string {
  if (typeof init.body === "string") return init.body;
  if (init.body instanceof Uint8Array) return new TextDecoder().decode(init.body);
  return "";
}

function soap(method: string, inner = ""): Response {
  return new Response(
    `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope/"><soap:Body><${method}Response xmlns="http://www.datex-soft.com/">${inner}</${method}Response></soap:Body></soap:Envelope>`,
    { status: 200, headers: { "content-type": "application/soap+xml" } },
  );
}

function lifecycle(
  handler: (method: string, body: string) => Response | undefined,
): typeof globalThis.fetch {
  return (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const body = bodyText(init);
    if (url.pathname === "/services/LdsService") {
      const method = /<([A-Z][A-Za-z0-9]+)(?:\s|>)/.exec(body)?.[1];
      assert.ok(method);
      const handled = handler(method, body);
      if (handled !== undefined) return handled;
      if (method === "OpenSession") return soap("OpenSession", "<SessionID>42</SessionID>");
      if (method === "CloseSession") return soap("CloseSession");
    }
    if (url.pathname === "/loggedoff.html") return new Response("", { status: 200 });
    assert.fail(`unexpected request: ${init.method ?? "GET"} ${url.pathname}`);
  }) as typeof globalThis.fetch;
}

test("физическое расположение сохраняет ID bigint и обе штатные раскладки путей", () => {
  assert.deepEqual(resolvePhysicalDocumentLocation("123"), {
    objectId: "123",
    url: "x-local://wt_data/objects/0001/23.xml",
  });
  assert.deepEqual(resolvePhysicalDocumentLocation("3999999999"), {
    objectId: "3999999999",
    url: "x-local://wt_data/objects/39999999/99.xml",
  });
  assert.deepEqual(resolvePhysicalDocumentLocation("4000000000"), {
    objectId: "0x00000000EE6B2800",
    url: "x-local://wt_data/objects/00000000EE6B28/00.xml",
  });
  assert.deepEqual(resolvePhysicalDocumentLocation("0x28865C2947AC3BF9"), {
    objectId: "0x28865C2947AC3BF9",
    url: "x-local://wt_data/objects/28865C2947AC3B/F9.xml",
  });
});

test("physicalDocuments.createFromXml отклоняет неверный dbName до выделения ID", async () => {
  let allocations = 0;
  const api = new NativePhysicalDocumentsApi({
    async getNewObjectId() {
      allocations += 1;
      throw new Error("must not allocate");
    },
  } as never);
  await assert.rejects(
    api.createFromXml({
      dbName: "../wt_data",
      document: () => rawXml("<collaborator><id>1</id></collaborator>"),
    }),
    /dbName: нужно имя базы/,
  );
  assert.equal(allocations, 0);
});

test("physicalDocuments.createFromXml выполняет по порядку выделение ID, XOP PutDoc и проверку LoadDoc", async () => {
  const calls: string[] = [];
  const client = new WsHcmClient({
    baseUrl: "http://wt.test/",
    auth: { username: "user", password: "secret" },
    fetch: lifecycle((method, body) => {
      if (method === "GetNewObjectID") {
        calls.push(method);
        assert.match(body, /<DbName>wt_data<\/DbName><SessionID>42<\/SessionID>/);
        return soap(method, "<ObjectID>123</ObjectID>");
      }
      if (method === "PutDoc") {
        calls.push(method);
        assert.match(body, /<Url>x-local:\/\/wt_data\/objects\/0001\/23\.xml<\/Url>/);
        assert.match(body, /<WriteDocInfo>true<\/WriteDocInfo><NeverSaved>true<\/NeverSaved>/);
        assert.doesNotMatch(body, /<SkipActions>/);
        assert.match(
          body,
          /<collaborator>\s*<id>123<\/id>\s*<code>PHYSICAL<\/code>\s*<\/collaborator>/,
        );
        return soap(method);
      }
      if (method === "LoadDoc") {
        calls.push(method);
        assert.match(body, /<Url>x-local:\/\/wt_data\/objects\/0001\/23\.xml<\/Url>/);
        return soap(
          method,
          "<Data><collaborator><id>123</id><code>PHYSICAL</code></collaborator></Data>",
        );
      }
      return undefined;
    }),
  });

  const created = await client.withNativeSession((session) =>
    session.physicalDocuments.createFromXml({
      document: ({ objectId }) =>
        rawXml(buildXml({ collaborator: { id: objectId, code: "PHYSICAL" } })),
    }),
  );

  assert.equal(created.objectId, "123");
  assert.equal(created.url, "x-local://wt_data/objects/0001/23.xml");
  assert.equal(created.putResponse.status, 200);
  assert.equal(created.loadResponse.status, 200);
  assert.deepEqual(calls, ["GetNewObjectID", "PutDoc", "LoadDoc"]);
});

test("physicalDocuments.createFromXml отдаёт флаги native server-action и document-info", async () => {
  const client = new WsHcmClient({
    baseUrl: "http://wt.test/",
    auth: { username: "user", password: "secret" },
    fetch: lifecycle((method, body) => {
      if (method === "GetNewObjectID") return soap(method, "<ObjectID>123</ObjectID>");
      if (method === "PutDoc") {
        assert.match(
          body,
          /<WriteDocInfo>false<\/WriteDocInfo><SkipActions>true<\/SkipActions><NeverSaved>false<\/NeverSaved>/,
        );
        return soap(method);
      }
      if (method === "LoadDoc")
        return soap(method, "<Data><collaborator><id>123</id></collaborator></Data>");
      return undefined;
    }),
  });

  await client.withNativeSession((session) =>
    session.physicalDocuments.createFromXml({
      writeDocInfo: false,
      skipActions: true,
      neverSaved: false,
      document: ({ objectId }) => rawXml(`<collaborator><id>${objectId}</id></collaborator>`),
    }),
  );
});

test("physicalDocuments.createFromXml требует один корень и один прямой id до PutDoc", async () => {
  const calls: string[] = [];
  const client = new WsHcmClient({
    baseUrl: "http://wt.test/",
    auth: { username: "user", password: "secret" },
    fetch: lifecycle((method) => {
      if (method === "GetNewObjectID") {
        calls.push(method);
        return soap(method, "<ObjectID>123</ObjectID>");
      }
      return undefined;
    }),
  });

  await client.withNativeSession(async (session) => {
    await assert.rejects(
      session.physicalDocuments.createFromXml({
        document: ({ objectId }) =>
          rawXml(
            `<collaborator><access><id>${objectId}</id></access><id>WRONG</id></collaborator>`,
          ),
      }),
      /id в XML должен совпадать с выданным ID объекта/,
    );
    await assert.rejects(
      session.physicalDocuments.createFromXml({
        document: ({ objectId }) =>
          rawXml(`<collaborator><id>${objectId}</id><id>${objectId}</id></collaborator>`),
      }),
      /один корневой элемент и в нём ровно один элемент id/,
    );
  });
  assert.deepEqual(calls, ["GetNewObjectID", "GetNewObjectID"]);
});

test("physicalDocuments.createFromXml удаляет возможный частичный документ при сбое проверки", async () => {
  const calls: string[] = [];
  const client = new WsHcmClient({
    baseUrl: "http://wt.test/",
    auth: { username: "user", password: "secret" },
    fetch: lifecycle((method, body) => {
      if (method === "GetNewObjectID") {
        calls.push(method);
        return soap(method, "<ObjectID>123</ObjectID>");
      }
      if (method === "PutDoc") {
        calls.push(method);
        return soap(method);
      }
      if (method === "LoadDoc") {
        calls.push(method);
        return new Response(
          "<Fault><faultcode>Server</faultcode><faultstring>verification failed</faultstring></Fault>",
          {
            status: 500,
            headers: { "content-type": "application/soap+xml" },
          },
        );
      }
      if (method === "DeleteDoc") {
        calls.push(method);
        assert.match(body, /<StrictDelete>false<\/StrictDelete>/);
        return soap(method);
      }
      return undefined;
    }),
  });

  await assert.rejects(
    client.withNativeSession((session) =>
      session.physicalDocuments.createFromXml({
        document: ({ objectId }) => rawXml(`<collaborator><id>${objectId}</id></collaborator>`),
      }),
    ),
    (error: unknown) =>
      error instanceof WsHcmApiError &&
      error.kind === "soap-fault" &&
      error.message === "verification failed",
  );
  assert.deepEqual(calls, ["GetNewObjectID", "PutDoc", "LoadDoc", "DeleteDoc"]);
});

test("physicalDocuments.createFromXml отклоняет неверный id корня загруженного документа и удаляет документ", async () => {
  const calls: string[] = [];
  const client = new WsHcmClient({
    baseUrl: "http://wt.test/",
    auth: { username: "user", password: "secret" },
    fetch: lifecycle((method) => {
      if (method === "GetNewObjectID") {
        calls.push(method);
        return soap(method, "<ObjectID>123</ObjectID>");
      }
      if (method === "PutDoc") {
        calls.push(method);
        return soap(method);
      }
      if (method === "LoadDoc") {
        calls.push(method);
        return soap(method, "<Data><collaborator><id>999</id></collaborator></Data>");
      }
      if (method === "DeleteDoc") {
        calls.push(method);
        return soap(method);
      }
      return undefined;
    }),
  });

  await assert.rejects(
    client.withNativeSession((session) =>
      session.physicalDocuments.createFromXml({
        document: ({ objectId }) => rawXml(`<collaborator><id>${objectId}</id></collaborator>`),
      }),
    ),
    (error: unknown) =>
      error instanceof WsHcmApiError &&
      error.kind === "protocol" &&
      error.operation === "LoadDoc" &&
      error.status === 200 &&
      error.message === "ID загруженного документа не совпадает с выделенным objectId",
  );
  assert.deepEqual(calls, ["GetNewObjectID", "PutDoc", "LoadDoc", "DeleteDoc"]);
});

test("вложенные сбои очистки документа и сессии остаются привязанными к основной ошибке", async () => {
  const client = new WsHcmClient({
    baseUrl: "http://wt.test/",
    auth: { username: "user", password: "secret" },
    fetch: lifecycle((method) => {
      if (method === "GetNewObjectID") return soap(method, "<ObjectID>123</ObjectID>");
      if (method === "PutDoc") return soap(method);
      if (method === "LoadDoc")
        return soap(method, "<Data><collaborator><id>999</id></collaborator></Data>");
      if (method === "DeleteDoc" || method === "CloseSession") {
        return new Response("<Fault><faultstring>cleanup failed</faultstring></Fault>", {
          status: 500,
          headers: { "content-type": "application/soap+xml" },
        });
      }
      return undefined;
    }),
  });

  await assert.rejects(
    client.withNativeSession((session) =>
      session.physicalDocuments.createFromXml({
        document: ({ objectId }) => rawXml(`<collaborator><id>${objectId}</id></collaborator>`),
      }),
    ),
    (error: unknown) => {
      assert.ok(error instanceof WsHcmApiError);
      assert.equal(error.kind, "protocol");
      assert.ok(error.cleanupError instanceof AggregateError);
      assert.equal(error.cleanupError.errors.length, 2);
      assert.ok(
        error.cleanupError.errors.every(
          (item) => item instanceof WsHcmApiError && item.kind === "cleanup",
        ),
      );
      return true;
    },
  );
});
