import { HttpTransport } from "./transport.js";
import type { RequestOptions, SoapAttachment, WsHcmResponse } from "./types.js";
import { type XmlObject } from "./xml.js";
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
    constructor(transport: HttpTransport, uploadToken?: (() => string | undefined) | undefined);
    /** Прочитать форму по локальному URL сервера через службу веб-админки. */
    getForm(request: {
        url: string;
    }, options?: RequestOptions): Promise<WsHcmResponse<string>>;
    /** Прочитать экранную форму по локальному URL сервера как текст. */
    getScreenForm(request: {
        url: string;
    }, options?: RequestOptions): Promise<WsHcmResponse<string>>;
    /** Прочитать и разобрать XML текстов веб-интерфейса в кодировке, объявленной приложением. */
    getUiText(options?: RequestOptions): Promise<WsHcmResponse<XmlObject>>;
    /**
     * Загрузить один файл штатным способом: multipart с полями f и session_token.
     * Текущий токен страницы подставляет сессия web, которой принадлежит вызов. Размер ограничивает
     * политика загрузки сервера; части и старый вариант с base64 не используются. Успешный ответ
     * содержит Url.
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
