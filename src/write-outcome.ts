import type { MutationOutcome, OperationEffect } from "./contracts.js";
import { HcmError } from "./errors.js";
import { loginFailed } from "./native/gateway.js";
import { WsHcmApiError } from "./protocol/error.js";

/** IDs by which a write is found after a failure. */
export interface WriteIds {
  mutationId?: string;
  objectId?: string;
  url?: string;
  executionId?: string;
}
/** The server turned this very request away at the door: HTTP 401, or no session could be opened for it. */
export function refusedAtDoor(error: unknown): boolean {
  return (error instanceof WsHcmApiError && error.status === 401) || loginFailed(error);
}

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
export class WriteOutcome {
  private marks = 0;
  private readonly ids: WriteIds = {};

  /** Before a request that may change the server; returns the withdrawal of this one mark. */
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

  /** The first line that fits: no error, a read, a refusal at the door, a mark not withdrawn, otherwise not sent. */
  verdict(effect: OperationEffect, error?: unknown): Verdict {
    const { mutationId, objectId, executionId } = this.ids;
    // Generated correlation IDs and bounded numeric object IDs are receipts, not server diagnostics.
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
    // A refusal at the door is withdrawn with the mark of its own request (HcmServer); a mark still
    // standing is an earlier request that went through. rpc.call has one request, its handler refuses.
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
