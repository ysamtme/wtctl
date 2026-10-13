import type { NativeLdsApi, SoapResult } from "./api.js";
import type { RequestOptions } from "./types.js";
import { type RawXml } from "./xml.js";
export interface PhysicalDocumentLocation {
    /** Каноническая запись ID, хранящаяся в документе. */
    objectId: string;
    /** Физический URL x-local, который принимают операции документов native LDS. */
    url: string;
}
export interface CreatePhysicalDocumentRequest {
    /** Целевая физическая база. По умолчанию классическая база WebTutor `wt_data`. */
    dbName?: string;
    /** Заполнить управляемые сервером метаданные `doc_info`. По умолчанию `true`. */
    writeDocInfo?: boolean;
    /** Отключить обработку действий сервера перед сохранением. По умолчанию `false` или не задано. */
    skipActions?: boolean;
    /** Установить маркер документа `NeverSaved`. По умолчанию `true`; шире смысл зависит от формы. */
    neverSaved?: boolean;
    /** Строит один полный XML-документ с точно заданным `objectId`. */
    document: (location: PhysicalDocumentLocation) => RawXml;
}
export interface CreatedPhysicalDocument extends PhysicalDocumentLocation {
    /** Буферизованный ответ LDS `PutDoc`, подтверждающий успех транспорта. */
    putResponse: SoapResult;
    /** Буферизованный ответ LDS `LoadDoc`, у которого ID корня сверен с `objectId`. */
    loadResponse: SoapResult;
}
/**
 * Применяет штатную раскладку веб-версии `XmBuildMessObjectUrl`, не превращая ID в `number`.
 *
 * ID меньше 4 000 000 000 идут по десятичной раскладке `/100`, остальные — по раскладке `14/2`
 * из 16 шестнадцатеричных цифр. Это штатная раскладка веба; воспроизведения каждого решения
 * `BindToDb` она не заявляет.
 */
export declare function resolvePhysicalDocumentLocation(idLexeme: string, dbName?: string): PhysicalDocumentLocation;
export declare function parsePhysicalDocumentId(url: string): string | undefined;
/**
 * Собирает примитивы физического сохранения native без клиентского XMD и регистрации типа объекта.
 * LDS native выполняет серверную обработку перед сохранением, если не задан `skipActions`.
 * Успешный возврат подтверждает, что документ записан и читается обратно, и ID корня,
 * но не видимость в каталоге и не полные правила XMD и бизнес-правила.
 */
export declare class NativePhysicalDocumentsApi {
    private readonly lds;
    constructor(lds: NativeLdsApi);
    /**
     * Выделяет ID, записывает XML, собранный вызывающим, и проверяет его через `LoadDoc`.
     * По умолчанию `WriteDocInfo=true`, `NeverSaved=true`, обработка сервера до сохранения включена.
     * Сбой записи или проверки запускает попытку очистки `DeleteDoc`; затем ошибка бросается снова.
     *
     * @mutating
     */
    createFromXml(request: CreatePhysicalDocumentRequest, options?: RequestOptions): Promise<CreatedPhysicalDocument>;
}
