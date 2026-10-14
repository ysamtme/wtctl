// Собирает docs/sdk-reference.md из описаний в типах точки входа wtctl: тот же текст, что подсказка
// редактора. С --check только сравнивает и проверяет, что у каждого открытого имени есть описание.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("..", import.meta.url));
const target = join(root, "docs/sdk-reference.md");
const entry = join(root, "src/index.ts");
const config = ts.parseJsonConfigFileContent(
  ts.readConfigFile(join(root, "tsconfig.json"), ts.sys.readFile).config,
  ts.sys,
  root,
);
const program = ts.createProgram([entry], { ...config.options, noEmit: true });
const checker = program.getTypeChecker();
const missing = [];

const internal = (item) => item.getJsDocTags(checker).some((tag) => tag.name === "internal");
const text = (parts) => ts.displayPartsToString(parts).replace(/\r\n/g, "\n").trim();
// Описание как текст Markdown: <type> в адресах и * в WTCTL_* иначе пропадут на GitHub.
function describe(item, name) {
  const doc = text(item.getDocumentationComment(checker));
  if (!doc) missing.push(name);
  return doc.replace(/</g, "&lt;").replace(/\*/g, "\\*");
}
const cell = (value) => value.replace(/\|/g, "\\|").replace(/\n+/g, " ");
const code = (value) => "`" + cell(value.replace(/\s+/g, " ").trim()) + "`";
const anchor = (name) => "#" + name.toLowerCase().replace(/[^\p{L}\p{N}_-]/gu, "");
// Имена открытых типов в сигнатуре — ссылки на их разделы ниже. HcmResult и HcmData названы
// во вступлении страницы, а не у каждого метода.
const links = (value, owner) =>
  [...new Set(value.match(/\b[A-Z]\w+\b/g) ?? [])]
    .filter((name) => types.has(name) && !["HcmResult", "HcmData", owner].includes(name))
    .map((name) => `[${name}](${anchor(name)})`)
    .join(", ");

// Поле объявлено в библиотеке TypeScript (message у Error): своего описания у него нет.
const fromLibrary = (symbol) =>
  symbol.declarations?.every((item) => program.isSourceFileDefaultLibrary(item.getSourceFile()));
const isNever = (node) => node?.type?.kind === ts.SyntaxKind.NeverKeyword;

// Строки таблицы полей: тип — как записан в исходнике, вложенные объекты раскрыты через точку.
function fieldRows(symbols, owner, prefix = "") {
  const rows = [];
  for (const symbol of symbols) {
    const node = symbol.valueDeclaration ?? symbol.declarations?.[0];
    if (internal(symbol) || isNever(node) || fromLibrary(symbol)) continue;
    if (node && ts.getCombinedModifierFlags(node) & ts.ModifierFlags.NonPublicAccessibilityModifier)
      continue;
    const optional = symbol.flags & ts.SymbolFlags.Optional ? "?" : "";
    const name = `${prefix}${symbol.name}${optional}`;
    const literals = [];
    const shown = node?.type
      ? collapse(node.type, literals)
      : checker.typeToString(checker.getTypeOfSymbol(symbol), undefined, signatureFlags);
    rows.push({ name, type: shown, doc: describe(symbol, `${owner}.${prefix}${symbol.name}`) });
    const nested = `${prefix}${symbol.name}${shown.endsWith("[]") ? "[]" : ""}.`;
    rows.push(...literals.flatMap((literal) => literalRows(literal, owner, nested)));
  }
  return rows;
}
const literalRows = (literal, owner, prefix) =>
  fieldRows(
    literal.members
      .map((member) => member.name && checker.getSymbolAtLocation(member.name))
      .filter(Boolean),
    owner,
    prefix,
  );
// Текст типа, где каждый объектный литерал заменён на {…}; сами литералы — в literals.
function collapse(node, literals) {
  const source = node.getSourceFile().text;
  let result = "";
  let position = node.getStart();
  const visit = (child) => {
    if (ts.isTypeLiteralNode(child)) {
      result += source.slice(position, child.getStart()) + "{…}";
      position = child.getEnd();
      literals.push(child);
    } else ts.forEachChild(child, visit);
  };
  visit(node);
  return (result + source.slice(position, node.getEnd()))
    .replace(/\s+/g, " ")
    .replace(/(^|[(<]) ?\| /g, "$1")
    .trim();
}
function fieldTable(rows) {
  if (!rows.length) return [];
  return [
    "| Поле | Тип | Описание |",
    "| --- | --- | --- |",
    ...rows.map((row) => `| ${code(row.name)} | ${code(row.type)} | ${cell(row.doc)} |`),
    "",
  ];
}

const signatureFlags =
  ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope;
function signature(name, item, owner) {
  const shown =
    name +
    checker
      .signatureToString(item, undefined, signatureFlags)
      .replace(/(\?: (?:[^,()<>]|<[^<>]*>)+) \| undefined\b/g, "$1");
  const lines = ["```ts", shown, "```", "", describe(item, owner), ""];
  // Аргумент-литерал (execute) описан полями здесь же: отдельного типа у него нет.
  for (const parameter of item.getParameters()) {
    const literals = [];
    const node = parameter.valueDeclaration;
    if (node?.type) collapse(node.type, literals);
    for (const literal of literals)
      lines.push(...fieldTable(literalRows(literal, owner, `${parameter.name}.`)));
  }
  const related = links(shown, owner);
  if (related) lines.push(`Типы: ${related}.`, "");
  return lines;
}
function callable(name, symbol, owner = name) {
  const type = checker.getTypeOfSymbol(symbol);
  return checker
    .getSignaturesOfType(type, ts.SignatureKind.Call)
    .filter((item) => !internal(item))
    .flatMap((item) => signature(name, item, owner));
}

const exported = checker
  .getExportsOfModule(checker.getSymbolAtLocation(program.getSourceFile(entry)))
  .map((symbol) => ({
    name: symbol.name,
    symbol: symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol,
  }))
  .sort((a, b) => a.name.localeCompare(b.name, "en"));
const kind = (flag) => exported.filter(({ symbol }) => symbol.flags & flag);
const functions = kind(ts.SymbolFlags.Function);
const classes = kind(ts.SymbolFlags.Class);
const typeItems = exported.filter(
  ({ symbol }) => symbol.flags & (ts.SymbolFlags.Interface | ts.SymbolFlags.TypeAlias),
);
const types = new Set([...typeItems, ...classes].map(({ name }) => name));
const unsupported = (name, why) => {
  throw new Error(`Справочник не умеет показывать ${name}: ${why}.`);
};
for (const { name, symbol } of exported)
  if (![...functions, ...classes, ...typeItems].some((item) => item.symbol === symbol))
    unsupported(name, "это не функция, класс или тип");
// Имя с параметрами-типами, как в объявлении: HcmCleanupError<T = unknown>.
const generic = (name, declaration) => {
  const parameters = declaration.typeParameters?.map((item) => item.getText()).join(", ");
  return parameters ? `${name}<${parameters}>` : undefined;
};

function classSection({ name, symbol }) {
  const lines = [`### ${name}`, "", describe(symbol, name), ""];
  const title = generic(name, symbol.valueDeclaration);
  if (title) lines.push("```ts", `class ${title}`, "```", "");
  for (const member of checker.getPropertiesOfType(checker.getTypeOfSymbol(symbol)))
    if (
      member.declarations?.some((item) => item.parent === symbol.valueDeclaration) &&
      !internal(member)
    )
      unsupported(`${name}.${member.name}`, "статическое поле или метод");
  const instance = checker.getDeclaredTypeOfSymbol(symbol);
  const base = instance.getBaseTypes()?.[0];
  if (base && types.has(base.symbol.name))
    lines.push(`Наследует [${base.symbol.name}](${anchor(base.symbol.name)}).`, "");
  // Свои поля и методы класса, в том числе поля из параметров конструктора (code у HcmError).
  const own = (member) =>
    member.declarations?.some(
      (item) =>
        (ts.isParameter(item) ? item.parent.parent : item.parent) === symbol.valueDeclaration,
    );
  const members = checker.getPropertiesOfType(instance).filter(own);
  const methods = members.filter((member) => member.flags & ts.SymbolFlags.Method);
  lines.push(
    ...fieldTable(
      fieldRows(
        members.filter((member) => !(member.flags & ts.SymbolFlags.Method)),
        name,
      ),
    ),
  );
  if (name === "HcmClient") {
    const constructors = checker
      .getSignaturesOfType(checker.getTypeOfSymbol(symbol), ts.SignatureKind.Construct)
      .filter((item) => !internal(item));
    for (const item of constructors) lines.push(...signature("new HcmClient", item, name));
  }
  for (const method of methods) {
    if (internal(method)) continue;
    const prefix = name === "HcmClient" ? "client" : "error";
    lines.push(
      `#### ${prefix}.${method.name}`,
      "",
      ...callable(`${prefix}.${method.name}`, method, `${name}.${method.name}`),
    );
  }
  return lines;
}

function typeSection({ name, symbol }) {
  const lines = [`### ${name}`, "", describe(symbol, name), ""];
  const declaration = symbol.declarations[0];
  const title = generic(name, declaration);
  const type = checker.getDeclaredTypeOfSymbol(symbol);
  if (ts.isInterfaceDeclaration(declaration) && type.getProperties().length === 0)
    unsupported(name, "у интерфейса нет полей");
  const variants = type.isUnion() ? type.types : [type];
  const objects = variants.every(
    (item) =>
      item.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection) && !checker.isArrayType(item),
  );
  if (!objects || (ts.isTypeAliasDeclaration(declaration) && type.getProperties().length === 0)) {
    lines.push("```ts", `type ${title ?? name} = ${collapse(declaration.type, [])}`, "```", "");
    const related = links(declaration.type.getText(), name);
    if (related) lines.push(`Типы: ${related}.`, "");
    return lines;
  }
  if (title) lines.push("```ts", title, "```", "");
  variants.forEach((variant, index) => {
    if (variants.length > 1) lines.push(`Вариант ${index + 1}:`, "");
    lines.push(...fieldTable(fieldRows(checker.getPropertiesOfType(variant), name)));
  });
  return lines;
}

const page = [
  "<!-- Собрано scripts/generate-sdk-reference.mjs из описаний в типах; править описания в src и выполнить npm run generate. -->",
  "",
  "# Справочник SDK",
  "",
  "Всё, что экспортирует `wtctl`: функции, методы `HcmClient`, ошибки и типы аргументов и ответов. Текст тот же, что в подсказке редактора. Как пользоваться SDK — в [sdk.md](sdk.md).",
  "",
  "Методы `HcmClient` возвращают [HcmResult](#hcmresult): в таблицах ответа описано его поле `data`. Поля объекта или строки каталога без своего типа — [HcmData](#hcmdata). Знак `?` после имени поля — поле может отсутствовать.",
  "",
  "## Функции",
  "",
  ...functions.flatMap(({ name, symbol }) => [`### ${name}`, "", ...callable(name, symbol)]),
  "## Клиент",
  "",
  ...classes.filter(({ name }) => name === "HcmClient").flatMap(classSection),
  "## Ошибки",
  "",
  ...classes.filter(({ name }) => name !== "HcmClient").flatMap(classSection),
  "## Типы",
  "",
  ...typeItems.flatMap(typeSection),
]
  .join("\n")
  .replace(/\n{3,}/g, "\n\n")
  .trimEnd()
  .concat("\n");

if (missing.length) {
  console.error(`Нет описания в типах точки входа wtctl: ${[...new Set(missing)].join(", ")}.`);
  process.exit(1);
}
if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(target, "utf8").replaceAll("\r\n", "\n");
  } catch {}
  if (current !== page) {
    console.error(
      "docs/sdk-reference.md не совпадает с описаниями в типах: выполнить npm run generate.",
    );
    process.exit(1);
  }
  console.log(`Справочник SDK совпадает с описаниями в типах: имён — ${exported.length}.`);
} else {
  writeFileSync(target, page);
  console.log(
    `docs/sdk-reference.md: имён — ${exported.length}, ${Math.round(page.length / 1024)} КБ.`,
  );
}
