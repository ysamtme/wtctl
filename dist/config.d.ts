import type { ConnectionConfig } from "./contracts.js";
export interface ConfigOptions {
    readonly configPath?: string;
    readonly connection?: string;
    readonly password?: string;
}
/** The client's own folder in the user's profile: the connections file and locally stored results. */
export declare function homeDirectory(): string;
/** Where the connections file is looked for when neither --config nor WTCTL_CONFIG names one. */
export declare function defaultConfigPath(): string;
/** The file as an object. A syntax error is reported by position only: the text may hold a password. */
export declare function parseConfiguration(text: string, path: string): Record<string, unknown>;
/** Load named JSON profiles or WTCTL_* environment settings without exposing credentials. */
export declare function loadConfig(options?: ConfigOptions): ConnectionConfig;
/** A credential-free sample profile suitable for committing. */
export declare function configExample(): Record<string, unknown>;
export interface NewConnection {
    readonly name: string;
    readonly baseUrl: string;
    readonly username: string;
    /** The password itself, kept in the file, or the name of the variable that holds it. */
    readonly password?: string;
    readonly passwordEnv?: string;
    readonly write: boolean;
    readonly execute: boolean;
}
/** The connections document with one connection added; the first one becomes the default. */
export declare function withConnection(document: Record<string, unknown>, connection: NewConnection, replace: boolean): Record<string, unknown>;
