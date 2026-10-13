import { describeHcmOperation } from "./catalog.js";
import { HcmError, inputObject } from "./errors.js";
import type { OperationEffect } from "./contracts.js";
import { nativeEffect } from "./native/gateway.js";
import { prepare } from "./native/validation.js";
import { WsHcmApiError } from "./protocol/error.js";
import { scriptResult, type ScriptData } from "./scripts.js";
import { refusedAtDoor, type WriteOutcome } from "./write-outcome.js";

/** The seam to the HCM server: one low-level operation of the explicit registry. NativeGateway is the production adapter. */
export interface ServerPort {
  call(id: string, args: Record<string, unknown>): Promise<unknown>;
}

/** A request that may change the server must name the owner of its outcome or go through read. */
function refuseUnowned(
  id: string,
  args: Record<string, unknown>,
  refused: (effect: OperationEffect) => boolean,
): void {
  const effect = nativeEffect(id, args);
  if (effect !== undefined && refused(effect))
    throw new Error(`${id}: запрос, который может изменить сервер, без владельца исхода записи`);
}

/** The server as composite operations use it: every request to the port goes through here. */
export class HcmServer implements ServerPort {
  private appInfo: { expires: number; value: Promise<unknown> } | undefined;

  constructor(private readonly port: ServerPort) {}

  /** A request of an operation the registry calls a read. Anything else must say what it is. */
  async call(id: string, args: Record<string, unknown>, outcome?: WriteOutcome): Promise<unknown> {
    if (!outcome) {
      refuseUnowned(id, args, (effect) => effect !== "read");
      return this.port.call(id, args);
    }
    const withdraw = outcome.sending();
    try {
      return await this.port.call(id, args);
    } catch (error) {
      if ((error instanceof WsHcmApiError && error.requestSent === false) || refusedAtDoor(error))
        withdraw();
      throw error;
    }
  }

  /** A request that only reads here though its operation can do more (xQuery, rpc.call); a registry write is refused. */
  async read(id: string, args: Record<string, unknown>): Promise<unknown> {
    refuseUnowned(id, args, (effect) => effect === "write");
    return this.port.call(id, args);
  }

  /** Application info, kept for 30 seconds; a refused request is not kept. */
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
   * Code prepared by prepareScript, run on the server; the answer is checked for a caught error.
   * `idle` tells from the answer that the code did nothing: the mark is withdrawn.
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
      // The server refused to read the code, or turned the request away at the door: none of it ran.
      if (
        (error instanceof HcmError && error.mutationOutcome === "not_sent") ||
        refusedAtDoor(error)
      )
        withdraw();
      throw error;
    }
  }
}
