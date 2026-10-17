import assert from "node:assert/strict";
import { test } from "node:test";
import { HcmRuntime } from "../src/runtime.js";
import { NativeGateway } from "../src/native/index.js";
import { RpcApi, rpc } from "../src/protocol/api.js";
import { HttpTransport } from "../src/protocol/transport.js";
import { rawXml } from "../src/protocol/xml.js";

const element =
  '<remote_collection SPXML-FORM="x-local://wtv/wtv_remote_collection.xmd" SPXML-FORM-ELEM="remote_collection"><script>RESULT=[{value:42}];</script></remote_collection>';
const base = {
  baseUrl: "http://fixture.invalid/",
  username: "fixture",
  password: "fixture",
  timeoutMs: 1000,
  maxResponseBytes: 1024 * 1024,
};
function mock() {
  const bodies: string[] = [];
  const fetch: typeof globalThis.fetch = async (_input, init) => {
    const body =
      init?.body instanceof Uint8Array
        ? new TextDecoder().decode(init.body)
        : String(init?.body ?? "");
    bodies.push(body);
    const method = /<soap:Body><([A-Za-z]+)/.exec(body)?.[1] ?? "OpenSession";
    const content =
      method === "OpenSession"
        ? "<SessionID>42</SessionID>"
        : method === "CallMethod"
          ? '<Result VALUE-TYPE="integer">42</Result>'
          : "";
    return new Response(
      `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope/"><soap:Body><${method}Response>${content}</${method}Response></soap:Body></soap:Envelope>`,
      {
        headers: { "content-type": "application/soap+xml", "set-cookie": "SessionID=fixture-auth" },
      },
    );
  };
  return { bodies, fetch };
}

test("структурные аргументы RPC типа XmElem сохраняют вложенный XML без выдуманного VALUE-TYPE", async () => {
  const fixture = mock();
  const transport = new HttpTransport({ ...base, fetch: fixture.fetch });
  try {
    const api = new RpcApi(transport, "native");
    await api.call({
      target: "fixture.accept_xml",
      args: [rpc.xml(rawXml(element)), rpc.string("<&")],
    });
    assert.ok(fixture.bodies[0]!.includes(`<arg-0>${element}</arg-0>`));
    assert.ok(fixture.bodies[0]!.includes('<arg-1 VALUE-TYPE="string">&lt;&amp;</arg-1>'));
    assert.doesNotMatch(fixture.bodies[0]!, /VALUE-TYPE="XmElem"/);
    for (const source of ["<a/><b/>", "<a></a> <b/>", "<a><a/></a><b/>", "<![CDATA[x]]><a/>"])
      assert.throws(() => rpc.xml(rawXml(source)), /ровно одним элементом/, source);
    // Закрывающий тег внутри CDATA, комментария или вложенного элемента с тем же именем не конец корня.
    for (const source of ["<a><a>x</a></a>", "<a><![CDATA[</a>]]></a>", "<a><!-- </a> --></a>"])
      assert.doesNotThrow(() => rpc.xml(rawXml(source)), source);
  } finally {
    transport.dispose();
  }
});

test("общий runtime поддерживает RPC с упакованным XmElem и отклоняет неоднозначный XML до любого HTTP", async () => {
  for (const source of ["<a/><b/>", "<a/><a/>", "literal", "<a>&#0;</a>"]) {
    const fixture = mock();
    const gateway = new NativeGateway({ ...base, fetch: fixture.fetch });
    try {
      await assert.rejects(
        gateway.call("native.rpc.call", {
          target: "fixture.accept_xml",
          args: [{ lexicalValue: { xml: source } }],
        }),
      );
      assert.equal(fixture.bodies.length, 0);
    } finally {
      await gateway.close();
    }
  }
  const fixture = mock();
  const runtime = new HcmRuntime({
    ...base,
    fetch: fixture.fetch,
    name: "fixture",
    runtimeDir: ".runtime",
    outputLimitBytes: 24000,
    permissions: { write: false, execute: true },
  });
  try {
    const result = await runtime.call("rpc.call", {
      library: "fixture",
      method: "accept_xml",
      arguments: [{ lexicalValue: { xml: element } }],
    });
    assert.equal(result.ok, true);
    const call = fixture.bodies.find((body) => body.includes("<CallMethod "))!;
    assert.ok(call.includes(`<arg-0>${element}</arg-0>`));
    assert.doesNotMatch(call, /VALUE-TYPE="XmElem"/);
  } finally {
    await runtime.close();
  }
});

test("удобные булевы значения RPC записываются как 0/1 в SP-XML, а явно заданный типизированный ввод сохраняется как записан", async () => {
  const fixture = mock();
  const runtime = new HcmRuntime({
    ...base,
    fetch: fixture.fetch,
    name: "fixture",
    runtimeDir: ".runtime",
    outputLimitBytes: 24000,
    permissions: { write: false, execute: true },
  });
  try {
    const result = await runtime.call("rpc.call", {
      library: "fixture",
      method: "accept_booleans",
      arguments: [false, true, { valueType: "string", lexicalValue: "false" }],
    });
    assert.equal(result.ok, true);
    const call = fixture.bodies.find((body) => body.includes("<CallMethod "))!;
    assert.ok(call.includes('<arg-0 VALUE-TYPE="bool">0</arg-0>'));
    assert.ok(call.includes('<arg-1 VALUE-TYPE="bool">1</arg-1>'));
    assert.ok(call.includes('<arg-2 VALUE-TYPE="string">false</arg-2>'));
    assert.doesNotMatch(call, /VALUE-TYPE="bool">(?:true|false)</);
  } finally {
    await runtime.close();
  }
});

test("декларация XML в начале аргумента убирается внутри SOAP и остаётся во вложении, в другом месте — отказ до отправки", async () => {
  const declaration = '<?xml version="1.0" encoding="utf-8"?>';
  const fixture = mock();
  const runtime = new HcmRuntime({
    ...base,
    fetch: fixture.fetch,
    name: "fixture",
    runtimeDir: ".runtime",
    outputLimitBytes: 24000,
    permissions: { write: false, execute: true },
  });
  try {
    // Так выглядит документ, прочитанный через files.read.
    const result = await runtime.call("rpc.call", {
      library: "fixture",
      method: "accept_xml",
      arguments: [{ lexicalValue: { xml: `\uFEFF${declaration}\n${element}` } }],
    });
    assert.equal(result.ok, true);
    const call = fixture.bodies.find((body) => body.includes("<CallMethod "))!;
    assert.ok(call.includes(`<arg-0>\n${element}</arg-0>`));
    assert.doesNotMatch(call.slice(1), /<\?xml[\s?]/);

    const sent = fixture.bodies.length;
    const refused = await runtime.call("rpc.call", {
      library: "fixture",
      method: "accept_xml",
      arguments: [{ lexicalValue: { xml: `<sample>${declaration}</sample>` } }],
    });
    assert.equal(refused.ok, false);
    assert.equal(refused.error?.code, "INVALID_ARGUMENT");
    assert.equal(refused.error?.mutationOutcome, "not_sent");
    assert.equal(fixture.bodies.length, sent);
  } finally {
    await runtime.close();
  }

  const native = mock();
  const gateway = new NativeGateway({ ...base, fetch: native.fetch });
  try {
    await assert.rejects(
      gateway.call("native.rpc.call", {
        target: "fixture.accept_xml",
        args: [{ lexicalValue: { xml: `<sample/>${declaration}` } }],
      }),
      /допустима только в самом начале/,
    );
    // В комментарии, CDATA и данных другой инструкции обработки это текст.
    const text = `<sample><!--${declaration}--><![CDATA[${declaration}]]><?p ${declaration}</sample>`;
    await gateway.call("native.rpc.call", {
      target: "fixture.accept_xml",
      args: [{ lexicalValue: { xml: text } }],
    });
    assert.ok(native.bodies.some((body) => body.includes(`<arg-0>${text}</arg-0>`)));
    // Вложение XOP — отдельный документ: декларация в нём допустима и уходит как есть.
    await gateway.call("native.lds.putDoc", {
      url: "x-local://wt_data/objects/AA/01.xml",
      data: `${declaration}<sample/>`,
    });
    assert.ok(native.bodies.some((body) => body.includes(`\r\n\r\n${declaration}<sample/>\r\n`)));
  } finally {
    await gateway.close();
  }
});
