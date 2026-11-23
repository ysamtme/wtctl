import assert from "node:assert/strict";
import { test } from "node:test";
import { HcmRuntime } from "../src/runtime.js";
import {
  parseAgentListJson,
  scriptRequest,
  scriptResult,
  setAgentWaitClock,
  waitForAgentThread,
} from "../src/scripts.js";
import { decodeRpcValue } from "../src/server-value.js";
import { escapeXml, findXmlNode, parseXml } from "../src/protocol/xml.js";
import { fakeRuntime, refusal, scratchRuntimeDir } from "./fake-server.js";

const fields =
  '<error VALUE-TYPE="integer">0</error><error_text VALUE-TYPE="string"/><ticks VALUE-TYPE="integer">7</ticks><result VALUE-TYPE="Array"><e VALUE-TYPE="Object"><id VALUE-TYPE="integer">9223372036854775807</id><text VALUE-TYPE="string">Текст &amp; &lt;tag&gt; 😀</text><flags VALUE-TYPE="Array"><e VALUE-TYPE="bool">1</e><e VALUE-TYPE="null"/></flags></e></result><columns VALUE-TYPE="Array"/><data VALUE-TYPE="Object"/><total VALUE-TYPE="integer">1</total>';
const resultXml = (body: string): string =>
  `<ResultData><Result VALUE-TYPE="Object">${body}</Result></ResultData>`;
const syntheticExecutionId = "hcm_inline_00000000000000000000000000000000";

function fixture(responseFields = fields) {
  const calls: { url: URL; body: string }[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const body = String(init?.body ?? "");
    const url = new URL(String(input));
    calls.push({ url, body });
    const method = /<soap:Body><([A-Za-z]+)/.exec(body)?.[1];
    if (!method)
      return new Response("<html>fixture</html>", {
        headers: { "set-cookie": "SessionID=fixture-http" },
      });
    const content =
      method === "OpenSession"
        ? "<SessionID>42</SessionID>"
        : method === "CallMethod"
          ? resultXml(responseFields)
          : "";
    return new Response(
      `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope/"><soap:Body><${method}Response>${content}</${method}Response></soap:Body></soap:Envelope>`,
      { headers: { "content-type": "application/soap+xml" } },
    );
  };
  const runtime = new HcmRuntime({
    name: "fixture",
    baseUrl: "http://fixture.invalid/",
    username: "fixture",
    password: "synthetic-secret",
    timeoutMs: 1000,
    maxResponseBytes: 1024 * 1024,
    outputLimitBytes: 24000,
    runtimeDir: scratchRuntimeDir,
    permissions: { write: false, execute: true },
    fetch,
  });
  return { calls, runtime };
}

test("временные запросы коллекции экранируют код, отключают кэш и не выделяют и не сохраняют объект", async () => {
  const fixtureValue = fixture();
  const code = 'RESULT=[{text:"<& 😀"}];';
  try {
    const result = await fixtureValue.runtime.call("execute.script", { code });
    assert.equal(result.ok, true, JSON.stringify(result));
    const { executionId, ...data } = result.data as { executionId: string };
    assert.match(executionId, /^hcm_inline_[a-f0-9]{32}$/);
    assert.deepEqual(data, {
      result: [{ id: "9223372036854775807", text: "Текст & <tag> 😀", flags: ["1", null] }],
    });
    const call = fixtureValue.calls.find((item) => item.url.pathname === "/api/spxml/CallMethod")!;
    assert.ok(
      call.body.includes(
        "<LibName>ms_tools</LibName><MethodName>evaluate_remote_collection_obj</MethodName>",
      ),
    );
    assert.ok(
      call.body.includes(
        '<arg-0><remote_collection SPXML-FORM="x-local://wtv/wtv_remote_collection.xmd" SPXML-FORM-ELEM="remote_collection">',
      ),
    );
    const document = parseXml(call.body);
    assert.equal(findXmlNode(document, "code"), executionId);
    assert.equal(findXmlNode(document, "script"), code);
    assert.ok(call.body.includes("<use_cache>0</use_cache>"));
    assert.equal(
      fixtureValue.calls.filter((item) => /<PutDoc |<GetNewObjectID |<Eval /.test(item.body))
        .length,
      0,
    );
  } finally {
    await fixtureValue.runtime.close();
  }
  assert.ok(fixtureValue.calls.some((item) => item.url.pathname === "/spxml_web/main.htm"));
  assert.ok(fixtureValue.calls.some((item) => item.body.includes("<CloseSession ")));
  assert.ok(fixtureValue.calls.some((item) => item.url.pathname.endsWith("/logout.htm")));
  assert.ok(fixtureValue.calls.some((item) => item.url.pathname.endsWith("/logout2.htm")));
  assert.notDeepEqual(
    scriptRequest(code),
    scriptRequest(code),
    "a fresh marker must prevent accidental identity or cache reuse",
  );
});

test("params попадают в код как PARAMS в первой строке; всё, кроме объекта, отклоняется без отправки", () => {
  const params = { name: 'Иван "и" \\ 😀', ids: ["0x1"], n: 1.5, none: null };
  const code = "// первая строка\nRESULT = [PARAMS.name];";
  const xml = (scriptRequest(code, params).args as { lexicalValue: { xml: string } }[])[0]!
    .lexicalValue.xml;
  const sent = findXmlNode(parseXml(xml), "script") as string;
  const [, encoded, rest] = /^var PARAMS = ParseJson\(.*?"([A-Za-z0-9+/=]+)".*?\); (.*)$/s.exec(
    sent,
  )!;
  assert.deepEqual(JSON.parse(Buffer.from(encoded!, "base64").toString()), params);
  assert.equal(rest, code);
  for (const wrong of [[1], "x", null])
    assert.throws(
      () => scriptRequest(code, wrong),
      (error: unknown) => (error as { code?: string }).code === "INVALID_ARGUMENT",
    );
});

function agentListXml(rawJson: string | null): unknown {
  return parseXml(
    rawJson === null
      ? '<ResultData><Result VALUE-TYPE="null"/></ResultData>'
      : `<ResultData><Result VALUE-TYPE="string">${escapeXml(rawJson)}</ResultData>`.replace(
          "</ResultData>",
          "</Result></ResultData>",
        ),
  );
}

function agentLaunchXml(row: Record<string, { type: string; value: string }>): unknown {
  const inner = Object.entries(row)
    .map(([key, { type, value }]) => `<${key} VALUE-TYPE="${type}">${escapeXml(value)}</${key}>`)
    .join("");
  return parseXml(
    resultXml(
      fields.replace(
        /<result .*<\/result>/,
        `<result VALUE-TYPE="Array"><e VALUE-TYPE="Object">${inner}</e></result>`,
      ),
    ),
  );
}

function virtualClock() {
  let current = 10_000;
  const sleeps: number[] = [];
  return {
    sleeps,
    advance: (ms: number) => {
      current += ms;
    },
    clock: {
      now: () => current,
      sleep: (ms: number, signal?: AbortSignal) => {
        if (signal !== undefined) {
          // Сторожевой таймер опроса: в синхронных тестах срабатывает только если вызвали abort.
          return new Promise<void>((resolve) => {
            if (signal.aborted) {
              resolve();
              return;
            }
            signal.addEventListener("abort", () => resolve(), { once: true });
          });
        }
        sleeps.push(ms);
        current += ms;
        return Promise.resolve();
      },
    },
  };
}

test("parseAgentListJson сохраняет 64-битный UniqueId строкой, дедуплицирует и сортирует свежие сверху", () => {
  const raw = `[
    {"id":"5875139220214983888","code":"job_a","name":"Job A","started":"2026-11-20T13:09:37+00:00","status":1,"roleUID":"role-1","UniqueId":3102754751613348050},
    {"id":"5875139220214983888","code":"job_a","name":"Job A","started":"2026-11-20T13:09:37+00:00","finished":"2026-11-20T13:09:39+00:00","status":2,"roleUID":"role-1","UniqueId":3102754751613348050},
    {"id":"5875139220214983889","code":"job_b","name":"Job B","started":"2026-11-20T12:00:00+00:00","finished":"2026-11-20T12:00:05+00:00","status":3,"roleUID":"role-1","UniqueId":9223372036854775807},
    {"id":"5875139220214983890","code":"job_c","name":"Job C","started":"2026-11-20T13:10:00+00:00","status":1,"roleUID":"role-2","UniqueId":3102754751613348051}
  ]`;
  const parsed = parseAgentListJson(raw);
  assert.deepEqual(parsed, [
    {
      id: "5875139220214983890",
      code: "job_c",
      name: "Job C",
      status: "running",
      threadId: "3102754751613348051",
      roleUID: "role-2",
      startedAt: "2026-11-20T13:10:00",
    },
    {
      id: "5875139220214983888",
      code: "job_a",
      name: "Job A",
      status: "finished",
      threadId: "3102754751613348050",
      roleUID: "role-1",
      startedAt: "2026-11-20T13:09:37",
      finishedAt: "2026-11-20T13:09:39",
    },
    {
      id: "5875139220214983889",
      code: "job_b",
      name: "Job B",
      status: "cancelled",
      threadId: "9223372036854775807",
      roleUID: "role-1",
      startedAt: "2026-11-20T12:00:00",
      finishedAt: "2026-11-20T12:00:05",
    },
  ]);
  assert.deepEqual(parseAgentListJson(""), []);
  assert.throws(
    () => parseAgentListJson("{bad"),
    (error: unknown) => (error as { code?: string }).code === "AGENT_STATUS_RESPONSE",
  );
});

test("agents.run отмечает, что сервер писал в лог", async () => {
  const answer = agentLaunchXml({
    started: { type: "bool", value: "1" },
    threadId: { type: "string", value: "3102754751613348050" },
    from: { type: "string", value: "2026-10-09T20:31:17+00:00" },
  });
  const { runtime } = fakeRuntime({ "web.rpc.call": answer });
  let wrote = 0;
  (runtime as any).logs.serverWroteLog = () => wrote++;
  try {
    assert.equal((await runtime.call("agents.run", { id: "0x10", wait: false })).ok, true);
    assert.equal(wrote, 1);
  } finally {
    await runtime.close();
  }
});

test("agents.run запускает отдельный поток (bInPlace=false), опрашивает по 64-битному threadId и проверяет аргументы", async () => {
  const threadId = "3102754751613348050";
  const roleUID = "011283d5-7ec8-42f6-a3f4-d3c6a72545d5";
  let listCalls = 0;
  const fixtureValue = fixture(
    fields.replace(
      /<result .*<\/result>/,
      `<result VALUE-TYPE="Array"><e VALUE-TYPE="Object"><started VALUE-TYPE="bool">1</started><alreadyRunning VALUE-TYPE="bool">0</alreadyRunning><threadId VALUE-TYPE="string">${threadId}</threadId><codeType VALUE-TYPE="string">js</codeType><roleUID VALUE-TYPE="string">${roleUID}</roleUID><from VALUE-TYPE="string">2026-10-09T20:31:17+00:00</from><to VALUE-TYPE="string">2026-10-09T20:31:17+00:00</to></e></result>`,
    ),
  );
  // Подменяем fetch, чтобы отличать запуск (web.rpc.call) от опроса списка запусков (native.rpc.call).
  const baseFetch = fixtureValue.runtime.config.fetch!;
  const calls = fixtureValue.calls;
  const pollFetch: typeof globalThis.fetch = async (input, init) => {
    const body = String(init?.body ?? "");
    if (body.includes("<MethodName>amgr_get_agent_list_json</MethodName>")) {
      listCalls++;
      const status = listCalls === 1 ? 1 : 2;
      const finished = status === 2 ? ',"finished":"2026-10-09T20:31:19+00:00"' : "";
      const rawJson = `[{"id":"16","code":"demo","name":"Demo","started":"2026-10-09T20:31:17+00:00"${finished},"status":${status},"roleUID":"${roleUID}","UniqueId":${threadId}}]`;
      return new Response(
        `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope/"><soap:Body><CallMethodResponse><ResultData><Result VALUE-TYPE="string">${escapeXml(rawJson)}</Result></ResultData></CallMethodResponse></soap:Body></soap:Envelope>`,
        { headers: { "content-type": "application/soap+xml" } },
      );
    }
    return baseFetch(input, init);
  };
  const runtime = new HcmRuntime({
    ...fixtureValue.runtime.config,
    fetch: pollFetch,
  });
  const vc = virtualClock();
  setAgentWaitClock(vc.clock);
  try {
    const result = await runtime.call("agents.run", {
      id: "0x10",
      objectIds: ["0x11", "18"],
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    const { hint, ...data } = result.data as { hint: string };
    assert.deepEqual(data, {
      started: true,
      status: "finished",
      threadId,
      roleUID,
      startedAt: "2026-10-09T20:31:17",
      finishedAt: "2026-10-09T20:31:19",
    });
    assert.match(hint, /xhttp/);
    assert.equal(listCalls, 2);
    assert.deepEqual(vc.sleeps, [250]);

    const call = calls.find((item) => item.url.pathname === "/api/spxml/CallMethod")!;
    assert.ok(call.body.includes("doc.TopElem.obj.Clear()"));
    assert.ok(call.body.includes("run_agent(PARAMS.objectId, PARAMS.objectIds, Date(), false)"));
    assert.ok(call.body.includes("PeekMessagesFromQueue"));
    const encoded = /Base64Decode\(&quot;([A-Za-z0-9+/=]+)&quot;\)/.exec(call.body)![1]!;
    assert.deepEqual(JSON.parse(Buffer.from(encoded, "base64").toString()), {
      id: "16",
      objectId: null,
      objectIds: "17;18",
      allowConcurrent: false,
    });

    const before = calls.length;
    for (const args of [
      { id: '1"; evil()' },
      { id: "1", objectIds: ["x"] },
      { id: 1 },
      { id: "1", wait: false, waitTimeoutMs: 5000 },
      { id: "1", waitTimeoutMs: 500 },
      { id: "1", waitTimeoutMs: 3_600_001 },
    ]) {
      const refused = await runtime.call("agents.run", args);
      assert.equal(refused.error?.code, "INVALID_ARGUMENT", JSON.stringify(args));
      assert.equal(refused.error?.mutationOutcome, "not_sent");
    }
    assert.equal(calls.length, before);
  } finally {
    setAgentWaitClock(undefined);
    await runtime.close();
    await fixtureValue.runtime.close();
  }
});

test("agents.run: wait:false, защита от дубля, отмена, таймаут (confirmed), сбой опроса без повтора и C#", async () => {
  const threadId = "3102754751613348050";
  const roleUID = "role-uid-1";

  // 1. wait:false не опрашивает список запусков и возвращает status: running.
  {
    const { runtime, server } = fakeRuntime({
      "web.rpc.call": agentLaunchXml({
        started: { type: "bool", value: "1" },
        alreadyRunning: { type: "bool", value: "0" },
        threadId: { type: "string", value: threadId },
        codeType: { type: "string", value: "js" },
        roleUID: { type: "string", value: roleUID },
        from: { type: "string", value: "2026-10-09T20:31:17+00:00" },
      }),
    });
    try {
      const res = await runtime.call("agents.run", { id: "0x10", wait: false });
      assert.equal(res.ok, true, JSON.stringify(res));
      assert.deepEqual(
        { ...(res.data as Record<string, unknown>), hint: undefined },
        {
          started: true,
          status: "running",
          threadId,
          roleUID,
          startedAt: "2026-10-09T20:31:17",
          hint: undefined,
        },
      );
      assert.equal(server.calls.filter((c) => c.id === "native.rpc.call").length, 0);
    } finally {
      await runtime.close();
    }
  }

  // 2. Дублирующий запуск при allowConcurrent:false отклоняется с started:false и текущим threadId.
  {
    const runningInfo = `{"id":"16","code":"demo","name":"Demo","started":"2026-10-09T20:30:00+00:00","status":1,"roleUID":"${roleUID}","UniqueId":${threadId}}`;
    const { runtime } = fakeRuntime({
      "web.rpc.call": agentLaunchXml({
        started: { type: "bool", value: "0" },
        alreadyRunning: { type: "bool", value: "1" },
        runningInfo: { type: "string", value: runningInfo },
        from: { type: "string", value: "2026-10-09T20:31:17+00:00" },
      }),
    });
    try {
      const res = await runtime.call("agents.run", { id: "0x10" });
      assert.equal(res.ok, true);
      assert.equal((res.data as any).started, false);
      assert.equal((res.data as any).status, "running");
      assert.equal((res.data as any).threadId, threadId);
      assert.equal((res.data as any).roleUID, roleUID);
      assert.equal((res.data as any).startedAt, "2026-10-09T20:30:00");
      assert.match((res.data as any).hint, /allowConcurrent/);
    } finally {
      await runtime.close();
    }
  }

  // 3. Таймаут ожидания возвращает AGENT_WAIT_TIMEOUT с mutationOutcome: confirmed и threadId.
  {
    const vc = virtualClock();
    setAgentWaitClock(vc.clock);
    const { runtime, server } = fakeRuntime({
      "web.rpc.call": agentLaunchXml({
        started: { type: "bool", value: "1" },
        alreadyRunning: { type: "bool", value: "0" },
        threadId: { type: "string", value: threadId },
        codeType: { type: "string", value: "js" },
        from: { type: "string", value: "2026-10-09T20:31:17+00:00" },
      }),
      "native.rpc.call": agentListXml(
        `[{"id":"16","code":"demo","name":"Demo","started":"2026-10-09T20:31:17+00:00","status":1,"roleUID":"${roleUID}","UniqueId":${threadId}}]`,
      ),
    });
    try {
      const res = await runtime.call("agents.run", { id: "0x10", waitTimeoutMs: 1000 });
      assert.equal(res.ok, false);
      assert.equal(res.error?.code, "AGENT_WAIT_TIMEOUT");
      assert.equal(res.error?.mutationOutcome, "confirmed");
      assert.equal(res.error?.details?.started, true);
      assert.equal(res.error?.details?.threadId, threadId);
      assert.equal(res.error?.details?.roleUID, roleUID);
      assert.equal(res.error?.details?.startedAt, "2026-10-09T20:31:17");
      assert.deepEqual(vc.sleeps, [250, 500, 250]);
      assert.equal(server.calls.filter((c) => c.id === "web.rpc.call").length, 1);
    } finally {
      setAgentWaitClock(undefined);
      await runtime.close();
    }
  }

  // 4. Сбой опроса после подтверждённого запуска возвращает AGENT_STATUS_FAILED (confirmed) и не повторяет запуск.
  {
    const { runtime, server } = fakeRuntime({
      "web.rpc.call": agentLaunchXml({
        started: { type: "bool", value: "1" },
        alreadyRunning: { type: "bool", value: "0" },
        threadId: { type: "string", value: threadId },
        codeType: { type: "string", value: "js" },
        roleUID: { type: "string", value: roleUID },
        from: { type: "string", value: "2026-10-09T20:31:17+00:00" },
      }),
      "native.rpc.call": () => {
        throw refusal("native.rpc.call");
      },
    });
    try {
      const res = await runtime.call("agents.run", { id: "0x10" });
      assert.equal(res.ok, false);
      assert.equal(res.error?.code, "AGENT_STATUS_FAILED");
      assert.equal(res.error?.mutationOutcome, "confirmed");
      assert.equal(res.error?.details?.started, true);
      assert.equal(res.error?.details?.threadId, threadId);
      assert.equal(res.error?.details?.roleUID, roleUID);
      assert.equal(server.calls.filter((c) => c.id === "web.rpc.call").length, 1);
    } finally {
      await runtime.close();
    }
  }

  // 5. Агент на C# не зависает в ожидании и честно отвечает status: unknown.
  {
    const { runtime, server } = fakeRuntime({
      "web.rpc.call": agentLaunchXml({
        started: { type: "bool", value: "1" },
        alreadyRunning: { type: "bool", value: "0" },
        threadId: { type: "string", value: threadId },
        codeType: { type: "string", value: "cs" },
        roleUID: { type: "string", value: roleUID },
        from: { type: "string", value: "2026-10-09T20:31:17+00:00" },
      }),
    });
    try {
      const res = await runtime.call("agents.run", { id: "0x10" });
      assert.equal(res.ok, true);
      assert.equal((res.data as any).status, "unknown");
      assert.match((res.data as any).hint, /C#/);
      assert.equal(server.calls.filter((c) => c.id === "native.rpc.call").length, 0);
    } finally {
      await runtime.close();
    }
  }

  // 6. Вытеснение потока из последних 100 завершённых после наблюдения running возвращает status: unknown.
  {
    const vc = virtualClock();
    setAgentWaitClock(vc.clock);
    let poll = 0;
    const hundredNewer = JSON.stringify(
      Array.from({ length: 100 }, (_, i) => ({
        id: "99",
        code: "other",
        name: "Other",
        started: "2026-10-09T20:31:18+00:00",
        finished: "2026-10-09T20:31:19+00:00",
        status: 2,
        roleUID,
        UniqueId: String(4000000000000000000n + BigInt(i)),
      })),
    );
    const { runtime } = fakeRuntime({
      "web.rpc.call": agentLaunchXml({
        started: { type: "bool", value: "1" },
        alreadyRunning: { type: "bool", value: "0" },
        threadId: { type: "string", value: threadId },
        codeType: { type: "string", value: "js" },
        from: { type: "string", value: "2026-10-09T20:31:17+00:00" },
      }),
      "native.rpc.call": () => {
        poll++;
        return agentListXml(
          poll === 1
            ? `[{"id":"16","code":"demo","name":"Demo","started":"2026-10-09T20:31:17+00:00","status":1,"roleUID":"${roleUID}","UniqueId":${threadId}}]`
            : hundredNewer,
        );
      },
    });
    try {
      const res = await runtime.call("agents.run", { id: "0x10", waitTimeoutMs: 10_000 });
      assert.equal(res.ok, true);
      assert.equal((res.data as any).status, "unknown");
      assert.equal((res.data as any).threadId, threadId);
      assert.equal((res.data as any).roleUID, roleUID);
    } finally {
      setAgentWaitClock(undefined);
      await runtime.close();
    }
  }

  // 7. Неполный ответ запуска: пустой RESULT -> SCRIPT_RESPONSE (indeterminate), started:"1" без threadId -> SCRIPT_RESPONSE (confirmed).
  {
    const emptyResult = parseXml(
      resultXml(fields.replace(/<result .*<\/result>/, '<result VALUE-TYPE="Array"/>')),
    );
    const { runtime } = fakeRuntime({ "web.rpc.call": emptyResult });
    try {
      const res = await runtime.call("agents.run", { id: "0x10" });
      assert.equal(res.ok, false);
      assert.equal(res.error?.code, "SCRIPT_RESPONSE");
      assert.equal(res.error?.mutationOutcome, "indeterminate");
    } finally {
      await runtime.close();
    }
  }
  {
    const noThread = agentLaunchXml({
      started: { type: "bool", value: "1" },
      alreadyRunning: { type: "bool", value: "0" },
      threadId: { type: "string", value: "" },
      codeType: { type: "string", value: "js" },
      from: { type: "string", value: "2026-10-09T20:31:17+00:00" },
    });
    const { runtime } = fakeRuntime({ "web.rpc.call": noThread });
    try {
      for (const wait of [false, true]) {
        const res = await runtime.call("agents.run", { id: "0x10", wait });
        assert.equal(res.ok, false);
        assert.equal(res.error?.code, "SCRIPT_RESPONSE");
        assert.equal(res.error?.mutationOutcome, "confirmed");
        assert.equal(res.error?.details?.started, true);
      }
    } finally {
      await runtime.close();
    }
  }
});

test("waitForAgentThread ограничивает длительность медленного запроса списка дедлайном и отменяет AbortSignal", async () => {
  let aborted = false;
  const started = Date.now();
  const waited = await waitForAgentThread(
    (signal) =>
      new Promise((resolve) => {
        signal.addEventListener(
          "abort",
          () => {
            aborted = true;
          },
          { once: true },
        );
        const timer = setTimeout(() => {
          resolve([
            {
              id: "16",
              code: "demo",
              name: "Demo",
              status: "finished",
              threadId: "3102754751613348050",
              roleUID: "role-1",
              startedAt: "2026-10-09T20:31:17",
              finishedAt: "2026-10-09T20:31:24",
            },
          ]);
        }, 400);
        timer.unref();
      }),
    {
      threadId: "3102754751613348050",
      timeoutMs: 60,
      mode: "run",
      initialStartedAt: "2026-10-09T20:31:17",
    },
  );
  assert.equal(waited.kind, "timeout");
  assert.equal(aborted, true);
  assert.ok(Date.now() - started < 300);
});

test("agents.status читает без execute, фильтрует по id/threadId/status/limit и поддерживает wait по threadId", async () => {
  const thread1 = "3102754751613348050";
  const thread2 = "3102754751613348051";
  let polls = 0;
  const { runtime } = fakeRuntime(
    {
      "native.rpc.call": () => {
        polls++;
        if (polls <= 2) {
          return agentListXml(`[
            {"id":"16","code":"job1","name":"Job 1","started":"2026-11-20T10:00:00+00:00","status":1,"roleUID":"role-1","UniqueId":${thread1}},
            {"id":"17","code":"job2","name":"Job 2","started":"2026-11-20T09:00:00+00:00","finished":"2026-11-20T09:01:00+00:00","status":2,"roleUID":"role-1","UniqueId":${thread2}}
          ]`);
        }
        return agentListXml(`[
          {"id":"16","code":"job1","name":"Job 1","started":"2026-11-20T10:00:00+00:00","finished":"2026-11-20T10:00:05+00:00","status":3,"roleUID":"role-1","UniqueId":${thread1}}
        ]`);
      },
    },
    { permissions: { write: false, execute: false } },
  );
  const vc = virtualClock();
  setAgentWaitClock(vc.clock);
  try {
    // Фильтр по 0x-ID и status.
    const filtered = await runtime.call("agents.status", { id: "0x10", status: "running" });
    assert.equal(filtered.ok, true, JSON.stringify(filtered));
    assert.equal((filtered.data as any).total, 1);
    assert.equal((filtered.data as any).runs[0].threadId, thread1);

    // Ожидание до отмены.
    const waited = await runtime.call("agents.status", { threadId: thread1, wait: true });
    assert.equal(waited.ok, true, JSON.stringify(waited));
    assert.equal((waited.data as any).runs[0].status, "cancelled");
    assert.equal((waited.data as any).runs[0].finishedAt, "2026-11-20T10:00:05");

    // Неверные сочетания аргументов отклоняются до запроса.
    assert.equal(
      (await runtime.call("agents.status", { wait: true })).error?.code,
      "INVALID_ARGUMENT",
    );
    assert.equal(
      (await runtime.call("agents.status", { threadId: thread1, waitTimeoutMs: 5000 })).error?.code,
      "INVALID_ARGUMENT",
    );
  } finally {
    setAgentWaitClock(undefined);
    await runtime.close();
  }

  // Таймаут ожидания в agents.status возвращает AGENT_WAIT_TIMEOUT без mutationOutcome (read).
  const vc2 = virtualClock();
  setAgentWaitClock(vc2.clock);
  const { runtime: roRuntime } = fakeRuntime(
    {
      "native.rpc.call": agentListXml(
        `[{"id":"16","code":"job1","name":"Job 1","started":"2026-11-20T10:00:00+00:00","status":1,"roleUID":"role-1","UniqueId":${thread1}}]`,
      ),
    },
    { permissions: { write: false, execute: false } },
  );
  try {
    const timedOut = await roRuntime.call("agents.status", {
      threadId: thread1,
      wait: true,
      waitTimeoutMs: 1000,
    });
    assert.equal(timedOut.ok, false);
    assert.equal(timedOut.error?.code, "AGENT_WAIT_TIMEOUT");
    assert.equal(timedOut.error?.mutationOutcome, undefined);
    assert.equal(timedOut.error?.details?.threadId, thread1);
  } finally {
    setAgentWaitClock(undefined);
    await roRuntime.close();
  }
});

test("agents.cancel требует write, сам находит roleUID в ag_running и отклоняет неработающий поток с AGENT_NOT_RUNNING (not_sent)", async () => {
  const threadRunning = "3102754751613348050";
  const threadDone = "3102754751613348051";
  const roleUID = "role-uid-cancel";
  const listXml = agentListXml(`[
    {"id":"16","code":"job1","name":"Job 1","started":"2026-11-20T10:00:00+00:00","status":1,"roleUID":"${roleUID}","UniqueId":${threadRunning}},
    {"id":"17","code":"job2","name":"Job 2","started":"2026-11-20T09:00:00+00:00","finished":"2026-11-20T09:01:00+00:00","status":2,"roleUID":"${roleUID}","UniqueId":${threadDone}}
  ]`);
  const cancelOk = parseXml('<ResultData><Result VALUE-TYPE="bool">1</Result></ResultData>');

  // Без write — WRITE_DISABLED.
  const { runtime: ro } = fakeRuntime({}, { permissions: { write: false, execute: false } });
  try {
    assert.equal(
      (await ro.call("agents.cancel", { threadId: threadRunning })).error?.code,
      "WRITE_DISABLED",
    );
  } finally {
    await ro.close();
  }

  // С write (без execute!): находит roleUID, отправляет amgr_cancel_agent строками; завершённый/отсутствующий → AGENT_NOT_RUNNING.
  const { runtime, server } = fakeRuntime(
    {
      "native.rpc.call": (args) =>
        args.target === "tools.amgr_get_agent_list_json" ? listXml : cancelOk,
    },
    { permissions: { write: true, execute: false } },
  );
  try {
    const ok = await runtime.call("agents.cancel", { threadId: threadRunning });
    assert.equal(ok.ok, true, JSON.stringify(ok));
    assert.equal((ok.data as any).cancelled, true);
    assert.equal((ok.data as any).threadId, threadRunning);
    assert.equal((ok.data as any).roleUID, roleUID);
    assert.equal((ok.data as any).mutationOutcome, "confirmed");
    const cancelCall = server.calls.find((c) => c.args.target === "tools.amgr_cancel_agent")!;
    assert.deepEqual(cancelCall.args.args, [
      { valueType: "string", lexicalValue: roleUID },
      { valueType: "string", lexicalValue: threadRunning },
    ]);

    const before = server.calls.filter((c) => c.args.target === "tools.amgr_cancel_agent").length;
    for (const id of [threadDone, "9999999999999999999"]) {
      const denied = await runtime.call("agents.cancel", { threadId: id });
      assert.equal(denied.ok, false);
      assert.equal(denied.error?.code, "AGENT_NOT_RUNNING");
      assert.equal(denied.error?.mutationOutcome, "not_sent");
    }
    assert.equal(
      server.calls.filter((c) => c.args.target === "tools.amgr_cancel_agent").length,
      before,
    );

    // С явным roleUID не запрашивает список запусков.
    const listBefore = server.calls.filter(
      (c) => c.args.target === "tools.amgr_get_agent_list_json",
    ).length;
    const direct = await runtime.call("agents.cancel", { threadId: threadRunning, roleUID });
    assert.equal(direct.ok, true);
    assert.equal(
      server.calls.filter((c) => c.args.target === "tools.amgr_get_agent_list_json").length,
      listBefore,
    );
  } finally {
    await runtime.close();
  }

  // На одиночном сервере 2025.2 roleUID пустой (""), и отмена идёт в очередь ag_cancel_ с пустым roleUID.
  const emptyRoleList = agentListXml(
    `[{"id":"16","code":"job1","name":"Job 1","started":"2026-11-20T10:00:00+00:00","status":1,"roleUID":"","UniqueId":${threadRunning}}]`,
  );
  const { runtime: standalone, server: standaloneServer } = fakeRuntime(
    {
      "native.rpc.call": (args) =>
        args.target === "tools.amgr_get_agent_list_json" ? emptyRoleList : cancelOk,
    },
    { permissions: { write: true, execute: false } },
  );
  try {
    const ok = await standalone.call("agents.cancel", { threadId: threadRunning });
    assert.equal(ok.ok, true, JSON.stringify(ok));
    assert.equal((ok.data as any).roleUID, "");
    const cancelCall = standaloneServer.calls.find(
      (c) => c.args.target === "tools.amgr_cancel_agent",
    )!;
    assert.deepEqual(cancelCall.args.args, [
      { valueType: "string", lexicalValue: "" },
      { valueType: "string", lexicalValue: threadRunning },
    ]);
  } finally {
    await standalone.close();
  }
});

test("agents.run и agents.status --wait дожидаются первого потока, даже если второй завершился раньше и удалил ag_info", async () => {
  const t1 = "3102754751613348050";
  const t2 = "3102754751613348051";
  const t2FinishedOnly = agentListXml(
    `[{"id":"16","code":"job1","name":"Job 1","started":"2026-11-20T10:00:01+00:00","finished":"2026-11-20T10:00:02+00:00","status":2,"roleUID":"","UniqueId":${t2}}]`,
  );
  const bothFinished = agentListXml(`[
    {"id":"16","code":"job1","name":"Job 1","started":"2026-11-20T10:00:01+00:00","finished":"2026-11-20T10:00:02+00:00","status":2,"roleUID":"","UniqueId":${t2}},
    {"id":"16","code":"job1","name":"Job 1","started":"2026-11-20T10:00:00+00:00","finished":"2026-11-20T10:00:07+00:00","status":2,"roleUID":"","UniqueId":${t1}}
  ]`);

  // t1 сначала был running, затем t2 завершился и удалил ag_info (в списке нет running вообще),
  // а t1 завершился только на 7-й секунде (6-й опрос > 2,75 с) при лимите 10 с.
  for (const op of ["agents.run", "agents.status"] as const) {
    let polls = 0;
    const { runtime } = fakeRuntime({
      "web.rpc.call": agentLaunchXml({
        started: { type: "bool", value: "1" },
        alreadyRunning: { type: "bool", value: "0" },
        threadId: { type: "string", value: t1 },
        codeType: { type: "string", value: "js" },
        from: { type: "string", value: "2026-11-20T10:00:00+00:00" },
      }),
      "native.rpc.call": () => {
        polls++;
        if (polls === 1) {
          return agentListXml(
            `[{"id":"16","code":"job1","name":"Job 1","started":"2026-11-20T10:00:00+00:00","status":1,"roleUID":"","UniqueId":${t1}}]`,
          );
        }
        return polls <= 5 ? t2FinishedOnly : bothFinished;
      },
    });
    const vc = virtualClock();
    setAgentWaitClock(vc.clock);
    try {
      const res =
        op === "agents.run"
          ? await runtime.call("agents.run", { id: "0x10", waitTimeoutMs: 10_000 })
          : await runtime.call("agents.status", {
              threadId: t1,
              wait: true,
              waitTimeoutMs: 10_000,
            });
      assert.equal(res.ok, true, `${op}: ${JSON.stringify(res)}`);
      if (op === "agents.run") {
        assert.equal((res.data as any).status, "finished");
        assert.equal((res.data as any).threadId, t1);
      } else {
        assert.equal((res.data as any).runs[0]?.status, "finished");
        assert.equal((res.data as any).runs[0]?.threadId, t1);
      }
      assert.equal(polls, 6);
    } finally {
      setAgentWaitClock(undefined);
      await runtime.close();
    }
  }
});

test("перехваченные ошибки серверного скрипта — это сбои с исходом записи indeterminate и собственным сообщением скрипта", async () => {
  const fixtureValue = fixture(
    fields
      .replace('<error VALUE-TYPE="integer">0</error>', '<error VALUE-TYPE="integer">1</error>')
      .replace(
        '<error_text VALUE-TYPE="string"/>',
        `<error_text VALUE-TYPE="string">Error evaluating collection 'hcm_inline_0'
no_such_var not defined
(eval,  Unknown source,   line 3)
(eval(),  x-local://wtv/wtv_remote_collection.xmd,   line 428)
(eval,  x-local://wtv/wtv_remote_collection.xmd,   line 428)</error_text>`,
      ),
  );
  try {
    const result = await fixtureValue.runtime.call("execute.script", { code: 'throw "example";' });
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "SCRIPT_FAILED");
    assert.equal(result.error?.mutationOutcome, "indeterminate");
    assert.equal(
      result.error?.details?.executionId,
      findXmlNode(
        parseXml(
          fixtureValue.calls.find((item) => item.url.pathname === "/api/spxml/CallMethod")!.body,
        ),
        "code",
      ),
    );
    assert.equal(
      result.error?.details?.scriptError,
      "no_such_var not defined\n(eval,  Unknown source,   line 3)",
    );
    assert.doesNotMatch(JSON.stringify(result), /wtv_remote_collection|Error evaluating/);
    assert.equal(
      fixtureValue.calls.filter((item) => item.url.pathname === "/api/spxml/CallMethod").length,
      1,
    );
  } finally {
    await fixtureValue.runtime.close();
  }
});

test("значения заголовков авторизации и cookie в ошибке кода закрыты до конца строки", async () => {
  const fixtureValue = fixture(
    fields
      .replace('<error VALUE-TYPE="integer">0</error>', '<error VALUE-TYPE="integer">1</error>')
      .replace(
        '<error_text VALUE-TYPE="string"/>',
        `<error_text VALUE-TYPE="string">HTTP 401. Authorization: Bearer tok456
Proxy-Authorization: Basic cHJveHk6c2VjcmV0
Cookie: a=1; sid=sid789; b=2
Set-Cookie: tail=sess321; Path=/
SessionID=sid654, повтор
сеанс JSESSIONID=sid111 устарел, access_token=tok222
{"password": "pw444", "Cookie":"a=1; sid=sid333"}
(eval,  Unknown source,   line 3)</error_text>`,
      ),
  );
  try {
    const result = await fixtureValue.runtime.call("execute.script", { code: "RESULT = [];" });
    assert.equal(result.error?.code, "SCRIPT_FAILED");
    assert.equal(
      result.error?.details?.scriptError,
      [
        "HTTP 401. Authorization: [redacted]",
        "Proxy-Authorization: [redacted]",
        "Cookie: [redacted]",
        "Set-Cookie: [redacted]",
        "SessionID=[redacted], повтор",
        "сеанс JSESSIONID=[redacted] устарел, access_token=[redacted]",
        '{"password": [redacted], "Cookie":[redacted]',
        "(eval,  Unknown source,   line 3)",
      ].join("\n"),
    );
  } finally {
    await fixtureValue.runtime.close();
  }
});

test("синтаксическая ошибка всего кода — not_sent, а вызванная eval() или throw в работающем коде — нет", async () => {
  const syntax = "JavaScript syntax error.\nUnknown source,   line 1";
  for (const [text, expected] of [
    [syntax, "not_sent"],
    [`${syntax}\n(eval(),  Unknown source,   line 1)`, "indeterminate"],
    ["JavaScript syntax error.\n(Unknown source,   line 1)", "indeterminate"],
    ["JavaScript syntax error.\n(eval,  Unknown source,   line 1)", "indeterminate"],
  ] as const) {
    const fixtureValue = fixture(
      fields
        .replace('<error VALUE-TYPE="integer">0</error>', '<error VALUE-TYPE="integer">1</error>')
        .replace(
          '<error_text VALUE-TYPE="string"/>',
          `<error_text VALUE-TYPE="string">${text}</error_text>`,
        ),
    );
    try {
      const result = await fixtureValue.runtime.call("execute.script", { code: "x = ;" });
      assert.equal(result.error?.mutationOutcome, expected);
      assert.match(
        result.error?.hint ?? "",
        expected === "not_sent" ? /не выполнялся/ : /только читал, его можно повторить/,
      );
    } finally {
      await fixtureValue.runtime.close();
    }
  }
});

test("право execute и знаки XML отклоняют запрос локально, код больше 1 МиБ уходит целиком, а проверка типизированного результата находит смысловые сбои", async () => {
  const invalid = fixture();
  try {
    const result = await invalid.runtime.call("execute.script", { code: "\0" });
    assert.equal(result.ok, false);
    assert.equal(result.error?.mutationOutcome, "not_sent");
    assert.equal(invalid.calls.length, 0);
  } finally {
    await invalid.runtime.close();
  }
  const large = fixture();
  try {
    const code = "я".repeat(1_100_000);
    assert.equal((await large.runtime.call("execute.script", { code })).ok, true);
    assert.ok(large.calls.some((item) => item.body.includes(code)));
  } finally {
    await large.runtime.close();
  }
  const runtime = new HcmRuntime({
    name: "readonly",
    baseUrl: "http://fixture.invalid/",
    timeoutMs: 1000,
    maxResponseBytes: 1024,
    outputLimitBytes: 1024,
    runtimeDir: scratchRuntimeDir,
    permissions: { write: true, execute: false },
  });
  try {
    assert.equal(
      (await runtime.call("execute.script", { code: "RESULT=[];" })).error?.code,
      "EXECUTE_DISABLED",
    );
  } finally {
    await runtime.close();
  }
  assert.throws(() =>
    scriptResult(
      parseXml(
        resultXml(fields.replace('<result VALUE-TYPE="Array">', '<result VALUE-TYPE="Object">')),
      ),
      syntheticExecutionId,
    ),
  );
  assert.throws(
    () =>
      scriptResult(
        parseXml(
          resultXml(
            fields.replace(
              '<total VALUE-TYPE="integer">1</total>',
              '<total VALUE-TYPE="integer">-1</total>',
            ),
          ),
        ),
        syntheticExecutionId,
      ),
    /счётчиками/,
  );
  assert.throws(
    () => decodeRpcValue({ "@_VALUE-TYPE": "Array", unexpected: { "@_VALUE-TYPE": "string" } }),
    /посторонние элементы/,
  );
  for (const malformed of [
    { "@_VALUE-TYPE": "Array", "#text": "lost" },
    { "@_VALUE-TYPE": "null", child: { "@_VALUE-TYPE": "string" } },
    { "@_VALUE-TYPE": "undefined", "#text": "lost" },
    { "@_VALUE-TYPE": "XmDoc" },
    { "@_VALUE-TYPE": "future-scalar", "#text": "lost" },
    { child: "xml" },
  ])
    assert.throws(
      () => decodeRpcValue(malformed),
      (error: unknown) => (error as { code?: string }).code === "SCRIPT_RESPONSE",
    );
  assert.deepEqual(decodeRpcValue({ "@_VALUE-TYPE": "Array", "#text": " \n" }), []);
  assert.equal(decodeRpcValue({ "@_VALUE-TYPE": "null" }), null);
  assert.throws(
    () =>
      scriptResult(
        parseXml(
          resultXml(
            fields.replace('<error VALUE-TYPE="integer">0</error>', '<error VALUE-TYPE="string"/>'),
          ),
        ),
        syntheticExecutionId,
      ),
    /кода ошибки/,
  );
  let nested: unknown = { "@_VALUE-TYPE": "string", "#text": "end" };
  for (let depth = 0; depth < 66; depth++) nested = { "@_VALUE-TYPE": "Array", e: nested };
  assert.throws(() => decodeRpcValue(nested), /вложен глубже/);
});
