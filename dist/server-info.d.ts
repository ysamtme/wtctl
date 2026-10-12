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
/** Decode only the fixed stock metadata RPC; never evaluate or decode XML text twice. */
export declare function parseServerInfo(response: unknown, profile?: ServerInfoProfile): ServerInfoData;
