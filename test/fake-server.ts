import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConnectionConfig } from "../src/contracts.js";
import type { ServerPort } from "../src/hcm-server.js";
import { getNativeOperations } from "../src/native/gateway.js";
import { NATIVE_ENTRIES } from "../src/native/generated.js";
import { prepare } from "../src/native/validation.js";
import { WsHcmApiError } from "../src/protocol/error.js";
import { HcmRuntime } from "../src/runtime.js";

/**
 * runtimeDir теста, которому своя папка не нужна. Ответы files.read и журнал всё равно пишутся
 * на диск, поэтому папка временная и удаляется по выходе процесса, а не лежит в папке проекта.
 */
export const scratchRuntimeDir = mkdtempSync(join(tmpdir(), "wtctl-test-"));
process.on("exit", () => rmSync(scratchRuntimeDir, { recursive: true, force: true }));

export type Args = Record<string, any>;
/** Значение — ответ операции; функция считает ответ по аргументам и может бросить отказ. */
export type Answer = {} | null | undefined | ((args: Args, id: string) => unknown);
/** Ключ — id низкоуровневой операции; "*" — любая другая. */
export type Script = Record<string, Answer>;

export interface FakeServer extends ServerPort {
  /** Все вызовы по порядку, отказавшие тоже. */
  readonly calls: { id: string; args: Args }[];
  /** Заменить ответ посреди теста. */
  on(id: string, answer: Answer): this;
}

// Вместе с операциями сессии: их шлюз добавляет к реестру сам.
const schemas = new Map(
  [...NATIVE_ENTRIES.map(({ operation }) => operation), ...getNativeOperations()].map(
    (operation) => [operation.id, operation.inputSchema],
  ),
);

/**
 * Сервер, который отвечает по сценарию; вызов без ответа в сценарии — ошибка. Как и шлюз, принимает
 * только операции реестра и проверяет запрос по их схеме.
 */
export function fakeServer(script: Script = {}): FakeServer {
  const answers: Script = { ...script };
  const calls: FakeServer["calls"] = [];
  async function call(id: string, args: Args = {}) {
    calls.push({ id, args });
    const schema = schemas.get(id);
    if (!schema) throw new WsHcmApiError("protocol", "Unknown native operation");
    prepare(structuredClone(args), schema);
    const key = Object.hasOwn(answers, id) ? id : "*";
    if (!Object.hasOwn(answers, key)) throw new Error(`Unexpected server call: ${id}`);
    const answer = answers[key];
    return typeof answer === "function" ? answer(args, id) : answer;
  }
  return {
    calls,
    on(id, answer) {
      answers[id] = answer;
      return this;
    },
    call,
    // Ответ потоком: байты одним куском или перебираемые части; генератор может оборваться ошибкой.
    async stream(id, args, read) {
      const answer = await call(id, args);
      const parts = (answer instanceof Uint8Array ? [answer] : answer) as
        Iterable<Uint8Array> | AsyncIterable<Uint8Array>;
      return read(
        (async function* () {
          yield* parts;
        })(),
      );
    },
  };
}

/** Отказ сервера, как его отдаёт шлюз: WsHcmApiError soap-fault с operation и status. */
export function refusal(id: string, status = 500): WsHcmApiError {
  return new WsHcmApiError("soap-fault", "Internal Server Error", { operation: id, status });
}

/** Ответ-отказ для сценария: { "native.lds.putUrl": refuse() }. */
export function refuse(status?: number): Answer {
  return (_args: Args, id: string) => {
    throw refusal(id, status);
  };
}

/** runtime на подставном сервере с обычным тестовым подключением; config дополняет его. */
export function fakeRuntime(
  script: Script | FakeServer = {},
  config: Partial<ConnectionConfig> = {},
): { runtime: HcmRuntime; server: FakeServer } {
  const server =
    typeof script.call === "function" ? (script as FakeServer) : fakeServer(script as Script);
  const runtime = new HcmRuntime(
    {
      name: "t",
      baseUrl: "http://fixture.invalid/",
      timeoutMs: 1000,
      maxResponseBytes: 1024 * 1024,
      outputLimitBytes: 65536,
      runtimeDir: scratchRuntimeDir,
      permissions: { write: true, execute: true },
      ...config,
    },
    server,
  );
  return { runtime, server };
}
