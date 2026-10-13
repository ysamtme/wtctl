import assert from "node:assert/strict";
import { test } from "node:test";
import { XmlDocument } from "../src/documents.js";
import { SchemaReader } from "../src/schema.js";
import { queryPage } from "../src/query.js";
import { buildXml, createPlatformXmlParser, parseXml } from "../src/protocol/xml.js";
import { fakeRuntime } from "./fake-server.js";

const names =
  "__proto__ constructor prototype hasOwnProperty toString valueOf __defineGetter__ __defineSetter__ __lookupGetter__ __lookupSetter__".split(
    " ",
  );

test("зарезервированные имена XML остаются обычными данными при чтении, правке, сериализации и проекции в JSON", () => {
  const prototype = Object.getOwnPropertyDescriptors(Object.prototype);
  for (const name of names) {
    const source = `<sample ${name}="attribute"><${name}><polluted>old</polluted></${name}><__${name}>adjacent</__${name}></sample>`;
    const parsed = parseXml(source);
    const node = parsed.sample as Record<string, unknown>;
    assert.equal(Object.getPrototypeOf(node), Object.prototype);
    assert.ok(Object.hasOwn(node, name));
    assert.equal(node[`@_${name}`], "attribute");
    assert.ok(buildXml(parsed).includes(`<${name}>`));
    const document = XmlDocument.parse(source);
    const before = document.snapshot();
    assert.ok(Object.hasOwn(before.data, name));
    const changed = document.patch({ [`${name}.polluted`]: "new" }).after;
    assert.notEqual(changed.fingerprint, before.fingerprint);
    assert.equal(changed.data[`__${name}`], "adjacent");
    assert.ok(changed.xml.includes(`${name}="attribute"`));
    assert.ok(changed.xml.includes(`<${name}>`));
    assert.deepEqual(XmlDocument.parse(changed.xml).snapshot().data, changed.data);
    const response = { Data: { row: parseXml(changed.xml).sample } };
    const projected = queryPage(response, 0, 1, [name], false).items[0]!;
    assert.ok(Object.hasOwn(projected, name));
    assert.deepEqual(JSON.parse(JSON.stringify(projected)), { [name]: { polluted: "new" } });
    const created = XmlDocument.create("sample", { [name]: { polluted: "new" } }).snapshot();
    assert.ok(Object.hasOwn(XmlDocument.parse(created.xml).snapshot().data, name));
    document.patch([{ op: "remove", path: name }]);
    assert.equal(Object.hasOwn(document.snapshot().data, name), false);
  }
  const attack = XmlDocument.parse(
    "<sample><constructor><prototype><polluted>old</polluted></prototype></constructor></sample>",
  );
  const attacked = attack.patch({ "constructor.prototype.polluted": "new" }).after;
  assert.deepEqual(JSON.parse(JSON.stringify(attacked.data)), {
    constructor: { prototype: { polluted: "new" } },
  });
  assert.deepEqual(Object.getOwnPropertyDescriptors(Object.prototype), prototype);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test("упорядоченный и сгруппированный разбор сохраняет зарезервированные атрибуты, повторяющиеся и пустые элементы", () => {
  const attributes = names.map((name) => `${name}="literal"`).join(" ");
  const fields = names.map((name) => `<${name}/><${name}>text</${name}>`).join("");
  for (const preserveOrder of [false, true]) {
    for (const attributeNamePrefix of ["@_", ""]) {
      const parser = createPlatformXmlParser({
        preserveOrder,
        attributeNamePrefix,
        ignoreAttributes: false,
        parseTagValue: false,
      });
      const parsed = parser.parse(`<sample ${attributes}>${fields}</sample>`);
      const root = preserveOrder
        ? (parsed as Record<string, unknown>[])[0]!
        : (parsed as Record<string, unknown>);
      const attrs = (preserveOrder ? root[":@"] : root.sample) as Record<string, unknown>;
      for (const name of names) {
        assert.ok(Object.hasOwn(attrs, attributeNamePrefix + name));
        assert.equal(attrs[attributeNamePrefix + name], "literal");
      }
      if (preserveOrder) {
        const children = root.sample as Record<string, unknown>[];
        assert.deepEqual(
          children.map((child) => Object.keys(child)[0]),
          names.flatMap((name) => [name, name]),
        );
      } else if (attributeNamePrefix) {
        for (const name of names) assert.deepEqual(attrs[name], ["", "text"]);
      }
    }
  }
});

test("описания форм показывают все зарезервированные имена полей", async () => {
  const fields = names.map((name) => `<${name} TYPE="string"/>`).join("");
  const reader = new SchemaReader(
    async () => ({}),
    async () => `<SPXML-FORM><sample>${fields}</sample></SPXML-FORM>`,
    async () => ({}),
  );
  const form = await reader.documentForm("fixture.xmd");
  assert.deepEqual(
    form.fields.map((field) => (field as { path: string }).path),
    names,
  );
});

test("превышение лимитов разбора документа даёт безопасную ошибку runtime без содержимого документа", async () => {
  const source = `<sample>${"<node>".repeat(101)}private-document-marker${"</node>".repeat(101)}</sample>`;
  const { runtime } = fakeRuntime(
    { "*": { kind: "binary", bytes: Buffer.from(source) } },
    { permissions: { write: false, execute: false } },
  );
  try {
    const result = await runtime.call("objects.get", { url: "fixture.xml" });
    assert.equal(result.error?.code, "INVALID_XML");
    assert.match(result.error?.message ?? "", /Не удалось разобрать XML документа/);
    assert.equal(JSON.stringify(result).includes("private-document-marker"), false);
  } finally {
    await runtime.close();
  }
});
