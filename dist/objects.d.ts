import { XmlDocument, type PatchChange } from "./documents.js";
import type { HcmServer } from "./hcm-server.js";
import type { WriteOutcome } from "./write-outcome.js";
import { type SchemaReader } from "./schema.js";
/** Запись возвращает сводку, а не копию документа; нужны поля — прочитать объект. */
export interface CreatedObjectData {
    readonly id: string;
    readonly type: string;
    readonly url: string;
    readonly fingerprint: string;
    readonly mutationId: string;
    readonly mutationOutcome: "confirmed";
}
/** Ничего не записано: запрошен предпросмотр или правка ничего не меняет (noop). */
export interface PatchPreviewData {
    readonly preview: boolean;
    readonly noop: boolean;
    readonly changes: PatchChange[];
    readonly fingerprint: string;
}
export interface PatchedObjectData {
    readonly id?: string;
    readonly type: string;
    readonly url: string;
    readonly fingerprint: string;
    readonly changes: PatchChange[];
    /** Поля верхнего уровня вне правки, которые сервер сам изменил при сохранении. */
    readonly serverChanged?: string[];
    readonly mutationId: string;
    readonly mutationOutcome: "confirmed";
}
export interface DeletedObjectData {
    readonly id?: string;
    readonly mutationId: string;
    readonly mutationOutcome: "confirmed";
    readonly verification: string;
    readonly catalog?: string;
}
/** Объекты сервера: чтение, создание, правка и удаление одного документа, с журналом записей. */
export declare class ServerObjects {
    private readonly server;
    private readonly schema;
    /** Папка журнала записей, mutations.jsonl. */
    private readonly journalDirectory;
    constructor(server: Pick<HcmServer, "call" | "read" | "applicationInfo">, schema: Pick<SchemaReader, "documentShape" | "catalogShape" | "requireType" | "documentForm">, 
    /** Папка журнала записей, mutations.jsonl. */
    journalDirectory: string);
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
     * сервер не может прочитать, сохраняется другим значением.
     */
    private requireFields;
    create(args: Record<string, unknown>, out: WriteOutcome): Promise<CreatedObjectData>;
    patch(args: Record<string, unknown>, out: WriteOutcome): Promise<PatchedObjectData | PatchPreviewData>;
    delete(args: Record<string, unknown>, out: WriteOutcome): Promise<DeletedObjectData>;
}
