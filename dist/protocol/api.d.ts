import { type SoapField, type SoapProfile } from "./protocol.js";
import { HttpTransport } from "./transport.js";
import { WsHcmBinaryResponse, type DecimalId, type RequestOptions, type TrackingId, type WsHcmResponse } from "./types.js";
import { type RawXml, type XmlObject } from "./xml.js";
/** Буферизованный разобранный результат SOAP с точными байтами ответа. */
export type SoapResult = WsHcmResponse<XmlObject>;
/** Карта параметров запроса; заданные значения сериализуются в том виде, как записаны. */
export type QueryValues = Readonly<Record<string, string | number | boolean | null | undefined>>;
/** Точные данные внешней части MIME; строки и RawXml кодируются как UTF-8. */
export type SoapAttachment = RawXml | string | Uint8Array | ArrayBuffer;
/** Вызов штатной библиотеки LDS. ArgData — типизированный дочерний XML в теле, не вложение XOP. */
export interface RunMethodRequest {
    libName: string;
    methodName: string;
    /** Отдельный внутренний поток; наружу не отдаётся ни ID задачи, ни подтверждение завершения. */
    runAsync?: boolean;
    errorLogName?: string;
    argData: RawXml;
}
export interface OpenSessionResult {
    sessionId: DecimalId;
    response: SoapResult;
}
export declare function openLdsSession(transport: HttpTransport, profile: SoapProfile, basic?: boolean): Promise<OpenSessionResult>;
declare class LdsCaller {
    private readonly transport;
    private readonly profile;
    private readonly sessionId;
    constructor(transport: HttpTransport, profile: SoapProfile, sessionId: () => DecimalId);
    call(method: string, fields: readonly SoapField[], options?: RequestOptions): Promise<SoapResult>;
    binaryCall(method: string, fields: readonly SoapField[], options?: RequestOptions): Promise<WsHcmBinaryResponse>;
    id(): DecimalId;
    getTransport(): HttpTransport;
}
/** Вид запроса LDS XQuery. ID курсоров остаются десятичными строками без потерь. */
export interface XQueryRequest {
    query: string;
    startPos?: number;
    maxCount?: number;
    expectToReadAll?: boolean;
    keepCursor?: boolean;
    cursorId?: DecimalId;
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
     * Прочитать готовые записи из кэша статистики каталогов текущей сессии.
     * Пустой ответ Catalogs допустим: неготовые и пропускаемые каталоги в него не попадают.
     * RecordsNum — число из кэша, а не свежий SQL COUNT и не перечень типов объектов.
     */
    getCatalogsStat(options?: RequestOptions): Promise<SoapResult>;
    /** Прочитать объекты, изменённые после `minModDate`; дата необязательна. */
    getModObjects(request?: {
        minModDate?: string;
        compress?: boolean;
    }, options?: RequestOptions): Promise<SoapResult>;
    /**
     * Прочитать данные по URL; флаги ответа выбирают поток, а `tryLock` меняет состояние блокировки.
     * @mutating Если включён `tryLock`.
     */
    loadUrl(request: StreamingLoadRequest, options?: RequestOptions): Promise<WsHcmBinaryResponse>;
    loadUrl(request: SoapLoadRequest, options?: RequestOptions): Promise<SoapResult>;
    loadUrl(request: LoadRequest, options?: RequestOptions): Promise<SoapResult | WsHcmBinaryResponse>;
    /**
     * Записать по URL текст или двоичные данные как есть, вложением XOP.
     * @mutating
     */
    putUrl(request: {
        url: string;
        data: SoapAttachment;
    }, options?: RequestOptions): Promise<SoapResult>;
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
    /** Выполнить XQuery; постраничное чтение и курсор необязательны. */
    xQuery(request: XQueryRequest, options?: RequestOptions): Promise<SoapResult>;
    /**
     * Освободить курсор, выданный ранее этой сессии LDS.
     * @mutating Меняет временное состояние курсора.
     */
    releaseCursor(cursorId: DecimalId, options?: RequestOptions): Promise<SoapResult>;
    /**
     * Выполнить функцию библиотеки сервера; аргументы — дочерние элементы XML в `ArgData`.
     * На сервере 2025.1.1171 аргументы принимаются только как XML в теле SOAP:
     * внешнее вложение XOP отклоняется с Parameter is not XML.
     * RunAsync выполняет функцию в отдельном внутреннем потоке и не возвращает ID задачи;
     * первый ResultData может прийти с типом undefined и не означает завершения.
     * GetAsyncMethodStatus и KillAsyncMethod такое выполнение не отслеживают.
     * @mutating
     */
    runMethod(request: RunMethodRequest, options?: RequestOptions): Promise<SoapResult>;
    /** Продлить текущую сессию native LDS. */
    idle(options?: RequestOptions): Promise<SoapResult>;
}
/** Контекст Web Administrator LDS SOAP 1.1 и общие штатные методы службы для одного ID LDS. */
export declare class WebLdsApi {
    private readonly caller;
    constructor(caller: LdsCaller);
    /**
     * Выполнить XQuery через web LDS. `keepCursor` по умолчанию `true`; для разового чтения нужен `false`.
     * @mutating Если курсор сохраняется (по умолчанию).
     */
    xQuery(request: XQueryRequest, options?: RequestOptions): Promise<SoapResult>;
    /**
     * Освободить свой курсор web LDS.
     * @mutating Меняет временное состояние курсора.
     */
    releaseCursor(cursorId: DecimalId, options?: RequestOptions): Promise<SoapResult>;
    /**
     * Выполнить штатный RunMethod LDS в этой веб-сессии по SOAP 1.1.
     * ArgData содержит дочерние элементы XML с типами; SessionID идёт перед ними.
     * RunAsync выполняет функцию в отдельном внутреннем потоке и не возвращает ID задачи;
     * первый ResultData может прийти с типом undefined и не означает завершения.
     * GetAsyncMethodStatus и KillAsyncMethod такое выполнение не отслеживают.
     * Права сервера на вызываемую функцию действуют и здесь, независимо от профиля web.
     * @mutating
     */
    runMethod(request: RunMethodRequest, options?: RequestOptions): Promise<SoapResult>;
    /**
     * Удалить документ; `StrictDelete=1` отправляется, только когда он включён.
     * @mutating
     */
    deleteDoc(request: {
        url: string;
        strictDelete?: boolean;
    }, options?: RequestOptions): Promise<SoapResult>;
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
/** Штатный web `/api/spxml`: RPC, документы и фоновые задачи. */
export declare class WebSpXmlApi {
    private readonly transport;
    readonly rpc: RpcApi;
    constructor(transport: HttpTransport);
    /**
     * Вызвать функцию библиотеки синхронно. Вызванная функция может менять данные.
     * @mutating
     */
    callMethod(request: {
        target: string;
        args?: readonly RpcArgument[];
    }, options?: RequestOptions): Promise<WsHcmResponse<RpcResult>>;
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
    /**
     * Прочитать XML документа в UTF-8, если не задан `charset`; кодировка из заголовков ответа важнее.
     * Сервер 2025.1.1171 не принимает параметр TryLock на этом маршруте:
     * значение в строке запроса отклоняется.
     * Проверенный способ заблокировать документ — LoadDoc через native LDS.
     * @mutating Если включён `tryLock`.
     */
    getDoc(request: {
        docUrl: string;
        charset?: string;
        tryLock?: boolean;
    }, options?: RequestOptions): Promise<WsHcmResponse<XmlObject>>;
    /**
     * Сохранить свой XML через web SPXML; сервер выполняет обработку перед сохранением.
     * `neverSaved=true` отправляет `NeverSaved=1`; при false или без значения флаг не отправляется. Управления `SkipActions` на этом маршруте нет.
     * @mutating
     */
    putDoc(request: {
        docUrl: string;
        document: string | RawXml;
        writeDocInfo?: boolean;
        neverSaved?: boolean;
    }, options?: RequestOptions): Promise<WsHcmResponse<unknown>>;
}
declare class SpXml2Base {
    protected readonly transport: HttpTransport;
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
/** Native SPXML2: сведения о приложении и получение форм. */
export declare class NativeSpXml2Api extends SpXml2Base {
}
/** Web SPXML2; сведения о приложении по умолчанию идут с `fast_start=1` и случайным `rnd`. */
export declare class WebSpXml2Api extends SpXml2Base {
    /** Прочитать сведения сервера о приложении; по умолчанию отправляет `fast_start=1` и случайный `rnd`. */
    getAppInfo(request?: {
        fastStart?: boolean;
        anonymous?: boolean;
        openSession?: boolean;
        rnd?: number;
    }, options?: RequestOptions): Promise<WsHcmResponse<unknown>>;
    /** Прочитать потоком картинку web SPXML2; параметры эффектов необязательны. */
    getImage(request: {
        url: string;
        effects?: QueryValues;
    }, options?: RequestOptions): Promise<WsHcmBinaryResponse>;
    /** Прочитать набор предзагружаемых файлов оформления default. */
    getPreloadedDesignFiles(options?: RequestOptions): Promise<WsHcmResponse<string>>;
    /** Вызвать штатную службу сервера `std_encrypt`; это не средство шифрования общего назначения на стороне клиента. */
    stdEncrypt(text: string, options?: RequestOptions): Promise<WsHcmResponse<unknown>>;
}
/** Часть штатной загрузки по выбору вызывающего; offset и totalBytes — в декодированных байтах. */
export interface UploadChunkRequest {
    fileId: string;
    filename: string;
    index: number;
    chunksTotal: number;
    totalBytes: number;
    offset: number;
    data: SoapAttachment;
    contentType?: string;
}
/** Url новый на каждый запрос; это не доказательство завершения и не наличия файла. */
export interface UploadChunkResult {
    error: 0;
    Url: string;
}
/** Точные индексы [0, chunksTotal) в выбранном вызывающим общем пространстве filechunk. */
export interface ClearUploadChunksRequest {
    fileId: string;
    chunksTotal: number;
}
/** Ошибки удаления на сервере проглатываются; пустой ответ доказывает только приём запроса. */
export interface ClearUploadChunksResult {
    acknowledged: true;
    fileId: string;
    chunksTotal: number;
    absenceVerified: false;
}
/** Штатные операции страничных служб web Administrator. */
export declare class WebPageApi {
    private readonly transport;
    private readonly uploadToken?;
    private readonly maximumUploadBytes;
    constructor(transport: HttpTransport, uploadToken?: (() => string | undefined) | undefined, maximumUploadBytes?: number);
    /** Прочитать штатную страницу предпросмотра PDF как текст. */
    filePreviewPdf(options?: RequestOptions): Promise<WsHcmResponse<string>>;
    /** Прочитать форму по локальному URL сервера как текст. */
    getForm(request: {
        url: string;
    }, options?: RequestOptions): Promise<WsHcmResponse<string>>;
    /** Прочитать экранную форму по локальному URL сервера как текст. */
    getScreenForm(request: {
        url: string;
    }, options?: RequestOptions): Promise<WsHcmResponse<string>>;
    /**
     * Прочитать потоком SVG через штатную страницу картинок веб-интерфейса. Сервер принимает
     * URL SVG в x-app и x-local и проверяет право чтения источника. Необязательные значения state
     * hover, pressed и disabled включают штатную подмену цветов; при других значениях
     * содержимое остаётся исходным. Без значения отправляется state="": штатная
     * страница требует это поле запроса. Тело ответа нужно дочитать или отменить.
     */
    getImage(request: {
        url: string;
        state?: string;
    }, options?: RequestOptions): Promise<WsHcmBinaryResponse>;
    /** Прочитать и разобрать XML текстов веб-интерфейса в кодировке, объявленной приложением. */
    getUiText(options?: RequestOptions): Promise<WsHcmResponse<XmlObject>>;
    /** Прочитать потоком ответ службы страниц по URL; тело нужно дочитать или отменить. */
    getUrl(request: {
        url: string;
        navigate?: boolean;
        download?: boolean;
        base64?: boolean;
    }, options?: RequestOptions): Promise<WsHcmBinaryResponse>;
    /**
     * Загрузить один файл штатным способом: multipart с полями f и session_token.
     * Текущий токен страницы подставляет веб-сессия, которой принадлежит вызов. Размер
     * ограничен maxResponseBytes и пределом клиента 8 МиБ; части и старый вариант
     * с base64 не используются. Успешный ответ содержит Url.
     * @mutating Сохраняет файл на сервере; срабатывают правила загрузки платформы.
     */
    uploadFile(request: {
        filename: string;
        data: SoapAttachment;
        contentType?: string;
    }, options?: RequestOptions): Promise<WsHcmResponse<unknown>>;
    /**
     * Отправить один штатный POST upload_chunk с байтами данных как есть и явным Content-Range.
     * Вызывающий задаёт известный fileId из 32 шестнадцатеричных цифр и следит за порядком частей; последняя часть собирает файл.
     * Ответы сами по себе не доказывают, что часть сохранена и что байты итогового файла верны.
     * Перед последней частью загруженное нужно проверить чтением, подходящим для хранилища.
     * После ошибки на последней части URL результата может остаться неизвестным: не повторять и не угадывать, что удалять.
     * Нужна установленная ветка WebSoft/libMain и её действующие правила для пользователя и загрузки.
     * @mutating Пишет в общее хранилище частей и может создать собранный файл.
     */
    uploadChunk(request: UploadChunkRequest, options?: RequestOptions): Promise<WsHcmResponse<UploadChunkResult>>;
    /**
     * Запросить удаление частей [0, chunksTotal) для известного fileId из 32 шестнадцатеричных цифр, выбранного вызывающим.
     * Пространство ID общее: сервер не проверяет, кто создал этот ID.
     * Пустой ответ не доказывает, что части, папка, итоговый файл и временные данные удалены.
     * @mutating Запрашивает удаление частей; отдельные ошибки сервера не сообщаются.
     */
    clearUploadChunks(request: ClearUploadChunksRequest, options?: RequestOptions): Promise<WsHcmResponse<ClearUploadChunksResult>>;
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
/** API потокового чтения ресурсов, общий для сессий native и web. */
export declare class ResourceApi {
    private readonly transport;
    constructor(transport: HttpTransport);
    /** Прочитать потоком картинку ресурса по десятичному ID; тип картинки необязателен. */
    getImage(request: {
        resourceId: DecimalId;
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
     * Этим маршрутом пользуется штатный клиент администратора; варианты native и web —
     * один маршрут сервера, различается только сессия HTTP. Тело ответа нужно дочитать или отменить.
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
/**
 * Запасной путь для неизвестных и экспериментальных запросов протокола. Лучше типизированные API.
 */
export declare class ExperimentalApi {
    protected readonly transport: HttpTransport;
    constructor(transport: HttpTransport);
    /**
     * Отправить свой запрос на тот же origin и вернуть тело ответа потоком.
     * `unsafe: true` обязателен. Сериализация обычных операций, разбор ошибок сервера и гарантии об исходе записи не действуют;
     * настроенные авторизация и cookie применяются, а метод, заголовки, тело и закрытие потока — на вызывающем.
     */
    rawRequest(request: {
        unsafe: true;
        path: string;
        method?: string;
        headers?: HeadersInit;
        body?: BodyInit;
    }, options?: RequestOptions): Promise<WsHcmBinaryResponse>;
}
/** Частичные операции web, подкреплённые схемой, и запасной путь — сырой запрос. */
export declare class WebExperimentalApi extends ExperimentalApi {
    /**
     * Вызвать частично поддержанный маршрут веб-аутентификации; cookie и тело успешного ответа до конца не установлены.
     * @mutating Меняет состояние аутентификации и сессии.
     */
    authenticate(request: {
        login: string;
        password: string;
        token: string;
    }, options?: RequestOptions): Promise<WsHcmResponse<unknown>>;
}
/** Частичные операции native, подкреплённые схемой, и запасной путь — сырой запрос. */
export declare class NativeExperimentalApi extends ExperimentalApi {
}
export declare function createNativeLdsApi(transport: HttpTransport, sessionId: () => DecimalId): NativeLdsApi;
export declare function createWebLdsApi(transport: HttpTransport, sessionId: () => DecimalId): WebLdsApi;
export {};
