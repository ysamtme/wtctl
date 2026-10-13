export type ServerInfoProfile = "native" | "web";
export interface ServerInfoInput {
    readonly profile?: ServerInfoProfile;
}
export interface ServerCatalogLimit {
    readonly objectTypeName: string;
    readonly maxRecordsNum: string;
}
/** База за сервером по флагам, которыми сам сервер определяет тип своей базы. */
export type ServerDatabase = "mssql" | "postgresql" | "oracle" | "azure" | "xml" | "other";
export interface ServerInfoData {
    readonly profile: ServerInfoProfile;
    readonly versionServer: string;
    readonly osType: "windows" | "linux";
    readonly capabilityMask: string;
    readonly database: ServerDatabase;
    /** Лицензионные пределы числа объектов по типам, объявленные при запуске, не текущие числа. */
    readonly catalogLimits: readonly ServerCatalogLimit[];
    /** Профиль native: папки, куда файлы идут через LDS, и те, куда пишет только код на сервере. */
    readonly dataFolders?: readonly string[];
    readonly codeFolders?: readonly string[];
}
/**
 * Разбирает только фиксированный штатный RPC метаданных; XML не вычисляется
 * и не декодируется дважды.
 */
export declare function parseServerInfo(response: unknown, profile?: ServerInfoProfile): ServerInfoData;
