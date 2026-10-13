import { type ScriptData } from "./scripts.js";
import { type WriteOutcome } from "./write-outcome.js";
/** The seam to the HCM server: one low-level operation of the explicit registry. NativeGateway is the production adapter. */
export interface ServerPort {
    call(id: string, args: Record<string, unknown>): Promise<unknown>;
}
/** The server as composite operations use it: every request to the port goes through here. */
export declare class HcmServer implements ServerPort {
    private readonly port;
    private appInfo;
    constructor(port: ServerPort);
    /** A request of an operation the registry calls a read. Anything else must say what it is. */
    call(id: string, args: Record<string, unknown>, outcome?: WriteOutcome): Promise<unknown>;
    /** A request that only reads here though its operation can do more (xQuery, rpc.call); a registry write is refused. */
    read(id: string, args: Record<string, unknown>): Promise<unknown>;
    /** Application info, kept for 30 seconds; a refused request is not kept. */
    applicationInfo(): Promise<Record<string, unknown>>;
    /**
     * Code prepared by prepareScript, run on the server; the answer is checked for a caught error.
     * `idle` tells from the answer that the code did nothing: the mark is withdrawn.
     */
    runCode(script: {
        request: Record<string, unknown>;
        executionId: string;
    }, outcome: WriteOutcome, idle?: (data: ScriptData) => boolean): Promise<ScriptData>;
}
