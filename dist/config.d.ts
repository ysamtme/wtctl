import type { ConnectionConfig } from "./contracts.js";
export interface ConfigOptions {
    readonly configPath?: string;
    readonly connection?: string;
    readonly password?: string;
}
/** Папка клиента в профиле пользователя: файл подключений и сохранённые результаты. */
export declare function homeDirectory(): string;
/** Где ищется файл подключений, если ни --config, ни WTCTL_CONFIG его не назвали. */
export declare function defaultConfigPath(): string;
/** Файл как объект. Ошибка синтаксиса называется только позицией: в тексте может быть пароль. */
export declare function parseConfiguration(text: string, path: string): Record<string, unknown>;
/** Читает именованные подключения из JSON или переменные WTCTL_*, не раскрывая учётных данных. */
export declare function loadConfig(options?: ConfigOptions): ConnectionConfig;
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
