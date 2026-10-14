import type { OperationDefinition, OperationFilter, OperationPage } from "./contracts.js";
import {
  operationMap,
  operationNotes,
  operationSummary,
  operationTopic,
  type OperationMap,
} from "./operation-map.js";

export interface OperationCard {
  readonly id: string;
  readonly topic: string;
  readonly effect: OperationDefinition["effect"];
  readonly description: string;
}
export interface CompactOperationPage {
  readonly operations: OperationCard[];
  readonly total: number;
  readonly nextCursor?: number;
  readonly cutBySize?: true;
  readonly hint: string;
}
function concise(value: string, maximum: number): string {
  const line = value.replace(/\s+/g, " ").trim();
  return line.length <= maximum ? line : line.slice(0, maximum - 1) + "…";
}
/** Обзор остаётся небольшим; точные контракты даёт явный api describe. */
export function compactOperationPage(page: OperationPage, cursor = 0): CompactOperationPage {
  const operations: OperationCard[] = [];
  let used = 512;
  for (const operation of page.operations) {
    const card: OperationCard = {
      id: operation.id,
      topic: operationTopic(operation.id),
      effect: operation.effect,
      description: operationSummary(operation.id) ?? concise(operation.description, 200),
    };
    // Запас на отступы и запятые для CLI с форматированным JSON, а также для компактного JSON MCP.
    const bytes = Buffer.byteLength(JSON.stringify(card, null, 2), "utf8") + 64;
    if (operations.length > 0 && used + bytes > 16_000) break;
    operations.push(card);
    used += bytes;
  }
  const bounded = operations.length < page.operations.length;
  const nextCursor = bounded ? cursor + operations.length : page.nextCursor;
  return {
    operations,
    total: page.total,
    ...(nextCursor === undefined ? {} : { nextCursor }),
    ...(bounded ? { cutBySize: true as const } : {}),
    hint: page.total
      ? "Аргументы и ограничения одной операции: describe по её id."
      : "Ничего не найдено: query — часть ID операции или слово из её описания, а не фраза. Карта тем — вызов без аргументов.",
  };
}

export interface OperationHelp extends OperationCard {
  /** То, что строка обзора опускает: заметка определения, а без неё — описание реестра. */
  readonly details?: string;
  readonly inputSchema: Record<string, unknown>;
}
const PAYLOAD_FORMS: Readonly<Record<string, Record<string, unknown>>> = {
  binary: { description: 'Текст строкой или {base64:"…"} для двоичных данных.' },
  xml: { type: "string", description: "Текст XML." },
  "xml-element": { type: "string", description: "Текст XML одного элемента." },
};
function payloadKinds(schema: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(schema)) for (const item of schema) payloadKinds(item, found);
  else if (schema && typeof schema === "object") {
    const kind = (schema as Record<string, unknown>)["x-normalization"];
    if (typeof kind === "string") found.add(kind.replace(/-box$/, ""));
    for (const child of Object.values(schema)) payloadKinds(child, found);
  }
  return found;
}
/** Варианты, различающиеся только способом передачи payload, сводятся в одну строку для вызова. */
function plainSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(plainSchema);
  if (!schema || typeof schema !== "object") return schema;
  const node = schema as Record<string, unknown>;
  if (Array.isArray(node.anyOf) || node["x-normalization"] !== undefined) {
    const kinds = payloadKinds(node);
    const form = ["binary", "xml", "xml-element"].find((kind) => kinds.has(kind));
    if (form) return PAYLOAD_FORMS[form];
  }
  return Object.fromEntries(Object.entries(node).map(([key, child]) => [key, plainSchema(child)]));
}
/** Что нужно вызывающему для вызова одной операции; учёт реестра опущен. */
export function operationHelp(operation: OperationDefinition): OperationHelp {
  const summary = operationSummary(operation.id);
  const text = operation.description.replace(/\s+/g, " ").trim();
  const details = operationNotes(operation.id) ?? (summary && text !== summary ? text : undefined);
  return {
    id: operation.id,
    topic: operationTopic(operation.id),
    effect: operation.effect,
    description: summary ?? text,
    ...(details ? { details } : {}),
    inputSchema: plainSchema(operation.inputSchema) as Record<string, unknown>,
  };
}

/** Без выбора — фиксированный обзор по задачам, а не первая страница из 128 карточек. */
export function discoverOperations(
  list: (filter: OperationFilter) => OperationPage,
  filter: OperationFilter,
): OperationMap | CompactOperationPage {
  const selective = (["query", "topic", "group", "effect", "cursor"] as const).some(
    (key) => filter[key] !== undefined,
  );
  return selective ? compactOperationPage(list(filter), filter.cursor ?? 0) : operationMap();
}
