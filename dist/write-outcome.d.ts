import type { MutationOutcome, OperationEffect } from "./contracts.js";
/** ID, по которым запись находится после сбоя. */
export interface WriteIds {
    mutationId?: string;
    objectId?: string;
    url?: string;
    executionId?: string;
}
/** Сервер отклонил именно этот запрос на входе: HTTP 401 или для него не удалось открыть сессию. */
export declare function refusedAtDoor(error: unknown): boolean;
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
export declare class WriteOutcome {
    private marks;
    private readonly ids;
    /** Перед запросом, способным изменить сервер; возвращает снятие этой отметки. */
    sending(): () => void;
    /** Значение undefined ничего не стирает. */
    note(ids: {
        readonly [K in keyof WriteIds]?: string | undefined;
    }): void;
    /**
     * Первая подходящая строка: нет ошибки или чтение — исхода нет; отказ на входе, неснятая
     * отметка; иначе not_sent.
     */
    verdict(effect: OperationEffect, error?: unknown): Verdict;
}
