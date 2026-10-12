import type { NativeLdsApi, SoapResult } from "./api.js";
import { attachCleanupError, WsHcmApiError } from "./error.js";
import type { RequestOptions } from "./types.js";
import { findXmlNode, isRawXml, localName, parseXml, type RawXml } from "./xml.js";

export interface PhysicalDocumentLocation {
  /** Canonical ID lexical form stored in the document. */
  objectId: string;
  /** Physical x-local URL accepted by native LDS document operations. */
  url: string;
}

export interface CreatePhysicalDocumentRequest {
  /** Target physical database. Defaults to the classic WebTutor database `wt_data`. */
  dbName?: string;
  /** Populate server-managed `doc_info` metadata. Defaults to `true`. */
  writeDocInfo?: boolean;
  /** Suppress server pre-save action processing. Defaults to `false`/omitted. */
  skipActions?: boolean;
  /** Set the server document-state `NeverSaved` marker. Defaults to `true`; broader semantics are form-dependent. */
  neverSaved?: boolean;
  /** Builds one complete XML document containing the exact supplied `objectId`. */
  document: (location: PhysicalDocumentLocation) => RawXml;
}

export interface CreatedPhysicalDocument extends PhysicalDocumentLocation {
  /** Buffered LDS `PutDoc` response proving transport success. */
  putResponse: SoapResult;
  /** Buffered LDS `LoadDoc` response whose direct root ID was verified against `objectId`. */
  loadResponse: SoapResult;
}

function lexical(value: unknown, name: string, operation: string): string {
  const source =
    value !== null && typeof value === "object" && "#text" in value
      ? (value as { "#text": unknown })["#text"]
      : value;
  if (typeof source !== "string" && typeof source !== "number" && typeof source !== "boolean") {
    throw new WsHcmApiError("protocol", `Missing ${name}`, { operation });
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
    return lexical(ids[0]![1], "document id", "PhysicalDocuments.createFromXml");
  } catch {
    return undefined;
  }
}

/**
 * Applies the shipped web `XmBuildMessObjectUrl` layout without converting the ID through `number`.
 *
 * IDs below 4,000,000,000 use the decimal `/100` layout. All other IDs use the fixed 16-hex `14/2` layout.
 * This helper implements the shipped web layout; it does not claim to reproduce every internal `BindToDb` decision.
 */
export function resolvePhysicalDocumentLocation(
  idLexeme: string,
  dbName = "wt_data",
): PhysicalDocumentLocation {
  validateDbName(dbName);
  if (!/^(?:\d+|0x[0-9a-f]+)$/i.test(idLexeme))
    throw new TypeError(
      "ID объекта записан неверно: нужна строка 0x… или десятичное число без знака.",
    );
  const id = BigInt(idLexeme);
  if (id < 4_000_000_000n) {
    const base = (id / 100n).toString(10).padStart(4, "0");
    const index = (id % 100n).toString(10).padStart(2, "0");
    return { objectId: id.toString(10), url: `x-local://${dbName}/objects/${base}/${index}.xml` };
  }
  const hex = id.toString(16).toUpperCase().padStart(16, "0");
  if (hex.length !== 16) throw new TypeError("ID объекта не помещается в 64 бита.");
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
    throw new TypeError("dbName: нужно имя базы из латинских букв, цифр и знаков . _ -");
}

/**
 * Composes native physical persistence primitives without executing a client XMD runtime or registering an object type.
 * Native LDS executes server pre-save processing unless `skipActions` is true.
 * A successful return verifies physical round-trip and root ID, not arbitrary catalog visibility or full XMD/business rules.
 */
export class NativePhysicalDocumentsApi {
  constructor(private readonly lds: NativeLdsApi) {}

  /**
   * Allocates an ID, writes caller-built XML, and verifies it with `LoadDoc`.
   * Defaults to `WriteDocInfo=true`, `NeverSaved=true`, and enabled server pre-save processing.
   * A failed write/verification triggers best-effort `DeleteDoc` cleanup before the original error is rethrown.
   *
   * @mutating
   */
  async createFromXml(
    request: CreatePhysicalDocumentRequest,
    options?: RequestOptions,
  ): Promise<CreatedPhysicalDocument> {
    const dbName = request.dbName ?? "wt_data";
    validateDbName(dbName);
    const allocated = await this.lds.getNewObjectId({ dbName }, options);
    const rawId = lexical(findXmlNode(allocated.data, "ObjectID"), "ObjectID", "GetNewObjectID");
    const location = resolvePhysicalDocumentLocation(rawId, dbName);
    const document = request.document(location);
    if (!isRawXml(document))
      throw new TypeError("document: функция должна вернуть проверенный XML (RawXml).");
    const parsed = parseXml(document.xml);
    const documentId = directDocumentId(parsed);
    if (documentId === undefined)
      throw new TypeError(
        "document: в XML нужен один корневой элемент и в нём ровно один элемент id.",
      );
    if (documentId.toUpperCase() !== location.objectId.toUpperCase()) {
      throw new TypeError("document: id в XML должен совпадать с выданным ID объекта.");
    }

    let putStarted = false;
    try {
      putStarted = true;
      const putResponse = await this.lds.putDoc(
        {
          url: location.url,
          writeDocInfo: request.writeDocInfo ?? true,
          ...(request.skipActions !== undefined ? { skipActions: request.skipActions } : {}),
          neverSaved: request.neverSaved ?? true,
          data: document,
        },
        options,
      );
      const loadResponse = await this.lds.loadDoc({ url: location.url }, options);
      const data = elementEntries(loadResponse.data).filter(([name]) => localName(name) === "Data");
      const loadedId =
        data.length === 1 && !Array.isArray(data[0]![1])
          ? directDocumentId(data[0]![1])
          : undefined;
      if (loadedId?.toUpperCase() !== location.objectId.toUpperCase()) {
        throw new WsHcmApiError(
          "protocol",
          "Loaded document id does not match allocated objectId",
          {
            operation: "LoadDoc",
            status: loadResponse.status,
          },
        );
      }
      return { ...location, putResponse, loadResponse };
    } catch (operationError) {
      if (putStarted) {
        try {
          await this.lds.deleteDoc({ url: location.url, strictDelete: false });
        } catch (cause) {
          const cleanupError = new WsHcmApiError("cleanup", "Physical document cleanup failed", {
            operation: "DeleteDoc",
            ...(cause instanceof WsHcmApiError && cause.status !== undefined
              ? { status: cause.status }
              : {}),
            cause,
          });
          attachCleanupError(operationError, cleanupError);
        }
      }
      throw operationError;
    }
  }
}
