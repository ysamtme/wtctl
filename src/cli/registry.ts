import { guideTopics } from "../guide.js";

export type OptionType = "boolean" | "string";

export interface OptionSpec {
  readonly name: string;
  readonly short?: string;
  readonly type: OptionType;
  readonly repeatable?: boolean;
  /** Локальный флаг подкоманды с тем же именем, что глобальный (например --format у result read/export). */
  readonly overridesGlobal?: true;
  /** Допускает пустую строку в качестве значения (`--role=` или `--role ""`). */
  readonly allowEmpty?: true;
  readonly valueLabel?: string;
  readonly values?: readonly string[];
  readonly description: string;
}

export interface SubcommandSpec {
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly summary: string;
  readonly usage: readonly string[];
  readonly options?: readonly OptionSpec[];
  readonly notes?: readonly string[];
  /** Подкоманда не принимает глобальный флаг -o / --output. */
  readonly noOutput?: true;
}

export type CommandGroupId = "connection" | "data" | "code" | "files" | "config";

export interface CommandGroup {
  readonly id: CommandGroupId;
  readonly title: string;
}

export interface CommandSpec {
  readonly name: string;
  readonly group: CommandGroupId;
  readonly summary: string;
  /** Вложенные подкоманды в порядке вывода; справка и проверка аргументов опираются на этот список. */
  readonly subcommands?: readonly SubcommandSpec[];
  /** Аргументы, которыми команда без вложенной вызывает функцию (`rpc БИБЛИОТЕКА ФУНКЦИЯ`). */
  readonly call?: string;
  /** Строки использования одиночной команды или прямого вызова без подкоманды. */
  readonly usage?: readonly string[];
  /** Параметры одиночной команды или прямого вызова без подкоманды. */
  readonly options?: readonly OptionSpec[];
  /** Общие заметки команды; по предложению на пункт, в текстовой справке — по строке. */
  readonly notes?: readonly string[];
  /** Скрытый синоним: доступен по имени, но не попадает в главный список команд. */
  readonly hidden?: boolean;
}

export interface ParseRegistry {
  readonly globalOptions: readonly OptionSpec[];
  readonly commands: readonly CommandSpec[];
}

export const COMMAND_GROUPS: readonly CommandGroup[] = [
  { id: "connection", title: "Подключение и сервер" },
  { id: "data", title: "Данные и схема" },
  { id: "code", title: "Код и библиотеки" },
  { id: "files", title: "Файлы и логи" },
  { id: "config", title: "Настройка и прочее" },
];

export const GLOBAL_OPTIONS: readonly OptionSpec[] = [
  { name: "config", type: "string", valueLabel: "ФАЙЛ", description: "Файл подключений." },
  {
    name: "connection",
    short: "c",
    type: "string",
    valueLabel: "ИМЯ",
    description: "Подключение из файла.",
  },
  {
    name: "output",
    short: "o",
    type: "string",
    valueLabel: "ФАЙЛ",
    description: "Сохранить полный ответ в файл.",
  },
  {
    name: "format",
    type: "string",
    valueLabel: "ВИД",
    values: ["auto", "table", "json", "jsonl", "csv", "tsv", "raw"],
    description: "Формат вывода: auto, table, json, jsonl, csv, tsv, raw.",
  },
  { name: "json", type: "boolean", description: "Вывести в JSON (синоним --format json)." },
  { name: "quiet", short: "q", type: "boolean", description: "Без лишних сообщений в stderr." },
  { name: "yes", short: "y", type: "boolean", description: "Подтверждать действия без вопроса." },
  {
    name: "password-stdin",
    type: "boolean",
    description: "Прочитать пароль подключения из stdin.",
  },
  { name: "help", short: "h", type: "boolean", description: "Показать справку." },
  { name: "version", short: "v", type: "boolean", description: "Показать версию клиента." },
];

const inputFileOption = (description: string): OptionSpec => ({
  name: "input-file",
  short: "i",
  type: "string",
  valueLabel: "ФАЙЛ",
  description,
});

const stdinOption = (description: string): OptionSpec => ({
  name: "stdin",
  type: "boolean",
  description,
});

const argsOption = (description: string, valueLabel = "JSON"): OptionSpec => ({
  name: "args",
  type: "string",
  valueLabel,
  description,
});

const inputOptions = (
  fileDesc: string,
  stdinDesc: string,
  argsDesc: string,
  argsLabel = "JSON",
): readonly OptionSpec[] => [
  inputFileOption(fileDesc),
  stdinOption(stdinDesc),
  argsOption(argsDesc, argsLabel),
];

const limitOption = (description: string): OptionSpec => ({
  name: "limit",
  short: "n",
  type: "string",
  valueLabel: "N",
  description,
});

const cursorOption = (description = "Смещение следующей страницы из ответа."): OptionSpec => ({
  name: "cursor",
  type: "string",
  valueLabel: "N",
  description,
});

const offsetOption = (description = "Смещение от начала списка."): OptionSpec => ({
  name: "offset",
  type: "string",
  valueLabel: "N",
  description,
});

const searchOption = (description: string): OptionSpec => ({
  name: "search",
  short: "s",
  type: "string",
  valueLabel: "ТЕКСТ",
  description,
});

const OBJECT_TARGET_OPTIONS: readonly OptionSpec[] = [
  { name: "id", type: "string", valueLabel: "ID", description: "ID объекта." },
  { name: "url", type: "string", valueLabel: "АДРЕС", description: "Адрес документа объекта." },
  { name: "type", type: "string", valueLabel: "ТИП", description: "Тип объекта для проверки." },
  {
    name: "db-name",
    type: "string",
    valueLabel: "БАЗА",
    description: "База данных, если не основная.",
  },
];

const UPLOAD_OPTIONS: readonly OptionSpec[] = [
  inputFileOption("Локальный файл для загрузки."),
  stdinOption("Прочитать содержимое файла из stdin."),
  {
    name: "name",
    type: "string",
    valueLabel: "ИМЯ",
    description: "Имя файла на сервере (по умолчанию имя локального файла).",
  },
  {
    name: "content-type",
    type: "string",
    valueLabel: "ТИП",
    description: "MIME-тип файла, например text/plain.",
  },
];

const SET_OPTIONS: readonly OptionSpec[] = [
  {
    name: "set",
    short: "s",
    type: "string",
    repeatable: true,
    valueLabel: "ПУТЬ=ЗНАЧЕНИЕ",
    description: "Задать поле строкой; флаг повторяемый.",
  },
  {
    name: "set-json",
    type: "string",
    repeatable: true,
    valueLabel: "ПУТЬ=JSON",
    description: "Задать поле значением JSON; флаг повторяемый.",
  },
];

const LOG_RANGE_OPTIONS: readonly OptionSpec[] = [
  {
    name: "tail-bytes",
    type: "string",
    valueLabel: "N",
    description: "Прочитать последние N байт файла.",
  },
  { name: "full", type: "boolean", description: "Прочитать файл целиком." },
];

const WS_NOTES = ["timeout-ms от 250 до 10000, по умолчанию 5000."] as const;
const DOC_NOTES = [
  "Для объектов удобнее object: он сохраняет остальное содержимое документа.",
  "put с --args JSON задаёт все параметры операции native.lds.putDoc.",
] as const;
const FILE_ALIAS_NOTES = [
  "file upload сохранён для совместимости; основная команда — wtctl files upload.",
  "В ответе url — адрес файла, folderUrl — папка, созданная для него.",
] as const;
const LOG_UNAVAILABLE_NOTE =
  "LOG_READ_UNAVAILABLE — сервер сейчас пишет в этот файл: повторить чуть позже.";

export const CLI_COMMANDS: readonly CommandSpec[] = [
  // Подключение и сервер
  {
    name: "status",
    group: "connection",
    summary: "Адрес и версия сервера, база данных, пользователь и права подключения.",
    usage: ["wtctl status"],
  },
  {
    name: "check",
    group: "connection",
    summary: "Проверка подключения по шагам.",
    usage: ["wtctl check"],
    notes: [
      "Шаги: вход, версия, запрос, документ, схема, библиотеки, логи, портал, выполнение кода (пропускается без права execute).",
      "Ничего не записывает.",
      "При сбое хотя бы одного шага код выхода 1.",
    ],
  },
  {
    name: "server",
    group: "connection",
    summary: "Сведения о сервере: версия, ОС, ограничения.",
    subcommands: [
      {
        name: "info",
        summary: "Сведения о сервере: версия, операционная система, ограничения.",
        usage: ["wtctl server info [--profile native|web]"],
        options: [
          {
            name: "profile",
            type: "string",
            valueLabel: "ПРОФИЛЬ",
            values: ["native", "web"],
            description: "Профиль протокола сервера: native или web.",
          },
        ],
      },
    ],
  },
  {
    name: "ws",
    group: "connection",
    summary: "Отвечает ли служба WebSocket.",
    subcommands: [
      {
        name: "heartbeat",
        summary: "Проверить ответ службы WebSocket.",
        usage: ["wtctl ws heartbeat [--timeout-ms N]"],
        options: [
          {
            name: "timeout-ms",
            type: "string",
            valueLabel: "N",
            description: "Ожидание ответа в миллисекундах: от 250 до 10000, по умолчанию 5000.",
          },
        ],
      },
    ],
    notes: WS_NOTES,
  },

  // Данные и схема
  {
    name: "types",
    group: "data",
    summary: "Типы объектов сервера и их каталоги.",
    usage: ["wtctl types [ТЕКСТ | --search ТЕКСТ] [--limit N] [--cursor N]"],
    options: [
      searchOption("Поиск по имени типа, каталогу и заголовку."),
      limitOption("Строк на странице: по умолчанию 50, не больше 1000."),
      cursorOption(),
    ],
    notes: [
      'customFields "by kind" — настраиваемые поля у каждого вида объекта свои: schema ТИП --kind ID.',
    ],
  },
  {
    name: "schema",
    group: "data",
    summary: "Поля типа объекта.",
    usage: [
      "wtctl schema (ТИП [ТЕКСТ | --search ТЕКСТ] | --url АДРЕС [--search ТЕКСТ]) [--path ПУТЬ] [--deep] [--origin own,inherited,custom,catalog] [--kind ID] [--include methods] [--language ЯЗЫК] [--limit N] [--cursor N]",
    ],
    options: [
      { name: "url", type: "string", valueLabel: "АДРЕС", description: "Адрес формы XMD." },
      searchOption("Поиск полей по имени и заголовку на любой глубине."),
      { name: "path", type: "string", valueLabel: "ПУТЬ", description: "Узел формы." },
      { name: "deep", type: "boolean", description: "Все вложенные поля одним списком." },
      {
        name: "origin",
        type: "string",
        valueLabel: "СПИСОК",
        description: "Происхождение: own, inherited, custom, catalog.",
      },
      { name: "kind", type: "string", valueLabel: "ID", description: "Вид объекта для полей." },
      {
        name: "include",
        type: "string",
        valueLabel: "СПИСОК",
        description: "Дополнительные разделы, например methods.",
      },
      { name: "language", type: "string", valueLabel: "ЯЗЫК", description: "Язык заголовков." },
      limitOption("Полей на странице: по умолчанию 80, до 1000."),
      cursorOption(),
    ],
    notes: [
      "Без --search показывает верхний уровень, с ним ищет на любой глубине.",
      "query:true — поле есть в каталоге и годится для query; computed:true — вычисляемое.",
      "cutBySize — страница короче запрошенной.",
    ],
  },
  {
    name: "query",
    group: "data",
    summary: "Поиск в каталоге; запрос XQuery.",
    usage: [
      "wtctl query КАТАЛОГ -w is_dismiss=false -w hire_date:gte=2025-01-01 [-f id,fullname] [-n 20 | --all]",
      String.raw`wtctl query --catalog collaborators --where '{\"is_dismiss\":false}' -f id,fullname -n 20`,
      'wtctl query --catalog collaborators -i where.json --order "fullname, hire_date desc"',
      "wtctl query 'for $e in collaborators order by $e/fullname return $e' -f id,fullname",
      "wtctl query -i query.json",
    ],
    options: [
      {
        name: "catalog",
        type: "string",
        valueLabel: "КАТАЛОГ",
        description: "Каталог для поиска.",
      },
      {
        name: "where",
        short: "w",
        type: "string",
        repeatable: true,
        valueLabel: "УСЛОВИЕ",
        description: "Условие поле=значение, поле:op=значение или JSON; повторяемый.",
      },
      {
        name: "fields",
        short: "f",
        type: "string",
        valueLabel: "ПОЛЯ",
        description: "Поля через запятую.",
      },
      {
        name: "order",
        type: "string",
        valueLabel: "ПОЛЯ",
        description: "Сортировка по каталогу; «поле desc» — по убыванию.",
      },
      limitOption("Строк на странице: по умолчанию 20, не больше 1000."),
      {
        name: "start-position",
        type: "string",
        valueLabel: "N",
        description: "Смещение следующей страницы.",
      },
      {
        name: "all",
        type: "boolean",
        description: "Все страницы (csv/tsv/jsonl/raw потоком).",
      },
      {
        name: "page-size",
        type: "string",
        valueLabel: "N",
        description: "Страница с --all: 200 (до 1000).",
      },
      {
        name: "max-rows",
        type: "string",
        valueLabel: "N",
        description: "Максимум строк с --all.",
      },
      ...inputOptions(
        "Файл where, аргументов JSON или XQuery.",
        "Прочитать ввод из stdin.",
        "Ввод аргументом.",
      ),
    ],
    notes: [
      "-w: =, !=, ~ (подстрока), >, >=, <, <=, :in=a,b, JSON; без кавычек в bash/cmd: :eq=, :ne=, :contains=, :gt=, :gte=, :lt=, :lte=.",
      "С каталогом ввод — where; без него — JSON {catalog|query, ...} или XQuery.",
      "--all читает все страницы (--page-size, --max-rows; с --limit несовместим); неполная страница — QUERY_INCOMPLETE.",
      "Ответ: items, total, nextStartPosition. XQuery требует права execute.",
    ],
  },
  {
    name: "object",
    group: "data",
    summary: "Объект: get, create, patch, edit, delete.",
    subcommands: [
      {
        name: "get",
        summary: "Прочитать один объект или несколько объектов по ID.",
        usage: [
          "wtctl object get [ТИП] ID [ID …] [--fields id,name]",
          "wtctl object get (--id ID | --url АДРЕС) [--type ТИП]",
          "wtctl object get --ids ID,ID,… [--type ТИП] [--fields id,name]",
        ],
        options: [
          ...OBJECT_TARGET_OPTIONS,
          {
            name: "ids",
            type: "string",
            valueLabel: "ID,ID,…",
            description: "Несколько ID через запятую, до 100.",
          },
          {
            name: "fields",
            short: "f",
            type: "string",
            valueLabel: "ПОЛЯ",
            description: "Список полей через запятую.",
          },
        ],
        notes: [
          "ТИП перед ID не обязателен: с ним команда проверяет, что объект этого типа.",
          "Позиционно или в --ids можно передать до 100 ID. --db-name задаёт базу, если не основная.",
        ],
      },
      {
        name: "create",
        summary: "Создать новый объект.",
        usage: [
          "wtctl object create ТИП -s путь=значение [--set-json путь=JSON]",
          String.raw`wtctl object create ТИП (--input-file object.json | --stdin | --args '{\"name\":\"…\"}')`,
        ],
        options: [
          ...SET_OPTIONS,
          ...inputOptions(
            "Файл JSON с полями нового объекта.",
            "Прочитать JSON объекта из stdin.",
            "JSON объекта строкой аргумента.",
          ),
          {
            name: "form-url",
            type: "string",
            valueLabel: "АДРЕС",
            description: "Адрес формы XMD, если отличается от штатной.",
          },
          {
            name: "db-name",
            type: "string",
            valueLabel: "БАЗА",
            description: "База данных, если не основная.",
          },
        ],
        notes: [
          "Поля задаются через -s/--set, --set-json (вложенные пути через точку), --input-file, --stdin или --args.",
          "Ответ — id нового объекта и mutationOutcome.",
        ],
      },
      {
        name: "patch",
        summary: "Изменить поля существующего объекта.",
        usage: [
          "wtctl object patch [ТИП] ID -s путь=значение [--set-json путь=JSON] [--remove путь] [--preview]",
          "wtctl object patch [ТИП] ID --input-file patch.json [--preview] [--resave] [--expected-fingerprint ОТПЕЧАТОК]",
        ],
        options: [
          ...OBJECT_TARGET_OPTIONS,
          ...SET_OPTIONS,
          {
            name: "remove",
            type: "string",
            repeatable: true,
            valueLabel: "ПУТЬ",
            description: "Удалить поле по пути; флаг повторяемый.",
          },
          ...inputOptions(
            "Файл JSON с правкой.",
            "Прочитать JSON правки из stdin.",
            "JSON правки строкой аргумента.",
          ),
          { name: "preview", type: "boolean", description: "Показать изменения без записи." },
          {
            name: "resave",
            type: "boolean",
            description: "Сохранить документ и без правок; можно без JSON.",
          },
          {
            name: "expected-fingerprint",
            type: "string",
            valueLabel: "ОТПЕЧАТОК",
            description: "Ожидаемый отпечаток документа для защиты от перезаписи.",
          },
        ],
        notes: [
          "patch.json — {путь: значение}, [{op:'set'|'remove', path, value}] или {patch:{…}, remove:[пути]}.",
          "Путь: name; a.b; items[0]; custom_elems.custom_elem[name=код].value.",
          "Флаги -s/--set, --set-json и --remove сочетаются с --input-file, --preview и --resave.",
          "Объект можно задать и флагами: (--id ID | --url АДРЕС) [--type ТИП] вместо [ТИП] ID.",
          "Правка, которая ничего не меняет, не записывается (noop:true). Ответ — changes и mutationOutcome.",
        ],
      },
      {
        name: "edit",
        noOutput: true,
        summary: "Открыть поля или XML объекта в редакторе.",
        usage: [
          'wtctl object edit [ТИП] ID [-f ПОЛЯ] [--editor "code --wait"]',
          'wtctl object edit [ТИП] ID --xml [--editor "code --wait"]',
        ],
        options: [
          ...OBJECT_TARGET_OPTIONS,
          {
            name: "fields",
            short: "f",
            type: "string",
            valueLabel: "ПОЛЯ",
            description: "Список полей через запятую (без --xml).",
          },
          {
            name: "xml",
            type: "boolean",
            description: "Открыть исходный XML документа (native.lds.loadDoc/putDoc).",
          },
          {
            name: "editor",
            type: "string",
            valueLabel: "КОМАНДА",
            description:
              "Команда редактора (порядок выбора: --editor → WTCTL_EDITOR → VISUAL → EDITOR → notepad/vi).",
          },
        ],
        notes: [
          "Без --xml открывает поля в JSON, показывает предпросмотр и записывает с expectedFingerprint.",
          "С --xml открывает исходный XML; --xml и --fields несовместимы.",
          'Флаг ожидания вроде --wait задаётся внутри --editor или WTCTL_EDITOR (например, --editor "code --wait"). Подтверждение [y/N] отключает -y; --output не поддерживается.',
        ],
      },
      {
        name: "delete",
        summary: "Удалить объект безвозвратно.",
        usage: ["wtctl object delete [ТИП] ID [--permanent] [--catalog КАТАЛОГ]"],
        options: [
          ...OBJECT_TARGET_OPTIONS,
          {
            name: "permanent",
            type: "boolean",
            description: "Подтвердить безвозвратное удаление без вопроса.",
          },
          {
            name: "catalog",
            type: "string",
            valueLabel: "КАТАЛОГ",
            description: "Каталог проверки удаления, если у типа их несколько.",
          },
        ],
        notes: [
          "Объект можно задать и флагами: (--id ID | --url АДРЕС) [--type ТИП] вместо [ТИП] ID.",
          "Вопрос [y/N] появляется, только когда stdin, stdout и stderr подключены к терминалу; иначе обязателен --permanent, даже при --yes.",
          "Ответ — mutationOutcome и verification.",
        ],
      },
    ],
    notes: [
      "ТИП перед ID не обязателен: с ним команда проверяет, что объект этого типа.",
      "Путь (для patch): name; a.b; items[0]; custom_elems.custom_elem[name=код].value.",
      "Ввод: -s/--set, --set-json, --input-file, --stdin, --args (для patch также --remove, --preview, --resave).",
      "get, patch, edit и delete принимают (--id ID | --url АДРЕС) [--type ТИП] вместо [ТИП] ID.",
    ],
  },
  {
    name: "doc",
    group: "data",
    summary: "Документ XML по адресу: get, put, delete.",
    subcommands: [
      {
        name: "get",
        summary: "Прочитать XML документа по адресу.",
        usage: ["wtctl doc get АДРЕС"],
        notes: [
          "В терминале и с --format table|raw собирает XML; в JSON возвращает разобранную структуру native.lds.loadDoc. Исходный файл байт в байт читает files read АДРЕС --to ФАЙЛ.",
        ],
      },
      {
        name: "put",
        summary: "Записать XML документа по адресу.",
        usage: ["wtctl doc put АДРЕС --input-file document.xml"],
        options: inputOptions(
          "Файл XML с содержимым документа.",
          "Прочитать XML документа из stdin.",
          "Все параметры операции native.lds.putDoc в JSON.",
        ),
        notes: DOC_NOTES,
      },
      {
        name: "delete",
        summary: "Удалить документ по адресу.",
        usage: ["wtctl doc delete АДРЕС"],
        notes: [
          "Выполняется без интерактивного подтверждения и проверки каталога; для объектов безопаснее object delete.",
        ],
      },
    ],
    notes: DOC_NOTES,
  },

  // Код и библиотеки
  {
    name: "exec",
    group: "code",
    summary: "Выполнить код на сервере (SP-XML Script).",
    usage: [
      "wtctl exec 'КОД' [-p ключ=значение] [--param-json ключ=JSON]",
      "wtctl exec 'КОД' --params-file params.json",
      String.raw`wtctl exec --input-file script.js [--params-file params.json | --params '{\"name\":\"…\"}']`,
      "wtctl exec --stdin",
    ],
    options: [
      ...inputOptions(
        "Файл с кодом SP-XML Script.",
        "Прочитать код из stdin.",
        "Код в аргументе команды.",
        "КОД",
      ),
      {
        name: "params",
        short: "p",
        type: "string",
        repeatable: true,
        valueLabel: "КЛЮЧ=ЗН|JSON",
        description:
          "Параметр PARAMS: ключ=значение (целые до 15 цифр, true, false и null распознаются автоматически) или JSON-объект; повторяемый.",
      },
      {
        name: "param-json",
        type: "string",
        repeatable: true,
        valueLabel: "КЛЮЧ=JSON",
        description: String.raw`Параметр PARAMS значением JSON (строка в PowerShell и bash: 'x=\"5\"'); повторяемый.`,
      },
      {
        name: "params-file",
        type: "string",
        valueLabel: "ФАЙЛ",
        description:
          "Файл JSON с параметрами кода (переменная PARAMS); несовместим с -p/--param-json.",
      },
    ],
    notes: [
      "Код присваивает массив RESULT, например RESULT = [{name: doc.TopElem.name + ''}]; числа и логические приходят строками.",
      "String() в ответ не попадает, дата — не везде: приводить к строке так — x + '', StrDate(d).",
      "Ошибка кода — в error.details.scriptError. Нужно право execute; отката нет.",
    ],
  },
  {
    name: "rpc",
    group: "code",
    summary: "Функции библиотек сервера: list, describe, вызов.",
    call: "БИБЛИОТЕКА ФУНКЦИЯ",
    subcommands: [
      {
        name: "list",
        summary: "Список функций библиотек сервера.",
        usage: [
          "wtctl rpc list [ТЕКСТ | --query ТЕКСТ] [--library БИБЛИОТЕКА] [--method ФУНКЦИЯ] [--all] [--limit N] [--cursor N]",
        ],
        options: [
          {
            name: "query",
            short: "s",
            type: "string",
            valueLabel: "ТЕКСТ",
            description: "Поиск по имени библиотеки и функции.",
          },
          {
            name: "library",
            type: "string",
            valueLabel: "БИБЛИОТЕКА",
            description: "Фильтр по имени библиотеки.",
          },
          {
            name: "method",
            type: "string",
            valueLabel: "ФУНКЦИЯ",
            description: "Фильтр по имени функции.",
          },
          {
            name: "all",
            type: "boolean",
            description: "Включить функции только для кода на сервере (serverOnly:true).",
          },
          limitOption("Количество функций на странице, до 100."),
          cursorOption(),
        ],
        notes: [
          "Читает с сервера функции, разрешённые для вызова с клиента; --all добавляет те, что вызываются только из кода на сервере (serverOnly:true) — их вызывают через exec.",
        ],
      },
      {
        name: "describe",
        summary: "Описание и код функции библиотеки.",
        usage: ["wtctl rpc describe БИБЛИОТЕКА.ФУНКЦИЯ [--source]"],
        options: [
          { name: "source", type: "boolean", description: "Включить исходный код функции." },
        ],
        notes: ["Показывает и клиентские, и серверные функции; --source добавляет код функции."],
      },
    ],
    usage: [
      "wtctl rpc БИБЛИОТЕКА.ФУНКЦИЯ [АРГУМЕНТЫ…] [--async]",
      String.raw`wtctl rpc tools get_version --args '[\"wtv\"]'`,
      "wtctl rpc БИБЛИОТЕКА ФУНКЦИЯ --input-file args.json [--async]",
    ],
    options: [
      ...inputOptions(
        "Файл JSON с массивом аргументов вызова.",
        "Прочитать массив аргументов JSON из stdin.",
        "Массив аргументов вызова в JSON.",
      ),
      {
        name: "async",
        type: "boolean",
        description: "Запустить асинхронно (возвращает data.TrackingID для tasks status).",
      },
    ],
    notes: [
      "list читает клиентские функции; --all добавляет serverOnly:true (вызываются через exec).",
      "describe показывает и те, и другие; --source добавляет код функции.",
      "Позиционные аргументы: true/false/null и целые до 15 цифр приводятся, остальное (007, 1.5, 64-битные ID) — строкой; иные типы — через --args.",
      "Ответ — в data.value (с --async — data.TrackingID для wtctl tasks status). Для вызова нужно право execute.",
    ],
  },
  {
    name: "agent",
    group: "code",
    summary: "Агенты сервера: run, status, cancel.",
    subcommands: [
      {
        name: "run",
        summary: "Запустить агента сервера в отдельном потоке.",
        usage: [
          "wtctl agent run ID [--object ID | --objects ID,ID] [--no-wait | --wait-timeout-ms N] [--allow-concurrent] [--logs]",
        ],
        options: [
          {
            name: "object",
            type: "string",
            valueLabel: "ID",
            description: "ID объекта (в коде агента — OBJECT_ID).",
          },
          {
            name: "objects",
            type: "string",
            repeatable: true,
            valueLabel: "ID,ID,…",
            description: "ID объектов через запятую (OBJECTS_ID_STR); повторяемый.",
          },
          {
            name: "no-wait",
            type: "boolean",
            description: "Запустить в фоне без ожидания завершения и сразу вернуть threadId.",
          },
          {
            name: "wait-timeout-ms",
            type: "string",
            valueLabel: "N",
            description:
              "Предел ожидания завершения в миллисекундах: 1000–3600000, по умолчанию 120000.",
          },
          {
            name: "allow-concurrent",
            type: "boolean",
            description: "Запустить параллельно, даже если этот агент уже выполняется.",
          },
          {
            name: "logs",
            type: "boolean",
            description:
              "Показать события свежего лога за интервал работы агента (несовместим с --no-wait).",
          },
        ],
        notes: [
          "Запускает агента в отдельном потоке и по умолчанию ждёт завершения (до --wait-timeout-ms, по умолчанию 120000 мс); --no-wait возвращает threadId сразу.",
          "При таймауте ожидания отвечает AGENT_WAIT_TIMEOUT (mutationOutcome: confirmed): агент продолжает работу, состояние покажет wtctl agent status --thread ID.",
          "Ошибки кода и alert сервер пишет в лог xhttp между startedAt и finishedAt.",
        ],
      },
      {
        name: "status",
        summary: "Показать текущие и недавно завершённые запуски агентов сервера.",
        usage: [
          "wtctl agent status [ID] [--thread ID] [--status running|finished|cancelled] [--limit N] [--wait [--wait-timeout-ms N]]",
        ],
        options: [
          {
            name: "thread",
            type: "string",
            valueLabel: "ID",
            description: "Фильтр по ID потока запуска.",
          },
          {
            name: "status",
            type: "string",
            valueLabel: "СОСТОЯНИЕ",
            values: ["running", "finished", "cancelled"],
            description: "Фильтр по состоянию: running, finished или cancelled.",
          },
          limitOption("Количество записей, 1–200, по умолчанию 20."),
          {
            name: "wait",
            type: "boolean",
            description: "Ждать завершения запуска (требует --thread).",
          },
          {
            name: "wait-timeout-ms",
            type: "string",
            valueLabel: "N",
            description:
              "Предел ожидания в миллисекундах: 1000–3600000, по умолчанию 120000 (только с --wait).",
          },
        ],
        notes: [
          "Работает без права execute; показывает выполняющиеся запуски и до 100 последних завершённых.",
          "С --thread ID --wait ждёт завершения или отмены указанного запуска.",
        ],
      },
      {
        name: "cancel",
        summary: "Остановить выполняющегося агента сервера по ID потока.",
        usage: ["wtctl agent cancel THREAD_ID [--role ROLE_UID]"],
        options: [
          {
            name: "role",
            type: "string",
            allowEmpty: true,
            valueLabel: "ROLE_UID",
            description:
              "Идентификатор роли сервера (на одиночном сервере 2025.2 — пустая строка --role=; без флага определяется по списку запусков).",
          },
        ],
        notes: [
          "Требует права write. Уже сделанные изменения не откатываются; сервер обрабатывает отмену в течение нескольких секунд.",
          "Вопрос [y/N] появляется, только когда stdin, stdout и stderr подключены к терминалу (без вопроса — --yes); иначе выполняется сразу.",
        ],
      },
    ],
    notes: [
      "run запускает в отдельном потоке и по умолчанию ждёт завершения (--no-wait — сразу в фоне); status показывает запуски и ждёт по --thread --wait; cancel останавливает работающий поток.",
    ],
  },
  {
    name: "tasks",
    group: "code",
    summary: "Асинхронные вызовы rpc: list, status, kill.",
    subcommands: [
      {
        name: "list",
        summary: "Запущенные асинхронные вызовы функции библиотеки.",
        usage: ["wtctl tasks list [БИБЛИОТЕКА.ФУНКЦИЯ] [--library БИБ] [--method ФУНКЦИЯ]"],
        options: [
          {
            name: "library",
            type: "string",
            valueLabel: "БИБЛИОТЕКА",
            description: "Имя библиотеки.",
          },
          {
            name: "method",
            type: "string",
            valueLabel: "ФУНКЦИЯ",
            description: "Имя функции библиотеки.",
          },
        ],
        notes: [
          "Принимает БИБЛИОТЕКА.ФУНКЦИЯ, БИБЛИОТЕКА ФУНКЦИЯ, --library/--method или без аргументов.",
          "Сервер ищет по точному имени библиотеки и функции; в списке бывают чужие задачи.",
        ],
      },
      {
        name: "status",
        summary: "Состояние и итог асинхронного вызова по TrackingID.",
        usage: ["wtctl tasks status ID"],
        notes: [
          "Итог завершённого вызова (IsRunning: 0) сервер выдаёт один раз и затем удаляет запись.",
        ],
      },
      {
        name: "kill",
        summary: "Остановить асинхронный вызов по TrackingID.",
        usage: ["wtctl tasks kill ID"],
        notes: [
          "Уже сделанные изменения не откатываются. Вопрос [y/N] появляется, только когда stdin, stdout и stderr подключены к терминалу (без вопроса — --yes); иначе выполняется сразу.",
        ],
      },
    ],
    notes: [
      "Асинхронный вызов запускает wtctl rpc БИБЛИОТЕКА.ФУНКЦИЯ --async (в ответе TrackingID).",
      "tasks status отдаёт итог завершённого вызова один раз, затем сервер удаляет запись.",
    ],
  },
  {
    name: "run",
    group: "code",
    summary: "Несколько операций одним вызовом.",
    usage: ["wtctl run --input-file batch.json", "wtctl run --stdin"],
    options: inputOptions(
      "Файл JSON со списком шагов.",
      "Прочитать JSON со списком шагов из stdin.",
      "JSON со списком шагов в аргументе команды.",
    ),
    notes: [
      "Файл: {steps:[{id, args?, as?}], stopOnError?}; as — имя шага (латинские буквы, цифры и _, не начинается с цифры).",
      "Значение из прошлого шага: {$ref:'имя_шага.data.id'}.",
      "Права проверяются для каждого шага. Интерактивных подтверждений CLI нет; это не транзакция (stopOnError:false продолжает после ошибки).",
    ],
  },

  // Файлы и логи
  {
    name: "files",
    group: "files",
    summary: "Файл сервера: read, exists, list, write, edit, delete, upload.",
    subcommands: [
      {
        name: "read",
        summary: "Прочитать файл сервера или сохранить его на диск.",
        usage: [
          "wtctl files read АДРЕС",
          "wtctl files read АДРЕС --base64",
          "wtctl files read АДРЕС --to ФАЙЛ [--overwrite]",
        ],
        options: [
          { name: "base64", type: "boolean", description: "Вернуть содержимое файла в base64." },
          {
            name: "to",
            type: "string",
            valueLabel: "ФАЙЛ",
            description: "Сохранить файл на диск байт в байт.",
          },
          {
            name: "overwrite",
            type: "boolean",
            description: "Перезаписать существующий файл при --to.",
          },
        ],
        notes: [
          "Без --to возвращает текст UTF-8 или base64; --to сохраняет на диск байт в байт любого размера.",
        ],
      },
      {
        name: "exists",
        summary: "Проверить, существует ли файл на сервере.",
        usage: ["wtctl files exists АДРЕС"],
      },
      {
        name: "list",
        summary: "Показать файлы и папки одного уровня.",
        usage: ["wtctl files list АДРЕС [ТЕКСТ | --search ЧАСТЬ_ИМЕНИ]"],
        options: [searchOption("Фильтр по части имени файла или папки.")],
        notes: ["Показывает один уровень папки и требует права execute."],
      },
      {
        name: "write",
        summary: "Записать файл на сервер по адресу.",
        usage: ["wtctl files write АДРЕС (ФАЙЛ | --input-file ФАЙЛ | --stdin)"],
        options: [
          inputFileOption("Локальный файл для записи на сервер (читается частями)."),
          stdinOption("Прочитать содержимое файла из stdin (целиком в памяти)."),
        ],
        notes: [
          "Читает ФАЙЛ частями и сверяет записанное; --stdin держит ввод в памяти. Имя с «-» передают как ./-файл или --input-file=ФАЙЛ. В папку кода нужно ещё право execute.",
        ],
      },
      {
        name: "edit",
        noOutput: true,
        summary: "Открыть текстовый файл сервера в редакторе.",
        usage: ['wtctl files edit АДРЕС [--editor "code --wait"]'],
        options: [
          {
            name: "editor",
            type: "string",
            valueLabel: "КОМАНДА",
            description:
              "Команда редактора (порядок выбора: --editor → WTCTL_EDITOR → VISUAL → EDITOR → notepad/vi).",
          },
        ],
        notes: [
          "Скачивает текстовый файл во временную копию с тем же расширением, показывает diff (для файлов > 512 КиБ — изменение размера) и записывает после [y/N] (без вопроса — -y).",
          "Флаг ожидания вроде --wait задаётся внутри --editor или WTCTL_EDITOR; --output не поддерживается.",
        ],
      },
      {
        name: "delete",
        summary: "Удалить файл на сервере.",
        usage: ["wtctl files delete АДРЕС [--permanent]"],
        options: [
          {
            name: "permanent",
            type: "boolean",
            description: "Удалить в терминале без интерактивного подтверждения.",
          },
        ],
        notes: [
          "Вопрос [y/N] появляется, только когда stdin, stdout и stderr подключены к терминалу (без вопроса — --permanent или --yes); иначе выполняется сразу.",
        ],
      },
      {
        name: "upload",
        summary: "Загрузить файл в папку загрузок сервера.",
        usage: [
          "wtctl files upload report.txt [--name ИМЯ] [--content-type text/plain]",
          "wtctl files upload ИМЯ --input-file report.txt [--content-type text/plain]",
        ],
        options: UPLOAD_OPTIONS,
        notes: [
          "Кладёт файл в папку загрузок сервера (в ответе url и folderUrl); имя с «-» передают как ./-файл или --input-file=ФАЙЛ. Прежнее имя file upload сохранено.",
        ],
      },
    ],
    notes: [
      "read: text для UTF-8, иначе base64; --to сохраняет байт в байт любого размера, --overwrite заменяет.",
      "list показывает один уровень папки и требует права execute.",
      "write читает ФАЙЛ частями и сверяет; в папку кода нужно ещё право execute.",
      "upload кладёт файл в папку загрузок (в ответе url и folderUrl); file upload сохранён.",
    ],
  },
  {
    name: "file",
    group: "files",
    hidden: true,
    summary: "Прежнее имя для files upload.",
    subcommands: [
      {
        name: "upload",
        summary: "Загрузить файл в папку загрузок сервера (прежнее имя для files upload).",
        usage: [
          "wtctl files upload report.txt [--name ИМЯ] [--content-type text/plain]",
          "wtctl files upload ИМЯ --input-file report.txt [--content-type text/plain]",
        ],
        options: UPLOAD_OPTIONS,
        notes: FILE_ALIAS_NOTES,
      },
    ],
    notes: FILE_ALIAS_NOTES,
  },
  {
    name: "logs",
    group: "files",
    summary: "Логи сервера: list, read, tail, search, follow.",
    subcommands: [
      {
        name: "list",
        summary: "Список файлов логов сервера.",
        usage: [
          "wtctl logs list [--type xhttp] [--date ГГГГ-ММ-ДД] [--name-contains ТЕКСТ] [--start-date Д] [--end-date Д] [--offset N] [--limit N]",
        ],
        options: [
          {
            name: "type",
            type: "string",
            valueLabel: "ТИП",
            description: "Имя лога без даты, например xhttp.",
          },
          {
            name: "date",
            type: "string",
            valueLabel: "ГГГГ-ММ-ДД",
            description: "Файлы за одну дату.",
          },
          {
            name: "start-date",
            type: "string",
            valueLabel: "ГГГГ-ММ-ДД",
            description: "Начальная дата диапазона.",
          },
          {
            name: "end-date",
            type: "string",
            valueLabel: "ГГГГ-ММ-ДД",
            description: "Конечная дата диапазона.",
          },
          {
            name: "name-contains",
            type: "string",
            valueLabel: "ТЕКСТ",
            description: "Часть имени файла лога.",
          },
          offsetOption(),
          limitOption("Количество файлов, по умолчанию 30, до 1000."),
        ],
        notes: ["Показывает сначала свежие файлы, по умолчанию 30."],
      },
      {
        name: "read",
        summary: "Прочитать файл лога.",
        usage: ["wtctl logs read ФАЙЛ [--tail-bytes N | --full]"],
        options: LOG_RANGE_OPTIONS,
        notes: [
          "ФАЙЛ — имя из logs list или тип лога без .log (например xhttp, agent).",
          LOG_UNAVAILABLE_NOTE,
        ],
      },
      {
        name: "tail",
        summary: "Показать конец файла лога или следить за ним.",
        usage: [
          "wtctl logs tail xhttp -n 20",
          "wtctl logs tail ФАЙЛ [-n N] [-f] [--interval СЕК] [--tail-bytes N]",
        ],
        options: [
          {
            name: "lines",
            short: "n",
            type: "string",
            valueLabel: "N",
            description:
              "Последние N событий, 1–10000 (в читаемом выводе без --tail-bytes по умолчанию 50).",
          },
          {
            name: "follow",
            short: "f",
            type: "boolean",
            description:
              "Продолжить следить за новыми событиями (несовместим с --json, --output и --format json|csv|tsv).",
          },
          {
            name: "interval",
            type: "string",
            valueLabel: "СЕК",
            description: "Интервал опроса (только с -f), 0.5–60 с (по умолчанию 2).",
          },
          LOG_RANGE_OPTIONS[0]!,
        ],
        notes: [
          "ФАЙЛ — имя из logs list или тип без .log (xhttp, agent). С -n в JSON-выводе возвращается data.text, а строки событий — с -n и --format jsonl|csv|tsv. С -f работает до Ctrl+C.",
          LOG_UNAVAILABLE_NOTE,
        ],
      },
      {
        name: "search",
        summary: "Найти события в файле лога.",
        usage: [
          "wtctl logs search ФАЙЛ [ТЕКСТ | --text ТЕКСТ] [--level error] [--context ТЕКСТ] [--newest-first] [--tail-bytes N | --full] [--offset N] [--limit N] [--expected-fingerprint ОТПЕЧАТОК]",
        ],
        options: [
          {
            name: "text",
            type: "string",
            valueLabel: "ТЕКСТ",
            description: "Искомая подстрока в тексте события.",
          },
          {
            name: "level",
            type: "string",
            valueLabel: "УРОВЕНЬ",
            values: ["normal", "debug", "info", "warning", "error", "critical"],
            description: "Уровень: normal, debug, info, warning, error или critical.",
          },
          {
            name: "context",
            type: "string",
            valueLabel: "ТЕКСТ",
            description: "Фильтр по контексту события.",
          },
          {
            name: "newest-first",
            type: "boolean",
            description: "Отдавать сначала последние события.",
          },
          ...LOG_RANGE_OPTIONS,
          offsetOption("Смещение страницы событий (data.nextOffset из прошлого ответа)."),
          limitOption("Количество событий на странице, до 1000."),
          {
            name: "expected-fingerprint",
            type: "string",
            valueLabel: "ОТПЕЧАТОК",
            description:
              "Отпечаток файла (data.fingerprint из прошлого ответа) для следующей страницы.",
          },
        ],
        notes: [
          "ФАЙЛ — имя из logs list или тип лога; ищет в конце файла, с --full — во всём файле.",
          "Для следующей страницы передаются --offset (data.nextOffset) и --expected-fingerprint (data.fingerprint).",
          LOG_UNAVAILABLE_NOTE,
        ],
      },
      {
        name: "follow",
        summary: "Следить за новыми событиями файла лога.",
        usage: [
          "wtctl logs follow ФАЙЛ [--interval СЕК] [--once] [--cursor КУРСОР] [--tail-bytes N | --full]",
          "wtctl logs follow xhttp --once --json",
          "wtctl logs follow xhttp --format jsonl --interval 2",
        ],
        options: [
          {
            name: "interval",
            type: "string",
            valueLabel: "СЕК",
            description:
              "Интервал опроса, 0.5–60 с (по умолчанию 2; несовместим с --once и --json).",
          },
          {
            name: "once",
            type: "boolean",
            description: "Один опрос с возвратом data.cursor без цикла.",
          },
          {
            name: "cursor",
            type: "string",
            valueLabel: "КУРСОР",
            description: "Курсор (data.cursor) из предыдущего ответа logs follow.",
          },
          ...LOG_RANGE_OPTIONS,
        ],
        notes: [
          "В терминале (с auto) и с --format table опрашивает циклом до Ctrl+C; с --format jsonl|raw поток включает --interval (без него — один опрос даже в терминале). Потоковый режим не принимает --output.",
          "Один опрос с data.cursor в JSON: --once --json (или при перенаправлении без --interval и --format table).",
          LOG_UNAVAILABLE_NOTE,
        ],
      },
    ],
    notes: [
      "ФАЙЛ — имя из logs list или тип без .log (xhttp, agent): выбирается самый свежий файл.",
      "tail: 50 событий по умолчанию в терминале (-n N, -f); follow: цикл в терминале/table, поток jsonl|raw с --interval, один опрос с --once --json.",
      LOG_UNAVAILABLE_NOTE,
    ],
  },
  {
    name: "result",
    group: "files",
    summary: "Большой результат: read, export.",
    subcommands: [
      {
        name: "read",
        summary: "Прочитать часть сохранённого результата.",
        usage: ["wtctl result read RESULT_ID [--offset N] [--limit N] [--format auto|json|text]"],
        options: [
          offsetOption(
            "Смещение от начала списка или текста (data.nextOffset для следующей части).",
          ),
          limitOption("Число элементов (до 1000) или символов (до 65536)."),
          {
            name: "format",
            type: "string",
            overridesGlobal: true,
            valueLabel: "ФОРМАТ",
            values: ["auto", "json", "text"],
            description: "Формат чтения: auto, json или text.",
          },
        ],
        notes: [
          "Нужны то же подключение и runtimeDir; следующую часть читают с --offset из data.nextOffset.",
          "Список ответа (items, types, fields, results) — по элементам, до 1000; остальное — текстом, до 65536 символов.",
          "--format text выводит содержимое лога или файла.",
        ],
      },
      {
        name: "export",
        summary: "Выгрузить сохранённый результат в файл.",
        usage: ["wtctl result export RESULT_ID --to ФАЙЛ [--format json|jsonl|text] [--overwrite]"],
        options: [
          {
            name: "to",
            type: "string",
            valueLabel: "ФАЙЛ",
            description: "Путь локального файла для сохранения.",
          },
          {
            name: "format",
            type: "string",
            overridesGlobal: true,
            valueLabel: "ФОРМАТ",
            values: ["json", "jsonl", "text"],
            description: "Формат экспорта: json, jsonl или text.",
          },
          { name: "overwrite", type: "boolean", description: "Перезаписать существующий файл." },
        ],
        notes: [
          "Нужны то же подключение и runtimeDir.",
          "--format jsonl — по строке на элемент списка; --format text сохраняет содержимое лога или файла.",
        ],
      },
    ],
    notes: [
      "Когда в ответе meta.truncated, данные сохранены локально под meta.resultId, а в data.preview — их начало; сервер повторно не вызывается.",
      "--format text выводит и сохраняет содержимое лога или файла.",
    ],
  },

  // Настройка и прочее
  {
    name: "config",
    group: "config",
    summary: "Подключения: init, list, set, use, remove, path, example.",
    subcommands: [
      {
        name: "init",
        summary: "Добавить подключение в файл подключений.",
        usage: [
          "wtctl config init",
          "wtctl config init --name prod --url https://hcm.example.org --username admin --password-env WTCTL_PROD_PASSWORD",
        ],
        options: [
          {
            name: "name",
            type: "string",
            valueLabel: "ИМЯ",
            description: "Имя подключения, по умолчанию default.",
          },
          { name: "url", type: "string", valueLabel: "АДРЕС", description: "Адрес сервера HCM." },
          {
            name: "username",
            type: "string",
            valueLabel: "ЛОГИН",
            description: "Имя пользователя сервера.",
          },
          {
            name: "password-env",
            type: "string",
            valueLabel: "ПЕРЕМЕННАЯ",
            description: "Имя переменной окружения с паролем.",
          },
          { name: "allow-write", type: "boolean", description: "Включить право записи (write)." },
          {
            name: "allow-execute",
            type: "boolean",
            description: "Включить право выполнения кода (execute).",
          },
          {
            name: "force",
            type: "boolean",
            description: "Перезаписать существующее подключение с тем же именем.",
          },
        ],
        notes: [
          "В терминале спрашивает адрес, логин и пароль; без терминала нужны --url, --username и --password-env ИМЯ или --password-stdin.",
          "Файл по умолчанию — ~/.wtctl/connections.json; другой задают --config или WTCTL_CONFIG.",
        ],
      },
      {
        name: "list",
        summary: "Показать подключения из файла без паролей.",
        usage: ["wtctl config list"],
        notes: ["Показывает подключения, адреса, права и источник учётных данных без паролей."],
      },
      {
        name: "set",
        noOutput: true,
        summary: "Изменить параметры существующего подключения.",
        usage: [
          "wtctl config set [ИМЯ] [--write true|false] [--execute true|false] [--default] [--url АДРЕС] [--timeout-ms N]",
        ],
        options: [
          {
            name: "write",
            type: "string",
            valueLabel: "true|false",
            values: ["true", "false"],
            description: "Включить или отключить право записи.",
          },
          {
            name: "execute",
            type: "string",
            valueLabel: "true|false",
            values: ["true", "false"],
            description: "Включить или отключить право выполнения кода.",
          },
          {
            name: "default",
            type: "boolean",
            description: "Сделать подключение подключением по умолчанию.",
          },
          { name: "url", type: "string", valueLabel: "АДРЕС", description: "Новый адрес сервера." },
          {
            name: "timeout-ms",
            type: "string",
            valueLabel: "N",
            description: "Таймаут запросов к серверу в миллисекундах.",
          },
          {
            name: "max-response-bytes",
            type: "string",
            valueLabel: "N",
            description: "Предел размера ответа сервера в байтах.",
          },
          {
            name: "output-limit-bytes",
            type: "string",
            valueLabel: "N",
            description: "Предел размера вывода в байтах.",
          },
          {
            name: "runtime-dir",
            type: "string",
            valueLabel: "ПАПКА",
            description: "Папка для сохранённых результатов и журнала записей.",
          },
          {
            name: "results-max-bytes",
            type: "string",
            valueLabel: "N",
            description: "Предел размера сохранённых результатов в байтах.",
          },
          {
            name: "results-max-age-days",
            type: "string",
            valueLabel: "N",
            description: "Срок хранения результатов в днях.",
          },
          {
            name: "journal-max-bytes",
            type: "string",
            valueLabel: "N",
            description: "Предел размера журнала записей в байтах.",
          },
        ],
        notes: [
          "Не принимает --output: путь файла подключений задаёт --config.",
          "Учётные данные меняет wtctl config init --name ИМЯ --force: запись заменяется целиком, параметры и права задаются заново.",
        ],
      },
      {
        name: "use",
        noOutput: true,
        summary: "Переключить подключение по умолчанию.",
        usage: ["wtctl config use ИМЯ"],
        notes: ["Не принимает --output и --password-stdin; путь файла задаёт --config."],
      },
      {
        name: "remove",
        noOutput: true,
        aliases: ["rm"],
        summary: "Удалить подключение из файла (синоним rm).",
        usage: ["wtctl config remove ИМЯ"],
        notes: [
          "Синоним: wtctl config rm ИМЯ. Вопрос [y/N] появляется, только когда stdin, stdout и stderr подключены к терминалу (без вопроса — --yes); иначе выполняется сразу.",
          "Не принимает --output и --password-stdin; путь файла задаёт --config.",
        ],
      },
      {
        name: "path",
        summary: "Показать путь к файлу подключений и проверить, существует ли файл.",
        usage: ["wtctl config path"],
      },
      {
        name: "example",
        summary: "Показать пример файла подключений.",
        usage: ["wtctl config example"],
      },
    ],
    notes: [
      "Файл по умолчанию — ~/.wtctl/connections.json; другой задают --config или WTCTL_CONFIG.",
    ],
  },
  {
    name: "api",
    group: "config",
    summary: "Остальные операции: list, describe, call.",
    subcommands: [
      {
        name: "list",
        summary: "Список операций и карта по темам.",
        usage: [
          "wtctl api list",
          "wtctl api list --topic ТЕМА | --query ТЕКСТ [--effect read|write|execute|unknown] [--limit N] [--cursor N]",
        ],
        options: [
          { name: "topic", type: "string", valueLabel: "ТЕМА", description: "Фильтр по теме." },
          {
            name: "query",
            type: "string",
            valueLabel: "ТЕКСТ",
            description: "Поиск по ID, названию и описанию.",
          },
          { name: "group", type: "string", valueLabel: "ГРУППА", description: "Фильтр по группе." },
          {
            name: "effect",
            type: "string",
            valueLabel: "ЭФФЕКТ",
            values: ["read", "write", "execute", "unknown"],
            description: "Фильтр по эффекту: read, write, execute или unknown.",
          },
          limitOption("Количество операций на странице, до 100."),
          cursorOption(),
          {
            name: "offline",
            type: "boolean",
            description: "Сохранён для совместимости: список всегда читается локально.",
          },
        ],
        notes: [
          "Без фильтров показывает темы и ID операций.",
          "Читает список из пакета без настроек подключения и обращения к серверу.",
        ],
      },
      {
        name: "describe",
        summary: "Описание операции и схема её аргументов.",
        usage: ["wtctl api describe ОПЕРАЦИЯ"],
        options: [
          {
            name: "offline",
            type: "boolean",
            description: "Сохранён для совместимости: описание всегда читается локально.",
          },
        ],
        notes: ["Читает описание из пакета без настроек подключения и обращения к серверу."],
      },
      {
        name: "call",
        summary: "Вызвать операцию по её ID.",
        usage: [
          String.raw`wtctl api call ОПЕРАЦИЯ (--input-file args.json | --stdin | --args '{\"id\":\"…\"}')`,
        ],
        options: inputOptions(
          "Файл JSON с аргументами операции.",
          "Прочитать аргументы операции JSON из stdin.",
          "Аргументы операции JSON строкой.",
        ),
        notes: ["Интерактивного подтверждения CLI нет; права проверяются по эффекту операции."],
      },
    ],
    notes: [
      "list без фильтров показывает темы и ID операций.",
      "list и describe читают список из пакета без настроек подключения и обращения к серверу.",
    ],
  },
  {
    name: "mcp",
    group: "config",
    summary: "MCP-сервер для агента (stdio).",
    usage: ["wtctl --config ФАЙЛ --connection ИМЯ mcp"],
    notes: [
      "Пароль берётся из файла подключений или переменной окружения: stdin занят протоколом.",
    ],
  },
  {
    name: "guide",
    group: "config",
    summary: "Гайд по работе с клиентом.",
    usage: ["wtctl guide", "wtctl guide ТЕМА"],
    notes: [
      "Без темы — общий порядок и список тем.",
      `Темы: ${guideTopics().slice(1).join(", ")}.`,
      "Печатает текст; с --json — обычный ответ с полем data.text.",
      "К серверу не обращается.",
    ],
  },
  {
    name: "completion",
    group: "config",
    summary: "Автодополнение команд для pwsh, bash и zsh.",
    usage: ["wtctl completion pwsh|bash|zsh"],
    notes: [
      "PowerShell: wtctl completion pwsh --format raw | Out-String | Invoke-Expression",
      'bash: eval "$(wtctl completion bash --format raw)"; zsh (после compinit): eval "$(wtctl completion zsh --format raw)"',
      "Рассчитано на установленную команду wtctl в PATH (не npx -y wtctl). К серверу не обращается.",
    ],
  },
  {
    name: "version",
    group: "config",
    summary: "Версия клиента.",
    usage: ["wtctl version"],
  },
];

export const DEFAULT_CLI_REGISTRY: ParseRegistry = {
  globalOptions: GLOBAL_OPTIONS,
  commands: CLI_COMMANDS,
};

const COMMAND_MAP = new Map<string, CommandSpec>(
  CLI_COMMANDS.map((command) => [command.name, command]),
);

/** Видимые команды, упорядоченные по логическим группам главного экрана справки. */
export function visibleCommands(commands: readonly CommandSpec[] = CLI_COMMANDS): CommandSpec[] {
  return COMMAND_GROUPS.flatMap((group) =>
    commands.filter((command) => !command.hidden && command.group === group.id),
  );
}

/** Поиск команды по точному имени, включая скрытые синонимы (защищён от свойств Object.prototype). */
export function lookupCommand(
  name: string,
  commands: readonly CommandSpec[] = CLI_COMMANDS,
): CommandSpec | undefined {
  if (commands === CLI_COMMANDS) return COMMAND_MAP.get(name);
  return commands.find((command) => command.name === name);
}

/** Поиск вложенной подкоманды по имени или синониму. */
export function lookupSubcommand(command: CommandSpec, name: string): SubcommandSpec | undefined {
  return command.subcommands?.find(
    (sub) => sub.name === name || (sub.aliases?.includes(name) ?? false),
  );
}

/** Все строки использования команды в порядке подкоманд, затем строки прямого вызова. */
export function commandUsageLines(command: CommandSpec): string[] {
  return [...(command.subcommands?.flatMap((sub) => sub.usage) ?? []), ...(command.usage ?? [])];
}

/** Формат флага для справки: `-c, --connection ИМЯ`, `--config ФАЙЛ`, `-q, --quiet`. */
export function formatOptionFlag(option: OptionSpec): string {
  const names = option.short ? `-${option.short}, --${option.name}` : `--${option.name}`;
  return option.valueLabel ? `${names} ${option.valueLabel}` : names;
}
