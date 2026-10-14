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
/** Папка клиента в профиле пользователя: файл подключений и сохранённые результаты. */
export declare function homeDirectory(): string;
/** Где ищется файл подключений, если ни --config, ни WTCTL_CONFIG его не назвали. */
export declare function defaultConfigPath(): string;
/** Файл как объект. Ошибка синтаксиса называется только позицией: в тексте может быть пароль. */
export declare function parseConfiguration(text: string, path: string): Record<string, unknown>;
/** Умолчания пределов локальных файлов; их же берёт подключение, собранное без loadConfig. */
export declare const LOCAL_LIMITS: {
    readonly resultsMaxBytes: number;
    readonly resultsMaxAgeDays: 7;
    readonly journalMaxBytes: number;
};
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
/**
 * Подсказка WRITE_DISABLED и EXECUTE_DISABLED: где подключению включают это право. Путь файла
 * не называется: ответ прячет локальные пути.
 */
export declare function permissionHint(config: ConnectionConfig, right: "write" | "execute"): string;
/** Образец подключения без учётных данных, который можно коммитить. */
export declare function configExample(): Record<string, unknown>;
export interface NewConnection {
    readonly name: string;
    readonly baseUrl: string;
    readonly username: string;
    /** Сам пароль, хранимый в файле, или имя переменной, в которой он лежит. */
    readonly password?: string;
    readonly passwordEnv?: string;
    readonly write: boolean;
    readonly execute: boolean;
}
/** Документ подключений с добавленным подключением; первое становится подключением по умолчанию. */
export declare function withConnection(document: Record<string, unknown>, connection: NewConnection, replace: boolean): Record<string, unknown>;
export {};
