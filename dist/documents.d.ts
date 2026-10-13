export declare function patchSegments(path: string): RegExpExecArray[];
export interface DocumentSnapshot {
    readonly type: string;
    readonly xml: string;
    readonly fingerprint: string;
    readonly data: Record<string, unknown>;
    readonly formUrl?: string;
}
/** Скалярные значения показаны как были и как записаны; структура названа, а не скопирована. */
export interface PatchChange {
    readonly op: "set" | "remove";
    readonly path: string;
    readonly before?: unknown;
    readonly after?: unknown;
}
/** Сохраняет по порядку неизвестные элементы, атрибуты, комментарии и CDATA при правке путей. */
export declare class XmlDocument {
    private root;
    private constructor();
    static parse(source: string): XmlDocument;
    static create(type: string, data: Record<string, unknown>, formUrl?: string): XmlDocument;
    snapshot(): DocumentSnapshot;
    patch(input: unknown): {
        before: DocumentSnapshot;
        after: DocumentSnapshot;
        changes: PatchChange[];
    };
}
