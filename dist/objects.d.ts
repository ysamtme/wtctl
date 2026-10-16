import { XmlDocument, type PatchChange } from "./documents.js";
import type { HcmServer } from "./hcm-server.js";
import type { WriteOutcome } from "./write-outcome.js";
import { type SchemaReader } from "./schema.js";
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
/** Объекты сервера: чтение, создание, правка и удаление одного документа, с журналом записей. */
export declare class ServerObjects {
    private readonly server;
    private readonly schema;
    /** Журнал записей: папка с mutations.jsonl и его предел в байтах, 0 — без предела. */
    private readonly journalFile;
    constructor(server: Pick<HcmServer, "call" | "read" | "applicationInfo">, schema: Pick<SchemaReader, "documentShape" | "catalogShape" | "requireType" | "documentForm">, 
    /** Журнал записей: папка с mutations.jsonl и его предел в байтах, 0 — без предела. */
    journalFile: {
        readonly directory: string;
        readonly maxBytes: number;
    });
    /** Один объект по id или url, как отвечает objects.get. */
    get(args: Record<string, unknown>): Promise<Record<string, unknown>>;
    load(args: Record<string, unknown>): Promise<{
        document: XmlDocument;
        url: string;
        id: string | undefined;
    }>;
    private journal;
    private resolveCatalog;
    /**
     * Значения названных полей в строке каталога объекта. В `known` — имена, которые являются
     * полями каталога, есть у строки значение для них или нет.
     */
    private catalogRow;
    private catalogHasId;
    /**
     * Чего сервер не сохранит, отклоняется до записи: поле, которого нет у типа, выпадает из
     * сохранённого документа, как и значение поля, которое сервер вычисляет сам, а дата, которую
     * сервер не может прочитать, сохраняется другим значением. Ответ — поля, которые сервер
     * заполняет при сохранении сам, с полем, из которого их стоит менять, если оно угадывается.
     */
    private requireFields;
    create(args: Record<string, unknown>, out: WriteOutcome): Promise<CreatedObjectData>;
    patch(args: Record<string, unknown>, out: WriteOutcome): Promise<PatchedObjectData | PatchPreviewData>;
    delete(args: Record<string, unknown>, out: WriteOutcome): Promise<DeletedObjectData>;
}
