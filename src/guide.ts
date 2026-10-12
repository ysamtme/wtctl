import { HcmError } from "./errors.js";
import { GUIDE_PAGES, type GuidePage } from "./guide-texts.js";

export type { GuidePage };

/** How this very program was started: lets the guide name a command and an SDK that work here. */
export interface LocalInstall {
  /** Node.js executable. */
  readonly node: string;
  /** The command's script file. */
  readonly script: string;
  /** Import address of the SDK that lies next to the script, when it does. */
  readonly sdk?: string;
  /** Where this process took its connection from, when that is not the default file. */
  readonly settings?: {
    /** A connections file named by --config or WTCTL_CONFIG. */
    readonly configPath?: string;
    /** A connection named by --connection or WTCTL_CONNECTION. */
    readonly connection?: string;
    /** The connection is made of WTCTL_* variables of this process. */
    readonly environment?: boolean;
  };
}

/** Topics of the built-in guide; the first one is the overview. */
export function guideTopics(): readonly string[] {
  return GUIDE_PAGES.map((page) => page.topic);
}

/** How the command and a program reach the connection this process works with. */
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

/** A copy kept by npx or by a plugin host: its path is replaced by the next update. */
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

/** One page of the guide: the same text the skill carries, served without a skill installed. */
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
