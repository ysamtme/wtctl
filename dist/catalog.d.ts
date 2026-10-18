import type { OperationDefinition, OperationEffect, OperationFilter, OperationPage } from "./contracts.js";
/** Операции клиента по странице, без подключения к серверу: то же, что client.listOperations. */
export declare function listHcmOperations(filter?: OperationFilter): OperationPage;
/**
 * Описание операции по ID, без подключения к серверу: то же, что client.describe. Неизвестный
 * ID — HcmError UNKNOWN_OPERATION.
 */
export declare function describeHcmOperation(id: string): OperationDefinition;
/** Класс вызова по фактическим аргументам, без подключения к серверу. */
export declare function operationEffect(id: string, args?: Record<string, unknown>): OperationEffect;
/**
 * Подсказка к неизвестному ID: похожие называются ID операций, а список операций — так, как его
 * называет вызывающий (`name`). CLI и MCP-сервер строят её заново, а не разбирают текст.
 */
export declare function unknownOperationHint(id: string, name?: (known: string) => string): string;
