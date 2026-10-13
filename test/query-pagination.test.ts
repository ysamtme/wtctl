import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { HcmClient, unwrap } from "../src/sdk.js";
import { parseSoapBody } from "../src/protocol/protocol.js";
import { escapeXml } from "../src/protocol/xml.js";
import { fakeRuntime, type FakeServer } from "./fake-server.js";

type Row = { id: string; name: string; EOF?: string; TotalCount?: string };
const sourceRows: Row[] = Array.from({ length: 7 }, (_, index) => ({
  id: (9223372036854775700n + BigInt(index)).toString(),
  name: `Строка ${index} — 🙂`,
  EOF: "1",
  TotalCount: "1",
}));
const rowXml = (row: Row): string =>
  `<resource>${Object.entries(row)
    .map(([key, value]) => `<${key}>${escapeXml(value)}</${key}>`)
    .join("")}</resource>`;
const pageXml = (rows: Row[], metadata = ""): string =>
  `<Data>${rows.map(rowXml).join("")}</Data>${metadata}`;

async function fixture(
  response: (start: number, limit: number, request: Record<string, unknown>) => string,
  run: (client: HcmClient, calls: FakeServer["calls"]) => Promise<void>,
  execute = false,
) {
  const directory = await mkdtemp(join(tmpdir(), "hcm-query-page-"));
  const { runtime, server } = fakeRuntime(
    {
      "native.lds.xQuery": (args) => {
        assert.equal(args.expectToReadAll, false);
        assert.equal(args.keepCursor, false);
        const body = response(Number(args.startPos), Number(args.maxCount), args);
        return parseSoapBody(
          "XQuery",
          `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><XQueryResponse>${body}</XQueryResponse></s:Body></s:Envelope>`,
          200,
        );
      },
    },
    {
      name: "query-page-fixture",
      runtimeDir: directory,
      permissions: { write: false, execute },
      fetch: async () => {
        throw new Error("Query parser fixture must not use a live server");
      },
    },
  );
  try {
    await run(HcmClient.fromRuntime(runtime), server.calls);
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
}

test("SDK идёт по возвращённым смещениям через обычные и короткие страницы объектов, не теряя строк в записанном виде", async () => {
  const delivered: Row[] = [];
  await fixture(
    (start, limit, request) => {
      assert.equal(request.query, "for $elem in resources return $elem");
      // Короткая страница, не последняя, обязана двигаться на фактический прогресс, а не на запрошенный limit.
      const length = start === 2 ? 1 : limit;
      const rows = sourceRows.slice(start, start + length);
      return pageXml(
        rows,
        start === 0 ? "<TotalCount>7</TotalCount>" : rows.length === 0 ? "<EOF>true</EOF>" : "",
      );
    },
    async (client, calls) => {
      let startPosition = 0;
      for (let safety = 0; ; safety++) {
        assert.ok(safety < 6, "Continuation must terminate instead of repeating an offset");
        const page = unwrap(
          await client.query<Row>({ catalog: "resources", limit: 2, startPosition }),
        );
        // Row EOF=1 / TotalCount=1 никогда не становится метаданными ответа.
        assert.equal(page.total, startPosition > 0 ? undefined : 7);
        delivered.push(...page.items);
        if (page.nextStartPosition === undefined) {
          assert.equal(page.incomplete, undefined);
          break;
        }
        assert.ok(page.nextStartPosition > startPosition);
        startPosition = page.nextStartPosition;
      }
      assert.deepEqual(
        calls.filter(({ id }) => id === "native.lds.xQuery").map(({ args }) => args.startPos),
        [0, 2, 3, 5, 7],
      );
    },
  );
  assert.deepEqual(delivered, sourceRows);
});

test("известный общий счётчик останавливает точную по размеру последнюю страницу без чтения вперёд до EOF", async () => {
  await fixture(
    (start, limit) => pageXml(sourceRows.slice(start, start + limit), "<TotalCount>7</TotalCount>"),
    async (client, calls) => {
      const page = unwrap(
        await client.query<Row>({ catalog: "resources", limit: 2, startPosition: 5 }),
      );
      assert.deepEqual(page.items, sourceRows.slice(5));
      assert.deepEqual(Object.keys(page), ["items", "total"]);
      assert.equal(page.total, 7);
      assert.equal(calls.length, 1);
    },
  );
});

test("полный первый ответ ограничивается, затем продолжение сохраняет начало страницы сервера", async () => {
  await fixture(
    (start, limit) =>
      start === 0
        ? pageXml(sourceRows, "<TotalCount>7</TotalCount><EOF>true</EOF>")
        : pageXml(sourceRows.slice(start, start + limit), "<TotalCount>7</TotalCount>"),
    async (client) => {
      const first = unwrap(await client.query<Row>({ catalog: "resources", limit: 2 }));
      // Строки, которые сервер прислал сверх страницы, отбрасываются без замечания: об этом говорит смещение.
      assert.deepEqual(Object.keys(first), ["items", "total", "nextStartPosition"]);
      assert.equal(first.total, 7);
      assert.equal(first.nextStartPosition, 2);
      const second = unwrap(
        await client.query<Row>({
          catalog: "resources",
          limit: 2,
          startPosition: first.nextStartPosition,
        }),
      );
      assert.deepEqual([...first.items, ...second.items], sourceRows.slice(0, 4));
    },
  );
});

test("EOF берётся из булевых значений как записаны и действует только на полностью выданную страницу", async () => {
  for (const value of ["0", "false", "1", "true"]) {
    await fixture(
      () => pageXml(sourceRows.slice(0, 1), `<EOF>${value}</EOF>`),
      async (client) => {
        const page = unwrap(
          await client.query({ catalog: "resources", limit: 2, startPosition: 3 }),
        );
        assert.equal(page.incomplete, undefined);
        assert.equal(page.nextStartPosition, value === "0" || value === "false" ? 4 : undefined);
      },
    );
  }
  await fixture(
    () => pageXml(sourceRows.slice(3), "<EOF>1</EOF>"),
    async (client) => {
      const page = unwrap(
        await client.query<Row>({ catalog: "resources", limit: 2, startPosition: 3 }),
      );
      assert.deepEqual(page.items, sourceRows.slice(3, 5));
      assert.equal(
        page.nextStartPosition,
        5,
        "Locally withheld rows must remain reachable despite server EOF",
      );
      assert.equal(page.incomplete, undefined);
    },
  );
});

test("устаревший общий счётчик не режет страницу дважды и не прячет строки, а полученный EOF может установить конец", async () => {
  await fixture(
    () => pageXml(sourceRows.slice(4, 6), "<TotalCount>2</TotalCount>"),
    async (client) => {
      const page = unwrap(
        await client.query<Row>({ catalog: "resources", limit: 2, startPosition: 4 }),
      );
      assert.deepEqual(page.items, sourceRows.slice(4, 6));
      assert.equal(page.total, undefined);
      assert.equal(page.nextStartPosition, 6);
      assert.match(page.hint!, /не сходится/);
    },
  );
  await fixture(
    () =>
      pageXml(sourceRows.slice(6), "<TotalCount>9223372036854775807</TotalCount><EOF>true</EOF>"),
    async (client) => {
      const page = unwrap(
        await client.query<Row>({ catalog: "resources", limit: 2, startPosition: 6 }),
      );
      assert.deepEqual(page.items, sourceRows.slice(6));
      assert.equal(page.total, undefined);
      assert.equal(page.incomplete, undefined);
      assert.equal(page.nextStartPosition, undefined);
      assert.match(page.hint!, /не сходится/);
    },
  );
});

test("пустые страницы и потолок смещения говорят, что конец не установлен", async () => {
  for (const [body, incomplete] of [
    // Счётчика нет: база отклонила запрос, а это не «нет строк».
    ["<Data/><EOF>true</EOF>", true],
    ["<Data/><TotalCount>0</TotalCount><EOF>true</EOF>", undefined],
    ["<Data/><TotalCount>0</TotalCount>", undefined],
    ["<Data>\r\n </Data><EOF>false</EOF>", true],
    ["<Data/><TotalCount>7</TotalCount>", true],
  ] as const) {
    await fixture(
      () => body,
      async (client) => {
        const page = unwrap(await client.query({ catalog: "resources", limit: 2 }));
        assert.equal(page.incomplete, incomplete);
        assert.equal(page.hint === undefined, incomplete === undefined);
        assert.equal(page.nextStartPosition, undefined);
        assert.deepEqual(page.items, []);
      },
    );
  }
  await fixture(
    () => pageXml(sourceRows.slice(0, 1)),
    async (client) => {
      const boundary = unwrap(
        await client.query({ catalog: "resources", limit: 1, startPosition: 999999 }),
      );
      assert.equal(boundary.nextStartPosition, 1000000);
      const capped = unwrap(
        await client.query({
          catalog: "resources",
          limit: 1,
          startPosition: boundary.nextStartPosition,
        }),
      );
      assert.equal(capped.nextStartPosition, undefined);
      assert.equal(capped.incomplete, true);
      assert.equal(capped.items.length, 1);
      assert.match(capped.hint!, /1000000/);
    },
  );
});

test("метаданные запроса берутся напрямую, учитывают пространства имён и отклоняют повторные и искажённые поля", async () => {
  await fixture(
    () =>
      `<q:Data xmlns:q="urn:fixture">${rowXml(sourceRows[0]!)}</q:Data><q:TotalCount xmlns:q="urn:fixture"> 7 </q:TotalCount><q:EOF xmlns:q="urn:fixture"> false </q:EOF>`,
    async (client) => {
      const page = unwrap(await client.query<Row>({ catalog: "resources", limit: 2 }));
      assert.deepEqual(page.items, sourceRows.slice(0, 1));
      assert.equal(page.total, 7);
      assert.equal(page.nextStartPosition, 1);
    },
  );
  for (const body of [
    "<Data/><Data/>",
    "<Data/><q:Data xmlns:q='urn:fixture'/>",
    "<Data/><TotalCount>1</TotalCount><TotalCount>2</TotalCount>",
    "<Data/><EOF>0</EOF><EOF>1</EOF>",
    "<Data/><EOF><value>true</value></EOF>",
    "<Data/><EOF>False</EOF>",
    "<Data/><TotalCount>-1</TotalCount>",
    "<Data/><TotalCount>1.0</TotalCount>",
    `<Data/><TotalCount>${"9".repeat(65)}</TotalCount>`,
    "<TotalCount>0</TotalCount>",
  ]) {
    await fixture(
      () => body,
      async (client) => {
        const result = await client.query({ catalog: "resources", limit: 2 });
        assert.equal(result.ok, false);
        assert.equal(result.error?.code, "PLATFORM_RESPONSE");
        assert.equal(result.data, undefined);
      },
    );
  }
});

test("скаляры без обрамления и смешанные Data, теряющие порядок, дают явные ошибки, а исходный низкоуровневый результат доступен", async () => {
  for (const data of [
    "1\r\n2\r\n",
    "\r\n",
    " \t\r\n",
    "<resource><id>1</id></resource>not-a-row",
    "<resource>not-a-field<id>1</id></resource>",
    "<resource><id>1</id><field>before<nested>inside</nested>after</field></resource>",
    "<a><id>1</id></a><b><id>2</id></b><a><id>3</id></a>",
    "<value>scalar</value>",
  ]) {
    const body = `<Data>${data}</Data><TotalCount>3</TotalCount><EOF>true</EOF>`;
    await fixture(
      () => body,
      async (client) => {
        const result = await client.query({ query: "fixture raw expression", limit: 2 });
        assert.equal(result.ok, false);
        assert.equal(result.error?.code, "QUERY_REPRESENTATION");
        assert.match(result.error?.hint ?? "", /native\.lds\.xQuery/);
        assert.equal(
          result.data,
          undefined,
          "Representation failure must not look like a successful empty query",
        );
        const native = await client.call("native.lds.xQuery", {
          query: "fixture raw expression",
          startPos: 0,
          maxCount: 2,
          expectToReadAll: false,
          keepCursor: false,
        });
        assert.equal(native.ok, true);
        assert.deepEqual(
          native.data,
          parseSoapBody(
            "XQuery",
            `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><XQueryResponse>${body}</XQueryResponse></s:Body></s:Envelope>`,
            200,
          ),
        );
      },
      true,
    );
  }
});

test("пустая сырая последовательность объектов читается, не выдумывая границ скаляров", async () => {
  await fixture(
    () => "<Data/><TotalCount>0</TotalCount><EOF>true</EOF>",
    async (client) => {
      const page = unwrap(await client.query({ query: "fixture empty sequence", limit: 2 }));
      assert.deepEqual(page.items, []);
      assert.deepEqual(Object.keys(page), ["items", "total"]);
    },
    true,
  );
});

test("нулевой limit высокого уровня, переполнение смещения и отклонённый сырой запрос никогда не отправляют неограниченный запрос native", async () => {
  await fixture(
    () => {
      throw new Error("Invalid query must not dispatch");
    },
    async (client, calls) => {
      for (const input of [
        { catalog: "resources", limit: 0 },
        { catalog: "resources", startPosition: 1000001 },
        { query: "(1)", limit: 1 },
      ]) {
        const result = await client.query(input);
        assert.equal(result.ok, false);
        assert.ok(["INVALID_ARGUMENT", "EXECUTE_DISABLED"].includes(result.error!.code));
      }
      assert.equal(calls.length, 0);
    },
  );
});
