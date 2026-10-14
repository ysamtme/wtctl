// Генерирует статические замыкания из объявлений слоя протокола, без рефлексии методов в runtime.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const require = createRequire(import.meta.url);
const ts = require(process.env.WTCTL_TYPESCRIPT_PATH ?? "typescript");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const protocol = path.join(root, "src/protocol");
const files = ["api.ts", "client.ts", "types.ts", "physical-documents.ts"];
const declarations = new Map();
for (const name of files) {
  const text = readFileSync(path.join(protocol, name), "utf8");
  const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
  for (const node of source.statements)
    if (node.name) declarations.set(node.name.getText(source), { node, source });
}
const string = { type: "string" };
const binary = {
  type: "object",
  properties: { base64: string },
  required: ["base64"],
  additionalProperties: false,
  "x-normalization": "binary",
};
const xml = {
  anyOf: [
    { type: "string", "x-normalization": "xml" },
    {
      type: "object",
      properties: { xml: string },
      required: ["xml"],
      additionalProperties: false,
      "x-normalization": "xml-box",
    },
  ],
};
function schema(node, seen = new Set()) {
  if (!node) return {};
  if (node.kind === ts.SyntaxKind.StringKeyword) return string;
  if (node.kind === ts.SyntaxKind.BooleanKeyword) return { type: "boolean" };
  if (node.kind === ts.SyntaxKind.NumberKeyword) return { type: "number" };
  if (ts.isLiteralTypeNode(node)) {
    if (node.literal.kind === ts.SyntaxKind.TrueKeyword) return { const: true, type: "boolean" };
    if (node.literal.kind === ts.SyntaxKind.NullKeyword) return { type: "null" };
    return { const: node.literal.text };
  }
  if (ts.isArrayTypeNode(node)) return { type: "array", items: schema(node.elementType, seen) };
  if (ts.isTypeOperatorNode(node)) return schema(node.type, seen);
  if (ts.isUnionTypeNode(node)) {
    const options = node.types
      .filter((t) => t.kind !== ts.SyntaxKind.UndefinedKeyword)
      .map((t) => schema(t, seen));
    return options.length === 1 ? options[0] : { anyOf: options };
  }
  if (ts.isIntersectionTypeNode(node)) return schema(node.types[0], seen);
  if (ts.isTypeLiteralNode(node)) return objectSchema(node.members, seen);
  if (ts.isTypeReferenceNode(node)) {
    const name = node.typeName.getText();
    if (name === "RawXml") return xml;
    if (name === "RpcArgument")
      return {
        anyOf: [
          {
            type: "object",
            properties: {
              valueType: { type: "string", minLength: 1 },
              lexicalValue: { anyOf: [string, xml] },
            },
            required: ["valueType", "lexicalValue"],
            additionalProperties: false,
          },
          {
            type: "object",
            properties: {
              lexicalValue: {
                anyOf: [
                  { type: "string", "x-normalization": "xml-element" },
                  {
                    type: "object",
                    properties: { xml: string },
                    required: ["xml"],
                    additionalProperties: false,
                    "x-normalization": "xml-element-box",
                  },
                ],
              },
            },
            required: ["lexicalValue"],
            additionalProperties: false,
          },
        ],
      };
    if (["DecimalId", "TrackingId"].includes(name))
      return {
        type: "string",
        pattern: name === "DecimalId" ? "^\\d+$" : "^(?:\\d+|0x[0-9a-fA-F]+)$",
      };
    if (name === "Uint8Array" || name === "ArrayBuffer" || name === "BodyInit")
      return { anyOf: [string, binary] };
    if (name === "HeadersInit") return { type: "object", additionalProperties: string };
    if (name === "Readonly" && node.typeArguments?.[0]) return schema(node.typeArguments[0], seen);
    if (name === "QueryValues")
      return {
        type: "object",
        additionalProperties: {
          anyOf: [string, { type: "number" }, { type: "boolean" }, { type: "null" }],
        },
      };
    if (name === "Record") return { type: "object", additionalProperties: true };
    if ((name === "Array" || name === "ReadonlyArray") && node.typeArguments?.[0])
      return { type: "array", items: schema(node.typeArguments[0], seen) };
    if (seen.has(name)) return {};
    const decl = declarations.get(name)?.node;
    const next = new Set([...seen, name]);
    if (decl && ts.isInterfaceDeclaration(decl)) return objectSchema(decl.members, next);
    if (decl && ts.isTypeAliasDeclaration(decl)) return schema(decl.type, next);
  }
  return {};
}
function objectSchema(members, seen) {
  const properties = {};
  const required = [];
  for (const member of members) {
    if (!ts.isPropertySignature(member)) continue;
    const name = member.name.getText().replace(/^['"]|['"]$/g, "");
    properties[name] = schema(member.type, seen);
    if (!member.questionToken) required.push(name);
  }
  return { type: "object", properties, required, additionalProperties: false };
}
function methods(className) {
  const decl = declarations.get(className);
  const result = new Map();
  const base = decl.node.heritageClauses?.flatMap((h) => h.types)[0]?.expression.getText();
  if (base && declarations.has(base)) for (const item of methods(base)) result.set(item.name, item);
  for (const node of decl.node.members) {
    if (
      !ts.isMethodDeclaration(node) ||
      !ts.isIdentifier(node.name) ||
      node.modifiers?.some((m) =>
        [
          ts.SyntaxKind.PrivateKeyword,
          ts.SyntaxKind.ProtectedKeyword,
          ts.SyntaxKind.StaticKeyword,
        ].includes(m.kind),
      )
    )
      continue;
    const name = node.name.getText();
    const parameter = node.parameters.find((p) => p.name.getText() !== "options");
    const docs = ts
      .getJSDocCommentsAndTags(node)
      .map((x) => (typeof x.comment === "string" ? x.comment : ""))
      .filter(Boolean)
      .join(" ");
    // JSDoc перегруженного метода стоит на первой сигнатуре, а последней разбирается реализация.
    result.set(name, { name, parameter, docs: docs || result.get(name)?.docs });
  }
  return [...result.values()];
}
const surfaces = [
  ["native", "lds", "NativeLdsApi", "lds"],
  ["web", "lds", "WebLdsApi", "lds"],
  ["native", "rpc", "RpcApi", "rpc"],
  ["web", "rpc", "RpcApi", "rpc"],
  ["web", "spxml", "WebSpXmlApi", "spxml"],
  ["native", "spxml2", "NativeSpXml2Api", "spxml2"],
  ["web", "spxml2", "WebSpXml2Api", "spxml2"],
  ["web", "pages", "WebPageApi", "pages"],
  ["native", "resources", "ResourceApi", "resources"],
  ["web", "resources", "ResourceApi", "resources"],
  ["anonymous", "diagnostics", "DiagnosticsApi", "diagnostics"],
  ["anonymous", "experimental", "ExperimentalApi", "experimental"],
  ["native", "experimental", "NativeExperimentalApi", "experimental"],
  ["web", "experimental", "WebExperimentalApi", "experimental"],
  ["web", "lifecycle", "WebLifecycleApi", "lifecycle"],
];
const ids = [];
let source = "// Generated by scripts/generate-native-registry.mjs. Do not edit.\n";
source +=
  'import type { NativeOperation } from "../contracts.js";\nimport { prepare } from "./validation.js";\nimport type { NativeGateway } from "./gateway.js";\nimport { decorateOperation } from "./metadata.js";\n';
source +=
  "export interface NativeEntry { operation: NativeOperation; invoke: (gateway: NativeGateway, args: Record<string, unknown>) => Promise<unknown>; }\nexport const NATIVE_ENTRIES: readonly NativeEntry[] = [\n";
for (const [profile, group, klass, member] of surfaces)
  for (const method of methods(klass)) {
    if (method.name === "closeSession") continue; // закрытие — *.session.close в gateway.ts
    if (group === "diagnostics" && method.name === "portal") continue; // определён в gateway.ts
    if (!method.docs)
      throw new Error(
        `У метода ${klass}.${method.name} нет JSDoc: из него берётся описание операции.`,
      );
    const p = method.parameter;
    const pname = p?.name.getText();
    let input = p
      ? schema(p.type)
      : { type: "object", properties: {}, required: [], additionalProperties: false };
    const direct = input.type === "object" || (p && ["request"].includes(pname));
    if (p && !direct)
      input = {
        type: "object",
        properties: { [pname]: input },
        required: p.questionToken || p.initializer ? [] : [pname],
        additionalProperties: false,
      };
    if (method.name === "putDoc" && group.includes("spxml") && input.properties)
      input.properties.document = xml;
    if (["call", "callMethod", "callMethodAsync"].includes(method.name) && input.properties?.target)
      input.properties.target = {
        type: "string",
        pattern: "^[A-Za-z_][A-Za-z0-9_]*\\.[A-Za-z_][A-Za-z0-9_]*$",
      };
    if (profile === "web" && group === "lds" && method.name === "xQuery" && input.properties)
      delete input.properties.expectToReadAll;
    if (method.name === "xQuery" && group === "lds" && input.properties)
      for (const field of ["startPos", "maxCount"])
        input.properties[field] = {
          type: "integer",
          minimum: Number.MIN_SAFE_INTEGER,
          maximum: Number.MAX_SAFE_INTEGER,
        };
    if (
      ["uploadFile", "uploadChunk"].includes(method.name) &&
      group === "pages" &&
      input.properties
    ) {
      input.properties.filename = {
        type: "string",
        minLength: 1,
        maxLength: 255,
        pattern: "^(?!\\.\\.)(?!.*\\.\\.$)(?!\\.$)[^\\\\/\\x00-\\x1F\\x7F]+$",
      };
      input.properties.contentType = {
        type: "string",
        minLength: 1,
        maxLength: 256,
        pattern: "^[\\x20-\\x7E]+$",
      };
    }
    if (
      ["uploadChunk", "clearUploadChunks"].includes(method.name) &&
      group === "pages" &&
      input.properties
    ) {
      input.properties.fileId = {
        type: "string",
        minLength: 32,
        maxLength: 32,
        pattern: "^[0-9a-fA-F]{32}$",
      };
      input.properties.chunksTotal = { type: "integer", minimum: 1, maximum: 100000 };
      if (method.name === "uploadChunk") {
        input.properties.index = { type: "integer", minimum: 0, maximum: 99999 };
        input.properties.totalBytes = {
          type: "integer",
          minimum: 1,
          maximum: Number.MAX_SAFE_INTEGER,
        };
        input.properties.offset = { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
      }
    }
    const op = {
      id: `${profile}.${group}.${method.name}`,
      profile,
      group,
      method: method.name,
      title: `${profile} ${group} ${method.name}`,
      description: method.docs,
      inputSchema: input,
    };
    ids.push(op.id);
    const argument = !p
      ? ""
      : `prepare(args, ${JSON.stringify(input)})${direct ? "" : `[${JSON.stringify(pname)}]`} as never`;
    const context = profile === "anonymous" ? "gateway.client" : `(await gateway.${profile}())`;
    source += `  { operation: decorateOperation(${JSON.stringify(op)}), invoke: async (gateway, args) => ${context}.${member}.${method.name}(${argument}) },\n`;
  }
source += "];\n";
source += `export type GeneratedNativeId =\n${ids.map((id) => `  | ${JSON.stringify(id)}\n`).join("")};\n`;
const target = path.join(root, "src/native/generated.ts");
const count = source.split("operation: decorateOperation(").length - 1;
if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(target, "utf8").replaceAll("\r\n", "\n");
  } catch {}
  if (current !== source) {
    console.error(
      "src/native/generated.ts не совпадает со слоем протокола: выполнить node scripts/generate-native-registry.mjs.",
    );
    process.exit(1);
  }
  console.log(`Реестр низкоуровневых операций совпадает со слоем протокола: операций — ${count}.`);
} else {
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, source);
  console.log(`Сгенерировано явных замыканий операций: ${count}.`);
}
