import type { OperationDefinition, OperationFilter, OperationPage } from "./contracts.js";
/** Packaged operation metadata only; no connection, credentials or server probe. */
export declare function listHcmOperations(filter?: OperationFilter): OperationPage;
/** Exact descriptor of one operation; no connection or server probe. */
export declare function describeHcmOperation(id: string): OperationDefinition;
