import type { ConnectionConfig } from "./contracts.js";
/** Аргументы loadConfig: откуда взять подключение. */
export interface ConfigOptions {
    /** Файл подключений; по умолчанию WTCTL_CONFIG, иначе ~/.wtctl/connections.json. */
    readonly configPath?: string;
    /** Имя подключения в файле; по умолчанию WTCTL_CONNECTION, иначе defaultConnection файла. */
    readonly connection?: string;
    /** Пароль вместо пароля из файла и переменных. */
    readonly password?: string;
    /** Настройки кодом, сильнее переменных и файла; с baseUrl — подключение без файла и переменных. */
    readonly settings?: ConnectionSettings;
}
/** Поля подключения, которые одинаково задают поле файла, переменная окружения и settings. */
type SettingField = "timeoutMs" | "maxResponseBytes" | "outputLimitBytes" | "runtimeDir" | "resultsMaxBytes" | "resultsMaxAgeDays" | "journalMaxBytes";
/**
 * Поля подключения кодом: loadConfig({ settings }). Сильнее переменных и файла; с baseUrl —
 * отдельное подключение без файла и переменных, права по умолчанию выключены.
 */
export type ConnectionSettings = Partial<Pick<ConnectionConfig, "baseUrl" | "username" | "password" | SettingField>> & {
    /** Права отдельного подключения (с baseUrl); по умолчанию выключены. */
    readonly permissions?: Partial<ConnectionConfig["permissions"]>;
};
/**
 * Подключение из файла подключений или переменных WTCTL_*, как у CLI. settings сильнее и того
 * и другого; settings с baseUrl — подключение целиком, без файла. Бросает HcmError INVALID_CONFIG
 * при ошибке в настройках.
 */
export declare function loadConfig(options?: ConfigOptions): ConnectionConfig;
export {};
