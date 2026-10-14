import { describeHcmOperation } from "./catalog.js";
import { HcmError, inputObject } from "./errors.js";
import type { OperationEffect } from "./contracts.js";
import { nativeEffect } from "./native/gateway.js";
import { prepare } from "./native/validation.js";
import { ArgumentError, WsHcmApiError } from "./protocol/error.js";
import { scriptResult, type ScriptData } from "./scripts.js";
import { refusedAtDoor, type WriteOutcome } from "./write-outcome.js";

/** Шов к серверу HCM: низкоуровневая операция явного реестра. Рабочий адаптер — NativeGateway. */
export interface ServerPort {
  call(id: string, args: Record<string, unknown>): Promise<unknown>;
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

/** Сервер для составных операций: каждый запрос к порту проходит здесь. */
export class HcmServer implements ServerPort {
  private appInfo: { expires: number; value: Promise<unknown> } | undefined;

  constructor(private readonly port: ServerPort) {}

  /** Запрос операции, которую реестр считает чтением. Всё остальное обязано сказать, что это. */
  async call(id: string, args: Record<string, unknown>, outcome?: WriteOutcome): Promise<unknown> {
    if (!outcome) {
      refuseUnowned(id, args, (effect) => effect !== "read");
      return this.port.call(id, args);
    }
    const withdraw = outcome.sending();
    try {
      return await this.port.call(id, args);
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
    return this.port.call(id, args);
  }

  /** Сведения о приложении, хранятся 30 секунд; отклонённый запрос не хранится. */
  async applicationInfo(): Promise<Record<string, unknown>> {
    if (!this.appInfo || this.appInfo.expires < Date.now()) {
      const value = this.call("native.spxml2.getAppInfo", { fastStart: true });
      this.appInfo = { expires: Date.now() + 30000, value };
      value.catch(() => {
        if (this.appInfo?.value === value) this.appInfo = undefined;
      });
    }
    return inputObject(await this.appInfo.value, "сведения о приложении");
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
    prepare(script.request, describeHcmOperation("web.rpc.call").inputSchema);
    outcome.note({ executionId: script.executionId });
    const withdraw = outcome.sending();
    try {
      const data = scriptResult(
        await this.port.call("web.rpc.call", script.request),
        script.executionId,
      );
      if (idle?.(data)) withdraw();
      return data;
    } catch (error) {
      // Сервер отказался читать код или отклонил запрос на входе: ничего не выполнилось.
      if (
        (error instanceof HcmError && error.mutationOutcome === "not_sent") ||
        refusedAtDoor(error)
      )
        withdraw();
      throw error;
    }
  }
}
