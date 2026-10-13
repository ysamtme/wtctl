import assert from "node:assert/strict";
import { test } from "node:test";
import { query } from "../../src/protocol/transport.js";

// Декодер запросов Datex декодирует проценты без '+' в стиле форм.
// URLSearchParams.get скрыл бы дефект совместимости в эталоне теста.
function datexQuery(path: string): Record<string, string> {
  return Object.fromEntries(
    path
      .split("?")[1]!
      .split("&")
      .map((part) => {
        const equal = part.indexOf("=");
        return [
          decodeURIComponent(part.slice(0, equal)),
          decodeURIComponent(part.slice(equal + 1)),
        ];
      }),
  );
}

test("кодирование запроса в протоколе сохраняет пробелы, обычный плюс, процент, Unicode и CRLF при декодировании Datex", () => {
  const values = {
    "key with +": "ASCII & = + % <xml>",
    unicode: "цвет 😀 + пробел\r\nsecond\tline",
    url: "x-local://fixture/encoded%20directory/space + literal.ico",
    empty: "",
    number: 37.25,
    bool: false,
    omitted: undefined,
    nullValue: null,
  };
  const result = query("/api/spxml2/std_encrypt", values);
  assert.deepEqual(datexQuery(result), {
    "key with +": values["key with +"],
    unicode: values.unicode,
    url: values.url,
    empty: "",
    number: "37.25",
    bool: "false",
  });
  assert.ok(!result.includes("+"), "wire spaces must use %20; literal plus uses %2B");
  assert.match(result, /%20/);
  assert.match(result, /%2B/);
  assert.match(result, /%F0%9F%98%80/);
  assert.match(result, /%0D%0A/);
});
