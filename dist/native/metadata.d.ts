import type { NativeOperation } from "../contracts.js";
/**
 * Ставит названное право на сгенерированную операцию; где общая формулировка вводит
 * в заблуждение, заменяет описание.
 */
export declare function decorateOperation(operation: Omit<NativeOperation, "effect">): NativeOperation;
/** Runtime вызывает их сам; вызывающий их не видит. */
export declare function isInternalNative(id: string): boolean;
/** Эффект операции реестра для этих аргументов; у операции без строки остаётся собственный. */
export declare function getEffectiveNativeEffect(operation: NativeOperation, args: Readonly<Record<string, unknown>>): NativeOperation["effect"];
