import { HcmError } from "./errors.js";
/** Аргументы schema: тип или url и отбор полей. */
export interface SchemaInput {
    /** Тип объекта: collaborator, group…; вместо него можно url. */
    type?: string;
    /** Адрес документа: поля типа этого объекта. */
    url?: string;
    /** Слова в пути, заголовке или каталоге ссылки, на любой глубине; все слова — в одном поле. */
    search?: string;
    /** Структура, чьи поля показать: access, custom_elems. */
    path?: string;
    /** Вложенные поля всех глубин одним списком, а не по уровню за вызов. */
    deep?: boolean;
    /** Только поля этого происхождения: own, inherited, custom, catalog. */
    origin?: ("own" | "inherited" | "custom" | "catalog")[];
    /** ID вида объекта: настраиваемые поля этого вида, когда у типа customFields "by kind". */
    kind?: string;
    /** methods — добавить методы формы. */
    include?: "methods"[];
    /** Язык заголовков: ru, en…; по умолчанию язык интерфейса сервера. */
    language?: string;
    /** Полей на странице, 1–1000; по умолчанию 80. */
    limit?: number;
    /** Сколько полей пропустить: nextCursor прошлой страницы. */
    cursor?: number;
}
/** Поле типа объекта. */
export interface SchemaField {
    /** Путь поля в документе: name, access.access_level. */
    path: string;
    /** Тип значения: string, integer, date, bool… element — структура. */
    type: string;
    /** own — своё поле типа, inherited:… — унаследованное, custom — настраиваемое, catalog — только в строке каталога. */
    origin: string;
    /** Имя настраиваемого поля. */
    name?: string;
    /** Заголовок на языке сервера. */
    title?: string;
    /** Каталог или список, ID элемента которого лежит в поле. */
    references?: string;
    /** Элемент повторяется: в данных всегда список. */
    multiple?: true;
    /** Поле обязательно. */
    required?: true;
    /** Поле-ключ элемента списка. */
    key?: string;
    /** Структура: сколько в ней полей; их показывает path. */
    children?: number;
    /** Допустимые значения настраиваемого поля. */
    values?: string[];
    /** Вкладка настраиваемого поля в форме. */
    sheet?: string;
    /** Поле есть в каталоге: по нему ищет query. */
    query?: true;
    /** Значение вычисляет сервер: записанное не сохраняется. */
    computed?: true;
}
/** Страница полей типа: ответ schema. */
export interface SchemaResult {
    /** Тип объекта. */
    type: string;
    /** Каталог типа, если есть. */
    catalog?: string;
    /** Адрес формы типа. */
    formUrl: string;
    /** С path: элемент, чьи поля перечислены — список ли он, какой у него ключ. */
    element?: SchemaField;
    /** Поля страницы. */
    fields: SchemaField[];
    /** Сколько полей подходит всего. */
    total: number;
    /** cursor следующей страницы; нет — страница последняя. */
    nextCursor?: number;
    /** Страница короче запрошенной: больше не умещается в один ответ. */
    cutBySize?: true;
    /** Пояснения: где хранится вид объекта, что не удалось прочитать. */
    notes: string[];
    /** С include:["methods"]: методы формы. */
    methods?: {
        /** Имя метода. */
        name: string;
        /** Имена параметров. */
        parameters: string[];
    }[];
}
/** Аргументы types. */
export interface SchemaTypesInput {
    /** Слова в типе, каталоге или заголовке. */
    search?: string;
    /** Типов на странице, 1–1000; по умолчанию 50. */
    limit?: number;
    /** Сколько типов пропустить: nextCursor прошлой страницы. */
    cursor?: number;
}
/** Страница типов объектов: ответ types. */
export interface SchemaTypesResult {
    /** Типы страницы. */
    types: {
        /** Тип объекта. */
        type: string;
        /** Каталог типа; у части типов каталога нет. */
        catalog?: string;
        /** Заголовок на языке сервера. */
        title?: string;
        /** Сколько настраиваемых полей; "by kind" — они зависят от вида объекта (kind у schema). */
        customFields: number | "by kind";
    }[];
    /** Сколько типов подходит всего. */
    total: number;
    /** Всего каталогов на сервере, включая те, у которых нет своего типа объекта. */
    catalogs: number;
    /** cursor следующей страницы; нет — страница последняя. */
    nextCursor?: number;
    /** Пояснения к списку. */
    notes?: string[];
}
/** Чтобы привести данные к одному виду: имена полей верхнего уровня и повторяющиеся элементы. */
export interface DataShape {
    readonly fields: Set<string>;
    /** Пути элементов, объявленных формой повторяющимися, например collaborators.collaborator. */
    readonly repeated: Set<string>;
    /** Поля верхнего уровня, которые форма объявляет датами. */
    readonly dates: Set<string>;
    /** Поля верхнего уровня строки каталога, которые форма объявляет целыми: ID и счётчики. */
    readonly integers?: Set<string>;
    /** Поля верхнего уровня, которые вычисляет сервер: записанное в них значение не сохраняется. */
    readonly computed?: Set<string>;
    /** Базовый тип формы не найден, поэтому имена полей — не все. */
    partial?: boolean;
}
/** Повторяющийся элемент — список и тогда, когда в данных один пункт. */
export declare function withRepeated(value: unknown, repeated: ReadonlySet<string>, prefix?: string): unknown;
type Data = Record<string, unknown>;
/** Базы сервера из сведений о приложении: имя и каталоги каждой; запись без имени пропускается. */
export declare function serverDatabases(info: Data): {
    id: string;
    catalogs: Data[];
}[];
export declare function languageFileUrl(id: unknown, language?: string): string;
/** Читает живые метаданные через фиксированные операции чтения runtime; все кэши — в памяти. */
export declare class SchemaReader {
    private applicationInfo;
    private readForm;
    private readDocument;
    private forms;
    private shapes;
    private dictionaries;
    private common;
    private custom;
    constructor(applicationInfo: () => Promise<Data>, readForm: (url: string) => Promise<string>, readDocument: (url: string) => Promise<Data>);
    private form;
    /**
     * Типы полей для проверки после записи. Базовый тип отдаёт свои поля тому месту, которое его
     * называет: без них логическое true, отправленное серверу, не равнялось бы хранимому им 1.
     */
    documentForm(url: string): Promise<{
        roots: string[];
        fields: unknown[];
    }>;
    private shared;
    private commonData;
    /** Типы объектов, которые объявляет сервер; пустой список, если объявление не читается. */
    private declaredTypes;
    private customData;
    private language;
    private unknownType;
    /**
     * Имя, не являющееся типом объекта, отклоняется до записи. Проверке нужны списки сервера:
     * если их не прочитать, имя оставляется серверу.
     */
    requireType(type: string): Promise<void>;
    /**
     * Являются ли строки этого типа документами. Строки других каталогов (group_collaborators)
     * строит сервер, документа у них нет; если не определить, ответ — да.
     */
    private hasDocuments;
    /**
     * Каталоги основной базы. Тип объекта сервер называет только у части из них. Рядом он
     * перечисляет общие списки (common.…): это не каталоги, и они пропускаются.
     */
    private catalogs;
    /** Тип строк каталога: названный сервером или, если нет, по форме каталога. */
    private rowType;
    /**
     * Каталоги, строки которых — объекты этого типа. У некоторых типов (event) сервер оставляет
     * каталог без имени: тогда засчитывается каталог, названный по типу, если форма согласна.
     */
    private catalogsOf;
    private context;
    private title;
    private typeTranslations;
    private typeTitle;
    private samples;
    /** Поля одной строки каталога по пути, прочитанные из формы каталога. */
    private catalogFields;
    /** Структура документа одного типа с унаследованными полями; читается один раз на форму. */
    documentShape(type: string, formUrl?: string): Promise<DataShape>;
    /** Структура одной строки каталога; каталог назван или находится по типу объекта его строк. */
    catalogShape(selector: {
        catalog?: string;
        type?: string;
    }): Promise<DataShape | undefined>;
    private shape;
    /**
     * Сервер отвечает на отклонённый запрос к каталогу голым HTTP 500. После такого отказа здесь
     * называется обычная причина: каталога не существует или поля нет в каталоге.
     */
    explainQuery(catalogId: string, fields: readonly string[]): Promise<HcmError | undefined>;
    get(input: SchemaInput): Promise<SchemaResult>;
    types(input?: SchemaTypesInput): Promise<SchemaTypesResult>;
}
export {};
