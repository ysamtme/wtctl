import { describeHcmOperation, listHcmOperations } from "../catalog.js";
import type {
  ConnectionConfig,
  OperationDefinition,
  OperationEffect,
  OperationFilter,
  OperationPage,
  OperationResult,
} from "../contracts.js";
import { HcmError } from "../errors.js";
import type { RuntimePort } from "../runtime-port.js";

/**
 * A runtime for a server that starts before its connection is set up. An agent host shows a server
 * that exits at start as "failed" with no reason; this one starts, lists its tools and answers every
 * call with what to set. The settings are read again on each call, so fixing them needs no restart.
 */
export class DeferredRuntime implements RuntimePort {
  #runtime: RuntimePort | undefined;
  #error: HcmError;
  constructor(
    private readonly load: () => ConnectionConfig | Promise<ConnectionConfig>,
    private readonly create: (config: ConnectionConfig) => RuntimePort,
    firstError: HcmError,
    /** How a person sets the connection up on this computer; added to the hint of the refusal. */
    private readonly setup?: string,
  ) {
    this.#error = firstError;
  }
  get results(): RuntimePort["results"] {
    return this.#runtime?.results;
  }
  private async ready(): Promise<RuntimePort | undefined> {
    if (this.#runtime) return this.#runtime;
    try {
      this.#runtime = this.create(await this.load());
    } catch (error) {
      if (!(error instanceof HcmError)) throw error;
      this.#error = error;
    }
    return this.#runtime;
  }
  listOperations(filter?: OperationFilter): OperationPage {
    return this.#runtime ? this.#runtime.listOperations(filter) : listHcmOperations(filter);
  }
  describe(id: string): OperationDefinition {
    return this.#runtime ? this.#runtime.describe(id) : describeHcmOperation(id);
  }
  getOperationEffect(id: string, args?: Record<string, unknown>): OperationEffect {
    // Without a connection every call ends in the same setup error, whatever its class.
    return this.#runtime ? this.#runtime.getOperationEffect(id, args) : this.describe(id).effect;
  }
  async call(id: string, args?: Record<string, unknown>): Promise<OperationResult> {
    const runtime = await this.ready();
    if (runtime) return runtime.call(id, args);
    const error = this.#error.toJSON();
    return {
      ok: false,
      error:
        this.setup && error.code === "NOT_CONFIGURED"
          ? { ...error, hint: `${error.hint} ${this.setup}` }
          : error,
      meta: { operationId: id, connection: "unconfigured", durationMs: 0 },
    };
  }
  async close(): Promise<void> {
    await this.#runtime?.close();
  }
}
