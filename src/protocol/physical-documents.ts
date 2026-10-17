import type { NativeLdsApi, SoapResult } from "./api.js";
import { ArgumentError, attachCleanupError, WsHcmApiError } from "./error.js";
import type { RequestOptions } from "./types.js";
import { findXmlNode, isRawXml, localName, parseXml, type RawXml } from "./xml.js";

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

function lexical(value: unknown, name: string, operation: string): string {
  const source =
    value !== null && typeof value === "object" && "#text" in value
      ? (value as { "#text": unknown })["#text"]
      : value;
  if (typeof source !== "string" && typeof source !== "number" && typeof source !== "boolean") {
    throw new WsHcmApiError("protocol", `В ответе нет ${name}`, { operation });
  }
  return String(source).trim();
}

function elementEntries(value: unknown): Array<[string, unknown]> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value).filter(
    ([name]) => !name.startsWith("@_") && !name.startsWith("#") && !name.startsWith("?"),
  );
}

function directDocumentId(value: unknown): string | undefined {
  const roots = elementEntries(value);
  if (roots.length !== 1) return undefined;
  const children = elementEntries(roots[0]![1]);
  const ids = children.filter(([name]) => localName(name) === "id");
  if (ids.length !== 1 || Array.isArray(ids[0]![1])) return undefined;
  try {
    return lexical(ids[0]![1], "ID документа", "PhysicalDocuments.createFromXml");
  } catch {
    return undefined;
  }
}

/**
 * Применяет штатную раскладку веб-версии `XmBuildMessObjectUrl`, не превращая ID в `number`.
 *
 * ID меньше 4 000 000 000 идут по десятичной раскладке `/100`, остальные — по раскладке `14/2`
 * из 16 шестнадцатеричных цифр. Это штатная раскладка веба; воспроизведения каждого решения
 * `BindToDb` она не заявляет.
 */
export function resolvePhysicalDocumentLocation(
  idLexeme: string,
  dbName = "wt_data",
): PhysicalDocumentLocation {
  validateDbName(dbName);
  if (!/^(?:\d+|0x[0-9a-f]+)$/i.test(idLexeme))
    throw new ArgumentError(
      "ID объекта записан неверно: нужна строка 0x… или десятичное число без знака.",
    );
  const id = BigInt(idLexeme);
  if (id < 4_000_000_000n) {
    const base = (id / 100n).toString(10).padStart(4, "0");
    const index = (id % 100n).toString(10).padStart(2, "0");
    return { objectId: id.toString(10), url: `x-local://${dbName}/objects/${base}/${index}.xml` };
  }
  const hex = id.toString(16).toUpperCase().padStart(16, "0");
  if (hex.length !== 16) throw new ArgumentError("ID объекта не помещается в 64 бита.");
  return {
    objectId: `0x${hex}`,
    url: `x-local://${dbName}/objects/${hex.slice(0, 14)}/${hex.slice(14)}.xml`,
  };
}

export function parsePhysicalDocumentId(url: string): string | undefined {
  const match = /^x-local:\/\/[A-Za-z0-9_.-]+\/objects\/([0-9a-f]+)\/([0-9a-f]{2})\.xml$/i.exec(
    url,
  );
  if (!match) return undefined;
  const [, base, index] = match;
  if (base!.length === 14) return `0x${(base! + index!).toUpperCase()}`;
  if (!/^\d{4,8}$/.test(base!) || !/^\d{2}$/.test(index!)) return undefined;
  const id = BigInt(base!) * 100n + BigInt(index!);
  return id < 4_000_000_000n ? id.toString() : undefined;
}

function validateDbName(dbName: string): void {
  if (!/^[A-Za-z0-9_.-]+$/.test(dbName))
    throw new ArgumentError("dbName: нужно имя базы из латинских букв, цифр и знаков . _ -");
}

/** Запросы LDS, из которых складывается создание документа; ответ несёт разобранные данные. */
export interface PhysicalDocumentRequests<
  R extends { readonly data: unknown; readonly status?: number },
> {
  getNewObjectId(request: { dbName: string }, options?: RequestOptions): Promise<R>;
  putDoc(
    request: {
      url: string;
      writeDocInfo: boolean;
      skipActions?: boolean;
      neverSaved: boolean;
      data: RawXml;
    },
    options?: RequestOptions,
  ): Promise<R>;
  loadDoc(request: { url: string }, options?: RequestOptions): Promise<R>;
  deleteDoc(request: { url: string; strictDelete: boolean }): Promise<unknown>;
}

/** Создание документа по запросам `lds`: выделение ID, PutDoc, проверка LoadDoc, очистка при сбое. */
export async function createPhysicalDocument<
  R extends { readonly data: unknown; readonly status?: number },
>(
  lds: PhysicalDocumentRequests<R>,
  request: CreatePhysicalDocumentRequest,
  options?: RequestOptions,
): Promise<PhysicalDocumentLocation & { putResponse: R; loadResponse: R }> {
  const dbName = request.dbName ?? "wt_data";
  validateDbName(dbName);
  const allocated = await lds.getNewObjectId({ dbName }, options);
  const rawId = lexical(findXmlNode(allocated.data, "ObjectID"), "ObjectID", "GetNewObjectID");
  const location = resolvePhysicalDocumentLocation(rawId, dbName);
  const document = request.document(location);
  if (!isRawXml(document))
    throw new ArgumentError("document: функция должна вернуть проверенный XML (RawXml).");
  const parsed = parseXml(document.xml);
  const documentId = directDocumentId(parsed);
  if (documentId === undefined)
    throw new ArgumentError(
      "document: в XML нужен один корневой элемент и в нём ровно один элемент id.",
    );
  if (documentId.toUpperCase() !== location.objectId.toUpperCase()) {
    throw new ArgumentError("document: id в XML должен совпадать с выданным ID объекта.");
  }

  try {
    const putResponse = await lds.putDoc(
      {
        url: location.url,
        writeDocInfo: request.writeDocInfo ?? true,
        ...(request.skipActions !== undefined ? { skipActions: request.skipActions } : {}),
        neverSaved: request.neverSaved ?? true,
        data: document,
      },
      options,
    );
    const loadResponse = await lds.loadDoc({ url: location.url }, options);
    const data = elementEntries(loadResponse.data).filter(([name]) => localName(name) === "Data");
    const loadedId =
      data.length === 1 && !Array.isArray(data[0]![1]) ? directDocumentId(data[0]![1]) : undefined;
    if (loadedId?.toUpperCase() !== location.objectId.toUpperCase()) {
      throw new WsHcmApiError(
        "protocol",
        "ID загруженного документа не совпадает с выделенным objectId",
        {
          operation: "LoadDoc",
          ...(loadResponse.status === undefined ? {} : { status: loadResponse.status }),
        },
      );
    }
    return { ...location, putResponse, loadResponse };
  } catch (operationError) {
    try {
      await lds.deleteDoc({ url: location.url, strictDelete: false });
    } catch (cause) {
      const cleanupError = new WsHcmApiError("cleanup", "Не удалось удалить созданный документ", {
        operation: "DeleteDoc",
        ...(cause instanceof WsHcmApiError && cause.status !== undefined
          ? { status: cause.status }
          : {}),
        cause,
      });
      attachCleanupError(operationError, cleanupError);
    }
    throw operationError;
  }
}

/**
 * Собирает примитивы физического сохранения native без клиентского XMD и регистрации типа объекта.
 * LDS native выполняет серверную обработку перед сохранением, если не задан `skipActions`.
 * Успешный возврат подтверждает, что документ записан и читается обратно, и ID корня,
 * но не видимость в каталоге и не полные правила XMD и бизнес-правила.
 */
export class NativePhysicalDocumentsApi {
  constructor(private readonly lds: NativeLdsApi) {}

  /**
   * Выделяет ID, записывает XML, собранный вызывающим, и проверяет его через `LoadDoc`.
   * По умолчанию `WriteDocInfo=true`, `NeverSaved=true`, обработка сервера до сохранения включена.
   * Сбой записи или проверки запускает попытку очистки `DeleteDoc`; затем ошибка бросается снова.
   *
   * @mutating
   */
  createFromXml(
    request: CreatePhysicalDocumentRequest,
    options?: RequestOptions,
  ): Promise<CreatedPhysicalDocument> {
    return createPhysicalDocument<SoapResult>(this.lds, request, options);
  }
}
