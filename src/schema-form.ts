import { HcmError } from "./errors.js";
import { normalizeFormParams } from "./protocol/library-functions.js";
import {
  createPlatformXmlParser,
  parseValidatedXml,
  validatePlatformXmlSource,
} from "./protocol/xml.js";

/**
 * Чтобы привести данные к одному виду: имена полей верхнего уровня и повторяющиеся элементы.
 * @internal
 */
export interface DataShape {
  readonly fields: Set<string>;
  /** Пути элементов, объявленных формой повторяющимися, например collaborators.collaborator. */
  readonly repeated: Set<string>;
  /** TYPE полей формы по пути, на любой глубине; у поля без TYPE — пустая строка. */
  readonly types: Map<string, string>;
  /** Пути структур, у которых форма объявила хранимые дочерние поля. */
  readonly parents?: Set<string>;
  /** Поля, которые вычисляет сервер (по пути): записанное в них значение не сохраняется. */
  readonly computed?: Set<string>;
  /**
   * Поля верхнего уровня, которые код формы перед сохранением и заполняет, и очищает сам: копии
   * полей связанных объектов. Узнаются по тексту кода, бывают и лишние — годятся только для пометки.
   */
  readonly serverFilled?: Set<string>;
  /** Базовый тип формы не найден, поэтому имена полей — не все. */
  partial?: boolean;
}

/**
 * Повторяющийся элемент — список и тогда, когда в данных один пункт.
 * @internal
 */
export function withRepeated(value: unknown, repeated: ReadonlySet<string>, prefix = ""): unknown {
  if (Array.isArray(value)) return value.map((item) => withRepeated(item, repeated, prefix));
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      const shaped = withRepeated(child, repeated, path);
      return [key, repeated.has(path) && !Array.isArray(shaped) ? [shaped] : shaped];
    }),
  );
}

/** @internal */
export type FormNode = Record<string, unknown>;

/** @internal */
export interface ExtractedFormField {
  path: string;
  type: string;
  origin: string;
  name?: string;
  title?: string;
  references?: string;
  multiple?: true;
  required?: true;
  key?: string;
  children?: number;
  values?: string[];
  sheet?: string;
  query?: true;
  computed?: true;
}

/** @internal */
export interface FormMethod {
  name: string;
  parameters: string[];
}

const PRIMITIVE_FORM_TYPES = /^(string|integer|real|bool|date|variant|record|attr)$/;

const parser = createPlatformXmlParser({
  preserveOrder: true,
  ignoreAttributes: false,
  parseTagValue: false,
  parseAttributeValue: false,
});

const text = (value: unknown): string => (typeof value === "string" ? value : "");

const attrsObject = (node: FormNode): Record<string, unknown> => {
  const raw = node[":@"];
  return raw !== null && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
};

/** @internal */
export const nodeName = (node: FormNode): string =>
  Object.keys(node).find((key) => !/^[#?:]/.test(key)) ?? "";

/** @internal */
export const nodeChildren = (node: FormNode): FormNode[] => {
  const value = node[nodeName(node)];
  return Array.isArray(value) ? (value as FormNode[]) : [];
};

/** @internal */
export const nodeAttr = (node: FormNode, key: string): string =>
  text(attrsObject(node)[`@_${key}`]);

const findNode = (nodes: readonly FormNode[], target: string): FormNode | undefined => {
  for (const node of nodes) {
    if (nodeName(node) === target) return node;
    const found = findNode(nodeChildren(node), target);
    if (found) return found;
  }
  return undefined;
};

/**
 * Разбирает XML формы SPXML-FORM в список дочерних узлов с сохранением порядка.
 * @internal
 */
export function parseForm(source: string): FormNode[] {
  const normalized = normalizeFormParams(source);
  try {
    validatePlatformXmlSource(normalized);
    const root = findNode(parseValidatedXml(parser, normalized) as FormNode[], "SPXML-FORM");
    if (root) return nodeChildren(root).filter((node) => nodeName(node));
  } catch {
    throw new HcmError("FORM_RESPONSE", "Сервер вернул форму с ошибкой в XML.");
  }
  throw new HcmError("FORM_RESPONSE", "В ответе сервера нет формы (SPXML-FORM).");
}

/**
 * Адреса подключённых форм из тегов USE и INCLUDE (лениво, в порядке обхода).
 * @internal
 */
export function* formIncludeUrls(nodes: readonly FormNode[], baseUrl: string): Generator<string> {
  for (const node of nodes) {
    if (["USE", "INCLUDE"].includes(nodeName(node)) && nodeAttr(node, "FORM")) {
      const target = nodeAttr(node, "FORM");
      yield target.startsWith("//") ? `x-local:${target}` : new URL(target, baseUrl).href;
    }
  }
}

/**
 * Регистрирует именованные типы узлов формы как образцы для наследования.
 * @internal
 */
export function registerFormSamples(
  nodes: readonly FormNode[],
  samples: Map<string, FormNode>,
): void {
  // Включённые формы тоже показывают именованные типы без SAMPLE, замечено на 2025.2.1535.
  for (const node of nodes)
    if (!/^(USE|INCLUDE|On|DocDesc)/.test(nodeName(node))) samples.set(nodeName(node), node);
}

/**
 * Имя элемента строки каталога по его форме.
 * @internal
 */
export function extractRowType(nodes: readonly FormNode[], catalogId: string): string {
  const root = nodes.find((node) => nodeName(node) === catalogId);
  const row = root && nodeChildren(root).find((node) => nodeAttr(node, "MULTIPLE") === "1");
  return row ? nodeName(row) : "";
}

/**
 * Находит корневой узел типа в разобранной форме.
 * @internal
 */
export function findFormRoot(
  roots: readonly FormNode[],
  requestedType?: string,
): FormNode | undefined {
  const candidates = roots.filter(
    (node) => nodeAttr(node, "SAMPLE") !== "1" && !/^(USE|INCLUDE|On|DocDesc)/.test(nodeName(node)),
  );
  if (requestedType === undefined) return candidates.length === 1 ? candidates[0] : undefined;
  return candidates.find((node) => nodeName(node) === requestedType);
}

interface WalkVisitContext {
  readonly node: FormNode;
  readonly key: string;
  readonly path: string;
  readonly prefix: string;
  readonly base: string;
  readonly origin: string;
  readonly resolveBase: () => FormNode | undefined;
}

interface WalkFormOptions {
  readonly samples: ReadonlyMap<string, FormNode>;
  readonly maxDepth?: number;
  readonly maxStack?: number;
  readonly onLimit?: () => void;
  readonly onCycle?: (base: string) => void;
  readonly onMissingBase?: (base: string, inherit: boolean) => void;
  readonly skip: (node: FormNode, key: string) => boolean;
  readonly visit: (context: WalkVisitContext) => FormNode | null | false | void;
}

function walkFormTree(rootNodes: readonly FormNode[], options: WalkFormOptions): void {
  const resolveBase = (
    base: string,
    stack: readonly string[],
    inherit: boolean,
  ): FormNode | undefined => {
    if (stack.includes(base)) {
      options.onCycle?.(base);
      return undefined;
    }
    const sample = options.samples.get(base);
    if (!sample && (inherit || (base && !PRIMITIVE_FORM_TYPES.test(base))))
      options.onMissingBase?.(base, inherit);
    return sample;
  };
  const nextOrigin = (origin: string, base: string): string =>
    origin === "own" ? `inherited:${base}` : origin;
  const step = (
    nodes: readonly FormNode[],
    prefix: string,
    origin: string,
    stack: readonly string[],
    depth: number,
  ): void => {
    if (
      (options.maxDepth !== undefined && depth > options.maxDepth) ||
      (options.maxStack !== undefined && stack.length > options.maxStack)
    ) {
      options.onLimit?.();
      return;
    }
    for (const node of nodes) {
      const key = nodeName(node);
      const base = nodeAttr(node, "TYPE");
      if (key === "INHERIT") {
        const sample = resolveBase(base, stack, true);
        if (sample)
          step(nodeChildren(sample), prefix, nextOrigin(origin, base), [...stack, base], depth + 1);
        continue;
      }
      if (options.skip(node, key)) continue;
      const path = prefix ? `${prefix}.${key}` : key;
      const result = options.visit({
        node,
        key,
        path,
        prefix,
        base,
        origin,
        resolveBase: () => resolveBase(base, stack, false),
      });
      if (result === false) continue;
      const sample = result === undefined ? resolveBase(base, stack, false) : result;
      if (sample)
        step(nodeChildren(sample), path, nextOrigin(origin, base), [...stack, base], depth + 1);
      step(nodeChildren(node), path, origin, stack, depth + 1);
    }
  };
  step(rootNodes, "", "own", [], 0);
}

/**
 * Корневые типы и плоский список полей формы для сверки после записи документа.
 * @internal
 */
export function extractDocumentForm(
  allRoots: readonly FormNode[],
  samples: ReadonlyMap<string, FormNode>,
): { roots: string[]; fields: unknown[] } {
  const roots = allRoots.filter(
    (node) => !/^(USE|INCLUDE|On|METHOD|PROPERTY|SCRIPT)/.test(nodeName(node)),
  );
  const fields: unknown[] = [];
  for (const root of roots) {
    walkFormTree(nodeChildren(root), {
      samples,
      maxDepth: 32,
      skip: (_, key) => !key || key === "OnBeforeSave" || key === "OnCreate",
      visit: ({ node, path, base }) => {
        fields.push({
          path,
          type: base || "element",
          multiple: nodeAttr(node, "MULTIPLE") === "1",
        });
      },
    });
  }
  return { roots: roots.map(nodeName), fields };
}

/**
 * Поля одной строки каталога по пути из разобранной формы каталога.
 * @internal
 */
export function extractCatalogFields(
  catalogRoots: readonly FormNode[],
  catalogId: string,
  type: string,
  samples: ReadonlyMap<string, FormNode>,
): Map<string, FormNode> {
  const query = new Map<string, FormNode>();
  const roots = catalogRoots.filter((node) => nodeAttr(node, "SAMPLE") !== "1");
  // Строка обычно названа по типу объекта; если нет, это список под каталогом.
  const own = roots.find((node) => nodeName(node) === catalogId);
  const record =
    findNode(roots, type) ??
    (own ? nodeChildren(own).find((node) => nodeAttr(node, "MULTIPLE") === "1") : undefined);
  if (record) {
    walkFormTree(nodeChildren(record), {
      samples,
      skip: (_, key) => !key || /^(On|DocDesc)/.test(key),
      visit: ({ node, path }) => {
        query.set(path, node);
      },
    });
  }
  return query;
}

/**
 * Структура документа одного типа с унаследованными, вычисляемыми и автозаполняемыми полями.
 * @internal
 */
export function extractDocumentShape(
  roots: readonly FormNode[],
  type: string,
  samples: ReadonlyMap<string, FormNode>,
): DataShape {
  const root = roots.find((node) => nodeName(node) === type && nodeAttr(node, "SAMPLE") !== "1");
  const parents = new Set<string>();
  const computed = new Set<string>();
  const stored = new Set<string>();
  const serverFilled = new Set<string>();
  const shape: DataShape = {
    fields: new Set(),
    repeated: new Set(),
    types: new Map(),
    parents,
    computed,
    serverFilled,
  };
  if (root) {
    walkFormTree(nodeChildren(root), {
      samples,
      maxStack: 64,
      onLimit: () => {
        shape.partial = true;
      },
      onMissingBase: () => {
        shape.partial = true;
      },
      skip: (_, key) => !key || /^(On|DocDesc)/.test(key),
      visit: ({ node, key, path, prefix, base }) => {
        const isComputed = nodeAttr(node, "PROPERTY") === "1";
        if (!prefix) shape.fields.add(key);
        if (prefix && !isComputed) parents.add(prefix);
        (isComputed ? computed : stored).add(path);
        shape.types.set(path, base);
        if (nodeAttr(node, "MULTIPLE") === "1") shape.repeated.add(path);
      },
    });
  }
  // Имя, которое вычисляет базовый тип, а сам тип хранит, — хранимое поле.
  for (const path of stored) computed.delete(path);
  const onSave = roots.find((node) => nodeName(node) === "OnBeforeSave");
  const code = onSave ? nodeAttr(onSave, "EXPR") : "";
  for (const path of stored)
    if (
      !path.includes(".") &&
      code.includes(`TopElem.${path}.Clear()`) &&
      new RegExp(String.raw`TopElem\.${path}\s*=(?!=)`).test(code)
    )
      serverFilled.add(path);
  return shape;
}

/**
 * Извлекает поля и методы типа из корневого узла формы с учётом наследования и каталога.
 * @internal
 */
export function extractFormFields(
  root: FormNode,
  samples: ReadonlyMap<string, FormNode>,
  query: ReadonlyMap<string, FormNode>,
  resolveTitle: (raw: string) => string,
  notes: string[],
): { fields: Map<string, ExtractedFormField>; methods: Map<string, FormMethod> } {
  const fields = new Map<string, ExtractedFormField>();
  const methods = new Map<string, FormMethod>();
  walkFormTree(nodeChildren(root), {
    samples,
    maxStack: 64,
    onLimit: () => {
      throw new HcmError("FORM_DEPTH_LIMIT", "Наследование в форме глубже 64 уровней.");
    },
    onCycle: () => {
      throw new HcmError(
        "FORM_INHERITANCE",
        "Базовые типы формы ссылаются друг на друга по кругу.",
      );
    },
    onMissingBase: (base) => {
      const note = `Базовый тип ${base} не найден: его поля в ответ не попали.`;
      if (!notes.includes(note)) notes.push(note);
    },
    skip: (node, key) => !key || /^(On|DocDesc)$|^On/.test(key) || nodeAttr(node, "TEMP") === "1",
    visit: ({ node, path, base, origin, resolveBase }) => {
      const catalogNode = query.get(path);
      const parameters = Object.entries(attrsObject(node))
        .filter(([key]) => /^@_PARAM__\d+$/.test(key))
        .map(([, value]) => text(value));
      const computed = nodeAttr(node, "PROPERTY") === "1";
      if (computed && (parameters.length || (!nodeAttr(node, "TITLE") && !catalogNode))) {
        methods.set(path, { name: path, parameters });
        return false;
      }
      const title = resolveTitle(
        nodeAttr(node, "TITLE") || (catalogNode ? nodeAttr(catalogNode, "TITLE") : ""),
      );
      const sample = resolveBase();
      const field: ExtractedFormField = {
        path,
        type:
          (sample ? "" : base) ||
          (!nodeChildren(node).some((child) => nodeName(child)) && catalogNode
            ? nodeAttr(catalogNode, "TYPE")
            : "") ||
          "element",
        origin,
      };
      if (title) field.title = title;
      if (nodeAttr(node, "FOREIGN-ARRAY")) field.references = nodeAttr(node, "FOREIGN-ARRAY");
      if (nodeAttr(node, "MULTIPLE") === "1") field.multiple = true;
      if (nodeAttr(node, "NOT-NULL") === "1") field.required = true;
      if (nodeAttr(node, "PRIMARY-KEY")) field.key = nodeAttr(node, "PRIMARY-KEY");
      if (computed) field.computed = true;
      if (catalogNode) field.query = true;
      fields.set(path, field);
      return sample ?? null;
    },
  });
  return { fields, methods };
}
