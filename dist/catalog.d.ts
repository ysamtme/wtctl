import type { OperationDefinition, OperationFilter, OperationPage } from "./contracts.js";
/** Только упакованные метаданные операций: без подключения, учётных данных и проверки сервера. */
export declare function listHcmOperations(filter?: OperationFilter): OperationPage;
/** Точное описание одной операции; без подключения и проверки сервера. */
export declare function describeHcmOperation(id: string): OperationDefinition;
