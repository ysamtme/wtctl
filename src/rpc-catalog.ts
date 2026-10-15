import { HcmError, boundedInteger, inputObject } from "./errors.js";
import { freezeRegistry } from "./immutable.js";
import { validate } from "./native/validation.js";
import { operationDefinition } from "./operations.js";
import { LibraryReader } from "./protocol/library-functions.js";
import { RPC_TARGETS_1171 } from "./rpc-targets-1171.js";

/** Функция библиотеки сервера. */
export interface RpcTargetCard {
  /** «библиотека.функция»: tools.get_version. */
  readonly id: string;
  /** Имена параметров по порядку; типов сервер не объявляет. */
  readonly parameters: readonly string[];
  /** Разрешён ли вызов с клиента; null — не установлено. */
  readonly allowed: boolean | null;
  /** Функция не допускает вызова с клиента: её зовёт только код сервера. */
  readonly serverOnly?: true;
}
/** Аргументы listRpc. */
export interface RpcCatalogFilter {
  /** Часть имени функции или параметра. */
  readonly query?: string;
  /** Библиотека: tools, ms_tools… */
  readonly library?: string;
  /** Имя функции целиком. */
  readonly method?: string;
  /** Встроенная таблица функций сервера 2025.1.1171, без обращения к серверу. */
  readonly builtIn?: boolean;
  /** Включить функции, которые может вызывать только код сервера. */
  readonly all?: boolean;
  /** Сколько функций пропустить: nextCursor прошлой страницы. */
  readonly cursor?: number;
  /** Функций на странице, 1–100; по умолчанию 30. */
  readonly limit?: number;
}
/** Аргументы describeRpc помимо targetId. */
export interface RpcDescribeOptions {
  /** Встроенная таблица функций сервера 2025.1.1171, без обращения к серверу. */
  readonly builtIn?: boolean;
  /** Добавить код функции, до 8 КБ. */
  readonly source?: boolean;
}
/** Откуда взят список функций. */
interface RpcCatalogSource {
  /** Откуда список: с сервера или из встроенной таблицы 2025.1.1171. */
  readonly source: "server" | "built-in 2025.1.1171";
  /** Библиотеки, список функций которых сервер не отдал. */
  readonly skipped?: readonly string[];
}
/** Страница функций: ответ listRpc. */
export interface RpcCatalogPage extends RpcCatalogSource {
  /** Функции страницы. */
  readonly targets: readonly RpcTargetCard[];
  /** Сколько функций подходит всего. */
  readonly total: number;
  /** Подходящие функции, пропущенные из-за того, что клиент их не вызовет; all:true выводит их. */
  readonly serverOnlyHidden?: number;
  /** Есть при serverOnlyHidden: как их показать. */
  readonly hint?: string;
  /** cursor следующей страницы; нет — страница последняя. */
  readonly nextCursor?: number;
}
/** Функция библиотеки с кодом: ответ describeRpc. */
export interface RpcTargetDescription extends RpcTargetCard, RpcCatalogSource {
  /** Как вызвать функцию, которую клиент вызвать не может. */
  readonly note?: string;
  /** С source:true: код функции, до 8 КБ. */
  readonly code?: string;
  /** Код длиннее 8 КБ и обрезан. */
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

/** Поиск целей внутри runtime; вызов цели остаётся отдельной операцией. */
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
  /** Почему сервер отказал в вызове, если это объясняет его собственный список функций. */
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
    const serverOnlyHidden = hidden
      ? {
          serverOnlyHidden: hidden,
          hint: "serverOnlyHidden — сколько подходящих функций не показано: они вызываются только из кода на сервере. all:true (в CLI --all) добавит их в список.",
        }
      : {};
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
      // Не продвигаться за карточку, которая не выдана, когда бюджет в байтах сокращает страницу.
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
