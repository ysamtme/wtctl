import { type SoapField, type SoapProfile } from "./protocol.js";
import { HttpTransport } from "./transport.js";
import { WsHcmBinaryResponse, type DecimalId, type ObjectId, type RequestOptions, type SoapAttachment, type SoapResult, type TrackingId, type WsHcmResponse } from "./types.js";
import { type RawXml, type XmlObject } from "./xml.js";
export type { SoapAttachment, SoapResult };
export { WebPageApi, type ClearUploadChunksRequest, type ClearUploadChunksResult, type UploadChunkRequest, type UploadChunkResult, } from "./web-pages.js";
export interface OpenSessionResult {
    sessionId: DecimalId;
    response: SoapResult;
}
export declare function openLdsSession(transport: HttpTransport, profile: SoapProfile, basic?: boolean, options?: RequestOptions): Promise<OpenSessionResult>;
declare class LdsCaller {
    private readonly transport;
    private readonly sessionId;
    constructor(transport: HttpTransport, sessionId: () => DecimalId);
    call(method: string, fields: readonly SoapField[], options?: RequestOptions): Promise<SoapResult>;
    binaryCall(method: string, fields: readonly SoapField[], options?: RequestOptions): Promise<WsHcmBinaryResponse>;
    id(): DecimalId;
    getTransport(): HttpTransport;
}
/** Вид запроса LDS XQuery. */
export interface XQueryRequest {
    query: string;
    startPos?: number;
    maxCount?: number;
    expectToReadAll?: boolean;
}
/** Общие поля запроса native `LoadUrl`/`LoadDoc`. */
export interface LoadRequest {
    url: string;
    useBinaryResponse?: boolean;
    useMultipartResponse?: boolean;
    tryLock?: boolean;
    compress?: boolean;
}
/** Запрос загрузки, выбирающий небуферизованный двоичный или multipart-ответ. */
export type StreamingLoadRequest = LoadRequest & ({
    useBinaryResponse: true;
} | {
    useMultipartResponse: true;
});
/** Запрос загрузки, сохраняющий обычный разобранный ответ SOAP. */
export type SoapLoadRequest = LoadRequest & {
    useBinaryResponse?: false;
    useMultipartResponse?: false;
};
/**
 * Операции native Administrator LDS SOAP 1.2, привязанные к одному десятичному ID сессии LDS.
 * Необязательные поля опускаются, пока не заданы; большие тела запросов идут как multipart/XOP.
 */
export declare class NativeLdsApi {
    private readonly caller;
    constructor(caller: LdsCaller);
    /** Закрыть десятичный контекст LDS. Для закрытия всего клиента лучше `NativeSession.close()`. */
    closeSession(options?: RequestOptions): Promise<SoapResult>;
    /**
     * Прочитать данные по URL; флаги ответа выбирают поток, а `tryLock` меняет состояние блокировки.
     * @mutating Если включён `tryLock`.
     */
    loadUrl(request: StreamingLoadRequest, options?: RequestOptions): Promise<WsHcmBinaryResponse>;
    loadUrl(request: SoapLoadRequest, options?: RequestOptions): Promise<SoapResult>;
    loadUrl(request: LoadRequest, options?: RequestOptions): Promise<SoapResult | WsHcmBinaryResponse>;
    /**
     * Удалить данные по URL; можно потребовать, чтобы они существовали.
     * @mutating
     */
    deleteUrl(request: {
        url: string;
        strictDelete?: boolean;
    }, options?: RequestOptions): Promise<SoapResult>;
    /**
     * Прочитать документ; `tryLock` меняет состояние блокировки.
     * На сервере 2025.1.1171 LoadDoc отвечает SOAP и при флагах двоичного или multipart-ответа.
     * Флаги включают выдачу ответа потоком байтов, в котором может оказаться конверт SOAP;
     * вида ответа они не гарантируют.
     * @mutating Если включён `tryLock`.
     */
    loadDoc(request: StreamingLoadRequest, options?: RequestOptions): Promise<WsHcmBinaryResponse>;
    loadDoc(request: SoapLoadRequest, options?: RequestOptions): Promise<SoapResult>;
    loadDoc(request: LoadRequest, options?: RequestOptions): Promise<SoapResult | WsHcmBinaryResponse>;
    /**
     * Сохранить свой XML вложением XOP.
     * Без `skipActions` или с `false` сервер выполняет обработку перед сохранением; `true` её отключает.
     * `data` — только результат `rawXml()`.
     * @mutating
     */
    putDoc(request: {
        url: string;
        writeDocInfo?: boolean;
        skipActions?: boolean;
        neverSaved?: boolean;
        data: RawXml;
    }, options?: RequestOptions): Promise<SoapResult>;
    /**
     * Удалить документ по URL; можно потребовать, чтобы он существовал.
     * @mutating
     */
    deleteDoc(request: {
        url: string;
        strictDelete?: boolean;
    }, options?: RequestOptions): Promise<SoapResult>;
    /**
     * Выделить новый ID объекта в выбранной базе, без потери точности.
     * @mutating
     */
    getNewObjectId(request: {
        dbName: string;
        objectType?: string;
    }, options?: RequestOptions): Promise<SoapResult>;
    /** Выполнить XQuery; постраничное чтение необязательно. */
    xQuery(request: XQueryRequest, options?: RequestOptions): Promise<SoapResult>;
}
/** Один аргумент RPC. Структурированный дочерний XML XmElem не использует атрибут VALUE-TYPE. */
export interface RpcArgument {
    readonly valueType?: string;
    readonly lexicalValue: string | RawXml;
}
/** Разобранный результат RPC и полное дерево XML ответа. */
export interface RpcResult {
    readonly valueType?: string;
    readonly lexicalValue?: string;
    readonly xml: XmlObject;
}
/**
 * Функции аргументов RPC. Автоматически типизируется только строка; остальные — через `typed()`.
 * Значения `RawXml` вставляются как точный дочерний XML, а не как экранированный текст.
 */
export declare const rpc: Readonly<{
    string(value: string): RpcArgument;
    typed(valueType: string, lexicalValue: string | RawXml): RpcArgument;
    /** Повторяет штатный сериализатор XmElem: проверенный дочерний XML без выдуманного VALUE-TYPE. */
    xml(value: RawXml): RpcArgument;
}>;
/**
 * Клиент SPXML `CallMethod` для существующих библиотек сервера, native или web.
 * Обзор целей — исторические данные; авторизацию и достижимость динамических целей решает сервер.
 */
export declare class RpcApi {
    private readonly transport;
    private readonly profile;
    constructor(transport: HttpTransport, profile: SoapProfile);
    /**
     * Вызвать функцию библиотеки сервера; своим списком функций клиент вызов не ограничивает.
     * @mutating
     */
    call(request: {
        target: string;
        args?: readonly RpcArgument[];
    }, options?: RequestOptions): Promise<WsHcmResponse<RpcResult>>;
}
/** Штатный web `/api/spxml`: фоновые задачи. */
export declare class WebSpXmlApi {
    private readonly transport;
    constructor(transport: HttpTransport);
    /**
     * Запустить функцию библиотеки фоновой задачей; ответ содержит TrackingID без потери точности.
     * @mutating
     */
    callMethodAsync(request: {
        target: string;
        args?: readonly RpcArgument[];
    }, options?: RequestOptions): Promise<SoapResult>;
    /**
     * Перечислить фоновые задачи по имени библиотеки и функции.
     * На сервере 2025.1.1171 пул задач общий для приложения, в нём бывают чужие задачи;
     * совпадение имени не значит, что задача своя. Устаревшие записи о завершённых задачах
     * удаляются до отбора. Недавно завершённые задачи этот список
     * не расходует: их состояние и результат входят в каждый Task.
     * Для опроса и остановки нужен TrackingID, записанный отдельно при запуске.
     */
    getBackgroundTasksByName(request: {
        libName: string;
        methodName: string;
    }, options?: RequestOptions): Promise<SoapResult>;
    /**
     * Прочитать состояние фоновой задачи по TrackingID в исходной записи: десятичной или `0x`.
     * На сервере 2025.1.1171 первый ответ о завершении расходует запись о задаче.
     * Этот ответ нужно сохранить сразу и завершённый ID больше не опрашивать:
     * если ответ HTTP потерян, результат уже израсходован. Другие сборки проверяются отдельно.
     * Идущую задачу опрашивать не чаще раза в 250 мс.
     */
    getAsyncMethodStatus(trackingId: TrackingId, options?: RequestOptions): Promise<SoapResult>;
    /**
     * Запросить остановку задачи; остановка уже завершённой задачи не гарантирована.
     * @mutating
     */
    killAsyncMethod(trackingId: TrackingId, options?: RequestOptions): Promise<SoapResult>;
}
/** Native SPXML2: сведения о приложении и получение форм. */
export declare class NativeSpXml2Api {
    private readonly transport;
    constructor(transport: HttpTransport);
    /** Прочитать сведения сервера о приложении; `application_module` необязателен и может отсутствовать. */
    getAppInfo(request?: {
        fastStart?: boolean;
        anonymous?: boolean;
        openSession?: boolean;
        rnd?: number;
    }, options?: RequestOptions): Promise<WsHcmResponse<unknown>>;
    /** Прочитать форму по локальному URL сервера как текст в кодировке ответа. */
    getForm(request: {
        url: string;
    }, options?: RequestOptions): Promise<WsHcmResponse<string>>;
}
/** Ровно один источник именованного вложения compound-attc. */
export type CompoundResourceRequest = {
    url: string;
    resId: string;
} | {
    docUrl: string;
    elemPath: string;
    resId: string;
};
/** API потокового чтения ресурсов для сессии native. */
export declare class ResourceApi {
    private readonly transport;
    constructor(transport: HttpTransport);
    /** Прочитать потоком картинку ресурса по ID (0x… или десятичный); тип картинки необязателен. */
    getImage(request: {
        resourceId: ObjectId;
        imageType?: string;
    }, options?: RequestOptions): Promise<WsHcmBinaryResponse>;
    /**
     * Прочитать потоком именованное вложение compound-attc через GET /xhttp_res.
     * Источник — url для HTML с адресом x-local или x-app либо docUrl вместе с elemPath
     * для строкового поля документа (подходит и зарегистрированный документ x-db-obj).
     * elemPath начинается с имени корневого элемента документа, например presence_state.name;
     * его берут из самого документа, а не угадывают корень и структуру.
     * Сервер декодирует данные найденного вложения и выбирает тип содержимого
     * по resId. Штатный сервер 2025.1.1171 требует ещё, чтобы источник url лежал в настроенном courses_path:
     * одной разрешённой локальной схемы для этого мало.
     * Этим маршрутом пользуется штатный клиент администратора. Тело ответа нужно дочитать или отменить.
     */
    getCompoundResource(request: CompoundResourceRequest, options?: RequestOptions): Promise<WsHcmBinaryResponse>;
}
/** Диагностика транспорта и сервера только на чтение, без создания сессии LDS. */
export declare class DiagnosticsApi {
    private readonly transport;
    constructor(transport: HttpTransport);
    /** Прочитать статус портала, не переходя по перенаправлениям и не сохраняя тело ответа. */
    portal(options?: RequestOptions): Promise<{
        status: number;
    }>;
    /** Прочитать `/xhttp_info`; авторизация Basic применяется, только если клиенту заданы учётные данные. */
    xhttpInfo(options?: RequestOptions): Promise<WsHcmResponse<string>>;
}
export declare function createNativeLdsApi(transport: HttpTransport, sessionId: () => DecimalId): NativeLdsApi;
