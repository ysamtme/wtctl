import { NativeGateway } from "./native/index.js";
import { ResultStore } from "./results.js";
import { LogReader } from "./logs.js";
import { type ServerPort } from "./hcm-server.js";
import type { RuntimePort } from "./runtime-port.js";
import type { ConnectionConfig, OperationDefinition, OperationEffect, OperationFilter, OperationPage, OperationResult } from "./contracts.js";
/** Единый runtime: сессии, сериализация, локальные права и артефакты для всех интерфейсов. */
export declare class HcmRuntime implements RuntimePort {
    readonly config: ConnectionConfig;
    readonly gateway: NativeGateway;
    readonly results: ResultStore;
    readonly logs: LogReader;
    private readonly replies;
    private readonly server;
    private readonly schemaReader;
    private readonly files;
    private readonly objects;
    private readonly rpcCatalog;
    private readonly context;
    private queue;
    private closed;
    private closePromise;
    constructor(config: ConnectionConfig, 
    /** Как дойти до сервера; по умолчанию — шлюз подключения. */
    port?: ServerPort);
    listOperations(filter?: OperationFilter): OperationPage;
    describe(id: string): OperationDefinition;
    /**
     * Условные побочные эффекты по фактическим аргументам; MCP, CLI и SDK обязаны вызвать это
     * до маршрутизации.
     */
    getOperationEffect(id: string, args?: Record<string, unknown>): OperationEffect;
    /** Определение операции; отказ для неверного или неизвестного ID формулирует describe. */
    private operation;
    call(id: string, args?: Record<string, unknown>): Promise<OperationResult>;
    private effect;
    private authorize;
    private perform;
    private failure;
    close(): Promise<void>;
}
