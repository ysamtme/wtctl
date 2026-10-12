import { createHash } from "node:crypto";
import { HcmError, inputObject, requiredString } from "./errors.js";
import { withoutFalseOffset } from "./query.js";
import {
  assertXmlCharacters as assertPlatformXmlCharacters,
  createPlatformXmlParser,
  createPlatformXmlBuilder,
  validatePlatformXmlSource,
} from "./protocol/xml.js";

type Node = Record<string, unknown>;
const parser = createPlatformXmlParser({
  preserveOrder: true,
  ignoreAttributes: false,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  commentPropName: "#comment",
  cdataPropName: "#cdata",
});
const builder = createPlatformXmlBuilder({
  preserveOrder: true,
  ignoreAttributes: false,
  format: false,
  commentPropName: "#comment",
  cdataPropName: "#cdata",
  suppressEmptyNode: false,
});
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;
const TYPE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
function name(node: Node): string | undefined {
  return Object.keys(node).find(
    (key) => !key.startsWith("#") && !key.startsWith("?") && key !== ":@",
  );
}
function local(value: string): string {
  return value.split(":").at(-1)!;
}
function children(node: Node, key = name(node)): Node[] {
  if (key === undefined || !Array.isArray(node[key])) return [];
  return node[key] as Node[];
}
function hasExternalData(node: Node, descendants = true): boolean {
  const attributes = node[":@"];
  return (
    (!!attributes &&
      typeof attributes === "object" &&
      Object.keys(attributes).some((key) => /^@_EXT-OBJECT-ID$/i.test(key))) ||
    (descendants && children(node).some((child) => hasExternalData(child)))
  );
}
function assertXmlCharacters(source: string): void {
  try {
    assertPlatformXmlCharacters(source);
  } catch {
    throw new HcmError(
      "INVALID_XML",
      "В значении есть недопустимый символ: XML не принимает управляющие символы и непарные суррогаты.",
    );
  }
}
function assertXml(source: string): void {
  try {
    validatePlatformXmlSource(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : "XML документа составлен с ошибкой.";
    throw new HcmError(
      "INVALID_XML",
      message.includes("DOCTYPE")
        ? "DOCTYPE и объявления ENTITY в XML документа не поддерживаются."
        : message.startsWith("Неверный XML:")
          ? "XML документа составлен с ошибкой."
          : message,
    );
  }
}
function compact(nodes: Node[], depth = 0): unknown {
  if (depth > 64) throw new HcmError("XML_DEPTH_LIMIT", "Вложенность документа больше 64 уровней.");
  const elements = nodes.filter((node) => name(node) !== undefined);
  if (elements.length === 0)
    return nodes
      .map(
        (node) =>
          node["#text"] ??
          (Array.isArray(node["#cdata"]) ? compact(node["#cdata"] as Node[], depth + 1) : ""),
      )
      .join("");
  // A field that carries a value and elements under it reads as the value: under a reference
  // the server keeps `sd`, a copy of the referenced object's fields, which it fills itself.
  const text = nodes
    .map((node) => String(node["#text"] ?? ""))
    .join("")
    .trim();
  if (text !== "" || elements.every((node) => name(node) === "sd")) return text;
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const node of elements) {
    const key = name(node)!;
    const value = compact(children(node), depth + 1);
    if (Object.hasOwn(result, key)) {
      const existing = result[key];
      result[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
    } else result[key] = value;
  }
  return result;
}
/**
 * The document as it goes to the server. A line break is written as a character reference, and
 * the server takes one that follows a value for a part of the value: a reference that keeps `sd`
 * under it then fails to be read and the field is dropped from the saved document. Indentation
 * around elements is not data, the server lays the document out again, so it is left out.
 */
function withoutIndentation(nodes: Node[]): Node[] {
  const elements = nodes.some((node) => name(node) !== undefined);
  return nodes.flatMap((node) => {
    const key = name(node);
    if (key !== undefined) return [{ ...node, [key]: withoutIndentation(children(node)) }];
    if (!elements || !Object.hasOwn(node, "#text")) return [node];
    const text = String(node["#text"])
      .replace(/^\s*\n\s*/, "")
      .replace(/\s*\n\s*$/, "");
    return text ? [{ ...node, "#text": text }] : [];
  });
}
function semantic(nodes: Node[]): unknown {
  const structural =
    nodes.some((node) => name(node) !== undefined) &&
    nodes.every((node) => !Object.hasOwn(node, "#text") || /^\s*$/.test(String(node["#text"])));
  return nodes
    .filter(
      (node) =>
        !(structural && Object.hasOwn(node, "#text") && /^\s*$/.test(String(node["#text"]))),
    )
    .map((node) => {
      const out: Node = Object.create(null) as Node;
      for (const [key, value] of Object.entries(node))
        out[key] = Array.isArray(value) ? semantic(value as Node[]) : value;
      return out;
    });
}
function encodeValue(key: string, value: unknown, depth = 0): Node {
  if (!IDENTIFIER.test(key) || depth > 64)
    throw new HcmError(
      "INVALID_FIELD",
      "Недопустимое имя поля или вложенность больше 64 уровней.",
      undefined,
      {
        path: key,
      },
    );
  if (value === null) return { [key]: [] };
  if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    if (
      typeof value === "number" &&
      (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))
    )
      throw new HcmError(
        "INVALID_FIELD_VALUE",
        "Число нельзя записать точно: оно не конечное или слишком большое. Большое целое передаётся строкой.",
        undefined,
        { path: key },
      );
    const text = String(value);
    assertXmlCharacters(text);
    return { [key]: [{ "#text": text }] };
  }
  if (value === undefined || Array.isArray(value))
    throw new HcmError(
      "INVALID_FIELD_VALUE",
      "Значение поля не задано или это массив в массиве. Вложенные поля задаёт объект, повторяющееся поле — массив значений.",
      undefined,
      { path: key },
    );
  const data = inputObject(value, key);
  const nested: Node[] = [];
  for (const [childKey, childValue] of Object.entries(data)) {
    if (Array.isArray(childValue))
      for (const item of childValue) nested.push(encodeValue(childKey, item, depth + 1));
    else nested.push(encodeValue(childKey, childValue, depth + 1));
  }
  return { [key]: nested };
}

/** A key in a path finds its element by the same text or by the same ID written the other way. */
const ID_TEXT = /^(?:0x[0-9a-f]{1,16}|[1-9]\d{0,19})$/i;
function sameKey(stored: unknown, key: string): boolean {
  const text = String(stored);
  return text === key || (ID_TEXT.test(text) && ID_TEXT.test(key) && BigInt(text) === BigInt(key));
}
/** A change record shows scalar values; of a structure it names the fields and counts the lists. */
function brief(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return `[${value.length} items]`;
  const keys = Object.entries(value).map(([key, item]) =>
    Array.isArray(item) ? `${key}: ${item.length} items` : key,
  );
  return `{${keys.slice(0, 4).join(", ")}${keys.length > 4 ? ", …" : ""}}`;
}
export function patchSegments(path: string): RegExpExecArray[] {
  const parts = path.match(/[^.[\]]+(?:\[[^\]]*\])?/g) ?? [];
  const matches = parts.map((part) =>
    /^([A-Za-z_][A-Za-z0-9_:-]*)(?:\[(?:(\d+)|([A-Za-z_][A-Za-z0-9_:-]*)=([^\]]*))\])?$/.exec(part),
  );
  if (parts.join(".") !== path || matches.some((match) => match === null))
    throw new HcmError("INVALID_PATCH_PATH", "Путь к полю записан неверно.", undefined, { path });
  return matches as RegExpExecArray[];
}

export interface DocumentSnapshot {
  readonly type: string;
  readonly xml: string;
  readonly fingerprint: string;
  readonly data: Record<string, unknown>;
  readonly formUrl?: string;
}
/** Preserve ordered unknown elements, attributes, comments and CDATA while editing selected paths. */
export class XmlDocument {
  private constructor(private root: Node) {}
  static parse(source: string): XmlDocument {
    assertXml(source);
    let nodes: Node[];
    try {
      nodes = parser.parse(source) as Node[];
    } catch {
      throw new HcmError(
        "INVALID_XML",
        "Не удалось разобрать XML документа: превышены ограничения разбора.",
      );
    }
    let roots = nodes.filter((node) => name(node) !== undefined);
    if (roots.length === 1 && local(name(roots[0]!)!) === "Envelope") {
      const body = children(roots[0]!).find((node) => local(name(node) ?? "") === "Body");
      const response =
        body &&
        children(body).find((node) => /(?:LoadDoc|GetDoc)Response$/.test(local(name(node) ?? "")));
      const data =
        response && children(response).find((node) => local(name(node) ?? "") === "Data");
      if (!data) throw new HcmError("DOCUMENT_RESPONSE", "В ответе сервера нет данных документа.");
      roots = children(data).filter((node) => name(node) !== undefined);
    }
    if (roots.length !== 1 || local(name(roots[0]!)!) === "Envelope")
      throw new HcmError("DOCUMENT_RESPONSE", "В ответе сервера не один документ XML.");
    return new XmlDocument(roots[0]!);
  }
  static create(type: string, data: Record<string, unknown>, formUrl?: string): XmlDocument {
    if (!TYPE_IDENTIFIER.test(type))
      throw new HcmError("INVALID_TYPE", "Недопустимое имя типа объекта.");
    const root = encodeValue(type, data);
    if (formUrl !== undefined) {
      const url = requiredString(formUrl, "formUrl");
      assertXmlCharacters(url);
      root[":@"] = { "@_SPXML-FORM": url };
    }
    return new XmlDocument(root);
  }
  snapshot(): DocumentSnapshot {
    const type = local(name(this.root)!);
    const xml = builder.build(withoutIndentation([this.root])) as string;
    assertXml(xml);
    const data = inputObject(compact(children(this.root)), "содержимое документа");
    const attributes = this.root[":@"] as Record<string, unknown> | undefined;
    const formUrl = attributes?.["@_SPXML-FORM"];
    return {
      type,
      xml,
      data,
      fingerprint: createHash("sha256")
        .update(JSON.stringify(semantic([this.root])))
        .digest("hex"),
      ...(typeof formUrl === "string" ? { formUrl } : {}),
    };
  }
  patch(input: unknown): { before: DocumentSnapshot; after: DocumentSnapshot; changes: unknown[] } {
    const before = this.snapshot();
    const workingRoot = structuredClone(this.root);
    const operations = Array.isArray(input)
      ? input
      : Object.entries(inputObject(input, "patch")).map(([path, value]) => ({
          op: "set",
          path,
          value,
        }));
    if (operations.length > 1000)
      throw new HcmError("PATCH_LIMIT", "В одном patch не больше 1000 изменений.");
    const changes: unknown[] = [];
    for (const raw of operations) {
      const operation = inputObject(raw, "элемент patch");
      const path = requiredString(operation.path, "path");
      const segments = patchSegments(path);
      const upTo = (count: number): string =>
        segments
          .slice(0, count)
          .map((part) => part[0])
          .join(".");
      let createdKeyedElement = false;
      // An element made on the way holds only its key: what is found in it was not there before.
      let created = false;
      if (operation.op !== "set" && operation.op !== "remove")
        throw new HcmError("INVALID_PATCH", "op: поддерживаются set и remove.");
      let parent = children(workingRoot);
      for (let index = 0; index < segments.length; index++) {
        const match = segments[index]!;
        const field = match[1]!;
        const position = match[2] === undefined ? undefined : Number(match[2]);
        const key = match[3];
        const keyValue = match[4]!;
        if (index === 0 && local(field) === "id")
          throw new HcmError("IMMUTABLE_ID", "ID объекта изменить нельзя.");
        const matches = parent
          .map((node, i) => ({ node, i }))
          .filter(
            (item) =>
              name(item.node) === field &&
              (key === undefined ||
                children(item.node).some(
                  (child) => name(child) === key && sameKey(compact(children(child)), keyValue),
                )),
          );
        if (position === undefined && matches.length > 1)
          throw new HcmError(
            "AMBIGUOUS_PATCH",
            "Таких полей несколько: нужно указать номер элемента, например [0], или ключ [имя=значение], который есть только у одного.",
            operation.op === "remove" &&
              key === undefined &&
              index > 0 &&
              index === segments.length - 1
              ? `Чтобы убрать все элементы, нужно удалить сам список: remove ["${upTo(index)}"].`
              : undefined,
            { path },
          );
        let chosen = matches[position ?? 0];
        if (chosen && hasExternalData(chosen.node, index === segments.length - 1))
          throw new HcmError(
            "EXTERNAL_FIELD_REQUIRES_API",
            "Поле хранится отдельно от документа как большое поле.",
            "Большое поле записывает native.lds.putLargeField, удаляет native.lds.deleteLargeField; обычное изменение документа сведения о таком поле не переписывает.",
            { path },
            "not_sent",
          );
        if (index < segments.length - 1) {
          if (
            !chosen &&
            position === undefined &&
            (createdKeyedElement || segments.slice(index).some((part) => part[3] !== undefined))
          ) {
            if (operation.op === "remove") break;
            const node = encodeValue(field, key === undefined ? {} : { [key]: keyValue });
            chosen = { node, i: parent.length };
            parent.push(node);
            created = true;
            createdKeyedElement ||= key !== undefined;
          }
          if (!chosen)
            throw new HcmError(
              "PATCH_PATH_MISSING",
              "В документе нет родительского поля.",
              `В документе нет ${upTo(index + 1)}: пустую структуру сервер не хранит. Нужно записать её целиком — {"${upTo(index + 1)}": {…}}; путь с ключом элемента списка, [ключ=значение], создаёт её сам.`,
              {
                path,
              },
            );
          parent = children(chosen.node);
          continue;
        }
        if (operation.op === "remove") {
          if (chosen) parent.splice(chosen.i, 1);
          else if (key !== undefined) break;
        } else {
          if (!Object.hasOwn(operation, "value"))
            throw new HcmError("INVALID_PATCH", "Для set нужно value.", undefined, { path });
          if (key !== undefined) inputObject(operation.value, "значение элемента с ключом");
          // The element was made by this path with its key: the key field takes that same value.
          const made = segments[index - 1];
          if (created && made?.[3] === field && !sameKey(operation.value, made[4]!))
            throw new HcmError(
              "INVALID_PATCH",
              "Ключ в значении не совпадает с ключом в пути.",
              "Элемент создан с ключом из пути: в значение нужно записать его же.",
              { path },
            );
          const replacement = Array.isArray(operation.value)
            ? operation.value.map((value) => encodeValue(field, value))
            : [encodeValue(field, operation.value)];
          if (
            key !== undefined &&
            !sameKey(
              inputObject(compact(children(replacement[0]!)), "значение элемента с ключом")[key],
              keyValue,
            )
          )
            throw new HcmError(
              "INVALID_PATCH",
              "Ключ в значении не совпадает с ключом в пути.",
              undefined,
              {
                path,
              },
            );
          // A date given back as it was read, without the offset the server writes, is the stored value.
          const stored = chosen ? compact(children(chosen.node)) : undefined;
          if (stored !== operation.value && withoutFalseOffset(stored) === operation.value) {
            /* The stored text stays. */
          } else if (chosen) {
            if (chosen.node[":@"] !== undefined && replacement.length === 1)
              replacement[0]![":@"] = chosen.node[":@"];
            parent.splice(chosen.i, 1, ...replacement);
          } else {
            if (position !== undefined)
              throw new HcmError(
                "PATCH_INDEX_MISSING",
                "Элемента с таким номером нет.",
                undefined,
                {
                  path,
                },
              );
            parent.push(...replacement);
          }
        }
        changes.push({
          op: operation.op,
          path,
          ...(chosen && !created
            ? { before: brief(withoutFalseOffset(compact(children(chosen.node)))) }
            : {}),
          ...(operation.op === "set" ? { after: brief(operation.value) } : {}),
        });
      }
    }
    const after = new XmlDocument(workingRoot).snapshot();
    this.root = workingRoot;
    return { before, after, changes };
  }
}
