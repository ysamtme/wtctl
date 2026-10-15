import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { HcmRuntime } from "../src/runtime.js";
import { HcmClient } from "../src/sdk.js";
import { HcmError } from "../src/errors.js";
import { WsHcmApiError } from "../src/protocol/error.js";
import { XmlDocument } from "../src/documents.js";
import { getNativeOperations } from "../src/native/index.js";
import { findXmlNode, parseXml } from "../src/protocol/xml.js";
import type { ConnectionConfig } from "../src/contracts.js";
import { fakeRuntime, type FakeServer, type Script } from "./fake-server.js";

const config = (runtimeDir: string, outputLimitBytes = 1024): ConnectionConfig => ({
  name: "review",
  baseUrl: "http://fixture.invalid/",
  timeoutMs: 1000,
  maxResponseBytes: 1024 * 1024,
  outputLimitBytes,
  runtimeDir,
  permissions: { write: true, execute: true },
});

test("обзор в runtime и SDK отклоняет нулевые лимиты и проходит все ранжированные совпадения без сети", async () => {
  let requests = 0;
  const runtime = new HcmRuntime({
    ...config(".runtime"),
    fetch: async () => {
      requests++;
      throw new Error("Offline discovery must not contact HCM");
    },
  });
  const sdk = new HcmClient(runtime);
  try {
    for (const owner of [runtime, sdk])
      assert.throws(
        () => owner.listOperations({ limit: 0, cursor: 0 }),
        (error: unknown) => {
          assert.ok(error instanceof HcmError);
          assert.equal(error.code, "INVALID_ARGUMENT");
          assert.equal(error.details?.path, "limit");
          return true;
        },
      );
    assert.equal(
      runtime.listOperations({ query: "script", limit: 1 }).operations[0]?.id,
      "execute.script",
    );
    assert.equal(
      runtime.listOperations({ query: " native.lds.loadDoc ", limit: 1 }).operations[0]?.id,
      "native.lds.loadDoc",
    );
    const expected = runtime
      .listOperations({ query: "script", limit: 1000 })
      .operations.map((item) => item.id);
    const actual: string[] = [];
    let cursor = 0;
    for (;;) {
      const page = runtime.listOperations({ query: "script", cursor, limit: 1 });
      actual.push(...page.operations.map((item) => item.id));
      if (page.nextCursor === undefined) break;
      assert.ok(page.nextCursor > cursor);
      cursor = page.nextCursor;
    }
    assert.deepEqual(actual, expected);
    assert.equal(new Set(actual).size, actual.length);
    assert.ok(
      runtime
        .listOperations({ query: "script", effect: "read" })
        .operations.every((item) => item.effect === "read"),
    );
    assert.equal(runtime.listOperations({ query: "missing-operation-name" }).total, 0);
    const expectedRead = runtime.listOperations({ effect: "read", limit: 1000 });
    assert.ok(expectedRead.total > 2);
    // Название эффекта как весь запрос выдаёт операции с этим эффектом.
    assert.equal(runtime.listOperations({ query: " Read " }).total, expectedRead.total);
    // Операции, у которых эффект зависит от аргументов, перечисляются по слову, под которым их считает карта.
    assert.ok(
      runtime
        .listOperations({ query: "unknown" })
        .operations.some((item) => item.id === "runtime.batch"),
    );
    const readIds: string[] = [];
    cursor = 0;
    for (;;) {
      const page = sdk.listOperations({ effect: "read", cursor, limit: 2 });
      assert.ok(page.operations.length > 0 && page.operations.length <= 2);
      assert.equal(page.total, expectedRead.total);
      readIds.push(...page.operations.map((operation) => operation.id));
      if (page.nextCursor === undefined) break;
      assert.ok(page.nextCursor > cursor);
      cursor = page.nextCursor;
    }
    assert.deepEqual(
      readIds,
      expectedRead.operations.map((operation) => operation.id),
    );
    assert.equal(new Set(readIds).size, readIds.length);
  } finally {
    await runtime.close();
  }
  assert.equal(requests, 0);
});

test("публичные описания операций не могут изменить общую проверку и права на запись", async () => {
  const { runtime, server } = fakeRuntime({}, { permissions: { write: false, execute: false } });
  try {
    const create = runtime.describe("objects.create");
    assert.throws(() => Object.assign(create, { effect: "read" }), TypeError);
    const put = getNativeOperations().find((item) => item.id === "native.lds.putDoc")!;
    assert.throws(() => Object.assign(put, { effect: "read" }), TypeError);
    assert.throws(() => (put.inputSchema.required as string[]).splice(0), TypeError);
    assert.throws(() => Object.assign(put.inputSchema, { additionalProperties: true }), TypeError);
    const result = await runtime.call("objects.create", {
      type: "presence_state",
      data: { name: "denied" },
    });
    assert.equal(result.error?.code, "WRITE_DISABLED");
    assert.equal(result.error?.mutationOutcome, "not_sent");
    assert.equal(server.calls.length, 0);
  } finally {
    await runtime.close();
  }
});

const doc = (text: string) => ({
  kind: "binary",
  bytes: new TextEncoder().encode(text),
  contentType: "application/xml",
});
const fixtureForm =
  '<SPXML-FORM><fixture><id TYPE="integer"/><name TYPE="string"/></fixture></SPXML-FORM>';

async function fixture(
  script: Script,
  action: (runtime: HcmRuntime, server: FakeServer) => Promise<void>,
  outputLimitBytes = 1024,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "hcm-review-"));
  const { runtime, server } = fakeRuntime(script, { runtimeDir: directory, outputLimitBytes });
  try {
    await action(runtime, server);
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
}

test("сводки сбоя сохраняют точные ID подготовленного исполнения, когда пароль совпадает с их началом", async () => {
  let preparedId: unknown;
  const { runtime } = fakeRuntime(
    {
      "web.rpc.call": (args) => {
        const request = args.args as { lexicalValue: { xml: string } }[];
        preparedId = findXmlNode(parseXml(request[0]!.lexicalValue.xml), "code");
        throw new HcmError("SCRIPT_FAILED", "Synthetic inline diagnostic.", undefined, {
          executionId: "untrusted-inline",
          diagnostic: "untrusted-inline",
        });
      },
    },
    { outputLimitBytes: 1024, username: "synthetic", password: "inline" },
  );
  try {
    const result = await runtime.call("execute.script", { code: "RESULT=[];" });
    assert.equal(result.error?.mutationOutcome, "indeterminate");
    assert.equal(result.error?.details?.executionId, preparedId);
    assert.match(result.error?.details?.executionId as string, /^hcm_inline_[a-f0-9]{32}$/);
    assert.equal(result.error?.details?.diagnostic, "untrusted-[redacted]");
    assert.equal(result.error?.message, "Synthetic [redacted] diagnostic.");
  } finally {
    await runtime.close();
  }
});

test("неудачные записи документов сохраняют UUID из журнала записей и числовой ID объекта, несмотря на совпадение с коротким паролем", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hcm-review-"));
  const { runtime } = fakeRuntime(
    {
      "native.lds.loadDoc": doc("<fixture><id>41</id><name>before</name></fixture>"),
      "native.spxml2.getForm": fixtureForm,
      "native.lds.putDoc": () => {
        throw new HcmError("SYNTHETIC_WRITE_FAILED", "Synthetic 4 diagnostic.", undefined, {
          mutationId: "untrusted-4",
          objectId: "untrusted-4",
          diagnostic: "untrusted-4",
        });
      },
    },
    { runtimeDir: directory, outputLimitBytes: 1024, username: "synthetic", password: "4" },
  );
  try {
    const result = await runtime.call("objects.patch", { id: "41", patch: { name: "after" } });
    const journal = JSON.parse(
      (await readFile(join(runtime.results.directory, "mutations.jsonl"), "utf8")).trim(),
    ) as { mutationId: string };
    assert.equal(result.error?.mutationOutcome, "indeterminate");
    assert.equal(result.error?.details?.mutationId, journal.mutationId);
    assert.match(
      journal.mutationId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    assert.equal(result.error?.details?.objectId, "41");
    assert.equal(result.error?.details?.diagnostic, "untrusted-[redacted]");
    assert.equal(result.error?.message, "Synthetic [redacted] diagnostic.");
    assert.ok(Buffer.byteLength(JSON.stringify(result)) <= runtime.config.outputLimitBytes);
  } finally {
    await runtime.close();
    assert.equal(resolve(dirname(directory)), resolve(tmpdir()));
    assert.match(basename(directory), /^hcm-review-/);
    await rm(directory, { recursive: true, force: true });
  }
});

test("параллельное закрытие runtime ждёт принятую работу и тот же исход очистки", async () => {
  const runtime = new HcmRuntime(config(".unused"));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let cleanupCalls = 0;
  runtime.gateway.call = async () => {
    await gate;
    return { completed: true };
  };
  runtime.gateway.close = async () => {
    cleanupCalls++;
  };
  const accepted = runtime.call("native.lds.idle");
  const first = runtime.close();
  const second = runtime.close();
  let secondSettled = false;
  void second.then(() => {
    secondSettled = true;
  });
  try {
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(secondSettled, false, "every close caller must wait for the accepted operation");
  } finally {
    release();
    await Promise.all([accepted, first, second]);
  }
  assert.equal(cleanupCalls, 1);
  assert.equal((await runtime.call("native.lds.idle")).error?.code, "RUNTIME_CLOSED");
});

test("данные документа не пропадают из-за того, что имя поля похоже на учётные данные транспорта", async () => {
  const source =
    "<fixture><id>41</id><password>application-value</password><cookie>business-cookie</cookie><authorization>delegation</authorization><sessionid>external-reference</sessionid></fixture>";
  await fixture(
    { "*": doc(source) },
    async (runtime) => {
      const result = await runtime.call("objects.get", {
        id: "41",
        fields: ["id", "password", "cookie", "authorization", "sessionid"],
      });
      assert.equal(result.ok, true);
      assert.deepEqual((result.data as { data: unknown }).data, {
        id: "41",
        password: "application-value",
        cookie: "business-cookie",
        authorization: "delegation",
        sessionid: "external-reference",
      });
    },
    24000,
  );
});

test("ссылки в пакете указывают на полные прежние значения, даже когда их публичный результат сохранён", async () => {
  let loadedUrl: unknown;
  const script: Script = {
    "native.spxml2.getAppInfo": { url: "x-local://fixture.txt", metadata: "x".repeat(5000) },
    "native.lds.loadUrl": (args) => {
      loadedUrl = args.url;
      return Buffer.from("fixture");
    },
  };
  await fixture(script, async (runtime) => {
    const result = await runtime.call("runtime.batch", {
      steps: [
        { id: "native.spxml2.getAppInfo", as: "source" },
        { id: "files.read", args: { url: { $ref: "source.data.url" } } },
      ],
    });
    assert.equal(result.ok, true, "a stored preview must not invalidate dependent steps");
    assert.equal(loadedUrl, "x-local://fixture.txt");
  });
});

test("сбой артефакта пакета сохраняет отправленные записи и ограниченные сводки шагов вместо not_sent", async () => {
  await fixture(
    { "*": { acknowledged: true, large: "x".repeat(5000) } },
    async (runtime, server) => {
      await mkdir(dirname(runtime.results.directory), { recursive: true });
      await writeFile(runtime.results.directory, "foreign file blocks result storage");
      const result = await runtime.call("runtime.batch", {
        steps: [
          {
            id: "native.lds.putDoc",
            args: { url: "x-local://fixture/owned.xml", data: "<fixture/>" },
          },
        ],
      });
      assert.equal(server.calls.length, 1);
      assert.equal(result.error?.code, "RESULT_WRITE_FAILED");
      assert.equal(result.error?.mutationOutcome, "indeterminate");
      const receipt = result.data as {
        partial: boolean;
        receiptOnly: boolean;
        completed: number;
        sentMutationSteps: number;
        receipts: { operationId: string; ok: boolean }[];
      };
      assert.equal(receipt.partial, true);
      assert.equal(receipt.receiptOnly, true);
      assert.equal(receipt.completed, 1);
      assert.equal(receipt.sentMutationSteps, 1);
      assert.deepEqual(receipt.receipts, [
        { index: 0, operationId: "native.lds.putDoc", ok: true },
      ]);
      assert.ok(Buffer.byteLength(JSON.stringify(result)) <= runtime.config.outputLimitBytes);
      assert.doesNotMatch(JSON.stringify(result), /xxxxx/);
    },
  );
});

test("сбой хранилища пакета сохраняет not_sent, если выполнялись только отклонённая запись и чтение", async () => {
  await fixture(
    { "native.spxml2.getAppInfo": { large: "x".repeat(5000) } },
    async (runtime, server) => {
      await mkdir(dirname(runtime.results.directory), { recursive: true });
      await writeFile(runtime.results.directory, "foreign file blocks result storage");
      const result = await runtime.call("runtime.batch", {
        stopOnError: false,
        steps: [
          {
            id: "native.lds.putDoc",
            args: { url: "x-local://fixture/owned.xml", data: "<fixture>\0</fixture>" },
          },
          { id: "native.spxml2.getAppInfo" },
        ],
      });
      assert.equal(server.calls.length, 1);
      assert.equal(result.error?.code, "RESULT_WRITE_FAILED");
      assert.equal(result.error?.mutationOutcome, "not_sent");
      const data = result.data as {
        completed: number;
        sentMutationSteps: number;
        receipts: { ok: boolean; mutationOutcome?: string }[];
      };
      assert.equal(data.completed, 2);
      assert.equal(data.sentMutationSteps, 0);
      assert.equal(data.receipts[0]?.ok, false);
      assert.equal(data.receipts[0]?.mutationOutcome, "not_sent");
      assert.ok(Buffer.byteLength(JSON.stringify(result)) <= runtime.config.outputLimitBytes);
    },
  );
});

test("remove, за которым идёт set, проверяется по итоговому намерению правки, а не по промежуточному удалению", async () => {
  let source = "<fixture><id>41</id><name>old</name></fixture>";
  let writes = 0;
  const script: Script = {
    "native.lds.loadDoc": () => doc(source),
    "native.spxml2.getForm": fixtureForm,
    "native.lds.putDoc": (args) => {
      source = String(args.data);
      writes++;
      return { completed: true };
    },
  };
  await fixture(
    script,
    async (runtime) => {
      const result = await runtime.call("objects.patch", {
        id: "41",
        patch: [
          { op: "remove", path: "name" },
          { op: "set", path: "name", value: "new" },
        ],
      });
      assert.equal(XmlDocument.parse(source).snapshot().data.name, "new");
      assert.equal(writes, 1);
      assert.equal(result.ok, true, "a successful final state must not be reported indeterminate");
    },
    24000,
  );
});

test("ответы с ошибкой остаются ограниченными, когда ненадёжный идентификатор операции огромен", async () => {
  await fixture({}, async (runtime) => {
    const result = await runtime.call("x".repeat(10000));
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "INVALID_OPERATION_ID");
    assert.ok(
      Buffer.byteLength(JSON.stringify(result)) <= runtime.config.outputLimitBytes,
      "errors and metadata must respect the response budget",
    );
  });
});

test("неверный XML native, отклонённый до HTTP, сообщается как not_sent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hcm-review-"));
  let requests = 0;
  const runtime = new HcmRuntime({
    ...config(directory),
    fetch: async () => {
      requests++;
      throw new Error("Unexpected network request");
    },
  });
  try {
    const result = await runtime.call("native.lds.putDoc", {
      url: "x-local://wtv/fixture.xml",
      data: "<!DOCTYPE fixture><fixture/>",
    });
    assert.equal(result.ok, false);
    assert.equal(requests, 0, "the protocol adapter rejected the input before making any request");
    assert.equal(result.error?.mutationOutcome, "not_sent");
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("аргументы в очереди сохраняют намерение preview, даже если вызывающий переиспользует и меняет свой объект", async () => {
  const args: Record<string, unknown> = { id: "41", patch: { name: "preview" }, preview: true };
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  let writes = 0;
  const script: Script = {
    "native.lds.loadDoc": async () => {
      await wait;
      return doc("<fixture><id>41</id><name>original</name></fixture>");
    },
    // Форма читается для проверки имён полей; в этом подставном ответе их нет.
    "native.spxml2.getForm": () => {
      throw new Error("Fixture form is unavailable");
    },
    "*": () => {
      writes++;
      throw new Error("A preview may not send another operation");
    },
  };
  await fixture(
    script,
    async (runtime) => {
      const pending = runtime.call("objects.patch", args);
      args.preview = false;
      (args.patch as Record<string, unknown>).name = "changed after submission";
      release();
      const result = await pending;
      assert.equal(result.ok, true);
      assert.equal(writes, 0);
      assert.equal(
        ((result.data as { changes: Record<string, unknown>[] }).changes[0] ?? {}).after,
        "preview",
      );
    },
    24000,
  );
});

for (const idElement of ["", "<id/>"])
  test(`документы с ${idElement || "no id"} используют физическую идентичность, не меняя XML`, async () => {
    const objectId = "0x1000000000000029";
    const url = "x-local://wt_data/objects/10000000000000/29.xml";
    let source = `<fixture>${idElement}<name>before</name><future vendor="fixture">preserve</future></fixture>`;
    let deleted = false;
    const queries: unknown[] = [];
    const script: Script = {
      "native.lds.loadDoc": () => doc(source),
      "native.spxml2.getForm": fixtureForm,
      "native.lds.putDoc": (args) => {
        assert.equal(args.url, url);
        source = String(args.data);
        return { completed: true };
      },
      "native.lds.xQuery": (args) => {
        queries.push(args.query);
        return { Data: deleted ? {} : { fixture: { id: objectId } } };
      },
      "native.lds.deleteDoc": (args) => {
        assert.equal(args.url, url);
        deleted = true;
        return { completed: true };
      },
    };
    await fixture(
      script,
      async (runtime) => {
        for (const target of [{ id: objectId }, { url }]) {
          const result = await runtime.call("objects.get", target);
          assert.equal(result.ok, true, JSON.stringify(result));
          assert.equal((result.data as { id: string }).id, objectId);
          assert.equal((result.data as { url: string }).url, url);
        }
        const decimal = await runtime.call("objects.get", {
          url: "x-local://wt_data/objects/0000/41.xml",
        });
        assert.equal(decimal.ok, true);
        assert.equal((decimal.data as { id: string }).id, "41");
        const outside = await runtime.call("objects.get", { url: "x-local://wtv/fixture.xml" });
        assert.equal(outside.ok, true);
        assert.equal(Object.hasOwn(outside.data as object, "id"), false);
        const patched = await runtime.call("objects.patch", {
          id: objectId,
          patch: { name: "after" },
        });
        assert.equal(patched.ok, true, JSON.stringify(patched));
        assert.equal((patched.data as { id: string }).id, objectId);
        const data = XmlDocument.parse(source).snapshot().data;
        assert.equal(data.name, "after");
        assert.equal(data.id, idElement ? "" : undefined);
        assert.equal(Object.hasOwn(data, "id"), !!idElement);
        assert.match(source, /<future vendor="fixture">preserve<\/future>/);
        const removed = await runtime.call("objects.delete", {
          id: objectId,
          catalog: "fixtures",
          permanent: true,
        });
        assert.equal(removed.ok, true, JSON.stringify(removed));
        assert.equal((removed.data as { id: string }).id, objectId);
        assert.equal((removed.data as { verification: string }).verification, "catalog");
        assert.equal(deleted, true);
        const query = `for $elem in fixtures where $elem/id = ${objectId} return $elem`;
        assert.deepEqual(queries, [query, query]);
      },
      24000,
    );
  });

test("удаление, после которого объект остался в каталоге, на 2025.2 с MS SQL подсказывает сохранить документ", async () => {
  const serverInfo = (version: string, mask: string) => ({
    valueType: "Object",
    xml: parseXml(
      `<ResultData><Result VALUE-TYPE="Object"><sys_db_capability VALUE-TYPE="integer">${mask}</sys_db_capability><catalog_limits VALUE-TYPE="string">&lt;catalogs/&gt;</catalog_limits><version_server VALUE-TYPE="string">${version}</version_server><os_type VALUE-TYPE="string">windows</os_type></Result></ResultData>`,
    ),
  });
  const cases = [
    ["2025.2.1535 (2026-06-30)", "65537", /^Сервер 2025\.2 с MS SQL .*objects\.patch с resave/],
    ["2025.1.1333 (2025-12-26)", "65537", /^Перед повтором удаления прочитать объект\./],
    ["2025.2.1535 (2026-06-30)", "8589934593", /^Перед повтором удаления прочитать объект\./],
  ] as const;
  for (const [version, mask, hint] of cases)
    await fixture(
      {
        "native.lds.loadDoc": doc("<fixture><id>41</id><name>stays</name></fixture>"),
        "native.lds.xQuery": { Data: { fixture: { id: "41" } } },
        "native.lds.deleteDoc": { completed: true },
        "native.rpc.call": serverInfo(version, mask),
      },
      async (runtime) => {
        const result = await runtime.call("objects.delete", {
          id: "41",
          catalog: "fixtures",
          permanent: true,
        });
        assert.equal(result.error?.code, "READ_BACK_MISMATCH");
        assert.match(result.error?.hint ?? "", hint, version);
      },
    );
});

test("создание подтверждается, когда сервер сохраняет документ без его id", async () => {
  const objectId = "0x1000000000000029";
  let source = "";
  const script: Script = {
    "native.spxml2.getForm": '<SPXML-FORM><fixture><name TYPE="string"/></fixture></SPXML-FORM>',
    "native.lds.getNewObjectId": { ObjectID: objectId },
    "native.lds.putDoc": (args) => {
      assert.match(String(args.data), /<id>0x1000000000000029<\/id>/);
      source = String(args.data).replace(/<id>[^<]*<\/id>/, "");
      return { completed: true };
    },
    "native.lds.loadDoc": () => doc(source),
  };
  await fixture(
    script,
    async (runtime) => {
      const created = await runtime.call("objects.create", {
        type: "fixture",
        data: { name: "new" },
      });
      assert.equal(created.ok, true, JSON.stringify(created));
      const data = created.data as { id: string; mutationOutcome: string };
      assert.equal(data.id, objectId);
      assert.equal(data.mutationOutcome, "confirmed");
    },
    24000,
  );
});

test("противоречащие друг другу ID и URL не позволяют читать, править и удалять документ, выбранный по URL", async () => {
  let mutations = 0;
  const script: Script = {
    "native.lds.loadDoc": doc("<fixture><id>42</id><name>other document</name></fixture>"),
    "*": () => {
      mutations++;
      throw new Error("Conflicting target sent a mutation");
    },
  };
  await fixture(script, async (runtime) => {
    const url = "x-local://wt_data/objects/0000/41.xml";
    const byUrl = await runtime.call("objects.get", { url });
    assert.equal(byUrl.ok, true);
    assert.equal((byUrl.data as { id: string }).id, "42");
    for (const [operation, extra] of [
      ["objects.get", {}],
      ["objects.patch", { patch: { name: "wrong" } }],
      ["objects.delete", { permanent: true }],
    ] as const) {
      const result = await runtime.call(operation, {
        id: "41",
        url,
        ...extra,
      });
      assert.equal(result.ok, false);
      assert.equal(result.error?.code, "TARGET_MISMATCH");
      assert.doesNotMatch(result.error?.hint ?? "", /запис/i);
      assert.equal(
        result.error?.mutationOutcome,
        operation === "objects.get" ? undefined : "not_sent",
      );
    }
    assert.equal(mutations, 0);
  });
});

test("пакет ограниченных запросов остаётся доступным для чтения, когда его суммарный ответ превышает два отдельных бюджета ответа", async () => {
  await fixture({ "*": { text: "x".repeat(900000) } }, async (runtime) => {
    const batch = await runtime.call("runtime.batch", {
      steps: [
        { id: "native.spxml2.getAppInfo" },
        { id: "native.spxml2.getAppInfo" },
        { id: "native.spxml2.getAppInfo" },
      ],
    });
    assert.equal(batch.ok, true);
    assert.equal(batch.meta.truncated, true);
    assert.equal(typeof batch.meta.resultId, "string");
    const page = await runtime.call("results.read", {
      resultId: batch.meta.resultId,
      format: "json",
      limit: 100,
    });
    assert.equal(
      page.ok,
      true,
      "a generated result reference must have a usable bounded read path",
    );
    assert.ok((page.data as { text: string }).text.length);
  });
});

test("правка, у которой чтение после записи возвращает другой документ, даёт TARGET_MISMATCH и indeterminate", async () => {
  let source = "<fixture><id>41</id><name>before</name></fixture>";
  const script: Script = {
    "native.lds.loadDoc": () => doc(source),
    "native.spxml2.getForm": fixtureForm,
    "native.lds.putDoc": () => {
      source = "<fixture><id>42</id><name>after</name></fixture>";
      return { completed: true };
    },
  };
  await fixture(script, async (runtime) => {
    const result = await runtime.call("objects.patch", { id: "41", patch: { name: "after" } });
    assert.equal(result.error?.code, "TARGET_MISMATCH");
    assert.doesNotMatch(result.error?.hint ?? "", /запис/i);
    assert.equal(result.error?.mutationOutcome, "indeterminate");
  });
});

test("после закрытия RUNTIME_CLOSED у записи — not_sent, у чтения исхода нет", async () => {
  const { runtime, server } = fakeRuntime();
  await runtime.close();
  const result = await runtime.call("objects.create", { type: "fixture", data: { name: "x" } });
  assert.equal(result.error?.code, "RUNTIME_CLOSED");
  assert.equal(result.error?.mutationOutcome, "not_sent");
  const read = await runtime.call("objects.get", { id: "41" });
  assert.equal(read.error?.code, "RUNTIME_CLOSED");
  assert.equal(Object.hasOwn(read.error!, "mutationOutcome"), false);
  assert.equal(server.calls.length, 0);
});

const unauthorized = () => new WsHcmApiError("http", "unauthorized", { status: 401 });
const readBackHint =
  /запрос на запись уже ушёл: после восстановления входа проверить, прошла ли запись/;

test("отказ на входе после принятой записи — indeterminate, а подсказка говорит, что запись ушла", async () => {
  let loads = 0;
  const patch = (door: "load" | "put") =>
    fixture(
      {
        "native.lds.loadDoc": () => {
          if (door === "load" && ++loads === 3) throw unauthorized();
          return doc("<fixture><id>41</id><name>before</name></fixture>");
        },
        "native.spxml2.getForm": fixtureForm,
        "native.lds.putDoc": () => {
          if (door === "put") throw unauthorized();
          return { completed: true };
        },
      },
      async (runtime) => {
        const result = await runtime.call("objects.patch", { id: "41", patch: { name: "after" } });
        assert.equal(result.error?.code, "PLATFORM_HTTP");
        assert.equal(result.error?.details?.objectId, "41");
        if (door === "put") {
          assert.equal(result.error?.mutationOutcome, "not_sent");
          assert.doesNotMatch(result.error?.hint ?? "", readBackHint);
        } else {
          assert.equal(result.error?.mutationOutcome, "indeterminate");
          assert.match(result.error?.hint ?? "", readBackHint);
        }
      },
    );
  await patch("load");
  await patch("put");
});

test("создание, для которого выдан ID и запись которого отклонена на входе, — indeterminate", async () => {
  await fixture(
    {
      "native.spxml2.getForm": '<SPXML-FORM><fixture><name TYPE="string"/></fixture></SPXML-FORM>',
      "native.lds.getNewObjectId": { ObjectID: "0x1000000000000029" },
      "native.lds.putDoc": () => {
        throw unauthorized();
      },
    },
    async (runtime) => {
      const result = await runtime.call("objects.create", { type: "fixture", data: { name: "n" } });
      assert.equal(result.error?.mutationOutcome, "indeterminate");
      assert.match(result.error?.hint ?? "", readBackHint);
      assert.equal(result.error?.details?.objectId, "0x1000000000000029");
    },
  );
});
