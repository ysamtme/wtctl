import { AsyncLocalStorage } from "node:async_hooks";
import { HcmError, inputObject } from "./errors.js";
import type { OperationEffect } from "./contracts.js";
import { nativeEffect } from "./native/gateway.js";
import { ArgumentError, WsHcmApiError } from "./protocol/error.js";
import { scriptResult, type ScriptData } from "./scripts.js";
import { refusedAtDoor, type WriteOutcome } from "./write-outcome.js";

const activeSignal = new AsyncLocalStorage<AbortSignal | undefined>();

/** Выполнить асинхронный блок с общим AbortSignal для всех запросов к порту внутри него. */
export function withRequestSignal<T>(
  signal: AbortSignal | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  return signal === undefined ? fn() : activeSignal.run(signal, fn);
}

/** Шов к серверу HCM: низкоуровневая операция явного реестра. Рабочий адаптер — NativeGateway. */
export interface ServerPort {
  call(id: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>;
  /** Двоичный ответ потоком, без предела ответа: read читает тело, пока порт занят запросом. */
  stream<T>(
    id: string,
    args: Record<string, unknown>,
    read: (body: AsyncIterable<Uint8Array>) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T>;
}

/** Запрос, способный изменить сервер, называет владельца своего исхода либо идёт через read. */
function refuseUnowned(
  id: string,
  args: Record<string, unknown>,
  refused: (effect: OperationEffect) => boolean,
): void {
  const effect = nativeEffect(id, args);
  if (effect !== undefined && refused(effect))
    throw new Error(`${id}: запрос, который может изменить сервер, без владельца исхода записи`);
}

/** Сервер для основных операций: каждый запрос к порту проходит здесь. */
export class HcmServer {
  private appInfo: { expires: number; value: Promise<Record<string, unknown>> } | undefined;

  constructor(private readonly port: ServerPort) {}

  /** Запрос операции, которую реестр считает чтением. Всё остальное обязано сказать, что это. */
  async call(id: string, args: Record<string, unknown>, outcome?: WriteOutcome): Promise<unknown> {
    const signal = activeSignal.getStore();
    if (!outcome) {
      refuseUnowned(id, args, (effect) => effect !== "read");
      return this.port.call(id, args, signal);
    }
    const withdraw = outcome.sending();
    try {
      return await this.port.call(id, args, signal);
    } catch (error) {
      // Отказ по аргументу шлюз находит, пока собирает запрос: такой запрос не уходит.
      if (
        (error instanceof WsHcmApiError && error.requestSent === false) ||
        error instanceof ArgumentError ||
        refusedAtDoor(error)
      )
        withdraw();
      throw error;
    }
  }

  /** Только чтение, хотя операция умеет больше (xQuery, rpc.call); запись реестра отклоняется. */
  async read(id: string, args: Record<string, unknown>): Promise<unknown> {
    refuseUnowned(id, args, (effect) => effect === "write");
    return this.port.call(id, args, activeSignal.getStore());
  }

  /** Чтение реестра с двоичным ответом потоком: read получает тело. */
  async stream<T>(
    id: string,
    args: Record<string, unknown>,
    read: (body: AsyncIterable<Uint8Array>) => Promise<T>,
  ): Promise<T> {
    refuseUnowned(id, args, (effect) => effect !== "read");
    return this.port.stream(id, args, read, activeSignal.getStore());
  }

  /** Сведения о приложении, хранятся 30 секунд; отклонённый или битый ответ не хранится. */
  async applicationInfo(fresh = false): Promise<Record<string, unknown>> {
    if (fresh || !this.appInfo || this.appInfo.expires <= Date.now()) {
      const value = this.call("native.spxml2.getAppInfo", { fastStart: true }).then((raw) =>
        inputObject(raw, "сведения о приложении"),
      );
      this.appInfo = { expires: Date.now() + 30000, value };
      value.catch(() => {
        if (this.appInfo?.value === value) this.appInfo = undefined;
      });
    }
    return this.appInfo.value;
  }

  /** Сбросить кэш сведений о приложении после операции, способной изменить настройки сервера. */
  invalidateApplicationInfo(): void {
    this.appInfo = undefined;
  }

  /**
   * Код, подготовленный prepareScript, выполняется на сервере; ответ проверяется на
   * перехваченную ошибку. `idle` по ответу узнаёт, что код ничего не сделал: отметка снимается.
   */
  async runCode(
    script: { request: Record<string, unknown>; executionId: string },
    outcome: WriteOutcome,
    idle?: (data: ScriptData) => boolean,
  ): Promise<ScriptData> {
    outcome.note({ executionId: script.executionId });
    const withdraw = outcome.sending();
    try {
      const data = scriptResult(
        await this.port.call("web.rpc.call", script.request, activeSignal.getStore()),
        script.executionId,
      );
      if (idle?.(data)) withdraw();
      return data;
    } catch (error) {
      // Шлюз отклонил запрос по аргументу или до отправки, сервер отказался читать код или отклонил
      // запрос на входе: ничего не выполнилось.
      if (
        (error instanceof WsHcmApiError && error.requestSent === false) ||
        error instanceof ArgumentError ||
        (error instanceof HcmError && error.mutationOutcome === "not_sent") ||
        refusedAtDoor(error)
      )
        withdraw();
      throw error;
    }
  }
}
