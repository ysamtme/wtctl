import type { NativeConfig, NativeOperation } from "../contracts.js";
import { WsHcmClient, type NativeSession, type WebSession } from "../protocol/client.js";
export declare function getNativeOperations(): readonly NativeOperation[];
/** The effect of a registry operation for these arguments, internal operations included; undefined for an unknown ID. */
export declare function nativeEffect(id: string, args: Record<string, unknown>): NativeOperation["effect"] | undefined;
/** The failure happened while opening the session: the operation itself was not sent. */
export declare function loginFailed(error: unknown): boolean;
/** Stateful owner shared by SDK, MCP and CLI. Calls are serialized to protect session/cursor identity. */
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
     * The server drops a session that stayed idle (within twenty minutes on the stands) or was closed
     * from its side; every later request then gets HTTP 401. A long-lived owner would stay locked out,
     * so the dropped session is replaced by a new login and the request is sent once more. The server
     * rejects such a request before handling it, hence the repeat cannot run anything twice.
     */
    private invoke;
    private output;
    close(): Promise<void>;
    private finishClose;
}
