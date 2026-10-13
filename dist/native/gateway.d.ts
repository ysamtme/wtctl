import type { NativeConfig, NativeOperation } from "../contracts.js";
import { WsHcmClient, type NativeSession, type WebSession } from "../protocol/client.js";
export declare function getNativeOperations(): readonly NativeOperation[];
/** Эффект операции реестра для этих аргументов (и внутренней); undefined для неизвестного ID. */
export declare function nativeEffect(id: string, args: Record<string, unknown>): NativeOperation["effect"] | undefined;
/** Сбой случился при открытии сессии: сама операция не отправлена. */
export declare function loginFailed(error: unknown): boolean;
/** Владелец состояния для SDK, MCP и CLI. Вызовы идут по очереди: сессия и курсор не путаются. */
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
    native(): Promise<NativeSession>;
    web(): Promise<WebSession>;
    private takeProfile;
    closeProfile(profile: "native" | "web"): Promise<void>;
    call(id: string, args: Record<string, unknown>): Promise<unknown>;
    /**
     * Сервер сбрасывает сессию, простоявшую без дела (на стендах — в пределах двадцати минут),
     * или закрытую с его стороны; каждый следующий запрос получает HTTP 401. Долгоживущий владелец
     * остался бы без доступа, поэтому сброшенная сессия заменяется новым входом, и запрос
     * отправляется ещё раз. Сервер отклоняет такой запрос до обработки, поэтому повтор не может
     * выполнить что-либо дважды.
     */
    private invoke;
    private output;
    close(): Promise<void>;
    private finishClose;
}
