import type { MutationOutcome, OperationEffect } from "./contracts.js";
import { HcmError } from "./errors.js";
import { loginFailed } from "./native/gateway.js";
import { WsHcmApiError } from "./protocol/error.js";

/** ID, по которым запись находится после сбоя. */
export interface WriteIds {
  mutationId?: string;
  objectId?: string;
  url?: string;
  executionId?: string;
}
/** Сервер отклонил именно этот запрос на входе: HTTP 401 или для него не удалось открыть сессию. */
export function refusedAtDoor(error: unknown): boolean {
  return (error instanceof WsHcmApiError && error.status === 401) || loginFailed(error);
}

export interface Verdict {
  /** Запрос, способный изменить сервер, отправлен и не отозван. */
  sent: boolean;
  /** Только когда дана ошибка. */
  mutationOutcome?: MutationOutcome;
  /** Неопределён, а ошибка — отказ на входе: более ранний запрос прошёл. */
  refusedAfterSend?: true;
  /** Как их отметили обработчики. */
  ids: WriteIds;
  /** mutationId, objectId, executionId, прошедшие проверку формата. */
  exactIds: WriteIds;
}

/** Исход записи одного вызова: отметки, ID и правило трёх исходов. */
export class WriteOutcome {
  private marks = 0;
  private readonly ids: WriteIds = {};

  /** Перед запросом, способным изменить сервер; возвращает снятие этой отметки. */
  sending(): () => void {
    this.marks++;
    let withdrawn = false;
    return () => {
      if (!withdrawn) this.marks--;
      withdrawn = true;
    };
  }

  note(ids: WriteIds): void {
    for (const [key, value] of Object.entries(ids))
      if (value !== undefined) this.ids[key as keyof WriteIds] = value;
  }

  /**
   * Первая подходящая строка: нет ошибки, чтение, отказ на входе, неснятая отметка,
   * иначе not_sent.
   */
  verdict(effect: OperationEffect, error?: unknown): Verdict {
    const { mutationId, objectId, executionId } = this.ids;
    // Сгенерированные ID корреляции и ограниченные по длине числовые ID объектов — сводка,
    // а не диагностика сервера.
    const exactIds: WriteIds = {
      ...(mutationId !== undefined &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(mutationId)
        ? { mutationId }
        : {}),
      ...(objectId !== undefined &&
      /^(?:[0-9]{1,20}|0[xX][0-9a-fA-F]{1,16})$/.test(objectId) &&
      BigInt(objectId) <= 0xffffffffffffffffn
        ? { objectId }
        : {}),
      ...(executionId !== undefined && /^hcm_inline_[a-f0-9]{32}$/.test(executionId)
        ? { executionId }
        : {}),
    };
    const sent = effect !== "read" && this.marks > 0;
    const verdict: Verdict = { sent, ids: { ...this.ids }, exactIds };
    if (error === undefined) return verdict;
    // Отказ на входе снимается вместе с отметкой своего запроса (HcmServer); оставшаяся отметка —
    // более ранний запрос, который прошёл. У rpc.call один запрос, его обработчик отказывает.
    const turnedAway =
      error instanceof HcmError &&
      (error.code === "RPC_SERVER_ONLY" || error.code === "UNKNOWN_RPC_TARGET");
    const mutationOutcome =
      effect === "read"
        ? error instanceof HcmError
          ? error.mutationOutcome
          : undefined
        : sent && !turnedAway
          ? "indeterminate"
          : "not_sent";
    if (mutationOutcome === undefined) return verdict;
    const refusedAfterSend = mutationOutcome === "indeterminate" && refusedAtDoor(error);
    return { ...verdict, mutationOutcome, ...(refusedAfterSend && { refusedAfterSend }) };
  }
}
