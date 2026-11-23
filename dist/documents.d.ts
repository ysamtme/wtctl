/** Нормализация переводов строк XML 1.0 §2.11: CRLF и одиночный CR приводятся к LF. */
export declare function normalizeXmlLineEndings(value: string): string;
export interface SameDataOptions {
    /** Карта типов полей формы: нормализация CRLF/CR → LF применяется только к строковым полям. */
    readonly fieldTypes?: ReadonlyMap<string, string>;
    /** Текущий путь в документе (без индексов массивов) для поиска типа в fieldTypes. */
    readonly path?: string;
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
