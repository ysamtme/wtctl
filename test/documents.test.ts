import assert from "node:assert/strict";
import { test } from "node:test";
import { XmlDocument } from "../src/documents.js";
import { catalogQuery } from "../src/query.js";
import { verifyFields, verifyRemovals } from "../src/verification.js";

test("patch preserves unknown ordered XML, attributes, comments, CDATA and escaped values", () => {
  const source =
    '<sample legacy="yes"><id>0x123</id><!--keep--><extra flag="x"><child><![CDATA[a<b]]></child></extra><name>A</name><tail> </tail></sample>';
  const changed = XmlDocument.parse(source).patch({ name: 'B & "C"' });
  assert.equal(changed.after.data.name, 'B & "C"');
  assert.equal(changed.after.data.tail, " ");
  assert.match(changed.after.xml, /<!--keep-->/);
  assert.match(changed.after.xml, /<!\[CDATA\[a<b\]\]>/);
  assert.match(changed.after.xml, /legacy="yes"/);
  assert.match(changed.after.xml, /<extra flag="x">/);
  assert.ok(changed.after.xml.indexOf("<extra") < changed.after.xml.indexOf("<name>"));
});
test("ID cannot be changed via indexed path; failed multi-change patch is atomic locally", () => {
  const document = XmlDocument.parse("<sample><id>1</id><name>A</name></sample>");
  const original = document.snapshot();
  assert.throws(() => document.patch({ "id[0]": "2" }), /ID объекта изменить нельзя/);
  assert.throws(
    () =>
      document.patch([
        { op: "set", path: "name", value: "B" },
        { op: "set", path: "missing.child", value: "C" },
      ]),
    /нет родительского поля/,
  );
  assert.deepEqual(document.snapshot(), original);
});
test("raw document Data fields are preserved; SOAP response unwrapping only uses direct Data", () => {
  const raw = "<sample><id>1</id><Data><field>value</field></Data></sample>";
  assert.deepEqual(JSON.parse(JSON.stringify(XmlDocument.parse(raw).snapshot().data.Data)), {
    field: "value",
  });
  const soap = `<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope/"><s:Body><LoadDocResponse><Data>${raw}</Data></LoadDocResponse></s:Body></s:Envelope>`;
  assert.equal(XmlDocument.parse(soap).snapshot().type, "sample");
});
test("scalar whitespace affects fingerprint while document indentation does not", () => {
  assert.notEqual(
    XmlDocument.parse("<sample><text> </text></sample>").snapshot().fingerprint,
    XmlDocument.parse("<sample><text></text></sample>").snapshot().fingerprint,
  );
  assert.equal(
    XmlDocument.parse("<sample><text>x</text></sample>").snapshot().fingerprint,
    XmlDocument.parse("<sample>\n  <text>x</text>\n</sample>").snapshot().fingerprint,
  );
});
test("a reference with the server's copy of the referenced object under it reads as the ID", () => {
  const source =
    "<position><id>1</id><basic_collaborator_id>0x65D0777BD9FBF8AD\n\t\t<sd><fullname>Лебедев Андрей</fullname></sd>\n\t</basic_collaborator_id><org_id>\n<sd><name>x</name></sd></org_id><doc_info>\n<creation><user_login>u</user_login></creation></doc_info></position>";
  const document = XmlDocument.parse(source);
  const data = document.snapshot().data;
  assert.equal(data.basic_collaborator_id, "0x65D0777BD9FBF8AD");
  assert.equal(data.org_id, "");
  assert.deepEqual(JSON.parse(JSON.stringify(data.doc_info)), { creation: { user_login: "u" } });
  // The same value written again matches what is read back; a structure where a value was asked
  // for is a mismatch, not a failure of the comparison itself.
  const fields = [{ path: "basic_collaborator_id", type: "integer" }];
  verifyFields({ basic_collaborator_id: "0x65D0777BD9FBF8AD" }, data, fields);
  assert.throws(
    () => verifyFields({ doc_info: "text" }, data, [{ path: "doc_info", type: "integer" }]),
    /не приняли запрошенные значения/,
  );
  const changed = document.patch({ basic_collaborator_id: "0x2" });
  assert.equal(changed.after.data.basic_collaborator_id, "0x2");
  assert.doesNotMatch(changed.after.xml, /Лебедев/);
});
test("repeated list elements require an index and preserve adjacent elements", () => {
  const document = XmlDocument.parse(
    "<sample><id>1</id><params><param><value>A</value></param><param><value>B</value></param></params></sample>",
  );
  assert.throws(() => document.patch({ "params.param.value": "C" }), /Таких полей несколько/);
  const result = document.patch([
    { op: "set", path: "params.param[1].value", value: "C" },
    { op: "remove", path: "params.param[0]" },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(result.after.data.params)), { param: { value: "C" } });
});

test("read-back allows missing empty containers at any depth without losing text or attributes", () => {
  const original =
    "<sample><id>1</id><group><items>\n<item><name>x</name></item>\n</items></group></sample>";
  const actual = XmlDocument.parse("<sample><id>1</id></sample>").snapshot();
  for (const path of ["group.items.item[name=x]", "group.items.item[0]"]) {
    const changed = XmlDocument.parse(original).patch([{ op: "remove", path }]);
    verifyFields(changed.after.data, actual.data, [], undefined, original);
    verifyRemovals(changed.after.data, actual.data, changed.changes);
    assert.notEqual(changed.after.fingerprint, actual.fingerprint);
  }
  for (const source of [
    "<sample><id>1</id><group><value/></group></sample>",
    "<sample><id>1</id><group><nested><value/></nested></group></sample>",
  ])
    verifyFields(XmlDocument.parse(source).snapshot().data, actual.data, [], undefined, source);
  for (const source of [
    '<sample><id>1</id><group flag="x"><value/></group></sample>',
    "<sample><id>1</id><group>text<value/></group></sample>",
    "<sample><id>1</id><group> </group></sample>",
    "<sample><id>1</id><group><value>text</value></group></sample>",
  ]) {
    assert.throws(
      () =>
        verifyFields(XmlDocument.parse(source).snapshot().data, actual.data, [], undefined, source),
      { code: "READ_BACK_MISMATCH" },
    );
  }
  verifyFields({ field: "" }, {}, []);
});

test("keyed patch updates the same element and preserves unknown XML", () => {
  const source =
    '<sample><custom_elems><!--keep--><custom_elem flag="x"><name>tub_num</name><value>A</value><unknown><![CDATA[a<b]]></unknown></custom_elem><custom_elem><name>other</name><value>B</value></custom_elem></custom_elems></sample>';
  const document = XmlDocument.parse(source);
  const path = "custom_elems.custom_elem[name=tub_num].value";
  const first = document.patch({ [path]: "1" });
  assert.deepEqual(first.changes, [{ op: "set", path, before: "A", after: "1" }]);
  const second = document.patch({ [path]: "2" }).after;
  assert.equal(second.xml, source.replace("<value>A</value>", "<value>2</value>"));
  const removed = document.patch([{ op: "remove", path }]);
  verifyRemovals(removed.after.data, removed.after.data, removed.changes);
  assert.throws(() => verifyRemovals(removed.after.data, removed.before.data, removed.changes), {
    code: "READ_BACK_MISMATCH",
  });
});

test("keyed set appends a missing element and creates its absent container", () => {
  for (const source of [
    "<sample><custom_elems><custom_elem><name>other</name><value>B</value></custom_elem></custom_elems></sample>",
    "<sample><title>A</title></sample>",
  ]) {
    const document = XmlDocument.parse(source);
    const after = document.patch({ "custom_elems.custom_elem[name=tub_num].value": "1" }).after;
    assert.match(after.xml, /<custom_elem><name>tub_num<\/name><value>1<\/value><\/custom_elem>/);
    if (source.includes("other"))
      assert.ok(after.xml.indexOf("other") < after.xml.indexOf("tub_num"));
    else assert.equal(after.data.title, "A");
    assert.throws(
      () => document.patch({ "custom_elems.custom_elem[name=tub_num].missing.child": "X" }),
      (error: any) =>
        error.code === "PATCH_PATH_MISSING" &&
        error.hint.includes('{"custom_elems.custom_elem[name=tub_num].missing": {…}}'),
    );
    // An element made by its key takes that key: another value for the key field is a mistake.
    assert.throws(() => document.patch({ "custom_elems.custom_elem[name=new].name": true }), {
      code: "INVALID_PATCH",
    });
    assert.equal(
      document.patch({ "custom_elems.custom_elem[name=new].name": "new" }).after.xml.match(/new/g)
        ?.length,
      1,
    );
    assert.match(
      document.patch({ "custom_elems.custom_elem[name=new].name": "renamed" }).after.xml,
      /<custom_elem><name>renamed<\/name><\/custom_elem>/,
    );
    const nested = document.patch({ "custom_elems.custom_elem[name=deep].group.value": "2" });
    assert.match(nested.after.xml, /<name>deep<\/name><group><value>2<\/value><\/group>/);
  }
});

test("keyed remove skips missing keys without changing the fingerprint", () => {
  for (const source of [
    "<sample><custom_elems><custom_elem><name>tub_num</name><value>1</value></custom_elem><custom_elem><name>other</name></custom_elem></custom_elems></sample>",
    "<sample><title>A</title></sample>",
  ]) {
    const document = XmlDocument.parse(source);
    const missing = document.patch([
      { op: "remove", path: "custom_elems.custom_elem[name=missing]" },
    ]);
    assert.deepEqual(missing.changes, []);
    assert.equal(missing.after.fingerprint, missing.before.fingerprint);
    if (source.includes("tub_num")) {
      const removed = document.patch([
        { op: "remove", path: "custom_elems.custom_elem[name=tub_num]" },
      ]);
      assert.equal(removed.changes.length, 1);
      assert.throws(
        () => verifyRemovals(removed.after.data, removed.before.data, removed.changes),
        { code: "READ_BACK_MISMATCH" },
      );
      assert.deepEqual(JSON.parse(JSON.stringify(removed.after.data.custom_elems)), {
        custom_elem: { name: "other" },
      });
    }
  }
});

test("duplicate keys and mismatched replacement keys reject the entire patch", () => {
  const duplicate = XmlDocument.parse(
    "<sample><title>A</title><items><item><name>x</name></item><item><name>x</name></item></items></sample>",
  );
  const before = duplicate.snapshot();
  for (const op of ["set", "remove"]) {
    assert.throws(
      () =>
        duplicate.patch([
          { op: "set", path: "title", value: "changed" },
          { op, path: "items.item[name=x]", value: { name: "x" } },
        ]),
      { code: "AMBIGUOUS_PATCH" },
    );
    assert.deepEqual(duplicate.snapshot(), before);
  }
  // A key written the other way is the same ID: the element is found, not doubled.
  const members = XmlDocument.parse(
    "<group><members><member><person_id>0x1F</person_id><note>a</note></member></members></group>",
  );
  assert.match(
    members.patch({ "members.member[person_id=31].note": "b" }).after.xml,
    /^<group><members><member><person_id>0x1F<\/person_id><note>b<\/note><\/member><\/members><\/group>$/,
  );
  assert.equal(
    members.patch([{ op: "remove", path: "members.member[person_id=0x1f]" }]).changes.length,
    1,
  );
  // Removing every element of a list is removing the list; a change record names what a structure holds.
  assert.throws(
    () => duplicate.patch([{ op: "remove", path: "items.item" }]),
    (error: any) =>
      error.code === "AMBIGUOUS_PATCH" &&
      error.hint === 'Чтобы убрать все элементы, нужно удалить сам список: remove ["items"].',
  );
  assert.deepEqual(
    XmlDocument.parse("<sample><title>A</title></sample>").patch({
      items: { item: [{ name: "a" }, { name: "b" }], note: "n" },
    }).changes,
    [{ op: "set", path: "items", after: "{item: 2 items, note}" }],
  );
  const document = XmlDocument.parse("<sample><items><item><name>x</name></item></items></sample>");
  const original = document.snapshot();
  for (const value of [{ name: "y" }, { value: "missing key" }, "scalar", [{ name: "x" }]]) {
    assert.throws(() => document.patch({ "items.item[name=x]": value }));
    assert.deepEqual(document.snapshot(), original);
  }
});

test("whole keyed elements can be added and replaced with exact lexical keys", () => {
  const document = XmlDocument.parse("<sample><items></items></sample>");
  for (const key of ["01", "1", " a.b=c[😀&\"' ", ""]) {
    const path = `items.item[name=${key}]`;
    document.patch({ [path]: { name: key, value: "before" } });
    document.patch({ [path]: { name: key, value: "after" } });
  }
  assert.deepEqual(JSON.parse(JSON.stringify(document.snapshot().data.items)), {
    item: ["01", "1", " a.b=c[😀&\"' ", ""].map((name) => ({ name, value: "after" })),
  });
  assert.throws(() => document.patch({ "items.item[name=bad]key]": { name: "bad]key" } }), {
    code: "INVALID_PATCH_PATH",
  });
  assert.throws(() => document.patch({ "id[name=x]": { name: "x" } }), { code: "IMMUTABLE_ID" });
  assert.throws(
    () =>
      verifyRemovals(
        { item: { name: "01" } },
        { item: { name: "1", value: "retained" } },
        [{ op: "remove", path: "item[name=01].value" }],
        [{ path: "item.name", type: "integer" }],
      ),
    { code: "READ_BACK_MISMATCH" },
  );
});
test("invalid XML characters and unpaired surrogates fail before any patch is committed", () => {
  const document = XmlDocument.parse("<sample><name>before</name></sample>");
  const before = document.snapshot();
  for (const value of ["\u0000", "\u000B", "\uD800", "\uDC00", "\uFFFE"]) {
    assert.throws(
      () => XmlDocument.parse(`<sample><name>${value}</name></sample>`),
      /недопустимый символ/,
    );
    assert.throws(() => XmlDocument.create("sample", { name: value }), /недопустимый символ/);
    assert.throws(
      () =>
        document.patch([
          { op: "set", path: "name", value: "changed" },
          { op: "set", path: "other", value },
        ]),
      /недопустимый символ/,
    );
    assert.deepEqual(document.snapshot(), before);
  }
  assert.equal(XmlDocument.create("sample", { name: "😀\t\n\r" }).snapshot().data.name, "😀\t\n\r");
});
test("creation adds an escaped SPXML-FORM attribute and keeps the platform type consistent", () => {
  const formUrl = 'x-local://wtv/wtv_sample.xmd?test="quoted"&value=1';
  const snapshot = XmlDocument.create("sample", { id: "1", name: "Example" }, formUrl).snapshot();
  assert.equal(snapshot.type, "sample");
  assert.equal(snapshot.formUrl, formUrl);
  assert.match(snapshot.xml, /SPXML-FORM=/);
  assert.match(snapshot.xml, /&quot;/);
  assert.match(snapshot.xml, /&amp;/);
  assert.equal(XmlDocument.parse(snapshot.xml).snapshot().formUrl, formUrl);
  assert.throws(() => XmlDocument.create("prefix:sample", {}, formUrl), /имя типа объекта/);
  assert.throws(() => XmlDocument.create("sample", {}, "\u0000"), /недопустимый символ/);
});
test("query DSL escapes quotes and rejects expression injection, unsafe numbers and unknown operators", () => {
  assert.equal(
    catalogQuery("collaborators", { fullname: "O'Connor" }),
    "for $elem in collaborators where ($elem/fullname = 'O''Connor') return $elem",
  );
  assert.throws(
    () => catalogQuery("collaborators return $elem;", {}),
    /catalog: «collaborators return .elem;» не подходит — нужно имя/,
  );
  assert.throws(() => catalogQuery("collaborators", { id: Number.MAX_SAFE_INTEGER + 1 }), {
    code: "INVALID_FILTER_VALUE",
  });
  assert.throws(
    () => catalogQuery("collaborators", { id: { sql: "delete" } }),
    /Операторы условия/,
  );
  assert.throws(() => catalogQuery("collaborators", { id: {} }), /нет оператора/);
});

test("catalog filters serialize small fractional numbers as decimal XQuery tokens", () => {
  for (const value of [1e-7, -2.5e-7, 1.23456789e-7, Number.MIN_VALUE, 0.000001, 1.5, -0]) {
    const query = catalogQuery("resources", { value });
    const token = /^for \$elem in resources where \(\$elem\/value = (.+)\) return \$elem$/.exec(
      query,
    )?.[1];
    assert.ok(token);
    assert.match(token, /^-?\d+(?:\.\d+)?$/);
    assert.equal(Number(token), value === 0 ? 0 : value);
  }
  assert.equal(
    catalogQuery("resources", { value: { gte: -2.5e-7, in: [1e-7, "1e-7"] } }),
    "for $elem in resources where ($elem/value >= -0.00000025) and (($elem/value = 0.0000001 or $elem/value = '1e-7')) return $elem",
  );
  for (const value of [NaN, Infinity, -Infinity, 1e21])
    assert.throws(() => catalogQuery("resources", { value }), {
      code: "INVALID_FILTER_VALUE",
    });
});

test("document XML shares exact once numeric-reference decoding and preserves literal CDATA", () => {
  const source =
    '<sample a="&#9;&#x1F600;"><text>&#13;&#10;&amp;#10;&#38;#xA;&#x26;#10;</text><literal><![CDATA[&#10;&nbsp;]]></literal></sample>';
  const snapshot = XmlDocument.parse(source).snapshot();
  assert.equal(snapshot.data.text, "\r\n&#10;&#xA;&#10;");
  assert.equal(snapshot.data.literal, "&#10;&nbsp;");
  const patched = XmlDocument.parse(source).patch({ newField: "safe" }).after;
  assert.equal(patched.data.text, snapshot.data.text);
  assert.equal(patched.data.literal, snapshot.data.literal);
  const roundTrip = XmlDocument.parse(patched.xml).snapshot();
  assert.equal(roundTrip.data.text, snapshot.data.text);
  assert.equal(roundTrip.data.literal, snapshot.data.literal);
  assert.match(patched.xml, /a="&#9;/);
  assert.match(patched.xml, /&#13;/);
  assert.equal(roundTrip.fingerprint, patched.fingerprint);
  const attrDocument = XmlDocument.parse(
    '<sample SPXML-FORM="x-local://wtv/a&#13;b.xmd"><text><![CDATA[&#13;]]></text></sample>',
  ).patch({ field: "changed" }).after;
  assert.equal(XmlDocument.parse(attrDocument.xml).snapshot().formUrl, "x-local://wtv/a\rb.xmd");
  assert.equal(XmlDocument.parse(attrDocument.xml).snapshot().data.text, "&#13;");
  const html = XmlDocument.parse(
    "<sample><html><![CDATA[<!DOCTYPE html><p>&nbsp;</p>]]></html><!-- <!DOCTYPE literal> --></sample>",
  ).patch({ name: "changed" }).after;
  assert.equal(XmlDocument.parse(html.xml).snapshot().data.html, "<!DOCTYPE html><p>&nbsp;</p>");
  assert.throws(
    () => XmlDocument.parse("<sample><text>&nbsp;</text></sample>"),
    /нет среди допустимых/,
  );
  assert.throws(() => XmlDocument.parse('<sample a="&#xD800;"/>'), /недопустимый символ/);
});

test("generic patch preserves untouched external descriptors and rejects stale metadata rewrites", () => {
  const document = XmlDocument.parse(
    '<sample><group><title>old</title><html EXT-OBJECT-ID="123" SIZE="50000"/></group></sample>',
  );
  const changed = document.patch({ "group.title": "new" });
  assert.match(changed.after.xml, /EXT-OBJECT-ID="123" SIZE="50000"/);
  const before = document.snapshot();
  for (const patch of [
    { "group.html": "new bytes" },
    { group: { title: "replacement" } },
    [{ op: "remove", path: "group.html" }],
  ]) {
    assert.throws(() => document.patch(patch), /большое поле/);
    assert.deepEqual(document.snapshot(), before);
  }
});
