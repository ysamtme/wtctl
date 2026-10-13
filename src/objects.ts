import { randomUUID } from "node:crypto";
import { mkdir, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { patchSegments, XmlDocument } from "./documents.js";
import { HcmError, inputObject, requiredString, scalar } from "./errors.js";
import type { HcmServer } from "./hcm-server.js";
import type { WriteOutcome } from "./write-outcome.js";
import { findXmlNode, buildXml, type XmlObject } from "./protocol/xml.js";
import {
  parsePhysicalDocumentId,
  resolvePhysicalDocumentLocation,
} from "./protocol/physical-documents.js";
import {
  cleanXmlValue,
  hasStructure,
  identifier,
  projectFields,
  queryPage,
  withoutFalseOffset,
} from "./query.js";
import { withRepeated, type SchemaReader } from "./schema.js";
import { isServerDate, verifyFields, verifyRemovals } from "./verification.js";
import type { BinaryResult } from "./contracts.js";

function isBinary(value: unknown): value is BinaryResult {
  return (
    !!value &&
    typeof value === "object" &&
    "kind" in value &&
    value.kind === "binary" &&
    "bytes" in value &&
    value.bytes instanceof Uint8Array
  );
}
/** A typing slip: one letter changed, added, dropped or swapped with its neighbour. */
function oneEditApart(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) (endA--, endB--);
  const restA = a.slice(start, endA);
  const restB = b.slice(start, endB);
  return (
    Math.max(restA.length, restB.length) <= 1 ||
    (restA.length === 2 && restB.length === 2 && restA === restB[1]! + restB[0]!)
  );
}
/** What to write and the paths to remove, as the one list of operations a document takes. */
function patchInput(patch: unknown, remove: unknown, resave = false): unknown {
  if (remove === undefined) {
    if (patch === undefined) {
      if (resave) return [];
      throw new HcmError("INVALID_ARGUMENT", "Нужно указать patch, remove или оба.");
    }
    return patch;
  }
  if (!Array.isArray(remove) || remove.some((path) => typeof path !== "string"))
    throw new HcmError("INVALID_ARGUMENT", "remove: нужен список путей.");
  const set = Array.isArray(patch)
    ? patch
    : Object.entries(inputObject(patch ?? {}, "patch")).map(([path, value]) => ({
        op: "set",
        path,
        value,
      }));
  return [...set, ...remove.map((path: string) => ({ op: "remove", path }))];
}

/** Objects of the server: reading, creating, patching and deleting one document, with the write journal. */
export class ServerObjects {
  constructor(
    private readonly server: Pick<HcmServer, "call" | "read" | "applicationInfo">,
    private readonly schema: Pick<
      SchemaReader,
      "documentShape" | "catalogShape" | "requireType" | "documentForm"
    >,
    /** The folder of the write journal, mutations.jsonl. */
    private readonly journalDirectory: string,
  ) {}

  /** One object by id or url, as objects.get answers. */
  async get(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const loaded = await this.load(args);
    const snapshot = loaded.document.snapshot();
    const data = withoutFalseOffset(projectFields(snapshot.data, args.fields)) as Record<
      string,
      unknown
    >;
    const absent = Array.isArray(args.fields)
      ? (args.fields as string[]).filter((field) => !Object.hasOwn(data, field))
      : [];
    // The form tells a repeated element from a single one, and an empty field from a wrong name.
    const shape =
      absent.length || hasStructure(data)
        ? await this.schema.documentShape(snapshot.type, snapshot.formUrl).catch(() => undefined)
        : undefined;
    // A field the server computes for the catalog (fullname) is not kept in the document.
    const row = await this.catalogRow(snapshot.type, loaded.url, loaded.id, absent);
    const unknownFields = shape?.fields.size
      ? absent.filter((field) => !shape.fields.has(field) && !row.known.has(field))
      : [];
    // Asked for, known to the form or the catalog, and without a value: empty, not forgotten.
    const emptyFields = shape?.fields.size
      ? absent.filter(
          (field) => !unknownFields.includes(field) && !Object.hasOwn(row.values, field),
        )
      : [];
    return {
      ...(loaded.id === undefined ? {} : { id: loaded.id }),
      type: snapshot.type,
      url: loaded.url,
      data: shape ? withRepeated(data, shape.repeated) : data,
      ...(Object.keys(row.values).length ? { fromCatalog: row.values } : {}),
      ...(emptyFields.length ? { emptyFields } : {}),
      ...(unknownFields.length ? { unknownFields } : {}),
      fingerprint: snapshot.fingerprint,
      ...(snapshot.formUrl === undefined ? {} : { formUrl: snapshot.formUrl }),
    };
  }
  async load(
    args: Record<string, unknown>,
  ): Promise<{ document: XmlDocument; url: string; id: string | undefined }> {
    const url =
      args.url === undefined
        ? resolvePhysicalDocumentLocation(requiredString(args.id, "id")).url
        : requiredString(args.url, "url");
    const response = await this.server.call("native.lds.loadDoc", {
      url,
      useBinaryResponse: true,
    });
    const source = isBinary(response)
      ? new TextDecoder("utf-8", { fatal: true }).decode(response.bytes)
      : buildXml(findXmlNode(response, "Data") as XmlObject);
    let document: XmlDocument;
    try {
      document = XmlDocument.parse(source);
    } catch (error) {
      if (args.url === undefined || !(error instanceof HcmError)) throw error;
      throw new HcmError(
        error.code,
        error.message,
        "Если по адресу не документ объекта: файл читает files.read, поля формы — schema.get с url.",
      );
    }
    const snapshot = document.snapshot();
    const documentId =
      typeof snapshot.data.id === "string" && snapshot.data.id !== ""
        ? snapshot.data.id
        : undefined;
    const requested =
      args.id === undefined
        ? undefined
        : resolvePhysicalDocumentLocation(requiredString(args.id, "id")).objectId;
    if (
      requested !== undefined &&
      documentId !== undefined &&
      BigInt(resolvePhysicalDocumentLocation(documentId).objectId) !== BigInt(requested)
    )
      throw new HcmError(
        "TARGET_MISMATCH",
        "ID в прочитанном документе не совпадает с запрошенным.",
        "Нужно передать id и url одного объекта или что-то одно. Запись не отправлена.",
        undefined,
        "not_sent",
      );
    if (args.type !== undefined && snapshot.type !== identifier(args.type, "type"))
      throw new HcmError(
        "TYPE_MISMATCH",
        `Тип объекта — ${snapshot.type}, а не ${String(args.type)}.`,
        undefined,
        { actualType: snapshot.type },
      );
    // Some stock types keep no <id> in the document: the ID is then the requested one or the storage address.
    return { document, url, id: documentId ?? requested ?? parsePhysicalDocumentId(url) };
  }
  private async journal(entry: Record<string, unknown>): Promise<void> {
    await mkdir(this.journalDirectory, { recursive: true });
    await appendFile(
      join(this.journalDirectory, "mutations.jsonl"),
      `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
  }
  private async resolveCatalog(type: string, documentUrl?: string): Promise<string | undefined> {
    const info = await this.server.applicationInfo();
    let dbName = typeof info.default_db_name === "string" ? info.default_db_name : undefined;
    if (documentUrl) {
      const url = new URL(documentUrl);
      if (url.protocol === "x-local:") dbName = url.hostname;
    }
    if (dbName === undefined || !Array.isArray(info.databases)) return undefined;
    const db = info.databases.find(
      (value) => value && typeof value === "object" && "id" in value && value.id === dbName,
    );
    if (!db || typeof db !== "object" || !("catalogs" in db) || !Array.isArray(db.catalogs))
      return undefined;
    const named = (value: unknown, objectType: string, id?: string): boolean =>
      !!value &&
      typeof value === "object" &&
      "object_type" in value &&
      value.object_type === objectType &&
      "id" in value &&
      typeof value.id === "string" &&
      (id === undefined || value.id === id);
    let matches = db.catalogs.filter((value: unknown) => named(value, type));
    // For some types (event) the server leaves the catalog without its object type.
    if (!matches.length)
      matches = db.catalogs.filter((value: unknown) => named(value, "", `${type}s`));
    return matches.length === 1 ? identifier(inputObject(matches[0]).id, "catalog") : undefined;
  }
  /**
   * Values of the named fields in the catalog row of an object. `known` holds the names that are
   * fields of the catalog, whether the row has a value for them or not.
   */
  private async catalogRow(
    type: string,
    url: string,
    id: string | undefined,
    names: readonly string[],
  ): Promise<{ values: Record<string, unknown>; known: Set<string> }> {
    const none = { values: {}, known: new Set<string>() };
    if (!names.length || id === undefined) return none;
    try {
      const catalog = await this.resolveCatalog(type, url);
      if (!catalog) return none;
      const shape = await this.schema.catalogShape({ catalog });
      const known = new Set(names.filter((name) => shape?.fields.has(name)));
      if (!known.size) return none;
      const response = await this.server.read("native.lds.xQuery", {
        query: `for $elem in ${catalog} where $elem/id = ${resolvePhysicalDocumentLocation(id).objectId} return $elem`,
        maxCount: 1,
        expectToReadAll: false,
        keepCursor: false,
      });
      const [item] = queryPage(response, 0, 1, [...known], false).items;
      const values = Object.fromEntries(
        Object.entries(withoutFalseOffset(item ?? {}) as object).filter(([name]) =>
          known.has(name),
        ),
      );
      return { values, known };
    } catch {
      return none;
    }
  }
  private async catalogHasId(catalog: string, id: string): Promise<boolean> {
    const lexicalId = resolvePhysicalDocumentLocation(id).objectId;
    const response = await this.server.read("native.lds.xQuery", {
      query: `for $elem in ${catalog} where $elem/id = ${lexicalId} return $elem`,
      maxCount: 2,
      expectToReadAll: false,
      keepCursor: false,
    });
    const data = cleanXmlValue(findXmlNode(response, "Data"));
    return (
      data !== null &&
      typeof data === "object" &&
      Object.values(data).some((value) => (Array.isArray(value) ? value.length > 0 : value !== ""))
    );
  }
  /**
   * What the server would not keep is refused before the write: a field the type does not have is
   * dropped from the saved document, as is a value for a field the server computes, and a date the
   * server cannot read is stored as another value.
   */
  private async requireFields(
    type: string,
    formUrl: string | undefined,
    data: Record<string, unknown>,
    names: readonly string[],
  ): Promise<void> {
    const shape = await this.schema.documentShape(type, formUrl).catch(() => undefined);
    if (!shape) return;
    const written = [...new Set(names)];
    const unknown =
      shape.fields.size && !shape.partial ? written.filter((name) => !shape.fields.has(name)) : [];
    if (unknown.length) {
      const near = [...shape.fields]
        .filter((field) =>
          unknown.some(
            (name) =>
              (name.length > 3 && field.includes(name)) ||
              (field.length > 3 && name.includes(field)) ||
              oneEditApart(field, name),
          ),
        )
        .slice(0, 5);
      throw new HcmError(
        "UNKNOWN_FIELD",
        `У типа ${type} нет поля: ${unknown.join(", ")}.`,
        `${near.length ? `Похожие: ${near.join(", ")}. ` : ""}Поля типа показывает schema.get.`,
        { fields: unknown },
      );
    }
    const computed = written.filter((name) => shape.computed?.has(name));
    if (computed.length)
      throw new HcmError(
        "INVALID_ARGUMENT",
        `${computed.join(", ")}: значение вычисляет сервер, записать его нельзя.`,
        "Менять нужно поля, из которых сервер его складывает. Вычисляемые поля в schema.get помечены computed:true.",
        { fields: computed },
      );
    const wrong = written.filter((name) => {
      const value = data[name];
      return shape.dates.has(name) && typeof value === "string" && value && !isServerDate(value);
    });
    if (wrong.length)
      throw new HcmError(
        "INVALID_ARGUMENT",
        `${wrong.join(", ")}: дата записана не так, как её читает сервер.`,
        'Писать нужно "2026-12-05" или "2026-12-05T09:30:00". Время — местное время сервера: смещение в значении сервер не учитывает.',
        { fields: wrong },
      );
  }
  async create(args: Record<string, unknown>, out: WriteOutcome): Promise<Record<string, unknown>> {
    const type = identifier(args.type, "type");
    const data = inputObject(args.data, "data");
    if (data.id !== undefined)
      throw new HcmError(
        "IMMUTABLE_ID",
        "ID новому объекту выдаёт сервер: нужно убрать id из data.",
      );
    if (!Object.keys(data).length)
      throw new HcmError(
        "INVALID_ARGUMENT",
        "data: нет ни одного поля.",
        "Нужно передать поля нового объекта, например {name: '…'}; значения по умолчанию сервер подставит сам.",
      );
    XmlDocument.create(type, data).snapshot();
    if (args.formUrl === undefined) await this.schema.requireType(type);
    const formUrl =
      args.formUrl === undefined
        ? `x-local://wtv/wtv_${type}.xmd`
        : requiredString(args.formUrl, "formUrl");
    const form = await this.schema.documentForm(formUrl);
    if (!Array.isArray(form.roots) || !form.roots.includes(type))
      throw new HcmError("FORM_TYPE_MISMATCH", "В форме нет запрошенного типа объекта.");
    await this.requireFields(type, formUrl, data, Object.keys(data));
    const dbName = args.dbName === undefined ? "wt_data" : identifier(args.dbName, "dbName");
    const mutationId = randomUUID();
    out.note({ mutationId });
    await this.journal({ mutationId, operation: "objects.create", stage: "allocating", type });
    const allocated = await this.server.call("native.lds.getNewObjectId", { dbName }, out);
    const location = resolvePhysicalDocumentLocation(
      scalar(findXmlNode(allocated, "ObjectID"), "ObjectID"),
      dbName,
    );
    out.note({ objectId: location.objectId, url: location.url });
    const snapshot = XmlDocument.create(
      type,
      { id: location.objectId, ...data },
      formUrl,
    ).snapshot();
    await this.journal({
      mutationId,
      operation: "objects.create",
      stage: "prepared",
      objectId: location.objectId,
    });
    await this.server.call(
      "native.lds.putDoc",
      { url: location.url, data: snapshot.xml, writeDocInfo: true, neverSaved: true },
      out,
    );
    const loaded = await this.load({ url: location.url, type });
    const result = loaded.document.snapshot();
    if (
      BigInt(requiredString(loaded.id, "ID при проверочном чтении")) !== BigInt(location.objectId)
    )
      throw new HcmError(
        "READ_BACK_MISMATCH",
        "При проверочном чтении ID созданного объекта не совпал с выданным.",
        undefined,
        { mutationId },
        "indeterminate",
      );
    verifyFields(snapshot.data, result.data, form.fields, Object.keys(data));
    await this.journal({
      mutationId,
      operation: "objects.create",
      stage: "verified",
      objectId: location.objectId,
    });
    return {
      id: location.objectId,
      url: location.url,
      type,
      fingerprint: result.fingerprint,
      mutationId,
      mutationOutcome: "confirmed",
    };
  }
  async patch(args: Record<string, unknown>, out: WriteOutcome): Promise<Record<string, unknown>> {
    const loaded = await this.load(args);
    const changes = loaded.document.patch(
      patchInput(args.patch, args.remove, args.resave === true),
    );
    if (
      args.expectedFingerprint !== undefined &&
      args.expectedFingerprint !== changes.before.fingerprint
    )
      throw new HcmError(
        "CONFLICT",
        "Объект изменился после чтения: его fingerprint не равен expectedFingerprint.",
        "Прочитать объект заново и составить изменение по его текущему состоянию.",
        undefined,
        "not_sent",
      );
    // Checked before the preview too: a preview must not promise what the write will refuse.
    await this.requireFields(
      changes.before.type,
      changes.before.formUrl,
      changes.after.data,
      changes.changes
        .filter((change) => inputObject(change).op === "set")
        .map((change) => patchSegments(String(inputObject(change).path))[0]![1]!),
    );
    const noop = changes.before.fingerprint === changes.after.fingerprint;
    // Nothing to change means nothing is sent, unless the caller asks to save the document as
    // it is: the server then fills in again the fields it computes when a document is saved.
    if (args.preview === true || (noop && args.resave !== true))
      return {
        preview: args.preview === true,
        noop: noop && args.resave !== true,
        changes: changes.changes,
        fingerprint: changes.before.fingerprint,
      };
    const current = await this.load(args);
    if (current.document.snapshot().fingerprint !== changes.before.fingerprint)
      throw new HcmError(
        "CONFLICT",
        "Объект изменился, пока готовилась запись.",
        undefined,
        undefined,
        "not_sent",
      );
    const form = await this.schema.documentForm(
      changes.before.formUrl ?? `x-local://wtv/wtv_${changes.before.type}.xmd`,
    );
    const branches = changes.changes.map(
      (change) => patchSegments(String(inputObject(change).path))[0]![1]!,
    );
    const mutationId = randomUUID();
    await this.journal({
      mutationId,
      operation: "objects.patch",
      stage: "prepared",
      fingerprint: changes.before.fingerprint,
    });
    out.note({
      mutationId,
      url: loaded.url,
      ...(loaded.id === undefined ? {} : { objectId: loaded.id }),
    });
    await this.server.call(
      "native.lds.putDoc",
      { url: loaded.url, data: changes.after.xml, writeDocInfo: true },
      out,
    );
    const verified = await this.load(args);
    const snapshot = verified.document.snapshot();
    verifyFields(changes.after.data, snapshot.data, form.fields, branches, changes.before.xml);
    verifyRemovals(changes.after.data, snapshot.data, changes.changes, form.fields);
    await this.journal({
      mutationId,
      operation: "objects.patch",
      stage: "verified",
      fingerprint: snapshot.fingerprint,
    });
    // Fields outside the patch that differ after the save are the server's own work.
    const serverChanged = Object.keys({ ...changes.after.data, ...snapshot.data }).filter(
      (key) =>
        key !== "doc_info" &&
        !branches.includes(key) &&
        JSON.stringify(changes.after.data[key]) !== JSON.stringify(snapshot.data[key]),
    );
    return {
      ...(verified.id === undefined ? {} : { id: verified.id }),
      type: snapshot.type,
      url: loaded.url,
      fingerprint: snapshot.fingerprint,
      changes: changes.changes,
      ...(serverChanged.length ? { serverChanged: serverChanged.slice(0, 20) } : {}),
      mutationId,
      mutationOutcome: "confirmed",
    };
  }
  async delete(args: Record<string, unknown>, out: WriteOutcome): Promise<Record<string, unknown>> {
    if (args.permanent !== true)
      throw new HcmError(
        "DELETE_MODE_REQUIRED",
        "Объект удаляется безвозвратно: для этого нужен permanent:true.",
        "Корзины у этой операции нет.",
        undefined,
        "not_sent",
      );
    const loaded = await this.load(args);
    const snapshot = loaded.document.snapshot();
    const objectId = requiredString(loaded.id, "ID объекта");
    const catalog =
      args.catalog === undefined
        ? await this.resolveCatalog(snapshot.type, loaded.url)
        : identifier(args.catalog, "catalog");
    if (catalog !== undefined && !(await this.catalogHasId(catalog, objectId)))
      throw new HcmError(
        "CATALOG_MISMATCH",
        "Объекта нет в каталоге, по которому проверяется удаление.",
        "Нужно указать каталог, в котором объект есть. Запрос на удаление не отправлен.",
        undefined,
        "not_sent",
      );
    const mutationId = randomUUID();
    await this.journal({ mutationId, operation: "objects.delete", stage: "prepared", objectId });
    out.note({ mutationId, objectId, url: loaded.url });
    await this.server.call("native.lds.deleteDoc", { url: loaded.url, strictDelete: true }, out);
    if (catalog !== undefined && (await this.catalogHasId(catalog, objectId)))
      throw new HcmError(
        "READ_BACK_MISMATCH",
        "После удаления объект всё ещё есть в каталоге.",
        "Перед повтором удаления прочитать объект. Причину сервер пишет в лог spxml_unibridge.",
        undefined,
        "indeterminate",
      );
    await this.journal({
      mutationId,
      operation: "objects.delete",
      stage: catalog === undefined ? "acknowledged" : "verified-absence",
      objectId,
    });
    return {
      id: objectId,
      mutationId,
      mutationOutcome: "confirmed",
      verification: catalog === undefined ? "server acknowledgement" : "catalog absence",
      ...(catalog === undefined ? {} : { catalog }),
    };
  }
}
