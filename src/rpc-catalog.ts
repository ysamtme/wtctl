import { HcmError, boundedInteger, inputObject } from "./errors.js";
import { freezeRegistry } from "./immutable.js";
import { validate } from "./native/validation.js";
import { operationDefinition } from "./operations.js";
import { LibraryReader } from "./protocol/library-functions.js";
import { RPC_TARGETS_1171 } from "./rpc-targets-1171.js";

export interface RpcTargetCard {
  readonly id: string;
  readonly parameters: readonly string[];
  readonly allowed: boolean | null;
  /** The function has no client gate: it is called from server code only. */
  readonly serverOnly?: true;
}
export interface RpcCatalogFilter {
  readonly query?: string;
  readonly library?: string;
  readonly method?: string;
  readonly builtIn?: boolean;
  /** Include functions that only server code can call. */
  readonly all?: boolean;
  readonly cursor?: number;
  readonly limit?: number;
}
export interface RpcDescribeOptions {
  readonly builtIn?: boolean;
  readonly source?: boolean;
}
interface RpcCatalogSource {
  readonly source: "server" | "built-in 2025.1.1171";
  readonly skipped?: readonly string[];
}
export interface RpcCatalogPage extends RpcCatalogSource {
  readonly targets: readonly RpcTargetCard[];
  readonly total: number;
  /** Matching functions left out because a client cannot call them; all:true lists them. */
  readonly serverOnlyHidden?: number;
  readonly nextCursor?: number;
}
export interface RpcTargetDescription extends RpcTargetCard, RpcCatalogSource {
  /** How to call a function that a client cannot call. */
  readonly note?: string;
  readonly code?: string;
  readonly codeTruncated?: true;
}

export const RPC_CATALOG_PAGE_MAX_BYTES = 16 * 1024;
const targets = freezeRegistry(
  RPC_TARGETS_1171.map(([id, parameters, allowed]) => ({ id, parameters, allowed })),
);
function input(id: string, value: unknown): Record<string, unknown> {
  try {
    validate(value, operationDefinition(id)!.inputSchema);
    return inputObject(value);
  } catch {
    throw new HcmError(
      "INVALID_ARGUMENT",
      "Аргументы поиска функций не подходят.",
      "Аргументы операции описывает api.describe.",
    );
  }
}

function unknownTarget(
  targetId: string,
  available: readonly RpcTargetCard[],
  source: string,
): HcmError {
  const [library, method] = targetId.split(".") as [string, string];
  const inLibrary = available.filter((item) => item.id.startsWith(`${library}.`));
  const near = inLibrary
    .map((item) => item.id.slice(library.length + 1))
    .filter((name) => name.toLowerCase().includes(method.toLowerCase()))
    .slice(0, 5);
  return new HcmError(
    "UNKNOWN_RPC_TARGET",
    source !== "server"
      ? `Функции ${targetId} нет во встроенной таблице.`
      : inLibrary.length
        ? `В библиотеке ${library} нет функции ${method}.`
        : `Среди библиотек сервера нет библиотеки ${library} или в ней нет функций.`,
    `${near.length ? `Похожие: ${near.join(", ")}. ` : ""}Имена ищет rpc.list: query — часть имени, all:true — вместе с функциями, которые вызываются только из кода на сервере.`,
  );
}

/** Runtime-local discovery; calling a target remains a separate operation. */
export class RpcCatalog {
  private readonly reader: LibraryReader | undefined;
  constructor(
    applicationInfo?: () => Promise<Record<string, unknown>>,
    readFile?: (url: string) => Promise<unknown>,
  ) {
    if (applicationInfo && readFile) this.reader = new LibraryReader(applicationInfo, readFile);
  }
  private async catalog(
    builtIn: unknown,
    library?: string,
  ): Promise<RpcCatalogSource & { targets: readonly (RpcTargetCard & { code?: string })[] }> {
    const server = builtIn === true ? undefined : await this.reader?.read(library);
    return server
      ? {
          targets: server.targets,
          source: "server",
          ...(server.skipped.length ? { skipped: server.skipped } : {}),
        }
      : { targets, source: "built-in 2025.1.1171" };
  }
  /** Why the server refused a call, when its own list of functions explains it. */
  async refusal(targetId: string): Promise<HcmError | undefined> {
    const { targets: available, source } = await this.catalog(false, targetId.split(".")[0]);
    if (source !== "server") return undefined;
    const target = available.find((item) => item.id === targetId);
    if (!target) return unknownTarget(targetId, available, source);
    if (target.allowed !== false) return undefined;
    const [library, method] = targetId.split(".") as [string, string];
    return new HcmError(
      "RPC_SERVER_ONLY",
      `Функцию ${targetId} сервер не разрешает вызывать с клиента.`,
      `Вызывать её нужно из кода на сервере: execute.script, например r = ${library}.${method}(…); RESULT = [r + '']; — массив обойти циклом, из объекта взять нужные поля.`,
    );
  }
  async list(filter: RpcCatalogFilter = {}): Promise<RpcCatalogPage> {
    const args = input("rpc.list", filter);
    const query = filter.query?.trim().toLowerCase();
    const cursor = boundedInteger(args.cursor, 0, Number.MAX_SAFE_INTEGER, "cursor");
    const limit = boundedInteger(args.limit, 30, 100, "limit");
    const { targets: available, ...metadata } = await this.catalog(filter.builtIn, filter.library);
    const matching = available.filter((target) => {
      const [library, method] = target.id.split(".");
      return (
        (filter.library === undefined || library === filter.library) &&
        (filter.method === undefined || method === filter.method) &&
        (!query ||
          [target.id, ...target.parameters].some((value) => value.toLowerCase().includes(query)))
      );
    });
    const filtered =
      filter.all === true ? matching : matching.filter((target) => target.serverOnly !== true);
    const total = filtered.length;
    const hidden = matching.length - filtered.length;
    const serverOnlyHidden = hidden ? { serverOnlyHidden: hidden } : {};
    const selected: RpcTargetCard[] = [];
    for (const { id, parameters, allowed, serverOnly } of filtered.slice(cursor, cursor + limit)) {
      const target = { id, parameters, allowed, ...(serverOnly ? { serverOnly } : {}) };
      const candidate = [...selected, target];
      const nextCursor = cursor + candidate.length;
      const page = {
        ...metadata,
        targets: candidate,
        total,
        ...serverOnlyHidden,
        ...(nextCursor < total ? { nextCursor } : {}),
      };
      // Never advance past a card that was not emitted when the byte budget reduces the page.
      if (Buffer.byteLength(JSON.stringify(page, null, 2), "utf8") > RPC_CATALOG_PAGE_MAX_BYTES) {
        if (selected.length === 0)
          throw new HcmError(
            "RPC_METADATA_TOO_LARGE",
            "Описание следующей функции не помещается в страницу.",
            "Эту функцию нужно прочитать отдельно: rpc.describe.",
            { targetId: target.id },
          );
        break;
      }
      selected.push(target);
    }
    const nextCursor = cursor + selected.length;
    return freezeRegistry({
      ...metadata,
      targets: selected,
      total,
      ...serverOnlyHidden,
      ...(nextCursor < total ? { nextCursor } : {}),
    });
  }
  async describe(
    targetId: string,
    options: RpcDescribeOptions = {},
  ): Promise<RpcTargetDescription> {
    input("rpc.describe", { ...inputObject(options), targetId });
    const { targets: available, ...metadata } = await this.catalog(
      options.builtIn,
      targetId.split(".")[0],
    );
    const target = available.find((item) => item.id === targetId);
    if (!target) throw unknownTarget(targetId, available, metadata.source);
    const { id, parameters, allowed, serverOnly } = target;
    let code: Pick<RpcTargetDescription, "code" | "codeTruncated"> = {};
    if (options.source === true && metadata.source === "server") {
      const bytes = Buffer.from(target.code ?? "", "utf8");
      code = {
        code: new TextDecoder().decode(bytes.subarray(0, 8192), { stream: true }),
        ...(bytes.length > 8192 ? { codeTruncated: true as const } : {}),
      };
    }
    return freezeRegistry({
      id,
      parameters,
      allowed,
      ...(serverOnly
        ? {
            serverOnly,
            note: `С клиента функция не вызывается (нет ALLOW-CALL-FROM-CLIENT). Вызывать её нужно из кода на сервере: ${id}(…).`,
          }
        : {}),
      ...metadata,
      ...code,
    });
  }
}
