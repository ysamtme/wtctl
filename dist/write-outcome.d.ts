import type { MutationOutcome, OperationEffect } from "./contracts.js";
/** IDs by which a write is found after a failure. */
export interface WriteIds {
    mutationId?: string;
    objectId?: string;
    url?: string;
    executionId?: string;
}
/** The server turned this very request away at the door: HTTP 401, or no session could be opened for it. */
export declare function refusedAtDoor(error: unknown): boolean;
export interface Verdict {
    /** A request that may have changed the server was sent and not withdrawn. */
    sent: boolean;
    /** Only when an error is given. */
    mutationOutcome?: MutationOutcome;
    /** Indeterminate, and the error is a refusal at the door: an earlier request went through. */
    refusedAfterSend?: true;
    /** As the handlers noted them. */
    ids: WriteIds;
    /** mutationId, objectId, executionId that passed the format check. */
    exactIds: WriteIds;
}
/** The write outcome of one call: the marks, the IDs and the rule of the three outcomes. */
export declare class WriteOutcome {
    private marks;
    private readonly ids;
    /** Before a request that may change the server; returns the withdrawal of this one mark. */
    sending(): () => void;
    note(ids: WriteIds): void;
    /** The first line that fits: no error, a read, a refusal at the door, a mark not withdrawn, otherwise not sent. */
    verdict(effect: OperationEffect, error?: unknown): Verdict;
}
