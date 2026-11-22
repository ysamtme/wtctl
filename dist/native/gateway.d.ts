import type { NativeConfig, NativeOperation } from "../contracts.js";
import { WsHcmClient, type NativeSession, type WebSession } from "../protocol/client.js";
import { type RequestOptions } from "../protocol/types.js";
export declare function getNativeOperations(): readonly NativeOperation[];
/** Владелец состояния для SDK, MCP и CLI. Вызовы идут по очереди: сессия не путается. */
export declare class NativeGateway {
    readonly client: WsHcmClient;
    private nativeSession;
    private webSession;
    private closed;
    private accepting;
    private queue;
    private closePromise;
    constructor(config: NativeConfig);
    private assertOpen;
    native(options?: RequestOptions): Promise<NativeSession>;
    web(options?: RequestOptions): Promise<WebSession>;
    private takeProfile;
    closeProfile(profile: "native" | "web"): Promise<void>;
    call(id: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>;
    private callInternal;
    /**
     * Двоичный ответ операции потоком, без предела maxResponseBytes: read читает тело, и очередь
     * ждёт, пока он не закончит. Недочитанное тело отменяется.
     */
    stream<T>(id: string, args: Record<string, unknown>, read: (body: AsyncIterable<Uint8Array>) => Promise<T>, signal?: AbortSignal): Promise<T>;
    private streamInternal;
    /** Вызовы идут по очереди; проверяется собственный снимок аргументов. */
    private enqueue;
    /**
     * Сервер сбрасывает сессию, простоявшую без дела (на стендах — в пределах двадцати минут),
     * или закрытую с его стороны; каждый следующий запрос получает HTTP 401. Долгоживущий владелец
     * остался бы без доступа, поэтому сброшенная сессия заменяется новым входом, и запрос
     * отправляется ещё раз. Операция шлюза — один запрос, и сервер отклоняет его до обработки,
     * поэтому повтор не может выполнить что-либо дважды. Операции из нескольких запросов
     * собираются выше, в runtime: так повторяется только отклонённый запрос.
     */
    private invoke;
    private output;
    close(): Promise<void>;
    private finishClose;
}
