import assert from "node:assert/strict";
import { test } from "node:test";
import { LogReader, parseLogEvents, parseLogReport, type LogGateway } from "../src/logs.js";
import { escapeXml } from "../src/protocol/xml.js";

const file = "xhttp_2026-09-30.log";
const notice = (bytes: number): string =>
  `Показано последние ${bytes} байт файла. Для просмотра всего файла его нужно сохранить.\n`;
function report(
  name = file,
  size = "1000",
  url = `x-local://Logs/${encodeURIComponent(name)}`,
): string {
  const values = ["Основной журнал", "30.09.2026", name, size, "xhttp", "false", url];
  return `<data><rs><r><cs>${values.map((value, index) => `<c><t>${escapeXml(value)}</t>${index === 3 ? `<r>${escapeXml(size)}</r>` : ""}</c>`).join("")}</cs></r></rs></data>`;
}
function fixture(
  initial = "12:00:00 [r1] INFO started\n12:00:01 [r2] ERROR failed\n    at frame\n",
) {
  const calls: Array<{ id: string; target: unknown; args: Record<string, unknown> }> = [];
  let body = initial;
  let size = "1000";
  let includeNotice = true;
  const gateway: LogGateway = {
    async call(id, args) {
      calls.push({ id, target: args.target, args });
      assert.equal(id, "native.rpc.call");
      if (args.target === "tools_report.server_log_report") {
        const arguments_ = args.args as Array<{ lexicalValue: string }>;
        assert.equal(
          decodeURIComponent(arguments_[0]!.lexicalValue),
          "<func_params><server_log_report><type_id>all</type_id><show_alert>false</show_alert></server_log_report></func_params>",
        );
        return { valueType: "string", lexicalValue: report(file, size) };
      }
      assert.equal(args.target, "tools.load_url_data_server");
      const supplied = args.args as Array<{ valueType: string; lexicalValue: string }>;
      assert.equal(supplied[0]?.lexicalValue, `x-local://Logs/${file}`);
      return {
        valueType: "string",
        lexicalValue: includeNotice ? notice(Number(supplied[1]!.lexicalValue)) + body : body,
      };
    },
  };
  return {
    reader: new LogReader(gateway, { maxResponseBytes: 1024 * 1024 }),
    calls,
    update(value: string, sizeValue = size) {
      body = value;
      size = sizeValue;
    },
    tail(value = true) {
      includeNotice = value;
    },
  };
}

/** Model the shipped branches for a file that permits range reads but rejects LoadUrlData.
 * This fixture proves routing, not the sharing permissions of any active server writer. */
function rangeOnlyLog(initial: string) {
  let content = Buffer.from(initial, "utf8");
  let present = true;
  let beforeLoad: (() => void) | undefined;
  let afterLoad: (() => void) | undefined;
  let overrideNotice: string | undefined;
  let dateSeconds = "1790726400";
  const ranges: Array<{ valueType: string; lexicalValue: string }> = [];
  let reports = 0;
  let fileOpens = 0;
  const gateway: LogGateway = {
    async call(id, args) {
      assert.equal(id, "native.rpc.call");
      if (args.target === "tools_report.server_log_report") {
        reports++;
        return {
          valueType: "string",
          lexicalValue: present
            ? report(file, String(content.length)).replace(
                "<t>30.09.2026</t>",
                `<t>30.09.2026</t><r>${dateSeconds}</r>`,
              )
            : "<data/>",
        };
      }
      assert.equal(args.target, "tools.load_url_data_server");
      const supplied = args.args as Array<{ valueType: string; lexicalValue: string }>;
      assert.equal(supplied[0]?.lexicalValue, `x-local://Logs/${file}`);
      const range = supplied[1]!;
      ranges.push(range);
      beforeLoad?.();
      const count = Number(range.lexicalValue);
      if (range.valueType === "null" || content.length < count)
        throw new Error("LoadUrlData sharing violation in range-compatible fixture");
      assert.equal(range.valueType, "integer");
      assert.ok(Number.isSafeInteger(count) && count >= 0);
      // Source returns empty before opening the file for range (0, 0).
      if (count > 0) fileOpens++;
      const result =
        (overrideNotice ?? notice(count)) +
        content.subarray(content.length - count).toString("utf8");
      afterLoad?.();
      return { valueType: "string", lexicalValue: result };
    },
  };
  return {
    reader: new LogReader(gateway, { maxResponseBytes: 1024 * 1024 }),
    ranges,
    get reports() {
      return reports;
    },
    get fileOpens() {
      return fileOpens;
    },
    update(text: string) {
      content = Buffer.from(text, "utf8");
    },
    remove() {
      present = false;
    },
    beforeRead(hook: () => void) {
      beforeLoad = hook;
    },
    afterRead(hook: () => void) {
      afterLoad = hook;
    },
    setNotice(value: string) {
      overrideNotice = value;
    },
    setDateSeconds(value: string) {
      dateSeconds = value;
    },
  };
}

test("server log report parses direct table cells, empty reports and quoted filenames without executable interpolation", async () => {
  const named = "quoted 'log'_2026-09-30.log";
  const parsed = parseLogReport(report(named, "9007199254740993"));
  assert.equal(parsed[0]?.sizeBytes, "9007199254740993");
  assert.equal(parsed[0]?.name, named);
  assert.equal(parsed[0]?.dateHint, "2026-09-30");
  assert.equal(parsed[0]?.url, `x-local://Logs/${encodeURIComponent(named)}`);
  assert.deepEqual(parseLogReport("<data/>"), []);
  assert.deepEqual(parseLogReport("<data><rs/></data>"), []);
  assert.throws(() => parseLogReport("<other/>"), /в неожиданном виде/);
  assert.throws(() => parseLogReport("<data><rs><r><cs><c/></cs></r></rs></data>"));
  assert.throws(() => parseLogReport(report(file, "not-a-size")), /размер файла/);
  assert.throws(
    () => parseLogReport(report(file, "1000", "x-local://wtv/private.log")),
    /папки Logs/,
  );
});

test("log reads validate bounds and listed basenames before the load RPC, then remove only the known tail notice", async () => {
  const mock = fixture();
  for (const name of [
    "../private.log",
    "x-local://Logs/%2fprivate.log",
    "x-local://wtv/private.log",
    "a\u0000.log",
  ])
    await assert.rejects(mock.reader.read({ file: name }));
  assert.equal(mock.calls.length, 0);
  await assert.rejects(mock.reader.read({ file, tailBytes: 0 }), /больше нуля/);
  await assert.rejects(mock.reader.read({ file, tailBytes: 1000000 }), /tailBytes/);
  await assert.rejects(
    mock.reader.read({ file, full: true, tailBytes: 512 }),
    /full или tailBytes/,
  );
  await assert.rejects(mock.reader.read({ file: "absent.log" }), /нет среди логов/);
  assert.equal(mock.calls.filter((call) => call.target === "tools.load_url_data_server").length, 0);
  mock.tail();
  const read = await mock.reader.read({ file, tailBytes: 512 });
  assert.equal(read.serverTailNotice, true);
  assert.equal(read.truncated, true);
  assert.ok(read.text.startsWith("12:00:00"));
  assert.equal(read.requestedTailBytes, 512);
  assert.equal(read.fingerprint.length, 64);
  mock.update("large", "1000000");
  const before = mock.calls.filter((call) => call.target === "tools.load_url_data_server").length;
  await assert.rejects(mock.reader.read({ file, full: true }), /целиком не помещается/);
  assert.equal(
    mock.calls.filter((call) => call.target === "tools.load_url_data_server").length,
    before,
  );
});

test("event parser preserves multiline stacks, leading partial text, millisecond timestamps and server-local date hints", () => {
  const events = parseLogEvents(
    "continued stack\r\n12:00:00.123 [request-1] ERROR exception\r\n    at first\r\n    at second\r\n12:00:01 INFO done",
    "2026-09-30",
    true,
  );
  assert.equal(events.length, 3);
  assert.equal(events[0]?.partialBeginning, true);
  assert.equal(events[1]?.time, "12:00:00.123");
  assert.equal(events[1]?.dateHint, "2026-09-30");
  assert.equal(events[1]?.context, "request-1");
  assert.equal(events[1]?.level, "error");
  assert.equal(
    events[1]?.text,
    "12:00:00.123 [request-1] ERROR exception\n    at first\n    at second",
  );
  assert.equal(events[1]?.lineStart, 2);
  assert.equal(events[1]?.lineEnd, 4);
  assert.equal(events[2]?.level, "info");
  // The break that ends the file is not a line of the last event; refusal lines are errors.
  const refusals = parseLogEvents(
    "12:00:00 [a] Unknown method: get_versio\n12:00:01 [a] Доступ запрещён\n12:00:02 [a] Файл уже открыт в другой программе:\n12:00:03 [a] Invalid tag character: 32\n",
  );
  assert.deepEqual(
    refusals.map((event) => event.level),
    ["error", "error", "error", "error"],
  );
  assert.equal(refusals[3]?.text, "12:00:03 [a] Invalid tag character: 32");
});

test("search includes continuation text and rejects changed fingerprint paging rather than silently skipping events", async () => {
  const mock = fixture();
  const result = await mock.reader.search({
    file,
    text: "frame",
    context: "R2",
    level: "error",
    limit: 1,
  });
  assert.equal(result.matches, 1);
  assert.equal(result.events[0]?.context, "r2");
  const page = await mock.reader.search({ file, limit: 1 });
  assert.equal(page.nextOffset, 1);
  const next = await mock.reader.search({
    file,
    limit: 1,
    offset: page.nextOffset!,
    expectedFingerprint: page.fingerprint,
  });
  assert.equal(next.events[0]?.sequence, 2);
  mock.update("12:00:03 ERROR changed\n");
  await assert.rejects(
    mock.reader.search({ file, offset: 1, expectedFingerprint: page.fingerprint }),
    /изменился между страницами/,
  );
  await assert.rejects(mock.reader.list({ startDate: "2026-02-31" }), /ГГГГ-ММ-ДД/);
  assert.equal(
    (await mock.reader.list({ type: "xhttp", startDate: "2026-09-30", endDate: "2026-09-30" }))
      .total,
    1,
  );
});

test("search classifies completed multiline bodies without context false positives", async () => {
  const source = [
    "12:00:00 [critical-request] Processing request",
    "System.Exception: Unicode ошибка 😀",
    "    at frame",
    "12:00:01 [error] Processing next request",
    "    completed normally",
    "12:00:02 WARNING request delayed",
    "System.Exception: timeout",
    "12:00:03 ERROR request failed",
    "FATAL resource unavailable",
    "12:00:04 INFO request finished",
    "WARNING response delayed",
  ].join("\r\n");
  const mock = fixture(source);
  const errors = await mock.reader.search({ file, level: "error" });
  assert.equal(errors.matches, 2);
  assert.deepEqual(
    errors.events.map((event) => event.sequence),
    [1, 3],
  );
  assert.equal(errors.events[0]?.context, "critical-request");
  assert.equal(errors.events[0]?.message, "Processing request");
  assert.equal(errors.events[0]?.text, source.split("\r\n").slice(0, 3).join("\n"));
  assert.equal(errors.events[0]?.lineStart, 1);
  assert.equal(errors.events[0]?.lineEnd, 3);
  assert.deepEqual(
    parseLogEvents(source).map((event) => event.level),
    ["error", "normal", "error", "critical", "warning"],
  );
  const critical = await mock.reader.search({ file, level: "critical" });
  assert.equal(critical.matches, 1);
  assert.equal(critical.events[0]?.sequence, 4);
});

test("follow recognizes stable windows, append overlap and rotation gaps without inventing a byte offset", async () => {
  const mock = fixture("12:00:00 INFO first\n12:00:01 INFO second\n");
  const first = await mock.reader.follow({ file });
  assert.equal(first.events.length, 2);
  const stable = await mock.reader.follow({ file, cursor: first.cursor });
  assert.equal(stable.changed, false);
  assert.deepEqual(stable.events, []);
  mock.update("12:00:00 INFO first\n12:00:01 INFO second\n12:00:02 ERROR third\n", "1200");
  const next = await mock.reader.follow({ file, cursor: stable.cursor });
  assert.equal(next.events.length, 1);
  assert.equal(next.events[0]?.message, "ERROR third");
  assert.equal(next.gapPossible, false);
  mock.update("12:10:00 INFO rotated\n", "100");
  const rotated = await mock.reader.follow({ file, cursor: next.cursor });
  assert.equal(rotated.gapPossible, true);
  assert.equal(rotated.resetReason, "file-size-decreased");
  const count = mock.calls.length;
  await assert.rejects(
    mock.reader.follow({ file: "other.log", cursor: rotated.cursor }),
    /другого файла лога/,
  );
  await assert.rejects(mock.reader.follow({ file, cursor: "not-a-cursor" }), /cursor неверен/);
  assert.equal(mock.calls.length, count);
});

test("follow reports ambiguous repeated events instead of silently skipping new identical messages", async () => {
  const mock = fixture("12:00:00 ERROR repeated\n12:00:00 ERROR repeated\n");
  const first = await mock.reader.follow({ file });
  mock.update(
    "12:00:00 ERROR repeated\n12:00:00 ERROR repeated\n12:00:00 ERROR repeated\n",
    "1300",
  );
  const next = await mock.reader.follow({ file, cursor: first.cursor });
  assert.equal(next.gapPossible, true);
  assert.equal(next.resetReason, "ambiguous-overlap");
  assert.equal(
    next.events.length,
    3,
    "return the complete bounded window when an overlap is ambiguous",
  );
});

test("range-compatible logs use bounded range for default tail and full, preserving requested mode and complete events", async () => {
  const source = "12:00:00 INFO own first\n12:00:01 ERROR own second\n";
  const bytes = Buffer.byteLength(source);
  const mock = rangeOnlyLog(source);
  const tail = await mock.reader.read({ file });
  assert.equal(tail.text, source);
  assert.equal(tail.requestedMode, "tail");
  assert.ok(tail.requestedTailBytes! > bytes);
  assert.equal(tail.effectiveTailBytes, bytes);
  assert.equal(tail.sizeBytesBefore, String(bytes));
  assert.equal(tail.sizeBytesAfter, String(bytes));
  assert.equal(tail.serverTailNotice, true, "equal-size range still has the stock tail notice");
  assert.equal(tail.truncated, false, "the range notice alone does not prove truncation");
  const full = await mock.reader.read({ file, full: true });
  assert.equal(full.text, source);
  assert.equal(full.requestedMode, "full");
  assert.equal(full.requestedTailBytes, undefined);
  assert.equal(full.effectiveTailBytes, bytes);
  assert.equal(full.truncated, false);
  const search = await mock.reader.search({ file, full: true });
  assert.equal(search.events[0]?.partialBeginning, undefined);
  const followed = await mock.reader.follow({ file });
  assert.equal(followed.events[0]?.partialBeginning, undefined);
  assert.equal(followed.windowTruncated, false);
  assert.deepEqual(
    mock.ranges,
    Array.from({ length: 4 }, () => ({ valueType: "integer", lexicalValue: String(bytes) })),
  );
  assert.equal(mock.reports, 8, "every successful range has a report before and after");
});

test("tail growth keeps the effective wire range and refreshed size without pretending a complete requested tail", async () => {
  const original = "12:00:00 INFO before\n";
  const grown = original + "12:00:01 ERROR appended\n";
  const mock = rangeOnlyLog(original);
  mock.beforeRead(() => mock.update(grown));
  const read = await mock.reader.read({ file, tailBytes: 512 });
  const effective = Buffer.byteLength(original);
  assert.equal(read.requestedTailBytes, 512);
  assert.equal(read.effectiveTailBytes, effective);
  assert.equal(read.text, Buffer.from(grown).subarray(-effective).toString("utf8"));
  assert.equal(read.sizeBytesBefore, String(effective));
  assert.equal(read.sizeBytesAfter, String(Buffer.byteLength(grown)));
  assert.equal(read.file.sizeBytes, read.sizeBytesAfter);
  assert.equal(read.truncated, true);
  assert.equal(mock.ranges.length, 1, "growth does not cause a content retry");
});

test("full range discards stale text if the log grows, shrinks or disappears before the second report", async () => {
  for (const change of ["grow", "shrink", "missing", "date-metadata"] as const) {
    const original = "12:00:00 INFO snapshot\n";
    const mock = rangeOnlyLog(original);
    mock.afterRead(() => {
      if (change === "missing") mock.remove();
      else if (change === "date-metadata") mock.setDateSeconds("1790726401");
      else mock.update(change === "grow" ? original + "12:00:01 INFO new\n" : "short");
    });
    await assert.rejects(mock.reader.read({ file, full: true }), { code: "LOG_CHANGED" });
    assert.equal(mock.ranges.length, 1, "no hidden retry or second content read");
    assert.equal(mock.reports, 2);
  }
});

test("range notice is checked against effective bytes and an absent notice cannot certify a full range", async () => {
  const wrong = rangeOnlyLog("12:00:00 INFO small\n");
  wrong.setNotice(notice(512));
  await assert.rejects(wrong.reader.read({ file, tailBytes: 512 }), {
    code: "LOG_RESPONSE_INVALID",
  });
  const missing = rangeOnlyLog("12:00:00 INFO small\n");
  missing.setNotice("");
  await assert.rejects(missing.reader.read({ file, full: true }), { code: "LOG_CHANGED" });
  assert.equal(missing.reports, 2);
});

test("empty logs make a zero-range RPC with two agreeing reports and never claim pending writer bytes were flushed", async () => {
  const mock = rangeOnlyLog("");
  const read = await mock.reader.read({ file, full: true });
  assert.equal(read.text, "");
  assert.equal(read.effectiveTailBytes, 0);
  assert.equal(read.serverTailNotice, true);
  assert.equal(read.truncated, false);
  assert.equal(read.sizeBytesBefore, "0");
  assert.equal(read.sizeBytesAfter, "0");
  assert.match(read.consistency, /does not open file or flush/);
  assert.deepEqual(mock.ranges, [{ valueType: "integer", lexicalValue: "0" }]);
  assert.equal(mock.fileOpens, 0);
  assert.equal(mock.reports, 2);
  const grown = rangeOnlyLog("");
  grown.afterRead(() => grown.update("12:00:00 INFO new\n"));
  await assert.rejects(grown.reader.read({ file }), { code: "LOG_CHANGED" });
  assert.equal(grown.ranges.length, 1);
  const malformed = rangeOnlyLog("");
  malformed.setNotice(notice(0) + "unexpected body");
  await assert.rejects(malformed.reader.read({ file, full: true }), {
    code: "LOG_RESPONSE_INVALID",
  });
});

test("64-bit reported sizes stay lexical while tail ranges remain bounded safe integers", async () => {
  let loads = 0;
  const size = "18446744073709551615";
  const gateway: LogGateway = {
    async call(_id, args) {
      if (args.target === "tools_report.server_log_report")
        return { valueType: "string", lexicalValue: report(file, size) };
      loads++;
      assert.deepEqual((args.args as unknown[])[1], { valueType: "integer", lexicalValue: "64" });
      return { valueType: "string", lexicalValue: notice(64) + "tail" };
    },
  };
  const reader = new LogReader(gateway, { maxResponseBytes: 1024 });
  const read = await reader.read({ file, tailBytes: 64 });
  assert.equal(read.file.sizeBytes, size);
  assert.equal(read.sizeBytesBefore, size);
  assert.equal(read.sizeBytesAfter, size);
  assert.equal(read.effectiveTailBytes, 64);
  assert.equal(read.truncated, true);
  await assert.rejects(reader.read({ file, full: true }), { code: "LOG_TOO_LARGE" });
  assert.equal(loads, 1);
});
