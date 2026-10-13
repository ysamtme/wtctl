import { HcmError } from "./errors.js";
import { GUIDE_PAGES, type GuidePage } from "./guide-texts.js";

export type { GuidePage };

/** Как запущена эта же программа: позволяет гайду назвать команду и SDK, которые работают здесь. */
export interface LocalInstall {
  /** Исполняемый файл Node.js. */
  readonly node: string;
  /** Файл скрипта команды. */
  readonly script: string;
  /** Адрес импорта SDK, лежащего рядом со скриптом, если он там есть. */
  readonly sdk?: string;
  /** Откуда этот процесс взял подключение, если не из файла по умолчанию. */
  readonly settings?: {
    /** Файл подключений, названный через --config или WTCTL_CONFIG. */
    readonly configPath?: string;
    /** Подключение, названное через --connection или WTCTL_CONNECTION. */
    readonly connection?: string;
    /** Подключение собрано из переменных WTCTL_* этого процесса. */
    readonly environment?: boolean;
  };
}

/** Темы встроенного гайда; первая — обзор. */
export function guideTopics(): readonly string[] {
  return GUIDE_PAGES.map((page) => page.topic);
}

/** Как команда и программа доходят до подключения, с которым работает этот процесс. */
function connectionNote(settings: LocalInstall["settings"]): string[] {
  if (settings?.environment)
    return [
      "- подключение этого сервера задано переменными окружения в его записи; команде и скрипту они не видны: задай `WTCTL_URL`, `WTCTL_USERNAME`, `WTCTL_PASSWORD` в их оболочке или создай файл подключений командой `config init`",
    ];
  const { configPath, connection } = settings ?? {};
  if (configPath === undefined && connection === undefined) return [];
  const options = [
    ...(configPath === undefined ? [] : [`--config "${configPath}"`]),
    ...(connection === undefined ? [] : [`--connection ${connection}`]),
  ].join(" ");
  const fields = [
    ...(configPath === undefined ? [] : [`configPath: ${JSON.stringify(configPath)}`]),
    ...(connection === undefined ? [] : [`connection: "${connection}"`]),
  ].join(", ");
  return [
    `- подключение: команде добавь \`${options}\`, в скрипте — \`loadConfig({ ${fields} })\``,
  ];
}

/** Копия, которую держит npx или хост плагина: её путь заменит следующее обновление. */
function movingCopy(script: string): string | undefined {
  if (/[\\/]_npx[\\/]/.test(script)) return "кэше npx";
  if (/[\\/]plugins[\\/]cache[\\/]/.test(script)) return "копии плагина";
  return undefined;
}

function onThisComputer(local: LocalInstall): string {
  const copy = movingCopy(local.script);
  return [
    "## На этом компьютере",
    "",
    `- Node.js: \`${local.node}\``,
    `- файл команды: \`${local.script}\``,
    ...(copy
      ? [
          `- этот путь лежит в ${copy} и меняется при обновлении: для вызовов сейчас годится, в скрипт для регулярного запуска пиши \`npx -y wtctl\`, а SDK ставь в проект: \`npm install wtctl\``,
        ]
      : []),
    "- вызов команды, если `wtctl` нет в `PATH`: Node.js, файл команды, затем аргументы, например `status`",
    ...(local.sdk
      ? [`- SDK: \`import { loadConfig, withHcmClient, unwrap } from "${local.sdk}";\``]
      : []),
    ...connectionNote(local.settings),
  ].join("\n");
}

/** Одна страница гайда: тот же текст, что в навыке, без установленного навыка. */
export function guide(topic = "start", local?: LocalInstall): GuidePage {
  const page = GUIDE_PAGES.find((item) => item.topic === topic);
  if (!page)
    throw new HcmError(
      "UNKNOWN_GUIDE_TOPIC",
      "В гайде нет такой темы.",
      `Темы: ${guideTopics().join(", ")}.`,
    );
  return local && topic === "cli-sdk"
    ? { ...page, text: `${page.text}\n\n${onThisComputer(local)}` }
    : page;
}
