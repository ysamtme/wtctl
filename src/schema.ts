import { HcmError, boundedInteger, requiredString } from "./errors.js";
import { identifier } from "./query.js";
import { XmlDocument } from "./documents.js";
import { createPlatformXmlParser, validatePlatformXmlSource } from "./protocol/xml.js";
import { normalizeFormParams } from "./protocol/library-functions.js";

export interface SchemaInput {
  type?: string;
  url?: string;
  search?: string;
  path?: string;
  /** Вложенные поля всех глубин одним списком, а не по уровню за вызов. */
  deep?: boolean;
  origin?: ("own" | "inherited" | "custom" | "catalog")[];
  kind?: string;
  include?: "methods"[];
  language?: string;
  limit?: number;
  cursor?: number;
}
export interface SchemaField {
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
export interface SchemaResult {
  type: string;
  catalog?: string;
  formUrl: string;
  /** С path: элемент, чьи поля перечислены — список ли он, какой у него ключ. */
  element?: SchemaField;
  fields: SchemaField[];
  total: number;
  nextCursor?: number;
  /** Страница короче запрошенной: больше не умещается в один ответ. */
  cutBySize?: true;
  notes: string[];
  methods?: { name: string; parameters: string[] }[];
}
export interface SchemaTypesInput {
  search?: string;
  limit?: number;
  cursor?: number;
}
export interface SchemaTypesResult {
  types: { type: string; catalog?: string; title?: string; customFields: number | "by kind" }[];
  total: number;
  /** Всего каталогов на сервере, включая те, у которых нет своего типа объекта. */
  catalogs: number;
  nextCursor?: number;
  notes?: string[];
}
/** Чтобы привести данные к одному виду: имена полей верхнего уровня и повторяющиеся элементы. */
export interface DataShape {
  readonly fields: Set<string>;
  /** Пути элементов, объявленных формой повторяющимися, например collaborators.collaborator. */
  readonly repeated: Set<string>;
  /** Поля верхнего уровня, которые форма объявляет датами. */
  readonly dates: Set<string>;
  /** Поля верхнего уровня строки каталога, которые форма объявляет целыми: ID и счётчики. */
  readonly integers?: Set<string>;
  /** Поля верхнего уровня, которые вычисляет сервер: записанное в них значение не сохраняется. */
  readonly computed?: Set<string>;
  /** Базовый тип формы не найден, поэтому имена полей — не все. */
  partial?: boolean;
}
/** Повторяющийся элемент — список и тогда, когда в данных один пункт. */
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
type Data = Record<string, unknown>;
type Node = Record<string, unknown>;
const parser = createPlatformXmlParser({
  preserveOrder: true,
  ignoreAttributes: false,
  parseTagValue: false,
  parseAttributeValue: false,
});
const list = (value: unknown): Data[] =>
  (Array.isArray(value) ? value : [value]).filter((v): v is Data => !!v && typeof v === "object");
const data = (value: unknown): Data => list(value)[0] ?? {};
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const name = (node: Node): string => Object.keys(node).find((key) => !/^[#?:]/.test(key)) ?? "";
const children = (node: Node): Node[] =>
  Array.isArray(node[name(node)]) ? (node[name(node)] as Node[]) : [];
const attr = (node: Node, key: string): string => text(data(node[":@"])[`@_${key}`]);
const find = (nodes: Node[], target: string): Node | undefined => {
  for (const node of nodes) {
    if (name(node) === target) return node;
    const found = find(children(node), target);
    if (found) return found;
  }
  return undefined;
};
const languages: Record<string, string> = {
  ru: "russian",
  en: "english",
  kk: "kazakh",
  uk: "ukrain",
  uz: "uzbek",
  hy: "armenian",
  bg: "bulgarian",
  tr: "turkish",
};
export function languageFileUrl(id: unknown, language?: string): string {
  const folder =
    language === undefined ? (languages[text(id)] ?? "russian") : (languages[language] ?? language);
  return `x-local://lngs/${identifier(folder, "language")}/const.xml`;
}
const folded = (value: string): string => value.toLowerCase().replaceAll("ё", "е");
/**
 * Заголовки ищутся по словам, которые вводит человек, в любом порядке. Русское слово берётся без
 * падежного окончания: «должность» находит «Название должности»; четыре буквы остаются всегда.
 */
const matches = (search: string | undefined, values: (string | undefined)[]): boolean => {
  if (search === undefined) return true;
  const where = values.map((value) => folded(value ?? ""));
  return folded(search)
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => {
      const stem = word.replace(
        /(?<=[а-я]{4})(?:ами|ями|ого|его|ому|ему|ов|ев|ам|ям|ах|ях|ом|ем|ых|их|ым|им|[аеиоуыэюяьй]{1,2})$/,
        "",
      );
      return where.some((value) => value.includes(stem));
    });
};
const nothingFound = (where: string, examples: string, search = "", one = "поле"): string =>
  `Ничего не найдено: search ищет слова ${where}.${/\S\s+\S/.test(search) ? ` Все слова должны быть в одном ${one}: искать нужно по одному слову.` : ""} Можно попробовать слово из заголовка на языке сервера, часть имени латиницей (${examples}) или вызов без search.`;
const pageSize = (value: unknown): number => Buffer.byteLength(JSON.stringify(value));

/** Читает живые метаданные через фиксированные операции чтения runtime; все кэши — в памяти. */
export class SchemaReader {
  private forms = new Map<string, Promise<Node[]>>();
  private shapes = new Map<string, Promise<DataShape>>();
  private dictionaries = new Map<string, Promise<Map<string, string>>>();
  private common: Promise<Data> | undefined;
  private custom: { expires: number; value: Promise<Data> } | undefined;
  constructor(
    private applicationInfo: () => Promise<Data>,
    private readForm: (url: string) => Promise<string>,
    private readDocument: (url: string) => Promise<Data>,
  ) {}
  private form(url: string): Promise<Node[]> {
    let cached = this.forms.get(url);
    if (!cached) {
      cached = this.readForm(url).then((source) => {
        const normalized = normalizeFormParams(source);
        try {
          validatePlatformXmlSource(normalized);
          const root = find(parser.parse(normalized) as Node[], "SPXML-FORM");
          if (root) return children(root).filter((node) => name(node));
        } catch {
          throw new HcmError("FORM_RESPONSE", "Сервер вернул форму с ошибкой в XML.");
        }
        throw new HcmError("FORM_RESPONSE", "В ответе сервера нет формы (SPXML-FORM).");
      });
      this.forms.set(url, cached);
    }
    return cached;
  }
  /**
   * Типы полей для проверки после записи. Базовый тип отдаёт свои поля тому месту, которое его
   * называет: без них логическое true, отправленное серверу, не равнялось бы хранимому им 1.
   */
  async documentForm(url: string): Promise<{ roots: string[]; fields: unknown[] }> {
    const samples = new Map<string, Node>();
    const roots = (await this.samples(url, samples)).filter(
      (node) => !/^(USE|INCLUDE|On|METHOD|PROPERTY|SCRIPT)/.test(name(node)),
    );
    const fields = (nodes: Node[], prefix = "", stack: string[] = [], depth = 0): unknown[] => {
      if (depth > 32) return [];
      return nodes.flatMap((node) => {
        const key = name(node);
        const base = attr(node, "TYPE");
        const sample = samples.has(base) && !stack.includes(base) ? samples.get(base) : undefined;
        const inherited = sample ? [...stack, base] : stack;
        if (key === "INHERIT")
          return sample ? fields(children(sample), prefix, inherited, depth + 1) : [];
        if (!key || ["OnBeforeSave", "OnCreate"].includes(key)) return [];
        const path = prefix ? `${prefix}.${key}` : key;
        return [
          { path, type: base || "element", multiple: attr(node, "MULTIPLE") === "1" },
          ...(sample ? fields(children(sample), path, inherited, depth + 1) : []),
          ...fields(children(node), path, stack, depth + 1),
        ];
      });
    };
    return { roots: roots.map(name), fields: roots.flatMap((root) => fields(children(root))) };
  }
  private shared(info: Data, id: string): Promise<Data> {
    const url = text(list(info.shared_docs).find((item) => item.id === id)?.url);
    if (!url)
      return Promise.reject(
        new HcmError("SCHEMA_METADATA", `Сервер не сообщил адрес общего документа ${id}.`),
      );
    return id === "common"
      ? this.readForm(url).then((source) => XmlDocument.parse(source).snapshot().data)
      : this.readDocument(url);
  }
  private commonData(info: Data): Promise<Data> {
    if (!this.common) {
      const reading = (this.common = this.shared(info, "common"));
      reading.catch(() => {
        if (this.common === reading) this.common = undefined;
      });
    }
    return this.common;
  }
  /** Типы объектов, которые объявляет сервер; пустой список, если объявление не читается. */
  private async declaredTypes(info: Data): Promise<Data[]> {
    const common = await this.commonData(info).catch((): Data => ({}));
    return list(data(common.exchange_object_types).exchange_object_type);
  }
  private customData(info: Data): Promise<Data> {
    if (!this.custom || this.custom.expires <= Date.now())
      this.custom = { expires: Date.now() + 60000, value: this.shared(info, "custom_templates") };
    return this.custom.value;
  }
  private language(info: Data, language: string | undefined): Promise<Map<string, string>> {
    const folder = languageFileUrl(info.ui_lang_id, language);
    let cached = this.dictionaries.get(folder);
    if (!cached) {
      cached = this.readDocument(folder).then(
        (value) =>
          new Map(
            list(data(value.items).item ?? value.item).map((item) => [
              text(item.id),
              text(item.val),
            ]),
          ),
      );
      this.dictionaries.set(folder, cached);
    }
    return cached;
  }
  private unknownType(info: Data, type: string, declared: Data[] = []): HcmError | undefined {
    const catalogs = this.catalogs(info);
    const own = catalogs.filter((item) => item.id === type).map((item) => text(item.object_type));
    const types = [
      ...catalogs.map((item) => text(item.object_type)),
      ...declared.map((item) => text(item.name)),
    ].filter(Boolean);
    if (types.includes(type)) return undefined;
    const near = [
      ...new Set([
        ...own.filter(Boolean),
        ...types.filter((item) => item.includes(type) || type.includes(item)),
      ]),
    ].slice(0, 5);
    const rows = catalogs
      .filter((item) => !text(item.object_type) && text(item.id).startsWith(type))
      .map((item) => text(item.id))
      .slice(0, 3);
    return new HcmError(
      "UNKNOWN_TYPE",
      `На сервере нет типа объекта ${type}.`,
      `${near.length ? `Похожие: ${near.join(", ")}. ` : ""}${rows.length ? `Каталог без своего типа объекта: ${rows.join(", ")} — его поля показывает схема по имени каталога. ` : ""}Типы объектов показывает schema.types.`,
    );
  }
  /**
   * Имя, не являющееся типом объекта, отклоняется до записи. Проверке нужны списки сервера:
   * если их не прочитать, имя оставляется серверу.
   */
  async requireType(type: string): Promise<void> {
    const info = await this.applicationInfo().catch(() => undefined);
    if (!info) return;
    const catalogs = this.catalogs(info);
    if (catalogs.some((item) => item.object_type === type)) return;
    const declared = await this.declaredTypes(info);
    if (declared.some((item) => item.name === type)) return;
    if (declared.length || catalogs.some((item) => item.id === type))
      throw this.unknownType(info, type, declared);
  }
  /**
   * Являются ли строки этого типа документами. Строки других каталогов (group_collaborators)
   * строит сервер, документа у них нет; если не определить, ответ — да.
   */
  private async hasDocuments(info: Data, type: string): Promise<boolean> {
    if (this.catalogs(info).some((item) => item.object_type === type)) return true;
    const declared = await this.declaredTypes(info);
    return !declared.length || declared.some((item) => item.name === type);
  }
  /**
   * Каталоги основной базы. Тип объекта сервер называет только у части из них. Рядом он
   * перечисляет общие списки (common.…): это не каталоги, и они пропускаются.
   */
  private catalogs(info: Data): Data[] {
    const databases = list(info.databases);
    return list(
      (databases.find((db) => db.id === info.default_db_name) ?? databases[0])?.catalogs,
    ).filter((item) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(text(item.id)));
  }
  /** Тип строк каталога: названный сервером или, если нет, по форме каталога. */
  private async rowType(catalog: Data): Promise<string> {
    const named = text(catalog.object_type);
    if (named || !text(catalog.form_url)) return named;
    const root = (await this.form(text(catalog.form_url))).find(
      (node) => name(node) === catalog.id,
    );
    const row = root && children(root).find((node) => attr(node, "MULTIPLE") === "1");
    return row ? name(row) : "";
  }
  /**
   * Каталоги, строки которых — объекты этого типа. У некоторых типов (event) сервер оставляет
   * каталог без имени: тогда засчитывается каталог, названный по типу, если форма согласна.
   */
  private async catalogsOf(info: Data, type: string): Promise<Data[]> {
    const catalogs = this.catalogs(info);
    const named = catalogs.filter((item) => item.object_type === type);
    if (named.length || !type) return named;
    const plural = catalogs.find((item) => item.id === `${type}s` && !text(item.object_type));
    return plural && (await this.rowType(plural).catch(() => "")) === type
      ? [{ ...plural, object_type: type }]
      : [];
  }
  private async context(
    language?: string,
  ): Promise<{ info: Data; custom: Data; dictionary: Map<string, string>; notes: string[] }> {
    const info = await this.applicationInfo();
    const notes: string[] = [];
    const dictionary = await this.language(info, language).catch(() => {
      notes.push(
        `Файл языка ${languageFileUrl(info.ui_lang_id, language)} прочитать не удалось: заголовки, которые берутся из него, показаны как есть.`,
      );
      return new Map<string, string>();
    });
    const custom = await this.customData(info).catch(() => {
      notes.push(
        "Документ с настраиваемыми полями прочитать не удалось: настраиваемых полей в ответе нет.",
      );
      return {};
    });
    return { info, dictionary, custom, notes };
  }
  private title(value: string, dictionary: Map<string, string>): string {
    if (value.startsWith("const="))
      return dictionary.get(value.slice(6)) ?? (dictionary.size ? "" : value);
    return /^##(['"])([\s\S]*)\1##$/.exec(value)?.[2] ?? value;
  }
  private typeTranslations(info: Data): Promise<Map<string, string>> {
    const url = `x-local://i18n/common/${identifier(info.ui_lang_id ?? "ru", "ui_lang_id")}/const.json`;
    let cached = this.dictionaries.get(url);
    if (!cached) {
      cached = this.readForm(url)
        .then(
          (source) =>
            new Map(
              Object.entries(data(JSON.parse(source))).map(([key, value]) => [key, text(value)]),
            ),
        )
        .catch(() => new Map<string, string>());
      this.dictionaries.set(url, cached);
    }
    return cached;
  }
  private typeTitle(
    definition: Data,
    dictionary: Map<string, string>,
    translations: Map<string, string>,
  ): string {
    const expression = text(definition.title).trim();
    const call = /^(i18n\.t|ms_tools\.get_const)\s*\(\s*'([^'\\]*)'\s*\)$/.exec(expression);
    if (call) return (call[1] === "i18n.t" ? translations : dictionary).get(call[2]!) ?? "";
    const literal = /^'([^'\\]*)'$/.exec(expression);
    if (literal) return literal[1]!;
    const constant = text(definition.web_const);
    return constant
      ? this.title(constant.startsWith("const=") ? constant : `const=${constant}`, dictionary)
      : "";
  }
  private async samples(
    url: string,
    samples: Map<string, Node>,
    visited = new Set<string>(),
  ): Promise<Node[]> {
    if (visited.has(url)) return [];
    if (visited.size >= 64)
      throw new HcmError("FORM_DEPTH_LIMIT", "Форма подключает больше 64 других форм.");
    visited.add(url);
    const nodes = await this.form(url);
    for (const node of nodes) {
      if (["USE", "INCLUDE"].includes(name(node)) && attr(node, "FORM")) {
        const target = attr(node, "FORM");
        await this.samples(
          target.startsWith("//") ? `x-local:${target}` : new URL(target, url).href,
          samples,
          visited,
        );
      }
    }
    // Включённые формы тоже показывают именованные типы без SAMPLE, замечено на 2025.2.1535.
    for (const node of nodes)
      if (!/^(USE|INCLUDE|On|DocDesc)/.test(name(node))) samples.set(name(node), node);
    return nodes;
  }
  /** Поля одной строки каталога по пути, прочитанные из формы каталога. */
  private async catalogFields(
    catalog: Data | undefined,
    type: string,
    samples: Map<string, Node>,
  ): Promise<Map<string, Node>> {
    const query = new Map<string, Node>();
    if (!catalog || !text(catalog.form_url)) return query;
    const catalogRoots = await this.samples(text(catalog.form_url), samples);
    const roots = catalogRoots.filter((node) => attr(node, "SAMPLE") !== "1");
    // Строка обычно названа по типу объекта; если нет, это список под каталогом.
    const own = roots.find((node) => name(node) === text(catalog.id));
    const record =
      find(roots, type) ??
      (own ? children(own).find((node) => attr(node, "MULTIPLE") === "1") : undefined);
    const collect = (nodes: Node[], prefix = "", stack: string[] = []): void => {
      for (const node of nodes) {
        const key = name(node);
        const base = attr(node, "TYPE");
        if (key === "INHERIT") {
          if (samples.has(base) && !stack.includes(base))
            collect(children(samples.get(base)!), prefix, [...stack, base]);
        } else if (key && !/^(On|DocDesc)/.test(key)) {
          const path = prefix ? `${prefix}.${key}` : key;
          query.set(path, node);
          if (samples.has(base) && !stack.includes(base))
            collect(children(samples.get(base)!), path, [...stack, base]);
          collect(children(node), path, stack);
        }
      }
    };
    if (record) collect(children(record));
    return query;
  }
  /** Структура документа одного типа с унаследованными полями; читается один раз на форму. */
  documentShape(type: string, formUrl = `x-local://wtv/wtv_${type}.xmd`): Promise<DataShape> {
    return this.shape(`${formUrl}#${type}`, async () => {
      const samples = new Map<string, Node>();
      const roots = await this.samples(formUrl, samples);
      const root = roots.find((node) => name(node) === type && attr(node, "SAMPLE") !== "1");
      const computed = new Set<string>();
      const stored = new Set<string>();
      const shape: DataShape = {
        fields: new Set(),
        repeated: new Set(),
        dates: new Set(),
        computed,
      };
      const collect = (nodes: Node[], prefix = "", stack: string[] = []): void => {
        if (stack.length > 64) return;
        for (const node of nodes) {
          const key = name(node);
          const base = attr(node, "TYPE");
          const sample = samples.has(base) && !stack.includes(base) ? samples.get(base) : undefined;
          if (key === "INHERIT") {
            if (sample) collect(children(sample), prefix, [...stack, base]);
            else if (!stack.includes(base)) shape.partial = true;
            continue;
          }
          if (!key || /^(On|DocDesc)/.test(key)) continue;
          const path = prefix ? `${prefix}.${key}` : key;
          if (!prefix) shape.fields.add(key);
          if (!prefix) (attr(node, "PROPERTY") === "1" ? computed : stored).add(key);
          if (!prefix && base === "date") shape.dates.add(key);
          if (attr(node, "MULTIPLE") === "1") shape.repeated.add(path);
          if (sample) collect(children(sample), path, [...stack, base]);
          collect(children(node), path, stack);
        }
      };
      if (root) collect(children(root));
      // Имя, которое вычисляет базовый тип, а сам тип хранит, — хранимое поле.
      for (const key of stored) computed.delete(key);
      return shape;
    });
  }
  /** Структура одной строки каталога; каталог назван или находится по типу объекта его строк. */
  async catalogShape(selector: {
    catalog?: string;
    type?: string;
  }): Promise<DataShape | undefined> {
    const info = await this.applicationInfo();
    const catalogs =
      selector.catalog === undefined
        ? await this.catalogsOf(info, selector.type ?? "")
        : this.catalogs(info).filter((item) => item.id === selector.catalog);
    if (catalogs.length !== 1) return undefined;
    const catalog = catalogs[0]!;
    return this.shape(`catalog#${text(catalog.id)}`, async () => {
      const known = await this.catalogFields(catalog, await this.rowType(catalog), new Map());
      const integers = new Set<string>();
      const shape: DataShape = {
        fields: new Set(),
        repeated: new Set(),
        dates: new Set(),
        integers,
      };
      for (const [path, node] of known) {
        if (!path.includes(".")) shape.fields.add(path);
        if (!path.includes(".") && attr(node, "TYPE") === "date") shape.dates.add(path);
        if (!path.includes(".") && attr(node, "TYPE") === "integer") integers.add(path);
        if (attr(node, "MULTIPLE") === "1") shape.repeated.add(path);
      }
      return shape;
    });
  }
  private shape(key: string, read: () => Promise<DataShape>): Promise<DataShape> {
    let cached = this.shapes.get(key);
    if (!cached) {
      cached = read();
      this.shapes.set(key, cached);
      cached.catch(() => this.shapes.delete(key));
    }
    return cached;
  }
  /**
   * Сервер отвечает на отклонённый запрос к каталогу голым HTTP 500. После такого отказа здесь
   * называется обычная причина: каталога не существует или поля нет в каталоге.
   */
  async explainQuery(catalogId: string, fields: readonly string[]): Promise<HcmError | undefined> {
    const info = await this.applicationInfo();
    const catalogs = this.catalogs(info);
    const catalog = catalogs.find((item) => item.id === catalogId);
    if (!catalog) {
      const near = [
        ...(await this.catalogsOf(info, catalogId)),
        ...catalogs.filter(
          (item) =>
            text(item.id).includes(catalogId) ||
            (text(item.object_type) && catalogId.includes(text(item.object_type))),
        ),
      ]
        .map((item) => text(item.id))
        .filter((item, index, all) => all.indexOf(item) === index)
        .slice(0, 5);
      return new HcmError(
        "UNKNOWN_CATALOG",
        `На сервере нет каталога ${catalogId}.`,
        `${near.length ? `Похожие: ${near.join(", ")}. ` : ""}Каталоги и их типы объектов показывает schema.types.`,
      );
    }
    if (!fields.length) return undefined;
    const type = await this.rowType(catalog);
    const known = await this.catalogFields(catalog, type, new Map());
    const unknown = fields.filter((field) => !known.has(field));
    if (!known.size || !unknown.length) return undefined;
    // Имена, которые в каталоге есть: нужное поле часто среди них под другим именем.
    const names = [...known.keys()].filter((name) => !name.includes("."));
    const listed = `${names.slice(0, 30).join(", ")}${names.length > 30 ? `… (всего ${names.length})` : ""}`;
    return new HcmError(
      "UNKNOWN_CATALOG_FIELD",
      `В каталоге ${catalogId} нет поля: ${unknown.join(", ")}.`,
      (await this.hasDocuments(info, type))
        ? `Поиск идёт по строкам каталога, не по документам. Поля каталога: ${listed}; в schema.get для типа ${type} они отмечены query:true. Остальные поля документа читает objects.get.`
        : `Поля каталога: ${listed}; подробнее — schema.get по имени каталога ${catalogId}.`,
      { fields: unknown },
    );
  }
  async get(input: SchemaInput): Promise<SchemaResult> {
    const limit = boundedInteger(input.limit, 80, 1000, "limit");
    const cursor = boundedInteger(input.cursor, 0, Number.MAX_SAFE_INTEGER, "cursor");
    const requestedType = input.type === undefined ? undefined : identifier(input.type, "type");
    let formUrl =
      input.url === undefined
        ? `x-local://wtv/wtv_${requiredString(requestedType, "type")}.xmd`
        : requiredString(input.url, "url");
    const { info, custom, dictionary, notes } = await this.context(input.language);
    try {
      await this.form(formUrl);
    } catch (error) {
      if (input.url !== undefined || requestedType === undefined) throw error;
      const declared = await this.declaredTypes(info);
      const alternative =
        text(declared.find((item) => item.name === requestedType)?.form_url) ||
        text(this.catalogs(info).find((item) => item.id === requestedType)?.form_url);
      if (!alternative || alternative === formUrl) {
        throw this.unknownType(info, requestedType, declared) ?? error;
      }
      formUrl = alternative;
      await this.form(formUrl);
    }
    const samples = new Map<string, Node>();
    const roots = await this.samples(formUrl, samples);
    const candidates = roots.filter(
      (node) => attr(node, "SAMPLE") !== "1" && !/^(USE|INCLUDE|On|DocDesc)/.test(name(node)),
    );
    const root =
      requestedType === undefined
        ? candidates.length === 1
          ? candidates[0]
          : undefined
        : candidates.find((node) => name(node) === requestedType);
    if (!root)
      throw new HcmError(
        "FORM_TYPE_MISMATCH",
        "Тип объекта в форме не определён: запрошенного типа в ней нет, или типов несколько, а type не задан.",
      );
    const type = name(root);
    const catalog = (await this.catalogsOf(info, type))[0];
    const mistaken = this.catalogs(info).find((item) => item.id === requestedType);
    const rows = mistaken ? await this.rowType(mistaken).catch(() => "") : "";
    const byCatalog = !!rows && rows !== requestedType;
    // У строк, которые не документы, нет типа, чтобы спросить о нём взамен: показываются их поля.
    const rowsOnly = byCatalog && !(await this.hasDocuments(info, rows));
    if (byCatalog)
      notes.push(
        rowsOnly
          ? `${requestedType} — каталог без своего типа объекта: документов у его строк нет. Поля строки — под ${rows}; в условиях и fields поиска их пишут без этой приставки.`
          : `${requestedType} — имя каталога; поля его объектов показывает тип ${rows}, поля строки каталога — path:"${rows}".`,
      );
    const query = await this.catalogFields(catalog, type, samples);
    const fields = new Map<string, SchemaField>();
    const methods = new Map<string, { name: string; parameters: string[] }>();
    const baseType = (base: string, stack: string[], inherit = false): Node | undefined => {
      if (stack.includes(base))
        throw new HcmError(
          "FORM_INHERITANCE",
          "Базовые типы формы ссылаются друг на друга по кругу.",
        );
      const sample = samples.get(base);
      if (
        !sample &&
        (inherit || (base && !/^(string|integer|real|bool|date|variant|record|attr)$/.test(base)))
      ) {
        const note = `Базовый тип ${base} не найден: его поля в ответ не попали.`;
        if (!notes.includes(note)) notes.push(note);
      }
      return sample;
    };
    const walk = (nodes: Node[], prefix = "", origin = "own", stack: string[] = []): void => {
      if (stack.length > 64)
        throw new HcmError("FORM_DEPTH_LIMIT", "Наследование в форме глубже 64 уровней.");
      for (const node of nodes) {
        const key = name(node);
        const base = attr(node, "TYPE");
        if (key === "INHERIT") {
          const sample = baseType(base, stack, true);
          if (sample)
            walk(children(sample), prefix, origin === "own" ? `inherited:${base}` : origin, [
              ...stack,
              base,
            ]);
          continue;
        }
        if (!key || /^(On|DocDesc)$|^On/.test(key) || attr(node, "TEMP") === "1") continue;
        const path = prefix ? `${prefix}.${key}` : key;
        const catalogNode = query.get(path);
        const parameters = Object.entries(data(node[":@"]))
          .filter(([key]) => /^@_PARAM__\d+$/.test(key))
          .map(([, value]) => text(value));
        const computed = attr(node, "PROPERTY") === "1";
        if (computed && (parameters.length || (!attr(node, "TITLE") && !catalogNode))) {
          methods.set(path, { name: path, parameters });
          continue;
        }
        const title = this.title(
          attr(node, "TITLE") || (catalogNode ? attr(catalogNode, "TITLE") : ""),
          dictionary,
        );
        const sample = baseType(base, stack);
        const field: SchemaField = {
          path,
          type:
            (sample ? "" : base) ||
            (!children(node).some((child) => name(child)) && catalogNode
              ? attr(catalogNode, "TYPE")
              : "") ||
            "element",
          origin,
        };
        if (title) field.title = title;
        if (attr(node, "FOREIGN-ARRAY")) field.references = attr(node, "FOREIGN-ARRAY");
        if (attr(node, "MULTIPLE") === "1") field.multiple = true;
        if (attr(node, "NOT-NULL") === "1") field.required = true;
        if (attr(node, "PRIMARY-KEY")) field.key = attr(node, "PRIMARY-KEY");
        if (computed) field.computed = true;
        if (catalogNode) field.query = true;
        fields.set(path, field);
        if (sample) {
          walk(children(sample), path, origin === "own" ? `inherited:${base}` : origin, [
            ...stack,
            base,
          ]);
        }
        walk(children(node), path, origin, stack);
      }
    };
    walk(children(root));
    // Поля строки каталога, запрошенного по имени, — то, по чему идёт поиск.
    if (byCatalog)
      for (const key of (await this.catalogFields(mistaken, rows, samples)).keys()) {
        const field = fields.get(`${rows}.${key}`);
        if (field) field.query = true;
      }
    // У строки каталога есть и поля, которых нет у документа; по ним можно искать, но не писать.
    for (const [path, node] of query) {
      if (path.includes(".") || fields.has(path) || methods.has(path)) continue;
      const property = attr(node, "PROPERTY") === "1";
      const title = this.title(attr(node, "TITLE"), dictionary);
      fields.set(path, {
        path,
        type: attr(node, "TYPE") || "string",
        origin: "catalog",
        ...(title ? { title } : {}),
        ...(attr(node, "FOREIGN-ARRAY") ? { references: attr(node, "FOREIGN-ARRAY") } : {}),
        ...(attr(node, "MULTIPLE") === "1" ? { multiple: true } : {}),
        ...(property ? { computed: true } : { query: true }),
      });
    }
    for (const field of fields.values()) {
      const count = [...fields.keys()].filter(
        (path) =>
          path.startsWith(`${field.path}.`) && !path.slice(field.path.length + 1).includes("."),
      ).length;
      if (count) field.children = count;
    }
    const template = data(custom[type]);
    const templateField = text(template.template_field);
    const templates = [template];
    if (templateField) {
      if (input.kind === undefined)
        notes.push(
          `Вид объекта хранится в поле ${templateField}_id: его значение передаётся в kind, чтобы увидеть настраиваемые поля этого вида.`,
        );
      else {
        const kind = list(data(data(custom[templateField]).items).item).find(
          (item) => text(item.id) === input.kind,
        );
        if (kind) templates.push(kind);
        else notes.push(`Вида ${input.kind} нет в списке ${templateField}.`);
      }
    }
    for (const template of templates) {
      const sheets = new Map(
        list(data(template.sheets).sheet).map((sheet) => [text(sheet.id), text(sheet.title)]),
      );
      for (const item of list(data(template.fields).field)) {
        const name = text(item.name);
        if (!name) continue;
        const field: SchemaField = {
          path: `custom_elems.custom_elem[name=${name}].value`,
          name,
          type: text(item.type) || "string",
          origin: "custom",
        };
        const title = this.title(text(item.title), dictionary);
        const values = list(data(item.entries).entry)
          .map((entry) => text(entry.value))
          .filter(Boolean);
        const sheet = sheets.get(text(item.sheet_id));
        if (title) field.title = title;
        if (item.is_required === "1" || item.is_required === "true" || item.is_required === true)
          field.required = true;
        if (text(item.catalog)) field.references = text(item.catalog);
        if (values.length) field.values = values;
        if (sheet) field.sheet = this.title(sheet, dictionary);
        fields.set(field.path, field);
      }
    }
    // Форма такого каталога — один список строк: строка раскрывается сразу, иначе верхний
    // уровень был бы единственным свёрнутым полем.
    const path =
      input.path ?? (rowsOnly && input.search === undefined && fields.has(rows) ? rows : undefined);
    const selected = [...fields.values()].filter(
      (field) =>
        (!input.origin ||
          input.origin.includes(
            field.origin.split(":")[0] as "own" | "inherited" | "custom" | "catalog",
          )) &&
        (path !== undefined
          ? field.path.startsWith(`${path}.`) &&
            (input.deep ||
              input.search !== undefined ||
              !field.path.slice(path.length + 1).includes("."))
          : input.deep ||
            input.search !== undefined ||
            field.origin === "custom" ||
            !field.path.includes(".")) &&
        matches(input.search, [field.path, field.name, field.title, field.references]),
    );
    const element = path === undefined ? undefined : fields.get(path);
    if (path !== undefined && !element)
      notes.push(`Поля ${path} в типе ${type} нет: путь ищет search.`);
    const found = input.include?.includes("methods")
      ? [...methods.values()].filter((method) => matches(input.search, [method.name]))
      : undefined;
    if (input.search !== undefined && !selected.length && !found?.length)
      notes.push(
        nothingFound(
          "в пути, заголовке поля и имени каталога, на который оно ссылается",
          "hire, mail",
          input.search,
          "поле",
        ),
      );
    const result: SchemaResult = {
      type,
      ...(catalog ? { catalog: text(catalog.id) } : {}),
      formUrl,
      ...(element ? { element } : {}),
      fields: [],
      total: selected.length,
      notes,
    };
    if (found) result.methods = found;
    for (const field of selected.slice(cursor, cursor + limit)) {
      result.fields.push(field);
      result.nextCursor = cursor + result.fields.length;
      if (result.nextCursor >= selected.length) delete result.nextCursor;
      // Оставляется место под отметку страницы, обрезанной по размеру.
      if (pageSize(result) > 16 * 1024 - 32) {
        result.fields.pop();
        break;
      }
    }
    if (cursor + result.fields.length < selected.length) {
      result.nextCursor = cursor + result.fields.length;
      if (result.fields.length < limit) result.cutBySize = true;
    } else delete result.nextCursor;
    if (
      pageSize(result) > 16 * 1024 ||
      (!result.fields.length && cursor < selected.length && limit > 0)
    )
      throw new HcmError(
        "SCHEMA_PAGE_LIMIT",
        "Одно поле или методы формы не помещаются на страницу схемы: выборку нужно сузить.",
      );
    return result;
  }
  async types(input: SchemaTypesInput = {}): Promise<SchemaTypesResult> {
    const limit = boundedInteger(input.limit, 50, 1000, "limit");
    const cursor = boundedInteger(input.cursor, 0, Number.MAX_SAFE_INTEGER, "cursor");
    const { info, custom, dictionary } = await this.context();
    const translations = await this.typeTranslations(info);
    const common = await this.commonData(info);
    const definitions = list(data(common.exchange_object_types).exchange_object_type);
    const named = this.catalogs(info).filter((item) => text(item.object_type));
    // Типы, которые сервер объявляет без названия их каталога (event), идут после остальных.
    const unnamed: Data[] = [];
    for (const definition of definitions) {
      const type = text(definition.name);
      if (!type || named.some((item) => item.object_type === type)) continue;
      unnamed.push((await this.catalogsOf(info, type))[0] ?? { object_type: type });
    }
    const types = [...named, ...unnamed]
      .map((catalog) => {
        const type = text(catalog.object_type);
        const definition = definitions.find((item) => item.name === type);
        const title = this.typeTitle(definition ?? {}, dictionary, translations);
        const template = data(custom[type]);
        return {
          type,
          ...(text(catalog.id) ? { catalog: text(catalog.id) } : {}),
          ...(title ? { title } : {}),
          customFields: text(template.template_field)
            ? ("by kind" as const)
            : list(data(template.fields).field).length,
        };
      })
      .filter((item) => matches(input.search, [item.type, item.catalog, item.title]));
    // Имя может принадлежать каталогу, строки которого не объекты: типа для списка у него нет.
    const listed = new Set(types.map((item) => item.catalog));
    const untyped =
      input.search === undefined
        ? []
        : this.catalogs(info)
            .filter((item) => !text(item.object_type))
            .map((item) => text(item.id))
            .filter(
              (id) =>
                !listed.has(id) &&
                (matches(input.search, [id]) ||
                  (types.length <= 20 && types.some((item) => id.startsWith(`${item.type}_`)))),
            )
            .slice(0, 5);
    return {
      types: types.slice(cursor, cursor + limit),
      total: types.length,
      catalogs: this.catalogs(info).length,
      ...(cursor + limit < types.length ? { nextCursor: cursor + limit } : {}),
      ...(input.search !== undefined && (!types.length || untyped.length)
        ? {
            notes: [
              untyped.length
                ? `${types.length ? "Каталоги" : "Типа с таким именем нет; есть каталоги"} без своего типа объекта: ${untyped.join(", ")}. Поля строки показывает схема по имени каталога.`
                : nothingFound(
                    "в имени типа, имени каталога и заголовке",
                    "collab, group",
                    input.search,
                    "типе",
                  ),
            ],
          }
        : {}),
    };
  }
}
