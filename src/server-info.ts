import { HcmError } from "./errors.js";
import type { HcmServer } from "./hcm-server.js";
import { freezeRegistry } from "./immutable.js";
import { parseXml } from "./protocol/xml.js";
import { blank, exactKeys, isType, object, strictResponse, typedText } from "./server-value.js";

/** Профиль протокола, которым читаются сведения. */
export type ServerInfoProfile = "native" | "web";
/** Аргументы serverInfo. */
export interface ServerInfoInput {
  /** native (по умолчанию) или web; папки dataFolders и codeFolders есть только у native. */
  readonly profile?: ServerInfoProfile;
}
/** Лицензионный предел числа объектов одного типа. */
export interface ServerCatalogLimit {
  /** Тип объекта. */
  readonly objectTypeName: string;
  /** Предел числа объектов, строкой. */
  readonly maxRecordsNum: string;
}
/** База за сервером по флагам, которыми сам сервер определяет тип своей базы. */
export type ServerDatabase = "mssql" | "postgresql" | "oracle" | "azure" | "xml" | "other";
/** Ответ serverInfo. */
export interface ServerInfoData {
  /** Профиль, которым прочитаны сведения. */
  readonly profile: ServerInfoProfile;
  /** Версия сервера. */
  readonly versionServer: string;
  /** Операционная система сервера. */
  readonly osType: "windows" | "linux";
  /** Маска возможностей базы, целое строкой. Это не права пользователя. */
  readonly capabilityMask: string;
  /** База за сервером, по маске возможностей. */
  readonly database: ServerDatabase;
  /** Лицензионные пределы числа объектов по типам, объявленные при запуске, не текущие числа. */
  readonly catalogLimits: readonly ServerCatalogLimit[];
  /** Профиль native: папки данных, куда writeFile пишет без права execute. */
  readonly dataFolders?: readonly string[];
  /** Профиль native: папки кода, куда writeFile пишет только с правом execute. */
  readonly codeFolders?: readonly string[];
}

const fields = ["sys_db_capability", "catalog_limits", "version_server", "os_type"] as const;
const maxCatalogXmlBytes = 256 * 1024;
const maxCatalogRows = 4096;

function signedInteger(value: string): string {
  if (!/^(?:0x[0-9a-fA-F]{1,16}|[+-]?\d{1,20})$/.test(value)) throw new Error();
  const integer = BigInt(value);
  if (integer < -0x8000000000000000n || integer > 0x7fffffffffffffffn) throw new Error();
  return value;
}
/**
 * Флаги штатного списка UNI_CAP_*: BASIC 1, AZURE 0x8000, MSSQL 0x10000, ORACLE 0x20000. Флага
 * PostgreSQL в списке нет; бит 33 — тот, что замечен установленным только на PostgreSQL
 * (2025.1.1171 — 2025.2.1535).
 */
function database(mask: bigint): ServerDatabase {
  if ((mask & 1n) === 0n) return "xml";
  if ((mask & 0x10000n) !== 0n) return "mssql";
  if ((mask & 0x20000n) !== 0n) return "oracle";
  if ((mask & 0x8000n) !== 0n) return "azure";
  return (mask & 0x200000000n) !== 0n ? "postgresql" : "other";
}
function catalogLimits(source: string): readonly ServerCatalogLimit[] {
  if (Buffer.byteLength(source) > maxCatalogXmlBytes) throw new Error();
  const document = parseXml(source);
  exactKeys(document, ["catalogs"]);
  const root = document.catalogs;
  if (typeof root === "string" && root.trim() === "") return [];
  const container = object(root);
  exactKeys(container, ["catalog", "#text"]);
  if (!blank(container["#text"])) throw new Error();
  const children = container.catalog;
  const rows = children === undefined ? [] : Array.isArray(children) ? children : [children];
  if (rows.length > maxCatalogRows) throw new Error();
  const names = new Set<string>();
  return rows.map((value) => {
    const row = object(value);
    exactKeys(row, ["name", "max_records_num", "#text"]);
    if (
      !blank(row["#text"]) ||
      typeof row.name !== "string" ||
      typeof row.max_records_num !== "string"
    )
      throw new Error();
    const name = row.name;
    if (name.length === 0 || name.length > 512 || names.has(name)) throw new Error();
    names.add(name);
    return { objectTypeName: name, maxRecordsNum: signedInteger(row.max_records_num) };
  });
}

/**
 * Разбирает только фиксированный штатный RPC метаданных; XML не вычисляется
 * и не декодируется дважды.
 */
export function parseServerInfo(
  response: unknown,
  profile: ServerInfoProfile = "native",
): ServerInfoData {
  try {
    if (profile !== "native" && profile !== "web") throw new Error();
    const { rpc, result } = strictResponse(response);
    if (
      (rpc.valueType !== undefined && !isType(rpc.valueType, "object")) ||
      !blank(rpc.lexicalValue)
    )
      throw new Error();
    exactKeys(result, ["@_VALUE-TYPE", "#text", ...fields]);
    if (!isType(result["@_VALUE-TYPE"], "object") || !blank(result["#text"])) throw new Error();
    const capabilityMask = signedInteger(typedText(result.sys_db_capability, "integer"));
    const versionServer = typedText(result.version_server, "string");
    const osType = typedText(result.os_type, "string");
    if (
      versionServer.length === 0 ||
      versionServer.length > 256 ||
      !["windows", "linux"].includes(osType)
    )
      throw new Error();
    return freezeRegistry({
      profile,
      versionServer,
      osType: osType as "windows" | "linux",
      capabilityMask,
      database: database(BigInt(capabilityMask)),
      catalogLimits: catalogLimits(typedText(result.catalog_limits, "string")),
    });
  } catch {
    throw new HcmError(
      "SERVER_INFO_RESPONSE",
      "Сервер вернул сведения о себе в неожиданном виде.",
      "Ожидаются четыре поля функции ms_tools.get_admin_init_server_data: sys_db_capability, catalog_limits, version_server, os_type. Её ответ как есть покажет rpc.call.",
    );
  }
}

/** Сведения о сервере — тем же вызовом, которым их читает админка при запуске. */
export async function readServerInfo(
  server: Pick<HcmServer, "read">,
  profile: ServerInfoProfile = "native",
): Promise<ServerInfoData> {
  return parseServerInfo(
    await server.read(`${profile}.rpc.call`, {
      target: "ms_tools.get_admin_init_server_data",
      args: [],
    }),
    profile,
  );
}
