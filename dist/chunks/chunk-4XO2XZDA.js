import { createRequire as __wtctlRequire } from "node:module";
const require = __wtctlRequire(import.meta.url);
import {
  HcmError,
  operationMap,
  operationNotes,
  operationSummary,
  operationTopic,
  unknownOperationHint
} from "./chunk-T672SCY6.js";

// src/frontend-names.ts
var NAMES = {
  "runtime.status": ["hcm_status", "wtctl status"],
  "runtime.check": ["hcm_check", "wtctl check"],
  "runtime.query": ["hcm_query", "wtctl query"],
  "runtime.batch": [void 0, "wtctl run"],
  "server.info": [void 0, "wtctl server info"],
  "schema.types": ["hcm_types", "wtctl types"],
  "schema.get": ["hcm_schema", "wtctl schema"],
  "objects.get": ["hcm_object_get", "wtctl object get"],
  "objects.create": ["hcm_object_create", "wtctl object create"],
  "objects.patch": ["hcm_object_patch", "wtctl object patch"],
  "objects.delete": ["hcm_object_delete", "wtctl object delete"],
  "files.read": [void 0, "wtctl files read"],
  "files.exists": [void 0, "wtctl files exists"],
  "files.list": [void 0, "wtctl files list"],
  "files.write": [void 0, "wtctl files write"],
  "files.delete": [void 0, "wtctl files delete"],
  "web.pages.uploadFile": [void 0, "wtctl files upload"],
  "native.lds.loadDoc": [void 0, "wtctl doc get"],
  "native.lds.putDoc": [void 0, "wtctl doc put"],
  "native.lds.deleteDoc": [void 0, "wtctl doc delete"],
  "rpc.list": [void 0, "wtctl rpc list"],
  "rpc.describe": [void 0, "wtctl rpc describe"],
  "rpc.call": [void 0, "wtctl rpc"],
  "execute.script": ["hcm_script", "wtctl exec"],
  "agents.run": [void 0, "wtctl agent run"],
  "agents.status": [void 0, "wtctl agent status"],
  "agents.cancel": [void 0, "wtctl agent cancel"],
  "logs.list": ["hcm_logs_list", "wtctl logs list"],
  "logs.read": ["hcm_logs_read", "wtctl logs read"],
  "logs.search": ["hcm_logs_search", "wtctl logs search"],
  "logs.follow": ["hcm_logs_follow", "wtctl logs follow"],
  "results.read": ["hcm_result_read", "wtctl result read"],
  "results.export": ["hcm_result_export", "wtctl result export"],
  "web.websocket.heartbeat": [void 0, "wtctl ws heartbeat"],
  "api.list": ["hcm_api_list", "wtctl api list"],
  "api.describe": ["hcm_api_describe", "wtctl api describe"]
};
var PATTERN = new RegExp(
  `(?<![\\w.])(?:${Object.keys(NAMES).map((id) => id.replaceAll(".", "\\.")).join("|")})(?!\\w|\\.\\w)`,
  "g"
);
function name(id, frontend) {
  return Object.hasOwn(NAMES, id) ? NAMES[id]?.[frontend === "mcp" ? 0 : 1] ?? id : id;
}
function renamed(text, frontend) {
  return text.replace(PATTERN, (id) => name(id, frontend));
}
function errorInFrontendTerms(result, frontend) {
  const steps = result.data?.results;
  if (result.meta.operationId === "runtime.batch" && Array.isArray(steps))
    result = {
      ...result,
      data: {
        ...result.data,
        results: steps.map(
          (step) => step && typeof step === "object" && step.meta ? errorInFrontendTerms(step, frontend) : step
        )
      }
    };
  const stored = result.data;
  if (typeof stored?.hint === "string")
    result = {
      ...result,
      data: { ...result.data, hint: renamed(stored.hint, frontend) }
    };
  const error = result.error;
  if (!error) return result;
  const unknown = error.code === "UNKNOWN_OPERATION";
  const asked = error.details?.operationId;
  return {
    ...result,
    error: {
      ...error,
      message: unknown ? error.message : renamed(error.message, frontend),
      ...error.hint === void 0 ? {} : {
        hint: unknown && typeof asked === "string" ? unknownOperationHint(asked, (id) => name(id, frontend)) : renamed(error.hint, frontend)
      }
    }
  };
}

// src/guide-topics.ts
var GUIDE_TOPICS = [
  "start",
  "queries",
  "objects",
  "scripts",
  "logs",
  "files",
  "cli-sdk",
  "errors"
];

// src/guide.ts
function guideTopics() {
  return GUIDE_TOPICS.slice();
}
function connectionNote(settings) {
  if (settings?.environment)
    return [
      "- подключение этого сервера задано переменными окружения в его записи; команде и скрипту они не видны: задай `WTCTL_URL`, `WTCTL_USERNAME`, `WTCTL_PASSWORD` в их оболочке или создай файл подключений командой `config init`"
    ];
  const { configPath, connection } = settings ?? {};
  if (configPath === void 0 && connection === void 0) return [];
  const options = [
    ...configPath === void 0 ? [] : [`--config "${configPath}"`],
    ...connection === void 0 ? [] : [`--connection ${connection}`]
  ].join(" ");
  const fields = [
    ...configPath === void 0 ? [] : [`configPath: ${JSON.stringify(configPath)}`],
    ...connection === void 0 ? [] : [`connection: "${connection}"`]
  ].join(", ");
  return [
    `- подключение: команде добавь \`${options}\`, в скрипте — \`loadConfig({ ${fields} })\``
  ];
}
function movingCopy(script) {
  if (/[\\/]_npx[\\/]/.test(script)) return "кэше npx";
  if (/[\\/]plugins[\\/]cache[\\/]/.test(script)) return "копии плагина";
  return void 0;
}
function onThisComputer(local) {
  const copy = movingCopy(local.script);
  return [
    "## На этом компьютере",
    "",
    `- Node.js: \`${local.node}\``,
    `- файл команды: \`${local.script}\``,
    ...copy ? [
      `- этот путь лежит в ${copy} и меняется при обновлении: для вызовов сейчас годится, в скрипт для регулярного запуска пиши \`npx -y wtctl\`, а SDK ставь в проект: \`npm install wtctl\``
    ] : [],
    "- вызов команды, если `wtctl` нет в `PATH`: Node.js, файл команды, затем аргументы, например `status`",
    ...local.sdk ? [`- SDK: \`import { loadConfig, withHcmClient, unwrap } from "${local.sdk}";\``] : [],
    ...connectionNote(local.settings)
  ].join("\n");
}
async function guide(topic = "start", local) {
  const index = GUIDE_TOPICS.indexOf(topic);
  if (index < 0)
    throw new HcmError(
      "UNKNOWN_GUIDE_TOPIC",
      "В гайде нет такой темы.",
      `Темы: ${GUIDE_TOPICS.join(", ")}.`
    );
  const { GUIDE_PAGES } = await import("./guide-texts-YQN6YVTG.js");
  const page = GUIDE_PAGES[index];
  return local && topic === "cli-sdk" ? { ...page, text: `${page.text}

${onThisComputer(local)}` } : page;
}

// src/operation-help.ts
function concise(value, maximum) {
  const line = value.replace(/\s+/g, " ").trim();
  return line.length <= maximum ? line : line.slice(0, maximum - 1) + "…";
}
function compactOperationPage(page, cursor = 0) {
  const operations = [];
  let used = 512;
  for (const operation of page.operations) {
    const card = {
      id: operation.id,
      topic: operationTopic(operation.id),
      effect: operation.effect,
      description: operationSummary(operation.id) ?? concise(operation.description, 200)
    };
    const bytes = Buffer.byteLength(JSON.stringify(card, null, 2), "utf8") + 64;
    if (operations.length > 0 && used + bytes > 16e3) break;
    operations.push(card);
    used += bytes;
  }
  const bounded = operations.length < page.operations.length;
  const nextCursor = bounded ? cursor + operations.length : page.nextCursor;
  return {
    operations,
    total: page.total,
    ...nextCursor === void 0 ? {} : { nextCursor },
    ...bounded ? { cutBySize: true } : {},
    hint: page.total ? "Аргументы и ограничения одной операции: api.describe по её id." : "Ничего не найдено: query ищет точную подстроку в ID или описании, без разбивки на слова. Карта тем — вызов без аргументов."
  };
}
var PAYLOAD_FORMS = {
  binary: { description: 'Текст строкой или {base64:"…"} для двоичных данных.' },
  xml: { type: "string", description: "Текст XML." },
  "xml-element": { type: "string", description: "Текст XML одного элемента." }
};
function payloadKinds(schema, found = /* @__PURE__ */ new Set()) {
  if (Array.isArray(schema)) for (const item of schema) payloadKinds(item, found);
  else if (schema && typeof schema === "object") {
    const kind = schema["x-normalization"];
    if (typeof kind === "string") found.add(kind.replace(/-box$/, ""));
    for (const child of Object.values(schema)) payloadKinds(child, found);
  }
  return found;
}
function plainSchema(schema) {
  if (Array.isArray(schema)) return schema.map(plainSchema);
  if (!schema || typeof schema !== "object") return schema;
  const node = schema;
  if (Array.isArray(node.anyOf) || node["x-normalization"] !== void 0) {
    const kinds = payloadKinds(node);
    const form = ["binary", "xml", "xml-element"].find((kind) => kinds.has(kind));
    if (form) return PAYLOAD_FORMS[form];
  }
  return Object.fromEntries(Object.entries(node).map(([key, child]) => [key, plainSchema(child)]));
}
function operationHelp(operation) {
  const summary = operationSummary(operation.id);
  const text = operation.description.replace(/\s+/g, " ").trim();
  const details = operationNotes(operation.id) ?? (summary && text !== summary ? text : void 0);
  return {
    id: operation.id,
    topic: operationTopic(operation.id),
    effect: operation.effect,
    description: summary ?? text,
    ...details ? { details } : {},
    inputSchema: plainSchema(operation.inputSchema)
  };
}
function discoverOperations(list, filter) {
  const selective = ["query", "topic", "group", "effect", "cursor"].some(
    (key) => filter[key] !== void 0
  );
  return selective ? compactOperationPage(list(filter), filter.cursor ?? 0) : operationMap();
}

// src/version.ts
var VERSION = "0.8.1";

export {
  errorInFrontendTerms,
  guideTopics,
  guide,
  operationHelp,
  discoverOperations,
  VERSION
};
