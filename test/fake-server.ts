import type { ConnectionConfig } from "../src/contracts.js";
import type { ServerPort } from "../src/hcm-server.js";
import { NATIVE_ENTRIES } from "../src/native/generated.js";
import { prepare } from "../src/native/validation.js";
import { WsHcmApiError } from "../src/protocol/error.js";
import { HcmRuntime } from "../src/runtime.js";

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

const schemas = new Map(
  NATIVE_ENTRIES.map(({ operation }) => [operation.id, operation.inputSchema]),
);

/**
 * Сервер, который отвечает по сценарию; вызов без ответа в сценарии — ошибка. Как и шлюз, принимает
 * только операции реестра и проверяет запрос по их схеме.
 */
export function fakeServer(script: Script = {}): FakeServer {
  const answers: Script = { ...script };
  const calls: FakeServer["calls"] = [];
  return {
    calls,
    on(id, answer) {
      answers[id] = answer;
      return this;
    },
    async call(id, args = {}) {
      calls.push({ id, args });
      const schema = schemas.get(id);
      if (!schema) throw new WsHcmApiError("protocol", "Unknown native operation");
      prepare(structuredClone(args), schema);
      const key = Object.hasOwn(answers, id) ? id : "*";
      if (!Object.hasOwn(answers, key)) throw new Error(`Unexpected server call: ${id}`);
      const answer = answers[key];
      return typeof answer === "function" ? answer(args, id) : answer;
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
      runtimeDir: ".unused",
      permissions: { write: true, execute: true },
      ...config,
    },
    server,
  );
  return { runtime, server };
}
