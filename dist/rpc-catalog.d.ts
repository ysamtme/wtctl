import { HcmError } from "./errors.js";
export interface RpcTargetCard {
    readonly id: string;
    readonly parameters: readonly string[];
    readonly allowed: boolean | null;
    /** The function has no client gate: it is called from server code only. */
    readonly serverOnly?: true;
}
export interface RpcCatalogFilter {
    readonly query?: string;
    readonly library?: string;
    readonly method?: string;
    readonly builtIn?: boolean;
    /** Include functions that only server code can call. */
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
    /** Matching functions left out because a client cannot call them; all:true lists them. */
    readonly serverOnlyHidden?: number;
    readonly nextCursor?: number;
}
export interface RpcTargetDescription extends RpcTargetCard, RpcCatalogSource {
    /** How to call a function that a client cannot call. */
    readonly note?: string;
    readonly code?: string;
    readonly codeTruncated?: true;
}
export declare const RPC_CATALOG_PAGE_MAX_BYTES: number;
/** Runtime-local discovery; calling a target remains a separate operation. */
export declare class RpcCatalog {
    private readonly reader;
    constructor(applicationInfo?: () => Promise<Record<string, unknown>>, readFile?: (url: string) => Promise<unknown>);
    private catalog;
    /** Why the server refused a call, when its own list of functions explains it. */
    refusal(targetId: string): Promise<HcmError | undefined>;
    list(filter?: RpcCatalogFilter): Promise<RpcCatalogPage>;
    describe(targetId: string, options?: RpcDescribeOptions): Promise<RpcTargetDescription>;
}
export {};
