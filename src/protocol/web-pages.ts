import { WsHcmApiError } from "./error.js";
import { HttpTransport, query } from "./transport.js";
import type { RequestOptions, SoapAttachment, WsHcmResponse } from "./types.js";
import { jsonResponse, responseCharset, textResponse, xmlResponse } from "./wire.js";
import { isRawXml, type XmlObject } from "./xml.js";

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

function invalidUploadInput(operation: string, message: string): WsHcmApiError {
  return new WsHcmApiError("protocol", message, { operation, requestSent: false });
}

function validateUploadFilename(filename: string, operation: string): string {
  if (
    typeof filename !== "string" ||
    !filename ||
    Array.from(filename).length > 255 ||
    /[\\/\x00-\x1F\x7F]/.test(filename) ||
    filename.startsWith("..") ||
    filename.endsWith("..") ||
    filename === "."
  )
    throw invalidUploadInput(operation, "filename: нужно имя файла без пути, до 255 знаков.");
  return filename;
}

function validateContentType(contentType: string | undefined, operation: string): string {
  if (
    contentType !== undefined &&
    (typeof contentType !== "string" || !/^[\x20-\x7E]{1,256}$/.test(contentType))
  )
    throw invalidUploadInput(
      operation,
      "contentType: нужен тип MIME из печатных знаков ASCII, до 256 знаков.",
    );
  return contentType ?? "application/octet-stream";
}

function validateFileId(fileId: string, operation: string): string {
  if (typeof fileId !== "string" || !/^[0-9a-f]{32}$/i.test(fileId))
    throw invalidUploadInput(operation, "fileId: нужно 32 шестнадцатеричные цифры.");
  return fileId;
}

function validateChunksTotal(chunksTotal: number, operation: string): number {
  if (!Number.isSafeInteger(chunksTotal) || chunksTotal < 1 || chunksTotal > 100000)
    throw invalidUploadInput(operation, "chunksTotal: нужно целое число от 1 до 100000.");
  return chunksTotal;
}

function attachmentBytes(data: SoapAttachment, operation: string): Uint8Array {
  const value = isRawXml(data) ? data.xml : data;
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (value instanceof Uint8Array) return value;
  throw invalidUploadInput(operation, "data: нужен текст или двоичные данные.");
}

function hasUploadedPath(body: Record<string, unknown>, filename: string): boolean {
  if (!("Url" in body) || typeof body.Url !== "string") return false;
  const parts = body.Url.split("/");
  return parts.length === 2 && /^[A-Za-z0-9_-]{1,256}$/.test(parts[0]!) && parts[1] === filename;
}

/** Штатные операции страничных служб web Administrator. */
export class WebPageApi {
  constructor(
    private readonly transport: HttpTransport,
    private readonly uploadToken?: () => string | undefined,
  ) {}
  /** Прочитать экранную форму по локальному URL сервера как текст. */
  async getScreenForm(
    request: { url: string },
    options?: RequestOptions,
  ): Promise<WsHcmResponse<string>> {
    return textResponse(
      await this.transport.send(
        query("/spxml_web/service/get_screen_form.htm", request),
        {},
        options,
      ),
    );
  }
  /** Прочитать и разобрать XML текстов веб-интерфейса в кодировке, объявленной приложением. */
  async getUiText(options?: RequestOptions): Promise<WsHcmResponse<XmlObject>> {
    return xmlResponse(
      await this.transport.send("/spxml_web/service/get_ui_text.htm", {}, options),
    );
  }

  /**
   * Загрузить один файл штатным способом: multipart с полями f и session_token.
   * Текущий токен страницы подставляет сессия web, которой принадлежит вызов. Размер ограничивает
   * политика загрузки сервера; части и старый вариант с base64 не используются. Успешный ответ
   * содержит Url.
   * @mutating Сохраняет файл на сервере; срабатывают правила загрузки платформы.
   */
  async uploadFile(
    request: { filename: string; data: SoapAttachment; contentType?: string },
    options?: RequestOptions,
  ): Promise<WsHcmResponse<unknown>> {
    const filename = validateUploadFilename(request.filename, "uploadFile");
    const contentType = validateContentType(request.contentType, "uploadFile");
    const token = this.uploadToken?.();
    if (!token || !/^[\x21-\x7E]{1,256}$/.test(token))
      throw invalidUploadInput(
        "uploadFile",
        "В сессии web нет действующего токена страницы для загрузки файла.",
      );
    const bytes = attachmentBytes(request.data, "uploadFile");
    const form = new FormData();
    form.append("f", new Blob([bytes.slice().buffer], { type: contentType }), filename);
    form.append("session_token", token);
    const response = await this.transport.send(
      "/spxml_web/service/upload_file.htm?json_response=1",
      { method: "POST", body: form },
      options,
    );
    // HTTP 415 сервер ставит только отказу своей политики загрузки и имени вне своей таблицы
    // типов. Текст отказа он пишет лишь в свой лог: в строке статуса стандартная фраза, тела нет.
    if (response.status === 415) {
      await response.body?.cancel().catch(() => undefined);
      throw new WsHcmApiError("http", "HTTP 415", {
        operation: "uploadFile",
        status: 415,
        details: { uploadRefused: true },
      });
    }
    const result = await jsonResponse(response);
    const body = result.data;
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      !hasUploadedPath(body as Record<string, unknown>, filename) ||
      ("error" in body && body.error !== 0 && body.error !== false)
    )
      throw new WsHcmApiError("protocol", "Ответ на загрузку не подтвердил URL ресурса", {
        operation: "uploadFile",
        status: result.status,
      });
    return result;
  }

  /**
   * Отправить один штатный POST upload_chunk с байтами данных как есть и явным Content-Range.
   * Вызывающий задаёт известный fileId из 32 шестнадцатеричных цифр и следит за порядком частей; последняя часть собирает файл.
   * Ответы сами по себе не доказывают, что часть сохранена и что байты итогового файла верны.
   * Перед последней частью загруженное нужно проверить чтением, подходящим для хранилища.
   * После ошибки на последней части URL результата может остаться неизвестным: не повторять и не угадывать, что удалять.
   * Нужна установленная ветка WebSoft/libMain и её действующие правила для пользователя и загрузки.
   * @mutating Пишет в общее хранилище частей и может создать собранный файл.
   */
  async uploadChunk(
    request: UploadChunkRequest,
    options?: RequestOptions,
  ): Promise<WsHcmResponse<UploadChunkResult>> {
    const fileId = validateFileId(request.fileId, "uploadChunk");
    const filename = validateUploadFilename(request.filename, "uploadChunk");
    const contentType = validateContentType(request.contentType, "uploadChunk");
    const chunksTotal = validateChunksTotal(request.chunksTotal, "uploadChunk");
    if (!Number.isSafeInteger(request.index) || request.index < 0 || request.index >= chunksTotal)
      throw invalidUploadInput("uploadChunk", "index: нужен номер части от 0 до chunksTotal - 1.");
    if (!Number.isSafeInteger(request.totalBytes) || request.totalBytes < 1)
      throw invalidUploadInput("uploadChunk", "totalBytes: нужно целое число больше нуля.");
    if (!Number.isSafeInteger(request.offset) || request.offset < 0)
      throw invalidUploadInput("uploadChunk", "offset: нужно целое неотрицательное число.");
    if (
      request.totalBytes < chunksTotal ||
      request.offset < request.index ||
      (request.index === 0 && request.offset !== 0)
    )
      throw invalidUploadInput(
        "uploadChunk",
        "offset и totalBytes не сходятся с номером части: каждой предыдущей части нужен хотя бы один байт, а первая начинается с нуля.",
      );
    const bytes = attachmentBytes(request.data, "uploadChunk");
    if (bytes.byteLength < 1)
      throw invalidUploadInput("uploadChunk", "data: часть должна быть непустой.");
    if (
      request.offset > request.totalBytes ||
      bytes.byteLength > request.totalBytes - request.offset
    )
      throw invalidUploadInput("uploadChunk", "Часть выходит за totalBytes.");
    const endExclusive = request.offset + bytes.byteLength;
    const remainingChunks = chunksTotal - request.index - 1;
    if (
      request.totalBytes - endExclusive < remainingChunks ||
      (remainingChunks === 0 && endExclusive !== request.totalBytes)
    )
      throw invalidUploadInput(
        "uploadChunk",
        "После части должно остаться место для следующих, а последняя должна кончаться на totalBytes.",
      );
    const form = new FormData();
    form.append("action", "upload_chunk");
    form.append("file_id", fileId);
    form.append("file_name", filename);
    form.append("chunk", String(request.index));
    form.append("chunks_total", String(chunksTotal));
    form.append("file_size", String(request.totalBytes));
    form.append("file_type", contentType);
    form.append(
      "file_data",
      `data:application/octet-stream;base64,${Buffer.from(bytes).toString("base64")}`,
    );
    const response = await this.transport.send(
      query("/spxml_web/service/upload_file.htm", {
        json_response: 1,
        action: "upload_chunk",
        file_id: fileId,
        file_name: filename,
      }),
      {
        method: "POST",
        headers: {
          "Content-Range": `bytes ${request.offset}-${endExclusive - 1}/${request.totalBytes}`,
        },
        body: form,
      },
      options,
    );
    // Отказ политики загрузки и имя вне таблицы типов сервер отдаёт HTTP 500 с текстом
    // в error_text. Сбой самого сервера — 500 + код: 501 нет имени, 502 часть не записана,
    // 503 файл не собран из частей; error_text у них есть всегда, хотя бы пустой.
    const status = response.status;
    if (status >= 500 && status <= 503) {
      let reason: unknown;
      try {
        const source = new TextDecoder(responseCharset(response, "utf-8")).decode(
          await response.arrayBuffer(),
        );
        reason = (JSON.parse(source) as { error_text?: unknown } | null)?.error_text;
      } catch {
        // Тело не JSON, не дочитано или в неизвестной кодировке: остаётся отказ HTTP без текста.
      }
      const text = typeof reason === "string" ? reason.trim() : undefined;
      const details =
        text === undefined
          ? undefined
          : status > 500
            ? { chunkFailed: true }
            : text && { uploadRefused: true, reason: text.slice(0, 500) };
      throw new WsHcmApiError("http", `HTTP ${status}`, {
        operation: "uploadChunk",
        status,
        ...(details ? { details } : {}),
      });
    }
    const result = await jsonResponse(response);
    const body = result.data;
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      !("error" in body) ||
      body.error !== 0 ||
      !hasUploadedPath(body as Record<string, unknown>, filename)
    )
      throw new WsHcmApiError(
        "protocol",
        "Ответ на загрузку части не подтвердил запрошенное имя файла",
        {
          operation: "uploadChunk",
          status: result.status,
        },
      );
    return result as WsHcmResponse<UploadChunkResult>;
  }

  /**
   * Запросить удаление частей [0, chunksTotal) для известного fileId из 32 шестнадцатеричных цифр, выбранного вызывающим.
   * Пространство ID общее: сервер не проверяет, кто создал этот ID.
   * Пустой ответ не доказывает, что части, папка, итоговый файл и временные данные удалены.
   * @mutating Запрашивает удаление частей; отдельные ошибки сервера не сообщаются.
   */
  async clearUploadChunks(
    request: ClearUploadChunksRequest,
    options?: RequestOptions,
  ): Promise<WsHcmResponse<ClearUploadChunksResult>> {
    const fileId = validateFileId(request.fileId, "clearUploadChunks");
    const chunksTotal = validateChunksTotal(request.chunksTotal, "clearUploadChunks");
    const form = new FormData();
    form.append("action", "clear_chunks");
    form.append("file_id", fileId);
    form.append("chunks_total", String(chunksTotal));
    const result = await textResponse(
      await this.transport.send(
        query("/spxml_web/service/upload_file.htm", {
          json_response: 1,
          action: "clear_chunks",
          file_id: fileId,
        }),
        { method: "POST", body: form },
        options,
      ),
    );
    if (!result.rawBody.every((byte) => byte === 9 || byte === 10 || byte === 13 || byte === 32))
      throw new WsHcmApiError("protocol", "Ответ clear_chunks — не пустое подтверждение", {
        operation: "clearUploadChunks",
        status: result.status,
      });
    return {
      ...result,
      data: {
        acknowledged: true,
        fileId,
        chunksTotal,
        absenceVerified: false,
      },
    };
  }
}
