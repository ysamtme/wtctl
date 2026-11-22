// Генерирует src/guide-texts.ts из навыка, чтобы MCP-сервер и команда выдавали один и тот же
// текст агенту без установленного навыка. Отдельно записывает список тем. С --check сравнивает оба файла.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { format, resolveConfig } from "prettier";

const root = fileURLToPath(new URL("..", import.meta.url));
const skill = join(root, "skills/wtctl");
const read = (path) => readFileSync(join(skill, path), "utf8").replaceAll("\r\n", "\n");
function replaceOnce(text, from, to) {
  if (text.split(from).length !== 2)
    throw new Error(`В SKILL.md должно быть ровно одно вхождение: ${from}`);
  return text.replace(from, to);
}

const source = read("SKILL.md");
const end = source.indexOf("\n---\n", 4);
if (!source.startsWith("---\n") || end < 0) throw new Error("В SKILL.md нет front matter.");
let start = source.slice(end + 5).trim();

// Таблица ссылок в SKILL.md задаёт темы, их порядок и заголовки.
const topics = [
  ...start.matchAll(/^\| (.+?) \| \[references\/([\w-]+)\.md\]\(references\/\2\.md\) \|$/gm),
].map(([, title, topic]) => ({ topic, title }));
const files = readdirSync(join(skill, "references"))
  .filter((name) => name.endsWith(".md"))
  .map((name) => name.slice(0, -3));
for (const name of files)
  if (!topics.some((item) => item.topic === name))
    throw new Error(`references/${name}.md нет в таблице SKILL.md.`);
if (topics.length !== files.length)
  throw new Error("Таблица в SKILL.md называет файл, которого нет.");

start = replaceOnce(
  start,
  "Читай нужный файл, когда дошёл до такой задачи.",
  'Открой нужную тему, когда дошёл до такой задачи: `hcm_guide {topic:"queries"}`, из командной строки — `wtctl guide queries`.',
);
start = replaceOnce(start, "| Задача | Файл |", "| Задача | Тема |");
start = start.replace(/\[references\/([\w-]+)\.md\]\(references\/\1\.md\)/g, "`$1`");

const pages = [
  { topic: "start", title: "Порядок работы и главные правила", text: start },
  ...topics.map(({ topic, title }) => ({
    topic,
    title,
    text: read(`references/${topic}.md`)
      .trim()
      .replace(/см\. \[([\w-]+)\.md\]\(\1\.md\)/g, "см. тему `$1`"),
  })),
];
for (const page of pages)
  if (/\]\([^)]*\.md[)#]/.test(page.text))
    throw new Error(
      `В теме ${page.topic} осталась ссылка на файл. Ссылка в навыке должна иметь вид «см. [name.md](name.md)».`,
    );

const header =
  "// Сборка из skills/wtctl через scripts/generate-guide.mjs. Для обновления — npm run generate.";
const texts = [
  header,
  "export interface GuidePage {",
  "  readonly topic: string;",
  "  readonly title: string;",
  "  readonly text: string;",
  "}",
  "export const GUIDE_PAGES: readonly GuidePage[] = [",
  ...pages.map(
    (page) =>
      `  { topic: ${JSON.stringify(page.topic)}, title: ${JSON.stringify(page.title)}, text: ${JSON.stringify(page.text)} },`,
  ),
  "];",
  "",
].join("\n");
const topicsFile = "src/guide-topics.ts";
const filepath = join(root, topicsFile);
const topicList = await format(
  `${header}\nexport const GUIDE_TOPICS: readonly string[] = ${JSON.stringify(pages.map((page) => page.topic))};`,
  { ...(await resolveConfig(filepath)), filepath },
);

const check = process.argv.includes("--check");
for (const [path, generated] of [
  ["src/guide-texts.ts", texts],
  [topicsFile, topicList],
]) {
  const target = join(root, path);
  if (check) {
    if (
      !existsSync(target) ||
      readFileSync(target, "utf8").replaceAll("\r\n", "\n") !== generated
    ) {
      console.error(`${path} не совпадает с навыком. Выполнить npm run generate.`);
      process.exitCode = 1;
    }
  } else {
    writeFileSync(target, generated);
    console.log(`${path} — тем: ${pages.length}, размер: ${Buffer.byteLength(generated)} Б.`);
  }
}
if (check && !process.exitCode)
  console.log(`Тексты гайда совпадают с навыком: тем — ${pages.length}.`);
