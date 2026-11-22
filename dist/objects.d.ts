import { type PatchChange } from "./documents.js";
/** Запись возвращает сводку, а не копию документа; нужны поля — прочитать объект. */
export interface CreatedObjectData {
    /** ID нового объекта, 0x…. */
    readonly id: string;
    /** Тип объекта. */
    readonly type: string;
    /** Адрес документа. */
    readonly url: string;
    /** Отпечаток записанного документа: expectedFingerprint для правки. */
    readonly fingerprint: string;
    /** ID записи в журнале записей mutations.jsonl. */
    readonly mutationId: string;
    /** Исход записи: подтверждена. */
    readonly mutationOutcome: "confirmed";
}
/** Ничего не записано: запрошен предпросмотр или правка ничего не меняет (noop). */
export interface PatchPreviewData {
    /** Запрошен предпросмотр. */
    readonly preview: boolean;
    /** Правка ничего не меняет, и resave не задан. */
    readonly noop: boolean;
    /** Что изменила бы правка. */
    readonly changes: PatchChange[];
    /** Отпечаток документа сейчас: expectedFingerprint для записи. */
    readonly fingerprint: string;
    /** Поля правки, которые сервер заполняет сам при сохранении: записанное значение он, скорее всего, заменит. */
    readonly serverFilled?: string[];
}
/** Ответ patch, когда правка записана. */
export interface PatchedObjectData {
    /** ID объекта. */
    readonly id?: string;
    /** Тип объекта. */
    readonly type: string;
    /** Адрес документа. */
    readonly url: string;
    /** Отпечаток записанного документа. */
    readonly fingerprint: string;
    /** Что изменено. */
    readonly changes: PatchChange[];
    /** Поля верхнего уровня вне правки, которые сервер сам изменил при сохранении. */
    readonly serverChanged?: string[];
    /** ID записи в журнале записей mutations.jsonl. */
    readonly mutationId: string;
    /** Исход записи: подтверждена. */
    readonly mutationOutcome: "confirmed";
}
/** Ответ delete. */
export interface DeletedObjectData {
    /** ID удалённого объекта. */
    readonly id?: string;
    /** ID записи в журнале записей mutations.jsonl. */
    readonly mutationId: string;
    /** Исход записи: подтверждена. */
    readonly mutationOutcome: "confirmed";
    /** Чем проверено удаление: server — ответом сервера, catalog — объекта больше нет в каталоге. */
    readonly verification: "server" | "catalog";
    /** Каталог, по которому проверено удаление. */
    readonly catalog?: string;
}
