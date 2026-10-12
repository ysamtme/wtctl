export interface ScriptData<T = unknown> {
    readonly result: readonly T[];
    /** Column descriptions and extra data of the collection, when the server returned any. */
    readonly columns?: readonly unknown[];
    readonly data?: Readonly<Record<string, unknown>>;
    /** Name of the unsaved collection that carried the code; it appears in server log lines. */
    readonly executionId: string;
}
/** Existing Administrator RPC receives an unsaved XmElem with the shipped form attached. */
export declare function prepareScript(value: unknown, params?: unknown): {
    request: Record<string, unknown>;
    executionId: string;
};
export interface AgentRunData {
    /** false: the server did not start the agent; its reason is in the log `agent`. */
    readonly started: boolean;
    /** Server local time around the run: the agent's lines in the logs lie between them. */
    readonly startedAt: string;
    readonly finishedAt: string;
    readonly hint: string;
}
/** Code and parameters that run an agent in place. IDs go into the agent's code, so only IDs pass. */
export declare function agentRun(args: Record<string, unknown>): {
    code: string;
    params: object;
};
export declare function agentRunResult(data: ScriptData): AgentRunData;
/** Raw probes can use the same request without changing their low-level argument contract. */
export declare function scriptRequest(value: unknown, params?: unknown): Record<string, unknown>;
/** Preserve scalar lexical representations, including every 64-bit integer and date. */
export declare function decodeRpcValue(value: unknown, depth?: number): unknown;
/**
 * What a library function returned, as plain JSON. A value the typed form cannot express
 * (a document, a form element) is left as the parsed response.
 */
export declare function rpcValue(response: unknown): unknown;
/** A transport success is insufficient: the collection can report a caught script error. */
export declare function scriptResult(response: unknown, executionId: string): ScriptData;
