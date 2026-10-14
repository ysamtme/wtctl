import type { NativeOperation } from "../contracts.js";
import type { GeneratedNativeId } from "./generated.js";

const compatibilityDescriptions: Readonly<Record<string, string>> = {
  "web.experimental.authenticate":
    "Войти штатным способом браузера через JSON (поддержан частично); нужен свой токен страницы входа. На сервере 2025.1.1171 во встроенном API SPXML2 маршрута authenticate нет; расширения приложения могут его добавлять. На проверенной установке штатная страница входа вернула HTTP 200 с текстом ошибки и без токена, поэтому POST authenticate и отзыв выданного билета не проверялись. Тело и cookie успешного ответа не проверены.",
};

type Effect = NativeOperation["effect"];
type ByArguments = (args: Readonly<Record<string, unknown>>) => Effect | undefined;
interface Right {
  effect: Effect;
  /** Эффект для этих аргументов, если они его меняют. */
  byArguments?: ByArguments;
  /** Runtime вызывает её сам; вызывающий её не видит. */
  internal?: true;
}

const isReference = (value: unknown): boolean =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).length === 1 &&
  typeof (value as Record<string, unknown>).$ref === "string";

// Флаги блокировки меняют эффект, даже если получение документа или URL по умолчанию читает.
// Права пакета вычисляются до разрешения ссылок. Неразрешённый флаг блокировки
// или объект аргументов может превратить это чтение в блокирующую запись.
const lockable: ByArguments = (args) =>
  isReference(args) || args.tryLock === true || isReference(args.tryLock) ? "write" : undefined;

// GET и HEAD читают; отсутствующий метод или ссылка остаются неизвестными.
const byHttpVerb: ByArguments = (args) => {
  if (typeof args.method !== "string") return undefined;
  const verb = args.method.toUpperCase();
  return verb === "GET" || verb === "HEAD" ? "read" : undefined;
};

/**
 * Право каждой сгенерированной низкоуровневой операции названо явно, не выводится из имени метода.
 * Компилятор следит за полнотой таблицы: метод слоя протокола без строки не соберётся.
 */
const RIGHTS = {
  "native.lds.getCatalogsStat": "read",
  "native.lds.getModObjects": "read",
  "native.lds.releaseCursor": "read",
  "native.lds.idle": "read",
  "web.lds.releaseCursor": "read",
  "web.spxml.getBackgroundTasksByName": "read",
  "web.spxml.getAsyncMethodStatus": "read",
  "native.spxml2.getAppInfo": "read",
  "native.spxml2.getForm": "read",
  "web.spxml2.getAppInfo": "read",
  "web.spxml2.getForm": "read",
  "web.spxml2.getImage": "read",
  "web.spxml2.getPreloadedDesignFiles": "read",
  "web.spxml2.stdEncrypt": "read",
  "web.pages.filePreviewPdf": "read",
  "web.pages.getForm": "read",
  "web.pages.getScreenForm": "read",
  "web.pages.getImage": "read",
  "web.pages.getUiText": "read",
  "web.pages.getUrl": "read",
  "native.resources.getImage": "read",
  "native.resources.getCompoundResource": "read",
  "web.resources.getImage": "read",
  "web.resources.getCompoundResource": "read",
  "anonymous.diagnostics.xhttpInfo": "read",
  "web.lifecycle.admin": "read",
  "web.lifecycle.main": "read",
  "web.lifecycle.logout": "read",
  "native.lds.loadDoc": { effect: "read", byArguments: lockable },
  "web.spxml.getDoc": { effect: "read", byArguments: lockable },
  "native.lds.loadUrl": { effect: "read", internal: true },
  "native.lds.putDoc": "write",
  "native.lds.deleteDoc": "write",
  "native.lds.getNewObjectId": "write",
  "web.lds.deleteDoc": "write",
  "web.spxml.killAsyncMethod": "write",
  "web.spxml.putDoc": "write",
  "web.pages.uploadFile": "write",
  "web.pages.uploadChunk": "write",
  "web.pages.clearUploadChunks": "write",
  "native.lds.putUrl": { effect: "write", internal: true },
  "native.lds.deleteUrl": { effect: "write", internal: true },
  "native.lds.xQuery": "execute",
  "native.lds.runMethod": "execute",
  "web.lds.xQuery": "execute",
  "web.lds.runMethod": "execute",
  "native.rpc.call": "execute",
  "web.rpc.call": "execute",
  "web.spxml.callMethod": "execute",
  "web.spxml.callMethodAsync": "execute",
  "web.experimental.authenticate": "execute",
  "anonymous.experimental.rawRequest": { effect: "unknown", byArguments: byHttpVerb },
  "native.experimental.rawRequest": { effect: "unknown", byArguments: byHttpVerb },
  "web.experimental.rawRequest": { effect: "unknown", byArguments: byHttpVerb },
} satisfies Record<GeneratedNativeId, Effect | Right>;

function rightOf(id: string): Right | undefined {
  if (!Object.hasOwn(RIGHTS, id)) return undefined;
  const row = (RIGHTS as Readonly<Record<string, Effect | Right>>)[id];
  return typeof row === "string" ? { effect: row } : row;
}

/**
 * Ставит названное право на сгенерированную операцию; где общая формулировка вводит
 * в заблуждение, заменяет описание.
 */
export function decorateOperation(operation: Omit<NativeOperation, "effect">): NativeOperation {
  const right = rightOf(operation.id);
  if (!right) throw new Error(`Для ${operation.id} не указано право`);
  const description = compatibilityDescriptions[operation.id];
  // Право ставится туда, куда его кладёт порядок полей генерации: потребители видят прежний JSON.
  const { inputSchema, ...head } = operation;
  return {
    ...head,
    ...(description === undefined ? {} : { description }),
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
