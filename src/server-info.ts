import { HcmError } from "./errors.js";
import { freezeRegistry } from "./immutable.js";
import { parseXml } from "./protocol/xml.js";

export type ServerInfoProfile = "native" | "web";
export interface ServerInfoInput {
  readonly profile?: ServerInfoProfile;
}
export interface ServerCatalogLimit {
  readonly objectTypeName: string;
  readonly maxRecordsNum: string;
}
/** Database behind the server, by the flags the server itself tells its database type by. */
export type ServerDatabase = "mssql" | "postgresql" | "oracle" | "azure" | "xml" | "other";
export interface ServerInfoData {
  readonly profile: ServerInfoProfile;
  readonly versionServer: string;
  readonly osType: "windows" | "linux";
  readonly capabilityMask: string;
  readonly database: ServerDatabase;
  /** Licence limits on the number of objects by type, declared at server start; not current counts. */
  readonly catalogLimits: readonly ServerCatalogLimit[];
}

const fields = ["sys_db_capability", "catalog_limits", "version_server", "os_type"] as const;
const maxCatalogXmlBytes = 256 * 1024;
const maxCatalogRows = 4096;

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error();
  return value as Record<string, unknown>;
}
function blank(value: unknown): boolean {
  return value === undefined || (typeof value === "string" && value.trim() === "");
}
function exactKeys(node: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(node).some((key) => !allowed.includes(key))) throw new Error();
}
function wrapper(value: unknown, child: string): unknown {
  const node = object(value);
  if (
    !blank(node["#text"]) ||
    Object.keys(node).some((key) => {
      if (key === child || key === "#text") return false;
      return (
        !/^@_xmlns(?::[A-Za-z_][\w.-]*)?$/.test(key) ||
        typeof node[key] !== "string" ||
        node[key].length > 1024
      );
    })
  )
    throw new Error();
  return node[child];
}
function typedText(value: unknown, type: "string" | "integer"): string {
  const node = object(value);
  exactKeys(node, ["@_VALUE-TYPE", "#text"]);
  if (typeof node["@_VALUE-TYPE"] !== "string" || node["@_VALUE-TYPE"].toLowerCase() !== type)
    throw new Error();
  const text = node["#text"] ?? "";
  if (typeof text !== "string") throw new Error();
  return text;
}
function signedInteger(value: string): string {
  if (!/^(?:0x[0-9a-fA-F]{1,16}|[+-]?\d{1,20})$/.test(value)) throw new Error();
  const integer = BigInt(value);
  if (integer < -0x8000000000000000n || integer > 0x7fffffffffffffffn) throw new Error();
  return value;
}
/**
 * Flags of the stock UNI_CAP_* list: BASIC 1, AZURE 0x8000, MSSQL 0x10000, ORACLE 0x20000. The list has no
 * flag for PostgreSQL; bit 33 is the one seen set on PostgreSQL only (2025.1.1171 — 2025.2.1535).
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

/** Decode only the fixed stock metadata RPC; never evaluate or decode XML text twice. */
export function parseServerInfo(
  response: unknown,
  profile: ServerInfoProfile = "native",
): ServerInfoData {
  try {
    if (profile !== "native" && profile !== "web") throw new Error();
    const rpc = object(response);
    exactKeys(rpc, ["xml", "valueType", "lexicalValue"]);
    if (
      (rpc.valueType !== undefined &&
        (typeof rpc.valueType !== "string" || rpc.valueType.toLowerCase() !== "object")) ||
      !blank(rpc.lexicalValue)
    )
      throw new Error();
    const result = object(wrapper(wrapper(rpc.xml, "ResultData"), "Result"));
    exactKeys(result, ["@_VALUE-TYPE", "#text", ...fields]);
    if (
      typeof result["@_VALUE-TYPE"] !== "string" ||
      result["@_VALUE-TYPE"].toLowerCase() !== "object" ||
      !blank(result["#text"])
    )
      throw new Error();
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
