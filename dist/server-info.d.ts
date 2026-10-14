import type { HcmServer } from "./hcm-server.js";
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
/**
 * Разбирает только фиксированный штатный RPC метаданных; XML не вычисляется
 * и не декодируется дважды.
 */
export declare function parseServerInfo(response: unknown, profile?: ServerInfoProfile): ServerInfoData;
/** Сведения о сервере — тем же вызовом, которым их читает админка при запуске. */
export declare function readServerInfo(server: Pick<HcmServer, "read">, profile?: ServerInfoProfile): Promise<ServerInfoData>;
