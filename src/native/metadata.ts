import type { NativeOperation } from "../contracts.js";
import { isStepReference } from "../operation.js";
import type { GeneratedNativeId } from "./generated.js";

type Effect = NativeOperation["effect"];
type ByArguments = (args: Readonly<Record<string, unknown>>) => Effect | undefined;
interface Right {
  effect: Effect;
  /** Эффект для этих аргументов, если они его меняют. */
  byArguments?: ByArguments;
  /** Runtime вызывает её сам; вызывающий её не видит. */
  internal?: true;
}

// Флаги блокировки меняют эффект, даже если получение документа по умолчанию читает.
// Права пакета вычисляются до разрешения ссылок. Неразрешённый флаг блокировки
// или объект аргументов может превратить это чтение в блокирующую запись.
const lockable: ByArguments = (args) =>
  isStepReference(args) || args.tryLock === true || isStepReference(args.tryLock)
    ? "write"
    : undefined;

/**
 * Право каждой сгенерированной низкоуровневой операции названо явно, не выводится из имени метода.
 * Компилятор следит за полнотой таблицы: метод слоя протокола без строки не соберётся.
 */
const RIGHTS = {
  "web.spxml.getBackgroundTasksByName": "read",
  "web.spxml.getAsyncMethodStatus": "read",
  "native.spxml2.getAppInfo": "read",
  "native.spxml2.getForm": "read",
  "web.pages.getScreenForm": "read",
  "web.pages.getUiText": "read",
  "native.resources.getImage": "read",
  "native.resources.getCompoundResource": "read",
  "anonymous.diagnostics.xhttpInfo": "read",
  "native.lds.loadDoc": { effect: "read", byArguments: lockable },
  "native.lds.loadUrl": { effect: "read", internal: true },
  "native.lds.putDoc": "write",
  "native.lds.deleteDoc": "write",
  "native.lds.getNewObjectId": "write",
  "web.spxml.killAsyncMethod": "write",
  "web.pages.uploadFile": "write",
  "web.pages.uploadChunk": "write",
  "web.pages.clearUploadChunks": "write",
  "native.lds.deleteUrl": { effect: "write", internal: true },
  "native.lds.xQuery": "execute",
  "native.rpc.call": "execute",
  "web.rpc.call": "execute",
  "web.spxml.callMethodAsync": "execute",
} satisfies Record<GeneratedNativeId, Effect | Right>;

function rightOf(id: string): Right | undefined {
  if (!Object.hasOwn(RIGHTS, id)) return undefined;
  const row = (RIGHTS as Readonly<Record<string, Effect | Right>>)[id];
  return typeof row === "string" ? { effect: row } : row;
}

/** Ставит названное право на сгенерированную операцию. */
export function decorateOperation(operation: Omit<NativeOperation, "effect">): NativeOperation {
  const right = rightOf(operation.id);
  if (!right) throw new Error(`Для ${operation.id} не указано право`);
  // Право ставится туда, куда его кладёт порядок полей генерации: потребители видят прежний JSON.
  const { inputSchema, ...head } = operation;
  return {
    ...head,
    effect: right.effect,
    inputSchema,
  };
}

/** Runtime вызывает их сам; вызывающий их не видит. */
export function isInternalNative(id: string): boolean {
  return rightOf(id)?.internal === true;
}

/** Эффект операции реестра для этих аргументов; у операции без строки остаётся собственный. */
export function getEffectiveNativeEffect(
  operation: NativeOperation,
  args: Readonly<Record<string, unknown>>,
): NativeOperation["effect"] {
  return rightOf(operation.id)?.byArguments?.(args) ?? operation.effect;
}
