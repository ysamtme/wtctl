import { HcmError } from "./errors.js";
/** Функция библиотеки сервера. */
export interface RpcTargetCard {
    /** «библиотека.функция»: tools.get_version. */
    readonly id: string;
    /** Имена параметров по порядку; типов сервер не объявляет. */
    readonly parameters: readonly string[];
    /** Разрешён ли вызов с клиента; null — не установлено. */
    readonly allowed: boolean | null;
    /** Функция не допускает вызова с клиента: её зовёт только код сервера. */
    readonly serverOnly?: true;
}
/** Аргументы listRpc. */
export interface RpcCatalogFilter {
    /** Часть имени функции или параметра. */
    readonly query?: string;
    /** Библиотека: tools, ms_tools… */
    readonly library?: string;
    /** Имя функции целиком. */
    readonly method?: string;
    /** Встроенная таблица функций сервера 2025.1.1171, без обращения к серверу. */
    readonly builtIn?: boolean;
    /** Включить функции, которые может вызывать только код сервера. */
    readonly all?: boolean;
    /** Сколько функций пропустить: nextCursor прошлой страницы. */
    readonly cursor?: number;
    /** Функций на странице, 1–100; по умолчанию 30. */
    readonly limit?: number;
}
/** Аргументы describeRpc помимо targetId. */
export interface RpcDescribeOptions {
    /** Встроенная таблица функций сервера 2025.1.1171, без обращения к серверу. */
    readonly builtIn?: boolean;
    /** Добавить код функции, до 8 КБ. */
    readonly source?: boolean;
}
/** Откуда взят список функций. */
interface RpcCatalogSource {
    /** Откуда список: с сервера или из встроенной таблицы 2025.1.1171. */
    readonly source: "server" | "built-in 2025.1.1171";
    /** Библиотеки, список функций которых сервер не отдал. */
    readonly skipped?: readonly string[];
}
/** Страница функций: ответ listRpc. */
export interface RpcCatalogPage extends RpcCatalogSource {
    /** Функции страницы. */
    readonly targets: readonly RpcTargetCard[];
    /** Сколько функций подходит всего. */
    readonly total: number;
    /** Подходящие функции, пропущенные из-за того, что клиент их не вызовет; all:true выводит их. */
    readonly serverOnlyHidden?: number;
    /** cursor следующей страницы; нет — страница последняя. */
    readonly nextCursor?: number;
}
/** Функция библиотеки с кодом: ответ describeRpc. */
export interface RpcTargetDescription extends RpcTargetCard, RpcCatalogSource {
    /** Как вызвать функцию, которую клиент вызвать не может. */
    readonly note?: string;
    /** С source:true: код функции, до 8 КБ. */
    readonly code?: string;
    /** Код длиннее 8 КБ и обрезан. */
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
