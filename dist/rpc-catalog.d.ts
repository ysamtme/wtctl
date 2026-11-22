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
    /** Включить функции, которые может вызывать только код сервера. */
    readonly all?: boolean;
    /** Сколько функций пропустить: nextCursor прошлой страницы. */
    readonly cursor?: number;
    /** Функций на странице, 1–100; по умолчанию 30. */
    readonly limit?: number;
}
/** Аргументы describeRpc помимо targetId. */
export interface RpcDescribeOptions {
    /** Добавить код функции, до 8 КБ. */
    readonly source?: boolean;
}
/** Откуда взят список функций. */
interface RpcCatalogSource {
    /** Источник списка функций — подключённый сервер. */
    readonly source: "server";
    /** Библиотеки, файл которых не прочитан: сервер его не отдал или клиент не разобрал. */
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
    /** Есть при serverOnlyHidden: как их показать. */
    readonly hint?: string;
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
export {};
