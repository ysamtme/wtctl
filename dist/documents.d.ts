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
