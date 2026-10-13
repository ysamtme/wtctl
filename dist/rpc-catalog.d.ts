import { HcmError } from "./errors.js";
export interface RpcTargetCard {
    readonly id: string;
    readonly parameters: readonly string[];
    readonly allowed: boolean | null;
    /** Функция не допускает вызова с клиента: её зовёт только код сервера. */
    readonly serverOnly?: true;
}
export interface RpcCatalogFilter {
    readonly query?: string;
    readonly library?: string;
    readonly method?: string;
    readonly builtIn?: boolean;
    /** Включить функции, которые может вызывать только код сервера. */
    readonly all?: boolean;
    readonly cursor?: number;
    readonly limit?: number;
}
export interface RpcDescribeOptions {
    readonly builtIn?: boolean;
    readonly source?: boolean;
}
interface RpcCatalogSource {
    readonly source: "server" | "built-in 2025.1.1171";
    readonly skipped?: readonly string[];
}
export interface RpcCatalogPage extends RpcCatalogSource {
    readonly targets: readonly RpcTargetCard[];
    readonly total: number;
    /** Подходящие функции, пропущенные из-за того, что клиент их не вызовет; all:true выводит их. */
    readonly serverOnlyHidden?: number;
    readonly nextCursor?: number;
}
export interface RpcTargetDescription extends RpcTargetCard, RpcCatalogSource {
    /** Как вызвать функцию, которую клиент вызвать не может. */
    readonly note?: string;
    readonly code?: string;
    readonly codeTruncated?: true;
}
export declare const RPC_CATALOG_PAGE_MAX_BYTES: number;
/** Поиск целей внутри runtime; вызов цели остаётся отдельной операцией. */
export declare class RpcCatalog {
    private readonly reader;
    constructor(applicationInfo?: () => Promise<Record<string, unknown>>, readFile?: (url: string) => Promise<unknown>);
    private catalog;
    /** Почему сервер отказал в вызове, если это объясняет его собственный список функций. */
    refusal(targetId: string): Promise<HcmError | undefined>;
    list(filter?: RpcCatalogFilter): Promise<RpcCatalogPage>;
    describe(targetId: string, options?: RpcDescribeOptions): Promise<RpcTargetDescription>;
}
export {};
