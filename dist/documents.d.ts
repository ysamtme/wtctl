export declare function patchSegments(path: string): RegExpExecArray[];
export interface DocumentSnapshot {
    readonly type: string;
    readonly xml: string;
    readonly fingerprint: string;
    readonly data: Record<string, unknown>;
    readonly formUrl?: string;
}
/** Одно изменение документа. Значения показаны как были и как записаны; у структуры — поля первого уровня, вложенное названо, а не скопировано. */
export interface PatchChange {
    /** set — значение записано, remove — путь удалён. */
    readonly op: "set" | "remove";
    /** Путь в документе. */
    readonly path: string;
    /** Значение до правки. */
    readonly before?: unknown;
    /** Значение после правки. */
    readonly after?: unknown;
}
/** Сохраняет по порядку неизвестные элементы, атрибуты, комментарии и CDATA при правке путей. */
export declare class XmlDocument {
    private root;
    private constructor();
    static parse(source: string): XmlDocument;
    static create(type: string, data: Record<string, unknown>, formUrl?: string): XmlDocument;
    /** Тип и адрес формы — без сборки XML, которую делает snapshot. */
    form(): Pick<DocumentSnapshot, "type" | "formUrl">;
    snapshot(): DocumentSnapshot;
    /** types — TYPE полей формы по пути, как DataShape.types; без него ID узнаётся по виду. */
    patch(input: unknown, types?: ReadonlyMap<string, string>): {
        before: DocumentSnapshot;
        after: DocumentSnapshot;
        changes: PatchChange[];
    };
}
