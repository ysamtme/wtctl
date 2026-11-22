/** Аргументы schema: тип или url и отбор полей. */
export interface SchemaInput {
    /** Тип объекта: collaborator, group…; вместо него можно url. */
    type?: string;
    /** Адрес формы вместо типа: x-local://…. */
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
    /** Строк на странице, 1–1000; по умолчанию 50. */
    limit?: number;
    /** Сколько строк пропустить: nextCursor прошлой страницы. */
    cursor?: number;
}
/** Страница типов объектов: ответ types. */
export interface SchemaTypesResult {
    /** Типы страницы, за ними — каталоги без своего типа объекта. */
    types: {
        /** Тип объекта; нет — строка каталога без своего типа объекта: документов у его строк нет. */
        type?: string;
        /** Каталог; у части типов каталога нет. */
        catalog?: string;
        /** Заголовок на языке сервера. */
        title?: string;
        /** Сколько настраиваемых полей у типа; "by kind" — они зависят от вида объекта (kind у schema). У типа без него документ с настраиваемыми полями не прочитан: об этом сказано в notes. */
        customFields?: number | "by kind";
    }[];
    /** Сколько строк подходит всего. */
    total: number;
    /** cursor следующей страницы; нет — страница последняя. */
    nextCursor?: number;
    /** Пояснения к списку. */
    notes?: string[];
}
