import type { OperationError, OperationResult } from "./contracts.js";
import type { ServerDatabase } from "./server-info.js";
/** Поля объекта или строки каталога: имя поля — значение. */
export type HcmData = Record<string, unknown>;
/** Сведения о вызове: операция, подключение, время, признак сохранённого ответа. */
export type ResultMeta = OperationResult["meta"];
/** data ответа, который больше outputLimitBytes и сохранён локально. */
export interface StoredResultData {
    /** Начало данных. Это не все данные. */
    readonly preview: unknown;
    /** ID сохранённого результата: его читают readResult и exportResult. */
    readonly resultId: string;
    /** Какие операции читают сохранённый ответ. */
    readonly hint?: string;
}
/**
 * Ответ метода. Три вида: данные целиком; ответ сохранён локально (meta.truncated, в data
 * только начало); ошибка (ok:false). unwrap отдаёт data только в первом случае.
 */
export type HcmResult<T = unknown> = {
    /** Операция выполнена. */
    readonly ok: true;
    /** Данные ответа целиком. */
    readonly data: T;
    /** Сведения о вызове. */
    readonly meta: ResultMeta & {
        /** Ответ целиком. */
        readonly truncated?: false;
    };
    readonly error?: never;
} | {
    /** Операция выполнена, но ответ сохранён локально. */
    readonly ok: true;
    /** Начало данных и ID сохранённого результата. */
    readonly data: StoredResultData;
    /** Сведения о вызове; truncated:true и resultId. */
    readonly meta: ResultMeta & {
        /** Ответ сохранён локально. */
        readonly truncated: true;
        /** ID сохранённого результата. */
        readonly resultId: string;
    };
    readonly error?: never;
} | {
    /** Операция не выполнена. */
    readonly ok: false;
    /** Частичные данные, если операция успела их получить. */
    readonly data?: T | StoredResultData;
    /** Код, текст и подсказка ошибки. */
    readonly error: OperationError;
    /** Сведения о вызове. */
    readonly meta: ResultMeta;
};
/** Какой объект: id или url документа; type — проверить тип объекта (иначе TYPE_MISMATCH). */
export type ObjectTarget = {
    /** Адрес документа: url из ответа get. */
    readonly url: string;
    /** Ожидаемый тип объекта. */
    readonly type?: string;
    /** ID объекта, строкой: 0x… или десятичная запись. */
    readonly id?: string;
    readonly dbName?: never;
} | {
    /** ID объекта, строкой: 0x… или десятичная запись. */
    readonly id: string;
    /** Ожидаемый тип объекта. */
    readonly type?: string;
    readonly url?: never;
    /** База сервера, если объект лежит не в основной базе. */
    readonly dbName?: string;
};
/** Что прочитать у объекта. */
export interface GetOptions {
    /** Поля верхнего уровня; без fields приходит весь документ. */
    readonly fields?: readonly string[];
}
/** Аргументы create. */
export interface CreateInput<T extends object = HcmData> {
    /** Тип объекта: collaborator, group… */
    readonly type: string;
    /** Поля нового объекта; id выдаёт сервер. */
    readonly data: T;
    /** База сервера для объекта; по умолчанию основная база сервера (обычно wt_data). */
    readonly dbName?: string;
    /** Адрес формы типа; по умолчанию — та, что сервер объявляет для типа, как в schema.get. */
    readonly formUrl?: string;
}
/** Одна операция правки: set записывает value по path, remove удаляет path. */
export type PatchOperation = {
    /** Записать значение. */
    readonly op: "set";
    /** Путь в документе: name, access.access_level. */
    readonly path: string;
    /** Записываемое значение. */
    readonly value: unknown;
} | {
    /** Удалить путь. */
    readonly op: "remove";
    /** Путь в документе. */
    readonly path: string;
};
/** Что изменить в объекте: patch, remove или resave. */
export interface PatchOptions {
    /** Что записать: {path: value} или список операций. */
    readonly patch?: HcmData | readonly PatchOperation[];
    /** Пути, которые удалить из документа. */
    readonly remove?: readonly string[];
    /** fingerprint из чтения: если объект с тех пор изменился, запись отклоняется с CONFLICT. */
    readonly expectedFingerprint?: string;
    /** Только показать изменения, ничего не записывая. */
    readonly preview?: boolean;
    /** Сохранить документ, даже если правка ничего не меняет: сервер заново заполняет поля-копии из связанных объектов. */
    readonly resave?: boolean;
}
/** Аргументы delete помимо объекта. */
export interface DeleteOptions {
    /** Обязателен: удаление безвозвратное, корзины нет. */
    readonly permanent: true;
    /** Каталог объекта для проверки наличия и исчезновения; без него клиент выбирает каталог сам, если он у типа один (иначе verification:"server"). */
    readonly catalog?: string;
}
/** Значение в условии поиска. */
export type FilterValue = string | number | boolean | null;
/** Условие на поле каталога; несколько операторов соединяются через «и». */
export interface FilterCondition {
    /** Равно. */
    readonly eq?: FilterValue;
    /** Не равно. */
    readonly ne?: FilterValue;
    /** Больше. */
    readonly gt?: FilterValue;
    /** Больше или равно. */
    readonly gte?: FilterValue;
    /** Меньше. */
    readonly lt?: FilterValue;
    /** Меньше или равно. */
    readonly lte?: FilterValue;
    /** Содержит строку. */
    readonly contains?: FilterValue;
    /** Одно из значений списка, от 1 до 100. */
    readonly in?: FilterValue[];
}
/** Поля и страница поиска: общие для каталога и запроса XQuery. */
export interface QueryOptions {
    /** Поля строки, в этом порядке; без fields — все поля каталога. */
    readonly fields?: readonly string[];
    /** Строк на странице, 1–1000; по умолчанию 20. */
    readonly limit?: number;
    /** С какой строки читать: nextStartPosition прошлой страницы; до 1000000. */
    readonly startPosition?: number;
}
/**
 * Поиск в каталоге (catalog, where, order) или запрос XQuery целиком (query, нужно право execute).
 * Запрос XQuery возвращает строки каталога целиком (например return $e); отдельные значения
 * возвращает низкоуровневая операция native.lds.xQuery.
 */
export type QueryInput = QueryOptions & ({
    /** Каталог: collaborators, groups… */
    readonly catalog: string;
    /** Условия на поля каталога, через «и»: {is_dismiss: false, hire_date: {gte: "2026-01-01"}}. */
    readonly where?: Record<string, FilterValue | FilterCondition>;
    /** Поля каталога для сортировки: "fullname", "hire_date desc". */
    readonly order?: string | readonly string[];
    readonly query?: never;
} | {
    /** Запрос XQuery: for $e in collaborators where … return $e. */
    readonly query: string;
    readonly catalog?: never;
    readonly where?: never;
});
/** Аргумент функции с явным типом: дата, дробное или большое число, объект, XML. */
export interface RpcTypedArgument {
    /** Тип значения сервера: date, integer, real, string, bool… */
    readonly valueType: string;
    /** Значение в записи сервера: "2026-10-01T00:00:00", "6148914691236517121"; XML — {xml}. */
    readonly lexicalValue: string | {
        /** Текст XML. */
        readonly xml: string;
    };
}
/** Аргумент функции — XML. */
export interface RpcXmlArgument {
    /** XML значения. */
    readonly lexicalValue: {
        /** Текст XML. */
        readonly xml: string;
    };
    readonly valueType?: never;
}
/** Аргумент функции библиотеки: строка, целое, логическое значение и null — как есть. */
export type RpcArgument = string | boolean | number | null | RpcTypedArgument | RpcXmlArgument;
/** Аргументы rpc: функция библиотеки и её аргументы. */
export interface RpcInput {
    /** Библиотека: tools, ms_tools… */
    readonly library: string;
    /** Функция библиотеки. */
    readonly method: string;
    /** Аргументы по порядку параметров функции. */
    readonly arguments?: readonly RpcArgument[];
    /** Запустить фоновой задачей: в ответе TrackingID вместо значения. */
    readonly async?: boolean;
}
/**
 * Ответ синхронного вызова функции библиотеки (rpc без async:true). Если функция вернула
 * нетипизированный XML (документ или элемент формы), в ответе приходит сырой разобранный объект
 * сервера без поля value.
 */
export interface RpcValueData<T = unknown> {
    /** Значение, которое вернула функция (простое значение, массив, объект или null). */
    readonly value: T;
}
/** Ответ асинхронного вызова функции библиотеки (rpc с async:true). */
export interface RpcAsyncData {
    /** ID фоновой задачи на сервере для проверки статуса и получения результата. */
    readonly TrackingID: string;
}
/** Шаг batch: операция и её аргументы. */
export interface BatchStep {
    /** ID операции шага. */
    readonly id: string;
    /** Аргументы операции; значение из прошлого шага — {$ref:'имя.data.items.0.id'}. */
    readonly args?: HcmData;
    /** Имя шага для ссылок из следующих шагов: латинские буквы, цифры и _, первой не цифра. */
    readonly as?: string;
}
/** Аргументы batch. */
export interface BatchInput {
    /** Шаги по порядку. */
    readonly steps: readonly BatchStep[];
    /** false — продолжать после сбоя шага; по умолчанию первый сбой останавливает остальные. */
    readonly stopOnError?: boolean;
}
/** Аргументы readResult. */
export interface ResultReadInput {
    /** ID сохранённого результата: meta.resultId ответа. */
    readonly resultId: string;
    /** С какого элемента списка или символа текста читать: nextOffset прошлой страницы. */
    readonly offset?: number;
    /** Элементов на странице (по умолчанию 100, до 1000) или символов (по умолчанию 12000, до 65536). */
    readonly limit?: number;
    /**
     * auto — список по элементам, текст по символам (по умолчанию); json — любой результат
     * как текст JSON по частям; text — только сохранённый текст.
     */
    readonly format?: "auto" | "json" | "text";
}
/** Аргументы uploadFile. */
export interface UploadFileInput {
    /** Имя файла на сервере. */
    readonly filename: string;
    /** Содержимое: строка пишется в UTF-8, двоичные данные — {base64}. */
    readonly data: string | {
        /** Двоичные данные в base64. */
        readonly base64: string;
    };
    /** Тип содержимого (Content-Type); по умолчанию application/octet-stream. */
    readonly contentType?: string;
}
/** Ответ uploadFile. */
export interface UploadedFileData {
    /** Адрес файла: x-local://share/uploaded_files/<folder>/<name>. */
    readonly url: string;
    /** Папка, которую сервер создал для файла; остаётся после удаления файла. */
    readonly folderUrl: string;
}
/** Одна часть загрузки по частям. fileId у всех частей один, последнюю часть слать последней. */
export interface UploadChunkInput extends UploadFileInput {
    /** ID загрузки: 32 шестнадцатеричные цифры, выбирает вызывающий. */
    readonly fileId: string;
    /** Номер части с 0. */
    readonly index: number;
    /** Сколько частей всего. */
    readonly chunksTotal: number;
    /** Размер файла целиком в байтах. */
    readonly totalBytes: number;
    /** Смещение части в файле в байтах. */
    readonly offset: number;
}
/** Ответ сервера на часть. Url не подтверждает, что файл собран целиком: проверить чтением. */
export interface UploadedChunkData {
    /** 0 — сервер принял часть. */
    readonly error: 0;
    /** Адрес файла, который назвал сервер. */
    readonly Url: string;
}
/** Аргументы clearUploadChunks. */
export interface ClearUploadChunksInput {
    /** ID загрузки. */
    readonly fileId: string;
    /** Сколько частей удалить: номера от 0 до chunksTotal-1. */
    readonly chunksTotal: number;
}
/** Сервер принял запрос. Ошибки удаления он не сообщает, поэтому удаление не проверено. */
export interface ClearedUploadChunksData {
    /** Запрос принят. */
    readonly acknowledged: true;
    /** ID загрузки. */
    readonly fileId: string;
    /** Сколько частей запрошено удалить. */
    readonly chunksTotal: number;
    /** Всегда false: что части удалены, по ответу сервера не проверить. */
    readonly absenceVerified: false;
}
/** Ответ status. */
export interface StatusData {
    /** Имя подключения. */
    readonly connection: string;
    /** Адрес сервера. */
    readonly baseUrl: string;
    /** Версия сервера: 2025.2.1535. */
    readonly version: string;
    /** База за сервером, если сервер её описывает. */
    readonly database?: ServerDatabase;
    /** ID пользователя, под которым подключение вошло, если сервер его называет. */
    readonly userId?: string;
    /** Сколько операций у клиента. */
    readonly operationCount: number;
    /** Права подключения. */
    readonly permissions: {
        /** Право на запись. */
        readonly write: boolean;
        /** Право на выполнение кода на сервере. */
        readonly execute: boolean;
    };
}
/** Страница поиска: ответ query. */
export interface QueryData<T = HcmData> {
    /** Строки страницы; поля — в порядке fields. */
    readonly items: T[];
    /** Строки, подходящие запросу на сервере, если сервер сообщает согласованный счётчик. */
    readonly total?: number;
    /** Строки могут идти дальше: передать как startPosition. Смещения — не стабильный снимок. */
    readonly nextStartPosition?: number;
    /** Конец не установлен и смещение не растёт; hint говорит почему. */
    readonly incomplete?: true;
    /** Пояснение к странице: почему она неполная, как сузить запрос. */
    readonly hint?: string;
    /** Запрошенные поля, которых нет в каталоге. */
    readonly unknownFields?: string[];
}
/** Документ объекта: ответ get. */
export interface ObjectData<T extends object = HcmData> {
    /** ID объекта, 0x…. */
    readonly id?: string;
    /** Тип объекта. */
    readonly type: string;
    /** Адрес документа. */
    readonly url: string;
    /** Поля документа; повторяемый элемент — всегда список. */
    readonly data: T;
    /** Запрошенные поля, которые документ не хранит: сервер вычисляет их для строки каталога. */
    readonly fromCatalog?: HcmData;
    /** Поля, запрошенные по имени, для которых у объекта нет значения. */
    readonly emptyFields?: string[];
    /** Запрошенные поля, которых нет ни у типа, ни у его каталога. */
    readonly unknownFields?: string[];
    /** Отпечаток документа: expectedFingerprint для правки. */
    readonly fingerprint: string;
    /** Адрес формы типа. */
    readonly formUrl?: string;
}
/** Аргументы getMany. */
export interface GetManyInput {
    /** ID объектов, до 100. */
    readonly ids: readonly string[];
    /** Ожидаемый тип объектов. */
    readonly type?: string;
    /** База сервера, если объекты лежат не в основной базе. */
    readonly dbName?: string;
    /** Поля верхнего уровня; без fields — документы целиком. */
    readonly fields?: readonly string[];
}
/** Ответ getMany. */
export interface GetManyData<T extends object = HcmData> {
    /** Объекты в порядке ids; непрочитанный — {id, error}. */
    readonly items: (ObjectData<T> | {
        /** ID непрочитанного объекта. */
        readonly id: string;
        /** Почему объект не прочитан. */
        readonly error: {
            /** Код ошибки: PLATFORM_SOAP-FAULT, TYPE_MISMATCH… */
            readonly code: string;
            /** Что случилось. */
            readonly message: string;
        };
    })[];
    /** Сколько объектов запрошено. */
    readonly total: number;
    /** Сколько объектов не прочитано. */
    readonly failed?: number;
    /** Пояснение к непрочитанным. */
    readonly hint?: string;
}
/** Аргументы runAgent. */
export interface RunAgentInput {
    /** ID агента сервера (server_agent). */
    readonly id: string;
    /** ID объекта: в коде агента это OBJECT_ID. */
    readonly objectId?: string;
    /** ID нескольких объектов: в коде агента это OBJECTS_ID_STR, через «;». */
    readonly objectIds?: readonly string[];
}
/** Ответ batch. */
export interface BatchData {
    /** Ответы выполненных шагов по порядку. */
    readonly results: OperationResult[];
    /** Сколько шагов выполнено. */
    readonly completed: number;
    /** Сколько шагов запрошено. */
    readonly requested: number;
    /** Всегда false: это не транзакция, выполненные шаги не откатываются. */
    readonly atomic: false;
    /** Все шаги выполнены без ошибок. */
    readonly ok: boolean;
}
/** Страница сохранённого результата: элементы списка или кусок текста. */
export type ResultPage<T = unknown> = {
    /** Элементы страницы. */
    readonly items: T[];
    /** Сколько элементов в списке. */
    readonly total: number;
    /** offset следующей страницы; нет — страница последняя. */
    readonly nextOffset?: number;
    /** Элемент, который один больше предела ответа: его номер и размер. */
    readonly blockedItem?: {
        /** Номер элемента в списке. */
        readonly index: number;
        /** Размер элемента в байтах. */
        readonly bytes: number;
    };
    /** Как прочитать blockedItem. */
    readonly hint?: string;
    /** Страница короче запрошенной: в один ответ больше не входит. */
    readonly cutBySize?: true;
    /** Поле сохранённого ответа, откуда взяты элементы; для голого списка отсутствует. */
    readonly list?: string;
} | {
    /** Кусок текста. */
    readonly text: string;
    /** Сколько символов в тексте. */
    readonly totalChars: number;
    /** offset следующего куска; нет — кусок последний. */
    readonly nextOffset?: number;
    /** text — сохранённый текст, json — текст JSON сохранённого ответа. */
    readonly format?: "text" | "json";
    /** Кусок короче запрошенного: в один ответ больше не входит. */
    readonly cutBySize?: true;
};
