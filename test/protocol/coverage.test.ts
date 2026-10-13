import assert from "node:assert/strict";
import { test } from "node:test";
import { WsHcmClient, rawXml, rpc, type WsHcmBinaryResponse } from "../../src/protocol/index.js";
import { WIRE_CONTRACT, WIRE_CONTRACT_BY_ID, type WireOperationId } from "./wire-contract.js";

const encoder = new TextEncoder();

function requestBody(init: RequestInit): string {
  if (typeof init.body === "string") return init.body;
  if (init.body instanceof Uint8Array) return new TextDecoder().decode(init.body);
  if (init.body instanceof URLSearchParams) return init.body.toString();
  return "";
}

function soapResponse(method: string, inner = ""): Response {
  return new Response(
    `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope/"><soap:Body><${method}Response xmlns="http://www.datex-soft.com/">${inner}</${method}Response></soap:Body></soap:Envelope>`,
    { status: 200, headers: { "content-type": "application/soap+xml" } },
  );
}

function responseFor(url: URL, init: RequestInit, operationId?: WireOperationId): Response {
  const body = requestBody(init);
  const soapMethod = /<soap:Body><([A-Za-z0-9]+)/.exec(body)?.[1];
  if (soapMethod !== undefined) {
    const inner =
      soapMethod === "OpenSession"
        ? "<SessionID>42</SessionID>"
        : soapMethod === "CallMethod"
          ? '<ResultData><Result VALUE-TYPE="string">ok</Result></ResultData>'
          : soapMethod === "CallMethodAsync"
            ? "<TrackingID>71</TrackingID>"
            : "";
    return soapResponse(soapMethod, inner);
  }
  if (url.pathname === "/spxml_web/main.htm") {
    return new Response('<script>gFaApp.webSessionToken = "page-token";</script>', {
      status: 200,
      headers: { "set-cookie": "SessionID=web-cookie; Path=/" },
    });
  }
  if (url.pathname === "/admin")
    return new Response(null, { status: 301, headers: { location: "/spxml_web/main.htm" } });
  if (url.pathname === "/spxml_web/logout.htm")
    return new Response(null, { status: 302, headers: { location: "/spxml_web/logout2.htm" } });
  if (url.pathname === "/spxml_web/logout2.htm") return new Response("", { status: 401 });
  if (
    url.pathname === "/api/spxml/GetDoc" ||
    url.pathname.endsWith("create_doc.htm") ||
    url.pathname.endsWith("get_ui_text.htm")
  ) {
    return new Response("<root/>", { status: 200, headers: { "content-type": "text/xml" } });
  }
  if (
    url.pathname === "/api/spxml/PutDoc" ||
    url.pathname === "/api/spxml/PutLargeField" ||
    url.pathname === "/api/spxml/PutLargeFieldFromUrl" ||
    url.pathname === "/api/spxml2/get_app_info" ||
    url.pathname === "/api/spxml2/std_encrypt"
  ) {
    return Response.json({ Success: 1 });
  }
  if (operationId?.includes("resource") || url.pathname.endsWith("get_image")) {
    return new Response(encoder.encode("binary"), {
      status: 200,
      headers: { "content-type": "application/octet-stream" },
    });
  }
  return new Response("ok", { status: 200 });
}

async function cancel(response: WsHcmBinaryResponse): Promise<void> {
  await response.body?.cancel();
}

test("all 53 supported operation units construct a request through a public method", async () => {
  const pending: WireOperationId[] = [];
  const covered = new Set<WireOperationId>();
  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const operationId = pending.shift();
    if (operationId === undefined) {
      const cleanup =
        url.pathname === "/loggedoff.html" ||
        url.pathname === "/spxml_web/logout.htm" ||
        url.pathname === "/spxml_web/logout2.htm" ||
        /<CloseSession\b/.test(requestBody(init));
      assert.ok(cleanup, `unexpected untracked request: ${init.method ?? "GET"} ${url.pathname}`);
      return responseFor(url, init);
    }

    const metadata = WIRE_CONTRACT_BY_ID[operationId];
    assert.equal(init.method ?? "GET", metadata.httpMethod, `${operationId} HTTP method`);
    assert.equal(url.pathname, metadata.pathTemplate.split("?", 1)[0], `${operationId} path`);
    if (metadata.transportId === "http-soap")
      assert.match(
        requestBody(init),
        new RegExp(`<${metadata.operationName}\\b`),
        `${operationId} SOAP operation`,
      );
    if (operationId === "web-spxml2-get-app-info") {
      assert.equal(url.searchParams.get("fast_start"), "1");
      assert.match(url.searchParams.get("rnd") ?? "", /^\d+$/);
    }
    covered.add(operationId);
    return responseFor(url, init, operationId);
  };

  const cover = async <T>(
    ids: WireOperationId | readonly WireOperationId[],
    action: () => Promise<T>,
  ): Promise<T> => {
    assert.equal(pending.length, 0);
    pending.push(...(typeof ids === "string" ? [ids] : ids));
    const value = await action();
    assert.equal(pending.length, 0, `public method did not construct: ${pending.join(", ")}`);
    return value;
  };

  const client = new WsHcmClient({
    baseUrl: "http://wt.test/",
    auth: { username: "user", password: "secret" },
    fetch,
  });
  const fragment = rawXml("<value>data</value>");

  await cover("native-xhttp-info", () => client.diagnostics.xhttpInfo());
  const native = await cover("native-lds-open-session", () => client.openNativeSession());
  await cover("native-lds-get-catalogs-stat", () => native.lds.getCatalogsStat());
  await cover("native-lds-get-mod-objects", () =>
    native.lds.getModObjects({ minModDate: "2025-01-01" }),
  );
  await cover("native-lds-get-mod-deleted-objects", () =>
    native.lds.getModDeletedObjects({ minModDate: "2025-01-01" }),
  );
  await cover("native-lds-load-url", () =>
    native.lds.loadUrl({ url: "x-local://wt/web/webtutor.wtv" }),
  );
  await cover("native-lds-put-url", () =>
    native.lds.putUrl({ url: "x-local://wt/test.xml", data: fragment }),
  );
  await cover("native-lds-delete-url", () =>
    native.lds.deleteUrl({ url: "x-local://wt/test.xml" }),
  );
  await cover("native-lds-create-doc", () =>
    native.lds.createDoc({ objectTypeId: "collaborator" }),
  );
  await cover("native-lds-load-doc", () =>
    native.lds.loadDoc({ url: "x-local://wt/web/webtutor.wtv" }),
  );
  await cover("native-lds-put-doc", () =>
    native.lds.putDoc({ url: "x-local://wt/test.xml", data: fragment }),
  );
  await cover("native-lds-delete-doc", () =>
    native.lds.deleteDoc({ url: "x-local://wt/test.xml" }),
  );
  await cancel(
    await cover("native-lds-load-large-field", () =>
      native.lds.loadLargeField({ docUrl: "x-db-obj://wt/fixture/1.xml", fieldId: "1" }),
    ),
  );
  await cover("native-lds-put-large-field", () =>
    native.lds.putLargeField({
      docUrl: "x-db-obj://wt/fixture/1.xml",
      fieldId: "1",
      data: fragment,
    }),
  );
  await cover("native-lds-delete-large-field", () =>
    native.lds.deleteLargeField({ docUrl: "x-db-obj://wt/fixture/1.xml", fieldId: "1" }),
  );
  await cover("native-lds-get-new-object-id", () => native.lds.getNewObjectId({ dbName: "main" }));
  await cover("native-lds-xquery", () =>
    native.lds.xQuery({ query: "for $x in collaborators return $x" }),
  );
  await cover("native-lds-release-cursor", () => native.lds.releaseCursor("9"));
  await cover("native-lds-run-method", () =>
    native.lds.runMethod({ libName: "tools", methodName: "method", argData: fragment }),
  );
  await cover("native-lds-idle", () => native.lds.idle());
  await cover("native-spxml-call-method", () =>
    native.rpc.call({ target: "tools.get_version", args: [rpc.string("wtv")] }),
  );
  await cover("native-spxml2-get-app-info", () => native.spxml2.getAppInfo());
  await cover("native-spxml2-get-form", () =>
    native.spxml2.getForm({ url: "x-app://wt/form.xml" }),
  );
  await cancel(
    await cover("native-resource-lds-get-resource-image", () =>
      native.resources.getImage({ resourceId: "1" }),
    ),
  );
  await cover("native-lds-close-session", () => native.close());

  const web = await cover(["web-main-page", "web-lds-open-session"], () => client.openWebSession());
  await cover("web-admin-alias", () => web.lifecycle.admin());
  await cover("web-lds-xquery", () =>
    web.lds.xQuery({ query: "for $x in collaborators return $x" }),
  );
  await cover("web-lds-release-cursor", () => web.lds.releaseCursor("10"));
  await cover("web-lds-delete-doc", () => web.lds.deleteDoc({ url: "x-local://wt/test.xml" }));
  await cover("web-spxml-call-method", () => web.spxml.callMethod({ target: "tools.get_version" }));
  await cover("web-spxml-call-method-async", () =>
    web.spxml.callMethodAsync({ target: "tools.get_version" }),
  );
  await cover("web-spxml-get-async-method-status", () => web.spxml.getAsyncMethodStatus("71"));
  await cover("web-spxml-kill-async-method", () => web.spxml.killAsyncMethod("71"));
  await cover("web-spxml-get-doc", () => web.spxml.getDoc({ docUrl: "x-local://wt/test.xml" }));
  await cover("web-spxml-put-doc", () =>
    web.spxml.putDoc({ docUrl: "x-local://wt/test.xml", document: "<doc/>" }),
  );
  await cover("web-spxml-put-large-field", () =>
    web.spxml.putLargeField({
      docUrl: "x-db-obj://wt/fixture/1.xml",
      fieldId: "1",
      fieldPathname: "body",
      contentType: "text/plain",
      body: "data",
    }),
  );
  await cover("web-spxml-put-large-field-from-url", () =>
    web.spxml.putLargeFieldFromUrl({
      docUrl: "x-db-obj://wt/fixture/1.xml",
      fieldId: "1",
      fieldPathname: "body",
      srcUrl: "x-local://wt/source.txt",
    }),
  );
  await cover("web-spxml2-get-app-info", () => web.spxml2.getAppInfo({ fastStart: true }));
  await cover("web-spxml2-get-form", () => web.spxml2.getForm({ url: "x-app://wt/form.xml" }));
  await cancel(
    await cover("web-spxml2-get-image", () =>
      web.spxml2.getImage({ url: "x-local://wt/image.png" }),
    ),
  );
  await cover("web-spxml2-get-preloaded-design-files", () => web.spxml2.getPreloadedDesignFiles());
  await cover("web-spxml2-std-encrypt", () => web.spxml2.stdEncrypt("value"));
  await cover("web-page-create-doc-htm", () =>
    web.pages.createDoc({ objectTypeId: "collaborator" }),
  );
  await cover("web-page-file-preview-pdf-htm", () => web.pages.filePreviewPdf());
  await cover("web-page-get-form-htm", () => web.pages.getForm({ url: "x-app://wt/form.xml" }));
  await cover("web-page-get-screen-form-htm", () =>
    web.pages.getScreenForm({ url: "x-app://wt/form.xml" }),
  );
  await cover("web-page-get-ui-text-htm", () => web.pages.getUiText());
  await cancel(
    await cover("web-page-get-url-htm", () => web.pages.getUrl({ url: "x-local://wt/a" })),
  );
  await cancel(
    await cover("web-resource-lds-get-resource-image", () =>
      web.resources.getImage({ resourceId: "1" }),
    ),
  );
  await cover(["web-logout-page", "web-logout2-page"], () => web.lifecycle.logout());
  await web.close();

  assert.equal(covered.size, 53);
  assert.deepEqual([...covered].sort(), WIRE_CONTRACT.map(({ id }) => id).sort());
});
