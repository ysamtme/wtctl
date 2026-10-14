import type { OperationDefinition, OperationFilter, OperationPage } from "./contracts.js";
/** Операции клиента по странице, без подключения к серверу: то же, что client.listOperations. */
export declare function listHcmOperations(filter?: OperationFilter): OperationPage;
/**
 * Описание операции по ID, без подключения к серверу: то же, что client.describe. Неизвестный
 * ID — HcmError UNKNOWN_OPERATION.
 */
export declare function describeHcmOperation(id: string): OperationDefinition;
/**
 * Подсказка к неизвестному ID: похожие называются ID операций, а список операций — так, как его
 * называет вызывающий (`name`). CLI и MCP-сервер строят её заново, а не разбирают текст.
 */
export declare function unknownOperationHint(id: string, name?: (known: string) => string): string;
