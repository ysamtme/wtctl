#!/usr/bin/env node
import { createRequire as __wtctlRequire } from "node:module";
const require = __wtctlRequire(import.meta.url);
import {
  HcmRuntime,
  ReplyPacker,
  ResultStore,
  buildLogFollowCursor,
  maxLogTailBytes,
  parseLogEvents,
  sliceEventsAfterCursorToken
} from "../chunks/chunk-UQHEU7II.js";
import {
  VERSION,
  discoverOperations,
  errorInFrontendTerms,
  guide,
  guideTopics,
  operationHelp
} from "../chunks/chunk-4XO2XZDA.js";
import {
  HcmError,
  MAX_CONFIG_BYTES,
  XmlDocument,
  configExample,
  defaultConfigPath,
  describeHcmOperation,
  fileExistsUrl,
  isSimilarName,
  listConnections,
  listHcmOperations,
  loadConfigWithDefaults,
  logEntry,
  markServedByMcp,
  operationEffect,
  parseConfiguration,
  removeConnection,
  rpcValue,
  sameData,
  saveLocalFile,
  similarHint,
  updateConnection,
  withConnection,
  withoutFalseOffset
} from "../chunks/chunk-T672SCY6.js";
import "../chunks/chunk-VCNJKZJ7.js";
import {
  ArgumentError,
  buildXml,
  findXmlNode,
  parsePhysicalDocumentId,
  rawXmlElement,
  resolvePhysicalDocumentLocation,
  unwrapLoadDocSoapXml
} from "../chunks/chunk-JZ7VTFSJ.js";
import "../chunks/chunk-LV7Y4FOL.js";

// src/cli/bin.ts
import process6 from "node:process";

// src/cli/run.ts
import { resolve as resolve5 } from "node:path";

// src/cli/registry.ts
var COMMAND_GROUPS = [
  { id: "connection", title: "Подключение и сервер" },
  { id: "data", title: "Данные и схема" },
  { id: "code", title: "Код и библиотеки" },
  { id: "files", title: "Файлы и логи" },
  { id: "config", title: "Настройка и прочее" }
];
var GLOBAL_OPTIONS = [
  { name: "config", type: "string", valueLabel: "ФАЙЛ", description: "Файл подключений." },
  {
    name: "connection",
    short: "c",
    type: "string",
    valueLabel: "ИМЯ",
    description: "Подключение из файла."
  },
  {
    name: "output",
    short: "o",
    type: "string",
    valueLabel: "ФАЙЛ",
    description: "Сохранить полный ответ в файл."
  },
  {
    name: "format",
    type: "string",
    valueLabel: "ВИД",
    values: ["auto", "table", "json", "jsonl", "csv", "tsv", "raw"],
    description: "Формат вывода: auto, table, json, jsonl, csv, tsv, raw."
  },
  { name: "json", type: "boolean", description: "Вывести в JSON (синоним --format json)." },
  { name: "quiet", short: "q", type: "boolean", description: "Без лишних сообщений в stderr." },
  { name: "yes", short: "y", type: "boolean", description: "Подтверждать действия без вопроса." },
  {
    name: "password-stdin",
    type: "boolean",
    description: "Прочитать пароль подключения из stdin."
  },
  { name: "help", short: "h", type: "boolean", description: "Показать справку." },
  { name: "version", short: "v", type: "boolean", description: "Показать версию клиента." }
];
var inputFileOption = (description) => ({
  name: "input-file",
  short: "i",
  type: "string",
  valueLabel: "ФАЙЛ",
  description
});
var stdinOption = (description) => ({
  name: "stdin",
  type: "boolean",
  description
});
var argsOption = (description, valueLabel = "JSON") => ({
  name: "args",
  type: "string",
  valueLabel,
  description
});
var inputOptions = (fileDesc, stdinDesc, argsDesc, argsLabel = "JSON") => [
  inputFileOption(fileDesc),
  stdinOption(stdinDesc),
  argsOption(argsDesc, argsLabel)
];
var limitOption = (description) => ({
  name: "limit",
  short: "n",
  type: "string",
  valueLabel: "N",
  description
});
var cursorOption = (description = "Смещение следующей страницы из ответа.") => ({
  name: "cursor",
  type: "string",
  valueLabel: "N",
  description
});
var offsetOption = (description = "Смещение от начала списка.") => ({
  name: "offset",
  type: "string",
  valueLabel: "N",
  description
});
var searchOption = (description) => ({
  name: "search",
  short: "s",
  type: "string",
  valueLabel: "ТЕКСТ",
  description
});
var OBJECT_TARGET_OPTIONS = [
  { name: "id", type: "string", valueLabel: "ID", description: "ID объекта." },
  { name: "url", type: "string", valueLabel: "АДРЕС", description: "Адрес документа объекта." },
  { name: "type", type: "string", valueLabel: "ТИП", description: "Тип объекта для проверки." },
  {
    name: "db-name",
    type: "string",
    valueLabel: "БАЗА",
    description: "База данных, если не основная."
  }
];
var UPLOAD_OPTIONS = [
  inputFileOption("Локальный файл для загрузки."),
  stdinOption("Прочитать содержимое файла из stdin."),
  {
    name: "name",
    type: "string",
    valueLabel: "ИМЯ",
    description: "Имя файла на сервере (по умолчанию имя локального файла)."
  },
  {
    name: "content-type",
    type: "string",
    valueLabel: "ТИП",
    description: "MIME-тип файла, например text/plain."
  }
];
var SET_OPTIONS = [
  {
    name: "set",
    short: "s",
    type: "string",
    repeatable: true,
    valueLabel: "ПУТЬ=ЗНАЧЕНИЕ",
    description: "Задать поле строкой; флаг повторяемый."
  },
  {
    name: "set-json",
    type: "string",
    repeatable: true,
    valueLabel: "ПУТЬ=JSON",
    description: "Задать поле значением JSON; флаг повторяемый."
  }
];
var LOG_RANGE_OPTIONS = [
  {
    name: "tail-bytes",
    type: "string",
    valueLabel: "N",
    description: "Прочитать последние N байт файла."
  },
  { name: "full", type: "boolean", description: "Прочитать файл целиком." }
];
var WS_NOTES = ["timeout-ms от 250 до 10000, по умолчанию 5000."];
var DOC_NOTES = [
  "Для объектов удобнее object: он сохраняет остальное содержимое документа.",
  "put с --args JSON задаёт все параметры операции native.lds.putDoc."
];
var FILE_ALIAS_NOTES = [
  "file upload сохранён для совместимости; основная команда — wtctl files upload.",
  "В ответе url — адрес файла, folderUrl — папка, созданная для него."
];
var LOG_UNAVAILABLE_NOTE = "LOG_READ_UNAVAILABLE — сервер сейчас пишет в этот файл: повторить чуть позже.";
var CLI_COMMANDS = [
  // Подключение и сервер
  {
    name: "status",
    group: "connection",
    summary: "Адрес и версия сервера, база данных, пользователь и права подключения.",
    usage: ["wtctl status"]
  },
  {
    name: "check",
    group: "connection",
    summary: "Проверка подключения по шагам.",
    usage: ["wtctl check"],
    notes: [
      "Шаги: вход, версия, запрос, документ, схема, библиотеки, логи, портал, выполнение кода (пропускается без права execute).",
      "Ничего не записывает.",
      "При сбое хотя бы одного шага код выхода 1."
    ]
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
            description: "Профиль протокола сервера: native или web."
          }
        ]
      }
    ]
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
            description: "Ожидание ответа в миллисекундах: от 250 до 10000, по умолчанию 5000."
          }
        ]
      }
    ],
    notes: WS_NOTES
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
      cursorOption()
    ],
    notes: [
      'customFields "by kind" — настраиваемые поля у каждого вида объекта свои: schema ТИП --kind ID.'
    ]
  },
  {
    name: "schema",
    group: "data",
    summary: "Поля типа объекта.",
    usage: [
      "wtctl schema (ТИП [ТЕКСТ | --search ТЕКСТ] | --url АДРЕС [--search ТЕКСТ]) [--path ПУТЬ] [--deep] [--origin own,inherited,custom,catalog] [--kind ID] [--include methods] [--language ЯЗЫК] [--limit N] [--cursor N]"
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
        description: "Происхождение: own, inherited, custom, catalog."
      },
      { name: "kind", type: "string", valueLabel: "ID", description: "Вид объекта для полей." },
      {
        name: "include",
        type: "string",
        valueLabel: "СПИСОК",
        description: "Дополнительные разделы, например methods."
      },
      { name: "language", type: "string", valueLabel: "ЯЗЫК", description: "Язык заголовков." },
      limitOption("Полей на странице: по умолчанию 80, до 1000."),
      cursorOption()
    ],
    notes: [
      "Без --search показывает верхний уровень, с ним ищет на любой глубине.",
      "query:true — поле есть в каталоге и годится для query; computed:true — вычисляемое.",
      "cutBySize — страница короче запрошенной."
    ]
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
      "wtctl query -i query.json"
    ],
    options: [
      {
        name: "catalog",
        type: "string",
        valueLabel: "КАТАЛОГ",
        description: "Каталог для поиска."
      },
      {
        name: "where",
        short: "w",
        type: "string",
        repeatable: true,
        valueLabel: "УСЛОВИЕ",
        description: "Условие поле=значение, поле:op=значение или JSON; повторяемый."
      },
      {
        name: "fields",
        short: "f",
        type: "string",
        valueLabel: "ПОЛЯ",
        description: "Поля через запятую."
      },
      {
        name: "order",
        type: "string",
        valueLabel: "ПОЛЯ",
        description: "Сортировка по каталогу; «поле desc» — по убыванию."
      },
      limitOption("Строк на странице: по умолчанию 20, не больше 1000."),
      {
        name: "start-position",
        type: "string",
        valueLabel: "N",
        description: "Смещение следующей страницы."
      },
      {
        name: "all",
        type: "boolean",
        description: "Все страницы (csv/tsv/jsonl/raw потоком)."
      },
      {
        name: "page-size",
        type: "string",
        valueLabel: "N",
        description: "Страница с --all: 200 (до 1000)."
      },
      {
        name: "max-rows",
        type: "string",
        valueLabel: "N",
        description: "Максимум строк с --all."
      },
      ...inputOptions(
        "Файл where, аргументов JSON или XQuery.",
        "Прочитать ввод из stdin.",
        "Ввод аргументом."
      )
    ],
    notes: [
      "-w: =, !=, ~ (подстрока), >, >=, <, <=, :in=a,b, JSON; без кавычек в bash/cmd: :eq=, :ne=, :contains=, :gt=, :gte=, :lt=, :lte=.",
      "С каталогом ввод — where; без него — JSON {catalog|query, ...} или XQuery.",
      "--all читает все страницы (--page-size, --max-rows; с --limit несовместим); неполная страница — QUERY_INCOMPLETE.",
      "Ответ: items, total, nextStartPosition. XQuery требует права execute."
    ]
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
          "wtctl object get --ids ID,ID,… [--type ТИП] [--fields id,name]"
        ],
        options: [
          ...OBJECT_TARGET_OPTIONS,
          {
            name: "ids",
            type: "string",
            valueLabel: "ID,ID,…",
            description: "Несколько ID через запятую, до 100."
          },
          {
            name: "fields",
            short: "f",
            type: "string",
            valueLabel: "ПОЛЯ",
            description: "Список полей через запятую."
          }
        ],
        notes: [
          "ТИП перед ID не обязателен: с ним команда проверяет, что объект этого типа.",
          "Позиционно или в --ids можно передать до 100 ID. --db-name задаёт базу, если не основная."
        ]
      },
      {
        name: "create",
        summary: "Создать новый объект.",
        usage: [
          "wtctl object create ТИП -s путь=значение [--set-json путь=JSON]",
          String.raw`wtctl object create ТИП (--input-file object.json | --stdin | --args '{\"name\":\"…\"}')`
        ],
        options: [
          ...SET_OPTIONS,
          ...inputOptions(
            "Файл JSON с полями нового объекта.",
            "Прочитать JSON объекта из stdin.",
            "JSON объекта строкой аргумента."
          ),
          {
            name: "form-url",
            type: "string",
            valueLabel: "АДРЕС",
            description: "Адрес формы XMD, если отличается от штатной."
          },
          {
            name: "db-name",
            type: "string",
            valueLabel: "БАЗА",
            description: "База данных, если не основная."
          }
        ],
        notes: [
          "Поля задаются через -s/--set, --set-json (вложенные пути через точку), --input-file, --stdin или --args.",
          "Ответ — id нового объекта и mutationOutcome."
        ]
      },
      {
        name: "patch",
        summary: "Изменить поля существующего объекта.",
        usage: [
          "wtctl object patch [ТИП] ID -s путь=значение [--set-json путь=JSON] [--remove путь] [--preview]",
          "wtctl object patch [ТИП] ID --input-file patch.json [--preview] [--resave] [--expected-fingerprint ОТПЕЧАТОК]"
        ],
        options: [
          ...OBJECT_TARGET_OPTIONS,
          ...SET_OPTIONS,
          {
            name: "remove",
            type: "string",
            repeatable: true,
            valueLabel: "ПУТЬ",
            description: "Удалить поле по пути; флаг повторяемый."
          },
          ...inputOptions(
            "Файл JSON с правкой.",
            "Прочитать JSON правки из stdin.",
            "JSON правки строкой аргумента."
          ),
          { name: "preview", type: "boolean", description: "Показать изменения без записи." },
          {
            name: "resave",
            type: "boolean",
            description: "Сохранить документ и без правок; можно без JSON."
          },
          {
            name: "expected-fingerprint",
            type: "string",
            valueLabel: "ОТПЕЧАТОК",
            description: "Ожидаемый отпечаток документа для защиты от перезаписи."
          }
        ],
        notes: [
          "patch.json — {путь: значение}, [{op:'set'|'remove', path, value}] или {patch:{…}, remove:[пути]}.",
          "Путь: name; a.b; items[0]; custom_elems.custom_elem[name=код].value.",
          "Флаги -s/--set, --set-json и --remove сочетаются с --input-file, --preview и --resave.",
          "Объект можно задать и флагами: (--id ID | --url АДРЕС) [--type ТИП] вместо [ТИП] ID.",
          "Правка, которая ничего не меняет, не записывается (noop:true). Ответ — changes и mutationOutcome."
        ]
      },
      {
        name: "edit",
        noOutput: true,
        summary: "Открыть поля или XML объекта в редакторе.",
        usage: [
          'wtctl object edit [ТИП] ID [-f ПОЛЯ] [--editor "code --wait"]',
          'wtctl object edit [ТИП] ID --xml [--editor "code --wait"]'
        ],
        options: [
          ...OBJECT_TARGET_OPTIONS,
          {
            name: "fields",
            short: "f",
            type: "string",
            valueLabel: "ПОЛЯ",
            description: "Список полей через запятую (без --xml)."
          },
          {
            name: "xml",
            type: "boolean",
            description: "Открыть исходный XML документа (native.lds.loadDoc/putDoc)."
          },
          {
            name: "editor",
            type: "string",
            valueLabel: "КОМАНДА",
            description: "Команда редактора (порядок выбора: --editor → WTCTL_EDITOR → VISUAL → EDITOR → notepad/vi)."
          }
        ],
        notes: [
          "Без --xml открывает поля в JSON, показывает предпросмотр и записывает с expectedFingerprint.",
          "С --xml открывает исходный XML; --xml и --fields несовместимы.",
          'Флаг ожидания вроде --wait задаётся внутри --editor или WTCTL_EDITOR (например, --editor "code --wait"). Подтверждение [y/N] отключает -y; --output не поддерживается.'
        ]
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
            description: "Подтвердить безвозвратное удаление без вопроса."
          },
          {
            name: "catalog",
            type: "string",
            valueLabel: "КАТАЛОГ",
            description: "Каталог проверки удаления, если у типа их несколько."
          }
        ],
        notes: [
          "Объект можно задать и флагами: (--id ID | --url АДРЕС) [--type ТИП] вместо [ТИП] ID.",
          "Вопрос [y/N] появляется, только когда stdin, stdout и stderr подключены к терминалу; иначе обязателен --permanent, даже при --yes.",
          "Ответ — mutationOutcome и verification."
        ]
      }
    ],
    notes: [
      "ТИП перед ID не обязателен: с ним команда проверяет, что объект этого типа.",
      "Путь (для patch): name; a.b; items[0]; custom_elems.custom_elem[name=код].value.",
      "Ввод: -s/--set, --set-json, --input-file, --stdin, --args (для patch также --remove, --preview, --resave).",
      "get, patch, edit и delete принимают (--id ID | --url АДРЕС) [--type ТИП] вместо [ТИП] ID."
    ]
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
          "В терминале и с --format table|raw собирает XML; в JSON возвращает разобранную структуру native.lds.loadDoc. Исходный файл байт в байт читает files read АДРЕС --to ФАЙЛ."
        ]
      },
      {
        name: "put",
        summary: "Записать XML документа по адресу.",
        usage: ["wtctl doc put АДРЕС --input-file document.xml"],
        options: inputOptions(
          "Файл XML с содержимым документа.",
          "Прочитать XML документа из stdin.",
          "Все параметры операции native.lds.putDoc в JSON."
        ),
        notes: DOC_NOTES
      },
      {
        name: "delete",
        summary: "Удалить документ по адресу.",
        usage: ["wtctl doc delete АДРЕС"],
        notes: [
          "Выполняется без интерактивного подтверждения и проверки каталога; для объектов безопаснее object delete."
        ]
      }
    ],
    notes: DOC_NOTES
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
      "wtctl exec --stdin"
    ],
    options: [
      ...inputOptions(
        "Файл с кодом SP-XML Script.",
        "Прочитать код из stdin.",
        "Код в аргументе команды.",
        "КОД"
      ),
      {
        name: "params",
        short: "p",
        type: "string",
        repeatable: true,
        valueLabel: "КЛЮЧ=ЗН|JSON",
        description: "Параметр PARAMS: ключ=значение (целые до 15 цифр, true, false и null распознаются автоматически) или JSON-объект; повторяемый."
      },
      {
        name: "param-json",
        type: "string",
        repeatable: true,
        valueLabel: "КЛЮЧ=JSON",
        description: String.raw`Параметр PARAMS значением JSON (строка в PowerShell и bash: 'x=\"5\"'); повторяемый.`
      },
      {
        name: "params-file",
        type: "string",
        valueLabel: "ФАЙЛ",
        description: "Файл JSON с параметрами кода (переменная PARAMS); несовместим с -p/--param-json."
      }
    ],
    notes: [
      "Код присваивает массив RESULT, например RESULT = [{name: doc.TopElem.name + ''}]; числа и логические приходят строками.",
      "String() в ответ не попадает, дата — не везде: приводить к строке так — x + '', StrDate(d).",
      "Ошибка кода — в error.details.scriptError. Нужно право execute; отката нет."
    ]
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
          "wtctl rpc list [ТЕКСТ | --query ТЕКСТ] [--library БИБЛИОТЕКА] [--method ФУНКЦИЯ] [--all] [--limit N] [--cursor N]"
        ],
        options: [
          {
            name: "query",
            short: "s",
            type: "string",
            valueLabel: "ТЕКСТ",
            description: "Поиск по имени библиотеки и функции."
          },
          {
            name: "library",
            type: "string",
            valueLabel: "БИБЛИОТЕКА",
            description: "Фильтр по имени библиотеки."
          },
          {
            name: "method",
            type: "string",
            valueLabel: "ФУНКЦИЯ",
            description: "Фильтр по имени функции."
          },
          {
            name: "all",
            type: "boolean",
            description: "Включить функции только для кода на сервере (serverOnly:true)."
          },
          limitOption("Количество функций на странице, до 100."),
          cursorOption()
        ],
        notes: [
          "Читает с сервера функции, разрешённые для вызова с клиента; --all добавляет те, что вызываются только из кода на сервере (serverOnly:true) — их вызывают через exec."
        ]
      },
      {
        name: "describe",
        summary: "Описание и код функции библиотеки.",
        usage: ["wtctl rpc describe БИБЛИОТЕКА.ФУНКЦИЯ [--source]"],
        options: [
          { name: "source", type: "boolean", description: "Включить исходный код функции." }
        ],
        notes: ["Показывает и клиентские, и серверные функции; --source добавляет код функции."]
      }
    ],
    usage: [
      "wtctl rpc БИБЛИОТЕКА.ФУНКЦИЯ [АРГУМЕНТЫ…] [--async]",
      String.raw`wtctl rpc tools get_version --args '[\"wtv\"]'`,
      "wtctl rpc БИБЛИОТЕКА ФУНКЦИЯ --input-file args.json [--async]"
    ],
    options: [
      ...inputOptions(
        "Файл JSON с массивом аргументов вызова.",
        "Прочитать массив аргументов JSON из stdin.",
        "Массив аргументов вызова в JSON."
      ),
      {
        name: "async",
        type: "boolean",
        description: "Запустить асинхронно (возвращает data.TrackingID для tasks status)."
      }
    ],
    notes: [
      "list читает клиентские функции; --all добавляет serverOnly:true (вызываются через exec).",
      "describe показывает и те, и другие; --source добавляет код функции.",
      "Позиционные аргументы: true/false/null и целые до 15 цифр приводятся, остальное (007, 1.5, 64-битные ID) — строкой; иные типы — через --args.",
      "Ответ — в data.value (с --async — data.TrackingID для wtctl tasks status). Для вызова нужно право execute."
    ]
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
          "wtctl agent run ID [--object ID | --objects ID,ID] [--no-wait | --wait-timeout-ms N] [--allow-concurrent] [--logs]"
        ],
        options: [
          {
            name: "object",
            type: "string",
            valueLabel: "ID",
            description: "ID объекта (в коде агента — OBJECT_ID)."
          },
          {
            name: "objects",
            type: "string",
            repeatable: true,
            valueLabel: "ID,ID,…",
            description: "ID объектов через запятую (OBJECTS_ID_STR); повторяемый."
          },
          {
            name: "no-wait",
            type: "boolean",
            description: "Запустить в фоне без ожидания завершения и сразу вернуть threadId."
          },
          {
            name: "wait-timeout-ms",
            type: "string",
            valueLabel: "N",
            description: "Предел ожидания завершения в миллисекундах: 1000–3600000, по умолчанию 120000."
          },
          {
            name: "allow-concurrent",
            type: "boolean",
            description: "Запустить параллельно, даже если этот агент уже выполняется."
          },
          {
            name: "logs",
            type: "boolean",
            description: "Показать события свежего лога за интервал работы агента (несовместим с --no-wait)."
          }
        ],
        notes: [
          "Запускает агента в отдельном потоке и по умолчанию ждёт завершения (до --wait-timeout-ms, по умолчанию 120000 мс); --no-wait возвращает threadId сразу.",
          "При таймауте ожидания отвечает AGENT_WAIT_TIMEOUT (mutationOutcome: confirmed): агент продолжает работу, состояние покажет wtctl agent status --thread ID.",
          "Ошибки кода и alert сервер пишет в лог xhttp между startedAt и finishedAt."
        ]
      },
      {
        name: "status",
        summary: "Показать текущие и недавно завершённые запуски агентов сервера.",
        usage: [
          "wtctl agent status [ID] [--thread ID] [--status running|finished|cancelled] [--limit N] [--wait [--wait-timeout-ms N]]"
        ],
        options: [
          {
            name: "thread",
            type: "string",
            valueLabel: "ID",
            description: "Фильтр по ID потока запуска."
          },
          {
            name: "status",
            type: "string",
            valueLabel: "СОСТОЯНИЕ",
            values: ["running", "finished", "cancelled"],
            description: "Фильтр по состоянию: running, finished или cancelled."
          },
          limitOption("Количество записей, 1–200, по умолчанию 20."),
          {
            name: "wait",
            type: "boolean",
            description: "Ждать завершения запуска (требует --thread)."
          },
          {
            name: "wait-timeout-ms",
            type: "string",
            valueLabel: "N",
            description: "Предел ожидания в миллисекундах: 1000–3600000, по умолчанию 120000 (только с --wait)."
          }
        ],
        notes: [
          "Работает без права execute; показывает выполняющиеся запуски и до 100 последних завершённых.",
          "С --thread ID --wait ждёт завершения или отмены указанного запуска."
        ]
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
            description: "Идентификатор роли сервера (на одиночном сервере 2025.2 — пустая строка --role=; без флага определяется по списку запусков)."
          }
        ],
        notes: [
          "Требует права write. Уже сделанные изменения не откатываются; сервер обрабатывает отмену в течение нескольких секунд.",
          "Вопрос [y/N] появляется, только когда stdin, stdout и stderr подключены к терминалу (без вопроса — --yes); иначе выполняется сразу."
        ]
      }
    ],
    notes: [
      "run запускает в отдельном потоке и по умолчанию ждёт завершения (--no-wait — сразу в фоне); status показывает запуски и ждёт по --thread --wait; cancel останавливает работающий поток."
    ]
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
            description: "Имя библиотеки."
          },
          {
            name: "method",
            type: "string",
            valueLabel: "ФУНКЦИЯ",
            description: "Имя функции библиотеки."
          }
        ],
        notes: [
          "Принимает БИБЛИОТЕКА.ФУНКЦИЯ, БИБЛИОТЕКА ФУНКЦИЯ, --library/--method или без аргументов.",
          "Сервер ищет по точному имени библиотеки и функции; в списке бывают чужие задачи."
        ]
      },
      {
        name: "status",
        summary: "Состояние и итог асинхронного вызова по TrackingID.",
        usage: ["wtctl tasks status ID"],
        notes: [
          "Итог завершённого вызова (IsRunning: 0) сервер выдаёт один раз и затем удаляет запись."
        ]
      },
      {
        name: "kill",
        summary: "Остановить асинхронный вызов по TrackingID.",
        usage: ["wtctl tasks kill ID"],
        notes: [
          "Уже сделанные изменения не откатываются. Вопрос [y/N] появляется, только когда stdin, stdout и stderr подключены к терминалу (без вопроса — --yes); иначе выполняется сразу."
        ]
      }
    ],
    notes: [
      "Асинхронный вызов запускает wtctl rpc БИБЛИОТЕКА.ФУНКЦИЯ --async (в ответе TrackingID).",
      "tasks status отдаёт итог завершённого вызова один раз, затем сервер удаляет запись."
    ]
  },
  {
    name: "run",
    group: "code",
    summary: "Несколько операций одним вызовом.",
    usage: ["wtctl run --input-file batch.json", "wtctl run --stdin"],
    options: inputOptions(
      "Файл JSON со списком шагов.",
      "Прочитать JSON со списком шагов из stdin.",
      "JSON со списком шагов в аргументе команды."
    ),
    notes: [
      "Файл: {steps:[{id, args?, as?}], stopOnError?}; as — имя шага (латинские буквы, цифры и _, не начинается с цифры).",
      "Значение из прошлого шага: {$ref:'имя_шага.data.id'}.",
      "Права проверяются для каждого шага. Интерактивных подтверждений CLI нет; это не транзакция (stopOnError:false продолжает после ошибки)."
    ]
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
          "wtctl files read АДРЕС --to ФАЙЛ [--overwrite]"
        ],
        options: [
          { name: "base64", type: "boolean", description: "Вернуть содержимое файла в base64." },
          {
            name: "to",
            type: "string",
            valueLabel: "ФАЙЛ",
            description: "Сохранить файл на диск байт в байт."
          },
          {
            name: "overwrite",
            type: "boolean",
            description: "Перезаписать существующий файл при --to."
          }
        ],
        notes: [
          "Без --to возвращает текст UTF-8 или base64; --to сохраняет на диск байт в байт любого размера."
        ]
      },
      {
        name: "exists",
        summary: "Проверить, существует ли файл на сервере.",
        usage: ["wtctl files exists АДРЕС"]
      },
      {
        name: "list",
        summary: "Показать файлы и папки одного уровня.",
        usage: ["wtctl files list АДРЕС [ТЕКСТ | --search ЧАСТЬ_ИМЕНИ]"],
        options: [searchOption("Фильтр по части имени файла или папки.")],
        notes: ["Показывает один уровень папки и требует права execute."]
      },
      {
        name: "write",
        summary: "Записать файл на сервер по адресу.",
        usage: ["wtctl files write АДРЕС (ФАЙЛ | --input-file ФАЙЛ | --stdin)"],
        options: [
          inputFileOption("Локальный файл для записи на сервер (читается частями)."),
          stdinOption("Прочитать содержимое файла из stdin (целиком в памяти).")
        ],
        notes: [
          "Читает ФАЙЛ частями и сверяет записанное; --stdin держит ввод в памяти. Имя с «-» передают как ./-файл или --input-file=ФАЙЛ. В папку кода нужно ещё право execute."
        ]
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
            description: "Команда редактора (порядок выбора: --editor → WTCTL_EDITOR → VISUAL → EDITOR → notepad/vi)."
          }
        ],
        notes: [
          "Скачивает текстовый файл во временную копию с тем же расширением, показывает diff (для файлов > 512 КиБ — изменение размера) и записывает после [y/N] (без вопроса — -y).",
          "Флаг ожидания вроде --wait задаётся внутри --editor или WTCTL_EDITOR; --output не поддерживается."
        ]
      },
      {
        name: "delete",
        summary: "Удалить файл на сервере.",
        usage: ["wtctl files delete АДРЕС [--permanent]"],
        options: [
          {
            name: "permanent",
            type: "boolean",
            description: "Удалить в терминале без интерактивного подтверждения."
          }
        ],
        notes: [
          "Вопрос [y/N] появляется, только когда stdin, stdout и stderr подключены к терминалу (без вопроса — --permanent или --yes); иначе выполняется сразу."
        ]
      },
      {
        name: "upload",
        summary: "Загрузить файл в папку загрузок сервера.",
        usage: [
          "wtctl files upload report.txt [--name ИМЯ] [--content-type text/plain]",
          "wtctl files upload ИМЯ --input-file report.txt [--content-type text/plain]"
        ],
        options: UPLOAD_OPTIONS,
        notes: [
          "Кладёт файл в папку загрузок сервера (в ответе url и folderUrl); имя с «-» передают как ./-файл или --input-file=ФАЙЛ. Прежнее имя file upload сохранено."
        ]
      }
    ],
    notes: [
      "read: text для UTF-8, иначе base64; --to сохраняет байт в байт любого размера, --overwrite заменяет.",
      "list показывает один уровень папки и требует права execute.",
      "write читает ФАЙЛ частями и сверяет; в папку кода нужно ещё право execute.",
      "upload кладёт файл в папку загрузок (в ответе url и folderUrl); file upload сохранён."
    ]
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
          "wtctl files upload ИМЯ --input-file report.txt [--content-type text/plain]"
        ],
        options: UPLOAD_OPTIONS,
        notes: FILE_ALIAS_NOTES
      }
    ],
    notes: FILE_ALIAS_NOTES
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
          "wtctl logs list [--type xhttp] [--date ГГГГ-ММ-ДД] [--name-contains ТЕКСТ] [--start-date Д] [--end-date Д] [--offset N] [--limit N]"
        ],
        options: [
          {
            name: "type",
            type: "string",
            valueLabel: "ТИП",
            description: "Имя лога без даты, например xhttp."
          },
          {
            name: "date",
            type: "string",
            valueLabel: "ГГГГ-ММ-ДД",
            description: "Файлы за одну дату."
          },
          {
            name: "start-date",
            type: "string",
            valueLabel: "ГГГГ-ММ-ДД",
            description: "Начальная дата диапазона."
          },
          {
            name: "end-date",
            type: "string",
            valueLabel: "ГГГГ-ММ-ДД",
            description: "Конечная дата диапазона."
          },
          {
            name: "name-contains",
            type: "string",
            valueLabel: "ТЕКСТ",
            description: "Часть имени файла лога."
          },
          offsetOption(),
          limitOption("Количество файлов, по умолчанию 30, до 1000.")
        ],
        notes: ["Показывает сначала свежие файлы, по умолчанию 30."]
      },
      {
        name: "read",
        summary: "Прочитать файл лога.",
        usage: ["wtctl logs read ФАЙЛ [--tail-bytes N | --full]"],
        options: LOG_RANGE_OPTIONS,
        notes: [
          "ФАЙЛ — имя из logs list или тип лога без .log (например xhttp, agent).",
          LOG_UNAVAILABLE_NOTE
        ]
      },
      {
        name: "tail",
        summary: "Показать конец файла лога или следить за ним.",
        usage: [
          "wtctl logs tail xhttp -n 20",
          "wtctl logs tail ФАЙЛ [-n N] [-f] [--interval СЕК] [--tail-bytes N]"
        ],
        options: [
          {
            name: "lines",
            short: "n",
            type: "string",
            valueLabel: "N",
            description: "Последние N событий, 1–10000 (в читаемом выводе без --tail-bytes по умолчанию 50)."
          },
          {
            name: "follow",
            short: "f",
            type: "boolean",
            description: "Продолжить следить за новыми событиями (несовместим с --json, --output и --format json|csv|tsv)."
          },
          {
            name: "interval",
            type: "string",
            valueLabel: "СЕК",
            description: "Интервал опроса (только с -f), 0.5–60 с (по умолчанию 2)."
          },
          LOG_RANGE_OPTIONS[0]
        ],
        notes: [
          "ФАЙЛ — имя из logs list или тип без .log (xhttp, agent). С -n в JSON-выводе возвращается data.text, а строки событий — с -n и --format jsonl|csv|tsv. С -f работает до Ctrl+C.",
          LOG_UNAVAILABLE_NOTE
        ]
      },
      {
        name: "search",
        summary: "Найти события в файле лога.",
        usage: [
          "wtctl logs search ФАЙЛ [ТЕКСТ | --text ТЕКСТ] [--level error] [--context ТЕКСТ] [--newest-first] [--tail-bytes N | --full] [--offset N] [--limit N] [--expected-fingerprint ОТПЕЧАТОК]"
        ],
        options: [
          {
            name: "text",
            type: "string",
            valueLabel: "ТЕКСТ",
            description: "Искомая подстрока в тексте события."
          },
          {
            name: "level",
            type: "string",
            valueLabel: "УРОВЕНЬ",
            values: ["normal", "debug", "info", "warning", "error", "critical"],
            description: "Уровень: normal, debug, info, warning, error или critical."
          },
          {
            name: "context",
            type: "string",
            valueLabel: "ТЕКСТ",
            description: "Фильтр по контексту события."
          },
          {
            name: "newest-first",
            type: "boolean",
            description: "Отдавать сначала последние события."
          },
          ...LOG_RANGE_OPTIONS,
          offsetOption("Смещение страницы событий (data.nextOffset из прошлого ответа)."),
          limitOption("Количество событий на странице, до 1000."),
          {
            name: "expected-fingerprint",
            type: "string",
            valueLabel: "ОТПЕЧАТОК",
            description: "Отпечаток файла (data.fingerprint из прошлого ответа) для следующей страницы."
          }
        ],
        notes: [
          "ФАЙЛ — имя из logs list или тип лога; ищет в конце файла, с --full — во всём файле.",
          "Для следующей страницы передаются --offset (data.nextOffset) и --expected-fingerprint (data.fingerprint).",
          LOG_UNAVAILABLE_NOTE
        ]
      },
      {
        name: "follow",
        summary: "Следить за новыми событиями файла лога.",
        usage: [
          "wtctl logs follow ФАЙЛ [--interval СЕК] [--once] [--cursor КУРСОР] [--tail-bytes N | --full]",
          "wtctl logs follow xhttp --once --json",
          "wtctl logs follow xhttp --format jsonl --interval 2"
        ],
        options: [
          {
            name: "interval",
            type: "string",
            valueLabel: "СЕК",
            description: "Интервал опроса, 0.5–60 с (по умолчанию 2; несовместим с --once и --json)."
          },
          {
            name: "once",
            type: "boolean",
            description: "Один опрос с возвратом data.cursor без цикла."
          },
          {
            name: "cursor",
            type: "string",
            valueLabel: "КУРСОР",
            description: "Курсор (data.cursor) из предыдущего ответа logs follow."
          },
          ...LOG_RANGE_OPTIONS
        ],
        notes: [
          "В терминале (с auto) и с --format table опрашивает циклом до Ctrl+C; с --format jsonl|raw поток включает --interval (без него — один опрос даже в терминале). Потоковый режим не принимает --output.",
          "Один опрос с data.cursor в JSON: --once --json (или при перенаправлении без --interval и --format table).",
          LOG_UNAVAILABLE_NOTE
        ]
      }
    ],
    notes: [
      "ФАЙЛ — имя из logs list или тип без .log (xhttp, agent): выбирается самый свежий файл.",
      "tail: 50 событий по умолчанию в терминале (-n N, -f); follow: цикл в терминале/table, поток jsonl|raw с --interval, один опрос с --once --json.",
      LOG_UNAVAILABLE_NOTE
    ]
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
            "Смещение от начала списка или текста (data.nextOffset для следующей части)."
          ),
          limitOption("Число элементов (до 1000) или символов (до 65536)."),
          {
            name: "format",
            type: "string",
            overridesGlobal: true,
            valueLabel: "ФОРМАТ",
            values: ["auto", "json", "text"],
            description: "Формат чтения: auto, json или text."
          }
        ],
        notes: [
          "Нужны то же подключение и runtimeDir; следующую часть читают с --offset из data.nextOffset.",
          "Список ответа (items, types, fields, results) — по элементам, до 1000; остальное — текстом, до 65536 символов.",
          "--format text выводит содержимое лога или файла."
        ]
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
            description: "Путь локального файла для сохранения."
          },
          {
            name: "format",
            type: "string",
            overridesGlobal: true,
            valueLabel: "ФОРМАТ",
            values: ["json", "jsonl", "text"],
            description: "Формат экспорта: json, jsonl или text."
          },
          { name: "overwrite", type: "boolean", description: "Перезаписать существующий файл." }
        ],
        notes: [
          "Нужны то же подключение и runtimeDir.",
          "--format jsonl — по строке на элемент списка; --format text сохраняет содержимое лога или файла."
        ]
      }
    ],
    notes: [
      "Когда в ответе meta.truncated, данные сохранены локально под meta.resultId, а в data.preview — их начало; сервер повторно не вызывается.",
      "--format text выводит и сохраняет содержимое лога или файла."
    ]
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
          "wtctl config init --name prod --url https://hcm.example.org --username admin --password-env WTCTL_PROD_PASSWORD"
        ],
        options: [
          {
            name: "name",
            type: "string",
            valueLabel: "ИМЯ",
            description: "Имя подключения, по умолчанию default."
          },
          { name: "url", type: "string", valueLabel: "АДРЕС", description: "Адрес сервера HCM." },
          {
            name: "username",
            type: "string",
            valueLabel: "ЛОГИН",
            description: "Имя пользователя сервера."
          },
          {
            name: "password-env",
            type: "string",
            valueLabel: "ПЕРЕМЕННАЯ",
            description: "Имя переменной окружения с паролем."
          },
          { name: "allow-write", type: "boolean", description: "Включить право записи (write)." },
          {
            name: "allow-execute",
            type: "boolean",
            description: "Включить право выполнения кода (execute)."
          },
          {
            name: "force",
            type: "boolean",
            description: "Перезаписать существующее подключение с тем же именем."
          }
        ],
        notes: [
          "В терминале спрашивает адрес, логин и пароль; без терминала нужны --url, --username и --password-env ИМЯ или --password-stdin.",
          "Файл по умолчанию — ~/.wtctl/connections.json; другой задают --config или WTCTL_CONFIG."
        ]
      },
      {
        name: "list",
        summary: "Показать подключения из файла без паролей.",
        usage: ["wtctl config list"],
        notes: ["Показывает подключения, адреса, права и источник учётных данных без паролей."]
      },
      {
        name: "set",
        noOutput: true,
        summary: "Изменить параметры существующего подключения.",
        usage: [
          "wtctl config set [ИМЯ] [--write true|false] [--execute true|false] [--default] [--url АДРЕС] [--timeout-ms N]"
        ],
        options: [
          {
            name: "write",
            type: "string",
            valueLabel: "true|false",
            values: ["true", "false"],
            description: "Включить или отключить право записи."
          },
          {
            name: "execute",
            type: "string",
            valueLabel: "true|false",
            values: ["true", "false"],
            description: "Включить или отключить право выполнения кода."
          },
          {
            name: "default",
            type: "boolean",
            description: "Сделать подключение подключением по умолчанию."
          },
          { name: "url", type: "string", valueLabel: "АДРЕС", description: "Новый адрес сервера." },
          {
            name: "timeout-ms",
            type: "string",
            valueLabel: "N",
            description: "Таймаут запросов к серверу в миллисекундах."
          },
          {
            name: "max-response-bytes",
            type: "string",
            valueLabel: "N",
            description: "Предел размера ответа сервера в байтах."
          },
          {
            name: "output-limit-bytes",
            type: "string",
            valueLabel: "N",
            description: "Предел размера вывода в байтах."
          },
          {
            name: "runtime-dir",
            type: "string",
            valueLabel: "ПАПКА",
            description: "Папка для сохранённых результатов и журнала записей."
          },
          {
            name: "results-max-bytes",
            type: "string",
            valueLabel: "N",
            description: "Предел размера сохранённых результатов в байтах."
          },
          {
            name: "results-max-age-days",
            type: "string",
            valueLabel: "N",
            description: "Срок хранения результатов в днях."
          },
          {
            name: "journal-max-bytes",
            type: "string",
            valueLabel: "N",
            description: "Предел размера журнала записей в байтах."
          }
        ],
        notes: [
          "Не принимает --output: путь файла подключений задаёт --config.",
          "Учётные данные меняет wtctl config init --name ИМЯ --force: запись заменяется целиком, параметры и права задаются заново."
        ]
      },
      {
        name: "use",
        noOutput: true,
        summary: "Переключить подключение по умолчанию.",
        usage: ["wtctl config use ИМЯ"],
        notes: ["Не принимает --output и --password-stdin; путь файла задаёт --config."]
      },
      {
        name: "remove",
        noOutput: true,
        aliases: ["rm"],
        summary: "Удалить подключение из файла (синоним rm).",
        usage: ["wtctl config remove ИМЯ"],
        notes: [
          "Синоним: wtctl config rm ИМЯ. Вопрос [y/N] появляется, только когда stdin, stdout и stderr подключены к терминалу (без вопроса — --yes); иначе выполняется сразу.",
          "Не принимает --output и --password-stdin; путь файла задаёт --config."
        ]
      },
      {
        name: "path",
        summary: "Показать путь к файлу подключений и проверить, существует ли файл.",
        usage: ["wtctl config path"]
      },
      {
        name: "example",
        summary: "Показать пример файла подключений.",
        usage: ["wtctl config example"]
      }
    ],
    notes: [
      "Файл по умолчанию — ~/.wtctl/connections.json; другой задают --config или WTCTL_CONFIG."
    ]
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
          "wtctl api list --topic ТЕМА | --query ТЕКСТ [--effect read|write|execute|unknown] [--limit N] [--cursor N]"
        ],
        options: [
          { name: "topic", type: "string", valueLabel: "ТЕМА", description: "Фильтр по теме." },
          {
            name: "query",
            type: "string",
            valueLabel: "ТЕКСТ",
            description: "Поиск по ID, названию и описанию."
          },
          { name: "group", type: "string", valueLabel: "ГРУППА", description: "Фильтр по группе." },
          {
            name: "effect",
            type: "string",
            valueLabel: "ЭФФЕКТ",
            values: ["read", "write", "execute", "unknown"],
            description: "Фильтр по эффекту: read, write, execute или unknown."
          },
          limitOption("Количество операций на странице, до 100."),
          cursorOption(),
          {
            name: "offline",
            type: "boolean",
            description: "Сохранён для совместимости: список всегда читается локально."
          }
        ],
        notes: [
          "Без фильтров показывает темы и ID операций.",
          "Читает список из пакета без настроек подключения и обращения к серверу."
        ]
      },
      {
        name: "describe",
        summary: "Описание операции и схема её аргументов.",
        usage: ["wtctl api describe ОПЕРАЦИЯ"],
        options: [
          {
            name: "offline",
            type: "boolean",
            description: "Сохранён для совместимости: описание всегда читается локально."
          }
        ],
        notes: ["Читает описание из пакета без настроек подключения и обращения к серверу."]
      },
      {
        name: "call",
        summary: "Вызвать операцию по её ID.",
        usage: [
          String.raw`wtctl api call ОПЕРАЦИЯ (--input-file args.json | --stdin | --args '{\"id\":\"…\"}')`
        ],
        options: inputOptions(
          "Файл JSON с аргументами операции.",
          "Прочитать аргументы операции JSON из stdin.",
          "Аргументы операции JSON строкой."
        ),
        notes: ["Интерактивного подтверждения CLI нет; права проверяются по эффекту операции."]
      }
    ],
    notes: [
      "list без фильтров показывает темы и ID операций.",
      "list и describe читают список из пакета без настроек подключения и обращения к серверу."
    ]
  },
  {
    name: "mcp",
    group: "config",
    summary: "MCP-сервер для агента (stdio).",
    usage: ["wtctl --config ФАЙЛ --connection ИМЯ mcp"],
    notes: [
      "Пароль берётся из файла подключений или переменной окружения: stdin занят протоколом."
    ]
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
      "К серверу не обращается."
    ]
  },
  {
    name: "completion",
    group: "config",
    summary: "Автодополнение команд для pwsh, bash и zsh.",
    usage: ["wtctl completion pwsh|bash|zsh"],
    notes: [
      "PowerShell: wtctl completion pwsh --format raw | Out-String | Invoke-Expression",
      'bash: eval "$(wtctl completion bash --format raw)"; zsh (после compinit): eval "$(wtctl completion zsh --format raw)"',
      "Рассчитано на установленную команду wtctl в PATH (не npx -y wtctl). К серверу не обращается."
    ]
  },
  {
    name: "version",
    group: "config",
    summary: "Версия клиента.",
    usage: ["wtctl version"]
  }
];
var DEFAULT_CLI_REGISTRY = {
  globalOptions: GLOBAL_OPTIONS,
  commands: CLI_COMMANDS
};
var COMMAND_MAP = new Map(
  CLI_COMMANDS.map((command) => [command.name, command])
);
function visibleCommands(commands = CLI_COMMANDS) {
  return COMMAND_GROUPS.flatMap(
    (group) => commands.filter((command) => !command.hidden && command.group === group.id)
  );
}
function lookupCommand(name, commands = CLI_COMMANDS) {
  if (commands === CLI_COMMANDS) return COMMAND_MAP.get(name);
  return commands.find((command) => command.name === name);
}
function lookupSubcommand(command, name) {
  return command.subcommands?.find(
    (sub) => sub.name === name || (sub.aliases?.includes(name) ?? false)
  );
}
function commandUsageLines(command) {
  return [...command.subcommands?.flatMap((sub) => sub.usage) ?? [], ...command.usage ?? []];
}
function formatOptionFlag(option) {
  const names = option.short ? `-${option.short}, --${option.name}` : `--${option.name}`;
  return option.valueLabel ? `${names} ${option.valueLabel}` : names;
}

// src/cli/arguments.ts
var IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
var RPC_TARGET_RE = /^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/;
var CliInputError = class extends Error {
  /** Команду справки к подсказке добавляет runCli: здесь команда ещё не известна. */
  constructor(message, hint) {
    super(message);
    this.hint = hint;
    this.name = "CliInputError";
  }
  code = "cli.invalid_input";
};
var SECRET_OPTION_RE = /(?:^|-)(?:pass|password|passwd|pwd|token|secret|key|apikey|auth|cookie|credentials?)(?:-|$)/i;
var EXACT_SECRET_WORD_RE = /^(?:pass|password|passwd|pwd|token|secret|key|apikey|auth|cookie|credentials?)$/i;
var PASSWORD_HINT = "Пароль в командной строке не принимается: его читают из переменной окружения, названной в подключении, или из stdin с --password-stdin.";
function parseShortToken(token, index) {
  if (!token.startsWith("-") || token.length < 2 || token.startsWith("--")) return void 0;
  const equals = token.indexOf("=");
  const raw = token.slice(1, equals < 0 ? void 0 : equals);
  if (raw.length === 1) {
    if (equals < 0 && /^\d$/.test(raw)) return void 0;
    return { raw, equals };
  }
  const lower = raw.toLowerCase();
  if (index.allLong.has(lower) || EXACT_SECRET_WORD_RE.test(lower)) return { raw, equals };
  return void 0;
}
function isNextFlagToken(token, index, longNames = index.allLong) {
  if (token.startsWith("--")) return true;
  const short = parseShortToken(token, index);
  if (!short) return false;
  if (short.raw.length === 1) return true;
  const lower = short.raw.toLowerCase();
  return longNames.has(lower) || EXACT_SECRET_WORD_RE.test(lower);
}
function recordShortType(map, option) {
  if (!option.short) return;
  const previous = map.get(option.short);
  if (previous === void 0) map.set(option.short, option.type);
  else if (previous !== option.type) map.set(option.short, "mixed");
}
function buildIndex(registry) {
  const globalByLong = /* @__PURE__ */ new Map();
  const globalByShort = /* @__PURE__ */ new Map();
  const commandByName = /* @__PURE__ */ new Map();
  const allLong = /* @__PURE__ */ new Map();
  const allShort = /* @__PURE__ */ new Map();
  const uniqueShortType = /* @__PURE__ */ new Map();
  for (const option of registry.globalOptions) {
    globalByLong.set(option.name, option);
    if (option.short) {
      globalByShort.set(option.short, option);
      if (!allShort.has(option.short)) allShort.set(option.short, option);
    }
    allLong.set(option.name, option);
    recordShortType(uniqueShortType, option);
  }
  for (const command of registry.commands) {
    commandByName.set(command.name, command);
    for (const option of command.options ?? []) {
      if (!allLong.has(option.name)) allLong.set(option.name, option);
      if (option.short && !allShort.has(option.short)) allShort.set(option.short, option);
      recordShortType(uniqueShortType, option);
    }
    for (const sub of command.subcommands ?? []) {
      for (const option of sub.options ?? []) {
        if (!allLong.has(option.name)) allLong.set(option.name, option);
        if (option.short && !allShort.has(option.short)) allShort.set(option.short, option);
        recordShortType(uniqueShortType, option);
      }
    }
  }
  return {
    globalByLong,
    globalByShort,
    commandByName,
    allLong,
    allLongNames: [...allLong.keys()],
    allShort,
    uniqueShortType
  };
}
var cachedDefaultIndex;
function getIndex(registry) {
  if (registry === DEFAULT_CLI_REGISTRY) {
    cachedDefaultIndex ??= buildIndex(DEFAULT_CLI_REGISTRY);
    return cachedDefaultIndex;
  }
  return buildIndex(registry);
}
function commandShortType(command, short) {
  if (!command) return void 0;
  let type;
  for (const option of [
    ...command.options ?? [],
    ...command.subcommands?.flatMap((sub) => sub.options ?? []) ?? []
  ]) {
    if (option.short !== short) continue;
    if (type === void 0) type = option.type;
    else if (type !== option.type) return void 0;
  }
  return type;
}
function distance(a, b) {
  const rows2 = Array.from(
    { length: a.length + 1 },
    (_, i) => Array.from({ length: b.length + 1 }, (_2, j) => i === 0 ? j : j === 0 ? i : 0)
  );
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(rows2[i - 1][j] + 1, rows2[i][j - 1] + 1, rows2[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        best = Math.min(best, rows2[i - 2][j - 2] + 1);
      rows2[i][j] = best;
    }
  return rows2[a.length][b.length];
}
function printableName(name) {
  return name.length <= 30 && /^[a-z]+(?:-[a-z]+)*$/i.test(name);
}
function unknownFlagError(label, near, raw) {
  const hint = [
    near ? `Похожий: --${near}.` : "",
    SECRET_OPTION_RE.test(raw) ? PASSWORD_HINT : ""
  ].filter(Boolean);
  return new CliInputError(`Неизвестный флаг ${label}.`, hint.join(" ") || void 0);
}
function unknownOption(name, scopeByLong, allLongNames) {
  if (!printableName(name)) return new CliInputError("Неизвестный флаг.");
  const lower = name.toLowerCase();
  const [near] = allLongNames.map((known) => ({ known, steps: distance(lower, known), inScope: scopeByLong.has(known) })).filter(({ known, steps }) => steps <= (Math.min(lower.length, known.length) > 4 ? 2 : 1)).sort((a, b) => a.steps - b.steps || Number(b.inScope) - Number(a.inScope));
  return unknownFlagError(`--${name}`, near?.known, name);
}
function unknownShortOption(raw, allLongNames) {
  if (!printableName(raw)) return new CliInputError("Неизвестный флаг.");
  const lower = raw.toLowerCase();
  const near = allLongNames.includes(lower) ? lower : void 0;
  return unknownFlagError(`-${raw}`, near, raw);
}
function commandOf(argv) {
  return locateCommand(argv, getIndex(DEFAULT_CLI_REGISTRY)).commandName;
}
function locateCommand(argv, index) {
  const found = [];
  let positionalOnly = false;
  let commandSpec;
  for (let i = 0; i < argv.length && found.length < 2; i++) {
    const value = argv[i];
    if (positionalOnly) {
      found.push(value);
      if (found.length === 1) commandSpec = index.commandByName.get(value);
      continue;
    }
    if (value === "--") {
      positionalOnly = true;
      continue;
    }
    if (value.startsWith("--")) {
      const equals = value.indexOf("=");
      const name = value.slice(2);
      if (equals < 0 && index.allLong.get(name)?.type === "string") {
        const nextFlags = name === "input-file" ? index.globalByLong : index.allLong;
        if (i + 1 < argv.length && !isNextFlagToken(argv[i + 1], index, nextFlags)) i++;
      }
      continue;
    }
    const shortToken = parseShortToken(value, index);
    if (shortToken) {
      if (shortToken.equals < 0 && shortToken.raw.length === 1) {
        const type = index.globalByShort.get(shortToken.raw)?.type ?? (found.length === 1 ? commandShortType(commandSpec, shortToken.raw) : index.uniqueShortType.get(shortToken.raw));
        const nextFlags = shortToken.raw === "i" ? index.globalByLong : index.allLong;
        const consumesValue = type === "string" || type === "mixed" && found.length === 0 && i + 1 < argv.length && !isNextFlagToken(argv[i + 1], index, nextFlags) && !index.commandByName.has(argv[i + 1]) && i + 2 < argv.length && index.commandByName.has(argv[i + 2]);
        if (consumesValue && i + 1 < argv.length && !isNextFlagToken(argv[i + 1], index, nextFlags))
          i++;
      }
      continue;
    }
    found.push(value);
    if (found.length === 1) commandSpec = index.commandByName.get(value);
  }
  const [commandName, second] = found;
  const subcommandSpec = second !== void 0 && commandSpec !== void 0 ? lookupSubcommand(commandSpec, second) : void 0;
  return { commandName, commandSpec, subcommandSpec };
}
function resolveScopeOptions(registry, located) {
  const scopeByLong = /* @__PURE__ */ new Map();
  const scopeByShort = /* @__PURE__ */ new Map();
  const add = (options) => {
    for (const option of options ?? []) {
      scopeByLong.set(option.name, option);
      if (option.short) scopeByShort.set(option.short, option);
    }
  };
  add(registry.globalOptions);
  const { commandName, commandSpec, subcommandSpec } = located;
  if (subcommandSpec !== void 0 && commandName !== void 0) {
    add(subcommandSpec.options);
    return {
      scopeByLong,
      scopeByShort,
      validateOptions: true,
      scopeLabel: `${commandName} ${subcommandSpec.name}`,
      requiresDirectCallArgs: false
    };
  }
  if (commandSpec !== void 0 && commandName !== void 0) {
    if (!commandSpec.subcommands) {
      add(commandSpec.options);
      return {
        scopeByLong,
        scopeByShort,
        validateOptions: true,
        scopeLabel: commandName,
        requiresDirectCallArgs: false
      };
    }
    if (commandSpec.call !== void 0) {
      add(commandSpec.options);
      return {
        scopeByLong,
        scopeByShort,
        validateOptions: true,
        scopeLabel: commandName,
        requiresDirectCallArgs: true
      };
    }
    return {
      scopeByLong,
      scopeByShort,
      validateOptions: false,
      scopeLabel: commandName,
      requiresDirectCallArgs: false
    };
  }
  if (commandName === void 0 || commandName === "help") {
    return {
      scopeByLong,
      scopeByShort,
      validateOptions: true,
      scopeLabel: commandName === "help" ? "help" : "",
      requiresDirectCallArgs: false
    };
  }
  return {
    scopeByLong,
    scopeByShort,
    validateOptions: false,
    scopeLabel: "",
    requiresDirectCallArgs: false
  };
}
function recordOption(result, spec, equals, token, argv, cursor, index, scopeByLong) {
  if (spec.type === "boolean") {
    if (equals >= 0) throw new CliInputError(`Флаг --${spec.name} пишется без значения.`);
    if (Object.hasOwn(result.options, spec.name))
      throw new CliInputError(`Флаг --${spec.name} повторяется.`);
    result.options[spec.name] = true;
    return;
  }
  const next = equals < 0 ? argv[++cursor.index] : token.slice(equals + 1);
  const nextFlags = spec.name === "input-file" ? scopeByLong : index.allLong;
  if (next === void 0 || next.length === 0 && !spec.allowEmpty || equals < 0 && isNextFlagToken(next, index, nextFlags)) {
    throw new CliInputError(`Для --${spec.name} требуется значение.`);
  }
  if (spec.repeatable) {
    const existing = result.options[spec.name];
    if (Array.isArray(existing)) existing.push(next);
    else result.options[spec.name] = [next];
    (result.optionOrder ??= []).push({ name: spec.name, value: next });
    return;
  }
  if (Object.hasOwn(result.options, spec.name))
    throw new CliInputError(`Флаг --${spec.name} повторяется.`);
  result.options[spec.name] = next;
}
function parseArguments(argv, registry = DEFAULT_CLI_REGISTRY) {
  const index = getIndex(registry);
  const located = locateCommand(argv, index);
  const scope = resolveScopeOptions(registry, located);
  const result = { positionals: [], options: {} };
  let positionalOnly = false;
  const cursor = { index: 0 };
  for (; cursor.index < argv.length; cursor.index++) {
    const value = argv[cursor.index];
    if (!positionalOnly && value === "--") {
      positionalOnly = true;
      continue;
    }
    if (positionalOnly) {
      result.positionals.push(value);
      continue;
    }
    if (value.startsWith("--")) {
      const equals = value.indexOf("=");
      const name = value.slice(2, equals < 0 ? void 0 : equals);
      const spec = scope.scopeByLong.get(name) ?? index.allLong.get(name);
      if (!spec) throw unknownOption(name, scope.scopeByLong, index.allLongNames);
      recordOption(result, spec, equals, value, argv, cursor, index, scope.scopeByLong);
      continue;
    }
    const shortToken = parseShortToken(value, index);
    if (shortToken) {
      const { raw, equals } = shortToken;
      const spec = raw.length === 1 ? scope.scopeByShort.get(raw) ?? (!scope.validateOptions ? index.allShort.get(raw) : void 0) : void 0;
      if (!spec) throw unknownShortOption(raw, index.allLongNames);
      recordOption(result, spec, equals, value, argv, cursor, index, scope.scopeByLong);
      continue;
    }
    result.positionals.push(value);
  }
  const sources = [result.options["input-file"], result.options.stdin, result.options.args].filter(
    Boolean
  );
  if (sources.length > 1)
    throw new CliInputError("Нужно выбрать один источник: --input-file, --stdin или --args.");
  if (result.options["password-stdin"] && result.options.stdin)
    throw new CliInputError(
      "--password-stdin и --stdin вместе не работают: stdin один.",
      "Ввод команды передаётся через --input-file или --args."
    );
  const localFormat = scope.scopeByLong.get("format")?.overridesGlobal === true;
  if (result.options.json && result.options.format !== void 0 && !localFormat)
    throw new CliInputError("Нужно выбрать --json или --format, а не оба.");
  if (result.options.help) {
    const [first, second] = result.positionals;
    const command = first === void 0 ? void 0 : index.commandByName.get(first);
    const hasSub = second !== void 0 && command !== void 0 && lookupSubcommand(command, second) !== void 0;
    result.positionals = first === void 0 ? ["help"] : hasSub ? ["help", first, second] : ["help", first];
    return result;
  }
  let allowed = scope.scopeByLong;
  let shouldValidate = scope.validateOptions && (!scope.requiresDirectCallArgs || result.positionals.length >= 3 || result.positionals.length === 2 && RPC_TARGET_RE.test(result.positionals[1]));
  let scopeLabel = scope.scopeLabel;
  if (result.options.version) {
    delete result.options.version;
    result.positionals = ["version", ...result.positionals];
    allowed = index.globalByLong;
    shouldValidate = true;
    scopeLabel = "version";
  }
  if (shouldValidate) {
    const extra = Object.keys(result.options).filter((key) => !allowed.has(key));
    if (extra.length) {
      const command = scopeLabel ? ` ${scopeLabel}` : "";
      throw new CliInputError(
        `Команда${command} не принимает: ${extra.map((key) => `--${key}`).join(", ")}.`
      );
    }
  }
  return result;
}
function stringOption(args, name) {
  const value = args.options[name];
  return typeof value === "string" ? value : void 0;
}
function repeatedOption(args, name) {
  const value = args.options[name];
  if (Array.isArray(value)) return value;
  return typeof value === "string" ? [value] : [];
}
function orderedOptions(args, names) {
  if (args.optionOrder) {
    const wanted = new Set(names);
    return args.optionOrder.filter((entry) => wanted.has(entry.name));
  }
  const fallback = [];
  for (const name of names) {
    for (const value of repeatedOption(args, name)) fallback.push({ name, value });
  }
  return fallback;
}
function listOption(args, name) {
  return stringOption(args, name)?.split(/[\s,]+/).filter(Boolean);
}
function orderOption(args) {
  return stringOption(args, "order")?.split(",").flatMap((part) => part.match(/\S+(?:\s+(?:asc|desc)(?=\s|$))?/gi) ?? []);
}
function integerOption(args, name, minimum = 0, maximum = 1e5) {
  const value = stringOption(args, name);
  if (value === void 0) return void 0;
  if (!/^\d+$/.test(value)) throw new CliInputError(`--${name} должен быть целым числом.`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new CliInputError(`--${name} должен быть от ${minimum} до ${maximum}.`);
  }
  return number;
}
function intervalOption(args, name = "interval", minimum = 0.5, maximum = 60) {
  const value = stringOption(args, name);
  if (value === void 0) return void 0;
  if (!/^\d+(?:\.\d+)?$/.test(value))
    throw new CliInputError(
      `--${name} должен быть числом в секундах (от ${minimum} до ${maximum}).`
    );
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new CliInputError(`--${name} должен быть от ${minimum} до ${maximum} секунд.`);
  }
  return number;
}
function requirePositional(args, index, label) {
  const value = args.positionals[index];
  if (!value) throw new CliInputError(`Не задан ${label}.`);
  return value;
}
function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    if (text.includes('\\"'))
      try {
        return JSON.parse(text.replaceAll('\\"', '"'));
      } catch {
      }
    throw new CliInputError(
      'Ввод — не JSON. В аргументе оболочка могла убрать кавычки: их можно написать как \\" или передать JSON файлом через --input-file.'
    );
  }
}
function jsonObject(text) {
  const value = parseJson(text);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new CliInputError("Нужен объект JSON, а не массив, строка или число.");
  }
  return value;
}
function exactPositionals(args, minimum, maximum = minimum) {
  if (args.positionals.length < minimum || args.positionals.length > maximum) {
    if (args.positionals.length < minimum)
      throw new CliInputError("Не хватает аргументов команды.");
    throw new CliInputError(
      "Лишние аргументы команды.",
      "Текст с пробелами, например запрос XQuery, берут в кавычки целиком."
    );
  }
}
function optional(key, value) {
  return value === void 0 ? {} : { [key]: value };
}
function enumOption(args, name, allowed, message) {
  const value = stringOption(args, name);
  if (value !== void 0 && !allowed.includes(value)) throw new CliInputError(message);
  return value;
}
function rejectPasswordStdin(args, message, hint) {
  if (args.options["password-stdin"]) throw new CliInputError(message, hint);
}
function usesLocalFormat(args) {
  const [command, action] = args.positionals;
  if (!command || !action) return false;
  const spec = lookupCommand(command);
  const sub = spec ? lookupSubcommand(spec, action) : void 0;
  return sub?.options?.some((option) => option.name === "format" && option.overridesGlobal === true) === true;
}
function usesLocalFormatArgv(argv) {
  const { subcommandSpec } = locateCommand(argv, getIndex(DEFAULT_CLI_REGISTRY));
  return subcommandSpec?.options?.some(
    (option) => option.name === "format" && option.overridesGlobal === true
  ) === true;
}

// src/cli/commands.ts
import { basename, resolve } from "node:path";

// src/cli/help.ts
var USAGE = "wtctl [--config ФАЙЛ] [-c ИМЯ] [--format ВИД | --json] КОМАНДА …";
var NOTES = [
  "Аргументы и примеры команды: wtctl help КОМАНДА [ПОДКОМАНДА].",
  "В терминале выводятся таблицы, сводки и текст; при перенаправлении (в скриптах и pipe) и с --json — JSON {ok, data, meta} (help, guide и completion без --json печатают текст).",
  "Форматы: table — читаемый вывод и при перенаправлении; jsonl — по объекту JSON на строку; raw — данные как есть. У result read/export свой --format.",
  "Код выхода: 0 — успех, 1 — ошибка операции, записи в stdout или закрытия сессии, 2 — ошибка аргументов, 3 — ответ сохранён локально (result read/export или --output).",
  "С --output в JSON сводка идёт в stdout (при ошибке в файл — ok:false); в остальных форматах — в stderr (если перенаправлены оба потока — в stdout; -q скрывает), при отказе файл не создаётся (кроме check/run); help/guide/completion без --json пишут без сводки.",
  "ID передаётся строкой: 0x… или десятичной записью. При коде 1, 3 или error.mutationOutcome = indeterminate запись не повторять без проверки объекта."
];
function helpCommand(command) {
  return command !== void 0 && command !== "help" && lookupCommand(command) !== void 0 ? `wtctl help ${command}` : "wtctl help";
}
function topic(command) {
  const spec = lookupCommand(command);
  if (spec !== void 0) return spec;
  const near = [...visibleCommands().map((item) => item.name), "help"].filter(
    (name) => isSimilarName(name, command)
  );
  throw new CliInputError(
    printableName(command) ? `Команды wtctl ${command} нет.` : "Неизвестная команда.",
    similarHint(near).trimEnd() || void 0
  );
}
function subcommandError(command, action) {
  const names = command.subcommands.map((sub) => sub.name);
  const list = `есть ${names.join(", ")}${command.call === void 0 ? "" : ` или вызов ${command.call}`}.`;
  return new CliInputError(
    action === void 0 ? `Не указана команда после wtctl ${command.name}: ${list}` : printableName(action) ? `Команды wtctl ${command.name} ${action} нет: ${list}` : `Неизвестная команда после wtctl ${command.name}: ${list}`
  );
}
function requireCommand([command = "", action, ...rest]) {
  const spec = topic(command);
  if (spec.subcommands === void 0 || action !== void 0 && lookupSubcommand(spec, action))
    return;
  if (spec.call !== void 0 && (rest.length > 0 || action !== void 0 && RPC_TARGET_RE.test(action)))
    return;
  throw subcommandError(spec, action);
}
function resolveTarget(command, subcommand) {
  const spec = topic(command);
  if (subcommand === void 0) return { spec };
  if (spec.subcommands === void 0) throw new CliInputError("Лишние аргументы команды.");
  const sub = lookupSubcommand(spec, subcommand);
  if (sub === void 0) throw subcommandError(spec, subcommand);
  return { spec, sub };
}
function optionLongKey(option) {
  return option.valueLabel ? `--${option.name} ${option.valueLabel}` : `--${option.name}`;
}
function optionMap(options) {
  if (!options?.length) return void 0;
  return Object.fromEntries(options.map((option) => [optionLongKey(option), option.description]));
}
function cliHelp(command, subcommand) {
  if (command === void 0) {
    const commands = visibleCommands();
    const globalOptions = optionMap(GLOBAL_OPTIONS);
    const options2 = {};
    for (const [key, description] of Object.entries(globalOptions)) {
      options2[key] = description;
      if (key === "--connection ИМЯ") {
        options2["--input-file ФАЙЛ | --stdin | --args JSON"] = "Откуда взять ввод команды; один источник.";
      }
    }
    return {
      usage: USAGE,
      groups: COMMAND_GROUPS.map((group) => ({
        title: group.title,
        commands: commands.filter((item) => item.group === group.id).map((item) => item.name)
      })),
      commands: Object.fromEntries(commands.map((item) => [item.name, item.summary])),
      options: options2,
      notes: NOTES
    };
  }
  const { spec, sub } = resolveTarget(command, subcommand);
  if (sub !== void 0) {
    const options2 = optionMap(sub.options);
    return {
      command,
      subcommand: sub.name,
      summary: sub.summary,
      usage: sub.usage,
      ...options2 === void 0 ? {} : { options: options2 },
      ...sub.notes?.length ? { notes: sub.notes } : {}
    };
  }
  const options = optionMap(spec.options);
  return {
    command,
    ...spec.subcommands ? {
      subcommands: Object.fromEntries(
        spec.subcommands.map((item) => [item.name, item.summary])
      )
    } : {},
    usage: commandUsageLines(spec),
    ...options === void 0 ? {} : { options },
    ...spec.notes?.length ? { notes: spec.notes } : {}
  };
}
function rows(pairs, minWidth = 0) {
  const width = Math.max(minWidth, ...pairs.map(([name]) => name.length));
  return pairs.map(([name, text]) => `  ${name.padEnd(width)}  — ${text}`);
}
function optionLines(options, heading = "Параметры:") {
  if (!options?.length) return [];
  return [
    "",
    heading,
    ...rows(options.map((option) => [formatOptionFlag(option), option.description]))
  ];
}
function cliHelpText(command, subcommand) {
  if (command === void 0) {
    const commands = visibleCommands();
    const width = Math.max(...commands.map((item) => item.name.length));
    const lines2 = [USAGE];
    for (const group of COMMAND_GROUPS) {
      const members = commands.filter((item) => item.group === group.id);
      if (!members.length) continue;
      lines2.push(
        "",
        `${group.title}:`,
        ...rows(
          members.map((item) => [item.name, item.summary]),
          width
        )
      );
    }
    lines2.push(...optionLines(GLOBAL_OPTIONS), "", ...NOTES);
    return `${lines2.join("\n")}
`;
  }
  const { spec, sub } = resolveTarget(command, subcommand);
  if (sub !== void 0) {
    const hasLocalFormat = sub.options?.some((o) => o.name === "format" && o.overridesGlobal);
    const globals = [
      "-c",
      ...hasLocalFormat ? [] : ["--format"],
      "--json",
      ...sub.noOutput ? [] : ["-o"],
      "-q",
      "-y"
    ];
    const globalList = globals.join(", ");
    const lines2 = [
      `wtctl ${command} ${sub.name} — ${sub.summary}`,
      "",
      ...sub.usage.map((line) => `  ${line}`),
      ...optionLines(sub.options),
      ...sub.notes?.length ? ["", ...sub.notes] : [],
      "",
      `Общие параметры (${globalList}): wtctl help.`
    ];
    return `${lines2.join("\n")}
`;
  }
  if (spec.subcommands !== void 0) {
    const lines2 = [
      `wtctl ${command} — ${spec.summary}`,
      "",
      "Подкоманды:",
      ...rows(spec.subcommands.map((item) => [item.name, item.summary])),
      "",
      "Использование:",
      ...commandUsageLines(spec).map((line) => `  ${line}`),
      ...optionLines(spec.options, "Параметры вызова:"),
      "",
      ...spec.notes ?? [],
      `Подробности и параметры подкоманды: wtctl help ${command} ПОДКОМАНДА.`
    ];
    return `${lines2.join("\n")}
`;
  }
  const lines = [
    `wtctl ${command} — ${spec.summary}`,
    "",
    ...commandUsageLines(spec).map((line) => `  ${line}`),
    ...optionLines(spec.options),
    ...spec.notes?.length ? ["", ...spec.notes] : []
  ];
  return `${lines.join("\n")}
`;
}

// src/cli/input.ts
var FORBIDDEN_PATH_KEYS = /* @__PURE__ */ new Set(["__proto__", "constructor", "prototype"]);
var SAFE_INT_RE = /^-?(?:0|[1-9]\d{0,14})$/;
var COLON_WHERE_RE = /^([A-Za-z_][A-Za-z0-9_]*):(eq|ne|gt|gte|lt|lte|contains|in)=([\s\S]*)$/;
var UNKNOWN_COLON_WHERE_RE = /^([A-Za-z_][A-Za-z0-9_]*):([^=]+)=([\s\S]*)$/;
var SYMBOL_WHERE_RE = /^([A-Za-z_][A-Za-z0-9_]*)(!=|>=|<=|=|>|<|~)([\s\S]*)$/;
var SYMBOL_TO_OP = {
  "=": "eq",
  "!=": "ne",
  "~": "contains",
  ">": "gt",
  ">=": "gte",
  "<": "lt",
  "<=": "lte"
};
function assertSafePathKey(key, label) {
  if (FORBIDDEN_PATH_KEYS.has(key)) throw new CliInputError(`Недопустимое имя ${label}: «${key}».`);
}
function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function setOwnProperty(target, key, value) {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true
  });
}
function parseScalarArg(raw) {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  if (SAFE_INT_RE.test(raw)) return raw === "-0" ? 0 : Number(raw);
  return raw;
}
function parseWhereScalar(raw) {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  return raw;
}
function isWhereScalar(value) {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}
function toOperatorMap(field, value) {
  if (isWhereScalar(value)) return { eq: value };
  if (isPlainObject(value) && Object.keys(value).length > 0) return value;
  throw new CliInputError(`Конфликтующие условия для поля «${field}».`);
}
function mergeWhereCondition(merged, field, incoming) {
  if (!Object.hasOwn(merged, field)) {
    setOwnProperty(merged, field, incoming);
    return;
  }
  const left = toOperatorMap(field, merged[field]);
  const right = toOperatorMap(field, incoming);
  const combined = {};
  for (const [op, val] of Object.entries(left)) setOwnProperty(combined, op, val);
  for (const [op, val] of Object.entries(right)) {
    if (Object.hasOwn(combined, op))
      throw new CliInputError(`Для поля «${field}» оператор ${op} задан больше одного раза.`);
    setOwnProperty(combined, op, val);
  }
  setOwnProperty(merged, field, combined);
}
function buildOperatorCondition(field, op, rawValue) {
  if (op === "eq") return parseWhereScalar(rawValue);
  if (op === "contains") return { contains: rawValue };
  if (op === "in") {
    const trimmed = rawValue.trim();
    if (!trimmed)
      throw new CliInputError(
        `Условие «${field}:in=» требует непустой список значений через запятую.`
      );
    const parts = rawValue.includes(",") ? rawValue.split(",").map((part) => part.trim()) : trimmed.split(/\s+/);
    if (parts.some((part) => part === ""))
      throw new CliInputError(`Условие «${field}:in=» не допускает пустые значения в списке.`);
    return { in: parts.map(parseWhereScalar) };
  }
  return { [op]: parseWhereScalar(rawValue) };
}
function parseWhereFlags(entries) {
  const merged = {};
  for (const entry of entries) {
    if (entry.trimStart().startsWith("{")) {
      const object = jsonObject(entry);
      for (const [field, value] of Object.entries(object))
        mergeWhereCondition(merged, field, value);
      continue;
    }
    const colon = COLON_WHERE_RE.exec(entry);
    if (colon) {
      const [, field, op, rawValue] = colon;
      mergeWhereCondition(merged, field, buildOperatorCondition(field, op, rawValue));
      continue;
    }
    const unknownColon = UNKNOWN_COLON_WHERE_RE.exec(entry);
    if (unknownColon) {
      throw new CliInputError(
        `Неизвестный оператор условия «:${unknownColon[2]}».`,
        "Допустимы: eq, ne, gt, gte, lt, lte, contains, in."
      );
    }
    const symbol = SYMBOL_WHERE_RE.exec(entry);
    if (symbol) {
      const [, field, sym, rawValue] = symbol;
      const op = SYMBOL_TO_OP[sym];
      mergeWhereCondition(merged, field, buildOperatorCondition(field, op, rawValue));
      continue;
    }
    throw new CliInputError(
      "Неверный формат --where: нужно поле=значение, поле:op=значение или объект JSON.",
      "Операторы: =, !=, ~, >, >=, <, <= или :eq=, :ne=, :contains=, :gt=, :gte=, :lt=, :lte=, :in=a,b."
    );
  }
  return merged;
}
function findAssignmentEquals(entry, respectBrackets) {
  if (!respectBrackets) return entry.indexOf("=");
  let inBracket = false;
  for (let index = 0; index < entry.length; index++) {
    const ch = entry[index];
    if (ch === "[") inBracket = true;
    else if (ch === "]") inBracket = false;
    else if (ch === "=" && !inBracket) return index;
  }
  return -1;
}
function parseKeyValue(entry, flag, valueLabel, kind, respectBrackets) {
  const eq = findAssignmentEquals(entry, respectBrackets);
  const key = eq >= 0 ? entry.slice(0, eq).trim() : "";
  if (eq <= 0 || !key)
    throw new CliInputError(`Для --${flag} нужен вид ${valueLabel} с непустым именем до «=».`);
  const raw = entry.slice(eq + 1);
  if (kind === "json") {
    if (!raw.trim()) throw new CliInputError(`Для --${flag} нужно значение JSON после «=».`);
    return { key, value: parseJson(raw) };
  }
  return { key, value: kind === "scalar" ? parseScalarArg(raw) : raw };
}
function parseCreateSetFlags(entries) {
  return entries.map(
    ({ name, value }) => parseKeyValue(
      value,
      name,
      name === "set-json" ? "ПУТЬ=JSON" : "ПУТЬ=ЗНАЧЕНИЕ",
      name === "set-json" ? "json" : "string",
      false
    )
  );
}
function parsePatchFlags(entries) {
  return entries.map(({ name, value }) => {
    if (name === "remove") {
      const path = value.trim();
      if (!path) throw new CliInputError("Путь в --remove не может быть пустым.");
      return { op: "remove", path };
    }
    const parsed = parseKeyValue(
      value,
      name,
      name === "set-json" ? "ПУТЬ=JSON" : "ПУТЬ=ЗНАЧЕНИЕ",
      name === "set-json" ? "json" : "string",
      true
    );
    return { op: "set", path: parsed.key, value: parsed.value };
  });
}
function isWholePatchInput(input) {
  const keys = Object.keys(input);
  return keys.length > 0 && keys.every((key) => key === "patch" || key === "remove") && (!("patch" in input) || input.patch !== null && typeof input.patch === "object") && (!("remove" in input) || Array.isArray(input.remove));
}
function objectToSetOps(record) {
  return Object.entries(record).map(([path, value]) => ({ op: "set", path, value }));
}
function mergePatchInput(base, flagOps, resave) {
  if (base === void 0) {
    if (flagOps.length === 0) return {};
    let seenRemove = false;
    let needsArray = false;
    const seenSet = /* @__PURE__ */ new Set();
    for (const op of flagOps) {
      if (op.op === "remove") {
        seenRemove = true;
      } else {
        if (seenRemove || seenSet.has(op.path)) {
          needsArray = true;
          break;
        }
        seenSet.add(op.path);
      }
    }
    if (needsArray) return { patch: [...flagOps] };
    const patch = {};
    const remove = [];
    let hasSets = false;
    for (const op of flagOps) {
      if (op.op === "set") {
        setOwnProperty(patch, op.path, op.value);
        hasSets = true;
      } else {
        remove.push(op.path);
      }
    }
    return {
      ...hasSets ? { patch } : {},
      ...remove.length ? { remove } : {}
    };
  }
  if (base === null || typeof base !== "object")
    throw new CliInputError("Правка — объект {поле: значение} или массив операций.");
  if (flagOps.length === 0) {
    if (!Array.isArray(base) && isWholePatchInput(base))
      return base;
    return Array.isArray(base) || Object.keys(base).length || !resave ? { patch: base } : {};
  }
  let baseOps;
  if (Array.isArray(base)) {
    baseOps = base;
  } else if (isWholePatchInput(base)) {
    const record = base;
    const setOps = Array.isArray(record.patch) ? record.patch : record.patch !== void 0 ? objectToSetOps(record.patch) : [];
    const removeOps = Array.isArray(record.remove) ? record.remove.map((path) => ({ op: "remove", path })) : [];
    baseOps = [...setOps, ...removeOps];
  } else {
    baseOps = objectToSetOps(base);
  }
  return { patch: [...baseOps, ...flagOps] };
}
function buildCreateData(base, entries) {
  const data = base ? structuredClone(base) : {};
  for (const { key, value } of entries) {
    const segments = key.split(".");
    for (const segment of segments) {
      if (!segment)
        throw new CliInputError(`Неверный путь «${key}»: сегмент не может быть пустым.`);
      assertSafePathKey(segment, "сегмента пути");
    }
    let cursor = data;
    for (let index = 0; index < segments.length - 1; index++) {
      const segment = segments[index];
      const existing2 = Object.hasOwn(cursor, segment) ? cursor[segment] : void 0;
      if (existing2 === void 0) {
        const next = {};
        setOwnProperty(cursor, segment, next);
        cursor = next;
      } else if (isPlainObject(existing2)) {
        cursor = existing2;
      } else {
        const prefix = segments.slice(0, index + 1).join(".");
        throw new CliInputError(
          `Конфликт в пути «${key}»: поле «${prefix}» уже содержит не объект.`
        );
      }
    }
    const last = segments.at(-1);
    const existing = Object.hasOwn(cursor, last) ? cursor[last] : void 0;
    if (isPlainObject(existing) && !isPlainObject(value))
      throw new CliInputError(
        `Конфликт в пути «${key}»: поле «${key}» уже содержит вложенные поля.`
      );
    setOwnProperty(cursor, last, value);
  }
  return data;
}
function parseExecParams(entries) {
  const params = {};
  for (const { name, value: entry } of entries) {
    if (name === "param-json") {
      const { key: key2, value: value2 } = parseKeyValue(entry, "param-json", "КЛЮЧ=JSON", "json", false);
      setOwnProperty(params, key2, value2);
      continue;
    }
    if (entry.trimStart().startsWith("{")) {
      for (const [key2, value2] of Object.entries(jsonObject(entry)))
        setOwnProperty(params, key2, value2);
      continue;
    }
    const { key, value } = parseKeyValue(entry, "params", "КЛЮЧ=ЗНАЧЕНИЕ", "scalar", false);
    setOwnProperty(params, key, value);
  }
  return params;
}
function resolvePositionalSearch(positional, flag, flagName) {
  if (positional !== void 0 && flag !== void 0)
    throw new CliInputError(`Поиск задан и аргументом, и в --${flagName}.`);
  if (positional !== void 0 && !positional.length)
    throw new CliInputError("Строка поиска не может быть пустой.");
  return positional ?? flag;
}

// src/cli/commands.ts
function assertObjectId(given, hint) {
  try {
    resolvePhysicalDocumentLocation(given);
  } catch (error) {
    if (error instanceof ArgumentError) throw new CliInputError(error.message, hint);
    throw error;
  }
}
function hasInputSource(args) {
  return args.options["input-file"] !== void 0 || args.options.stdin === true || args.options.args !== void 0;
}
async function readLocal(flag, path, read) {
  try {
    return await read(path);
  } catch (error) {
    const { code, syscall } = error ?? {};
    if (syscall === void 0) throw error;
    const where = resolve(path);
    if (flag === void 0) {
      throw new CliInputError(
        code === "ENOENT" ? `Файл не найден: ${where}.` : code === "EISDIR" ? `Указана папка, а нужен файл: ${where}.` : `Файл не открывается для чтения: ${where}.`
      );
    }
    throw new CliInputError(
      code === "ENOENT" ? `Файл из --${flag} не найден: ${where}.` : code === "EISDIR" ? `В --${flag} указана папка, а нужен файл: ${where}.` : `Файл из --${flag} не открывается для чтения: ${where}.`
    );
  }
}
async function inputText(args, io) {
  const file = stringOption(args, "input-file");
  return file ? await readLocal("input-file", file, (path) => io.readFile(path)) : args.options.stdin ? await io.readStdin() : stringOption(args, "args");
}
async function inputObject(args, io, required = false) {
  const text = await inputText(args, io);
  if (text === void 0) {
    if (required)
      throw new CliInputError(
        "Для команды нужен объект JSON через --input-file, --stdin или --args."
      );
    return {};
  }
  return jsonObject(text);
}
async function inputJson(args, io, fallback) {
  const text = await inputText(args, io);
  if (text === void 0) {
    if (fallback !== void 0) return fallback;
    throw new CliInputError("Для команды нужен JSON через --input-file, --stdin или --args.");
  }
  return parseJson(text);
}
function encodeBinaryUpload(bytes) {
  try {
    return { data: { base64: Buffer.from(bytes).toString("base64") } };
  } catch (error) {
    if (error.code === "ERR_STRING_TOO_LONG")
      throw new CliInputError(
        "Размер ввода для этой команды ограничен 384 МиБ. Файл с диска записывает wtctl files write --input-file."
      );
    throw error;
  }
}
async function putData(command, args, io) {
  if (stringOption(args, "args") !== void 0) return inputObject(args, io, true);
  if (command === "doc") {
    const data = await inputText(args, io);
    if (!data?.trim())
      throw new CliInputError("Для doc put нужен XML через --input-file или --stdin.");
    return { data };
  }
  const file = stringOption(args, "input-file");
  let bytes;
  if (file && io.readBinaryFile)
    bytes = await readLocal("input-file", file, (path) => io.readBinaryFile(path));
  else if (args.options.stdin && io.readBinaryStdin) bytes = await io.readBinaryStdin();
  else throw new CliInputError("Нужен файл через --input-file или двоичный ввод через --stdin.");
  return encodeBinaryUpload(bytes);
}
async function fileWriteData(args, io) {
  const localFile = args.positionals[3];
  if (localFile !== void 0) {
    if (hasInputSource(args))
      throw new CliInputError("Файл задан и аргументом, и через --input-file или --stdin.");
    if (!localFile.trim()) throw new CliInputError("Путь к локальному файлу не может быть пустым.");
    return { file: resolve(localFile) };
  }
  const file = stringOption(args, "input-file");
  if (file !== void 0) return { file: resolve(file) };
  return { base64: (await putData("file", args, io)).data.base64 };
}
function objectTarget(args) {
  const id = stringOption(args, "id");
  const url = stringOption(args, "url");
  const type = stringOption(args, "type");
  const dbName = stringOption(args, "db-name");
  for (const value of [id, url, type, dbName])
    if (value !== void 0 && !value.trim())
      throw new CliInputError("Адрес, база и тип объекта должны быть непустыми строками.");
  if (id === void 0 && url === void 0) {
    if (args.positionals.length === 2)
      throw new CliInputError("Не задан объект: ID, ТИП ID, --id ID или --url АДРЕС.");
    exactPositionals(args, 3, 4);
    const typed = args.positionals.length === 4;
    if (typed && type !== void 0) throw new CliInputError("Тип задан и аргументом, и в --type.");
    const given = args.positionals.at(-1);
    assertObjectId(given, "Объект задают [ТИП] ID, --id ID или --url АДРЕС.");
    return {
      id: given,
      ...optional("type", typed ? requirePositional(args, 2, "тип объекта") : type),
      ...optional("dbName", dbName)
    };
  }
  if (args.positionals.length !== 2)
    throw new CliInputError("Объект задан и аргументом, и через --id или --url.");
  if (id !== void 0 && url !== void 0)
    throw new CliInputError("Нужен один из --id и --url, а не оба.");
  if (url !== void 0 && dbName !== void 0)
    throw new CliInputError("--db-name не нужен вместе с --url: адрес уже называет базу.");
  return {
    ...optional("id", id),
    ...optional("url", url),
    ...optional("type", type),
    ...optional("dbName", dbName)
  };
}
function validUploadName(value, message) {
  if (!value || !value.trim() || value === "." || value === "..") throw new CliInputError(message);
  return value;
}
async function uploadFileInvocation(args, io) {
  exactPositionals(args, 2, 3);
  const pos = args.positionals[2];
  const name = stringOption(args, "name");
  if (name !== void 0 && !name.trim())
    throw new CliInputError("Имя файла в --name не может быть пустым.");
  const inputFile = stringOption(args, "input-file");
  const useStdin = args.options.stdin === true;
  const contentType = optional("contentType", stringOption(args, "content-type"));
  let filename;
  let data;
  if (inputFile !== void 0 || useStdin) {
    if (pos !== void 0 && name !== void 0)
      throw new CliInputError("Имя файла задано и аргументом, и в --name.");
    filename = validUploadName(
      pos ?? name ?? (inputFile !== void 0 ? basename(inputFile) : void 0),
      useStdin ? "При --stdin нужно указать имя файла аргументом или в --name." : "Не удалось определить имя файла: нужно указать его аргументом или в --name."
    );
    data = await putData("file", args, io);
  } else {
    if (pos === void 0) throw new CliInputError("Не задан локальный файл для загрузки.");
    if (!pos.trim()) throw new CliInputError("Путь к локальному файлу не может быть пустым.");
    filename = validUploadName(
      name ?? basename(pos),
      "Не удалось определить имя файла из пути: нужно указать его через --name."
    );
    if (!io.readBinaryFile)
      throw new CliInputError("Нужен файл через --input-file или двоичный ввод через --stdin.");
    data = encodeBinaryUpload(await readLocal(void 0, pos, (path) => io.readBinaryFile(path)));
  }
  return {
    operationId: "web.pages.uploadFile",
    args: { filename, ...data, ...contentType }
  };
}
async function queryCommand(args, io) {
  exactPositionals(args, 1, 2);
  const positional = args.positionals[1];
  const posCatalog = positional !== void 0 && IDENTIFIER_RE.test(positional) ? positional : void 0;
  const posQuery = posCatalog === void 0 ? positional : void 0;
  const flagCatalog = stringOption(args, "catalog");
  if (posCatalog !== void 0 && flagCatalog !== void 0)
    throw new CliInputError("Каталог задан и аргументом, и в --catalog.");
  const catalog = posCatalog ?? flagCatalog;
  if (posQuery !== void 0 && flagCatalog !== void 0)
    throw new CliInputError("Задан и текст XQuery, и --catalog: нужно что-то одно.");
  const whereFlags = repeatedOption(args, "where");
  const hasSource = hasInputSource(args);
  if (posQuery !== void 0 && hasSource)
    throw new CliInputError("Запрос задан и аргументом, и отдельным источником.");
  if (catalog && whereFlags.length > 0 && hasSource)
    throw new CliInputError("Условия заданы и в --where, и отдельным источником.");
  const source = await inputText(args, io);
  const whole = !catalog && source?.trimStart().startsWith("{") ? jsonObject(source) : void 0;
  if (whole && whereFlags.length > 0)
    throw new CliInputError("Условия заданы и в --where, и в файле аргументов.");
  if (whole && whole.catalog === void 0 && whole.query === void 0)
    throw new CliInputError(
      "В объекте JSON нет ни catalog, ни query. Условия where передают вместе с --catalog."
    );
  const query = catalog || whole ? posQuery : source ?? posQuery;
  if (!query?.trim() && !catalog && !whole)
    throw new CliInputError(
      "Нужен каталог (аргументом или через --catalog) либо текст запроса XQuery."
    );
  if (!catalog && whereFlags.length > 0)
    throw new CliInputError("--where требует каталог или --catalog.");
  const where = whereFlags.length > 0 ? parseWhereFlags(whereFlags) : catalog && source?.trim() ? jsonObject(source) : void 0;
  const nested = where?.where;
  if (Array.isArray(where?.fields) || Array.isArray(where?.order) || nested !== null && typeof nested === "object" && !Array.isArray(nested) && !Object.keys(nested).some(
    (key) => ["eq", "ne", "gt", "gte", "lt", "lte", "contains", "in"].includes(key)
  ))
    throw new CliInputError(
      'С --catalog в источнике пишут сами условия: {"поле": значение}. Набор {catalog, where, fields} передают без --catalog.'
    );
  const order = orderOption(args);
  if (order && !catalog && whole?.catalog === void 0)
    throw new CliInputError(
      "--order работает с каталогом (аргументом или --catalog); в тексте XQuery сортировку пишут сами: order by $e/поле"
    );
  const all = args.options.all === true;
  const pageSize = integerOption(args, "page-size", 1, 1e3);
  const maxRows = integerOption(args, "max-rows", 1, 1e7);
  const limit = integerOption(args, "limit", 1, 1e3);
  const startPositionFlag = integerOption(args, "start-position", 0, 1e6);
  if (pageSize !== void 0 && !all)
    throw new CliInputError("--page-size работает только вместе с --all.");
  if (maxRows !== void 0 && !all)
    throw new CliInputError("--max-rows работает только вместе с --all.");
  if (all && (limit !== void 0 || whole?.limit !== void 0))
    throw new CliInputError(
      "--all и --limit вместе не задаются.",
      "Размер страницы задаёт --page-size, а общее ограничение строк — --max-rows."
    );
  const effectiveQuery = query ?? (typeof whole?.query === "string" ? whole.query : void 0);
  if (all && effectiveQuery !== void 0 && /^\s*sql\s*:/i.test(effectiveQuery))
    throw new CliInputError(
      "--all не поддерживается для sql:-запросов: SQL может менять данные и не повторяется автоматически.",
      "Для одного вызова --all не нужен: передаются --limit и --start-position."
    );
  if (all && startPositionFlag === void 0 && whole?.startPosition !== void 0) {
    const start = whole.startPosition;
    if (typeof start !== "number" || !Number.isSafeInteger(start) || start < 0 || start > 1e6) {
      throw new CliInputError("startPosition должен быть целым числом от 0 до 1000000.");
    }
  }
  return {
    operationId: "runtime.query",
    args: {
      ...whole,
      ...optional("query", query),
      ...optional("catalog", catalog),
      ...optional("where", where),
      ...optional("fields", listOption(args, "fields")),
      ...optional("order", order),
      ...optional("limit", limit),
      ...optional("startPosition", startPositionFlag)
    }
  };
}
async function objectCommand(args, io, options) {
  const action = args.positionals[1];
  if (action === "create") {
    exactPositionals(args, 3);
    const type = requirePositional(args, 2, "тип объекта");
    const sets = parseCreateSetFlags(orderedOptions(args, ["set", "set-json"]));
    const hasInput = hasInputSource(args);
    if (!hasInput && sets.length === 0)
      throw new CliInputError(
        "Для команды нужен объект JSON через --input-file, --stdin или --args, либо --set/--set-json."
      );
    const base = hasInput ? await inputObject(args, io, true) : void 0;
    const data = sets.length > 0 ? buildCreateData(base, sets) : base;
    return {
      operationId: "objects.create",
      args: {
        type,
        data,
        ...optional("formUrl", stringOption(args, "form-url")),
        ...optional("dbName", stringOption(args, "db-name"))
      }
    };
  }
  if (action === "get") {
    const ids = listOption(args, "ids");
    const rest = args.positionals.slice(2);
    const id = stringOption(args, "id");
    const url = stringOption(args, "url");
    const type = stringOption(args, "type");
    const dbName = stringOption(args, "db-name");
    const checkTypeAndDb = () => {
      for (const value of [type, dbName])
        if (value !== void 0 && !value.trim())
          throw new CliInputError("База и тип объекта должны быть непустыми строками.");
    };
    const validateIds = (list) => {
      if (list.length === 0) throw new CliInputError("Нужен хотя бы один ID объекта.");
      if (list.length > 100)
        throw new CliInputError("За один вызов можно запросить не больше 100 объектов.");
      for (const given of list)
        assertObjectId(
          given,
          "Объект задают [ТИП] ID [ID …], --id ID, --ids ID,ID или --url АДРЕС."
        );
    };
    let target2;
    if (ids !== void 0) {
      if (rest.length > 0 || id !== void 0 || url !== void 0)
        throw new CliInputError("--ids задаётся без [ТИП] ID, --id и --url.");
      checkTypeAndDb();
      validateIds(ids);
      target2 = { ids, ...optional("type", type), ...optional("dbName", dbName) };
    } else if (rest.length >= 2 && !(rest.length === 2 && IDENTIFIER_RE.test(rest[0]))) {
      if (id !== void 0 || url !== void 0)
        throw new CliInputError("Объект задан и аргументом, и через --id или --url.");
      checkTypeAndDb();
      const hasPosType = IDENTIFIER_RE.test(rest[0]);
      const posType = hasPosType ? rest[0] : void 0;
      const posIds = hasPosType ? rest.slice(1) : rest;
      if (posType !== void 0 && type !== void 0)
        throw new CliInputError("Тип задан и аргументом, и в --type.");
      validateIds(posIds);
      target2 = {
        ids: posIds,
        ...optional("type", posType ?? type),
        ...optional("dbName", dbName)
      };
    } else {
      target2 = objectTarget(args);
    }
    return {
      operationId: "objects.get",
      args: { ...target2, ...optional("fields", listOption(args, "fields")) }
    };
  }
  if (action === "patch") {
    const target2 = objectTarget(args);
    const flagOps = parsePatchFlags(orderedOptions(args, ["set", "set-json", "remove"]));
    const hasInput = hasInputSource(args);
    const resave = args.options.resave === true;
    if (!hasInput && flagOps.length === 0 && !resave)
      throw new CliInputError(
        "Для команды нужен JSON через --input-file, --stdin или --args, либо флаги --set, --set-json или --remove."
      );
    const base = hasInput ? await inputJson(args, io) : void 0;
    return {
      operationId: "objects.patch",
      args: {
        ...target2,
        ...mergePatchInput(base, flagOps, resave),
        ...optional("expectedFingerprint", stringOption(args, "expected-fingerprint")),
        ...args.options.preview ? { preview: true } : {},
        ...resave ? { resave: true } : {}
      }
    };
  }
  if (action === "edit") throw new CliInputError("object edit выполняется интерактивно через CLI.");
  const target = objectTarget(args);
  const permanent = args.options.permanent === true;
  const interactive = options?.interactive === true;
  if (!permanent && !interactive)
    throw new CliInputError(
      "object delete удаляет объект насовсем и требует --permanent.",
      "Корзины нет: удалённый объект не вернуть."
    );
  return {
    operationId: "objects.delete",
    args: {
      ...target,
      ...permanent || args.options.yes === true ? { permanent: true } : {},
      ...optional("catalog", stringOption(args, "catalog"))
    }
  };
}
async function filesCommand(args, io) {
  const action = args.positionals[1];
  if (action === "edit") throw new CliInputError("files edit выполняется интерактивно через CLI.");
  if (action === "upload") return uploadFileInvocation(args, io);
  if (action === "list") {
    exactPositionals(args, 3, 4);
    const search = resolvePositionalSearch(
      args.positionals[3],
      stringOption(args, "search"),
      "search"
    );
    return {
      operationId: "files.list",
      args: {
        url: requirePositional(args, 2, "адрес папки на сервере"),
        ...optional("search", search)
      }
    };
  }
  if (action === "write") {
    exactPositionals(args, 3, 4);
    return {
      operationId: "files.write",
      args: {
        url: requirePositional(args, 2, "адрес файла на сервере"),
        ...await fileWriteData(args, io)
      }
    };
  }
  exactPositionals(args, 3);
  if (action === "delete")
    return {
      operationId: "files.delete",
      args: { url: requirePositional(args, 2, "адрес файла на сервере") }
    };
  if (action === "read") {
    const to = stringOption(args, "to");
    if (to === void 0 && args.options.overwrite)
      throw new CliInputError("--overwrite действует только вместе с --to.");
    if (to !== void 0 && args.options.base64)
      throw new CliInputError("--base64 не нужен вместе с --to: файл сохраняется байт в байт.");
    return {
      operationId: "files.read",
      args: {
        url: requirePositional(args, 2, "адрес файла на сервере"),
        ...args.options.base64 ? { encoding: "base64" } : {},
        ...to === void 0 ? {} : { file: resolve(to) },
        ...args.options.overwrite ? { overwrite: true } : {}
      }
    };
  }
  let url;
  try {
    url = fileExistsUrl(requirePositional(args, 2, "адрес файла на сервере"));
  } catch (error) {
    if (error instanceof HcmError && error.code === "INVALID_ARGUMENT")
      throw new CliInputError(error.message, error.hint);
    throw error;
  }
  return { operationId: "files.exists", args: { url } };
}
async function rpcCommand(args, io) {
  const action = args.positionals[1];
  if (action === "list") {
    exactPositionals(args, 2, 3);
    const query = resolvePositionalSearch(
      args.positionals[2],
      stringOption(args, "query"),
      "query"
    );
    return {
      operationId: "rpc.list",
      args: {
        ...optional("query", query),
        ...optional("library", stringOption(args, "library")),
        ...optional("method", stringOption(args, "method")),
        ...args.options.all ? { all: true } : {},
        ...optional("cursor", integerOption(args, "cursor", 0, Number.MAX_SAFE_INTEGER)),
        ...optional("limit", integerOption(args, "limit", 1, 100))
      }
    };
  }
  if (action === "describe") {
    exactPositionals(args, 3);
    return {
      operationId: "rpc.describe",
      args: {
        targetId: requirePositional(args, 2, "аргумент БИБЛИОТЕКА.ФУНКЦИЯ"),
        ...args.options.source ? { source: true } : {}
      }
    };
  }
  let library;
  let method;
  let posArgs;
  if (action !== void 0 && RPC_TARGET_RE.test(action)) {
    const dot = action.indexOf(".");
    library = action.slice(0, dot);
    method = action.slice(dot + 1);
    posArgs = args.positionals.slice(2);
  } else {
    if (action !== void 0 && action.includes("."))
      throw new CliInputError(
        "Неверная запись вызова: нужно БИБЛИОТЕКА.ФУНКЦИЯ или БИБЛИОТЕКА ФУНКЦИЯ."
      );
    library = requirePositional(args, 1, "аргумент БИБЛИОТЕКА");
    method = requirePositional(args, 2, "аргумент ФУНКЦИЯ");
    posArgs = args.positionals.slice(3);
  }
  if (posArgs.length > 0 && hasInputSource(args))
    throw new CliInputError(
      "Аргументы функции заданы и позиционно, и через --args, --input-file или --stdin."
    );
  const supplied = posArgs.length > 0 ? posArgs.map(parseScalarArg) : await inputJson(args, io, []);
  if (!Array.isArray(supplied))
    throw new CliInputError(
      "Аргументы функции — массив JSON.",
      "Элемент — строка, true, false, null, целое число; дробное и большое число, дату задают явно: {valueType, lexicalValue}."
    );
  return {
    operationId: "rpc.call",
    args: {
      library,
      method,
      arguments: supplied,
      ...args.options.async ? { async: true } : {}
    }
  };
}
async function execCommand(args, io) {
  exactPositionals(args, 1, 2);
  if (hasInputSource(args) && args.positionals[1] !== void 0)
    throw new CliInputError("Код задан и аргументом, и отдельным источником.");
  const paramEntries = orderedOptions(args, ["params", "param-json"]);
  const file = stringOption(args, "params-file");
  if (paramEntries.length > 0 && file !== void 0)
    throw new CliInputError(
      paramEntries.some((entry) => entry.name === "param-json") ? "Параметры кода заданы и в --params/--param-json, и в --params-file." : "Параметры кода заданы и в --params, и в --params-file."
    );
  const source = await inputText(args, io);
  const code = source ?? args.positionals[1];
  if (!code?.trim())
    throw new CliInputError("Нужен код SP-XML Script: аргументом, через --input-file или --stdin.");
  const params = file !== void 0 ? jsonObject(await readLocal("params-file", file, (path) => io.readFile(path))) : paramEntries.length > 0 ? parseExecParams(paramEntries) : void 0;
  return {
    operationId: "execute.script",
    args: { code, ...params === void 0 ? {} : { params } }
  };
}
function resultCommand(args) {
  const exporting = args.positionals[1] === "export";
  exactPositionals(args, 3);
  const format = exporting ? stringOption(args, "format") : enumOption(
    args,
    "format",
    ["auto", "json", "text"],
    "--format должен быть auto, json или text."
  );
  const path = stringOption(args, "to");
  if (exporting && !path) throw new CliInputError("result export требует --to ФАЙЛ.");
  return {
    operationId: exporting ? "results.export" : "results.read",
    args: {
      resultId: requirePositional(args, 2, "id результата"),
      ...exporting ? { path, overwrite: args.options.overwrite === true } : {
        ...optional("offset", integerOption(args, "offset", 0, Number.MAX_SAFE_INTEGER)),
        ...optional("limit", integerOption(args, "limit", 1, 65536))
      },
      ...optional("format", format)
    }
  };
}
function schemaOrTypesCommand(args) {
  const command = args.positionals[0];
  if (command === "types") {
    exactPositionals(args, 1, 2);
    const search2 = resolvePositionalSearch(
      args.positionals[1],
      stringOption(args, "search"),
      "search"
    );
    return {
      operationId: "schema.types",
      args: {
        ...optional("search", search2),
        ...optional("limit", integerOption(args, "limit", 1, 1e3)),
        ...optional("cursor", integerOption(args, "cursor", 0, Number.MAX_SAFE_INTEGER))
      }
    };
  }
  exactPositionals(args, 1, 3);
  const type = args.positionals[1];
  const posSearch = args.positionals[2];
  const url = stringOption(args, "url");
  if (url !== void 0 && posSearch !== void 0)
    throw new CliInputError("С --url поиск задаётся флагом --search, а не аргументом.");
  const search = resolvePositionalSearch(posSearch, stringOption(args, "search"), "search");
  if (type !== void 0 && !type.trim()) throw new CliInputError("Не задан тип объекта.");
  if (url !== void 0 && !url.trim()) throw new CliInputError("Не задан --url.");
  if (type === void 0 && url === void 0)
    throw new CliInputError("Не задан тип объекта или --url.");
  return {
    operationId: "schema.get",
    args: {
      ...optional("type", type),
      ...optional("url", url),
      ...optional("search", search),
      ...optional("limit", integerOption(args, "limit", 1, 1e3)),
      ...optional("cursor", integerOption(args, "cursor", 0, Number.MAX_SAFE_INTEGER)),
      ...optional("path", stringOption(args, "path")),
      ...args.options.deep ? { deep: true } : {},
      ...optional("origin", listOption(args, "origin")),
      ...optional("kind", stringOption(args, "kind")),
      ...optional("include", listOption(args, "include")),
      ...optional("language", stringOption(args, "language"))
    }
  };
}
function logsCommand(args) {
  const action = args.positionals[1];
  if (action === "list") {
    exactPositionals(args, 2);
    const date = stringOption(args, "date");
    if (date !== void 0 && (args.options["start-date"] || args.options["end-date"]))
      throw new CliInputError("--date и --start-date или --end-date вместе не задаются.");
    return {
      operationId: "logs.list",
      args: {
        ...optional("type", stringOption(args, "type")),
        ...optional("nameContains", stringOption(args, "name-contains")),
        ...optional("startDate", date ?? stringOption(args, "start-date")),
        ...optional("endDate", date ?? stringOption(args, "end-date")),
        ...optional("offset", integerOption(args, "offset", 0, Number.MAX_SAFE_INTEGER)),
        ...optional("limit", integerOption(args, "limit", 1, 1e3))
      }
    };
  }
  exactPositionals(args, 3, action === "search" ? 4 : 3);
  const file = requirePositional(args, 2, "файл или тип лога из logs list");
  if (!file.trim()) throw new CliInputError("Имя файла или типа лога не может быть пустым.");
  if (args.options.full && args.options["tail-bytes"])
    throw new CliInputError("Нужно выбрать --full или --tail-bytes.");
  const tailBytes = integerOption(args, "tail-bytes", 1, Number.MAX_SAFE_INTEGER);
  if (action === "tail") {
    integerOption(args, "lines", 1, 1e4);
    const interval = intervalOption(args, "interval", 0.5, 60);
    if (interval !== void 0 && args.options.follow !== true)
      throw new CliInputError("--interval в logs tail используется только вместе с -f / --follow.");
  }
  if (action === "follow") {
    const interval = intervalOption(args, "interval", 0.5, 60);
    if (args.options.once === true && interval !== void 0)
      throw new CliInputError("--once и --interval вместе не задаются.");
  }
  const base = {
    file,
    ...optional("tailBytes", tailBytes),
    ...args.options.full ? { full: true } : {}
  };
  if (action === "read" || action === "tail") return { operationId: "logs.read", args: base };
  if (action === "follow")
    return {
      operationId: "logs.follow",
      args: { ...base, ...optional("cursor", stringOption(args, "cursor")) }
    };
  const level = enumOption(
    args,
    "level",
    ["normal", "debug", "info", "warning", "error", "critical"],
    "--level: normal, debug, info, warning, error или critical."
  );
  const text = resolvePositionalSearch(args.positionals[3], stringOption(args, "text"), "text");
  return {
    operationId: "logs.search",
    args: {
      ...base,
      ...optional("text", text),
      ...optional("level", level),
      ...optional("context", stringOption(args, "context")),
      ...optional("offset", integerOption(args, "offset", 0, Number.MAX_SAFE_INTEGER)),
      ...optional("limit", integerOption(args, "limit", 1, 1e3)),
      ...args.options["newest-first"] ? { newestFirst: true } : {},
      ...optional("expectedFingerprint", stringOption(args, "expected-fingerprint"))
    }
  };
}
var TRACKING_ID_RE = /^(?:\d+|0x[0-9a-fA-F]+)$/;
function parseAgentObjectIds(rawFlags) {
  const result = [];
  for (const raw of rawFlags) {
    const commaParts = raw.split(",");
    for (const part of commaParts) {
      const trimmed = part.trim();
      if (!trimmed) {
        throw new CliInputError(
          "--objects: список ID не может содержать пустые значения.",
          "Пример: --objects 0x1,0x2."
        );
      }
      for (const token of trimmed.split(/\s+/)) {
        assertObjectId(
          token,
          "--objects принимает ID строкой 0x… или десятичной записью через запятую."
        );
        result.push(token);
      }
    }
  }
  if (result.length === 0) throw new CliInputError("--objects: нужен хотя бы один ID.");
  if (result.length > 1e3) throw new CliInputError("--objects: можно передать не больше 1000 ID.");
  return result;
}
var AGENT_THREAD_ID_RE = /^-?\d{1,20}$/;
var AGENT_ROLE_UID_RE = /^[^\s\u0000-\u001f\u007f]{0,128}$/;
function assertAgentThreadId(given, label) {
  if (!AGENT_THREAD_ID_RE.test(given)) {
    throw new CliInputError(
      `${label} должен быть ID потока агента (десятичным числом).`,
      "ID потока возвращает wtctl agent run и wtctl agent status."
    );
  }
}
function agentCommand(args) {
  const action = args.positionals[1];
  if (action === "status") {
    exactPositionals(args, 2, 3);
    const id2 = args.positionals[2];
    if (id2 !== void 0) {
      assertObjectId(id2, "ID агента передаётся строкой: 0x… или десятичной записью.");
    }
    const threadId = stringOption(args, "thread");
    if (threadId !== void 0) assertAgentThreadId(threadId, "--thread");
    const status = enumOption(
      args,
      "status",
      ["running", "finished", "cancelled"],
      "Для --status допустимы running, finished или cancelled."
    );
    const limit = integerOption(args, "limit", 1, 200);
    const wait = args.options.wait === true;
    const waitTimeoutMs2 = integerOption(args, "wait-timeout-ms", 1e3, 36e5);
    if (wait && threadId === void 0) {
      throw new CliInputError(
        "--wait требует указать --thread ID.",
        "Пример: wtctl agent status --thread 3102754751613348050 --wait."
      );
    }
    if (!wait && waitTimeoutMs2 !== void 0) {
      throw new CliInputError(
        "--wait-timeout-ms используется только вместе с --wait.",
        "Добавьте --wait и --thread ID."
      );
    }
    return {
      operationId: "agents.status",
      args: {
        ...optional("id", id2),
        ...optional("threadId", threadId),
        ...optional("status", status),
        ...optional("limit", limit),
        ...wait ? { wait: true } : {},
        ...optional("waitTimeoutMs", waitTimeoutMs2)
      }
    };
  }
  if (action === "cancel") {
    exactPositionals(args, 3);
    const threadId = requirePositional(args, 2, "ID потока агента");
    assertAgentThreadId(threadId, "ID потока агента");
    const roleUID = stringOption(args, "role");
    if (roleUID !== void 0 && !AGENT_ROLE_UID_RE.test(roleUID)) {
      throw new CliInputError(
        "--role должен быть непустым идентификатором роли сервера без пробелов (до 128 знаков)."
      );
    }
    return {
      operationId: "agents.cancel",
      args: {
        threadId,
        ...optional("roleUID", roleUID)
      }
    };
  }
  exactPositionals(args, 3);
  const id = requirePositional(args, 2, "ID агента");
  assertObjectId(id, "ID агента передаётся строкой: 0x… или десятичной записью.");
  const objectId = stringOption(args, "object");
  if (objectId !== void 0) {
    if (!objectId.trim()) throw new CliInputError("--object не может быть пустым.");
    assertObjectId(objectId, "--object принимает ID объекта: 0x… или десятичной записью.");
  }
  const rawObjects = repeatedOption(args, "objects");
  if (objectId !== void 0 && rawObjects.length > 0) {
    throw new CliInputError(
      "Нужно выбрать --object или --objects, но не оба сразу.",
      "Для одного объекта — --object ID, для списка — --objects ID,ID."
    );
  }
  const objectIds = rawObjects.length > 0 ? parseAgentObjectIds(rawObjects) : void 0;
  const noWait = args.options["no-wait"] === true;
  const waitTimeoutMs = integerOption(args, "wait-timeout-ms", 1e3, 36e5);
  if (noWait && waitTimeoutMs !== void 0) {
    throw new CliInputError(
      "--wait-timeout-ms несовместим с --no-wait.",
      "Уберите --wait-timeout-ms или запускайте без --no-wait."
    );
  }
  if (noWait && args.options.logs === true) {
    throw new CliInputError(
      "--logs несовместим с --no-wait: агент ещё выполняется.",
      "Проверьте логи после завершения через wtctl logs tail xhttp или дождитесь агента через wtctl agent status --thread ID --wait."
    );
  }
  const allowConcurrent = args.options["allow-concurrent"] === true;
  return {
    operationId: "agents.run",
    args: {
      id,
      ...optional("objectId", objectId),
      ...optional("objectIds", objectIds),
      ...noWait ? { wait: false } : {},
      ...optional("waitTimeoutMs", waitTimeoutMs),
      ...allowConcurrent ? { allowConcurrent: true } : {}
    }
  };
}
function tasksCommand(args) {
  const action = args.positionals[1];
  if (action === "list") {
    exactPositionals(args, 2, 4);
    const pos1 = args.positionals[2];
    const pos2 = args.positionals[3];
    const flagLib = stringOption(args, "library");
    const flagMethod = stringOption(args, "method");
    if (pos1 !== void 0 && (flagLib !== void 0 || flagMethod !== void 0)) {
      throw new CliInputError("Имя функции задано и аргументом, и через --library/--method.");
    }
    if (flagLib !== void 0 !== (flagMethod !== void 0)) {
      throw new CliInputError(
        "Для поиска задач нужно указать вместе --library и --method.",
        "Формат: wtctl tasks list БИБЛИОТЕКА.ФУНКЦИЯ или --library БИБ --method ФУНКЦИЯ."
      );
    }
    let libName = "";
    let methodName = "";
    if (flagLib !== void 0 && flagMethod !== void 0) {
      if (!flagLib.trim() || !flagMethod.trim()) {
        throw new CliInputError("Имена библиотеки и функции не могут быть пустыми.");
      }
      libName = flagLib;
      methodName = flagMethod;
    } else if (pos1 !== void 0 && pos2 !== void 0) {
      if (pos1.includes(".")) {
        throw new CliInputError(
          "Неверная запись имени функции: нужно БИБЛИОТЕКА.ФУНКЦИЯ или БИБЛИОТЕКА ФУНКЦИЯ."
        );
      }
      if (!pos1.trim() || !pos2.trim()) {
        throw new CliInputError("Имена библиотеки и функции не могут быть пустыми.");
      }
      libName = pos1;
      methodName = pos2;
    } else if (pos1 !== void 0) {
      if (!RPC_TARGET_RE.test(pos1)) {
        throw new CliInputError(
          "Нужно имя функции в формате БИБЛИОТЕКА.ФУНКЦИЯ или БИБЛИОТЕКА ФУНКЦИЯ.",
          "Пример: wtctl tasks list tools.get_version."
        );
      }
      const dot = pos1.indexOf(".");
      libName = pos1.slice(0, dot);
      methodName = pos1.slice(dot + 1);
    }
    return {
      operationId: "web.spxml.getBackgroundTasksByName",
      args: { libName, methodName }
    };
  }
  exactPositionals(args, 3);
  const trackingId = requirePositional(args, 2, "TrackingID задачи");
  if (!TRACKING_ID_RE.test(trackingId)) {
    throw new CliInputError("TrackingID задачи должен быть строкой 0x… или десятичным числом.");
  }
  return {
    operationId: action === "status" ? "web.spxml.getAsyncMethodStatus" : "web.spxml.killAsyncMethod",
    args: { trackingId }
  };
}
var COMMANDS = {
  check: (args) => {
    exactPositionals(args, 1);
    return { operationId: "runtime.check", args: {} };
  },
  status: (args) => {
    exactPositionals(args, 1);
    return { operationId: "runtime.status", args: {} };
  },
  server: (args) => {
    exactPositionals(args, 2);
    const profile = enumOption(
      args,
      "profile",
      ["native", "web"],
      "Для --profile допустимы native или web."
    );
    return { operationId: "server.info", args: { ...optional("profile", profile) } };
  },
  run: async (args, io) => {
    exactPositionals(args, 1);
    return { operationId: "runtime.batch", args: await inputObject(args, io, true) };
  },
  ws: (args) => {
    exactPositionals(args, 2);
    return {
      operationId: "web.websocket.heartbeat",
      args: { ...optional("timeoutMs", integerOption(args, "timeout-ms", 250, 1e4)) }
    };
  },
  api: async (args, io) => {
    if (args.positionals[1] !== "call") throw new CliInputError("Команда не определена.");
    exactPositionals(args, 3);
    return {
      operationId: requirePositional(args, 2, "ID операции"),
      args: await inputObject(args, io)
    };
  },
  query: queryCommand,
  object: objectCommand,
  files: filesCommand,
  file: uploadFileInvocation,
  doc: async (args, io) => {
    const action = args.positionals[1];
    exactPositionals(args, 3);
    const url = requirePositional(args, 2, "адрес документа на сервере");
    const native = {
      get: "native.lds.loadDoc",
      put: "native.lds.putDoc",
      delete: "native.lds.deleteDoc"
    };
    return {
      operationId: native[action],
      args: { ...action === "put" ? await putData("doc", args, io) : {}, url }
    };
  },
  rpc: rpcCommand,
  exec: execCommand,
  agent: agentCommand,
  tasks: tasksCommand,
  result: resultCommand,
  schema: schemaOrTypesCommand,
  types: schemaOrTypesCommand,
  logs: logsCommand
};
async function commandInvocation(args, io, options) {
  const [command] = args.positionals;
  requireCommand(args.positionals);
  if (!command || !Object.hasOwn(COMMANDS, command))
    throw new CliInputError("Команда не определена.");
  return COMMANDS[command](args, io, options);
}

// src/cli/completion.ts
var COMPLETION_SHELLS = ["pwsh", "bash", "zsh"];
var CONNECTION_NAME_RE = /^[A-Za-z0-9_.-]{1,64}$/;
var CONNECTION_POSITIONAL_SCOPES = /* @__PURE__ */ new Set([
  "config use",
  "config remove",
  "config rm",
  "config set"
]);
function isPlainObject2(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function parseCompletionShell(value) {
  if (value === void 0 || !value.trim()) {
    throw new CliInputError("Не указана оболочка: поддерживаются pwsh, bash и zsh.");
  }
  if (COMPLETION_SHELLS.includes(value)) {
    return value;
  }
  throw new CliInputError("Неподдерживаемая оболочка: поддерживаются pwsh, bash и zsh.");
}
async function readConnectionNamesForCompletion(configPath, io) {
  try {
    const text = await io.readFile(configPath, MAX_CONFIG_BYTES);
    const parsed = JSON.parse(text);
    if (!isPlainObject2(parsed)) return [];
    if (isPlainObject2(parsed.connections)) {
      return Object.keys(parsed.connections).filter(
        (name) => parsed.connections !== void 0 && CONNECTION_NAME_RE.test(name)
      );
    }
    if (Object.keys(parsed).length > 0) {
      if (typeof parsed.defaultConnection === "string" && CONNECTION_NAME_RE.test(parsed.defaultConnection)) {
        return [parsed.defaultConnection];
      }
      if (typeof parsed.baseUrl === "string" && parsed.baseUrl.trim() !== "") {
        return ["default"];
      }
    }
    return [];
  } catch {
    return [];
  }
}
async function runCompleteConnections(args, io) {
  exactPositionals(args, 1);
  for (const key of Object.keys(args.options)) {
    if (key !== "config") {
      throw new CliInputError(`Служебная команда __complete-connections не принимает --${key}.`);
    }
  }
  const configPath = stringOption(args, "config") ?? process.env.WTCTL_CONFIG ?? defaultConfigPath();
  const names = await readConnectionNamesForCompletion(configPath, io);
  if (names.length > 0) await io.writeOut(`${names.join("\n")}
`);
  return 0;
}
function toCompletionFlag(option) {
  return {
    long: `--${option.name}`,
    ...option.short === void 0 ? {} : { short: `-${option.short}` },
    takesValue: option.type === "string",
    ...option.values === void 0 ? {} : { values: option.values },
    ...option.name === "connection" ? { dynamic: "connections" } : {},
    description: option.description
  };
}
function buildCompletionModel(commands = CLI_COMMANDS, globalOptions = GLOBAL_OPTIONS) {
  const visible = visibleCommands(commands);
  const topCommands = [
    ...visible.map((cmd) => ({ name: cmd.name, description: cmd.summary })),
    { name: "help", description: "Справка по командам и подкомандам." }
  ];
  const subcommands = /* @__PURE__ */ new Map();
  const scopeFlags = /* @__PURE__ */ new Map();
  const scopePositionalValues = /* @__PURE__ */ new Map();
  const globalFlags = globalOptions.map(toCompletionFlag);
  for (const cmd of visible) {
    if (cmd.options?.length) {
      scopeFlags.set(cmd.name, cmd.options.map(toCompletionFlag));
    }
    if (cmd.subcommands?.length) {
      const items = [];
      for (const sub of cmd.subcommands) {
        items.push({ name: sub.name, description: sub.summary });
        const flags = sub.options?.map(toCompletionFlag) ?? [];
        if (flags.length) scopeFlags.set(`${cmd.name} ${sub.name}`, flags);
        for (const alias of sub.aliases ?? []) {
          items.push({ name: alias, description: sub.summary });
          if (flags.length) scopeFlags.set(`${cmd.name} ${alias}`, flags);
        }
      }
      subcommands.set(cmd.name, items);
    }
  }
  subcommands.set(
    "help",
    visible.map((cmd) => ({ name: cmd.name, description: cmd.summary }))
  );
  for (const cmd of visible) {
    if (cmd.subcommands?.length) {
      scopePositionalValues.set(
        `help ${cmd.name}`,
        cmd.subcommands.map((sub) => ({ name: sub.name, description: sub.summary }))
      );
    }
  }
  scopePositionalValues.set("completion", [
    { name: "pwsh", description: "PowerShell (5.1 и 7+)." },
    { name: "bash", description: "GNU Bash." },
    { name: "zsh", description: "Zsh." }
  ]);
  const topics = guideTopics().slice(1);
  if (topics.length > 0) {
    scopePositionalValues.set(
      "guide",
      topics.map((topic2) => ({ name: topic2, description: `Тема гайда ${topic2}.` }))
    );
  }
  return {
    commands: topCommands,
    subcommands,
    globalFlags,
    scopeFlags,
    scopePositionalValues,
    connectionPositionalScopes: CONNECTION_POSITIONAL_SCOPES
  };
}
function cleanDescription(text, fallback) {
  const cleaned = text.replace(/[\r\n\t]+/g, " ").trim();
  return cleaned || fallback;
}
function psQuote(text) {
  return `'${text.replaceAll("'", "''")}'`;
}
function psArray(items) {
  return `@(${items.map(psQuote).join(", ")})`;
}
function psEntryList(items) {
  const entries = items.map(
    (item) => `@{ N = ${psQuote(item.name)}; D = ${psQuote(cleanDescription(item.description, item.name))} }`
  );
  return `@(${entries.join(", ")})`;
}
function psFlagList(flags) {
  const entries = flags.map((flag) => {
    const parts = [
      `L = ${psQuote(flag.long)}`,
      ...flag.short ? [`S = ${psQuote(flag.short)}`] : [],
      `V = ${flag.takesValue ? "$true" : "$false"}`,
      ...flag.values?.length ? [`E = ${psArray(flag.values)}`] : [],
      ...flag.dynamic ? [`Dyn = ${psQuote(flag.dynamic)}`] : [],
      `D = ${psQuote(cleanDescription(flag.description, flag.long))}`
    ];
    return `@{ ${parts.join("; ")} }`;
  });
  return `@(${entries.join(", ")})`;
}
function generatePwshCompletion(model) {
  const subEntries = [...model.subcommands.entries()].map(
    ([cmd, items]) => `        ${psQuote(cmd)} = ${psEntryList(items)}`
  );
  const scopeFlagEntries = [...model.scopeFlags.entries()].map(
    ([scope, flags]) => `        ${psQuote(scope)} = ${psFlagList(flags)}`
  );
  const scopePosEntries = [...model.scopePositionalValues.entries()].map(
    ([scope, items]) => `        ${psQuote(scope)} = ${psEntryList(items)}`
  );
  const connScopes = psArray([...model.connectionPositionalScopes]);
  return [
    "# Автодополнение wtctl для PowerShell (подключение: wtctl completion pwsh --format raw | Out-String | Invoke-Expression)",
    "Register-ArgumentCompleter -Native -CommandName wtctl -ScriptBlock {",
    "    param($wordToComplete, $commandAst, $cursorPosition)",
    "",
    `    $topCommands = ${psEntryList(model.commands)}`,
    `    $globalFlags = ${psFlagList(model.globalFlags)}`,
    "    $subcommands = @{",
    ...subEntries,
    "    }",
    "    $scopeFlags = @{",
    ...scopeFlagEntries,
    "    }",
    "    $scopePositionalValues = @{",
    ...scopePosEntries,
    "    }",
    `    $connectionPositionalScopes = ${connScopes}`,
    "",
    "    $resolveFlags = {",
    "        param($cmdName, $subName)",
    "        $byLong = [ordered]@{}",
    "        foreach ($f in $globalFlags) { $byLong[$f.L] = $f }",
    `        $key = if ($subName) { "$cmdName $subName" } elseif ($cmdName) { $cmdName } else { '' }`,
    "        if ($key -and $scopeFlags.ContainsKey($key)) {",
    "            foreach ($f in $scopeFlags[$key]) { $byLong[$f.L] = $f }",
    "        } elseif ($cmdName -and $scopeFlags.ContainsKey($cmdName)) {",
    "            foreach ($f in $scopeFlags[$cmdName]) { $byLong[$f.L] = $f }",
    "        }",
    "        return @($byLong.Values)",
    "    }",
    "",
    "    $findFlag = {",
    "        param($flagList, $token)",
    "        foreach ($f in $flagList) {",
    "            if ($f.L -eq $token -or ($f.ContainsKey('S') -and $f.S -eq $token)) { return $f }",
    "        }",
    "        return $null",
    "    }",
    "",
    "    $getConnections = {",
    "        param($cfgPath)",
    "        $callArgs = @('__complete-connections')",
    "        if ($cfgPath) { $callArgs += @('--config', $cfgPath) }",
    "        $out = & wtctl @callArgs 2>$null",
    "        if (-not $out) { return @() }",
    "        return @($out | ForEach-Object { $_.ToString().Trim() } | Where-Object { $_ -ne '' })",
    "    }",
    "",
    "    $unquote = {",
    "        param($s)",
    `        if ($s.Length -ge 2 -and $s.StartsWith("'") -and $s.EndsWith("'")) {`,
    `            return $s.Substring(1, $s.Length - 2).Replace("''", "'")`,
    "        }",
    `        if ($s.Length -ge 2 -and $s.StartsWith('"') -and $s.EndsWith('"')) {`,
    "            return $s.Substring(1, $s.Length - 2).Replace('`\"', '\"').Replace('``', '`')",
    "        }",
    "        return $s",
    "    }",
    "",
    "    $tokens = @()",
    "    for ($i = 1; $i -lt $commandAst.CommandElements.Count; $i++) {",
    "        $el = $commandAst.CommandElements[$i]",
    "        if ($el.Extent.EndOffset -le $cursorPosition -and ($wordToComplete -eq '' -or $el.Extent.EndOffset -lt $cursorPosition)) {",
    "            if ($el -is [System.Management.Automation.Language.StringConstantExpressionAst] -or $el -is [System.Management.Automation.Language.ExpandableStringExpressionAst]) {",
    "                $tokens += $el.Value",
    "            } else {",
    "                $tokens += $el.Extent.Text",
    "            }",
    "        }",
    "    }",
    "",
    "    $cmd = $null",
    "    $sub = $null",
    "    $configPath = $null",
    "    $expectFlag = $null",
    "    $afterDoubleDash = $false",
    "    $posCount = 0",
    "",
    "    foreach ($tok in $tokens) {",
    "        if ($null -ne $expectFlag) {",
    "            if ($expectFlag.L -eq '--config') { $configPath = & $unquote $tok }",
    "            $expectFlag = $null",
    "            continue",
    "        }",
    "        if (-not $afterDoubleDash -and $tok -eq '--') {",
    "            $afterDoubleDash = $true",
    "            continue",
    "        }",
    "        if (-not $afterDoubleDash -and $tok.StartsWith('-')) {",
    "            if ($tok -match '^(--[A-Za-z0-9-]+)=(.*)$') {",
    "                if ($Matches[1] -eq '--config') { $configPath = & $unquote $Matches[2] }",
    "                continue",
    "            }",
    "            $curFlags = & $resolveFlags $cmd $sub",
    "            $matched = & $findFlag $curFlags $tok",
    "            if ($null -ne $matched -and $matched.V) { $expectFlag = $matched }",
    "            continue",
    "        }",
    "        if (-not $cmd) {",
    "            $cmd = $tok",
    "        } elseif (-not $sub -and $subcommands.ContainsKey($cmd)) {",
    "            $sub = $tok",
    "        } else {",
    "            $posCount++",
    "        }",
    "    }",
    "",
    "    $activeFlags = & $resolveFlags $cmd $sub",
    `    $scopeKey = if ($sub) { "$cmd $sub" } elseif ($cmd) { $cmd } else { '' }`,
    "",
    "    if ($null -ne $expectFlag) {",
    "        if ($expectFlag.ContainsKey('Dyn') -and $expectFlag.Dyn -eq 'connections') {",
    "            foreach ($name in (& $getConnections $configPath)) {",
    "                if ($name.StartsWith($wordToComplete, [System.StringComparison]::OrdinalIgnoreCase)) {",
    "                    [System.Management.Automation.CompletionResult]::new($name, $name, 'ParameterValue', 'Подключение')",
    "                }",
    "            }",
    "        } elseif ($expectFlag.ContainsKey('E')) {",
    "            foreach ($val in $expectFlag.E) {",
    "                if ($val.StartsWith($wordToComplete, [System.StringComparison]::OrdinalIgnoreCase)) {",
    "                    [System.Management.Automation.CompletionResult]::new($val, $val, 'ParameterValue', $val)",
    "                }",
    "            }",
    "        }",
    "        return",
    "    }",
    "",
    "    if (-not $afterDoubleDash -and $wordToComplete -match '^(--[A-Za-z0-9-]+)=(.*)$') {",
    "        $flagName = $Matches[1]",
    "        $valPrefix = $Matches[2]",
    "        $matched = & $findFlag $activeFlags $flagName",
    "        if ($null -ne $matched) {",
    "            if ($matched.ContainsKey('Dyn') -and $matched.Dyn -eq 'connections') {",
    "                foreach ($name in (& $getConnections $configPath)) {",
    "                    if ($name.StartsWith($valPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {",
    `                        [System.Management.Automation.CompletionResult]::new("$flagName=$name", $name, 'ParameterValue', 'Подключение')`,
    "                    }",
    "                }",
    "            } elseif ($matched.ContainsKey('E')) {",
    "                foreach ($val in $matched.E) {",
    "                    if ($val.StartsWith($valPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {",
    `                        [System.Management.Automation.CompletionResult]::new("$flagName=$val", $val, 'ParameterValue', $val)`,
    "                    }",
    "                }",
    "            }",
    "        }",
    "        return",
    "    }",
    "",
    "    if (-not $afterDoubleDash -and $wordToComplete.StartsWith('-')) {",
    "        foreach ($f in $activeFlags) {",
    "            if ($f.L.StartsWith($wordToComplete, [System.StringComparison]::OrdinalIgnoreCase)) {",
    "                [System.Management.Automation.CompletionResult]::new($f.L, $f.L, 'ParameterName', $f.D)",
    "            }",
    "            if ($f.ContainsKey('S') -and $f.S.StartsWith($wordToComplete, [System.StringComparison]::OrdinalIgnoreCase)) {",
    "                [System.Management.Automation.CompletionResult]::new($f.S, $f.S, 'ParameterName', $f.D)",
    "            }",
    "        }",
    "        return",
    "    }",
    "",
    "    if (-not $cmd) {",
    "        foreach ($item in $topCommands) {",
    "            if ($item.N.StartsWith($wordToComplete, [System.StringComparison]::OrdinalIgnoreCase)) {",
    "                [System.Management.Automation.CompletionResult]::new($item.N, $item.N, 'Command', $item.D)",
    "            }",
    "        }",
    "        return",
    "    }",
    "",
    "    if (-not $sub -and $subcommands.ContainsKey($cmd)) {",
    "        foreach ($item in $subcommands[$cmd]) {",
    "            if ($item.N.StartsWith($wordToComplete, [System.StringComparison]::OrdinalIgnoreCase)) {",
    "                [System.Management.Automation.CompletionResult]::new($item.N, $item.N, 'Command', $item.D)",
    "            }",
    "        }",
    "        return",
    "    }",
    "",
    "    if ($posCount -eq 0) {",
    "        if ($connectionPositionalScopes -contains $scopeKey) {",
    "            foreach ($name in (& $getConnections $configPath)) {",
    "                if ($name.StartsWith($wordToComplete, [System.StringComparison]::OrdinalIgnoreCase)) {",
    "                    [System.Management.Automation.CompletionResult]::new($name, $name, 'ParameterValue', 'Подключение')",
    "                }",
    "            }",
    "            return",
    "        }",
    "        if ($scopePositionalValues.ContainsKey($scopeKey)) {",
    "            foreach ($item in $scopePositionalValues[$scopeKey]) {",
    "                if ($item.N.StartsWith($wordToComplete, [System.StringComparison]::OrdinalIgnoreCase)) {",
    "                    [System.Management.Automation.CompletionResult]::new($item.N, $item.N, 'ParameterValue', $item.D)",
    "                }",
    "            }",
    "        }",
    "    }",
    "}",
    ""
  ].join("\n");
}
function allFlagTokens(flags) {
  const out = [];
  for (const flag of flags) {
    out.push(flag.long);
    if (flag.short) out.push(flag.short);
  }
  return out;
}
function generateBashCompletion(model) {
  const topNames = model.commands.map((c) => c.name).join(" ");
  const cmdsWithSubs = [...model.subcommands.keys()].join("|");
  const globalFlagNames = allFlagTokens(model.globalFlags).join(" ");
  const globalValFlags = allFlagTokens(model.globalFlags.filter((f) => f.takesValue)).join("|");
  const subCases = [...model.subcommands.entries()].map(
    ([cmd, items]) => `    ${cmd}) echo '${items.map((i) => i.name).join(" ")}' ;;`
  );
  const scopeFlagCases = [];
  const scopeValFlagCases = [];
  const scopeEnumCases = [];
  for (const [scope, localFlags] of model.scopeFlags.entries()) {
    const localTokens = allFlagTokens(localFlags);
    if (localTokens.length > 0) {
      scopeFlagCases.push(`    '${scope}') echo '${localTokens.join(" ")}' ;;`);
    }
    const localBoolShorts = localFlags.filter((f) => !f.takesValue && f.short).map((f) => f.short);
    const localValTokens = allFlagTokens(localFlags.filter((f) => f.takesValue));
    if (localBoolShorts.length > 0 || localValTokens.length > 0) {
      scopeValFlagCases.push(`    '${scope}')`);
      if (localBoolShorts.length > 0) {
        scopeValFlagCases.push(
          `      case "$flag" in ${localBoolShorts.join("|")}) return 1 ;; esac`
        );
      }
      if (localValTokens.length > 0) {
        scopeValFlagCases.push(
          `      case "$flag" in ${localValTokens.join("|")}) return 0 ;; esac`
        );
      }
      scopeValFlagCases.push("      ;;");
    }
    for (const flag of localFlags) {
      if (!flag.values?.length) continue;
      const pattern = flag.short ? `'${scope}:${flag.long}'|'${scope}:${flag.short}'` : `'${scope}:${flag.long}'`;
      scopeEnumCases.push(`    ${pattern}) echo '${flag.values.join(" ")}'; return 0 ;;`);
    }
  }
  const globalEnumCases = [];
  for (const flag of model.globalFlags) {
    if (!flag.values?.length) continue;
    const pattern = flag.short ? `${flag.long}|${flag.short}` : flag.long;
    globalEnumCases.push(`    ${pattern}) echo '${flag.values.join(" ")}' ;;`);
  }
  const posCases = [...model.scopePositionalValues.entries()].map(
    ([scope, items]) => `    '${scope}') echo '${items.map((i) => i.name).join(" ")}' ;;`
  );
  const connScopePattern = [...model.connectionPositionalScopes].map((s) => `'${s}'`).join("|");
  return [
    '# Автодополнение wtctl для bash (подключение: eval "$(wtctl completion bash --format raw)")',
    "",
    "_wtctl_complete_connections() {",
    '  local cfg="$1"',
    '  if [[ -n "$cfg" ]]; then',
    '    wtctl __complete-connections --config "$cfg" 2>/dev/null',
    "  else",
    "    wtctl __complete-connections 2>/dev/null",
    "  fi",
    "}",
    "",
    "_wtctl_has_subcommands() {",
    '  case "$1" in',
    `    ${cmdsWithSubs}) return 0 ;;`,
    "    *) return 1 ;;",
    "  esac",
    "}",
    "",
    "_wtctl_subcommands() {",
    '  case "$1" in',
    ...subCases,
    "  esac",
    "}",
    "",
    "_wtctl_local_flags() {",
    '  case "$1" in',
    ...scopeFlagCases,
    "  esac",
    "}",
    "",
    "_wtctl_scope_flags() {",
    '  local scope="$1" cmd="$2" local_flags',
    '  local_flags="$(_wtctl_local_flags "$scope")"',
    '  if [[ -z "$local_flags" && -n "$cmd" && "$scope" != "$cmd" ]]; then',
    '    local_flags="$(_wtctl_local_flags "$cmd")"',
    "  fi",
    `  echo "${globalFlagNames} \${local_flags}"`,
    "}",
    "",
    "_wtctl_scope_flag_takes_value() {",
    '  local scope="$1" flag="$2"',
    '  case "$scope" in',
    ...scopeValFlagCases,
    "  esac",
    "  return 2",
    "}",
    "",
    "_wtctl_flag_takes_value() {",
    '  local scope="$1" cmd="$2" flag="$3" rc',
    '  _wtctl_scope_flag_takes_value "$scope" "$flag"; rc=$?',
    '  if (( rc != 2 )); then return "$rc"; fi',
    '  if [[ -n "$cmd" && "$scope" != "$cmd" ]]; then',
    '    _wtctl_scope_flag_takes_value "$cmd" "$flag"; rc=$?',
    '    if (( rc != 2 )); then return "$rc"; fi',
    "  fi",
    '  case "$flag" in',
    `    ${globalValFlags}) return 0 ;;`,
    "    *) return 1 ;;",
    "  esac",
    "}",
    "",
    "_wtctl_flag_values() {",
    '  local scope="$1" flag="$2"',
    '  case "${scope}:${flag}" in',
    ...scopeEnumCases,
    "  esac",
    '  case "$flag" in',
    ...globalEnumCases,
    "  esac",
    "}",
    "",
    "_wtctl_positional_values() {",
    '  case "$1" in',
    ...posCases,
    "  esac",
    "}",
    "",
    "_wtctl_unquote() {",
    '  local s="$1"',
    `  if (( \${#s} >= 2 )) && [[ "\${s:0:1}" == '"' && "\${s: -1}" == '"' ]]; then`,
    '    s="${s:1:${#s}-2}"',
    '    s="${s//\\\\\\"/\\"}"',
    '    s="${s//\\\\\\\\/\\\\}"',
    '  elif (( ${#s} >= 2 )) && [[ "${s:0:1}" == "\'" && "${s: -1}" == "\'" ]]; then',
    '    s="${s:1:${#s}-2}"',
    "  else",
    '    s="${s//\\\\ / }"',
    '    s="${s//\\\\\\"/\\"}"',
    `    s="\${s//\\\\'/'}"`,
    "  fi",
    `  printf '%s' "$s"`,
    "}",
    "",
    "_wtctl_completions() {",
    '  local cur="${COMP_WORDS[COMP_CWORD]}"',
    '  local cmd="" sub="" config_path="" expect_flag="" after_dd=0 pos_count=0 i tok scope',
    "",
    "  for ((i = 1; i < COMP_CWORD; i++)); do",
    '    tok="${COMP_WORDS[i]}"',
    '    if [[ -n "$expect_flag" ]]; then',
    '      if [[ "$expect_flag" == "--config" ]]; then config_path="$(_wtctl_unquote "$tok")"; fi',
    '      expect_flag=""',
    "      continue",
    "    fi",
    '    if (( !after_dd )) && [[ "$tok" == "--" ]]; then',
    "      after_dd=1",
    "      continue",
    "    fi",
    '    if (( !after_dd )) && [[ "$tok" == -* ]]; then',
    '      if [[ "$tok" == --*=* ]]; then',
    '        if [[ "${tok%%=*}" == "--config" ]]; then config_path="$(_wtctl_unquote "${tok#*=}")"; fi',
    "        continue",
    "      fi",
    '      if (( i + 1 < COMP_CWORD )) && [[ "${COMP_WORDS[i+1]}" == "=" ]]; then',
    "        if (( i + 2 < COMP_CWORD )); then",
    '          if [[ "$tok" == "--config" ]]; then config_path="$(_wtctl_unquote "${COMP_WORDS[i+2]}")"; fi',
    "          ((i += 2))",
    "        else",
    '          expect_flag="$tok"',
    "          ((i++))",
    "        fi",
    "        continue",
    "      fi",
    '      scope="${sub:+$cmd $sub}"',
    '      scope="${scope:-$cmd}"',
    '      if _wtctl_flag_takes_value "$scope" "$cmd" "$tok"; then expect_flag="$tok"; fi',
    "      continue",
    "    fi",
    '    if [[ -z "$cmd" ]]; then',
    '      cmd="$tok"',
    '    elif [[ -z "$sub" ]] && _wtctl_has_subcommands "$cmd"; then',
    '      sub="$tok"',
    "    else",
    "      ((pos_count++))",
    "    fi",
    "  done",
    "",
    '  scope="${sub:+$cmd $sub}"',
    '  scope="${scope:-$cmd}"',
    "",
    '  if [[ -n "$expect_flag" ]]; then',
    '    local prefix="" match_cur="$cur"',
    '    if [[ "$cur" == "=" ]]; then prefix="="; match_cur=""; fi',
    '    if [[ "$expect_flag" == "-c" || "$expect_flag" == "--connection" ]]; then',
    '      local conns; conns="$(_wtctl_complete_connections "$config_path")"',
    '      COMPREPLY=( $(compgen -P "$prefix" -W "$conns" -- "$match_cur") )',
    "      return 0",
    "    fi",
    '    local vals; vals="$(_wtctl_flag_values "$scope" "$expect_flag")"',
    '    if [[ -n "$vals" ]]; then COMPREPLY=( $(compgen -P "$prefix" -W "$vals" -- "$match_cur") ); fi',
    "    return 0",
    "  fi",
    "",
    '  if (( !after_dd )) && [[ "$cur" == --*=* ]]; then',
    '    local flag_name="${cur%%=*}" val_prefix="${cur#*=}" vals item',
    '    if [[ "$flag_name" == "--connection" ]]; then',
    '      vals="$(_wtctl_complete_connections "$config_path")"',
    "    else",
    '      vals="$(_wtctl_flag_values "$scope" "$flag_name")"',
    "    fi",
    "    COMPREPLY=()",
    "    for item in $vals; do",
    '      if [[ "$item" == "$val_prefix"* ]]; then COMPREPLY+=("${flag_name}=${item}"); fi',
    "    done",
    "    return 0",
    "  fi",
    "",
    '  if (( !after_dd )) && [[ "$cur" == -* ]]; then',
    '    local flags; flags="$(_wtctl_scope_flags "$scope" "$cmd")"',
    '    COMPREPLY=( $(compgen -W "$flags" -- "$cur") )',
    "    return 0",
    "  fi",
    "",
    '  if [[ -z "$cmd" ]]; then',
    `    COMPREPLY=( $(compgen -W '${topNames}' -- "$cur") )`,
    "    return 0",
    "  fi",
    "",
    '  if [[ -z "$sub" ]] && _wtctl_has_subcommands "$cmd"; then',
    '    local subs; subs="$(_wtctl_subcommands "$cmd")"',
    '    COMPREPLY=( $(compgen -W "$subs" -- "$cur") )',
    "    return 0",
    "  fi",
    "",
    "  if (( pos_count == 0 )); then",
    '    case "$scope" in',
    `      ${connScopePattern})`,
    '        local conns; conns="$(_wtctl_complete_connections "$config_path")"',
    '        COMPREPLY=( $(compgen -W "$conns" -- "$cur") )',
    "        return 0",
    "        ;;",
    "    esac",
    '    local pvals; pvals="$(_wtctl_positional_values "$scope")"',
    '    if [[ -n "$pvals" ]]; then COMPREPLY=( $(compgen -W "$pvals" -- "$cur") ); fi',
    "  fi",
    "}",
    "",
    "complete -o default -F _wtctl_completions wtctl",
    ""
  ].join("\n");
}
function zshQuote(text) {
  return `'${text.replaceAll("'", "'\\''")}'`;
}
function zshDescribeEntry(name, description) {
  const desc = cleanDescription(description, name).replaceAll("\\", "\\\\").replaceAll(":", "\\:");
  return zshQuote(`${name}:${desc}`);
}
function zshFlagDescribeEntries(flags) {
  const entries = [];
  for (const flag of flags) {
    entries.push(zshDescribeEntry(flag.long, flag.description));
    if (flag.short) entries.push(zshDescribeEntry(flag.short, flag.description));
  }
  return entries.join(" ");
}
function generateZshCompletion(model) {
  const topEntries = model.commands.map((c) => zshDescribeEntry(c.name, c.description)).join(" ");
  const cmdsWithSubs = [...model.subcommands.keys()].join("|");
  const globalValFlags = allFlagTokens(model.globalFlags.filter((f) => f.takesValue)).join("|");
  const globalFlagEntries = zshFlagDescribeEntries(model.globalFlags);
  const subCases = [...model.subcommands.entries()].map(
    ([cmd, items]) => `    ${cmd}) items=(${items.map((i) => zshDescribeEntry(i.name, i.description)).join(" ")}) ;;`
  );
  const scopeFlagCases = [];
  const scopeValFlagCases = [];
  const scopeEnumCases = [];
  for (const [scope, localFlags] of model.scopeFlags.entries()) {
    const localEntries = zshFlagDescribeEntries(localFlags);
    if (localEntries) {
      scopeFlagCases.push(`    ${zshQuote(scope)}) local_flags=(${localEntries}) ;;`);
    }
    const localBoolShorts = localFlags.filter((f) => !f.takesValue && f.short).map((f) => f.short);
    const localValTokens = allFlagTokens(localFlags.filter((f) => f.takesValue));
    if (localBoolShorts.length > 0 || localValTokens.length > 0) {
      scopeValFlagCases.push(`    ${zshQuote(scope)})`);
      if (localBoolShorts.length > 0) {
        scopeValFlagCases.push(
          `      case "$flag" in ${localBoolShorts.join("|")}) return 1 ;; esac`
        );
      }
      if (localValTokens.length > 0) {
        scopeValFlagCases.push(
          `      case "$flag" in ${localValTokens.join("|")}) return 0 ;; esac`
        );
      }
      scopeValFlagCases.push("      ;;");
    }
    for (const flag of localFlags) {
      if (!flag.values?.length) continue;
      const pattern = flag.short ? `${zshQuote(`${scope}:${flag.long}`)}|${zshQuote(`${scope}:${flag.short}`)}` : zshQuote(`${scope}:${flag.long}`);
      scopeEnumCases.push(`    ${pattern}) vals=(${flag.values.map(zshQuote).join(" ")}) ;;`);
    }
  }
  const globalEnumCases = [];
  for (const flag of model.globalFlags) {
    if (!flag.values?.length) continue;
    const pattern = flag.short ? `${flag.long}|${flag.short}` : flag.long;
    globalEnumCases.push(`    ${pattern}) vals=(${flag.values.map(zshQuote).join(" ")}) ;;`);
  }
  const posCases = [...model.scopePositionalValues.entries()].map(
    ([scope, items]) => `    ${zshQuote(scope)}) items=(${items.map((i) => zshDescribeEntry(i.name, i.description)).join(" ")}) ;;`
  );
  const connScopePattern = [...model.connectionPositionalScopes].map(zshQuote).join("|");
  return [
    "#compdef wtctl",
    '# Автодополнение wtctl для zsh (подключение: eval "$(wtctl completion zsh --format raw)")',
    "",
    "_wtctl_complete_connections() {",
    '  local cfg="$1"',
    "  local -a conns",
    '  if [[ -n "$cfg" ]]; then',
    '    conns=(${(f)"$(wtctl __complete-connections --config "$cfg" 2>/dev/null)"})',
    "  else",
    '    conns=(${(f)"$(wtctl __complete-connections 2>/dev/null)"})',
    "  fi",
    "  (( ${#conns} )) && [[ -n \"${conns[1]}\" ]] && _describe -t connections 'подключение' conns",
    "}",
    "",
    "_wtctl_has_subcommands() {",
    '  case "$1" in',
    `    ${cmdsWithSubs}) return 0 ;;`,
    "    *) return 1 ;;",
    "  esac",
    "}",
    "",
    "_wtctl_scope_flag_takes_value() {",
    '  local scope="$1" flag="$2"',
    '  case "$scope" in',
    ...scopeValFlagCases,
    "  esac",
    "  return 2",
    "}",
    "",
    "_wtctl_flag_takes_value() {",
    '  local scope="$1" cmd="$2" flag="$3" rc',
    '  _wtctl_scope_flag_takes_value "$scope" "$flag"; rc=$?',
    '  if (( rc != 2 )); then return "$rc"; fi',
    '  if [[ -n "$cmd" && "$scope" != "$cmd" ]]; then',
    '    _wtctl_scope_flag_takes_value "$cmd" "$flag"; rc=$?',
    '    if (( rc != 2 )); then return "$rc"; fi',
    "  fi",
    '  case "$flag" in',
    `    ${globalValFlags}) return 0 ;;`,
    "    *) return 1 ;;",
    "  esac",
    "}",
    "",
    "_wtctl_flag_values() {",
    '  local scope="$1" flag="$2"',
    "  local -a vals",
    '  case "${scope}:${flag}" in',
    ...scopeEnumCases,
    "  esac",
    "  if (( ! ${#vals} )); then",
    '    case "$flag" in',
    ...globalEnumCases,
    "    esac",
    "  fi",
    "  (( ${#vals} )) && compadd -a vals",
    "}",
    "",
    "_wtctl_local_flags() {",
    '  case "$1" in',
    ...scopeFlagCases,
    "  esac",
    "}",
    "",
    "_wtctl() {",
    '  local cur="${words[CURRENT]}"',
    '  local cmd="" sub="" config_path="" expect_flag="" scope=""',
    "  local -i after_dd=0 pos_count=0 i",
    "  local tok cfg_raw",
    "",
    "  for (( i = 2; i < CURRENT; i++ )); do",
    '    tok="${words[i]}"',
    '    if [[ -n "$expect_flag" ]]; then',
    '      [[ "$expect_flag" == "--config" ]] && config_path="${(Q)tok}"',
    '      expect_flag=""',
    "      continue",
    "    fi",
    '    if (( !after_dd )) && [[ "$tok" == "--" ]]; then',
    "      after_dd=1",
    "      continue",
    "    fi",
    '    if (( !after_dd )) && [[ "$tok" == -* ]]; then',
    '      if [[ "$tok" == --*=* ]]; then',
    '        if [[ "${tok%%=*}" == "--config" ]]; then',
    '          cfg_raw="${tok#*=}"',
    '          config_path="${(Q)cfg_raw}"',
    "        fi",
    "        continue",
    "      fi",
    '      scope="${sub:+$cmd $sub}"',
    '      scope="${scope:-$cmd}"',
    '      _wtctl_flag_takes_value "$scope" "$cmd" "$tok" && expect_flag="$tok"',
    "      continue",
    "    fi",
    '    if [[ -z "$cmd" ]]; then',
    '      cmd="$tok"',
    '    elif [[ -z "$sub" ]] && _wtctl_has_subcommands "$cmd"; then',
    '      sub="$tok"',
    "    else",
    "      (( pos_count++ ))",
    "    fi",
    "  done",
    "",
    '  scope="${sub:+$cmd $sub}"',
    '  scope="${scope:-$cmd}"',
    "",
    '  if [[ -n "$expect_flag" ]]; then',
    '    if [[ "$expect_flag" == "-c" || "$expect_flag" == "--connection" ]]; then',
    '      _wtctl_complete_connections "$config_path"',
    "      return",
    "    fi",
    '    _wtctl_flag_values "$scope" "$expect_flag"',
    "    return",
    "  fi",
    "",
    '  if (( !after_dd )) && [[ "$cur" == --*=* ]]; then',
    '    local flag_name="${cur%%=*}"',
    '    compset -P "${flag_name}="',
    '    if [[ "$flag_name" == "--connection" ]]; then',
    '      _wtctl_complete_connections "$config_path"',
    "    else",
    '      _wtctl_flag_values "$scope" "$flag_name"',
    "    fi",
    "    return",
    "  fi",
    "",
    '  if (( !after_dd )) && [[ "$cur" == -* ]]; then',
    `    local -a global_flags=(${globalFlagEntries})`,
    "    local -a local_flags=()",
    '    _wtctl_local_flags "$scope"',
    '    if (( ! ${#local_flags} )) && [[ -n "$cmd" && "$scope" != "$cmd" ]]; then',
    '      _wtctl_local_flags "$cmd"',
    "    fi",
    '    local -a flags=("${local_flags[@]}" "${global_flags[@]}")',
    "    _describe -t options 'параметр' flags",
    "    return",
    "  fi",
    "",
    '  if [[ -z "$cmd" ]]; then',
    `    local -a commands=(${topEntries})`,
    "    _describe -t commands 'команда' commands",
    "    return",
    "  fi",
    "",
    '  if [[ -z "$sub" ]] && _wtctl_has_subcommands "$cmd"; then',
    "    local -a items",
    '    case "$cmd" in',
    ...subCases,
    "    esac",
    "    _describe -t subcommands 'подкоманда' items",
    "    return",
    "  fi",
    "",
    "  if (( pos_count == 0 )); then",
    '    case "$scope" in',
    `      ${connScopePattern})`,
    '        _wtctl_complete_connections "$config_path"',
    "        return",
    "        ;;",
    "    esac",
    "    local -a items",
    '    case "$scope" in',
    ...posCases,
    "    esac",
    "    (( ${#items} )) && _describe -t values 'значение' items && return",
    "  fi",
    "",
    "  _files",
    "}",
    "",
    'if [[ "${funcstack[1]:-}" == "_wtctl" ]]; then',
    '  _wtctl "$@"',
    "else",
    "  compdef _wtctl wtctl",
    "fi",
    ""
  ].join("\n");
}
function generateCompletion(shell) {
  const model = buildCompletionModel();
  if (shell === "pwsh") return generatePwshCompletion(model);
  if (shell === "bash") return generateBashCompletion(model);
  return generateZshCompletion(model);
}

// src/cli/config-commands.ts
import { lstatSync, readlinkSync, realpathSync } from "node:fs";
import { basename as basename2, dirname as dirname2, join, resolve as resolve3 } from "node:path";

// src/cli/format/index.ts
import process3 from "node:process";

// src/cli/format/ansi.ts
import process2 from "node:process";
var PLAIN = {
  bold: (text) => text,
  dim: (text) => text,
  red: (text) => text,
  green: (text) => text,
  yellow: (text) => text,
  cyan: (text) => text
};
var wrap = (open2, close) => (text) => text ? `\x1B[${open2}m${text}\x1B[${close}m` : "";
var COLORED = {
  bold: wrap("1", "22"),
  dim: wrap("2", "22"),
  red: wrap("31", "39"),
  green: wrap("32", "39"),
  yellow: wrap("33", "39"),
  cyan: wrap("36", "39")
};
var ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;
function createStyler(enabled) {
  return enabled ? COLORED : PLAIN;
}
function stripAnsi(text) {
  return text.replace(ANSI_RE, "");
}
function envColor(isTTY) {
  const noColor = process2.env.NO_COLOR;
  if (noColor !== void 0 && noColor !== "") return false;
  const forceColor = process2.env.FORCE_COLOR;
  if (forceColor === "0" || forceColor === "false") return false;
  if (forceColor !== void 0 && forceColor !== "") return true;
  return isTTY;
}
function resolveColor(io, stream = "stdout") {
  if (io.color !== void 0) return io.color;
  return envColor(stream === "stderr" ? io.stderrIsTTY === true : io.stdoutIsTTY === true);
}

// src/cli/format/csv.ts
function tabularCellText(value) {
  if (value === null || value === void 0) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint")
    return String(value);
  return JSON.stringify(
    value,
    (_key, item) => typeof item === "bigint" ? item.toString(10) : item
  );
}
function escapeCsvField(text) {
  if (/[",\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}
function escapeTsvField(text) {
  return text.replace(/\r\n|[\r\n\t]/g, " ");
}
function formatCsvRow(values) {
  return values.map((value) => escapeCsvField(tabularCellText(value))).join(",");
}
function formatTsvRow(values) {
  return values.map((value) => escapeTsvField(tabularCellText(value))).join("	");
}
function formatCsv(headers, rows2) {
  if (headers.length === 0) return "";
  const lines = [
    formatCsvRow(headers),
    ...rows2.map((row) => formatCsvRow(headers.map((_, index) => row[index])))
  ];
  return `${lines.join("\n")}
`;
}
function formatTsv(headers, rows2) {
  if (headers.length === 0) return "";
  const lines = [
    formatTsvRow(headers),
    ...rows2.map((row) => formatTsvRow(headers.map((_, index) => row[index])))
  ];
  return `${lines.join("\n")}
`;
}

// src/cli/format/table.ts
function codePointWidth(cp) {
  if (cp < 32 || cp >= 127 && cp < 160) return 0;
  if (cp >= 768 && cp <= 879 || cp >= 6832 && cp <= 6911 || cp >= 7616 && cp <= 7679 || cp >= 8400 && cp <= 8447 || cp >= 65024 && cp <= 65039 || cp >= 65056 && cp <= 65071 || cp === 8205)
    return 0;
  if (cp >= 4352 && (cp <= 4447 || cp === 9001 || cp === 9002 || cp >= 11904 && cp <= 42191 && cp !== 12351 || cp >= 44032 && cp <= 55203 || cp >= 63744 && cp <= 64255 || cp >= 65040 && cp <= 65049 || cp >= 65072 && cp <= 65135 || cp >= 65280 && cp <= 65376 || cp >= 65504 && cp <= 65510 || cp >= 127744 && cp <= 130047 || cp >= 131072 && cp <= 262141))
    return 2;
  return 1;
}
function displayWidth(text) {
  let width = 0;
  for (const ch of stripAnsi(text)) width += codePointWidth(ch.codePointAt(0));
  return width;
}
function truncateText(text, maxWidth) {
  if (maxWidth <= 0) return "";
  if (displayWidth(text) <= maxWidth) return text;
  if (maxWidth === 1) return "…";
  const target = maxWidth - 1;
  let result = "";
  let width = 0;
  let hasAnsi = false;
  let i = 0;
  while (i < text.length) {
    if (text.charCodeAt(i) === 27 && text[i + 1] === "[") {
      const end = text.slice(i).search(/[A-Za-z]/);
      if (end > 0) {
        result += text.slice(i, i + end + 1);
        hasAnsi = true;
        i += end + 1;
        continue;
      }
    }
    const cp = text.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    const w = codePointWidth(cp);
    if (width + w > target) break;
    result += ch;
    width += w;
    i += ch.length;
  }
  return `${result}…${hasAnsi ? "\x1B[0m" : ""}`;
}
function sanitizeCell(value) {
  return value.replace(/\r?\n|\t/g, " ");
}
function padCell(text, width, align, trimRight) {
  const truncated = truncateText(text, width);
  const gap = Math.max(0, width - displayWidth(truncated));
  if (align === "right") return " ".repeat(gap) + truncated;
  return trimRight ? truncated : truncated + " ".repeat(gap);
}
function fitWidths(columns, rows2, maxWidth, gapWidth) {
  const natural = columns.map(
    (column, colIndex) => Math.max(displayWidth(column.header), ...rows2.map((row) => displayWidth(row[colIndex] ?? "")))
  );
  if (maxWidth === void 0 || maxWidth <= 0 || columns.length === 0) return natural;
  const widths = [...natural];
  const minWidths = columns.map((column, index) => Math.min(natural[index], column.minWidth ?? 4));
  const totalGaps = gapWidth * (columns.length - 1);
  const sum = () => widths.reduce((acc, w) => acc + w, 0) + totalGaps;
  const shrinkTo = (floors) => {
    while (sum() > maxWidth) {
      let widest = -1;
      for (let i = 0; i < widths.length; i++) {
        if (widths[i] > floors[i] && (widest < 0 || widths[i] > widths[widest])) widest = i;
      }
      if (widest < 0) break;
      widths[widest]--;
    }
  };
  shrinkTo(minWidths);
  shrinkTo(widths.map(() => 1));
  return widths;
}
function renderTable(columns, rows2, options = {}) {
  if (columns.length === 0) return "";
  const styler = options.styler ?? createStyler(false);
  const gap = "  ";
  const cleanRows = rows2.map((row) => columns.map((_, index) => sanitizeCell(row[index] ?? "")));
  const widths = fitWidths(columns, cleanRows, options.maxWidth, gap.length);
  const last = columns.length - 1;
  const headerLine = columns.map(
    (column, index) => styler.bold(
      padCell(
        column.header,
        widths[index],
        column.align ?? "left",
        index === last && (column.align ?? "left") === "left"
      )
    )
  ).join(gap);
  const separatorLine = widths.map((width) => styler.dim("─".repeat(Math.max(1, width)))).join(gap);
  const bodyLines = cleanRows.map(
    (row) => columns.map((column, index) => {
      const align = column.align ?? "left";
      const cell = padCell(
        row[index],
        widths[index],
        align,
        index === last && align === "left"
      );
      return column.style ? column.style(cell) : cell;
    }).join(gap)
  );
  return [headerLine, separatorLine, ...bodyLines].join("\n");
}

// src/cli/format/human.ts
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function compactJson(value) {
  return JSON.stringify(
    value,
    (_key, item) => typeof item === "bigint" ? item.toString(10) : item
  );
}
function ensureNewline(text) {
  if (!text) return "";
  return text.endsWith("\n") ? text : `${text}
`;
}
function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return `${bytes} Б`;
  if (bytes < 1024) return `${Math.round(bytes)} Б`;
  const kib = bytes / 1024;
  if (kib < 1024)
    return `${kib >= 100 || Number.isInteger(kib) ? Math.round(kib) : kib.toFixed(1)} КиБ`;
  const mib = kib / 1024;
  if (mib < 1024)
    return `${mib >= 100 || Number.isInteger(mib) ? Math.round(mib) : mib.toFixed(1)} МиБ`;
  return `${(mib / 1024).toFixed(2)} ГиБ`;
}
function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "0 мс";
  if (ms < 1e3) return `${Math.round(ms)} мс`;
  return `${(ms / 1e3).toFixed(2)} с`;
}
function formatIsoIntervalDuration(startedAt, finishedAt) {
  const parse = (value) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(value.trim());
    if (!match) return void 0;
    const ms = Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Number(match[6])
    );
    return Number.isNaN(ms) ? void 0 : ms;
  };
  const start = parse(startedAt);
  const end = parse(finishedAt);
  if (start === void 0 || end === void 0 || end < start) return void 0;
  const totalSec = Math.round((end - start) / 1e3);
  if (totalSec < 60) return `${totalSec} с`;
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor(totalSec % 3600 / 60);
  const seconds = totalSec % 60;
  const parts = [];
  if (hours > 0) parts.push(`${hours} ч`);
  if (minutes > 0) parts.push(`${minutes} мин`);
  if (seconds > 0) parts.push(`${seconds} с`);
  return parts.join(" ");
}
function normalizeBackgroundTasks(data) {
  if (!isRecord(data)) return [];
  const raw = data.Task;
  if (raw === void 0 || raw === null || raw === "") return [];
  if (Array.isArray(raw)) return raw.filter(isRecord);
  return isRecord(raw) ? [raw] : [];
}
function parseTaskState(task) {
  const running = task.IsRunning === "1" || task.IsRunning === 1 || task.IsRunning === true;
  const finished = task.IsRunning === "0" || task.IsRunning === 0 || task.IsRunning === false;
  const errText = typeof task.ErrorText === "string" && task.ErrorText.trim() !== "" ? task.ErrorText.trim() : void 0;
  const errCode = task.ErrorCode !== void 0 && String(task.ErrorCode).trim() !== "" && String(task.ErrorCode).trim() !== "0" ? String(task.ErrorCode).trim() : void 0;
  return {
    running,
    finished,
    ...errCode === void 0 ? {} : { errCode },
    ...errText === void 0 ? {} : { errText },
    hasError: errText !== void 0 || errCode !== void 0
  };
}
function summarizeTaskDetails(task) {
  const { errCode, errText } = parseTaskState(task);
  if (errText || errCode) {
    return errCode && errText ? `Ошибка [${errCode}]: ${errText}` : errText ? `Ошибка: ${errText}` : `Код ошибки: ${errCode}`;
  }
  if (task.Progress !== void 0 && task.Progress !== null && task.Progress !== "") {
    return formatInline(task.Progress);
  }
  if ("value" in task && task.value !== void 0) {
    return formatInline(task.value);
  }
  if (task.ResultData !== void 0 && task.ResultData !== null && task.ResultData !== "") {
    try {
      const decoded = rpcValue({ ResultData: task.ResultData });
      if (isRecord(decoded) && "value" in decoded) return formatInline(decoded.value);
    } catch {
    }
    return formatInline(task.ResultData);
  }
  return "";
}
function formatPermissions(permissions) {
  if (!isRecord(permissions)) return "read";
  const list = ["read"];
  if (permissions.write === true) list.push("write");
  if (permissions.execute === true) list.push("execute");
  return list.join(", ");
}
function formatInline(value) {
  if (value === void 0) return "—";
  if (value === null) return "null";
  if (typeof value === "string") return value === "" ? '""' : value.replace(/\r?\n/g, "\\n");
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint")
    return String(value);
  return compactJson(value);
}
function renderCard(entries, styler) {
  const nonEmpty = entries.filter(([, value]) => value !== "");
  if (!nonEmpty.length) return "";
  const labelWidth = Math.max(...nonEmpty.map(([label]) => label.length)) + 1;
  return nonEmpty.map(([label, value]) => `${styler.dim(`${label}:`.padEnd(labelWidth))}  ${value}`).join("\n");
}
function dimLine(styler, ...parts) {
  return styler.dim(parts.filter(Boolean).join(" · "));
}
function renderExtractedTable(table, options) {
  const cols = table.headers.map((header) => ({ header }));
  const rows2 = table.rows.map((row) => row.map((cell) => tabularCellText(cell)));
  return renderTable(cols, rows2, options);
}
function rawLines(items, pick) {
  const lines = items.map((item) => isRecord(item) ? pick(item) : "");
  return { kind: "text", text: lines.length ? `${lines.join("\n")}
` : "" };
}
function renderStructured(value, styler, indent = 0, depth = 0) {
  const pad = " ".repeat(indent);
  if (depth > 16) return `${pad}${compactJson(value)}`;
  if (value === null || value === void 0) return `${pad}${styler.dim("null")}`;
  if (typeof value === "boolean")
    return `${pad}${value ? styler.green("true") : styler.yellow("false")}`;
  if (typeof value === "number" || typeof value === "bigint")
    return `${pad}${styler.cyan(String(value))}`;
  if (typeof value === "string") {
    if (value === "") return `${pad}${styler.dim('""')}`;
    if (value.includes("\n")) {
      return value.split(/\r?\n/).map((line) => `${pad}${line}`).join("\n");
    }
    return `${pad}${value}`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}${styler.dim("[]")}`;
    const allShortPrimitives = value.length <= 6 && value.every(
      (item) => item === null || typeof item === "boolean" || typeof item === "number" || typeof item === "string" && !item.includes("\n") && item.length <= 32
    );
    if (allShortPrimitives) {
      const joined = value.map((item) => formatInline(item)).join(", ");
      if (joined.length <= 72) return `${pad}[${joined}]`;
    }
    return value.map((item) => {
      if (isRecord(item) && Object.keys(item).length > 0) {
        const nested = renderStructured(item, styler, indent + 2, depth + 1);
        return `${pad}- ${nested.slice(indent + 2)}`;
      }
      if (Array.isArray(item) && item.length > 0) {
        return `${pad}-
${renderStructured(item, styler, indent + 2, depth + 1)}`;
      }
      return `${pad}- ${renderStructured(item, styler, 0, depth + 1)}`;
    }).join("\n");
  }
  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return `${pad}${styler.dim("{}")}`;
    const lines = [];
    for (const [key, child] of entries) {
      const label = styler.dim(`${key}:`);
      if (child === null || child === void 0 || typeof child === "boolean" || typeof child === "number" || typeof child === "bigint" || typeof child === "string" && !child.includes("\n")) {
        lines.push(`${pad}${label} ${renderStructured(child, styler, 0, depth + 1)}`);
      } else if (typeof child === "string") {
        lines.push(`${pad}${label}`);
        for (const line of child.split(/\r?\n/)) lines.push(`${pad}  ${line}`);
      } else if (Array.isArray(child) && child.length === 0) {
        lines.push(`${pad}${label} ${styler.dim("[]")}`);
      } else if (isRecord(child) && Object.keys(child).length === 0) {
        lines.push(`${pad}${label} ${styler.dim("{}")}`);
      } else {
        const inlineArr = Array.isArray(child) && child.length <= 6 && child.every(
          (item) => item === null || typeof item === "boolean" || typeof item === "number" || typeof item === "string" && !item.includes("\n") && item.length <= 32
        ) ? child.map((item) => formatInline(item)).join(", ") : void 0;
        if (inlineArr !== void 0 && inlineArr.length <= 72) {
          lines.push(`${pad}${label} [${inlineArr}]`);
        } else {
          lines.push(`${pad}${label}`);
          lines.push(renderStructured(child, styler, indent + 2, depth + 1));
        }
      }
    }
    return lines.join("\n");
  }
  return `${pad}${String(value)}`;
}
function collectObjectKeys(items) {
  if (items.length === 0) return [];
  const keys = [];
  const seen = /* @__PURE__ */ new Set();
  for (const item of items) {
    if (!isRecord(item)) return void 0;
    for (const key of Object.keys(item)) {
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  }
  return keys.length > 0 ? keys : void 0;
}
function extractDocXml(data) {
  if (typeof data === "string") return data;
  if (!isRecord(data)) return void 0;
  const docNode = data.Data !== void 0 ? data.Data : findXmlNode(data, "Data");
  if (typeof docNode === "string") return docNode;
  if (isRecord(docNode)) {
    const keys = Object.keys(docNode).filter(
      (key) => !key.startsWith("@_") && !key.startsWith("#") && !key.startsWith("?")
    );
    if (keys.length > 0) {
      try {
        return buildXml(docNode);
      } catch {
        return void 0;
      }
    }
  }
  if (data.kind === "binary" && isRecord(data.bytes) && typeof data.bytes.base64 === "string") {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(
        Buffer.from(data.bytes.base64, "base64")
      );
    } catch {
      return void 0;
    }
  }
  return void 0;
}
function flattenManyObjects(items) {
  const fieldKeys = [];
  const seenFields = /* @__PURE__ */ new Set();
  let hasError = false;
  for (const item of items) {
    if (!isRecord(item)) continue;
    if (isRecord(item.error)) hasError = true;
    for (const source of [item.data, item.fromCatalog]) {
      if (!isRecord(source)) continue;
      for (const key of Object.keys(source)) {
        if (!seenFields.has(key)) {
          seenFields.add(key);
          fieldKeys.push(key);
        }
      }
    }
  }
  const extraFields = fieldKeys.filter((key) => key !== "id" && key !== "type");
  let errorHeader;
  if (hasError) {
    errorHeader = "error";
    while (seenFields.has(errorHeader)) errorHeader = `_${errorHeader}`;
  }
  const headers = [
    "id",
    "type",
    ...extraFields,
    ...errorHeader === void 0 ? [] : [errorHeader]
  ];
  const rows2 = items.map((raw) => {
    if (!isRecord(raw)) return headers.map(() => "");
    const docData = isRecord(raw.data) ? raw.data : {};
    const catalogData = isRecord(raw.fromCatalog) ? raw.fromCatalog : {};
    const err = isRecord(raw.error) ? `${String(raw.error.code ?? "")}: ${String(raw.error.message ?? "")}` : "";
    return headers.map((header) => {
      if (header === "id") return raw.id ?? (Object.hasOwn(docData, "id") ? docData.id : "");
      if (header === "type")
        return raw.type ?? (Object.hasOwn(docData, "type") ? docData.type : "");
      if (errorHeader !== void 0 && header === errorHeader) return err;
      if (Object.hasOwn(docData, header)) return docData[header];
      if (Object.hasOwn(catalogData, header)) return catalogData[header];
      return "";
    });
  });
  return { headers, rows: rows2 };
}
function extractTable(operationId, data, requestedFields) {
  if (operationId === "runtime.query" && isRecord(data) && Array.isArray(data.items)) {
    const ordered = requestedFields?.length ? [...new Set(requestedFields)] : collectObjectKeys(data.items);
    if (ordered === void 0) {
      if (data.items.every((item) => isRecord(item))) return { headers: [], rows: [] };
      return void 0;
    }
    const keys = [...ordered];
    const seen = new Set(keys);
    for (const item of data.items) {
      if (!isRecord(item)) return void 0;
      for (const key of Object.keys(item)) {
        if (!seen.has(key)) {
          seen.add(key);
          keys.push(key);
        }
      }
    }
    return {
      headers: keys,
      rows: data.items.map((item) => {
        const record = item;
        return keys.map((key) => Object.hasOwn(record, key) ? record[key] : "");
      })
    };
  }
  if (operationId === "schema.types" && isRecord(data) && Array.isArray(data.types)) {
    const headers = ["type", "catalog", "title", "customFields"];
    return {
      headers,
      rows: data.types.map((item) => {
        const record = isRecord(item) ? item : {};
        return [
          record.type ?? "",
          record.catalog ?? "",
          record.title ?? "",
          record.customFields ?? ""
        ];
      })
    };
  }
  if (operationId === "schema.get" && isRecord(data) && Array.isArray(data.fields)) {
    const headers = [
      "path",
      "type",
      "origin",
      "title",
      "references",
      "query",
      "computed",
      "required",
      "multiple"
    ];
    return {
      headers,
      rows: data.fields.map((item) => {
        const r = isRecord(item) ? item : {};
        return [
          r.path ?? "",
          r.type ?? "",
          r.origin ?? "",
          r.title ?? "",
          r.references ?? "",
          r.query === true ? "true" : "",
          r.computed === true ? "true" : "",
          r.required === true ? "true" : "",
          r.multiple === true ? "true" : ""
        ];
      })
    };
  }
  if (operationId === "logs.list" && isRecord(data) && Array.isArray(data.files)) {
    return {
      headers: ["name", "type", "date", "sizeBytes"],
      rows: data.files.map((item) => {
        const r = isRecord(item) ? item : {};
        return [r.name ?? "", r.type ?? "", r.date ?? "", r.sizeBytes ?? ""];
      })
    };
  }
  if (operationId === "files.list" && isRecord(data) && Array.isArray(data.items)) {
    return {
      headers: ["name", "type", "bytes"],
      rows: data.items.map((item) => {
        const r = isRecord(item) ? item : {};
        return [
          r.name ?? "",
          r.folder === true ? "folder" : "file",
          r.folder === true ? "" : r.bytes ?? ""
        ];
      })
    };
  }
  if (operationId === "rpc.list" && isRecord(data) && Array.isArray(data.targets)) {
    return {
      headers: ["id", "parameters", "allowed", "serverOnly"],
      rows: data.targets.map((item) => {
        const r = isRecord(item) ? item : {};
        return [
          r.id ?? "",
          r.parameters ?? [],
          r.allowed ?? "",
          r.serverOnly === true ? "true" : ""
        ];
      })
    };
  }
  if (operationId === "cli.config.list" && isRecord(data) && Array.isArray(data.connections)) {
    return {
      headers: ["name", "default", "baseUrl", "write", "execute", "username", "password"],
      rows: data.connections.map((item) => {
        const r = isRecord(item) ? item : {};
        const perm = isRecord(r.permissions) ? r.permissions : {};
        const cred = isRecord(r.credentials) ? r.credentials : {};
        return [
          r.name ?? "",
          r.default === true,
          r.baseUrl ?? "",
          perm.write === true,
          perm.execute === true,
          cred.username === "env" && cred.usernameEnv ? `env:${String(cred.usernameEnv)}` : cred.username ?? "",
          cred.password === "env" && cred.passwordEnv ? `env:${String(cred.passwordEnv)}` : cred.password ?? ""
        ];
      })
    };
  }
  if (operationId === "api.list" && isRecord(data)) {
    if (Array.isArray(data.topics)) {
      return {
        headers: ["topic", "title", "operations", "count"],
        rows: data.topics.map((item) => {
          const r = isRecord(item) ? item : {};
          return [r.topic ?? "", r.title ?? "", r.operations ?? "", r.count ?? ""];
        })
      };
    }
    if (Array.isArray(data.operations)) {
      return {
        headers: ["id", "topic", "effect", "description"],
        rows: data.operations.map((item) => {
          const r = isRecord(item) ? item : {};
          return [r.id ?? "", r.topic ?? "", r.effect ?? "", r.description ?? ""];
        })
      };
    }
  }
  if (operationId === "objects.get" && isRecord(data) && Array.isArray(data.items)) {
    return flattenManyObjects(data.items);
  }
  if (operationId === "execute.script" && isRecord(data) && Array.isArray(data.result)) {
    if (data.result.length === 0) return { headers: [], rows: [] };
    const keys = collectObjectKeys(data.result);
    if (keys === void 0) {
      return { headers: ["value"], rows: data.result.map((item) => [item]) };
    }
    return {
      headers: keys,
      rows: data.result.map((item) => {
        const record = item;
        return keys.map((key) => Object.hasOwn(record, key) ? record[key] : "");
      })
    };
  }
  if (operationId === "results.read" && isRecord(data)) {
    if (Array.isArray(data.items)) {
      if (data.items.length === 0) return { headers: [], rows: [] };
      const keys = collectObjectKeys(data.items);
      if (keys === void 0) {
        return { headers: ["value"], rows: data.items.map((item) => [item]) };
      }
      return {
        headers: keys,
        rows: data.items.map((item) => {
          const record = item;
          return keys.map((key) => Object.hasOwn(record, key) ? record[key] : "");
        })
      };
    }
    if (typeof data.text === "string") return { headers: ["text"], rows: [[data.text]] };
  }
  if ((operationId === "logs.search" || operationId === "logs.follow") && isRecord(data) && Array.isArray(data.events)) {
    return {
      headers: ["sequence", "time", "context", "level", "text"],
      rows: data.events.map((item) => {
        const r = isRecord(item) ? item : {};
        return [r.sequence ?? "", r.time ?? "", r.context ?? "", r.level ?? "", r.text ?? ""];
      })
    };
  }
  if (operationId === "agents.status" && isRecord(data) && Array.isArray(data.runs)) {
    return {
      headers: ["id", "code", "name", "status", "threadId", "roleUID", "startedAt", "finishedAt"],
      rows: data.runs.map((item) => {
        const r = isRecord(item) ? item : {};
        return [
          r.id ?? "",
          r.code ?? "",
          r.name ?? "",
          r.status ?? "",
          r.threadId ?? "",
          r.roleUID ?? "",
          r.startedAt ?? "",
          r.finishedAt ?? ""
        ];
      })
    };
  }
  if (operationId === "web.spxml.getBackgroundTasksByName") {
    const tasks = normalizeBackgroundTasks(data);
    return {
      headers: [
        "TrackingID",
        "IsRunning",
        "StartDate",
        "Progress",
        "ErrorCode",
        "ErrorText",
        "ResultData"
      ],
      rows: tasks.map((task) => [
        task.TrackingID ?? "",
        task.IsRunning ?? "",
        task.StartDate ?? "",
        task.Progress ?? "",
        task.ErrorCode ?? "",
        task.ErrorText ?? "",
        task.ResultData ?? ""
      ])
    };
  }
  if (operationId === "runtime.check" && isRecord(data) && Array.isArray(data.checks)) {
    return {
      headers: ["name", "result", "reason"],
      rows: data.checks.map((item) => {
        const r = isRecord(item) ? item : {};
        return [r.name ?? "", r.result ?? "", r.reason ?? ""];
      })
    };
  }
  if (Array.isArray(data)) {
    const keys = collectObjectKeys(data);
    if (keys !== void 0 && keys.length > 0) {
      return {
        headers: keys,
        rows: data.map((item) => {
          const record = item;
          return keys.map((key) => record[key]);
        })
      };
    }
  }
  return void 0;
}
function tabularStreamSpec(operationId, requestedFields) {
  switch (operationId) {
    case "runtime.query":
      return {
        kind: "dynamic",
        ...requestedFields && requestedFields.length > 0 ? { headers: requestedFields } : {}
      };
    case "execute.script":
    case "results.read":
      return { kind: "dynamic" };
    case "objects.get":
      return { kind: "dynamic", objectDataMode: true };
    case "schema.types":
      return {
        kind: "fixed",
        headers: ["type", "catalog", "title", "customFields"],
        mapRow: (item) => {
          const r = isRecord(item) ? item : {};
          return [r.type ?? "", r.catalog ?? "", r.title ?? "", r.customFields ?? ""];
        }
      };
    case "schema.get":
      return {
        kind: "fixed",
        headers: [
          "path",
          "type",
          "origin",
          "title",
          "references",
          "query",
          "computed",
          "required",
          "multiple"
        ],
        mapRow: (item) => {
          const r = isRecord(item) ? item : {};
          return [
            r.path ?? "",
            r.type ?? "",
            r.origin ?? "",
            r.title ?? "",
            r.references ?? "",
            r.query === true ? "true" : "",
            r.computed === true ? "true" : "",
            r.required === true ? "true" : "",
            r.multiple === true ? "true" : ""
          ];
        }
      };
    case "logs.list":
      return {
        kind: "fixed",
        headers: ["name", "type", "date", "sizeBytes"],
        mapRow: (item) => {
          const r = isRecord(item) ? item : {};
          return [r.name ?? "", r.type ?? "", r.date ?? "", r.sizeBytes ?? ""];
        }
      };
    case "files.list":
      return {
        kind: "fixed",
        headers: ["name", "type", "bytes"],
        mapRow: (item) => {
          const r = isRecord(item) ? item : {};
          return [
            r.name ?? "",
            r.folder === true ? "folder" : "file",
            r.folder === true ? "" : r.bytes ?? ""
          ];
        }
      };
    case "rpc.list":
      return {
        kind: "fixed",
        headers: ["id", "parameters", "allowed", "serverOnly"],
        mapRow: (item) => {
          const r = isRecord(item) ? item : {};
          return [
            r.id ?? "",
            r.parameters ?? [],
            r.allowed ?? "",
            r.serverOnly === true ? "true" : ""
          ];
        }
      };
    case "logs.search":
    case "logs.follow":
      return {
        kind: "fixed",
        headers: ["sequence", "time", "context", "level", "text"],
        mapRow: (item) => {
          const r = isRecord(item) ? item : {};
          return [r.sequence ?? "", r.time ?? "", r.context ?? "", r.level ?? "", r.text ?? ""];
        }
      };
    case "agents.status":
      return {
        kind: "fixed",
        headers: ["id", "code", "name", "status", "threadId", "roleUID", "startedAt", "finishedAt"],
        mapRow: (item) => {
          const r = isRecord(item) ? item : {};
          return [
            r.id ?? "",
            r.code ?? "",
            r.name ?? "",
            r.status ?? "",
            r.threadId ?? "",
            r.roleUID ?? "",
            r.startedAt ?? "",
            r.finishedAt ?? ""
          ];
        }
      };
    case "web.spxml.getBackgroundTasksByName":
      return {
        kind: "fixed",
        headers: [
          "TrackingID",
          "IsRunning",
          "StartDate",
          "Progress",
          "ErrorCode",
          "ErrorText",
          "ResultData"
        ],
        mapRow: (item) => {
          const t = isRecord(item) ? item : {};
          return [
            t.TrackingID ?? "",
            t.IsRunning ?? "",
            t.StartDate ?? "",
            t.Progress ?? "",
            t.ErrorCode ?? "",
            t.ErrorText ?? "",
            t.ResultData ?? ""
          ];
        }
      };
    case "runtime.check":
      return {
        kind: "fixed",
        headers: ["name", "result", "reason"],
        mapRow: (item) => {
          const r = isRecord(item) ? item : {};
          return [r.name ?? "", r.result ?? "", r.reason ?? ""];
        }
      };
    default:
      return void 0;
  }
}
function extractListItems(operationId, data) {
  if (Array.isArray(data)) return data;
  if (!isRecord(data)) return void 0;
  switch (operationId) {
    case "runtime.query":
    case "files.list":
      return Array.isArray(data.items) ? data.items : void 0;
    case "schema.types":
      return Array.isArray(data.types) ? data.types : void 0;
    case "schema.get":
      return Array.isArray(data.fields) ? data.fields : void 0;
    case "logs.list":
      return Array.isArray(data.files) ? data.files : void 0;
    case "logs.search":
    case "logs.follow":
      return Array.isArray(data.events) ? data.events : void 0;
    case "rpc.list":
      return Array.isArray(data.targets) ? data.targets : void 0;
    case "cli.config.list":
      return Array.isArray(data.connections) ? data.connections : void 0;
    case "api.list":
      return Array.isArray(data.topics) ? data.topics : Array.isArray(data.operations) ? data.operations : void 0;
    case "objects.get":
    case "results.read":
      return Array.isArray(data.items) ? data.items : void 0;
    case "execute.script":
      return Array.isArray(data.result) ? data.result : void 0;
    case "runtime.batch":
      return Array.isArray(data.results) ? data.results : void 0;
    case "runtime.check":
      return Array.isArray(data.checks) ? data.checks : void 0;
    case "agents.status":
      return Array.isArray(data.runs) ? data.runs : void 0;
    case "web.spxml.getBackgroundTasksByName":
      return normalizeBackgroundTasks(data);
    default:
      return void 0;
  }
}
function formatJsonl(operationId, data) {
  const items = extractListItems(operationId, data);
  if (items !== void 0) {
    if (items.length === 0) return "";
    return `${items.map((item) => compactJson(item)).join("\n")}
`;
  }
  return `${compactJson(data)}
`;
}
function formatRawLogEvents(events) {
  if (!events.length) return "";
  const lines = events.map((raw) => {
    if (!isRecord(raw)) return String(raw);
    if (typeof raw.text === "string" && raw.text.length > 0) {
      const trimmed = raw.text.trimStart();
      const hasTime = typeof raw.time === "string" && raw.time.length > 0 && trimmed.startsWith(raw.time);
      const hasContext = typeof raw.context === "string" && raw.context.length > 0 && trimmed.includes(`[${raw.context}]`);
      if (hasTime || hasContext || raw.time === void 0 && raw.context === void 0) {
        return raw.text;
      }
      const parts2 = [
        typeof raw.time === "string" && raw.time ? raw.time : void 0,
        typeof raw.context === "string" && raw.context ? `[${raw.context}]` : void 0,
        raw.text
      ].filter((part) => part !== void 0 && part !== "");
      return parts2.join(" ");
    }
    const fallbackText = typeof raw.message === "string" ? raw.message : "";
    const parts = [
      typeof raw.time === "string" && raw.time ? raw.time : void 0,
      typeof raw.context === "string" && raw.context ? `[${raw.context}]` : void 0,
      fallbackText
    ].filter((part) => part !== void 0 && part !== "");
    return parts.join(" ");
  });
  return `${lines.join("\n")}
`;
}
function formatRawTabularRows(table) {
  if (table.headers.length === 0 || table.rows.length === 0) return "";
  if (table.headers.length === 1) {
    return `${table.rows.map((row) => tabularCellText(row[0])).join("\n")}
`;
  }
  return `${table.rows.map(
    (row) => row.map((cell) => tabularCellText(cell).replace(/\r\n|[\r\n\t]/g, " ")).join("	")
  ).join("\n")}
`;
}
function renderRaw(result, requestedFields, quiet = false) {
  const op = result.meta.operationId;
  const data = result.data;
  if (op === "files.read" && isRecord(data)) {
    if (typeof data.text === "string") return { kind: "text", text: data.text };
    if (typeof data.base64 === "string")
      return { kind: "binary", bytes: Buffer.from(data.base64, "base64") };
    if (typeof data.file === "string") return { kind: "text", text: `${data.file}
` };
  }
  if (op === "logs.read" && isRecord(data) && typeof data.text === "string") {
    const tailNote = !quiet && data.tailOnly === true ? `Показан конец файла ${String(data.file ?? "")} (${typeof data.sizeBytes === "number" ? `${data.sizeBytes} Б` : "не весь"}); весь файл: --full.
` : void 0;
    return {
      kind: "text",
      text: data.text,
      ...tailNote === void 0 ? {} : { stderrNote: tailNote }
    };
  }
  if ((op === "logs.search" || op === "logs.follow") && isRecord(data) && Array.isArray(data.events)) {
    return { kind: "text", text: formatRawLogEvents(data.events) };
  }
  if (op === "native.lds.loadDoc") {
    const xml = extractDocXml(data);
    if (xml !== void 0) return { kind: "text", text: xml };
  }
  if (op === "rpc.describe" && isRecord(data)) {
    if (typeof data.code === "string") return { kind: "text", text: data.code };
    const params = Array.isArray(data.parameters) ? data.parameters.join(", ") : "";
    return { kind: "text", text: `${String(data.id ?? "")}(${params})
` };
  }
  if (op === "runtime.query") {
    const table = extractTable(op, data, requestedFields);
    if (table) return { kind: "text", text: formatRawTabularRows(table) };
  }
  if (op === "cli.config.path" && isRecord(data) && typeof data.path === "string") {
    return { kind: "text", text: `${data.path}
` };
  }
  if (op === "cli.config.use" && isRecord(data) && typeof data.defaultConnection === "string") {
    return { kind: "text", text: `${data.defaultConnection}
` };
  }
  if (op === "cli.config.remove" && isRecord(data) && isRecord(data.removed)) {
    return { kind: "text", text: `${String(data.removed.name ?? "")}
` };
  }
  if (op === "web.spxml.getBackgroundTasksByName") {
    return rawLines(normalizeBackgroundTasks(data), (r) => String(r.TrackingID ?? ""));
  }
  if (op === "cli.version" && isRecord(data) && typeof data.version === "string") {
    return { kind: "text", text: `${data.version}
` };
  }
  if (op === "objects.create" && isRecord(data) && typeof data.id === "string") {
    return { kind: "text", text: `${data.id}
` };
  }
  if (op === "objects.delete" && isRecord(data)) {
    return { kind: "text", text: `${typeof data.id === "string" ? data.id : "deleted"}
` };
  }
  if (op === "objects.patch" && isRecord(data)) {
    const value = typeof data.id === "string" ? data.id : String(data.fingerprint ?? "");
    return { kind: "text", text: value ? `${value}
` : "" };
  }
  if (op === "files.exists" && isRecord(data) && typeof data.exists === "boolean") {
    return { kind: "text", text: `${data.exists}
` };
  }
  if (op === "files.write" && isRecord(data) && typeof data.bytes === "number") {
    return { kind: "text", text: `${data.bytes}
` };
  }
  if (op === "files.delete") {
    return { kind: "text", text: "deleted\n" };
  }
  if ((op === "cli.files.edit" || op === "cli.object.edit") && isRecord(data)) {
    if (data.changed === false) return { kind: "text", text: "" };
  }
  if (op === "web.pages.uploadFile" && isRecord(data) && typeof data.url === "string") {
    return { kind: "text", text: `${data.url}
` };
  }
  if (op === "web.websocket.heartbeat" && isRecord(data)) {
    return { kind: "text", text: `${Boolean(data.heartbeatObserved)}
` };
  }
  if (op === "results.export" && isRecord(data) && typeof data.path === "string") {
    return { kind: "text", text: `${data.path}
` };
  }
  if (op === "results.read" && isRecord(data)) {
    if (typeof data.text === "string") return { kind: "text", text: data.text };
    if (Array.isArray(data.items)) {
      const table = extractTable(op, data);
      if (table) return { kind: "text", text: formatRawTabularRows(table) };
      return {
        kind: "text",
        text: data.items.length ? `${data.items.map((item) => tabularCellText(item)).join("\n")}
` : ""
      };
    }
  }
  if (op === "logs.list" && isRecord(data) && Array.isArray(data.files))
    return rawLines(data.files, (r) => String(r.name ?? ""));
  if (op === "files.list" && isRecord(data) && Array.isArray(data.items))
    return rawLines(data.items, (r) => `${String(r.name ?? "")}${r.folder === true ? "/" : ""}`);
  if (op === "schema.types" && isRecord(data) && Array.isArray(data.types))
    return rawLines(data.types, (r) => String(r.type ?? r.catalog ?? ""));
  if (op === "schema.get" && isRecord(data) && Array.isArray(data.fields))
    return rawLines(data.fields, (r) => String(r.path ?? ""));
  if (op === "rpc.list" && isRecord(data) && Array.isArray(data.targets))
    return rawLines(data.targets, (r) => String(r.id ?? ""));
  if (op === "cli.config.list" && isRecord(data) && Array.isArray(data.connections))
    return rawLines(data.connections, (r) => String(r.name ?? ""));
  if (op === "api.list" && isRecord(data)) {
    if (Array.isArray(data.topics)) return rawLines(data.topics, (r) => String(r.topic ?? ""));
    if (Array.isArray(data.operations)) return rawLines(data.operations, (r) => String(r.id ?? ""));
  }
  if (op === "execute.script" && isRecord(data) && Array.isArray(data.result)) {
    const table = extractTable(op, data);
    if (table) return { kind: "text", text: formatRawTabularRows(table) };
    return {
      kind: "text",
      text: data.result.length ? `${data.result.map((item) => tabularCellText(item)).join("\n")}
` : ""
    };
  }
  if (op === "rpc.call" && isRecord(data) && "value" in data) {
    if (typeof data.value === "string") return { kind: "text", text: data.value };
    return { kind: "text", text: `${tabularCellText(data.value)}
` };
  }
  if (op === "runtime.status" && isRecord(data) && typeof data.version === "string") {
    return { kind: "text", text: `${data.version}
` };
  }
  if (typeof data === "string") return { kind: "text", text: data };
  if (data === null || data === void 0) return { kind: "text", text: "" };
  if (typeof data === "number" || typeof data === "boolean" || typeof data === "bigint") {
    return { kind: "text", text: `${String(data)}
` };
  }
  return { kind: "text", text: `${compactJson(data)}
` };
}
function renderTruncated(result, styler) {
  const data = isRecord(result.data) ? result.data : {};
  const resultId = typeof result.meta.resultId === "string" ? result.meta.resultId : typeof data.resultId === "string" ? data.resultId : void 0;
  const resultBytes = typeof result.meta.resultBytes === "number" ? result.meta.resultBytes : void 0;
  const sizeLabel = resultBytes !== void 0 ? ` (${formatBytes(resultBytes)})` : "";
  const lines = [
    styler.bold(
      styler.yellow(`Ответ не поместился в предел вывода и сохранён локально${sizeLabel}.`)
    )
  ];
  if (resultId) lines.push(`${styler.dim("resultId:")} ${resultId}`);
  if ("preview" in data && data.preview !== void 0) {
    lines.push("", styler.dim("Начало ответа:"));
    const preview = data.preview;
    let previewText;
    if (typeof preview === "string") {
      previewText = preview;
    } else if (isRecord(preview) && typeof preview.text === "string") {
      previewText = preview.text;
    } else {
      previewText = renderStructured(preview, styler, 2);
    }
    const previewLines = previewText.split(/\r?\n/);
    const maxLines = 12;
    const clipped = previewLines.slice(0, maxLines).join("\n");
    const bounded = clipped.length > 800 ? `${clipped.slice(0, 799)}…` : clipped;
    lines.push(bounded);
    if (previewLines.length > maxLines) lines.push(styler.dim("…"));
  }
  if (resultId) {
    lines.push(
      "",
      `${styler.dim("Читать частями:")}  wtctl result read ${resultId}`,
      `${styler.dim("Сохранить файл:")}  wtctl result export ${resultId} --to ФАЙЛ`
    );
  }
  return { text: `${lines.join("\n")}
` };
}
function renderLogEvents(events, styler) {
  const LEVEL_PREFIX_RE = /^(CRITICAL|ERROR|WARN(?:ING)?|INFO|DEBUG)\b/i;
  return events.map((raw) => {
    if (!isRecord(raw)) return String(raw);
    const level = typeof raw.level === "string" ? raw.level : "normal";
    const time = typeof raw.time === "string" && raw.time ? styler.dim(raw.time) : void 0;
    const ctx = typeof raw.context === "string" && raw.context ? styler.cyan(`[${raw.context}]`) : void 0;
    const body = typeof raw.text === "string" ? raw.text : "";
    const [firstLine = "", ...restLines] = body.split(/\r?\n/);
    const styleLevel = (word) => {
      if (level === "critical" || level === "error") return styler.bold(styler.red(word));
      if (level === "warning") return styler.yellow(word);
      if (level === "debug") return styler.dim(word);
      if (level === "info") return styler.cyan(word);
      return word;
    };
    const match = LEVEL_PREFIX_RE.exec(firstLine);
    let badge;
    let styledFirst = firstLine;
    if (match) {
      styledFirst = styleLevel(match[1]) + firstLine.slice(match[1].length);
    } else if (level !== "normal") {
      badge = styleLevel(level.toUpperCase());
    }
    const head = [time, ctx, badge, styledFirst].filter(Boolean).join(" ");
    if (!restLines.length) return head;
    const tail = restLines.map((line) => level === "debug" ? styler.dim(line) : line);
    return [head, ...tail].join("\n");
  });
}
function renderObjectSingle(data, styler) {
  const type = String(data.type ?? "объект");
  const id = typeof data.id === "string" ? data.id : void 0;
  const header = styler.bold(id ? `${type} · ${id}` : type);
  const metaEntries = [];
  if (typeof data.url === "string") metaEntries.push(["URL", data.url]);
  if (typeof data.fingerprint === "string") metaEntries.push(["Отпечаток", data.fingerprint]);
  if (typeof data.formUrl === "string") metaEntries.push(["Форма", data.formUrl]);
  const blocks = [header];
  if (metaEntries.length) blocks.push(renderCard(metaEntries, styler));
  const fieldLines = [];
  if (isRecord(data.data) && Object.keys(data.data).length > 0) {
    fieldLines.push(renderStructured(data.data, styler));
  }
  if (isRecord(data.fromCatalog)) {
    for (const [key, value] of Object.entries(data.fromCatalog)) {
      const rendered = renderStructured(value, styler, 0);
      fieldLines.push(`${styler.dim(`${key}:`)} ${rendered} ${styler.dim("(из каталога)")}`);
    }
  }
  if (fieldLines.length) blocks.push("", fieldLines.join("\n"));
  const notes = [];
  if (Array.isArray(data.emptyFields) && data.emptyFields.length > 0) {
    notes.push(styler.dim(`Пустые поля: ${data.emptyFields.join(", ")}`));
  }
  if (Array.isArray(data.unknownFields) && data.unknownFields.length > 0) {
    notes.push(styler.yellow(`Неизвестные поля: ${data.unknownFields.join(", ")}`));
  }
  if (notes.length) blocks.push("", notes.join("\n"));
  return `${blocks.join("\n")}
`;
}
function renderObjectPatch(data, styler) {
  const preview = data.preview === true;
  const noop = data.noop === true;
  const type = typeof data.type === "string" ? data.type : void 0;
  const id = typeof data.id === "string" ? data.id : void 0;
  const changes = Array.isArray(data.changes) ? data.changes : [];
  const lines = [];
  if (preview) {
    lines.push(
      styler.bold(
        styler.yellow(
          noop ? "Предпросмотр правки: изменений нет." : "Предпросмотр правки (без записи):"
        )
      )
    );
  } else if (noop) {
    lines.push(styler.dim("Изменений нет (noop), документ не перезаписывался."));
  } else {
    const target = [type, id].filter(Boolean).join(" · ");
    lines.push(styler.bold(styler.green(`✓ Объект изменён${target ? ` (${target})` : ""}`)));
  }
  if (changes.length > 0) {
    lines.push("");
    for (const raw of changes) {
      if (!isRecord(raw)) continue;
      const path = String(raw.path ?? "");
      if (raw.op === "remove") {
        lines.push(styler.red(`- ${path}: ${formatInline(raw.before)}`));
      } else {
        if ("before" in raw && raw.before !== void 0) {
          lines.push(styler.red(`- ${path}: ${formatInline(raw.before)}`));
        }
        lines.push(styler.green(`+ ${path}: ${formatInline(raw.after)}`));
      }
    }
  } else if (!preview && !noop) {
    lines.push(styler.dim("Документ сохранён без изменения полей (--resave)."));
  }
  if (Array.isArray(data.serverFilled) && data.serverFilled.length > 0) {
    lines.push(
      "",
      styler.yellow(
        `Предупреждение: сервер заполняет эти поля сам при сохранении: ${data.serverFilled.join(", ")}.`
      )
    );
  }
  if (Array.isArray(data.serverChanged) && data.serverChanged.length > 0) {
    lines.push(
      "",
      styler.cyan(`Сервер дополнительно изменил поля: ${data.serverChanged.join(", ")}.`)
    );
  }
  const metaEntries = [];
  if (typeof data.url === "string") metaEntries.push(["URL", data.url]);
  if (typeof data.fingerprint === "string") metaEntries.push(["Отпечаток", data.fingerprint]);
  if (typeof data.mutationOutcome === "string") metaEntries.push(["Исход", data.mutationOutcome]);
  if (metaEntries.length) lines.push("", renderCard(metaEntries, styler));
  return `${lines.join("\n")}
`;
}
function renderCheck(data, meta, styler) {
  const version = typeof data.version === "string" ? ` · ${data.version}` : "";
  const language = typeof data.language === "string" ? ` (${data.language})` : "";
  const lines = [
    styler.bold(`Проверка подключения ${meta.connection}${version}${language}`),
    ""
  ];
  const checks = Array.isArray(data.checks) ? data.checks : [];
  for (const raw of checks) {
    if (!isRecord(raw)) continue;
    const name = String(raw.name ?? "");
    const result = String(raw.result ?? "");
    const reason = typeof raw.reason === "string" && raw.reason ? ` — ${raw.reason}` : "";
    if (result === "ok") {
      lines.push(`  ${styler.green("✓")} ${name}`);
    } else if (result === "failed") {
      lines.push(`  ${styler.red("✗")} ${styler.red(name)}${reason}`);
    } else {
      lines.push(`  ${styler.yellow("−")} ${styler.dim(name)}${styler.dim(reason)}`);
    }
  }
  const summary = isRecord(data.summary) ? data.summary : {};
  const ok = Number(summary.ok ?? 0);
  const failed = Number(summary.failed ?? 0);
  const skipped = Number(summary.skipped ?? 0);
  const summaryText = `Итог: ${ok} пройдено, ${failed} с ошибкой, ${skipped} пропущено (${formatDuration(meta.durationMs)})`;
  lines.push("", failed > 0 ? styler.bold(styler.red(summaryText)) : styler.green(summaryText));
  return `${lines.join("\n")}
`;
}
function renderApiDescribe(data, styler) {
  const id = String(data.id ?? "");
  const topic2 = typeof data.topic === "string" ? data.topic : "";
  const effect = typeof data.effect === "string" ? data.effect : "";
  const lines = [
    `${styler.bold(id)} ${styler.dim(`(${[topic2, effect].filter(Boolean).join(", ")})`)}`
  ];
  if (typeof data.description === "string" && data.description) lines.push("", data.description);
  if (typeof data.details === "string" && data.details) lines.push("", data.details);
  if (isRecord(data.inputSchema)) {
    const props = isRecord(data.inputSchema.properties) ? data.inputSchema.properties : void 0;
    const required = new Set(
      Array.isArray(data.inputSchema.required) ? data.inputSchema.required.filter((item) => typeof item === "string") : []
    );
    if (props && Object.keys(props).length > 0) {
      lines.push("", styler.bold("Аргументы:"));
      const rows2 = Object.entries(props).map(([name, raw]) => {
        const schema = isRecord(raw) ? raw : {};
        const typeLabel = Array.isArray(schema.enum) ? schema.enum.map(String).join("|") : typeof schema.type === "string" ? schema.type : "";
        const desc = typeof schema.description === "string" ? schema.description : "";
        const label = `${name}${required.has(name) ? "*" : ""}`;
        const detail = [typeLabel ? styler.dim(`(${typeLabel})`) : "", desc].filter(Boolean).join(" ");
        return [label, detail || styler.dim("—")];
      });
      const width = Math.max(...rows2.map(([label]) => label.length));
      for (const [label, detail] of rows2) {
        lines.push(`  ${styler.cyan(label.padEnd(width))}  ${detail}`);
      }
    }
  }
  return `${lines.join("\n")}
`;
}
function renderCredentialSource(cred) {
  const user = String(cred.username ?? "none");
  const pass = String(cred.password ?? "none");
  const fmt = (kind, envName) => kind === "env" && typeof envName === "string" ? `env:${envName}` : kind === "file" ? "файл" : "нет";
  if (user === "none" && pass === "none") return "нет";
  if (user === "file" && pass === "file") return "файл";
  return `${fmt(user, cred.usernameEnv)} / ${fmt(pass, cred.passwordEnv)}`;
}
function renderHuman(result, options) {
  const { columns, styler, quiet } = options;
  if (result.meta.truncated === true) return renderTruncated(result, styler);
  const op = result.meta.operationId;
  const data = result.data;
  const tableOpts = { ...columns === void 0 ? {} : { maxWidth: columns }, styler };
  if (op === "runtime.status" && isRecord(data)) {
    const entries = [
      ["Подключение", String(data.connection ?? result.meta.connection)],
      ["Сервер", String(data.baseUrl ?? "")],
      ["Версия", styler.bold(String(data.version ?? ""))],
      ...typeof data.database === "string" ? [["База данных", data.database]] : [],
      ...typeof data.userId === "string" ? [["Пользователь", data.userId]] : [],
      ["Права", formatPermissions(data.permissions)],
      ...typeof data.operationCount === "number" ? [["Операций", String(data.operationCount)]] : []
    ];
    return { text: `${renderCard(entries, styler)}
` };
  }
  if (op === "runtime.check" && isRecord(data)) {
    return { text: renderCheck(data, result.meta, styler) };
  }
  if (op === "server.info" && isRecord(data)) {
    const entries = [
      ["Профиль", String(data.profile ?? "")],
      ["Версия", styler.bold(String(data.versionServer ?? ""))],
      ["ОС", String(data.osType ?? "")],
      ["База данных", String(data.database ?? "")],
      ["Маска", String(data.capabilityMask ?? "")],
      ...Array.isArray(data.dataFolders) ? [["Папки данных", data.dataFolders.join(", ")]] : [],
      ...Array.isArray(data.codeFolders) ? [["Папки кода", data.codeFolders.join(", ")]] : []
    ];
    const parts = [renderCard(entries, styler)];
    if (Array.isArray(data.catalogLimits) && data.catalogLimits.length > 0) {
      const limitColumns = [
        { header: "Тип объекта" },
        { header: "Предел записей", align: "right" }
      ];
      const limitRows = data.catalogLimits.map((item) => {
        const r = isRecord(item) ? item : {};
        return [String(r.objectTypeName ?? ""), String(r.maxRecordsNum ?? "")];
      });
      parts.push("", renderTable(limitColumns, limitRows, tableOpts));
    }
    return { text: `${parts.join("\n")}
` };
  }
  if (op === "cli.version" && isRecord(data)) {
    return {
      text: `${styler.bold(`${String(data.name ?? "wtctl")} ${String(data.version ?? "")}`)}${typeof data.node === "string" ? styler.dim(` (Node.js ${data.node})`) : ""}
`
    };
  }
  if (op === "runtime.query" && isRecord(data) && Array.isArray(data.items)) {
    const parts = [];
    const table = extractTable(op, data, options.requestedFields);
    if (table && table.headers.length > 0 && table.rows.length > 0) {
      parts.push(renderExtractedTable(table, tableOpts));
    } else {
      parts.push(styler.dim("Ничего не найдено."));
    }
    const count = data.items.length;
    parts.push(
      dimLine(
        styler,
        typeof data.total === "number" ? `Показано ${count} из ${data.total}` : `Показано ${count}`,
        typeof data.nextStartPosition === "number" ? `далее: --start-position ${data.nextStartPosition}` : void 0
      )
    );
    if (Array.isArray(data.unknownFields) && data.unknownFields.length > 0) {
      parts.push(
        styler.yellow(
          `Предупреждение: неизвестные поля каталога: ${data.unknownFields.join(", ")}.`
        )
      );
    }
    if (data.incomplete === true) {
      parts.push(styler.yellow("Предупреждение: неполный ответ."));
    }
    if (typeof data.hint === "string" && data.hint) {
      parts.push(
        data.incomplete === true || Array.isArray(data.unknownFields) ? styler.yellow(data.hint) : styler.dim(data.hint)
      );
    }
    return { text: `${parts.join("\n")}
` };
  }
  if (op === "schema.types" && isRecord(data) && Array.isArray(data.types)) {
    const parts = [];
    if (data.types.length > 0) {
      const cols = [
        { header: "Тип" },
        { header: "Каталог" },
        { header: "Заголовок" },
        { header: "Настр. поля", align: "right" }
      ];
      const rows2 = data.types.map((item) => {
        const r = isRecord(item) ? item : {};
        return [
          String(r.type ?? "—"),
          String(r.catalog ?? "—"),
          String(r.title ?? ""),
          r.customFields === void 0 ? "" : String(r.customFields)
        ];
      });
      parts.push(renderTable(cols, rows2, tableOpts));
    } else {
      parts.push(styler.dim("Типы не найдены."));
    }
    parts.push(
      dimLine(
        styler,
        `Показано ${data.types.length} из ${String(data.total ?? data.types.length)}`,
        typeof data.nextCursor === "number" ? `далее: --cursor ${data.nextCursor}` : void 0
      )
    );
    if (Array.isArray(data.notes) && data.notes.length > 0) {
      for (const note of data.notes) parts.push(styler.dim(String(note)));
    }
    return { text: `${parts.join("\n")}
` };
  }
  if (op === "schema.get" && isRecord(data) && Array.isArray(data.fields)) {
    const header = [
      styler.bold(String(data.type ?? "")),
      typeof data.catalog === "string" ? `каталог ${data.catalog}` : void 0,
      typeof data.formUrl === "string" ? styler.dim(data.formUrl) : void 0
    ].filter(Boolean).join(" · ");
    const parts = [header];
    if (isRecord(data.element)) {
      const el = data.element;
      const tags = [
        String(el.type ?? ""),
        el.multiple === true ? "список" : void 0,
        typeof el.key === "string" ? `ключ: ${el.key}` : void 0
      ].filter(Boolean).join(", ");
      parts.push(styler.dim(`Узел: ${String(el.path ?? "")} (${tags})`));
    }
    if (data.fields.length > 0) {
      const cols = [
        { header: "Поле" },
        { header: "Тип" },
        { header: "Источник" },
        { header: "Флаги" },
        { header: "Заголовок" }
      ];
      const rows2 = data.fields.map((item) => {
        const r = isRecord(item) ? item : {};
        const typeStr = `${String(r.type ?? "")}${r.multiple === true ? "[]" : ""}${typeof r.children === "number" ? ` (+${r.children})` : ""}`;
        const flags = [
          r.query === true ? "query" : void 0,
          r.computed === true ? "computed" : void 0,
          r.required === true ? "required" : void 0,
          typeof r.references === "string" ? `→ ${r.references}` : void 0
        ].filter(Boolean).join(", ");
        return [
          String(r.path ?? ""),
          typeStr,
          String(r.origin ?? ""),
          flags,
          String(r.title ?? "")
        ];
      });
      parts.push("", renderTable(cols, rows2, tableOpts));
    } else if (!Array.isArray(data.methods) || data.methods.length === 0) {
      parts.push("", styler.dim("Поля не найдены."));
    }
    if (Array.isArray(data.methods) && data.methods.length > 0) {
      parts.push("", styler.bold("Методы формы:"));
      for (const method of data.methods) {
        if (!isRecord(method)) continue;
        const params = Array.isArray(method.parameters) ? method.parameters.join(", ") : "";
        parts.push(`  ${String(method.name ?? "")}(${params})`);
      }
    }
    parts.push(
      dimLine(
        styler,
        `Показано ${data.fields.length} из ${String(data.total ?? data.fields.length)}`,
        data.cutBySize === true ? "обрезано по размеру" : void 0,
        typeof data.nextCursor === "number" ? `далее: --cursor ${data.nextCursor}` : void 0
      )
    );
    if (Array.isArray(data.notes) && data.notes.length > 0) {
      for (const note of data.notes) parts.push(styler.dim(String(note)));
    }
    return { text: `${parts.join("\n")}
` };
  }
  if (op === "objects.get" && isRecord(data)) {
    if (Array.isArray(data.items)) {
      const table = flattenManyObjects(data.items);
      const parts = [];
      if (table.headers.length > 0 && table.rows.length > 0) {
        parts.push(renderExtractedTable(table, tableOpts));
      } else {
        parts.push(styler.dim("Объекты не найдены."));
      }
      const emptyFields = /* @__PURE__ */ new Set();
      const unknownFields = /* @__PURE__ */ new Set();
      for (const item of data.items) {
        if (!isRecord(item)) continue;
        if (Array.isArray(item.emptyFields))
          for (const field of item.emptyFields) emptyFields.add(String(field));
        if (Array.isArray(item.unknownFields))
          for (const field of item.unknownFields) unknownFields.add(String(field));
      }
      if (emptyFields.size > 0)
        parts.push(styler.dim(`Пустые поля: ${[...emptyFields].join(", ")}`));
      if (unknownFields.size > 0)
        parts.push(styler.yellow(`Неизвестные поля: ${[...unknownFields].join(", ")}`));
      const failed = typeof data.failed === "number" ? data.failed : 0;
      const footer = `Объектов: ${String(data.total ?? data.items.length)}${failed ? `, с ошибкой: ${failed}` : ""}`;
      parts.push(failed ? styler.yellow(footer) : styler.dim(footer));
      if (typeof data.hint === "string" && data.hint) parts.push(styler.dim(data.hint));
      return { text: `${parts.join("\n")}
` };
    }
    return { text: renderObjectSingle(data, styler) };
  }
  if (op === "objects.create" && isRecord(data)) {
    const entries = [
      ["ID", styler.bold(String(data.id ?? ""))],
      ["Тип", String(data.type ?? "")],
      ["URL", String(data.url ?? "")],
      ...typeof data.fingerprint === "string" ? [["Отпечаток", data.fingerprint]] : [],
      ["Исход", String(data.mutationOutcome ?? "confirmed")]
    ];
    return {
      text: `${styler.bold(styler.green("✓ Объект создан"))}
${renderCard(entries, styler)}
`
    };
  }
  if (op === "objects.patch" && isRecord(data)) {
    return { text: renderObjectPatch(data, styler) };
  }
  if (op === "objects.delete" && isRecord(data)) {
    const verification = data.verification === "catalog" && typeof data.catalog === "string" ? `каталог ${data.catalog}` : data.verification === "server" ? "ответ сервера" : String(data.verification ?? "");
    const entries = [
      ...typeof data.id === "string" ? [["ID", data.id]] : [],
      ["Проверка", verification],
      ["Исход", String(data.mutationOutcome ?? "confirmed")]
    ];
    return {
      text: `${styler.bold(styler.green("✓ Объект удалён"))}
${renderCard(entries, styler)}
`
    };
  }
  if (op === "files.read" && isRecord(data)) {
    if (typeof data.text === "string") {
      return { text: ensureNewline(data.text) };
    }
    if (typeof data.file === "string") {
      const bytes = typeof data.bytes === "number" ? data.bytes : 0;
      const entries = [
        ["Файл", data.file],
        ["Размер", `${formatBytes(bytes)} (${bytes} Б)`]
      ];
      return {
        text: `${styler.bold(styler.green("✓ Файл сохранён"))}
${renderCard(entries, styler)}
`
      };
    }
    if (typeof data.base64 === "string") {
      const bytes = typeof data.bytes === "number" ? data.bytes : 0;
      const lines = [
        styler.bold(`Двоичный файл: ${formatBytes(bytes)} (${bytes} Б)`),
        styler.dim("Сохранить на диск:  wtctl files read АДРЕС --to ФАЙЛ"),
        styler.dim("Вывести байты как есть: --format raw")
      ];
      return { text: `${lines.join("\n")}
` };
    }
  }
  if (op === "files.exists" && isRecord(data)) {
    const exists = data.exists === true;
    return {
      text: `${exists ? styler.green("✓ Существует") : styler.red("✗ Не найден")}
`
    };
  }
  if (op === "files.list" && isRecord(data) && Array.isArray(data.items)) {
    const parts = [];
    if (data.items.length > 0) {
      const cols = [
        { header: "Имя" },
        { header: "Тип" },
        { header: "Размер", align: "right" }
      ];
      const rows2 = data.items.map((item) => {
        const r = isRecord(item) ? item : {};
        const isFolder = r.folder === true;
        const name = String(r.name ?? "");
        const bytes = typeof r.bytes === "number" ? r.bytes : 0;
        return [
          isFolder ? styler.cyan(`${name}/`) : name,
          isFolder ? "папка" : "файл",
          isFolder ? "—" : formatBytes(bytes)
        ];
      });
      parts.push(renderTable(cols, rows2, tableOpts));
    } else {
      parts.push(styler.dim("Папка пуста."));
    }
    parts.push(styler.dim(`Всего: ${String(data.total ?? data.items.length)}`));
    return { text: `${parts.join("\n")}
` };
  }
  if (op === "files.write" && isRecord(data)) {
    const bytes = typeof data.bytes === "number" ? data.bytes : 0;
    const entries = [
      ["Размер", `${formatBytes(bytes)} (${bytes} Б)`],
      ["Исход", String(data.mutationOutcome ?? "confirmed")]
    ];
    return {
      text: `${styler.bold(styler.green("✓ Файл записан"))}
${renderCard(entries, styler)}
`
    };
  }
  if (op === "files.delete" && isRecord(data)) {
    const entries = [["Исход", String(data.mutationOutcome ?? "confirmed")]];
    return {
      text: `${styler.bold(styler.green("✓ Файл удалён"))}
${renderCard(entries, styler)}
`
    };
  }
  if (op === "web.pages.uploadFile" && isRecord(data)) {
    const entries = [
      ...typeof data.url === "string" ? [["URL", data.url]] : [],
      ...typeof data.folderUrl === "string" ? [["Папка", data.folderUrl]] : []
    ];
    return {
      text: `${styler.bold(styler.green("✓ Файл загружен"))}
${renderCard(entries, styler)}
`
    };
  }
  if (op === "web.websocket.heartbeat" && isRecord(data)) {
    const ok = data.heartbeatObserved === true;
    const entries = [
      ...typeof data.route === "string" ? [["Маршрут", data.route]] : [],
      ...typeof data.durationMs === "number" ? [["Время", formatDuration(data.durationMs)]] : [],
      ...typeof data.closeCode === "number" ? [["Код закрытия", String(data.closeCode)]] : [],
      ...typeof data.warning === "string" ? [["Предупреждение", styler.yellow(data.warning)]] : []
    ];
    const title = ok ? styler.bold(styler.green("✓ WebSocket отвечает")) : styler.bold(styler.red("✗ WebSocket не ответил"));
    return { text: `${title}
${renderCard(entries, styler)}
` };
  }
  if (op === "logs.list" && isRecord(data) && Array.isArray(data.files)) {
    const parts = [];
    if (data.files.length > 0) {
      const cols = [
        { header: "Файл" },
        { header: "Тип" },
        { header: "Дата" },
        { header: "Размер", align: "right" }
      ];
      const rows2 = data.files.map((item) => {
        const r = isRecord(item) ? item : {};
        const size = typeof r.sizeBytes === "number" ? formatBytes(r.sizeBytes) : "";
        return [String(r.name ?? ""), String(r.type ?? ""), String(r.date ?? ""), size];
      });
      parts.push(renderTable(cols, rows2, tableOpts));
    } else {
      parts.push(styler.dim("Логи не найдены."));
    }
    parts.push(
      dimLine(
        styler,
        `Показано ${data.files.length} из ${String(data.total ?? data.files.length)}`,
        typeof data.nextOffset === "number" ? `далее: --offset ${data.nextOffset}` : void 0
      )
    );
    return { text: `${parts.join("\n")}
` };
  }
  if (op === "logs.read" && isRecord(data) && typeof data.text === "string") {
    const file = typeof data.file === "string" ? data.file : "";
    const size = typeof data.sizeBytes === "number" ? ` (${formatBytes(data.sizeBytes)})` : "";
    const stderrNote = data.tailOnly === true && !quiet ? `${styler.dim(`Показан конец файла ${file}${size}; весь файл: --full.`)}
` : void 0;
    return {
      text: data.text ? ensureNewline(data.text) : `${styler.dim("Файл пуст.")}
`,
      ...stderrNote === void 0 ? {} : { stderrNote }
    };
  }
  if (op === "logs.search" && isRecord(data) && Array.isArray(data.events)) {
    const parts = data.events.length ? renderLogEvents(data.events, styler) : [styler.dim("Совпадений не найдено.")];
    parts.push(
      dimLine(
        styler,
        `Совпадений: ${String(data.matches ?? data.events.length)} (показано ${data.events.length}, событий: ${String(data.totalEvents ?? data.events.length)})`,
        data.tailOnly === true ? "только конец файла" : void 0,
        data.cutBySize === true ? "обрезано по размеру" : void 0,
        typeof data.nextOffset === "number" ? `далее: --offset ${data.nextOffset}` : void 0
      )
    );
    return { text: `${parts.join("\n")}
` };
  }
  if (op === "logs.follow" && isRecord(data) && Array.isArray(data.events)) {
    const parts = data.events.length ? renderLogEvents(data.events, styler) : [styler.dim("Новых событий нет.")];
    if (typeof data.omitted === "number" && data.omitted > 0) {
      parts.push(styler.yellow(`Пропущено ранних событий: ${data.omitted}.`));
    }
    if (data.gapPossible === true) {
      const reason = typeof data.resetReason === "string" ? ` (${data.resetReason})` : "";
      parts.push(styler.yellow(`Возможен пропуск событий${reason}.`));
    }
    if (typeof data.cursor === "string") {
      parts.push(styler.dim(`cursor: ${data.cursor}`));
    }
    return { text: `${parts.join("\n")}
` };
  }
  if (op === "rpc.list" && isRecord(data) && Array.isArray(data.targets)) {
    const parts = [];
    if (data.targets.length > 0) {
      const cols = [
        { header: "Функция" },
        { header: "Параметры" },
        { header: "Доступ" }
      ];
      const rows2 = data.targets.map((item) => {
        const r = isRecord(item) ? item : {};
        const params = Array.isArray(r.parameters) ? r.parameters.join(", ") : "";
        const access = r.serverOnly === true || r.allowed === false ? "только сервер" : r.allowed === true ? "клиент" : "?";
        return [String(r.id ?? ""), params, access];
      });
      parts.push(renderTable(cols, rows2, tableOpts));
    } else {
      parts.push(styler.dim("Функции не найдены."));
    }
    parts.push(
      dimLine(
        styler,
        `Показано ${data.targets.length} из ${String(data.total ?? data.targets.length)}`,
        typeof data.serverOnlyHidden === "number" && data.serverOnlyHidden > 0 ? `только для кода на сервере: ${data.serverOnlyHidden} (--all)` : void 0,
        typeof data.nextCursor === "number" ? `далее: --cursor ${data.nextCursor}` : void 0
      )
    );
    if (Array.isArray(data.skipped) && data.skipped.length > 0) {
      parts.push(styler.yellow(`Пропущены библиотеки: ${data.skipped.join(", ")}.`));
    }
    return { text: `${parts.join("\n")}
` };
  }
  if (op === "rpc.describe" && isRecord(data)) {
    const params = Array.isArray(data.parameters) ? data.parameters.join(", ") : "";
    const access = data.serverOnly === true || data.allowed === false ? "только код на сервере" : data.allowed === true ? "разрешён с клиента" : "не указан";
    const parts = [
      styler.bold(`${String(data.id ?? "")}(${params})`),
      renderCard([["Доступ", access]], styler)
    ];
    if (typeof data.note === "string" && data.note) parts.push(styler.yellow(data.note));
    if (typeof data.code === "string") {
      parts.push("", data.code.replace(/^(?:\r?\n)+/, "").replace(/[ \t\r\n]+$/, ""));
      if (data.codeTruncated === true) parts.push(styler.dim("(код обрезан до 8 КиБ)"));
    }
    return { text: `${parts.join("\n")}
` };
  }
  if (op === "native.lds.loadDoc") {
    const xml = extractDocXml(data);
    if (xml !== void 0) return { text: ensureNewline(xml) };
  }
  if (op === "native.lds.putDoc") {
    const url = typeof options.requestArgs?.url === "string" ? options.requestArgs.url : void 0;
    const entries = [...url ? [["URL", url]] : []];
    return {
      text: `${styler.bold(styler.green("✓ Документ сохранён"))}${entries.length ? `
${renderCard(entries, styler)}` : ""}
`
    };
  }
  if ((op === "cli.files.edit" || op === "cli.object.edit") && isRecord(data)) {
    if (data.changed === false) return { text: `${styler.dim("Изменений нет.")}
` };
  }
  if (op === "cli.config.list" && isRecord(data) && Array.isArray(data.connections)) {
    const legacy = data.legacy === true ? " (старый формат)" : "";
    const parts = [styler.dim(`Файл подключений: ${String(data.path ?? "")}${legacy}`)];
    if (data.connections.length > 0) {
      const cols = [
        { header: "Подключение" },
        { header: "Адрес" },
        { header: "Права" },
        { header: "Учётные данные" }
      ];
      const rows2 = data.connections.map((item) => {
        const r = isRecord(item) ? item : {};
        const isDef = r.default === true;
        const name = String(r.name ?? "");
        const cred = isRecord(r.credentials) ? renderCredentialSource(r.credentials) : "нет";
        return [
          isDef ? styler.green(`* ${name}`) : `  ${name}`,
          String(r.baseUrl ?? ""),
          formatPermissions(r.permissions),
          cred
        ];
      });
      parts.push("", renderTable(cols, rows2, tableOpts));
    } else {
      parts.push(styler.dim("Подключений нет."));
    }
    return { text: `${parts.join("\n")}
` };
  }
  if (op === "cli.config.init" && isRecord(data)) {
    const entries = [
      ["Подключение", styler.bold(String(data.connection ?? ""))],
      ["Файл", String(data.path ?? "")],
      ...typeof data.defaultConnection === "string" ? [["По умолчанию", data.defaultConnection]] : [],
      ["Права", formatPermissions(data.permissions)],
      ...typeof data.next === "string" ? [["Дальше", data.next]] : []
    ];
    return {
      text: `${styler.bold(styler.green("✓ Подключение сохранено"))}
${renderCard(entries, styler)}
`
    };
  }
  if (op === "cli.config.set" && isRecord(data)) {
    const conn = isRecord(data.connection) ? data.connection : {};
    const entries = [
      ["Подключение", styler.bold(String(conn.name ?? ""))],
      ...typeof conn.baseUrl === "string" ? [["Адрес", conn.baseUrl]] : [],
      ["Файл", String(data.path ?? "")],
      ...typeof data.defaultConnection === "string" ? [["По умолчанию", data.defaultConnection]] : [],
      ["Права", formatPermissions(conn.permissions)]
    ];
    for (const [key, label] of [
      ["timeoutMs", "Таймаут, мс"],
      ["maxResponseBytes", "Предел ответа"],
      ["outputLimitBytes", "Предел вывода"],
      ["runtimeDir", "Папка сохранённых результатов"],
      ["resultsMaxBytes", "Предел результатов"],
      ["resultsMaxAgeDays", "Срок результатов, дн."],
      ["journalMaxBytes", "Журнал записей"]
    ]) {
      if (conn[key] !== void 0) entries.push([label, String(conn[key])]);
    }
    return {
      text: `${styler.bold(styler.green("✓ Подключение обновлено"))}
${renderCard(entries, styler)}
`
    };
  }
  if (op === "cli.config.use" && isRecord(data)) {
    const conn = isRecord(data.connection) ? data.connection : {};
    const entries = [
      ["По умолчанию", styler.bold(String(data.defaultConnection ?? conn.name ?? ""))],
      ...typeof conn.baseUrl === "string" ? [["Адрес", conn.baseUrl]] : [],
      ["Права", formatPermissions(conn.permissions)],
      ["Файл", String(data.path ?? "")]
    ];
    return {
      text: `${styler.bold(styler.green("✓ Подключение по умолчанию изменено"))}
${renderCard(entries, styler)}
`
    };
  }
  if (op === "cli.config.remove" && isRecord(data)) {
    const removed = isRecord(data.removed) ? data.removed : {};
    const remaining = Array.isArray(data.remaining) ? data.remaining : [];
    const entries = [
      ["Удалено", styler.bold(String(removed.name ?? ""))],
      ...typeof removed.baseUrl === "string" ? [["Адрес", removed.baseUrl]] : [],
      ["По умолчанию", typeof data.defaultConnection === "string" ? data.defaultConnection : "—"],
      ["Осталось", remaining.length ? remaining.map(String).join(", ") : "нет"],
      ["Файл", String(data.path ?? "")]
    ];
    return {
      text: `${styler.bold(styler.green("✓ Подключение удалено"))}
${renderCard(entries, styler)}
`
    };
  }
  if (op === "cli.config.path" && isRecord(data)) {
    const entries = [
      ["Файл", String(data.path ?? "")],
      ["Состояние", data.exists === true ? styler.green("существует") : styler.yellow("не создан")]
    ];
    return { text: `${renderCard(entries, styler)}
` };
  }
  if (op === "cli.config.example") {
    return { text: `${JSON.stringify(data, null, 2)}
` };
  }
  if (op === "api.list" && isRecord(data)) {
    if (Array.isArray(data.topics)) {
      const cols = [
        { header: "Тема" },
        { header: "Описание" },
        { header: "Операции" }
      ];
      const rows2 = data.topics.map((item) => {
        const r = isRecord(item) ? item : {};
        const ops = Array.isArray(r.operations) ? r.operations.join(", ") : typeof r.count === "number" ? `${r.count} шт.` : "";
        return [styler.cyan(String(r.topic ?? "")), String(r.title ?? ""), ops];
      });
      const effects = isRecord(data.effects) ? Object.entries(data.effects).map(([k, v]) => `${k}: ${String(v)}`).join(", ") : "";
      const parts = [
        renderTable(cols, rows2, tableOpts),
        styler.dim(`Всего операций: ${String(data.total ?? "")}${effects ? ` (${effects})` : ""}`)
      ];
      if (typeof data.hint === "string" && data.hint) parts.push(styler.dim(data.hint));
      return { text: `${parts.join("\n")}
` };
    }
    if (Array.isArray(data.operations)) {
      const parts = [];
      if (data.operations.length > 0) {
        const cols = [
          { header: "ID" },
          { header: "Тема" },
          { header: "Эффект" },
          { header: "Описание" }
        ];
        const rows2 = data.operations.map((item) => {
          const r = isRecord(item) ? item : {};
          return [
            String(r.id ?? ""),
            String(r.topic ?? ""),
            String(r.effect ?? ""),
            String(r.description ?? "")
          ];
        });
        parts.push(renderTable(cols, rows2, tableOpts));
      } else {
        parts.push(styler.dim("Операции не найдены."));
      }
      parts.push(
        dimLine(
          styler,
          `Показано ${data.operations.length} из ${String(data.total ?? data.operations.length)}`,
          typeof data.nextCursor === "number" ? `далее: --cursor ${data.nextCursor}` : void 0
        )
      );
      if (typeof data.hint === "string" && data.hint) parts.push(styler.dim(data.hint));
      return { text: `${parts.join("\n")}
` };
    }
  }
  if (op === "api.describe" && isRecord(data)) {
    return { text: renderApiDescribe(data, styler) };
  }
  if (op === "results.read" && isRecord(data)) {
    if (typeof data.text === "string") {
      const footer = dimLine(
        styler,
        `Символов всего: ${String(data.totalChars ?? data.text.length)}`,
        data.cutBySize === true ? "обрезано по размеру" : void 0,
        typeof data.nextOffset === "number" ? `далее: --offset ${data.nextOffset}` : void 0
      );
      return { text: `${ensureNewline(data.text)}${footer}
` };
    }
    if (Array.isArray(data.items)) {
      const parts = [];
      if (isRecord(data.blockedItem)) {
        parts.push(
          styler.yellow(
            `Элемент #${String(data.blockedItem.index ?? 0)} (${formatBytes(Number(data.blockedItem.bytes ?? 0))}) не помещается в ответ.`
          )
        );
        if (typeof data.hint === "string") parts.push(styler.dim(data.hint));
      } else {
        const table = extractTable(op, data);
        if (table && table.headers.length > 0 && table.rows.length > 0) {
          parts.push(renderExtractedTable(table, tableOpts));
        } else if (data.items.length > 0) {
          parts.push(renderStructured(data.items, styler));
        } else {
          parts.push(styler.dim("Элементов нет."));
        }
      }
      parts.push(
        dimLine(
          styler,
          `Показано ${data.items.length} из ${String(data.total ?? data.items.length)}`,
          data.cutBySize === true ? "обрезано по размеру" : void 0,
          typeof data.nextOffset === "number" ? `далее: --offset ${data.nextOffset}` : void 0
        )
      );
      return { text: `${parts.join("\n")}
` };
    }
  }
  if (op === "results.export" && isRecord(data)) {
    const bytes = typeof data.bytes === "number" ? data.bytes : 0;
    const entries = [
      ["Файл", String(data.path ?? "")],
      ["Формат", String(data.format ?? "")],
      ["Размер", `${formatBytes(bytes)} (${bytes} Б)`],
      ...typeof data.items === "number" ? [["Элементов", String(data.items)]] : []
    ];
    return {
      text: `${styler.bold(styler.green("✓ Результат сохранён"))}
${renderCard(entries, styler)}
`
    };
  }
  if (op === "runtime.batch" && isRecord(data) && Array.isArray(data.results)) {
    const completed = Number(data.completed ?? data.results.length);
    const requested = Number(data.requested ?? data.results.length);
    const lines = [
      styler.bold(`Пакет операций: выполнено ${completed} из ${requested}`),
      ""
    ];
    for (const [index, raw] of data.results.entries()) {
      if (!isRecord(raw)) continue;
      const ok = raw.ok === true;
      const meta = isRecord(raw.meta) ? raw.meta : {};
      const stepOp = String(meta.operationId ?? "");
      const as = typeof raw.as === "string" ? ` (${raw.as})` : "";
      const duration = typeof meta.durationMs === "number" ? styler.dim(` ${formatDuration(meta.durationMs)}`) : "";
      const err = isRecord(raw.error) ? raw.error : void 0;
      const detail = err ? ` — ${styler.red(`[${String(err.code ?? "ERROR")}]`)} ${String(err.message ?? "")}` : isRecord(raw.data) && typeof raw.data.id === "string" ? styler.dim(` · id=${raw.data.id}`) : "";
      const mark = ok ? styler.green("✓") : styler.red("✗");
      lines.push(`  ${mark} #${index + 1}${as} ${stepOp}${duration}${detail}`);
    }
    return { text: `${lines.join("\n")}
` };
  }
  if (op === "agents.run" && isRecord(data)) {
    const started = data.started === true;
    const status = typeof data.status === "string" ? data.status : void 0;
    const threadId = typeof data.threadId === "string" && data.threadId ? data.threadId : void 0;
    const roleUID = typeof data.roleUID === "string" && data.roleUID ? data.roleUID : void 0;
    const startedAt = typeof data.startedAt === "string" ? data.startedAt : "";
    const finishedAt = typeof data.finishedAt === "string" ? data.finishedAt : "";
    const duration = startedAt && finishedAt ? formatIsoIntervalDuration(startedAt, finishedAt) : void 0;
    const interval = startedAt && finishedAt ? `${startedAt} – ${finishedAt}${duration ? ` (${duration})` : ""}` : startedAt || finishedAt;
    const connFlag = options.connectionArg ? options.connectionArg.startsWith("-") ? `--connection=${options.connectionArg} ` : `-c ${options.connectionArg} ` : "";
    const logType = started ? "xhttp" : "agent";
    const startMatch = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/.exec(startedAt);
    const finishMatch = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/.exec(finishedAt);
    const sameDay = startMatch !== null && finishMatch !== null && startMatch[1] === finishMatch[1];
    const startMin = startMatch?.[2]?.slice(0, 5);
    const finishMin = finishMatch?.[2]?.slice(0, 5);
    const sameMinute = sameDay && startMin === finishMin;
    const sameHour = sameDay && startMatch[2].slice(0, 2) === finishMatch[2].slice(0, 2);
    const minuteNumber = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
    const adjacentMinutes = sameDay && startMin !== void 0 && finishMin !== void 0 && Math.abs(minuteNumber(finishMin) - minuteNumber(startMin)) === 1;
    const searchQuery = sameMinute ? startMatch[2] === finishMatch[2] ? startMatch[2] : startMin : void 0;
    const logCommand = searchQuery ? `wtctl ${connFlag}logs search ${logType} ${searchQuery}  ·  wtctl ${connFlag}logs tail ${logType}` : adjacentMinutes && startMin && finishMin ? `wtctl ${connFlag}logs search ${logType} ${startMin}  ·  wtctl ${connFlag}logs search ${logType} ${finishMin}` : sameHour && startMatch ? `wtctl ${connFlag}logs search ${logType} ${startMatch[2].slice(0, 3)}  ·  wtctl ${connFlag}logs tail ${logType}` : sameDay && startMin ? `wtctl ${connFlag}logs search ${logType} ${startMin}  ·  wtctl ${connFlag}logs tail ${logType}` : startMatch && finishMatch && !sameDay ? `wtctl ${connFlag}logs tail ${logType}  ·  wtctl ${connFlag}logs list --type ${logType} --start-date ${startMatch[1]} --end-date ${finishMatch[1]}` : `wtctl ${connFlag}logs tail ${logType}  ·  wtctl ${connFlag}logs search ${logType}`;
    const stateLabel = started ? status === "running" ? styler.bold(styler.cyan("Запущен в фоне")) : status === "cancelled" ? styler.bold(styler.yellow("Запущен и отменён")) : status === "unknown" ? styler.bold(styler.yellow("Запущен (состояние неизвестно)")) : styler.bold(styler.green("Запущен и завершён")) : status === "running" ? styler.bold(styler.yellow("Уже выполняется")) : styler.bold(styler.yellow("Не запущен"));
    const entries = [
      ["Состояние", stateLabel],
      ...threadId ? [["Поток", styler.bold(threadId)]] : [],
      ...roleUID ? [["Роль", roleUID]] : [],
      ...interval ? [[finishedAt ? "Интервал" : "Запущен", interval]] : [],
      ...status === "running" && threadId ? [
        [
          "Проверка",
          `wtctl ${connFlag}agent status --thread ${threadId} --wait  ·  wtctl ${connFlag}agent cancel ${threadId}`
        ]
      ] : [["Лог", logCommand]]
    ];
    const parts = [renderCard(entries, styler)];
    if (!started && status === "running") {
      parts.push(styler.dim("Для параллельного запуска добавьте --allow-concurrent."));
    }
    let stderrNote;
    if (isRecord(data.logs)) {
      const hasWarning = typeof data.logs.warning === "string" && data.logs.warning.length > 0;
      if (hasWarning) {
        stderrNote = `${styler.yellow(`Предупреждение: ${String(data.logs.warning)}`)}
`;
      }
      const filesList = Array.isArray(data.logs.files) ? data.logs.files.filter((item) => typeof item === "string" && item !== "") : [];
      const fileLabel = filesList.length > 0 ? filesList.join(", ") : typeof data.logs.file === "string" && data.logs.file ? data.logs.file : String(data.logs.type ?? logType);
      const events = Array.isArray(data.logs.events) ? data.logs.events : [];
      if (events.length > 0) {
        parts.push("", styler.dim(`События в логе ${fileLabel} (${events.length}):`));
        parts.push(...renderLogEvents(events, styler));
      } else if (!hasWarning) {
        parts.push("", styler.dim(`В логе ${fileLabel} событий за интервал не найдено.`));
      }
    }
    return {
      text: `${parts.join("\n")}
`,
      ...stderrNote === void 0 ? {} : { stderrNote }
    };
  }
  if (op === "agents.status" && isRecord(data) && Array.isArray(data.runs)) {
    const parts = [];
    if (data.runs.length > 0) {
      const cols = [
        { header: "Поток" },
        { header: "Код" },
        { header: "Название" },
        { header: "Состояние" },
        { header: "Старт" },
        { header: "Конец" }
      ];
      const rows2 = data.runs.map((item) => {
        const r = isRecord(item) ? item : {};
        const status = String(r.status ?? "");
        const state = status === "running" ? styler.cyan("Выполняется") : status === "finished" ? styler.green("Завершён") : status === "cancelled" ? styler.yellow("Отменён") : status || "—";
        return [
          String(r.threadId ?? ""),
          String(r.code ?? ""),
          String(r.name ?? ""),
          state,
          String(r.startedAt ?? ""),
          String(r.finishedAt ?? "—")
        ];
      });
      parts.push(renderTable(cols, rows2, tableOpts));
      parts.push(
        styler.dim(`Показано ${data.runs.length} из ${String(data.total ?? data.runs.length)}`)
      );
    } else {
      parts.push(styler.dim("Запусков агентов не найдено."));
    }
    return { text: `${parts.join("\n")}
` };
  }
  if (op === "agents.cancel" && isRecord(data)) {
    const connFlag = options.connectionArg ? options.connectionArg.startsWith("-") ? `--connection=${options.connectionArg} ` : `-c ${options.connectionArg} ` : "";
    const threadId = typeof data.threadId === "string" ? data.threadId : void 0;
    const roleUID = typeof data.roleUID === "string" ? data.roleUID : void 0;
    const entries = [
      ...threadId ? [["Поток", styler.bold(threadId)]] : [],
      ...roleUID ? [["Роль", roleUID]] : [],
      ["Исход", String(data.mutationOutcome ?? "confirmed")]
    ];
    const parts = [
      styler.bold(styler.green("✓ Запрос на отмену агента отправлен")),
      renderCard(entries, styler),
      styler.dim(
        threadId ? `Уже сделанные изменения не откатываются. Состояние: wtctl ${connFlag}agent status --thread ${threadId}` : "Уже сделанные изменения не откатываются."
      )
    ];
    return { text: `${parts.join("\n")}
` };
  }
  if (op === "web.spxml.getBackgroundTasksByName") {
    const tasks = normalizeBackgroundTasks(data);
    const parts = [];
    if (tasks.length > 0) {
      const cols = [
        { header: "ID" },
        { header: "Состояние" },
        { header: "Старт" },
        { header: "Детали" }
      ];
      const rows2 = tasks.map((task) => {
        const { running, finished, hasError } = parseTaskState(task);
        const state = running ? styler.cyan("Выполняется") : finished && hasError ? styler.red("Ошибка") : finished ? styler.green("Завершена") : String(task.IsRunning ?? "—");
        return [
          String(task.TrackingID ?? ""),
          state,
          String(task.StartDate ?? ""),
          summarizeTaskDetails(task)
        ];
      });
      parts.push(renderTable(cols, rows2, tableOpts));
      parts.push(styler.dim(`Всего задач: ${tasks.length}`));
    } else {
      parts.push(styler.dim("Фоновых задач не найдено."));
      if (options.requestArgs?.libName === "" && options.requestArgs?.methodName === "") {
        parts.push(styler.dim("Имя функции задаётся так: wtctl tasks list БИБЛИОТЕКА.ФУНКЦИЯ"));
      }
    }
    return { text: `${parts.join("\n")}
` };
  }
  if (op === "web.spxml.getAsyncMethodStatus" && isRecord(data)) {
    const trackingId = typeof data.TrackingID === "string" && data.TrackingID || (typeof options.requestArgs?.trackingId === "string" ? options.requestArgs.trackingId : void 0);
    const { running, finished, errCode, errText, hasError } = parseTaskState(data);
    const state = running ? styler.cyan("Выполняется") : finished && hasError ? styler.red("Завершена с ошибкой") : finished ? styler.green("Завершена") : String(data.IsRunning ?? "—");
    const entries = [
      ...trackingId ? [["TrackingID", styler.bold(trackingId)]] : [],
      ["Состояние", state],
      ...data.Progress !== void 0 && data.Progress !== null && data.Progress !== "" ? [["Прогресс", formatInline(data.Progress)]] : [],
      ...errCode ? [["Код ошибки", styler.red(errCode)]] : [],
      ...errText ? [["Ошибка", styler.red(errText)]] : []
    ];
    let structuredBlock;
    if ("value" in data) {
      const value = data.value;
      if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "bigint" || typeof value === "string" && !value.includes("\n") && value.length <= 120) {
        entries.push(["Результат", formatInline(value)]);
      } else {
        structuredBlock = renderStructured(value, styler, 2);
      }
    } else if (data.ResultData !== void 0 && data.ResultData !== null && data.ResultData !== "") {
      structuredBlock = renderStructured(data.ResultData, styler, 2);
    }
    const parts = [renderCard(entries, styler)];
    if (structuredBlock !== void 0) {
      parts.push("", styler.dim("Результат:"), structuredBlock);
    }
    if (finished) {
      parts.push(styler.dim("Сервер удалил запись о задаче после выдачи итога."));
    }
    return { text: `${parts.join("\n")}
` };
  }
  if (op === "web.spxml.killAsyncMethod") {
    const trackingId = typeof options.requestArgs?.trackingId === "string" ? options.requestArgs.trackingId : void 0;
    const entries = [
      ...trackingId ? [["TrackingID", styler.bold(trackingId)]] : [],
      ["Состояние", "Запрос отправлен"]
    ];
    const parts = [
      styler.bold(styler.green("✓ Запрос на остановку задачи отправлен")),
      renderCard(entries, styler),
      styler.dim("Уже сделанные изменения не откатываются.")
    ];
    return { text: `${parts.join("\n")}
` };
  }
  if (op === "execute.script" && isRecord(data) && Array.isArray(data.result)) {
    const parts = [];
    const table = extractTable(op, data);
    if (table && table.headers.length > 0 && table.rows.length > 0) {
      parts.push(renderExtractedTable(table, tableOpts));
    } else if (data.result.length === 0) {
      parts.push(styler.dim("Пустой результат (RESULT = [])."));
    } else {
      parts.push(renderStructured(data.result, styler));
    }
    if (isRecord(data.data) && Object.keys(data.data).length > 0) {
      parts.push("", styler.dim("Дополнительно:"), renderStructured(data.data, styler, 2));
    }
    const execId = typeof data.executionId === "string" ? ` · ${data.executionId}` : "";
    parts.push(styler.dim(`Строк: ${data.result.length}${execId}`));
    return { text: `${parts.join("\n")}
` };
  }
  if (op === "rpc.call" && isRecord(data) && "value" in data) {
    if (typeof data.value === "string" && data.value.includes("\n")) {
      return { text: ensureNewline(data.value) };
    }
    if (Array.isArray(data.value)) {
      const keys = collectObjectKeys(data.value);
      if (keys && keys.length > 0) {
        const cols = keys.map((header) => ({ header }));
        const rows2 = data.value.map(
          (item) => keys.map((key) => tabularCellText(item[key]))
        );
        return { text: `${renderTable(cols, rows2, tableOpts)}
` };
      }
    }
    return { text: `${renderStructured(data.value, styler)}
` };
  }
  return { text: `${renderStructured(data, styler)}
` };
}
function formatHumanError(result, styler) {
  const err = result.error;
  if (!err) return `${styler.bold(styler.red("Ошибка:"))} Операция не выполнена.
`;
  const lines = [`${styler.bold(styler.red(`Ошибка [${err.code}]:`))} ${err.message}`];
  const scriptError = err.details?.scriptError;
  if (typeof scriptError === "string" && scriptError.trim() !== "") {
    lines.push(styler.dim("Ошибка кода на сервере:"));
    for (const line of scriptError.split(/\r?\n/)) {
      lines.push(`  ${line}`);
    }
  }
  if (err.mutationOutcome === "confirmed" && typeof err.details?.threadId === "string") {
    const role = typeof err.details.roleUID === "string" && err.details.roleUID ? `, роль: ${err.details.roleUID}` : "";
    lines.push(
      styler.yellow(`Агент сервера запущен (confirmed), поток: ${err.details.threadId}${role}.`)
    );
  }
  if (err.mutationOutcome === "indeterminate") {
    lines.push(
      styler.yellow(
        "Внимание: исход записи не определён (indeterminate) — запись могла пройти. Перед повтором проверить состояние на сервере."
      )
    );
    const refs = ["objectId", "url", "mutationId", "executionId"].map(
      (key) => typeof err.details?.[key] === "string" ? `${key}=${err.details[key]}` : void 0
    ).filter(Boolean);
    if (refs.length) lines.push(styler.dim(`Ссылки для проверки: ${refs.join(", ")}`));
  }
  if (isRecord(result.data) && result.data.receiptOnly === true) {
    const receipt = result.data;
    const receiptRefs = [
      "id",
      "mutationOutcome",
      "mutationId",
      "resultId",
      "executionId",
      "TrackingID",
      "output"
    ].map((key) => typeof receipt[key] === "string" ? `${key}=${receipt[key]}` : void 0).filter(Boolean);
    if (receiptRefs.length)
      lines.push(styler.dim(`Сведения о результате: ${receiptRefs.join(", ")}`));
  }
  const storedId = typeof result.meta.resultId === "string" ? result.meta.resultId : isRecord(result.data) && typeof result.data.resultId === "string" ? result.data.resultId : void 0;
  if (storedId && !(isRecord(result.data) && result.data.receiptOnly === true)) {
    lines.push(
      styler.dim(
        `Сохранённый результат: ${storedId} (wtctl result read ${storedId} · wtctl result export ${storedId} --to ФАЙЛ)`
      )
    );
  }
  if (err.hint) {
    lines.push(`${styler.cyan("Подсказка:")} ${err.hint}`);
  }
  return `${lines.join("\n")}
`;
}

// src/cli/format/index.ts
var OUTPUT_FORMATS = ["auto", "table", "json", "jsonl", "csv", "tsv", "raw"];
function isOutputFormat(value) {
  return OUTPUT_FORMATS.includes(value);
}
function resolveOutputMode(args, io) {
  const localFormat = usesLocalFormat(args);
  const flag = localFormat ? void 0 : stringOption(args, "format");
  let requested;
  if (args.options.json === true) {
    if (flag !== void 0) throw new CliInputError("Нужно выбрать --json или --format, а не оба.");
    requested = "json";
  } else if (flag !== void 0) {
    if (!isOutputFormat(flag)) {
      throw new CliInputError("--format должен быть auto, table, json, jsonl, csv, tsv или raw.");
    }
    requested = flag;
  } else {
    const envFormat = process3.env.WTCTL_FORMAT;
    if (envFormat !== void 0 && envFormat !== "") {
      if (!isOutputFormat(envFormat)) {
        throw new CliInputError(
          "WTCTL_FORMAT должен быть auto, table, json, jsonl, csv, tsv или raw."
        );
      }
      requested = envFormat;
    } else {
      requested = "auto";
    }
  }
  const format = requested === "auto" ? io.stdoutIsTTY === true ? "human" : "json" : requested;
  const humanErrors = requested !== "json" && (format !== "json" || io.stderrIsTTY === true);
  return { requested, format, humanErrors };
}
function resolveErrorMode(argv, parsed, io) {
  if (parsed !== void 0) {
    try {
      return resolveOutputMode(parsed, io).humanErrors ? "human" : "json";
    } catch {
    }
  }
  const localFormat = usesLocalFormatArgv(argv);
  let hasJsonFlag = false;
  let rawFormat;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--") break;
    if (token === "--json") {
      hasJsonFlag = true;
      continue;
    }
    if (!localFormat) {
      if (token === "--format" && i + 1 < argv.length) {
        rawFormat = argv[++i];
      } else if (token.startsWith("--format=")) {
        rawFormat = token.slice("--format=".length);
      }
    }
  }
  if (hasJsonFlag || rawFormat === "json") return "json";
  if (rawFormat !== void 0 && isOutputFormat(rawFormat) && rawFormat !== "auto") return "human";
  if (rawFormat === void 0) {
    const envFormat = process3.env.WTCTL_FORMAT;
    if (envFormat === "json") return "json";
    if (envFormat !== void 0 && envFormat !== "" && isOutputFormat(envFormat) && envFormat !== "auto")
      return "human";
  }
  return io.stdoutIsTTY === true || io.stderrIsTTY === true ? "human" : "json";
}
var TABULAR_OPERATIONS = /* @__PURE__ */ new Set([
  "runtime.query",
  "schema.types",
  "schema.get",
  "logs.list",
  "logs.search",
  "logs.follow",
  "files.list",
  "rpc.list",
  "cli.config.list",
  "api.list",
  "runtime.check",
  "execute.script",
  "results.read",
  "agents.status",
  "web.spxml.getBackgroundTasksByName"
]);
var CLI_FORMAT_LABELS = {
  "cli.version": "wtctl version",
  "cli.config.init": "wtctl config init",
  "cli.config.set": "wtctl config set",
  "cli.config.use": "wtctl config use",
  "cli.config.remove": "wtctl config remove",
  "cli.config.path": "wtctl config path",
  "cli.config.example": "wtctl config example",
  "agents.run": "wtctl agent run",
  "agents.cancel": "wtctl agent cancel",
  "web.spxml.getAsyncMethodStatus": "wtctl tasks status",
  "web.spxml.killAsyncMethod": "wtctl tasks kill"
};
function assertFormatSupported(operationId, format, args, commandLabel) {
  if ((operationId === "cli.help" || operationId === "cli.guide" || operationId === "cli.completion") && (format === "csv" || format === "tsv" || format === "jsonl")) {
    const cmdName = operationId === "cli.help" ? "help" : operationId === "cli.guide" ? "guide" : "completion";
    throw new CliInputError(
      `Формат ${format} не поддерживается командой ${cmdName}.`,
      "Подходят --format auto, --format table, --format raw или --json."
    );
  }
  if (format !== "csv" && format !== "tsv") return;
  const supported = TABULAR_OPERATIONS.has(operationId) || operationId === "objects.get" && args?.ids !== void 0;
  if (!supported) {
    const label = commandLabel ?? CLI_FORMAT_LABELS[operationId] ?? operationId;
    throw new CliInputError(
      `Формат ${format} не подходит для ответа ${label}: ответ не является таблицей.`,
      "Для одиночного ответа подходят --format auto, --format table, --format json, --format jsonl или --format raw."
    );
  }
}
function formatOperationOutput(result, format, options) {
  if (format === "human" || format === "table") {
    const rendered = renderHuman(result, {
      ...options.columns === void 0 ? {} : { columns: options.columns },
      styler: createStyler(options.color),
      quiet: options.quiet === true,
      ...options.requestedFields === void 0 ? {} : { requestedFields: options.requestedFields },
      ...options.requestArgs === void 0 ? {} : { requestArgs: options.requestArgs },
      ...options.connectionArg === void 0 ? {} : { connectionArg: options.connectionArg }
    });
    return {
      kind: "text",
      text: rendered.text,
      ...rendered.stderrNote === void 0 ? {} : { stderrNote: rendered.stderrNote }
    };
  }
  if (format === "jsonl") {
    return { kind: "text", text: formatJsonl(result.meta.operationId, result.data) };
  }
  if (format === "csv" || format === "tsv") {
    const table = extractTable(result.meta.operationId, result.data, options.requestedFields) ?? {
      headers: ["value"],
      rows: [[result.data]]
    };
    return {
      kind: "text",
      text: format === "csv" ? formatCsv(table.headers, table.rows) : formatTsv(table.headers, table.rows)
    };
  }
  return renderRaw(result, options.requestedFields, options.quiet === true);
}

// src/cli/interactive.ts
import { performance } from "node:perf_hooks";

// src/cli/output.ts
import { mkdir } from "node:fs/promises";
import { dirname, resolve as resolve2 } from "node:path";
function frontendResult(operationId, connection, data) {
  return { ok: true, data, meta: { operationId, connection, durationMs: 0 } };
}
function failure(code, message, hint) {
  return {
    ok: false,
    error: { code, message, ...hint ? { hint } : {} },
    meta: { operationId: "cli", connection: "unselected", durationMs: 0 }
  };
}
function frontendFailure(result, diagnostic, flag) {
  const error = result.error ?? {
    ...diagnostic.error,
    retryable: false,
    details: { operationSucceeded: result.ok }
  };
  const meta = { ...result.meta, [flag]: true };
  return { ...result, ok: false, error, meta };
}
function serializeResult(value, pretty = false) {
  return `${JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString(10) : item, pretty ? 2 : void 0)}
`;
}
async function safeDiagnostic(io, value, mode = "json") {
  try {
    const text = mode === "human" ? formatHumanError(value, createStyler(resolveColor(io, "stderr"))) : serializeResult(value, io.pretty === true);
    await io.writeError(text);
  } catch {
  }
}
var UUID_RE = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
var OBJECT_ID_RE = /^(?:[0-9]{1,20}|0[xX][0-9a-fA-F]{1,16})$/;
var EXEC_ID_RE = /^hcm_inline_[a-f0-9]{32}$/;
var TRACKING_ID_RE2 = /^(?:\d+|0x[0-9a-f]+)$/i;
var OUTCOMES = /* @__PURE__ */ new Set(["not_sent", "confirmed", "indeterminate"]);
function boundedText(value, maximum) {
  return typeof value === "string" && value.length <= maximum && Buffer.byteLength(JSON.stringify(value), "utf8") <= maximum ? value : void 0;
}
function firstString(values, pattern) {
  return values.find((v) => typeof v === "string" && pattern.test(v));
}
function isRecord2(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function outputDeliveryReceipt(result, savedOutput) {
  const returned = isRecord2(result.data) ? result.data : {};
  const details = result.error?.details;
  const pickOutcome = (v) => typeof v === "string" && OUTCOMES.has(v) ? v : void 0;
  const id = [returned.id, details?.objectId].find(
    (v) => typeof v === "string" && OBJECT_ID_RE.test(v) && BigInt(v) <= 0xffffffffffffffffn
  );
  const resultId = firstString([result.meta.resultId, returned.resultId], UUID_RE);
  const mutationId = firstString([returned.mutationId, details?.mutationId], UUID_RE);
  const executionId = firstString([returned.executionId, details?.executionId], EXEC_ID_RE);
  const tracking = boundedText(returned.TrackingID, 128);
  const TrackingID = tracking !== void 0 && TRACKING_ID_RE2.test(tracking) ? tracking : void 0;
  const operationId = boundedText(result.meta.operationId, 128);
  const connection = boundedText(result.meta.connection, 256);
  const deliveryHint = "Серверную операцию из-за ошибки вывода не повторять; проверить известный ID, resultId или сохранённый файл.";
  const metaFlags = ["cleanupFailed", "outputFailed", "truncated"].reduce((acc, key) => result.meta[key] === true ? { ...acc, [key]: true } : acc, {});
  return {
    ok: false,
    data: {
      receiptOnly: true,
      operationSucceeded: typeof details?.operationSucceeded === "boolean" ? details.operationSucceeded : result.ok,
      ...optional(
        "mutationOutcome",
        pickOutcome(result.error?.mutationOutcome) ?? pickOutcome(returned.mutationOutcome)
      ),
      ...optional("id", id),
      ...optional("mutationId", mutationId),
      ...optional("resultId", resultId),
      ...optional("executionId", executionId),
      ...optional("TrackingID", TrackingID),
      ...savedOutput === void 0 ? {} : {
        saved: true,
        ...boundedText(savedOutput, 1024) === void 0 ? { outputOmitted: true } : { output: savedOutput }
      },
      deliveryHint
    },
    error: result.error ? {
      code: boundedText(result.error.code, 128) ?? "OPERATION_FAILED",
      message: boundedText(result.error.message, 512) ?? "Основная операция вернула ошибку; подробности опущены.",
      ...optional("hint", boundedText(result.error.hint, 256)),
      retryable: result.error.retryable ?? false,
      ...optional("mutationOutcome", pickOutcome(result.error.mutationOutcome))
    } : {
      code: "OUTPUT_WRITE_FAILED",
      message: "Операция завершена, но доставить результат в stdout не удалось.",
      hint: deliveryHint,
      retryable: false
    },
    meta: {
      operationId: operationId ?? "[omitted]",
      connection: connection ?? "[omitted]",
      durationMs: Number.isFinite(result.meta.durationMs) ? result.meta.durationMs : 0,
      outputDeliveryFailed: true,
      ...operationId === void 0 ? { operationIdOmitted: true } : {},
      ...connection === void 0 || result.meta.connectionOmitted === true ? { connectionOmitted: true } : {},
      ...metaFlags,
      ...optional("resultId", resultId)
    }
  };
}
async function deliverJsonOutput(result, value, io, savedOutput) {
  try {
    await io.writeOut(serializeResult(value, io.pretty === true));
    return true;
  } catch {
    await safeDiagnostic(io, outputDeliveryReceipt(result, savedOutput), "json");
    return false;
  }
}
async function emitJson(result, args, io, runtime) {
  const output = stringOption(args, "output");
  if (output) {
    let bytes;
    try {
      if (result.meta.truncated && result.meta.resultId) {
        if (!runtime?.results) throw new Error("Сохранённые результаты недоступны");
        const input = { resultId: result.meta.resultId, path: output, overwrite: true };
        bytes = (await runtime.results.export(input, result)).bytes;
      } else await io.writeFile(output, serializeResult(result, true));
    } catch {
      const exportFailure = failure(
        "cli.output_failed",
        "Результат команды получен, но сохранить локальный файл не удалось.",
        "Клиент пытается вывести исходные data/meta в stdout; нужно проверить, что вывод получен. Серверную операцию из-за ошибки сохранения файла не повторять."
      );
      await safeDiagnostic(io, exportFailure, "json");
      const failedExport = frontendFailure(result, exportFailure, "outputFailed");
      await deliverJsonOutput(failedExport, failedExport, io);
      return 1;
    }
    const { truncated: _, ...meta } = result.meta;
    const done = result.data;
    const written = done !== null && typeof done === "object" && typeof done.mutationOutcome === "string" ? Object.fromEntries(
      ["id", "mutationOutcome", "verification"].filter((key) => done[key] !== void 0).map((key) => [key, done[key]])
    ) : {};
    const receipt = {
      ok: result.ok,
      data: { saved: true, output, ...optional("bytes", bytes), ...written },
      ...result.error ? { error: result.error } : {},
      meta
    };
    if (!await deliverJsonOutput(result, receipt, io, output)) return 1;
  } else if (!await deliverJsonOutput(result, result, io)) return 1;
  return !result.ok ? 1 : result.meta.truncated && !output ? 3 : 0;
}
async function writeFormattedStdout(formatted, result, io) {
  try {
    if (formatted.kind === "binary") {
      if (io.writeBinaryOut) await io.writeBinaryOut(formatted.bytes);
      else await io.writeOut(Buffer.from(formatted.bytes).toString("latin1"));
    } else {
      await io.writeOut(formatted.text);
      if (formatted.stderrNote) {
        try {
          await io.writeError(formatted.stderrNote);
        } catch {
        }
      }
    }
    return true;
  } catch {
    await safeDiagnostic(io, outputDeliveryReceipt(result), "human");
    return false;
  }
}
async function writeFormattedFile(path, formatted, io) {
  if (formatted.kind === "binary") {
    if (io.writeBinaryFile) await io.writeBinaryFile(path, formatted.bytes);
    else await io.writeFile(path, Buffer.from(formatted.bytes).toString("latin1"));
    return formatted.bytes.length;
  }
  await io.writeFile(path, formatted.text);
  return Buffer.byteLength(formatted.text, "utf8");
}
function hasFailureReport(result, format) {
  if (!isRecord2(result.data)) return false;
  if (result.meta.operationId === "runtime.check" && Array.isArray(result.data.checks) && format !== "raw") {
    return true;
  }
  if ((format === "human" || format === "table" || format === "jsonl") && result.meta.operationId === "runtime.batch" && Array.isArray(result.data.results)) {
    return true;
  }
  return false;
}
async function reportSaved(output, bytes, result, args, io, extra) {
  if (args.options.quiet === true) return true;
  const toStderr = io.stdoutIsTTY === true || io.stderrIsTTY === true;
  const styler = createStyler(resolveColor(io, toStderr ? "stderr" : "stdout"));
  const data = isRecord2(result.data) ? result.data : void 0;
  const extras = [
    extra,
    typeof data?.id === "string" ? `id=${data.id}` : void 0,
    typeof data?.mutationOutcome === "string" ? `исход: ${data.mutationOutcome}` : void 0
  ].filter(Boolean);
  const suffix = extras.length ? ` (${formatBytes(bytes)}, ${extras.join(", ")})` : ` (${formatBytes(bytes)})`;
  const message = `${styler.green("✓")} Сохранено: ${output}${suffix}
`;
  try {
    if (toStderr) await io.writeError(message);
    else await io.writeOut(message);
    return true;
  } catch {
    if (!toStderr) await safeDiagnostic(io, outputDeliveryReceipt(result, output), "human");
    return toStderr;
  }
}
var OPERATION_LIST_KEYS = {
  "runtime.query": "items",
  "files.list": "items",
  "objects.get": "items",
  "results.read": "items",
  "schema.types": "types",
  "schema.get": "fields",
  "logs.list": "files",
  "logs.search": "events",
  "logs.follow": "events",
  "rpc.list": "targets",
  "cli.config.list": "connections",
  "runtime.check": "checks",
  "runtime.batch": "results",
  "execute.script": "result",
  "web.spxml.getBackgroundTasksByName": "Task"
};
var STREAM_CSV_FLUSH_CHARS = 64 * 1024;
async function writeStreamedLines(output, io, produce) {
  if (io.openTextWriter) {
    const writer = await io.openTextWriter(output);
    let buffer = "";
    const flush = async () => {
      if (!buffer) return;
      const chunk = buffer;
      buffer = "";
      await writer.write(chunk);
    };
    try {
      await produce(async (line) => {
        buffer += `${line}
`;
        if (buffer.length >= STREAM_CSV_FLUSH_CHARS) await flush();
      });
      await flush();
      return await writer.commit();
    } catch (error) {
      await writer.abort().catch(() => void 0);
      throw error;
    }
  }
  const chunks = [];
  await produce(async (line) => {
    chunks.push(`${line}
`);
  });
  const text = chunks.join("");
  await io.writeFile(output, text);
  return Buffer.byteLength(text, "utf8");
}
async function exportTruncatedTabular(op, resultId, output, format, runtime, io, requestedFields) {
  if (!runtime.results?.openListItems) return void 0;
  const spec = tabularStreamSpec(op, requestedFields);
  const listKey = OPERATION_LIST_KEYS[op];
  if (!spec || !listKey) return void 0;
  const formatRow = format === "csv" ? formatCsvRow : formatTsvRow;
  const openItems = runtime.results.openListItems.bind(runtime.results);
  if (spec.kind === "fixed") {
    const bytes2 = await writeStreamedLines(output, io, async (appendLine) => {
      await appendLine(formatRow(spec.headers));
      for await (const item of openItems(resultId, listKey)) {
        await appendLine(formatRow(spec.mapRow(item)));
      }
    });
    return { bytes: bytes2 };
  }
  let headers = spec.headers;
  let scalarMode = false;
  let errorHeader;
  if (!headers) {
    if (spec.objectDataMode) {
      const seenFields = /* @__PURE__ */ new Set();
      const fieldKeys = [];
      let hasError = false;
      for await (const item of openItems(resultId, listKey)) {
        if (!isRecord2(item)) continue;
        if (isRecord2(item.error)) hasError = true;
        for (const source of [item.data, item.fromCatalog]) {
          if (!isRecord2(source)) continue;
          for (const key of Object.keys(source)) {
            if (!seenFields.has(key)) {
              seenFields.add(key);
              fieldKeys.push(key);
            }
          }
        }
      }
      const extraFields = fieldKeys.filter((key) => key !== "id" && key !== "type");
      if (hasError) {
        errorHeader = "error";
        while (seenFields.has(errorHeader)) errorHeader = `_${errorHeader}`;
      }
      headers = ["id", "type", ...extraFields, ...errorHeader === void 0 ? [] : [errorHeader]];
    } else {
      const seen = /* @__PURE__ */ new Set();
      let hasItems = false;
      for await (const item of openItems(resultId, listKey)) {
        hasItems = true;
        if (!isRecord2(item)) {
          scalarMode = true;
          break;
        }
        for (const key of Object.keys(item)) seen.add(key);
      }
      headers = scalarMode ? ["value"] : hasItems ? [...seen] : [];
    }
  }
  const finalHeaders = headers;
  const finalErrorHeader = errorHeader;
  const bytes = await writeStreamedLines(output, io, async (appendLine) => {
    if (finalHeaders.length === 0) return;
    await appendLine(formatRow(finalHeaders));
    for await (const item of openItems(resultId, listKey)) {
      if (scalarMode) {
        await appendLine(formatRow([item]));
      } else if (spec.objectDataMode) {
        if (!isRecord2(item)) {
          await appendLine(formatRow(finalHeaders.map(() => "")));
          continue;
        }
        const docData = isRecord2(item.data) ? item.data : {};
        const catalogData = isRecord2(item.fromCatalog) ? item.fromCatalog : {};
        const err = isRecord2(item.error) ? `${String(item.error.code ?? "")}: ${String(item.error.message ?? "")}` : "";
        const row = finalHeaders.map((header) => {
          if (header === "id") return item.id ?? (Object.hasOwn(docData, "id") ? docData.id : "");
          if (header === "type")
            return item.type ?? (Object.hasOwn(docData, "type") ? docData.type : "");
          if (finalErrorHeader !== void 0 && header === finalErrorHeader) return err;
          if (Object.hasOwn(docData, header)) return docData[header];
          if (Object.hasOwn(catalogData, header)) return catalogData[header];
          return "";
        });
        await appendLine(formatRow(row));
      } else {
        const record = isRecord2(item) ? item : {};
        const row = finalHeaders.map((key) => Object.hasOwn(record, key) ? record[key] : "");
        await appendLine(formatRow(row));
      }
    }
  });
  return { bytes };
}
async function exportTruncatedFormatted(result, output, format, runtime, io, quiet, requestedFields, requestArgs) {
  if (!runtime.results) throw new Error("Сохранённые результаты недоступны");
  const resultId = result.meta.resultId;
  const op = result.meta.operationId;
  if (format === "jsonl") {
    if (runtime.results.exportJsonlAny) {
      return await runtime.results.exportJsonlAny(resultId, output, true, OPERATION_LIST_KEYS[op]);
    }
    await mkdir(dirname(resolve2(output)), { recursive: true });
    return {
      bytes: (await runtime.results.export({ resultId, path: output, format: "jsonl", overwrite: true })).bytes
    };
  }
  if (format === "csv" || format === "tsv") {
    const streamed = await exportTruncatedTabular(
      op,
      resultId,
      output,
      format,
      runtime,
      io,
      requestedFields
    );
    if (streamed) return streamed;
  }
  if (format === "raw" && (op === "files.read" || op === "logs.read")) {
    await mkdir(dirname(resolve2(output)), { recursive: true });
    try {
      const exported = await runtime.results.export({
        resultId,
        path: output,
        format: "text",
        overwrite: true
      });
      const preview = isRecord2(result.data) && isRecord2(result.data.preview) ? result.data.preview : void 0;
      const tailNote = op === "logs.read" && !quiet && preview?.tailOnly === true ? `Показан конец файла ${String(preview.file ?? "")} (${typeof preview.sizeBytes === "number" ? `${preview.sizeBytes} Б` : "не весь"}); весь файл: --full.
` : void 0;
      return { bytes: exported.bytes, ...tailNote === void 0 ? {} : { stderrNote: tailNote } };
    } catch (error) {
      if (op === "files.read" && runtime.results.exportBinary) {
        return await runtime.results.exportBinary(resultId, output, true);
      }
      throw error;
    }
  }
  if (runtime.results.loadData) {
    const fullData = await runtime.results.loadData(resultId);
    const { truncated: _, ...meta } = result.meta;
    const fullResult = { ...result, data: fullData, meta };
    const formatted = formatOperationOutput(fullResult, format, {
      color: false,
      quiet,
      ...requestedFields === void 0 ? {} : { requestedFields },
      ...requestArgs === void 0 ? {} : { requestArgs }
    });
    const bytes = await writeFormattedFile(output, formatted, io);
    return {
      bytes,
      ...formatted.kind === "text" && formatted.stderrNote !== void 0 ? { stderrNote: formatted.stderrNote } : {}
    };
  }
  throw new Error("Чтение полного результата для форматирования недоступно");
}
async function writeNote(io, note) {
  if (!note) return;
  try {
    await io.writeError(note);
  } catch {
  }
}
async function emitFormatted(result, args, io, format, runtime, requestedFields, requestArgs) {
  const output = stringOption(args, "output");
  const quiet = args.options.quiet === true;
  const connectionArg = stringOption(args, "connection");
  const fieldOpts = {
    ...requestedFields === void 0 ? {} : { requestedFields },
    ...requestArgs === void 0 ? {} : { requestArgs },
    ...connectionArg === void 0 ? {} : { connectionArg }
  };
  if (!result.ok) {
    const report = hasFailureReport(result, format);
    const cleanupOnly = result.meta.cleanupFailed === true && result.data !== void 0;
    const truncatedBatchToFile = output !== void 0 && result.meta.operationId === "runtime.batch" && result.meta.truncated === true && result.meta.resultId !== void 0 && runtime?.results !== void 0;
    if (!report && !cleanupOnly && !truncatedBatchToFile) {
      await safeDiagnostic(io, result, "human");
      return 1;
    }
    if (output && (cleanupOnly || truncatedBatchToFile) && result.meta.truncated && result.meta.resultId && runtime?.results) {
      try {
        const exported = await exportTruncatedFormatted(
          result,
          output,
          format,
          runtime,
          io,
          quiet,
          requestedFields,
          requestArgs
        );
        await reportSaved(output, exported.bytes, result, args, io);
        await writeNote(io, exported.stderrNote);
      } catch {
        await safeDiagnostic(
          io,
          failure(
            "cli.output_failed",
            "Результат команды получен, но сохранить локальный файл не удалось.",
            "Серверную операцию из-за ошибки сохранения файла не повторять; результат сохранён локально под resultId."
          ),
          "human"
        );
      }
      if (truncatedBatchToFile) await safeDiagnostic(io, result, "human");
      return 1;
    }
    const formatted2 = formatOperationOutput(result, format, {
      ...!output && io.columns !== void 0 ? { columns: io.columns } : {},
      color: output ? false : resolveColor(io, "stdout"),
      quiet,
      ...fieldOpts
    });
    if (output) {
      try {
        const bytes = await writeFormattedFile(output, formatted2, io);
        await reportSaved(output, bytes, result, args, io);
        if (formatted2.kind === "text") await writeNote(io, formatted2.stderrNote);
      } catch {
        await safeDiagnostic(
          io,
          failure(
            "cli.output_failed",
            "Результат команды получен, но сохранить локальный файл не удалось.",
            "Серверную операцию из-за ошибки сохранения файла не повторять."
          ),
          "human"
        );
      }
    } else {
      await writeFormattedStdout(formatted2, result, io);
    }
    if (result.meta.operationId === "runtime.batch" || result.meta.operationId === "runtime.check") {
      await safeDiagnostic(io, result, "human");
    }
    return 1;
  }
  if (result.meta.truncated) {
    if (output && result.meta.resultId && runtime?.results) {
      try {
        const exported = await exportTruncatedFormatted(
          result,
          output,
          format,
          runtime,
          io,
          quiet,
          requestedFields,
          requestArgs
        );
        if (!await reportSaved(output, exported.bytes, result, args, io)) return 1;
        await writeNote(io, exported.stderrNote);
        return 0;
      } catch (error) {
        if (error instanceof CliInputError) throw error;
        const exportFailure = failure(
          "cli.output_failed",
          "Результат команды получен, но сохранить локальный файл не удалось.",
          "Серверную операцию из-за ошибки сохранения файла не повторять; результат сохранён локально под resultId."
        );
        await safeDiagnostic(io, exportFailure, "human");
        const notice2 = formatOperationOutput(result, "human", {
          color: resolveColor(io, "stderr"),
          quiet
        });
        if (notice2.kind === "text") await writeNote(io, notice2.text);
        return 1;
      }
    }
    const notice = formatOperationOutput(result, "human", {
      ...io.columns === void 0 ? {} : { columns: io.columns },
      color: resolveColor(io, format === "human" || format === "table" ? "stdout" : "stderr"),
      quiet
    });
    if (format === "human" || format === "table") {
      if (!await writeFormattedStdout(notice, result, io)) return 1;
    } else if (notice.kind === "text") {
      await writeNote(io, notice.text);
    }
    return 3;
  }
  if (output) {
    const formatted2 = formatOperationOutput(result, format, { color: false, quiet, ...fieldOpts });
    let bytes;
    try {
      bytes = await writeFormattedFile(output, formatted2, io);
    } catch {
      const exportFailure = failure(
        "cli.output_failed",
        "Результат команды получен, но сохранить локальный файл не удалось.",
        "Клиент пытается вывести результат в stdout; серверную операцию из-за ошибки сохранения файла не повторять."
      );
      await safeDiagnostic(io, exportFailure, "human");
      await writeFormattedStdout(formatted2, result, io);
      return 1;
    }
    if (!await reportSaved(output, bytes, result, args, io)) return 1;
    if (formatted2.kind === "text") await writeNote(io, formatted2.stderrNote);
    return 0;
  }
  const formatted = formatOperationOutput(result, format, {
    ...io.columns === void 0 ? {} : { columns: io.columns },
    color: resolveColor(io, "stdout"),
    quiet,
    ...fieldOpts
  });
  if (!await writeFormattedStdout(formatted, result, io)) return 1;
  return 0;
}
async function emit(result, args, io, runtime, resolvedMode, requestedFields, requestArgs) {
  result = errorInFrontendTerms(result, "cli");
  const mode = resolvedMode ?? resolveOutputMode(args, io);
  if (mode.format === "json") return emitJson(result, args, io, runtime);
  return emitFormatted(result, args, io, mode.format, runtime, requestedFields, requestArgs);
}
async function emitText(text, args, io) {
  const output = stringOption(args, "output");
  if (output) await io.writeFile(output, text);
  else await io.writeOut(text);
  return 0;
}
var MAX_STORED_JSON_CHARS = 8 * 1024 * 1024;
function storedResultId(result) {
  if (typeof result.meta.resultId === "string") return result.meta.resultId;
  if (isRecord2(result.data) && typeof result.data.resultId === "string")
    return result.data.resultId;
  return void 0;
}
async function readStoredJson(runtime, result, maxChars = MAX_STORED_JSON_CHARS) {
  const resultId = storedResultId(result);
  if (!resultId) {
    throw new HcmError(
      "RESULT_TRUNCATED",
      "Ответ обрезан, а resultId для дочитывания отсутствует."
    );
  }
  if (runtime.results?.loadData) {
    return await runtime.results.loadData(resultId);
  }
  const parts = [];
  let totalChars = 0;
  let offset = 0;
  while (offset !== void 0) {
    const chunk = await runtime.call("results.read", {
      resultId,
      offset,
      limit: 65536,
      format: "json"
    });
    if (!chunk.ok) {
      throw new HcmError(
        "RESULT_STORED",
        "Не удалось дочитать сохранённый результат.",
        `Прочитать сохранённый результат: wtctl result read ${resultId}.`,
        { resultId }
      );
    }
    const data = isRecord2(chunk.data) ? chunk.data : void 0;
    if (data?.format !== "json" || typeof data.text !== "string") {
      throw new HcmError(
        "RESULT_STORED",
        "Не удалось дочитать сохранённый результат в формате JSON.",
        `Прочитать сохранённый результат: wtctl result read ${resultId}.`,
        { resultId }
      );
    }
    totalChars += data.text.length;
    if (totalChars > maxChars) {
      throw new HcmError(
        "RESULT_TOO_LARGE_FOR_FORMAT",
        "Сохранённый результат больше 8 МиБ и не читается в памяти целиком.",
        `Сохранить потоково: wtctl result export ${resultId} --to ФАЙЛ --format jsonl (или json/text).`,
        { resultId }
      );
    }
    parts.push(data.text);
    if (data.nextOffset === void 0) {
      offset = void 0;
    } else if (typeof data.nextOffset === "number" && Number.isSafeInteger(data.nextOffset) && data.nextOffset > offset) {
      offset = data.nextOffset;
    } else {
      throw new HcmError(
        "RESULT_STORED",
        "Чтение сохранённого результата не продвигается.",
        `Прочитать сохранённый результат: wtctl result read ${resultId}.`,
        { resultId }
      );
    }
  }
  try {
    return JSON.parse(parts.join(""));
  } catch {
    throw new HcmError(
      "RESULT_STORED",
      "Сохранённый результат содержит повреждённый JSON.",
      `Прочитать сохранённый результат: wtctl result read ${resultId}.`,
      { resultId }
    );
  }
}

// src/cli/interactive.ts
var DAY_SECONDS = 86400;
var AGENT_LOG_TOLERANCE_SEC = 2;
var AGENT_LOG_TAIL_BYTES = 512 * 1024;
var MAX_AGENT_LOG_FILES = 3;
var MAX_SUMMARY_FIELD_CHARS = 120;
function isRecord3(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function sanitizeTerminalText(text) {
  return text.replace(/[\u0000-\u001f\u007f-\u009f]/g, (ch) => {
    const hex = ch.codePointAt(0).toString(16).padStart(2, "0");
    return `\\x${hex}`;
  });
}
function isInteractiveConfirm(io) {
  return io.stdoutIsTTY === true && typeof io.confirm === "function";
}
function renderPromptLines(entries, io) {
  const styler = createStyler(resolveColor(io, "stderr"));
  const nonEmpty = entries.filter(([, value]) => value !== "");
  const width = Math.max(...nonEmpty.map(([label]) => label.length)) + 1;
  return `${nonEmpty.map(([label, value]) => `${styler.dim(`${label}:`.padEnd(width))}  ${value}`).join("\n")}
`;
}
function compactSummaryValue(value) {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    return void 0;
  }
  const text = sanitizeTerminalText(String(value).replace(/[\r\n\t]+/g, " ")).replace(/ +/g, " ").trim();
  if (!text) return void 0;
  return text.length > MAX_SUMMARY_FIELD_CHARS ? `${text.slice(0, MAX_SUMMARY_FIELD_CHARS - 1)}…` : text;
}
var OBJECT_SUMMARY_FIELDS = [
  ["fullname", "ФИО"],
  ["name", "Название"],
  ["title", "Заголовок"],
  ["code", "Код"],
  ["login", "Логин"]
];
function extractObjectPreview(result, args) {
  const data = result?.ok && isRecord3(result.data) ? result.data : void 0;
  const source = data && isRecord3(data.preview) ? data.preview : data;
  const type = typeof source?.type === "string" && source.type || (typeof args.type === "string" ? args.type : void 0);
  const id = typeof source?.id === "string" && source.id || (typeof args.id === "string" ? args.id : void 0);
  const url = typeof source?.url === "string" && source.url || (typeof args.url === "string" ? args.url : void 0);
  const fields = [];
  const docData = source && isRecord3(source.data) ? source.data : void 0;
  const catalogData = source && isRecord3(source.fromCatalog) ? source.fromCatalog : void 0;
  for (const [key, label] of OBJECT_SUMMARY_FIELDS) {
    const value = (docData && Object.hasOwn(docData, key) ? compactSummaryValue(docData[key]) : void 0) ?? (catalogData && Object.hasOwn(catalogData, key) ? compactSummaryValue(catalogData[key]) : void 0);
    if (value !== void 0) fields.push([label, value]);
  }
  return {
    ...type === void 0 ? {} : { type },
    ...id === void 0 ? {} : { id },
    ...url === void 0 ? {} : { url },
    fields
  };
}
async function confirmDestructiveAction(operationId, args, config, runtime, io, progress) {
  const styler = createStyler(resolveColor(io, "stderr"));
  const safeConnName = sanitizeTerminalText(config.name);
  const safeBaseUrl = sanitizeTerminalText(config.baseUrl);
  const connectionLine = `${styler.bold(safeConnName)} (${safeBaseUrl})`;
  let question;
  const entries = [["Подключение", connectionLine]];
  if (operationId === "objects.delete") {
    progress.update("Проверка объекта…");
    const getArgs = {};
    if (typeof args.id === "string") getArgs.id = args.id;
    if (typeof args.url === "string") getArgs.url = args.url;
    if (typeof args.type === "string") getArgs.type = args.type;
    if (typeof args.dbName === "string") getArgs.dbName = args.dbName;
    let fetched;
    try {
      fetched = await runtime.call("objects.get", getArgs);
    } catch {
    }
    await progress.stop();
    const preview = extractObjectPreview(fetched, args);
    const safeType = preview.type ? sanitizeTerminalText(preview.type) : void 0;
    const safeId = preview.id ? sanitizeTerminalText(preview.id) : void 0;
    const safeUrl = preview.url ? sanitizeTerminalText(preview.url) : void 0;
    const label = [safeType, safeId].filter(Boolean).join(" · ");
    entries.push(["Объект", label ? styler.bold(label) : safeUrl ?? "—"]);
    if (safeUrl && label) entries.push(["Адрес", safeUrl]);
    if (typeof args.dbName === "string") entries.push(["База", sanitizeTerminalText(args.dbName)]);
    for (const [fieldLabel, value] of preview.fields) entries.push([fieldLabel, value]);
    question = "Удалить объект без возможности восстановления? [y/N] ";
  } else if (operationId === "files.delete") {
    progress.update("Проверка файла…");
    const url = typeof args.url === "string" ? args.url : "";
    let existsResult;
    if (url) {
      try {
        existsResult = await runtime.call("files.exists", { url });
      } catch {
      }
    }
    await progress.stop();
    entries.push(["Файл", styler.bold(sanitizeTerminalText(url))]);
    if (existsResult?.ok && isRecord3(existsResult.data)) {
      if (existsResult.data.exists === true) {
        const sizeRaw = typeof existsResult.data.bytes === "number" ? existsResult.data.bytes : typeof existsResult.data.sizeBytes === "number" ? existsResult.data.sizeBytes : void 0;
        const typeRaw = typeof existsResult.data.type === "string" ? sanitizeTerminalText(existsResult.data.type) : void 0;
        const details = [
          "существует",
          typeRaw,
          sizeRaw === void 0 ? void 0 : formatBytes(sizeRaw)
        ].filter(Boolean);
        entries.push(["Сведения", details.join(", ")]);
      } else if (existsResult.data.exists === false) {
        entries.push(["Сведения", styler.yellow("не найден на сервере")]);
      }
    }
    question = "Удалить файл на сервере? [y/N] ";
  } else if (operationId === "agents.cancel") {
    await progress.stop();
    const threadId = typeof args.threadId === "string" ? args.threadId : "";
    const roleUID = typeof args.roleUID === "string" ? args.roleUID : "";
    entries.push(["Поток", styler.bold(sanitizeTerminalText(threadId))]);
    if (roleUID) entries.push(["Роль", sanitizeTerminalText(roleUID)]);
    entries.push(["Внимание", styler.yellow("Уже сделанные изменения не откатываются.")]);
    question = "Остановить агента сервера? [y/N] ";
  } else {
    await progress.stop();
    const trackingId = typeof args.trackingId === "string" ? args.trackingId : "";
    entries.push(["Задача", styler.bold(sanitizeTerminalText(trackingId))]);
    entries.push(["Внимание", styler.yellow("Уже сделанные изменения не откатываются.")]);
    question = "Остановить фоновую задачу? [y/N] ";
  }
  await io.writeError(renderPromptLines(entries, io));
  const confirmed = await io.confirm(question);
  if (!confirmed) {
    await io.writeError("Отменено.\n");
    return false;
  }
  return true;
}
function parseIsoTimestampMs(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:[.,](\d+))?/.exec(value.trim());
  if (!match) return void 0;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    return void 0;
  }
  const fracMs = match[7] ? Math.round(Number(`0.${match[7]}`) * 1e3) : 0;
  const ms = Date.UTC(year, month - 1, day, hour, minute, second) + fracMs;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return void 0;
  }
  return ms;
}
function parseTimeOfDaySec(value) {
  const match = /(?:^|T)(\d{2}):(\d{2}):(\d{2})(?:[.,](\d+))?/.exec(value.trim());
  if (!match) return void 0;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3]);
  if (hour > 23 || minute > 59 || second > 59) return void 0;
  const frac = match[4] ? Number(`0.${match[4]}`) : 0;
  return hour * 3600 + minute * 60 + second + frac;
}
function formatUtcDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}
function extractDateFromFileName(name) {
  const match = /(\d{4})[-_](\d{2})[-_](\d{2})/.exec(name);
  if (!match) return void 0;
  const candidate = `${match[1]}-${match[2]}-${match[3]}`;
  return parseIsoTimestampMs(`${candidate}T00:00:00`) !== void 0 ? candidate : void 0;
}
function parseDateAndTimeMs(dateHint, time) {
  const timeMatch = /(?:^|T)(\d{2}:\d{2}:\d{2}(?:[.,]\d+)?)/.exec(time.trim());
  if (!timeMatch) return void 0;
  return parseIsoTimestampMs(`${dateHint}T${timeMatch[1]}`);
}
function filterLogEventsByInterval(events, startedAt, finishedAt, toleranceSec = AGENT_LOG_TOLERANCE_SEC, fileDateHint) {
  let startSec = parseTimeOfDaySec(startedAt);
  if (startSec === void 0) return [];
  const startMs = parseIsoTimestampMs(startedAt);
  if (finishedAt.trim() === "") {
    const minMs2 = startMs !== void 0 ? startMs - toleranceSec * 1e3 : void 0;
    const lo2 = Math.max(0, startSec - toleranceSec);
    return events.filter((event) => {
      if (event.time === void 0) return false;
      const eventDate = event.dateHint ?? fileDateHint;
      if (minMs2 !== void 0 && eventDate !== void 0) {
        const eventMs = parseDateAndTimeMs(eventDate, event.time);
        if (eventMs !== void 0) return eventMs >= minMs2;
      }
      const t = parseTimeOfDaySec(event.time);
      return t !== void 0 && t >= lo2;
    });
  }
  let endSec = parseTimeOfDaySec(finishedAt);
  if (endSec === void 0) return [];
  const endMs = parseIsoTimestampMs(finishedAt);
  const hasFullRange = startMs !== void 0 && endMs !== void 0;
  const minMs = hasFullRange ? Math.min(startMs, endMs) - toleranceSec * 1e3 : void 0;
  const maxMs = hasFullRange ? Math.max(startMs, endMs) + toleranceSec * 1e3 : void 0;
  if (hasFullRange && endMs < startMs) {
    [startSec, endSec] = [endSec, startSec];
  }
  const fullDayNoDate = hasFullRange && maxMs - minMs >= DAY_SECONDS * 1e3 || (endSec - startSec + DAY_SECONDS) % DAY_SECONDS + 2 * toleranceSec >= DAY_SECONDS;
  const lo = ((startSec - toleranceSec) % DAY_SECONDS + DAY_SECONDS) % DAY_SECONDS;
  const hi = ((endSec + toleranceSec) % DAY_SECONDS + DAY_SECONDS) % DAY_SECONDS;
  return events.filter((event) => {
    if (event.time === void 0) return false;
    const eventDate = event.dateHint ?? fileDateHint;
    if (hasFullRange && eventDate !== void 0) {
      const eventMs = parseDateAndTimeMs(eventDate, event.time);
      if (eventMs !== void 0) {
        return eventMs >= minMs && eventMs <= maxMs;
      }
    }
    const t = parseTimeOfDaySec(event.time);
    if (t === void 0) return false;
    if (fullDayNoDate) return true;
    return lo <= hi ? t >= lo && t <= hi : t >= lo || t <= hi;
  });
}
async function finalizeAttachedLogs(agentResult, logs, runtime, config, hasOutputFile) {
  const base = isRecord3(agentResult.data) ? agentResult.data : {};
  const combinedData = { ...base, logs };
  if (!hasOutputFile) {
    const bytes = Buffer.byteLength(JSON.stringify(combinedData), "utf8");
    if (bytes > config.outputLimitBytes) {
      const put = runtime.results?.put?.bind(runtime.results);
      const store = put ? { put } : new ResultStore(config);
      const packed = await new ReplyPacker(config, store).success(
        agentResult.meta.operationId,
        performance.now(),
        combinedData,
        true
      );
      return {
        ...packed,
        meta: {
          ...packed.meta,
          durationMs: agentResult.meta.durationMs
        }
      };
    }
  }
  return {
    ...agentResult,
    data: combinedData
  };
}
function selectLogFilesForInterval(rawFiles, startedAt, finishedAt) {
  const candidates = [];
  for (const item of rawFiles) {
    if (!isRecord3(item) || typeof item.name !== "string" || !item.name) continue;
    const dateHint = (typeof item.date === "string" && item.date ? item.date : void 0) ?? (typeof item.dateHint === "string" && item.dateHint ? item.dateHint : void 0) ?? extractDateFromFileName(item.name);
    candidates.push({
      name: item.name,
      ...dateHint === void 0 ? {} : { dateHint }
    });
  }
  if (candidates.length === 0) return [];
  const startMs = parseIsoTimestampMs(startedAt);
  if (startMs === void 0) return [candidates[0]];
  const endMs = finishedAt.trim() === "" ? void 0 : parseIsoTimestampMs(finishedAt);
  const minMs = (endMs === void 0 ? startMs : Math.min(startMs, endMs)) - AGENT_LOG_TOLERANCE_SEC * 1e3;
  const maxMs = endMs === void 0 ? void 0 : Math.max(startMs, endMs) + AGENT_LOG_TOLERANCE_SEC * 1e3;
  const startDate = formatUtcDate(minMs);
  const endDate = maxMs === void 0 ? void 0 : formatUtcDate(maxMs);
  const dated = candidates.filter((file) => file.dateHint !== void 0);
  if (dated.length === 0) return [candidates[0]];
  const inRange = dated.filter(
    (file) => file.dateHint >= startDate && (endDate === void 0 || file.dateHint <= endDate)
  );
  if (inRange.length === 0) return [candidates[0]];
  inRange.sort(
    (left, right) => left.dateHint.localeCompare(right.dateHint) || left.name.localeCompare(right.name)
  );
  return inRange.slice(-MAX_AGENT_LOG_FILES);
}
async function attachAgentRunLogs(agentResult, runtime, config, progress, hasOutputFile = false) {
  if (!agentResult.ok || !isRecord3(agentResult.data) || agentResult.meta.truncated === true) {
    return agentResult;
  }
  const started = agentResult.data.started === true;
  const startedAt = typeof agentResult.data.startedAt === "string" ? agentResult.data.startedAt : "";
  const finishedAt = typeof agentResult.data.finishedAt === "string" ? agentResult.data.finishedAt : "";
  const logType = started ? "xhttp" : "agent";
  progress.update(`Чтение лога ${logType}…`);
  let resolvedFile;
  try {
    const listed = await runtime.call("logs.list", { type: logType, limit: 10 });
    if (!listed.ok) {
      const translated = errorInFrontendTerms(listed, "cli").error;
      const code = translated?.code ?? "LOG_LIST_FAILED";
      const message = translated?.message ?? "Не удалось получить список файлов лога.";
      return await finalizeAttachedLogs(
        agentResult,
        {
          type: logType,
          events: [],
          warning: `Не удалось получить список логов ${logType} [${code}]: ${message}`,
          error: { code, message }
        },
        runtime,
        config,
        hasOutputFile
      );
    }
    const listedRaw = listed.meta.truncated === true ? await readStoredJson(runtime, listed) : listed.data;
    const rawFiles = isRecord3(listedRaw) && Array.isArray(listedRaw.files) ? listedRaw.files : [];
    const targets = selectLogFilesForInterval(rawFiles, startedAt, finishedAt);
    if (targets.length === 0) {
      return await finalizeAttachedLogs(
        agentResult,
        {
          type: logType,
          events: [],
          warning: `Файлы лога типа "${logType}" на сервере не найдены.`,
          error: { code: "LOG_NOT_FOUND", message: `Файлы лога типа "${logType}" не найдены.` }
        },
        runtime,
        config,
        hasOutputFile
      );
    }
    const tailBytes = Math.min(AGENT_LOG_TAIL_BYTES, maxLogTailBytes(config.maxResponseBytes));
    const collected = [];
    const readFileNames = [];
    const warnings = [];
    let firstError;
    for (const target of targets) {
      resolvedFile = target.name;
      const readRes = await runtime.call("logs.read", { file: target.name, tailBytes });
      if (!readRes.ok) {
        const translated = errorInFrontendTerms(readRes, "cli").error;
        const code = translated?.code ?? "LOG_READ_FAILED";
        const message = translated?.message ?? "Не удалось прочитать файл лога.";
        firstError ??= { code, message };
        warnings.push(`Не удалось прочитать лог ${target.name} [${code}]: ${message}`);
        continue;
      }
      const raw = readRes.meta.truncated === true ? await readStoredJson(runtime, readRes) : readRes.data;
      const readData = isRecord3(raw) ? raw : {};
      const text = typeof readData.text === "string" ? readData.text : "";
      const fileName = typeof readData.file === "string" ? readData.file : target.name;
      const tailOnly = readData.tailOnly === true;
      const effectiveDateHint = target.dateHint ?? extractDateFromFileName(fileName);
      readFileNames.push(fileName);
      const allEvents = parseLogEvents(text, effectiveDateHint, tailOnly);
      const matched = filterLogEventsByInterval(
        allEvents,
        startedAt,
        finishedAt,
        AGENT_LOG_TOLERANCE_SEC,
        effectiveDateHint
      );
      for (const event of matched) collected.push(logEntry(event));
    }
    const primaryFile = readFileNames.length > 0 ? readFileNames[readFileNames.length - 1] : targets[targets.length - 1].name;
    const attachment = {
      type: logType,
      file: primaryFile,
      ...readFileNames.length > 1 ? { files: readFileNames } : {},
      events: collected,
      ...warnings.length > 0 ? { warning: warnings.join(" ") } : {},
      ...firstError && readFileNames.length === 0 ? { error: firstError } : {}
    };
    return await finalizeAttachedLogs(agentResult, attachment, runtime, config, hasOutputFile);
  } catch (error) {
    const code = error instanceof HcmError ? error.code : "LOG_READ_FAILED";
    const message = error instanceof HcmError ? error.message : `Не удалось прочитать лог ${resolvedFile ?? logType}.`;
    return await finalizeAttachedLogs(
      agentResult,
      {
        type: logType,
        ...resolvedFile === void 0 ? {} : { file: resolvedFile },
        events: [],
        warning: `Не удалось прочитать лог ${resolvedFile ?? logType} [${code}]: ${message}`,
        error: { code, message }
      },
      runtime,
      config,
      hasOutputFile
    );
  }
}

// src/cli/config-commands.ts
function configPathOption(args) {
  return stringOption(args, "config") ?? process.env.WTCTL_CONFIG ?? defaultConfigPath();
}
function canonicalAncestor(path) {
  const tail = [];
  let current = path;
  for (; ; ) {
    try {
      const real = realpathSync(current);
      return tail.length ? join(real, ...tail.reverse()) : real;
    } catch {
      const parent = dirname2(current);
      if (parent === current) return path;
      tail.push(basename2(current));
      current = parent;
    }
  }
}
function canonicalPath(path) {
  let current = resolve3(path);
  for (let hop = 0; hop < 32; hop++) {
    try {
      return realpathSync(current);
    } catch {
      try {
        if (lstatSync(current).isSymbolicLink()) {
          current = resolve3(canonicalAncestor(dirname2(current)), readlinkSync(current));
          continue;
        }
      } catch {
      }
      return canonicalAncestor(current);
    }
  }
  return current;
}
function sameLocalPath(first, second) {
  const a = canonicalPath(first);
  const b = canonicalPath(second);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}
function rejectOutputOnConfigPath(args, configPath) {
  const output = stringOption(args, "output");
  if (output !== void 0 && sameLocalPath(output, configPath))
    throw new CliInputError(
      "--output не может указывать на сам файл подключений: это перезапишет подключения ответом команды."
    );
}
async function saveConfigDocument(io, path, beforeText, document) {
  const nextText = `${JSON.stringify(document, null, 2)}
`;
  if (Buffer.byteLength(nextText, "utf8") > MAX_CONFIG_BYTES)
    throw new HcmError("INVALID_CONFIG", "Файл подключений больше 1 МиБ.");
  if (io.writeFileIfUnchanged) {
    await io.writeFileIfUnchanged(path, beforeText, nextText);
    return;
  }
  const conflict = () => new HcmError(
    "CONFIG_CONFLICT",
    "Файл подключений изменился за время выполнения команды.",
    "Повторить команду, чтобы не перезаписать чужую правку."
  );
  if (beforeText === void 0) {
    let exists = true;
    try {
      await io.readFile(path, MAX_CONFIG_BYTES);
    } catch (error) {
      if (error.code === "ENOENT") exists = false;
      else throw error;
    }
    if (exists) throw conflict();
  } else {
    let currentText;
    try {
      currentText = await io.readFile(path, MAX_CONFIG_BYTES);
    } catch (error) {
      if (error instanceof CliInputError || error.code === "ENOENT")
        throw conflict();
      throw error;
    }
    if (currentText !== beforeText) throw conflict();
  }
  await io.writeFile(path, nextText);
}
async function readExistingConfig(path, io) {
  let text;
  try {
    text = await io.readFile(path, MAX_CONFIG_BYTES);
  } catch (error) {
    const { code, syscall } = error ?? {};
    if (code === "ENOENT")
      throw new HcmError(
        "INVALID_CONFIG",
        `Файл подключений не найден: ${path}.`,
        "Нужно проверить --config и WTCTL_CONFIG или создать файл: wtctl config init."
      );
    throw syscall === void 0 ? error : new CliInputError(`Файл подключений не открывается для чтения: ${resolve3(path)}.`);
  }
  return { text, document: parseConfiguration(text, path) };
}
async function initConnection(args, io) {
  exactPositionals(args, 2);
  const path = configPathOption(args);
  rejectOutputOnConfigPath(args, path);
  const value = async (option, question) => {
    const given = stringOption(args, option);
    if (given !== void 0) return given;
    if (!io.prompt)
      throw new CliInputError(
        `Не задан --${option}.`,
        "В терминале команда сама спросит недостающее. Без терминала нужно задать --url, --username и пароль: --password-stdin или --password-env ИМЯ."
      );
    const answer = (await io.prompt(question)).trim();
    if (!answer) throw new CliInputError("Значение не введено.");
    return answer;
  };
  const baseUrl = await value("url", "Адрес сервера, например http://localhost:8088: ");
  const username = await value("username", "Имя пользователя: ");
  const passwordEnv = stringOption(args, "password-env");
  let password;
  if (passwordEnv !== void 0) {
    if (args.options["password-stdin"])
      throw new CliInputError("Нужно выбрать --password-stdin или --password-env.");
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(passwordEnv))
      throw new CliInputError("--password-env: это не имя переменной окружения.");
  } else {
    if (args.options["password-stdin"])
      password = (await io.readStdin(65536)).replace(/\r?\n$/, "");
    else if (io.prompt) password = await io.prompt("Пароль: ", true);
    else
      throw new CliInputError(
        "Не задан пароль.",
        "Нужно передать его через --password-stdin или назвать переменную с паролем: --password-env ИМЯ."
      );
    if (!password || /[\r\n\0]/.test(password))
      throw new CliInputError("Пароль должен быть одной непустой строкой.");
  }
  let beforeText;
  let document = {};
  try {
    beforeText = await io.readFile(path, MAX_CONFIG_BYTES);
    document = parseConfiguration(beforeText, path);
  } catch (error) {
    const { code, syscall } = error ?? {};
    if (code !== "ENOENT")
      throw syscall === void 0 ? error : new CliInputError(`Файл подключений не открывается для чтения: ${resolve3(path)}.`);
  }
  const name = stringOption(args, "name") ?? "default";
  const write = args.options["allow-write"] === true;
  const execute = args.options["allow-execute"] === true;
  const next = withConnection(
    document,
    {
      name,
      baseUrl,
      username,
      ...optional("password", password),
      ...optional("passwordEnv", passwordEnv),
      write,
      execute
    },
    args.options.force === true
  );
  await saveConfigDocument(io, path, beforeText, next);
  const selected = next.defaultConnection === name;
  const check = passwordEnv !== void 0 && !process.env[passwordEnv] ? `Переменная ${passwordEnv} сейчас не задана, без неё подключение не откроется. Задать её и проверить подключение` : "Проверить подключение";
  const explicitConfig = stringOption(args, "config");
  const quoteArg = (value2) => /[\s"]/.test(value2) ? `"${value2.replaceAll('"', '\\"')}"` : value2;
  const configFlag = explicitConfig !== void 0 ? `--config ${quoteArg(explicitConfig)} ` : "";
  const envConn = process.env.WTCTL_CONNECTION?.trim();
  const needsConnectionFlag = !selected || envConn !== void 0 && envConn !== "" && envConn !== name;
  return frontendResult("cli.config.init", name, {
    path,
    connection: name,
    defaultConnection: next.defaultConnection,
    permissions: { write, execute },
    next: `${check}: wtctl ${configFlag}${needsConnectionFlag ? `--connection ${quoteArg(name)} ` : ""}check`
  });
}
async function listConfigConnections(args, io) {
  rejectPasswordStdin(args, "Ввод пароля не нужен для config list.");
  exactPositionals(args, 2);
  const path = configPathOption(args);
  rejectOutputOnConfigPath(args, path);
  const { document } = await readExistingConfig(path, io);
  return frontendResult("cli.config.list", "unselected", {
    path,
    ...listConnections(document)
  });
}
function booleanValueOption(args, name) {
  const value = stringOption(args, name);
  if (value === void 0) return void 0;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new CliInputError(`--${name}: нужно true или false.`);
}
async function setConfigConnection(args, io) {
  if (stringOption(args, "output") !== void 0)
    throw new CliInputError(
      "wtctl config set не принимает --output: команда изменяет файл подключений, путь файла задаёт --config."
    );
  rejectPasswordStdin(
    args,
    "--password-stdin не нужен для config set: учётные данные меняет wtctl config init --force."
  );
  exactPositionals(args, 2, 3);
  const positionalName = args.positionals[2];
  const optionName = stringOption(args, "connection");
  if (positionalName !== void 0 && optionName !== void 0)
    throw new CliInputError("Имя подключения задано и аргументом, и в --connection.");
  const name = positionalName ?? optionName ?? process.env.WTCTL_CONNECTION;
  const patch = {
    ...optional("baseUrl", stringOption(args, "url")),
    ...optional("write", booleanValueOption(args, "write")),
    ...optional("execute", booleanValueOption(args, "execute")),
    ...args.options.default === true ? { makeDefault: true } : {},
    ...optional("timeoutMs", stringOption(args, "timeout-ms")),
    ...optional("maxResponseBytes", stringOption(args, "max-response-bytes")),
    ...optional("outputLimitBytes", stringOption(args, "output-limit-bytes")),
    ...optional("runtimeDir", stringOption(args, "runtime-dir")),
    ...optional("resultsMaxBytes", stringOption(args, "results-max-bytes")),
    ...optional("resultsMaxAgeDays", stringOption(args, "results-max-age-days")),
    ...optional("journalMaxBytes", stringOption(args, "journal-max-bytes"))
  };
  if (Object.keys(patch).length === 0)
    throw new CliInputError(
      "Не указано, что изменить: например --write true, --execute false, --default или --timeout-ms."
    );
  const path = configPathOption(args);
  const { text: beforeText, document } = await readExistingConfig(path, io);
  const updated = updateConnection(document, name, patch, path);
  await saveConfigDocument(io, path, beforeText, updated.document);
  return frontendResult("cli.config.set", updated.connection.name, {
    path,
    ...updated.defaultConnection === void 0 ? {} : { defaultConnection: updated.defaultConnection },
    connection: updated.connection
  });
}
async function useConfigConnection(args, io) {
  if (stringOption(args, "output") !== void 0)
    throw new CliInputError(
      "wtctl config use не принимает --output: команда изменяет файл подключений, путь файла задаёт --config."
    );
  rejectPasswordStdin(
    args,
    "--password-stdin не нужен для config use: команда только переключает подключение по умолчанию."
  );
  exactPositionals(args, 3);
  const name = requirePositional(args, 2, "аргумент ИМЯ подключения");
  const path = configPathOption(args);
  const { text: beforeText, document } = await readExistingConfig(path, io);
  const updated = updateConnection(document, name, { makeDefault: true }, path);
  await saveConfigDocument(io, path, beforeText, updated.document);
  return frontendResult("cli.config.use", updated.connection.name, {
    path,
    defaultConnection: updated.defaultConnection ?? updated.connection.name,
    connection: updated.connection
  });
}
async function removeConfigConnection(args, io) {
  if (stringOption(args, "output") !== void 0)
    throw new CliInputError(
      "wtctl config remove не принимает --output: команда изменяет файл подключений, путь файла задаёт --config."
    );
  rejectPasswordStdin(
    args,
    "--password-stdin не нужен для config remove: команда удаляет подключение из файла."
  );
  exactPositionals(args, 3);
  const name = requirePositional(args, 2, "аргумент ИМЯ подключения");
  const path = configPathOption(args);
  const { text: beforeText, document } = await readExistingConfig(path, io);
  const removed = removeConnection(document, name, path);
  if (args.options.yes !== true && isInteractiveConfirm(io)) {
    const styler = createStyler(resolveColor(io, "stderr"));
    const safeName = sanitizeTerminalText(removed.removed.name);
    const safeUrl = sanitizeTerminalText(removed.removed.baseUrl);
    const safePath = sanitizeTerminalText(path);
    const lines = [
      `${styler.dim("Подключение:")}  ${styler.bold(safeName)} (${safeUrl})`,
      `${styler.dim("Файл:")}         ${safePath}`
    ];
    if (removed.removed.default) {
      lines.push(
        removed.defaultConnection !== void 0 ? `${styler.dim("По умолчанию:")} станет ${sanitizeTerminalText(removed.defaultConnection)}` : styler.yellow("Это последнее подключение в файле.")
      );
    }
    await io.writeError(`${lines.join("\n")}
`);
    const confirmed = await io.confirm("Удалить подключение из файла? [y/N] ");
    if (!confirmed) {
      await io.writeError("Отменено.\n");
      return { kind: "cancelled", exitCode: 1 };
    }
  }
  await saveConfigDocument(io, path, beforeText, removed.document);
  return {
    kind: "result",
    result: frontendResult("cli.config.remove", removed.removed.name, {
      path,
      removed: removed.removed,
      ...removed.defaultConnection === void 0 ? {} : { defaultConnection: removed.defaultConnection },
      remaining: removed.remaining
    })
  };
}
async function configPathCommand(args, io) {
  rejectPasswordStdin(args, "Ввод пароля не нужен для config path.");
  exactPositionals(args, 2);
  const path = configPathOption(args);
  rejectOutputOnConfigPath(args, path);
  let exists = true;
  try {
    await io.readFile(path, MAX_CONFIG_BYTES);
  } catch (error) {
    exists = error.code !== "ENOENT";
  }
  return frontendResult("cli.config.path", "unselected", { path, exists });
}
function configExampleCommand(args) {
  rejectPasswordStdin(args, "Ввод пароля не нужен для примера файла подключений.");
  exactPositionals(args, 2);
  return frontendResult("cli.config.example", "unselected", configExample());
}
async function runConfigCommand(action, args, io) {
  if (action === "init") return { kind: "result", result: await initConnection(args, io) };
  if (action === "list") return { kind: "result", result: await listConfigConnections(args, io) };
  if (action === "set") return { kind: "result", result: await setConfigConnection(args, io) };
  if (action === "use") return { kind: "result", result: await useConfigConnection(args, io) };
  if (action === "remove" || action === "rm") return removeConfigConnection(args, io);
  if (action === "path") return { kind: "result", result: await configPathCommand(args, io) };
  if (action === "example") return { kind: "result", result: configExampleCommand(args) };
  return void 0;
}

// src/cli/deferred-runtime.ts
var DeferredRuntime = class {
  constructor(load, create, firstError, setup) {
    this.load = load;
    this.create = create;
    this.setup = setup;
    this.#error = firstError;
  }
  #runtime;
  /** Чтение настроек, которое идёт сейчас: одновременные первые вызовы ждут одно, а не читают свои. */
  #opening;
  #error;
  #closed = false;
  get results() {
    return this.#runtime?.results;
  }
  async ready() {
    if (this.#runtime || this.#closed) return this.#runtime;
    this.#opening ??= (async () => this.#runtime = this.create(await this.load()))().finally(
      () => {
        this.#opening = void 0;
      }
    );
    try {
      return await this.#opening;
    } catch (error) {
      if (!(error instanceof HcmError)) throw error;
      this.#error = error;
      return void 0;
    }
  }
  listOperations(filter) {
    return this.#runtime ? this.#runtime.listOperations(filter) : listHcmOperations(filter);
  }
  describe(id) {
    return this.#runtime ? this.#runtime.describe(id) : describeHcmOperation(id);
  }
  getOperationEffect(id, args) {
    return this.#runtime ? this.#runtime.getOperationEffect(id, args) : operationEffect(id, args);
  }
  async call(id, args) {
    const runtime = await this.ready();
    if (runtime) return runtime.call(id, args);
    const error = this.#error.toJSON();
    return {
      ok: false,
      error: this.setup && error.code === "NOT_CONFIGURED" ? { ...error, hint: `${error.hint} ${this.setup}` } : error,
      meta: { operationId: id, connection: "unconfigured", durationMs: 0 }
    };
  }
  async close() {
    this.#closed = true;
    this.#error = new HcmError("RUNTIME_CLOSED", "Подключение уже закрыто.");
    await this.#opening?.catch(() => void 0);
    await this.#runtime?.close();
  }
};

// src/cli/edit.ts
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdtemp, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as join2 } from "node:path";

// src/cli/diff.ts
var MAX_LCS_LINES = 4e3;
var MAX_LCS_CELLS = 2e6;
var MAX_COMPACT_SECTION_LINES = 40;
var MAX_DIFF_LINE_CHARS = 500;
var MAX_DIFF_TOTAL_CHARS = 32 * 1024;
function splitTextLines(text) {
  if (text === "") return [];
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}
function sanitizeDiffLine(line) {
  const sanitized = line.split("	").map(sanitizeTerminalText).join("	");
  if (sanitized.length <= MAX_DIFF_LINE_CHARS) return sanitized;
  const omitted = sanitized.length - MAX_DIFF_LINE_CHARS;
  return `${sanitized.slice(0, MAX_DIFF_LINE_CHARS)}… (ещё ${omitted} знаков)`;
}
function finalizeDiffOutput(lines, styler) {
  const kept = [];
  let totalChars = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (kept.length > 0 && totalChars + line.length + 1 > MAX_DIFF_TOTAL_CHARS) {
      kept.push(styler.dim(`… diff сокращён (показано ${kept.length} из ${lines.length} строк) …`));
      break;
    }
    kept.push(line);
    totalChars += line.length + 1;
  }
  return `${kept.join("\n")}
`;
}
function buildLcsOps(midBefore, midAfter, oldBase, newBase) {
  const n = midBefore.length;
  const m = midAfter.length;
  const cols = m + 1;
  const dp = new Uint32Array((n + 1) * cols);
  for (let i2 = n - 1; i2 >= 0; i2--) {
    const rowOffset = i2 * cols;
    const nextRowOffset = (i2 + 1) * cols;
    const leftLine = midBefore[i2];
    for (let j2 = m - 1; j2 >= 0; j2--) {
      if (leftLine === midAfter[j2]) {
        dp[rowOffset + j2] = dp[nextRowOffset + j2 + 1] + 1;
      } else {
        const down = dp[nextRowOffset + j2];
        const right = dp[rowOffset + j2 + 1];
        dp[rowOffset + j2] = down >= right ? down : right;
      }
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (midBefore[i] === midAfter[j]) {
      ops.push({ kind: "equal", text: midBefore[i], oldNo: oldBase + i, newNo: newBase + j });
      i++;
      j++;
    } else if (dp[(i + 1) * cols + j] >= dp[i * cols + j + 1]) {
      ops.push({ kind: "delete", text: midBefore[i], oldNo: oldBase + i, newNo: newBase + j });
      i++;
    } else {
      ops.push({ kind: "insert", text: midAfter[j], oldNo: oldBase + i, newNo: newBase + j });
      j++;
    }
  }
  while (i < n) {
    ops.push({ kind: "delete", text: midBefore[i], oldNo: oldBase + i, newNo: newBase + j });
    i++;
  }
  while (j < m) {
    ops.push({ kind: "insert", text: midAfter[j], oldNo: oldBase + i, newNo: newBase + j });
    j++;
  }
  return ops;
}
function renderCompactRange(beforeLines, afterLines, prefixLen, suffixLen, styler, contextLines) {
  const midBefore = beforeLines.slice(prefixLen, beforeLines.length - suffixLen);
  const midAfter = afterLines.slice(prefixLen, afterLines.length - suffixLen);
  const ctxBeforeStart = Math.max(0, prefixLen - contextLines);
  const ctxBefore = beforeLines.slice(ctxBeforeStart, prefixLen);
  const suffixStartBefore = beforeLines.length - suffixLen;
  const ctxAfter = beforeLines.slice(
    suffixStartBefore,
    suffixStartBefore + Math.min(suffixLen, contextLines)
  );
  const oldCount = ctxBefore.length + midBefore.length + ctxAfter.length;
  const newCount = ctxBefore.length + midAfter.length + ctxAfter.length;
  const oldStart = oldCount === 0 ? prefixLen : ctxBeforeStart + 1;
  const newStart = newCount === 0 ? prefixLen : ctxBeforeStart + 1;
  const out = [styler.cyan(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`)];
  for (const line of ctxBefore) out.push(`  ${sanitizeDiffLine(line)}`);
  const pushSection = (items, prefix, paint, omittedLabel) => {
    if (items.length <= MAX_COMPACT_SECTION_LINES) {
      for (const line of items) out.push(paint(`${prefix}${sanitizeDiffLine(line)}`));
      return;
    }
    const headCount = Math.floor(MAX_COMPACT_SECTION_LINES * 0.75);
    const tailCount = MAX_COMPACT_SECTION_LINES - headCount;
    for (let i = 0; i < headCount; i++) {
      out.push(paint(`${prefix}${sanitizeDiffLine(items[i])}`));
    }
    out.push(
      styler.dim(`  … ещё ${items.length - headCount - tailCount} ${omittedLabel} пропущено …`)
    );
    for (let i = items.length - tailCount; i < items.length; i++) {
      out.push(paint(`${prefix}${sanitizeDiffLine(items[i])}`));
    }
  };
  pushSection(midBefore, "- ", styler.red, "строк удалено");
  pushSection(midAfter, "+ ", styler.green, "строк добавлено");
  for (const line of ctxAfter) out.push(`  ${sanitizeDiffLine(line)}`);
  return finalizeDiffOutput(out, styler);
}
function renderLineDiff(before, after, styler, contextLines = 3) {
  if (before === after) return "";
  const beforeLines = splitTextLines(before);
  const afterLines = splitTextLines(after);
  let prefixLen = 0;
  const minLen = Math.min(beforeLines.length, afterLines.length);
  while (prefixLen < minLen && beforeLines[prefixLen] === afterLines[prefixLen]) {
    prefixLen++;
  }
  let suffixLen = 0;
  const maxSuffix = minLen - prefixLen;
  while (suffixLen < maxSuffix && beforeLines[beforeLines.length - 1 - suffixLen] === afterLines[afterLines.length - 1 - suffixLen]) {
    suffixLen++;
  }
  const midBefore = beforeLines.slice(prefixLen, beforeLines.length - suffixLen);
  const midAfter = afterLines.slice(prefixLen, afterLines.length - suffixLen);
  if (midBefore.length === 0 && midAfter.length === 0) {
    return `${styler.dim("Изменились только переводы строк или перевод строки в конце файла.")}
`;
  }
  if (beforeLines.length > MAX_LCS_LINES || afterLines.length > MAX_LCS_LINES || midBefore.length * midAfter.length > MAX_LCS_CELLS) {
    return renderCompactRange(beforeLines, afterLines, prefixLen, suffixLen, styler, contextLines);
  }
  const ctxBeforeStart = Math.max(0, prefixLen - contextLines);
  const ops = [];
  for (let i = ctxBeforeStart; i < prefixLen; i++) {
    ops.push({ kind: "equal", text: beforeLines[i], oldNo: i + 1, newNo: i + 1 });
  }
  ops.push(...buildLcsOps(midBefore, midAfter, prefixLen + 1, prefixLen + 1));
  const suffixOldStart = beforeLines.length - suffixLen;
  const suffixNewStart = afterLines.length - suffixLen;
  const ctxAfterCount = Math.min(suffixLen, contextLines);
  for (let k = 0; k < ctxAfterCount; k++) {
    ops.push({
      kind: "equal",
      text: beforeLines[suffixOldStart + k],
      oldNo: suffixOldStart + k + 1,
      newNo: suffixNewStart + k + 1
    });
  }
  const ranges = [];
  for (let idx = 0; idx < ops.length; idx++) {
    if (ops[idx].kind === "equal") continue;
    const start = Math.max(0, idx - contextLines);
    const end = Math.min(ops.length - 1, idx + contextLines);
    const last = ranges.at(-1);
    if (last && start <= last.end + 1) {
      last.end = Math.max(last.end, end);
    } else {
      ranges.push({ start, end });
    }
  }
  const out = [];
  for (const { start, end } of ranges) {
    const slice = ops.slice(start, end + 1);
    let oldCount = 0;
    let newCount = 0;
    let firstOld;
    let firstNew;
    for (const op of slice) {
      if (op.kind !== "insert") {
        firstOld ??= op.oldNo;
        oldCount++;
      }
      if (op.kind !== "delete") {
        firstNew ??= op.newNo;
        newCount++;
      }
    }
    const oldStart = firstOld ?? Math.max(0, slice[0].oldNo - 1);
    const newStart = firstNew ?? Math.max(0, slice[0].newNo - 1);
    out.push(styler.cyan(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`));
    for (const op of slice) {
      const safe = sanitizeDiffLine(op.text);
      if (op.kind === "equal") out.push(`  ${safe}`);
      else if (op.kind === "delete") out.push(styler.red(`- ${safe}`));
      else out.push(styler.green(`+ ${safe}`));
    }
  }
  return finalizeDiffOutput(out, styler);
}

// src/cli/edit.ts
var LARGE_FILE_WRITE_THRESHOLD_BYTES = 512 * 1024;
var WINDOWS_RESERVED_NAME_RE = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i;
var VALID_PATCH_SEGMENT_RE = /^[A-Za-z_][A-Za-z0-9_:-]*$/;
var PATCH_ID_KEY_RE = /^(?:0x[0-9a-f]{1,16}|[1-9]\d{0,19})$/i;
var MAX_TEMP_FILENAME_CHARS = 80;
var MAX_TEMP_EXTENSION_CHARS = 16;
function isRecord4(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isPlainObject3(value) {
  if (!isRecord4(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
function setOwnProperty2(target, key, value) {
  if (key === "__proto__") {
    Object.defineProperty(target, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true
    });
  } else {
    target[key] = value;
  }
}
function sha256Text(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
function safeTempFileName(raw, fallback = "file.txt") {
  const withoutQuery = raw.split(/[?#]/, 1)[0] ?? "";
  const slashIndex = Math.max(withoutQuery.lastIndexOf("/"), withoutQuery.lastIndexOf("\\"));
  const segment = slashIndex >= 0 ? withoutQuery.slice(slashIndex + 1) : withoutQuery;
  let cleaned = segment.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").replace(/[^A-Za-z0-9._-]/g, "_").replace(/\.{2,}/g, "_").replace(/_+/g, "_").replace(/^[._]+/, "").replace(/\.+$/, "");
  if (!cleaned) return fallback;
  if (WINDOWS_RESERVED_NAME_RE.test(cleaned)) cleaned = `edit_${cleaned}`;
  if (cleaned.length <= MAX_TEMP_FILENAME_CHARS) return cleaned;
  const dot = cleaned.lastIndexOf(".");
  if (dot > 0 && cleaned.length - dot <= MAX_TEMP_EXTENSION_CHARS) {
    const ext = cleaned.slice(dot);
    return `${cleaned.slice(0, MAX_TEMP_FILENAME_CHARS - ext.length)}${ext}`;
  }
  return cleaned.slice(0, MAX_TEMP_FILENAME_CHARS);
}
function assertSafePatchSegment(key, fullPath) {
  if (!VALID_PATCH_SEGMENT_RE.test(key)) {
    throw new HcmError(
      "UNSUPPORTED_PATCH_KEY",
      `Поле «${sanitizeTerminalText(fullPath)}» нельзя безопасно изменить в JSON-режиме из-за имени элемента.`,
      "Отредактировать документ в режиме --xml."
    );
  }
}
function assertSafePatchValue(value, basePath) {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      assertSafePatchValue(value[i], `${basePath}[${i}]`);
    }
    return;
  }
  if (isPlainObject3(value)) {
    for (const key of Object.keys(value)) {
      const childPath = basePath ? `${basePath}.${key}` : key;
      assertSafePatchSegment(key, childPath);
      assertSafePatchValue(value[key], childPath);
    }
  }
}
function keysCouldCollide(left, right) {
  if (left === right) return true;
  if (withoutFalseOffset(left) === withoutFalseOffset(right)) return true;
  if (PATCH_ID_KEY_RE.test(left) && PATCH_ID_KEY_RE.test(right)) {
    try {
      return BigInt(left) === BigInt(right);
    } catch {
      return false;
    }
  }
  return false;
}
function fieldValueCouldCollide(otherValue, keyValue) {
  if (Array.isArray(otherValue)) {
    return otherValue.some((entry) => fieldValueCouldCollide(entry, keyValue));
  }
  if (otherValue === null || otherValue === void 0) return false;
  return keysCouldCollide(String(otherValue), keyValue);
}
function findUniqueAppendKey(item, existing) {
  if (!isPlainObject3(item)) return void 0;
  for (const key of Object.keys(item)) {
    if (!VALID_PATCH_SEGMENT_RE.test(key)) continue;
    const raw = item[key];
    if (typeof raw !== "string" && typeof raw !== "number" && typeof raw !== "boolean") continue;
    if (typeof raw === "number" && (!Number.isFinite(raw) || Number.isInteger(raw) && !Number.isSafeInteger(raw))) {
      continue;
    }
    const strVal = String(raw);
    if (strVal === "" || /[\]\u0000-\u001f]/.test(strVal)) continue;
    const collides = existing.some(
      (other) => isPlainObject3(other) && Object.hasOwn(other, key) && fieldValueCouldCollide(other[key], strVal)
    );
    if (!collides) return [key, strVal];
  }
  return void 0;
}
function diffRepeatedArray(bVal, aVal, path, patch, remove) {
  const n = bVal.length;
  if (n === 0) {
    if (Array.isArray(aVal) && aVal.length === 0) return;
    assertSafePatchValue(aVal, path);
    setOwnProperty2(patch, path, aVal);
    return;
  }
  if (Array.isArray(aVal) && aVal.length === 0) {
    if (n === 1) {
      remove.push(path);
    } else {
      for (let i = n - 1; i >= 0; i--) remove.push(`${path}[${i}]`);
    }
    return;
  }
  if (!Array.isArray(aVal)) {
    assertSafePatchValue(aVal, path);
    if (n === 1) {
      setOwnProperty2(patch, path, aVal);
    } else {
      setOwnProperty2(patch, `${path}[0]`, aVal);
      for (let i = n - 1; i >= 1; i--) remove.push(`${path}[${i}]`);
    }
    return;
  }
  const m = aVal.length;
  if (m === n) {
    for (let i = 0; i < n; i++) {
      if (sameData(bVal[i], aVal[i])) continue;
      const elemPath = `${path}[${i}]`;
      if (isPlainObject3(bVal[i]) && isPlainObject3(aVal[i])) {
        walkObjectDiff(
          bVal[i],
          aVal[i],
          elemPath,
          patch,
          remove
        );
      } else {
        assertSafePatchValue(aVal[i], elemPath);
        setOwnProperty2(patch, elemPath, aVal[i]);
      }
    }
    return;
  }
  if (m > n) {
    for (let i = 0; i < n; i++) {
      if (sameData(bVal[i], aVal[i])) continue;
      const elemPath = `${path}[${i}]`;
      if (isPlainObject3(bVal[i]) && isPlainObject3(aVal[i])) {
        walkObjectDiff(
          bVal[i],
          aVal[i],
          elemPath,
          patch,
          remove
        );
      } else {
        assertSafePatchValue(aVal[i], elemPath);
        setOwnProperty2(patch, elemPath, aVal[i]);
      }
    }
    const seen = [...bVal, ...aVal.slice(0, n)];
    for (let k = n; k < m; k++) {
      const added = aVal[k];
      assertSafePatchValue(added, `${path}[${k}]`);
      const uniqueKey = findUniqueAppendKey(added, seen);
      if (!uniqueKey) {
        throw new HcmError(
          "UNSUPPORTED_LIST_APPEND",
          `Добавление элемента без уникального ключевого поля в список «${sanitizeTerminalText(path)}» в JSON-режиме может удалить атрибуты и комментарии существующих элементов.`,
          "Отредактировать документ в режиме --xml."
        );
      }
      const [keyField, keyValue] = uniqueKey;
      setOwnProperty2(patch, `${path}[${keyField}=${keyValue}]`, added);
      seen.push(added);
    }
    return;
  }
  for (let i = 0; i < m; i++) {
    if (sameData(bVal[i], aVal[i])) continue;
    const elemPath = `${path}[${i}]`;
    if (isPlainObject3(bVal[i]) && isPlainObject3(aVal[i])) {
      walkObjectDiff(
        bVal[i],
        aVal[i],
        elemPath,
        patch,
        remove
      );
    } else {
      assertSafePatchValue(aVal[i], elemPath);
      setOwnProperty2(patch, elemPath, aVal[i]);
    }
  }
  for (let i = n - 1; i >= m; i--) {
    remove.push(`${path}[${i}]`);
  }
}
function walkObjectDiff(before, after, prefix, patch, remove) {
  const keys = [.../* @__PURE__ */ new Set([...Object.keys(before), ...Object.keys(after)])];
  for (const key of keys) {
    const hasBefore = Object.hasOwn(before, key);
    const hasAfter = Object.hasOwn(after, key);
    const path = prefix ? `${prefix}.${key}` : key;
    if (hasBefore && !hasAfter) {
      assertSafePatchSegment(key, path);
      const bVal2 = before[key];
      if (Array.isArray(bVal2) && bVal2.length > 1) {
        for (let i = bVal2.length - 1; i >= 0; i--) remove.push(`${path}[${i}]`);
      } else {
        remove.push(path);
      }
      continue;
    }
    if (!hasBefore && hasAfter) {
      assertSafePatchSegment(key, path);
      assertSafePatchValue(after[key], path);
      setOwnProperty2(patch, path, after[key]);
      continue;
    }
    const bVal = before[key];
    const aVal = after[key];
    if (sameData(bVal, aVal)) continue;
    assertSafePatchSegment(key, path);
    if (Array.isArray(bVal)) {
      diffRepeatedArray(bVal, aVal, path, patch, remove);
    } else if (Array.isArray(aVal)) {
      diffRepeatedArray([bVal], aVal, path, patch, remove);
    } else if (isPlainObject3(bVal) && isPlainObject3(aVal)) {
      walkObjectDiff(bVal, aVal, path, patch, remove);
    } else {
      assertSafePatchValue(aVal, path);
      setOwnProperty2(patch, path, aVal);
    }
  }
}
function diffObjectFields(before, after) {
  const patch = {};
  const remove = [];
  walkObjectDiff(before, after, "", patch, remove);
  return { patch, remove };
}
function assertCanConfirmOrYes(args, io) {
  if (args.options.yes === true || typeof io.confirm === "function") return;
  throw new HcmError(
    "CONFIRMATION_REQUIRED",
    "Редактирование требует интерактивного подтверждения или флага -y / --yes.",
    "Запустить в интерактивном терминале либо передать -y / --yes."
  );
}
function planEditCommand(args, outputMode, io) {
  const [command] = args.positionals;
  const editor = stringOption(args, "editor");
  if (editor !== void 0 && !editor.trim()) {
    throw new CliInputError("--editor не может быть пустым.");
  }
  if (command === "files") {
    if (stringOption(args, "output") !== void 0) {
      throw new CliInputError(
        "wtctl files edit не принимает --output: команда редактирует файл на сервере."
      );
    }
    exactPositionals(args, 3);
    const url = requirePositional(args, 2, "адрес файла на сервере");
    if (!url.trim()) throw new CliInputError("Адрес файла не может быть пустым.");
    assertFormatSupported("files.write", outputMode.format, void 0, "wtctl files edit");
    if (typeof io.launchEditor !== "function") {
      throw new HcmError(
        "EDITOR_UNAVAILABLE",
        "Запуск внешнего редактора недоступен в этом окружении."
      );
    }
    assertCanConfirmOrYes(args, io);
    return { kind: "files", url, ...editor === void 0 ? {} : { editor } };
  }
  if (stringOption(args, "output") !== void 0) {
    throw new CliInputError(
      "wtctl object edit не принимает --output: команда редактирует объект на сервере."
    );
  }
  const xml = args.options.xml === true;
  const hasFieldsFlag = args.options.fields !== void 0;
  const fields = listOption(args, "fields");
  if (xml && hasFieldsFlag) {
    throw new CliInputError(
      "--xml и --fields вместе не задаются: с --xml редактируется весь XML документа."
    );
  }
  const target = objectTarget(args);
  if (typeof target.id === "string") {
    try {
      resolvePhysicalDocumentLocation(
        target.id,
        typeof target.dbName === "string" ? target.dbName : void 0
      );
    } catch (error) {
      if (error instanceof ArgumentError) {
        throw new CliInputError(error.message, "Объект задают [ТИП] ID, --id ID или --url АДРЕС.");
      }
      throw error;
    }
  }
  assertFormatSupported(
    xml ? "native.lds.putDoc" : "objects.patch",
    outputMode.format,
    void 0,
    "wtctl object edit"
  );
  if (typeof io.launchEditor !== "function") {
    throw new HcmError(
      "EDITOR_UNAVAILABLE",
      "Запуск внешнего редактора недоступен в этом окружении."
    );
  }
  assertCanConfirmOrYes(args, io);
  return {
    kind: "object",
    target,
    xml,
    ...fields === void 0 ? {} : { fields },
    ...editor === void 0 ? {} : { editor }
  };
}
function sanitizePreviewValue(value) {
  if (typeof value === "string") return sanitizeTerminalText(value);
  if (Array.isArray(value)) return value.map(sanitizePreviewValue);
  if (isRecord4(value)) {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      setOwnProperty2(out, sanitizeTerminalText(key), sanitizePreviewValue(item));
    }
    return out;
  }
  return value;
}
async function confirmEditSave(io, args, question) {
  if (args.options.yes === true) return true;
  if (typeof io.confirm !== "function") {
    throw new HcmError(
      "CONFIRMATION_REQUIRED",
      "Невозможно запросить подтверждение без интерактивного терминала; изменения не сохранены.",
      "Передать -y / --yes, чтобы сохранить изменения без вопроса."
    );
  }
  const confirmed = await io.confirm(question);
  if (!confirmed) {
    await io.writeError("Отменено.\n");
    return false;
  }
  return true;
}
function renderConnectionHeader(config, targetLabel, targetValue, styler) {
  const conn = `${styler.bold(sanitizeTerminalText(config.name))} (${sanitizeTerminalText(config.baseUrl)})`;
  const width = Math.max("Подключение".length, targetLabel.length) + 1;
  return [
    `${styler.dim("Подключение:".padEnd(width))}  ${conn}`,
    `${styler.dim(`${targetLabel}:`.padEnd(width))}  ${styler.bold(sanitizeTerminalText(targetValue))}`
  ].join("\n");
}
function shouldRedirectEditorStdout(io, outputMode) {
  return outputMode.format === "json" || outputMode.requested === "json" || outputMode.format === "jsonl" || outputMode.format === "raw" || io.stdoutIsTTY !== true;
}
async function withEditedTempFile(fileName, initialContent, editor, io, outputMode, progress, closeRuntimeOnce, onEdited) {
  const tempDir = await mkdtemp(join2(tmpdir(), "wtctl-edit-"));
  const tempPath = join2(tempDir, fileName);
  try {
    await writeFile(tempPath, initialContent, { encoding: "utf8", mode: 384 });
    await progress.stop();
    const redirectStdoutToStderr = shouldRedirectEditorStdout(io, outputMode);
    const exitCode = await io.launchEditor(
      editor,
      tempPath,
      redirectStdoutToStderr ? { redirectStdoutToStderr: true } : void 0
    );
    if (exitCode !== 0) {
      await safeDiagnostic(
        io,
        failure(
          "EDITOR_EXITED",
          `Редактор завершился с кодом ${exitCode}; изменения не сохранены.`
        ),
        outputMode.humanErrors ? "human" : "json"
      );
      await closeRuntimeOnce();
      return { handled: true, exitCode: 1 };
    }
    let rawBytes;
    try {
      rawBytes = await readFile(tempPath);
    } catch {
      throw new HcmError(
        "EDITOR_FAILED",
        "Временный файл после редактирования не найден или не читается; изменения не сохранены."
      );
    }
    let editedText;
    try {
      editedText = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(rawBytes);
    } catch {
      throw new HcmError(
        "INVALID_UTF8",
        "Отредактированный файл содержит некорректные байты UTF-8; изменения не сохранены."
      );
    }
    return await onEdited(editedText, tempDir);
  } finally {
    await cleanupTempDir(tempDir, io);
  }
}
function binaryFileError() {
  return new HcmError(
    "CLI_BINARY_FILE",
    "Двоичный файл нельзя редактировать в текстовом редакторе.",
    "Сохранить на диск: wtctl files read АДРЕС --to ФАЙЛ."
  );
}
async function validateAndHashTextFile(filePath, retainUpToBytes, checkControlBytes) {
  const hash = createHash("sha256");
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const parts = [];
  let retain = retainUpToBytes > 0;
  let bytes = 0;
  const decodeFailure = () => checkControlBytes ? binaryFileError() : new HcmError(
    "INVALID_UTF8",
    "Отредактированный файл содержит некорректные байты UTF-8; изменения не сохранены."
  );
  const stream = createReadStream(filePath, { highWaterMark: 64 * 1024 });
  try {
    for await (const chunk of stream) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buf.length;
      hash.update(buf);
      let piece;
      try {
        piece = decoder.decode(buf, { stream: true });
      } catch {
        throw decodeFailure();
      }
      if (checkControlBytes && /[\u0000-\u0008\u000b\u000e-\u001f]/.test(piece)) {
        throw binaryFileError();
      }
      if (retain) {
        if (bytes > retainUpToBytes) {
          retain = false;
          parts.length = 0;
        } else {
          parts.push(piece);
        }
      }
    }
    let tail;
    try {
      tail = decoder.decode();
    } catch {
      throw decodeFailure();
    }
    if (checkControlBytes && /[\u0000-\u0008\u000b\u000e-\u001f]/.test(tail)) {
      throw binaryFileError();
    }
    if (retain && tail) parts.push(tail);
  } finally {
    stream.destroy();
  }
  return {
    ...retain ? { text: parts.join("") } : {},
    hash: hash.digest("hex"),
    bytes
  };
}
async function hashLocalFile(filePath) {
  const hash = createHash("sha256");
  const stream = createReadStream(filePath, { highWaterMark: 64 * 1024 });
  try {
    for await (const chunk of stream) {
      hash.update(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
  } finally {
    stream.destroy();
  }
  return hash.digest("hex");
}
function decodeTextBytes(bytes) {
  let decoded;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw binaryFileError();
  }
  if (/[\u0000-\u0008\u000b\u000e-\u001f]/.test(decoded)) throw binaryFileError();
  const hash = createHash("sha256").update(bytes).digest("hex");
  return { text: decoded, hash, bytes: bytes.length };
}
async function readTextFileToDisk(runtime, url, targetPath) {
  const readRes = await runtime.call("files.read", { url, file: targetPath, overwrite: true });
  if (!readRes.ok) return { ok: false, result: readRes };
  const readData = readRes.meta.truncated === true ? await readStoredJson(runtime, readRes) : readRes.data;
  if (!isRecord4(readData)) throw binaryFileError();
  if (typeof readData.file === "string" && readData.file) {
    const { text: text2, hash, bytes } = await validateAndHashTextFile(
      readData.file,
      LARGE_FILE_WRITE_THRESHOLD_BYTES,
      true
    );
    if (readData.file !== targetPath) {
      await copyFile(readData.file, targetPath);
    }
    return {
      ok: true,
      ...text2 === void 0 ? {} : { text: text2 },
      hash,
      bytes,
      writtenToDisk: true
    };
  }
  if (typeof readData.base64 === "string") {
    const raw = Buffer.from(readData.base64, "base64");
    const { text: text2, hash, bytes } = decodeTextBytes(raw);
    return { ok: true, text: text2, hash, bytes, writtenToDisk: false };
  }
  if (readData.encoding === "base64" || typeof readData.text !== "string") {
    throw binaryFileError();
  }
  const text = readData.text;
  return {
    ok: true,
    text,
    hash: sha256Text(text),
    bytes: Buffer.byteLength(text, "utf8"),
    writtenToDisk: false
  };
}
async function readCurrentServerFileHash(runtime, url, scratchPath) {
  try {
    const readRes = await runtime.call("files.read", { url, file: scratchPath, overwrite: true });
    if (!readRes.ok) return { ok: false };
    const readData = readRes.meta.truncated === true ? await readStoredJson(runtime, readRes) : readRes.data;
    if (!isRecord4(readData)) return { ok: false };
    if (typeof readData.file === "string" && readData.file) {
      return { ok: true, hash: await hashLocalFile(readData.file) };
    }
    if (typeof readData.base64 === "string") {
      const bytes = Buffer.from(readData.base64, "base64");
      return { ok: true, hash: createHash("sha256").update(bytes).digest("hex") };
    }
    if (typeof readData.text === "string") {
      return { ok: true, hash: sha256Text(readData.text) };
    }
    return { ok: false };
  } finally {
    await unlink(scratchPath).catch(() => void 0);
  }
}
async function cleanupTempDir(tempDir, io) {
  try {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  } catch {
    try {
      await io.writeError(
        `Предупреждение: не удалось удалить временную папку ${sanitizeTerminalText(tempDir)}.
`
      );
    } catch {
    }
  }
}
async function runFilesEdit(plan, args, config, io, runtime, outputMode, progress, closeRuntimeOnce) {
  const fileName = safeTempFileName(plan.url, "file.txt");
  const tempDir = await mkdtemp(join2(tmpdir(), "wtctl-edit-"));
  const tempPath = join2(tempDir, fileName);
  try {
    progress.update("Чтение файла…");
    const initial = await readTextFileToDisk(runtime, plan.url, tempPath);
    if (!initial.ok) return { handled: false, result: initial.result };
    const originalText = initial.text;
    const originalHash = initial.hash;
    const originalBytes = initial.bytes;
    if (!initial.writtenToDisk) {
      await writeFile(tempPath, originalText ?? "", { encoding: "utf8", mode: 384 });
    }
    await progress.stop();
    const redirectStdoutToStderr = shouldRedirectEditorStdout(io, outputMode);
    const exitCode = await io.launchEditor(
      plan.editor,
      tempPath,
      redirectStdoutToStderr ? { redirectStdoutToStderr: true } : void 0
    );
    if (exitCode !== 0) {
      await safeDiagnostic(
        io,
        failure(
          "EDITOR_EXITED",
          `Редактор завершился с кодом ${exitCode}; изменения не сохранены.`
        ),
        outputMode.humanErrors ? "human" : "json"
      );
      await closeRuntimeOnce();
      return { handled: true, exitCode: 1 };
    }
    let editedStatSize;
    try {
      editedStatSize = (await stat(tempPath)).size;
    } catch {
      throw new HcmError(
        "EDITOR_FAILED",
        "Временный файл после редактирования не найден или не читается; изменения не сохранены."
      );
    }
    const useStreamingSnapshot = editedStatSize > LARGE_FILE_WRITE_THRESHOLD_BYTES || originalText === void 0;
    let editedText;
    let snapshotPath;
    let editedBytes;
    if (useStreamingSnapshot) {
      snapshotPath = join2(tempDir, ".verified-upload.tmp");
      try {
        await copyFile(tempPath, snapshotPath);
      } catch {
        throw new HcmError(
          "EDITOR_FAILED",
          "Временный файл после редактирования не найден или не читается; изменения не сохранены."
        );
      }
      const checked = await validateAndHashTextFile(snapshotPath, 0, false);
      editedBytes = checked.bytes;
      if (checked.hash === originalHash) {
        return {
          handled: false,
          result: frontendResult("cli.files.edit", config.name, {
            url: plan.url,
            changed: false
          })
        };
      }
    } else {
      let rawBytes;
      try {
        rawBytes = await readFile(tempPath);
      } catch {
        throw new HcmError(
          "EDITOR_FAILED",
          "Временный файл после редактирования не найден или не читается; изменения не сохранены."
        );
      }
      try {
        editedText = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(rawBytes);
      } catch {
        throw new HcmError(
          "INVALID_UTF8",
          "Отредактированный файл содержит некорректные байты UTF-8; изменения не сохранены."
        );
      }
      editedBytes = rawBytes.length;
      if (editedText === originalText) {
        return {
          handled: false,
          result: frontendResult("cli.files.edit", config.name, {
            url: plan.url,
            changed: false
          })
        };
      }
    }
    const styler = createStyler(resolveColor(io, "stderr"));
    const header = renderConnectionHeader(config, "Файл", plan.url, styler);
    const diff = originalText !== void 0 && editedText !== void 0 ? renderLineDiff(originalText, editedText, styler) : `Файл изменён (размер: ${formatBytes(originalBytes)} → ${formatBytes(editedBytes)}; построчный diff пропущен для файлов больше 512 КиБ).
`;
    await io.writeError(`${header}

${diff}`);
    const confirmed = await confirmEditSave(io, args, "Сохранить изменения на сервер? [y/N] ");
    if (!confirmed) {
      await closeRuntimeOnce();
      return { handled: true, exitCode: 1 };
    }
    progress.start("Проверка изменений на сервере…");
    const current = await readCurrentServerFileHash(
      runtime,
      plan.url,
      join2(tempDir, ".server-current.tmp")
    );
    if (!current.ok) {
      throw new HcmError(
        "FILE_CHANGED",
        "Не удалось перечитать файл перед записью: возможно, файл был удалён или изменён на сервере.",
        "Проверить актуальное состояние файла и повторить редактирование."
      );
    }
    if (current.hash !== originalHash) {
      throw new HcmError(
        "FILE_CHANGED",
        "Файл на сервере изменился за время редактирования; изменения не сохранены.",
        "Повторить редактирование на актуальной версии файла."
      );
    }
    progress.update("Сохранение файла…");
    const writeArgs = snapshotPath !== void 0 ? { url: plan.url, file: snapshotPath } : { url: plan.url, text: editedText };
    const writeRes = await runtime.call("files.write", writeArgs);
    return { handled: false, result: writeRes, requestArgs: { url: plan.url } };
  } finally {
    await cleanupTempDir(tempDir, io);
  }
}
async function runObjectJsonEdit(plan, args, config, io, runtime, outputMode, progress, closeRuntimeOnce) {
  progress.update("Чтение объекта…");
  const getArgs = {
    ...plan.target,
    ...plan.fields === void 0 ? {} : { fields: plan.fields }
  };
  const getRes = await runtime.call("objects.get", getArgs);
  if (!getRes.ok) return { handled: false, result: getRes };
  const getData = getRes.meta.truncated === true ? await readStoredJson(runtime, getRes) : getRes.data;
  if (!isRecord4(getData) || !isPlainObject3(getData.data) || typeof getData.fingerprint !== "string") {
    throw new HcmError("INVALID_RESPONSE", "Неожиданный ответ objects.get при чтении объекта.");
  }
  const fingerprint = getData.fingerprint;
  const originalData = getData.data;
  const objectType = typeof getData.type === "string" && getData.type ? getData.type : typeof plan.target.type === "string" ? plan.target.type : "object";
  const objectId = typeof getData.id === "string" && getData.id ? getData.id : typeof plan.target.id === "string" ? plan.target.id : void 0;
  const objectUrl = typeof getData.url === "string" && getData.url ? getData.url : typeof plan.target.url === "string" ? plan.target.url : void 0;
  const baseName = objectId ? `${objectType}_${objectId}.json` : `${objectType}.json`;
  const fileName = safeTempFileName(baseName, "object.json");
  const initialJson = `${JSON.stringify(originalData, null, 2)}
`;
  return await withEditedTempFile(
    fileName,
    initialJson,
    plan.editor,
    io,
    outputMode,
    progress,
    closeRuntimeOnce,
    async (editedText) => {
      let parsedJson;
      try {
        const jsonSource = editedText.startsWith("\uFEFF") ? editedText.slice(1) : editedText;
        parsedJson = JSON.parse(jsonSource);
      } catch (error) {
        const detail = error instanceof Error ? ` (${error.message})` : "";
        throw new HcmError(
          "INVALID_JSON",
          `Отредактированный файл содержит некорректный JSON${detail}; изменения не сохранены.`,
          "Исправить синтаксис JSON и повторить редактирование."
        );
      }
      if (!isPlainObject3(parsedJson)) {
        throw new HcmError(
          "INVALID_JSON",
          "В файле должен быть объект JSON с полями документа, а не массив, строка или число; изменения не сохранены."
        );
      }
      const { patch, remove } = diffObjectFields(originalData, parsedJson);
      const hasPatch = Object.keys(patch).length > 0;
      const hasRemove = remove.length > 0;
      if (!hasPatch && !hasRemove) {
        return {
          handled: false,
          result: frontendResult("cli.object.edit", config.name, {
            ...objectId === void 0 ? {} : { id: objectId },
            ...objectUrl === void 0 ? {} : { url: objectUrl },
            changed: false
          })
        };
      }
      const patchBaseArgs = {
        ...plan.target,
        ...hasPatch ? { patch } : {},
        ...hasRemove ? { remove } : {},
        expectedFingerprint: fingerprint
      };
      progress.start("Проверка правок…");
      const previewRes = await runtime.call("objects.patch", { ...patchBaseArgs, preview: true });
      await progress.stop();
      if (!previewRes.ok) return { handled: false, result: previewRes };
      const previewData = previewRes.meta.truncated === true ? await readStoredJson(runtime, previewRes) : previewRes.data;
      if (isRecord4(previewData) && previewData.noop === true) {
        return {
          handled: false,
          result: frontendResult("cli.object.edit", config.name, {
            ...objectId === void 0 ? {} : { id: objectId },
            ...objectUrl === void 0 ? {} : { url: objectUrl },
            changed: false
          })
        };
      }
      const styler = createStyler(resolveColor(io, "stderr"));
      const targetLabel = [objectType, objectId].filter(Boolean).join(" · ") || objectUrl || "—";
      const header = renderConnectionHeader(config, "Объект", targetLabel, styler);
      const sanitizedPreview = isRecord4(previewData) ? sanitizePreviewValue(previewData) : {};
      const renderedPreview = renderObjectPatch(sanitizedPreview, styler);
      await io.writeError(`${header}

${renderedPreview}`);
      const confirmed = await confirmEditSave(io, args, "Сохранить изменения объекта? [y/N] ");
      if (!confirmed) {
        await closeRuntimeOnce();
        return { handled: true, exitCode: 1 };
      }
      progress.start("Сохранение объекта…");
      const saveRes = await runtime.call("objects.patch", patchBaseArgs);
      return { handled: false, result: saveRes, requestArgs: patchBaseArgs };
    }
  );
}
function decodeBinaryPayloadText(data) {
  if (!isRecord4(data) || data.kind !== "binary") return void 0;
  let bytes;
  if (data.bytes instanceof Uint8Array) {
    bytes = data.bytes;
  } else if (isRecord4(data.bytes) && typeof data.bytes.base64 === "string") {
    bytes = Buffer.from(data.bytes.base64, "base64");
  }
  if (!bytes) return void 0;
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return decoded.startsWith("\uFEFF") ? decoded.slice(1) : decoded;
}
function extractRawDocXml(loadData) {
  const rawEnvelope = decodeBinaryPayloadText(loadData);
  if (rawEnvelope !== void 0) {
    return unwrapLoadDocSoapXml(rawEnvelope);
  }
  return extractDocXml(loadData);
}
function normalizedDocId(value) {
  if (typeof value !== "string" && typeof value !== "number") return void 0;
  const text = String(value).trim();
  if (!text) return void 0;
  try {
    return BigInt(resolvePhysicalDocumentLocation(text).objectId);
  } catch {
    return void 0;
  }
}
async function loadRawXmlSnapshot(runtime, url) {
  const loadRes = await runtime.call("native.lds.loadDoc", { url, useBinaryResponse: true });
  if (!loadRes.ok) return { ok: false, result: loadRes };
  const loadData = loadRes.meta.truncated === true ? await readStoredJson(runtime, loadRes) : loadRes.data;
  const extracted = extractRawDocXml(loadData);
  if (extracted === void 0) {
    throw new HcmError("INVALID_XML", "Не удалось извлечь XML документа из ответа сервера.");
  }
  return { ok: true, xml: extracted };
}
async function runObjectXmlEdit(plan, args, config, io, runtime, outputMode, progress, closeRuntimeOnce) {
  const dbName = typeof plan.target.dbName === "string" ? plan.target.dbName : void 0;
  let url;
  let objectId;
  if (typeof plan.target.url === "string") {
    url = plan.target.url;
    objectId = typeof plan.target.id === "string" ? plan.target.id : parsePhysicalDocumentId(url);
  } else if (dbName !== void 0) {
    const location = resolvePhysicalDocumentLocation(String(plan.target.id), dbName);
    url = location.url;
    objectId = location.objectId;
  } else {
    progress.update("Поиск документа…");
    const locateRes = await runtime.call("objects.get", { ...plan.target, fields: ["id"] });
    if (!locateRes.ok) return { handled: false, result: locateRes };
    const locateData = locateRes.meta.truncated === true ? await readStoredJson(runtime, locateRes) : locateRes.data;
    if (!isRecord4(locateData) || typeof locateData.url !== "string" || !locateData.url) {
      throw new HcmError(
        "INVALID_RESPONSE",
        "Не удалось определить адрес документа для редактирования XML."
      );
    }
    url = locateData.url;
    objectId = typeof locateData.id === "string" && locateData.id ? locateData.id : typeof plan.target.id === "string" ? plan.target.id : parsePhysicalDocumentId(url);
  }
  progress.update("Чтение XML документа…");
  const loaded = await loadRawXmlSnapshot(runtime, url);
  if (!loaded.ok) return { handled: false, result: loaded.result };
  const expectedType = typeof plan.target.type === "string" ? plan.target.type : void 0;
  let originalDoc;
  let actualType;
  let hadIdElement = false;
  let expectedIdBigInt = normalizedDocId(objectId);
  try {
    originalDoc = XmlDocument.parse(loaded.xml);
    actualType = originalDoc.form().type;
    const snap = originalDoc.snapshot();
    if (Object.hasOwn(snap.data, "id") && snap.data.id !== void 0) {
      const idStr = String(snap.data.id).trim();
      if (idStr) {
        hadIdElement = true;
        expectedIdBigInt = normalizedDocId(idStr) ?? expectedIdBigInt;
      }
    }
  } catch {
  }
  if (expectedType !== void 0 && actualType !== void 0 && actualType !== expectedType) {
    throw new HcmError(
      "TYPE_MISMATCH",
      `Тип объекта — ${actualType}, а не ${expectedType}.`,
      void 0,
      { actualType }
    );
  }
  const originalXml = loaded.xml.endsWith("\n") ? loaded.xml : `${loaded.xml}
`;
  const originalHash = sha256Text(loaded.xml);
  const typeLabel = actualType ?? expectedType ?? "object";
  const rawFileName = objectId ? `${typeLabel}_${objectId}.xml` : safeTempFileName(url, "doc.xml");
  const fileName = safeTempFileName(
    rawFileName.toLowerCase().endsWith(".xml") ? rawFileName : `${rawFileName}.xml`,
    "document.xml"
  );
  return await withEditedTempFile(
    fileName,
    originalXml,
    plan.editor,
    io,
    outputMode,
    progress,
    closeRuntimeOnce,
    async (editedXml) => {
      if (editedXml === originalXml) {
        return {
          handled: false,
          result: frontendResult("cli.object.edit", config.name, {
            ...objectId === void 0 ? {} : { id: objectId },
            url,
            changed: false
          })
        };
      }
      const trimmedEditedXml = editedXml.startsWith("\uFEFF") ? editedXml.slice(1) : editedXml;
      try {
        rawXmlElement(trimmedEditedXml);
      } catch (error) {
        if (error instanceof ArgumentError) {
          throw new HcmError(
            "INVALID_XML",
            `Отредактированный XML некорректен: ${error.message}`,
            "Исправить разметку XML и повторить редактирование."
          );
        }
        throw error;
      }
      const rootTagMatch = /^(?:\s*(?:<\?[\s\S]*?\?>|<!--[\s\S]*?-->))*\s*<([^\s/>!?][^\s/>]*)/.exec(trimmedEditedXml);
      const rawRootTag = rootTagMatch?.[1];
      const rawRootLocal = rawRootTag ? rawRootTag.includes(":") ? rawRootTag.slice(rawRootTag.lastIndexOf(":") + 1) : rawRootTag : void 0;
      const requiredType = actualType ?? expectedType;
      if (rawRootLocal === "Envelope" || requiredType !== void 0 && rawRootLocal !== requiredType) {
        throw new HcmError(
          "TYPE_MISMATCH",
          `Корневой элемент изменён с <${requiredType ?? "документ"}> на <${rawRootTag ?? "?"}>; тип документа менять нельзя.`,
          "Вернуть прежний корневой элемент документа.",
          ...rawRootTag === void 0 ? [] : [{ actualType: rawRootTag }]
        );
      }
      let editedDoc;
      try {
        editedDoc = XmlDocument.parse(trimmedEditedXml);
      } catch (error) {
        if (error instanceof HcmError) throw error;
        throw new HcmError(
          "INVALID_XML",
          "Не удалось разобрать отредактированный XML документа; изменения не сохранены.",
          "Исправить разметку XML и повторить редактирование."
        );
      }
      const editedType = editedDoc.form().type;
      if (requiredType !== void 0 && editedType !== requiredType) {
        throw new HcmError(
          "TYPE_MISMATCH",
          `Корневой элемент изменён с <${requiredType}> на <${editedType}>; тип документа менять нельзя.`,
          "Вернуть прежний корневой элемент документа.",
          { actualType: editedType }
        );
      }
      const editedSnap = editedDoc.snapshot();
      const editedRawId = Object.hasOwn(editedSnap.data, "id") ? editedSnap.data.id : void 0;
      const editedIdText = typeof editedRawId === "string" || typeof editedRawId === "number" ? String(editedRawId).trim() : "";
      if (hadIdElement && !editedIdText) {
        throw new HcmError(
          "IMMUTABLE_ID",
          "Элемент <id> удалён или очищен; ID документа менять нельзя.",
          "Вернуть исходное значение элемента <id>."
        );
      }
      if (editedIdText && expectedIdBigInt !== void 0) {
        const editedIdBigInt = normalizedDocId(editedIdText);
        if (editedIdBigInt === void 0 || editedIdBigInt !== expectedIdBigInt) {
          throw new HcmError(
            "IMMUTABLE_ID",
            "ID документа в отредактированном XML не совпадает с исходным; изменения не сохранены.",
            "Вернуть исходное значение элемента <id>."
          );
        }
      }
      const styler = createStyler(resolveColor(io, "stderr"));
      const header = renderConnectionHeader(config, "Документ", url, styler);
      const diff = renderLineDiff(originalXml, editedXml, styler);
      await io.writeError(`${header}

${diff}`);
      const confirmed = await confirmEditSave(io, args, "Сохранить изменения документа? [y/N] ");
      if (!confirmed) {
        await closeRuntimeOnce();
        return { handled: true, exitCode: 1 };
      }
      progress.start("Проверка изменений на сервере…");
      const current = await loadRawXmlSnapshot(runtime, url);
      if (!current.ok) {
        throw new HcmError(
          "CONFLICT",
          "Не удалось перечитать документ перед записью: возможно, он был удалён или изменён на сервере.",
          "Проверить актуальное состояние документа и повторить редактирование."
        );
      }
      if (current.xml !== loaded.xml || sha256Text(current.xml) !== originalHash) {
        throw new HcmError(
          "CONFLICT",
          "Документ на сервере изменился за время редактирования; изменения не сохранены.",
          "Повторить редактирование на актуальной версии документа."
        );
      }
      progress.update("Сохранение XML документа…");
      const putArgs = { url, data: trimmedEditedXml, writeDocInfo: true };
      const putRes = await runtime.call("native.lds.putDoc", putArgs);
      return { handled: false, result: putRes, requestArgs: { url } };
    }
  );
}
async function runEditCommand(plan, args, config, io, runtime, outputMode, progress, closeRuntimeOnce) {
  if (plan.kind === "files") {
    return await runFilesEdit(
      plan,
      args,
      config,
      io,
      runtime,
      outputMode,
      progress,
      closeRuntimeOnce
    );
  }
  if (plan.xml) {
    return await runObjectXmlEdit(
      plan,
      args,
      config,
      io,
      runtime,
      outputMode,
      progress,
      closeRuntimeOnce
    );
  }
  return await runObjectJsonEdit(
    plan,
    args,
    config,
    io,
    runtime,
    outputMode,
    progress,
    closeRuntimeOnce
  );
}

// src/cli/node-io.ts
import process4 from "node:process";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream as createReadStream2, statSync } from "node:fs";
import {
  lstat,
  mkdir as mkdir2,
  open,
  readlink,
  realpath,
  rename,
  stat as stat2,
  unlink as unlink2
} from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { basename as basename3, dirname as dirname3, extname, join as join3, resolve as resolve4 } from "node:path";
async function readBoundedBytes(stream, maximumBytes = Infinity) {
  const parts = [];
  let bytes = 0;
  try {
    for await (const part of stream) {
      const buffer = Buffer.isBuffer(part) ? part : Buffer.from(String(part));
      bytes += buffer.length;
      if (bytes > maximumBytes) throw new CliInputError("Ввод превышает допустимый размер.");
      parts.push(buffer);
    }
    return Buffer.concat(parts, bytes);
  } finally {
    if (stream !== process4.stdin) stream.destroy();
  }
}
async function readBounded(stream, maximumBytes) {
  const bytes = await readBoundedBytes(stream, maximumBytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    if (error.code === "ERR_STRING_TOO_LONG")
      throw new CliInputError(
        "Текст ввода длиннее строки, которую держит Node.js: около 512 млн знаков."
      );
    throw new CliInputError("Ввод должен быть текстом UTF-8.");
  }
}
function writeStream(stream, chunk) {
  return new Promise((done, reject) => {
    stream.write(chunk, (error) => error ? reject(error) : done());
  });
}
async function writeAtomicOutput(path, text) {
  await mkdir2(dirname3(resolve4(path)), { recursive: true });
  await saveLocalFile(path, true, (file) => file.writeFile(text, "utf8"));
}
async function writeAtomicBinaryOutput(path, bytes) {
  await mkdir2(dirname3(resolve4(path)), { recursive: true });
  await saveLocalFile(path, true, (file) => file.writeFile(bytes));
}
function abortableSleep(ms, signal) {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((done) => {
    const onAbort = () => {
      clearTimeout(timer);
      done();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      done();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
async function writeAllHandle(file, bytes) {
  for (let offset = 0; offset < bytes.length; ) {
    const { bytesWritten } = await file.write(bytes, offset, bytes.length - offset);
    if (!bytesWritten) throw new Error("Запись локального файла не продвигается.");
    offset += bytesWritten;
  }
}
async function openAtomicTextWriter(path) {
  if (path.includes("\0")) {
    throw new HcmError("INVALID_ARGUMENT", "output: в пути есть нулевой символ.");
  }
  const target = resolve4(path);
  const existing = await stat2(target).catch(() => void 0);
  if (existing?.isDirectory()) {
    throw new HcmError(
      "INVALID_ARGUMENT",
      "output: по этому пути папка, а нужен путь к файлу.",
      "К пути нужно добавить имя файла."
    );
  }
  await mkdir2(dirname3(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  let handle = await open(temporary, "wx", 384);
  let closed = false;
  let totalBytes = 0;
  return {
    async write(chunk) {
      if (!handle) throw new Error("Файл вывода уже закрыт.");
      if (!chunk) return;
      const bytes = Buffer.from(chunk, "utf8");
      await writeAllHandle(handle, bytes);
      totalBytes += bytes.length;
    },
    async commit() {
      if (closed) return totalBytes;
      closed = true;
      const file = handle;
      handle = void 0;
      try {
        await file?.close();
        await rename(temporary, target);
        return totalBytes;
      } catch (error) {
        await unlink2(temporary).catch(() => void 0);
        throw error;
      }
    },
    async abort() {
      if (closed) return;
      closed = true;
      const file = handle;
      handle = void 0;
      await file?.close().catch(() => void 0);
      await unlink2(temporary).catch(() => void 0);
    }
  };
}
var CONFIG_CONFLICT_HINT = "Повторить команду, чтобы не перезаписать чужую правку.";
var CONFIG_LOCK_HINT = "Повторить команду. Если другой процесс не запущен, удалить оставшийся файл блокировки .lock рядом с файлом подключений.";
async function resolveAncestor(path) {
  const tail = [];
  let current = path;
  for (; ; ) {
    try {
      const real = await realpath(current);
      return tail.length ? join3(real, ...tail.reverse()) : real;
    } catch {
      const parent = dirname3(current);
      if (parent === current) return path;
      tail.push(basename3(current));
      current = parent;
    }
  }
}
async function resolveConfigPath(path) {
  let current = resolve4(path);
  for (let hop = 0; hop < 32; hop++) {
    try {
      return await realpath(current);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) {
        current = resolve4(await resolveAncestor(dirname3(current)), await readlink(current));
        continue;
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return resolveAncestor(current);
  }
  throw Object.assign(new Error(`Слишком много уровней символических ссылок: ${path}`), {
    code: "ELOOP"
  });
}
async function writeConfigIfUnchanged(path, expectedText, text) {
  const target = await resolveConfigPath(path);
  await mkdir2(dirname3(target), { recursive: true });
  const lockPath = `${target}.lock`;
  let lock;
  try {
    lock = await open(lockPath, "wx", 384);
  } catch (error) {
    if (error.code === "EEXIST")
      throw new HcmError(
        "CONFIG_CONFLICT",
        "Файл подключений сейчас изменяется другим процессом.",
        CONFIG_LOCK_HINT
      );
    throw error;
  }
  try {
    if (expectedText === void 0) {
      const exists = await stat2(target).then(
        () => true,
        (error) => {
          if (error.code === "ENOENT") return false;
          throw error;
        }
      );
      if (exists)
        throw new HcmError(
          "CONFIG_CONFLICT",
          "Файл подключений появился за время выполнения команды.",
          CONFIG_CONFLICT_HINT
        );
    } else {
      let current;
      try {
        current = await readBounded(createReadStream2(target), MAX_CONFIG_BYTES);
      } catch (error) {
        if (error instanceof CliInputError || error.code === "ENOENT")
          throw new HcmError(
            "CONFIG_CONFLICT",
            "Файл подключений изменился за время выполнения команды.",
            CONFIG_CONFLICT_HINT
          );
        throw error;
      }
      if (current !== expectedText)
        throw new HcmError(
          "CONFIG_CONFLICT",
          "Файл подключений изменился за время выполнения команды.",
          CONFIG_CONFLICT_HINT
        );
    }
    await saveLocalFile(target, true, (file) => file.writeFile(text, "utf8"));
  } finally {
    await lock.close().catch(() => void 0);
    await unlink2(lockPath).catch(() => void 0);
  }
}
async function promptLine(question, secret = false) {
  const lines = createInterface({ input: process4.stdin, output: process4.stderr, terminal: true });
  if (secret) {
    const quiet = lines;
    quiet._writeToOutput = (text) => {
      if (text.includes(question)) process4.stderr.write(question);
    };
  }
  try {
    return await lines.question(question);
  } finally {
    lines.close();
    if (secret) process4.stderr.write("\n");
  }
}
function parseConfirmAnswer(answer) {
  const normalized = answer.trim().toLowerCase();
  return normalized === "y" || normalized === "yes" || normalized === "д" || normalized === "да";
}
async function confirmOnStream(question, input, output, terminal = true, signal) {
  const lines = createInterface({ input, output, terminal });
  const ac = new AbortController();
  let abortedBySigint = false;
  const onSigint = () => {
    abortedBySigint = true;
    if (!ac.signal.aborted) ac.abort();
  };
  const onClose = () => {
    if (!ac.signal.aborted) ac.abort();
  };
  const onExternalAbort = () => {
    abortedBySigint = true;
    if (!ac.signal.aborted) ac.abort();
  };
  if (signal?.aborted) onExternalAbort();
  signal?.addEventListener("abort", onExternalAbort, { once: true });
  lines.once("SIGINT", onSigint);
  lines.once("close", onClose);
  try {
    const answer = await lines.question(question, { signal: ac.signal });
    return abortedBySigint ? false : parseConfirmAnswer(answer);
  } catch {
    return false;
  } finally {
    signal?.removeEventListener("abort", onExternalAbort);
    lines.off("SIGINT", onSigint);
    lines.off("close", onClose);
    lines.close();
    if (abortedBySigint) output.write("\n");
  }
}
async function confirmLine(question) {
  const ac = new AbortController();
  const onSignal = () => ac.abort();
  process4.once("SIGINT", onSignal);
  process4.once("SIGTERM", onSignal);
  try {
    return await confirmOnStream(question, process4.stdin, process4.stderr, true, ac.signal);
  } finally {
    process4.off("SIGINT", onSignal);
    process4.off("SIGTERM", onSignal);
  }
}
var EDITOR_HINT = "Указать редактор через --editor, переменную окружения WTCTL_EDITOR, VISUAL или EDITOR.";
function resolveEditorCommand(explicit, env = process4.env, platform = process4.platform) {
  for (const candidate of [explicit, env.WTCTL_EDITOR, env.VISUAL, env.EDITOR]) {
    if (candidate !== void 0 && candidate.trim() !== "") return candidate.trim();
  }
  return platform === "win32" ? "notepad" : "vi";
}
function parseEditorCommand(command, platform = process4.platform) {
  const tokens = [];
  let current = "";
  let hasToken = false;
  let i = 0;
  while (i < command.length) {
    const ch = command[i];
    if (/\s/.test(ch)) {
      if (hasToken) {
        tokens.push(current);
        current = "";
        hasToken = false;
      }
      i++;
      continue;
    }
    if (ch === "'") {
      hasToken = true;
      i++;
      let closed = false;
      while (i < command.length) {
        if (command[i] === "'") {
          closed = true;
          i++;
          break;
        }
        current += command[i];
        i++;
      }
      if (!closed) {
        throw new HcmError(
          "EDITOR_FAILED",
          "В команде редактора не закрыта одинарная кавычка.",
          EDITOR_HINT
        );
      }
      continue;
    }
    if (ch === '"') {
      hasToken = true;
      i++;
      let closed = false;
      while (i < command.length) {
        const inner = command[i];
        if (inner === "\\") {
          let slashes = 0;
          while (i < command.length && command[i] === "\\") {
            slashes++;
            i++;
          }
          if (i < command.length && command[i] === '"') {
            current += "\\".repeat(Math.floor(slashes / 2));
            if (slashes % 2 === 1) {
              current += '"';
              i++;
            } else {
              closed = true;
              i++;
              break;
            }
          } else {
            current += "\\".repeat(slashes);
          }
          continue;
        }
        if (inner === '"') {
          closed = true;
          i++;
          break;
        }
        current += inner;
        i++;
      }
      if (!closed) {
        throw new HcmError(
          "EDITOR_FAILED",
          "В команде редактора не закрыта двойная кавычка.",
          EDITOR_HINT
        );
      }
      continue;
    }
    if (ch === "\\") {
      if (platform === "win32") {
        let slashes = 0;
        while (i < command.length && command[i] === "\\") {
          slashes++;
          i++;
        }
        if (i < command.length && command[i] === '"') {
          current += "\\".repeat(Math.floor(slashes / 2));
          if (slashes % 2 === 1) {
            current += '"';
            i++;
            hasToken = true;
          } else if (slashes > 0) {
            hasToken = true;
          }
        } else {
          current += "\\".repeat(slashes);
          hasToken = true;
        }
      } else {
        i++;
        if (i < command.length) {
          current += command[i];
          i++;
        } else {
          current += "\\";
        }
        hasToken = true;
      }
      continue;
    }
    current += ch;
    hasToken = true;
    i++;
  }
  if (hasToken) tokens.push(current);
  if (tokens.length === 0 || tokens[0] === "") {
    throw new HcmError("EDITOR_FAILED", "Команда редактора не задана или пуста.", EDITOR_HINT);
  }
  return tokens;
}
function isRegularFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
function resolveWindowsExecutable(bin, env = process4.env) {
  const rawExts = (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").map((ext) => ext.trim()).filter((ext) => ext.startsWith("."));
  const exts = rawExts.length > 0 ? rawExts : [".COM", ".EXE", ".BAT", ".CMD"];
  const hasExt = extname(bin) !== "";
  const hasPath = /[\\/:]/.test(bin);
  const checkIn = (candidate) => {
    if (hasExt && isRegularFile(candidate)) return candidate;
    for (const ext of exts) {
      if (hasExt && candidate.toLowerCase().endsWith(ext.toLowerCase())) continue;
      const withExt = `${candidate}${ext}`;
      if (isRegularFile(withExt)) return withExt;
    }
    if (!hasExt && isRegularFile(candidate)) return candidate;
    return void 0;
  };
  if (hasPath) return checkIn(bin) ?? bin;
  const pathVar = env.PATH ?? env.Path ?? "";
  for (const rawDir of pathVar.split(";")) {
    const dir = rawDir.trim().replace(/^"(.*)"$/, "$1");
    if (!dir) continue;
    const found = checkIn(join3(dir, bin));
    if (found) return found;
  }
  return bin;
}
function escapeCmdMeta(text) {
  return text.replace(/([()!%^&;"<>|])/g, "^$1");
}
function escapeCmdExe(exe) {
  return exe.replace(/([()!%^&;"<>|\s])/g, "^$1");
}
function quoteForCmdArg(arg) {
  const quoted = `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1")}"`;
  return escapeCmdMeta(quoted);
}
async function launchEditor(command, filePath, options) {
  const resolvedCommand = resolveEditorCommand(command);
  const [bin, ...args] = parseEditorCommand(resolvedCommand);
  const fullArgs = [...args, filePath];
  if ([bin, ...fullArgs].some((part) => /[\r\n\0]/.test(part))) {
    throw new HcmError(
      "EDITOR_FAILED",
      "Команда редактора или путь к файлу содержат недопустимые управляющие символы.",
      EDITOR_HINT
    );
  }
  let spawnExe = bin;
  let spawnArgs = fullArgs;
  let windowsVerbatimArguments = false;
  if (process4.platform === "win32") {
    const resolvedBin = resolveWindowsExecutable(bin);
    if (/\.(?:cmd|bat)$/i.test(resolvedBin)) {
      spawnExe = process4.env.ComSpec || "cmd.exe";
      const cmdLine = [escapeCmdExe(resolvedBin), ...fullArgs.map(quoteForCmdArg)].join(" ");
      spawnArgs = ["/d", "/s", "/c", cmdLine];
      windowsVerbatimArguments = true;
    } else {
      spawnExe = resolvedBin;
    }
  }
  return await new Promise((resolveCode, reject) => {
    const child = spawn(spawnExe, spawnArgs, {
      stdio: options?.redirectStdoutToStderr ? ["inherit", process4.stderr, "inherit"] : "inherit",
      shell: false,
      ...windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}
    });
    child.once("error", (error) => {
      const safeBin = bin.replace(/[\u0000-\u001f\u007f-\u009f]/g, "");
      if (error.code === "ENOENT") {
        reject(
          new HcmError("EDITOR_FAILED", `Не удалось найти редактор "${safeBin}".`, EDITOR_HINT)
        );
      } else {
        reject(
          new HcmError(
            "EDITOR_FAILED",
            `Не удалось запустить редактор "${safeBin}"${error.code ? ` (${error.code})` : ""}.`,
            EDITOR_HINT
          )
        );
      }
    });
    child.once("close", (code) => resolveCode(code ?? 1));
  });
}
function terminalColumns() {
  if (typeof process4.stdout.columns === "number" && process4.stdout.columns > 0)
    return process4.stdout.columns;
  const raw = process4.env.COLUMNS;
  if (raw !== void 0 && /^\d+$/.test(raw)) {
    const parsed = Number(raw);
    if (parsed > 0) return parsed;
  }
  return void 0;
}
function nodeIo() {
  const stdoutIsTTY = process4.stdout.isTTY === true;
  const stderrIsTTY = process4.stderr.isTTY === true;
  const columns = terminalColumns();
  return {
    ...process4.stdin.isTTY && stderrIsTTY ? { prompt: promptLine, confirm: confirmLine } : {},
    pretty: stdoutIsTTY,
    stdoutIsTTY,
    stderrIsTTY,
    ...columns === void 0 ? {} : { columns },
    sleep: abortableSleep,
    onInterrupt: (handler) => {
      const onSignal = () => handler();
      process4.on("SIGINT", onSignal);
      process4.on("SIGTERM", onSignal);
      return () => {
        process4.off("SIGINT", onSignal);
        process4.off("SIGTERM", onSignal);
      };
    },
    writeOut: (text) => writeStream(process4.stdout, text),
    writeBinaryOut: (bytes) => writeStream(process4.stdout, bytes),
    writeError: (text) => writeStream(process4.stderr, text),
    readFile: (path, maximumBytes) => readBounded(createReadStream2(path), maximumBytes),
    readBinaryFile: (path) => readBoundedBytes(createReadStream2(path)),
    readBinaryStdin: () => {
      if (process4.stdin.isTTY) throw new CliInputError("--stdin ожидает перенаправленный ввод.");
      return readBoundedBytes(process4.stdin);
    },
    readStdin: (maximumBytes) => {
      if (process4.stdin.isTTY)
        throw new CliInputError(
          "--stdin ожидает перенаправленный ввод.",
          "Нужно передать файл через --input-file или перенаправить текст в stdin."
        );
      return readBounded(process4.stdin, maximumBytes);
    },
    writeFile: writeAtomicOutput,
    writeBinaryFile: writeAtomicBinaryOutput,
    openTextWriter: openAtomicTextWriter,
    writeFileIfUnchanged: writeConfigIfUnchanged,
    launchEditor,
    forceExit: (code) => process4.exit(code)
  };
}

// src/cli/live-logs.ts
var DEFAULT_TAIL_LINES = 50;
var DEFAULT_INTERVAL_SEC = 2;
var INITIAL_FOLLOW_EVENTS = 10;
var MAX_TAIL_EXPAND_BYTES = 4 * 1024 * 1024;
var MAX_TAIL_EXPAND_ATTEMPTS = 8;
var DEFAULT_FOLLOW_WINDOW_BYTES = 512 * 1024;
var CLOSE_GRACE_MS = 250;
function isLogTypeName(value) {
  return value.length > 0 && !/[./\\:]/.test(value);
}
function isRecord5(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function quoteCliArg(value) {
  return /\s/.test(value) ? JSON.stringify(value) : value;
}
function entryOverlapKey(entry) {
  const time = typeof entry.time === "string" ? entry.time : "";
  const context = typeof entry.context === "string" ? entry.context : "";
  const text = typeof entry.text === "string" ? entry.text.replace(/\n+$/, "") : "";
  return `${time}\0${context}\0${text}`;
}
function containsEventSlice(haystack, needle) {
  if (needle.length === 0) return haystack.length > 0;
  if (needle.length > haystack.length) return false;
  for (let start = 0; start <= haystack.length - needle.length; start++) {
    let match = true;
    for (let i = 0; i < needle.length; i++) {
      if (haystack[start + i] !== needle[i]) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}
function dedupeAfterTail(followEvents, followKeys, tailKeys) {
  const maxOverlap = Math.min(tailKeys.length, followKeys.length);
  for (let len = maxOverlap; len > 0; len--) {
    let match = true;
    const tailStart = tailKeys.length - len;
    for (let i = 0; i < len; i++) {
      if (tailKeys[tailStart + i] !== followKeys[i]) {
        match = false;
        break;
      }
    }
    if (match) return followEvents.slice(len);
  }
  return followEvents;
}
async function raceWithAbort(promise, signal) {
  if (signal.aborted) {
    promise.catch(() => void 0);
    return { aborted: true };
  }
  let onAbort;
  const abortPromise = new Promise((resolve6) => {
    onAbort = () => resolve6({ aborted: true });
    signal.addEventListener("abort", onAbort, { once: true });
  });
  const guarded = promise.then(
    (value) => ({ aborted: false, value }),
    (error) => {
      if (signal.aborted) return { aborted: true };
      throw error;
    }
  );
  try {
    return await Promise.race([guarded, abortPromise]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
    promise.catch(() => void 0);
  }
}
function planLogExecution(args, invocation, outputMode, io) {
  const action = args.positionals[1];
  if (action === "list") {
    assertFormatSupported(invocation.operationId, outputMode.format, invocation.args);
    return { kind: "passthrough" };
  }
  const file = String(invocation.args.file ?? "");
  const resolveType = isLogTypeName(file);
  const output = stringOption(args, "output");
  if (action === "read" || action === "search") {
    assertFormatSupported(invocation.operationId, outputMode.format, invocation.args);
    return { kind: "single", resolveType };
  }
  if (action === "tail") {
    const lines = integerOption(args, "lines", 1, 1e4);
    const follow = args.options.follow === true;
    const intervalSec2 = intervalOption(args, "interval", 0.5, 60);
    const tailBytes2 = integerOption(args, "tail-bytes", 1, Number.MAX_SAFE_INTEGER);
    if (follow) {
      if (output !== void 0) {
        throw new CliInputError("Потоковое слежение несовместимо с --output.");
      }
      if (outputMode.requested === "json" || outputMode.format === "csv" || outputMode.format === "tsv") {
        throw new CliInputError(
          `Потоковое слежение не поддерживает формат ${outputMode.format}.`,
          "Подходят обычный вывод в терминале, --format table, --format jsonl или --format raw."
        );
      }
      const streamFormat = outputMode.format === "jsonl" ? "jsonl" : outputMode.format === "raw" ? "raw" : "human";
      const initialLines = lines !== void 0 ? lines : tailBytes2 === void 0 && streamFormat === "human" ? DEFAULT_TAIL_LINES : void 0;
      const effectiveInterval = intervalSec2 ?? DEFAULT_INTERVAL_SEC;
      return {
        kind: "stream",
        mode: "tail",
        file,
        ...initialLines === void 0 ? {} : { lines: initialLines },
        ...tailBytes2 === void 0 ? {} : { tailBytes: tailBytes2 },
        intervalSec: effectiveInterval,
        intervalMs: Math.round(effectiveInterval * 1e3),
        streamFormat,
        resolveType
      };
    }
    if (lines !== void 0) {
      return {
        kind: "tail",
        file,
        lines,
        ...tailBytes2 === void 0 ? {} : { tailBytes: tailBytes2 },
        resolveType
      };
    }
    if (tailBytes2 === void 0 && (outputMode.format === "human" || outputMode.format === "table")) {
      return {
        kind: "tail",
        file,
        lines: DEFAULT_TAIL_LINES,
        resolveType
      };
    }
    assertFormatSupported(
      invocation.operationId,
      outputMode.format,
      invocation.args,
      "wtctl logs tail"
    );
    return { kind: "single", resolveType };
  }
  const once = args.options.once === true;
  const intervalSec = intervalOption(args, "interval", 0.5, 60);
  const cursor = stringOption(args, "cursor");
  const tailBytes = integerOption(args, "tail-bytes", 1, Number.MAX_SAFE_INTEGER);
  const full = args.options.full === true;
  if (once) {
    assertFormatSupported(invocation.operationId, outputMode.format, invocation.args);
    return { kind: "single", resolveType };
  }
  if (intervalSec !== void 0) {
    if (output !== void 0) {
      throw new CliInputError("Потоковое слежение несовместимо с --output.");
    }
    if (outputMode.format === "json" || outputMode.format === "csv" || outputMode.format === "tsv") {
      throw new CliInputError(
        `Потоковый режим logs follow не поддерживает формат ${outputMode.format}.`,
        "В терминале подходит вывод по умолчанию или --format table, при перенаправлении (в pipe) — --format jsonl, --format raw или --format table; для одного опроса — --once."
      );
    }
    const streamFormat = outputMode.format === "jsonl" ? "jsonl" : outputMode.format === "raw" ? "raw" : "human";
    return {
      kind: "stream",
      mode: "follow",
      file,
      ...cursor === void 0 ? {} : { cursor },
      ...tailBytes === void 0 ? {} : { tailBytes },
      ...full ? { full: true } : {},
      intervalSec,
      intervalMs: Math.round(intervalSec * 1e3),
      streamFormat,
      resolveType
    };
  }
  if (outputMode.format === "human" || outputMode.format === "table") {
    if (output !== void 0) {
      throw new CliInputError(
        "Потоковое слежение несовместимо с --output.",
        "Для одного опроса с сохранением в файл нужен флаг --once."
      );
    }
    return {
      kind: "stream",
      mode: "follow",
      file,
      ...cursor === void 0 ? {} : { cursor },
      ...tailBytes === void 0 ? {} : { tailBytes },
      ...full ? { full: true } : {},
      intervalSec: DEFAULT_INTERVAL_SEC,
      intervalMs: DEFAULT_INTERVAL_SEC * 1e3,
      streamFormat: "human",
      resolveType
    };
  }
  if (io.stdoutIsTTY === true && (outputMode.format === "csv" || outputMode.format === "tsv")) {
    throw new CliInputError(
      `Потоковый режим logs follow не поддерживает --format ${outputMode.format}.`,
      "Для одного опроса нужен --once, для потока — вывод без --format (или --format table), либо --format jsonl/--format raw с --interval."
    );
  }
  assertFormatSupported(invocation.operationId, outputMode.format, invocation.args);
  return { kind: "single", resolveType };
}
async function resolveLogFile(file, runtime, io, outputMode, quiet, progress) {
  if (!isLogTypeName(file)) return { ok: true, file };
  const listed = await runtime.call("logs.list", { type: file, limit: 1 });
  if (!listed.ok) return { ok: false, result: listed };
  const files = isRecord5(listed.data) && Array.isArray(listed.data.files) ? listed.data.files : [];
  const latest = files.length > 0 && isRecord5(files[0]) ? files[0].name : void 0;
  if (typeof latest !== "string" || !latest) {
    throw new HcmError(
      "LOG_NOT_FOUND",
      `Файлы лога типа "${file}" не найдены.`,
      "Список доступных типов и файлов показывает wtctl logs list."
    );
  }
  if (!quiet && (outputMode.format === "human" || outputMode.format === "table")) {
    await progress?.clear();
    const styler = createStyler(resolveColor(io, "stderr"));
    try {
      await io.writeError(`${styler.dim(`Файл лога: ${latest}`)}
`);
    } catch {
    }
  }
  return { ok: true, file: latest };
}
function initialTailWindowBytes(lines, outputLimitBytes, maxWindowBytes) {
  const safeMax = Math.max(512, Math.floor(outputLimitBytes * 0.55));
  return Math.min(maxWindowBytes, safeMax, Math.max(16 * 1024, lines * 1024));
}
async function extractReadPayload(runtime, result, fallbackFile) {
  const raw = result.meta.truncated === true ? await readStoredJson(runtime, result) : result.data;
  const data = isRecord5(raw) ? raw : {};
  const text = typeof data.text === "string" ? data.text : "";
  const resolvedFile = typeof data.file === "string" ? data.file : fallbackFile;
  const sizeBytes = typeof data.sizeBytes === "number" ? data.sizeBytes : 0;
  const tailOnly = data.tailOnly === true;
  const fingerprint = typeof data.fingerprint === "string" ? data.fingerprint : "";
  const allEvents = parseLogEvents(text, void 0, tailOnly);
  return { resolvedFile, sizeBytes, tailOnly, fingerprint, allEvents };
}
async function readTailEvents(runtime, file, lines, explicitTailBytes, outputLimitBytes, maxResponseBytes) {
  const maxWindowBytes = Math.min(MAX_TAIL_EXPAND_BYTES, maxLogTailBytes(maxResponseBytes));
  let currentWindow = explicitTailBytes ?? initialTailWindowBytes(lines, outputLimitBytes, maxWindowBytes);
  let res = await runtime.call("logs.read", { file, tailBytes: currentWindow });
  if (!res.ok) return { ok: false, result: res };
  let parsed = await extractReadPayload(runtime, res, file);
  for (let attempt = 0; attempt < MAX_TAIL_EXPAND_ATTEMPTS; attempt++) {
    if (explicitTailBytes !== void 0 || parsed.allEvents.length >= lines || !parsed.tailOnly || parsed.sizeBytes <= currentWindow || currentWindow >= maxWindowBytes) {
      break;
    }
    const estimated = parsed.allEvents.length > 0 ? Math.ceil(currentWindow * lines * 1.25 / parsed.allEvents.length) : currentWindow * 4;
    const desired = Math.max(currentWindow * 4, estimated);
    const nextWindow = desired >= parsed.sizeBytes ? Math.min(maxWindowBytes, Math.max(desired, parsed.sizeBytes + 4096)) : Math.min(maxWindowBytes, desired);
    if (nextWindow <= currentWindow) break;
    currentWindow = nextWindow;
    const expanded = await runtime.call("logs.read", { file, tailBytes: currentWindow });
    if (!expanded.ok) return { ok: false, result: expanded };
    res = expanded;
    parsed = await extractReadPayload(runtime, expanded, file);
  }
  const sliced = parsed.allEvents.slice(-lines);
  return {
    ok: true,
    result: res,
    file: parsed.resolvedFile,
    sizeBytes: parsed.sizeBytes,
    tailOnly: parsed.tailOnly,
    fingerprint: parsed.fingerprint,
    allEvents: parsed.allEvents,
    sliced,
    entries: sliced.map(logEntry),
    shortByLimit: parsed.tailOnly && sliced.length < lines,
    windowLimitBytes: explicitTailBytes ?? maxWindowBytes
  };
}
async function runLogTail(plan, parsed, io, runtime, outputMode, outputLimitBytes, maxResponseBytes, progress, closeRuntime) {
  const quiet = parsed.options.quiet === true;
  const resolved = plan.resolveType ? await resolveLogFile(plan.file, runtime, io, outputMode, quiet, progress) : { ok: true, file: plan.file };
  if (!resolved.ok) return { handled: false, result: resolved.result };
  const read = await readTailEvents(
    runtime,
    resolved.file,
    plan.lines,
    plan.tailBytes,
    outputLimitBytes,
    maxResponseBytes
  );
  if (!read.ok) return { handled: false, result: read.result };
  const trimmed = read.allEvents.length > read.sliced.length;
  const slicedRawText = read.sliced.length ? `${read.sliced.map((event) => event.text).join("\n")}
` : "";
  if (outputMode.format === "json") {
    const { truncated: _, resultId: __, ...cleanMeta } = read.result.meta;
    return {
      handled: false,
      result: {
        ...read.result,
        meta: cleanMeta,
        data: {
          file: read.file,
          text: slicedRawText,
          sizeBytes: read.sizeBytes,
          tailOnly: read.tailOnly || trimmed,
          fingerprint: read.fingerprint
        }
      }
    };
  }
  await progress.stop();
  const closed = await closeRuntime();
  const baseResult = closed.failed && closed.diagnostic ? frontendFailure(read.result, closed.diagnostic, "cleanupFailed") : read.result;
  const output = stringOption(parsed, "output");
  const styler = createStyler(output ? false : resolveColor(io, "stdout"));
  const quotedFile = quoteCliArg(read.file);
  const limitReason = plan.tailBytes !== void 0 ? `в пределах --tail-bytes ${formatBytes(plan.tailBytes)}` : `прочитано не больше ${formatBytes(read.windowLimitBytes)} с конца файла`;
  let text;
  let stderrNote;
  if (outputMode.format === "human" || outputMode.format === "table") {
    text = read.entries.length ? `${renderLogEvents(read.entries, styler).join("\n")}
` : `${styler.dim("Файл пуст.")}
`;
    if (!quiet && (read.tailOnly || trimmed)) {
      const stderrStyler = createStyler(resolveColor(io, "stderr"));
      const size = read.sizeBytes > 0 ? formatBytes(read.sizeBytes) : "";
      if (read.shortByLimit) {
        stderrNote = `${stderrStyler.yellow(`Показан конец файла ${read.file} (${read.entries.length} из запрошенных ${plan.lines} событий: ${limitReason}${size ? `, файл ${size}` : ""}); весь файл: wtctl logs read ${quotedFile} --full.`)}
`;
      } else {
        const detail = trimmed ? `последние ${read.entries.length} событий${size ? `, ${size}` : ""}` : size;
        stderrNote = `${stderrStyler.dim(`Показан конец файла ${read.file}${detail ? ` (${detail})` : ""}; весь файл: wtctl logs read ${quotedFile} --full.`)}
`;
      }
    }
  } else if (outputMode.format === "jsonl") {
    text = read.entries.length ? `${read.entries.map((entry) => compactJson(entry)).join("\n")}
` : "";
    if (!quiet && read.shortByLimit) {
      stderrNote = `Показан конец файла ${read.file} (${read.entries.length} из запрошенных ${plan.lines} событий: ${limitReason}); весь файл: wtctl logs read ${quotedFile} --full.
`;
    }
  } else if (outputMode.format === "csv" || outputMode.format === "tsv") {
    const headers = ["sequence", "time", "context", "level", "text"];
    const rows2 = read.entries.map((entry) => [
      entry.sequence,
      entry.time ?? "",
      entry.context ?? "",
      entry.level,
      entry.text
    ]);
    text = outputMode.format === "csv" ? formatCsv(headers, rows2) : formatTsv(headers, rows2);
    if (!quiet && read.shortByLimit) {
      stderrNote = `Показан конец файла ${read.file} (${read.entries.length} из запрошенных ${plan.lines} событий: ${limitReason}); весь файл: wtctl logs read ${quotedFile} --full.
`;
    }
  } else {
    text = slicedRawText;
    if (!quiet && (read.tailOnly || trimmed)) {
      stderrNote = read.shortByLimit ? `Показан конец файла ${read.file} (${read.entries.length} из запрошенных ${plan.lines} событий: ${limitReason}); весь файл: wtctl logs read ${quotedFile} --full.
` : `Показан конец файла ${read.file}${read.sizeBytes > 0 ? ` (${read.sizeBytes} Б)` : ""}; весь файл: wtctl logs read ${quotedFile} --full.
`;
    }
  }
  if (output) {
    try {
      await io.writeFile(output, text);
      const bytes = Buffer.byteLength(text, "utf8");
      if (!await reportSaved(output, bytes, baseResult, parsed, io)) {
        return { handled: true, exitCode: 1 };
      }
      if (stderrNote) {
        try {
          await io.writeError(stderrNote);
        } catch {
        }
      }
      return { handled: true, exitCode: closed.failed ? 1 : 0 };
    } catch {
      await safeDiagnostic(
        io,
        failure(
          "cli.output_failed",
          "Результат команды получен, но сохранить локальный файл не удалось."
        ),
        "human"
      );
      return { handled: true, exitCode: 1 };
    }
  }
  try {
    await io.writeOut(text);
  } catch {
    return { handled: true, exitCode: 1 };
  }
  if (stderrNote) {
    try {
      await io.writeError(stderrNote);
    } catch {
    }
  }
  return { handled: true, exitCode: closed.failed ? 1 : 0 };
}
function formatStreamEvents(events, format, io) {
  if (!events.length) return "";
  if (format === "jsonl") {
    return `${events.map((event) => compactJson(event)).join("\n")}
`;
  }
  if (format === "raw") {
    return formatRawLogEvents(events);
  }
  const styler = createStyler(resolveColor(io, "stdout"));
  return `${renderLogEvents(events, styler).join("\n")}
`;
}
async function runLogStream(plan, parsed, io, runtime, outputMode, outputLimitBytes, maxResponseBytes, closeRuntime) {
  const quiet = parsed.options.quiet === true;
  const sleep = io.sleep ?? abortableSleep;
  const followWindowBytes = Math.min(
    plan.tailBytes ?? DEFAULT_FOLLOW_WINDOW_BYTES,
    maxLogTailBytes(maxResponseBytes)
  );
  const controller = new AbortController();
  let forceCloseSkip;
  let inFlightRequest = false;
  const abort = () => {
    if (!controller.signal.aborted) controller.abort();
    else forceCloseSkip?.();
  };
  if (io.signal?.aborted) abort();
  const onExternalAbort = () => abort();
  io.signal?.addEventListener("abort", onExternalAbort, { once: true });
  const unbindInterrupt = io.onInterrupt?.(abort);
  const reportError = async (result) => {
    if (controller.signal.aborted) return 0;
    await safeDiagnostic(
      io,
      errorInFrontendTerms(result, "cli"),
      outputMode.humanErrors ? "human" : "json"
    );
    return 1;
  };
  const raceRequest = async (promise) => {
    inFlightRequest = true;
    const result = await raceWithAbort(promise, controller.signal);
    if (!result.aborted) inFlightRequest = false;
    return result;
  };
  let exitCode = 0;
  const runBody = async () => {
    if (controller.signal.aborted) return 0;
    let file = plan.file;
    if (plan.resolveType) {
      const raced = await raceRequest(resolveLogFile(plan.file, runtime, io, outputMode, quiet));
      if (raced.aborted) return 0;
      if (!raced.value.ok) return await reportError(raced.value.result);
      file = raced.value.file;
    }
    let cursor = plan.cursor;
    let pendingTailKeys;
    let clipFirstFollowTo;
    let reportedUnavailable = false;
    let waitBeforeFirstPoll = false;
    let idlePolls = 0;
    const trySwitchToLatestFile = async () => {
      if (!plan.resolveType) return false;
      const raced = await raceRequest(runtime.call("logs.list", { type: plan.file, limit: 1 }));
      if (raced.aborted || !raced.value.ok) return false;
      const files = isRecord5(raced.value.data) && Array.isArray(raced.value.data.files) ? raced.value.data.files : [];
      const latest = files.length > 0 && isRecord5(files[0]) ? files[0].name : void 0;
      if (typeof latest !== "string" || !latest || latest === file) return false;
      file = latest;
      cursor = void 0;
      pendingTailKeys = void 0;
      idlePolls = 0;
      reportedUnavailable = false;
      if (!quiet && (plan.streamFormat === "human" || io.stderrIsTTY === true)) {
        const styler = createStyler(resolveColor(io, "stderr"));
        await safeWriteStderr(io, `${styler.dim(`Файл лога: ${latest}`)}
`);
      }
      const readArgs = {
        file: latest,
        ...plan.full ? { full: true } : { tailBytes: followWindowBytes }
      };
      const racedRead = await raceRequest(runtime.call("logs.read", readArgs));
      if (!racedRead.aborted && racedRead.value.ok) {
        try {
          const racedPayload = await raceRequest(
            extractReadPayload(runtime, racedRead.value, latest)
          );
          if (!racedPayload.aborted) {
            const readCursor = buildLogFollowCursor(
              racedPayload.value.resolvedFile,
              racedPayload.value.fingerprint,
              racedPayload.value.sizeBytes,
              racedPayload.value.allEvents
            );
            if (readCursor !== void 0) {
              const entries = racedPayload.value.allEvents.map(logEntry);
              if (entries.length > 0) {
                const chunk = formatStreamEvents(entries, plan.streamFormat, io);
                if (chunk) await io.writeOut(chunk);
              }
              cursor = readCursor;
              waitBeforeFirstPoll = true;
            }
          }
        } catch {
        }
      }
      return true;
    };
    const needsReadTail = plan.mode === "tail" && (plan.lines !== void 0 && plan.lines > INITIAL_FOLLOW_EVENTS || plan.lines === void 0 && plan.tailBytes !== void 0);
    if (needsReadTail) {
      const readLines = plan.lines ?? 1e4;
      const racedTail = await raceRequest(
        readTailEvents(
          runtime,
          file,
          readLines,
          plan.tailBytes,
          outputLimitBytes,
          maxResponseBytes
        )
      );
      if (racedTail.aborted) return 0;
      const tailRes = racedTail.value;
      if (!tailRes.ok) {
        const code = tailRes.result.error?.code;
        if (code !== "LOG_READ_UNAVAILABLE" && code !== "LOG_CHANGED") {
          return await reportError(tailRes.result);
        }
        reportedUnavailable = await reportBusy(io, plan, quiet, reportedUnavailable);
        waitBeforeFirstPoll = true;
      } else {
        const chunk = formatStreamEvents(tailRes.entries, plan.streamFormat, io);
        if (chunk) await io.writeOut(chunk);
        const readCursor = buildLogFollowCursor(
          tailRes.file,
          tailRes.fingerprint,
          tailRes.sizeBytes,
          tailRes.allEvents
        );
        if (readCursor !== void 0) {
          cursor = readCursor;
          waitBeforeFirstPoll = true;
        } else {
          pendingTailKeys = tailRes.entries.slice(-INITIAL_FOLLOW_EVENTS).map(entryOverlapKey);
        }
      }
    } else if (plan.mode === "tail" && plan.lines !== void 0) {
      clipFirstFollowTo = plan.lines;
    }
    let firstPoll = true;
    while (!controller.signal.aborted) {
      if (!firstPoll || waitBeforeFirstPoll) {
        await sleep(plan.intervalMs, controller.signal);
        if (controller.signal.aborted) return 0;
      }
      firstPoll = false;
      waitBeforeFirstPoll = false;
      const prevCursor = cursor;
      const followArgs = {
        file,
        ...optional("cursor", cursor),
        ...optional("tailBytes", plan.tailBytes),
        ...plan.full ? { full: true } : {}
      };
      const raced = await raceRequest(runtime.call("logs.follow", followArgs));
      if (raced.aborted) return 0;
      const res = raced.value;
      if (!res.ok) {
        const code = res.error?.code;
        if (code === "LOG_READ_UNAVAILABLE" || code === "LOG_CHANGED") {
          reportedUnavailable = await reportBusy(io, plan, quiet, reportedUnavailable);
          continue;
        }
        if (code === "LOG_NOT_FOUND") {
          const switched = await trySwitchToLatestFile();
          if (controller.signal.aborted) return 0;
          if (switched) {
            firstPoll = true;
            continue;
          }
        }
        return await reportError(res);
      }
      reportedUnavailable = false;
      let payload = res.data;
      if (res.meta.truncated === true) {
        const racedStored = await raceRequest(readStoredJson(runtime, res));
        if (racedStored.aborted) return 0;
        payload = racedStored.value;
      }
      const data = isRecord5(payload) ? payload : void 0;
      if (!data || typeof data.cursor !== "string") {
        return await reportError(
          failure(
            "LOG_RESPONSE_INVALID",
            "Ответ logs.follow не содержит курсора для продолжения слежения."
          )
        );
      }
      let nextCursor = data.cursor;
      let events = Array.isArray(data.events) ? data.events : [];
      let omitted = typeof data.omitted === "number" ? data.omitted : 0;
      let gapPossible = data.gapPossible === true;
      let resetReason = typeof data.resetReason === "string" ? data.resetReason : void 0;
      if (omitted > 0 && prevCursor !== void 0) {
        const readArgs = {
          file,
          ...plan.full ? { full: true } : { tailBytes: followWindowBytes }
        };
        const racedRecover = await raceRequest(runtime.call("logs.read", readArgs));
        if (racedRecover.aborted) return 0;
        if (racedRecover.value.ok) {
          try {
            const racedExtract = await raceRequest(
              extractReadPayload(runtime, racedRecover.value, file)
            );
            if (racedExtract.aborted) return 0;
            const diff = sliceEventsAfterCursorToken(
              prevCursor,
              racedExtract.value.resolvedFile,
              racedExtract.value.fingerprint,
              racedExtract.value.sizeBytes,
              racedExtract.value.allEvents
            );
            if (diff && !diff.gapPossible && diff.events.length >= events.length) {
              const recoveredEntries = diff.events.map(logEntry);
              const followKeys = events.map(
                (item) => isRecord5(item) ? entryOverlapKey(item) : ""
              );
              const recoveredKeys = recoveredEntries.map(entryOverlapKey);
              if (containsEventSlice(recoveredKeys, followKeys)) {
                events = recoveredEntries;
                nextCursor = diff.cursor;
                omitted = 0;
                gapPossible = false;
                resetReason = void 0;
              }
            }
          } catch {
          }
        }
      }
      cursor = nextCursor;
      if (pendingTailKeys !== void 0) {
        const followKeys = events.map((item) => isRecord5(item) ? entryOverlapKey(item) : "");
        events = dedupeAfterTail(events, followKeys, pendingTailKeys);
        pendingTailKeys = void 0;
      } else if (clipFirstFollowTo !== void 0) {
        events = events.slice(-clipFirstFollowTo);
        clipFirstFollowTo = void 0;
      }
      if (events.length > 0) {
        idlePolls = 0;
        const chunk = formatStreamEvents(events, plan.streamFormat, io);
        if (chunk) await io.writeOut(chunk);
      } else if (data.changed === false) {
        idlePolls++;
        if (plan.resolveType && (idlePolls === 1 || idlePolls % 5 === 0)) {
          const switched = await trySwitchToLatestFile();
          if (controller.signal.aborted) return 0;
          if (switched) {
            firstPoll = true;
            continue;
          }
        }
      }
      if (!quiet) {
        const stderrStyler = createStyler(resolveColor(io, "stderr"));
        if (omitted > 0) {
          await safeWriteStderr(
            io,
            `${stderrStyler.yellow(`Пропущено ранних событий: ${omitted}.`)}
`
          );
        }
        if (gapPossible) {
          const reason = resetReason ? ` (${resetReason})` : "";
          await safeWriteStderr(
            io,
            `${stderrStyler.yellow(`Возможен пропуск событий${reason}.`)}
`
          );
        }
      }
    }
    return 0;
  };
  try {
    exitCode = await runBody();
  } catch (error) {
    if (controller.signal.aborted) {
      exitCode = 0;
    } else if (error?.code === "EPIPE") {
      exitCode = 0;
    } else if (error instanceof HcmError) {
      exitCode = await reportError({
        ...failure(error.code, error.message, error.hint),
        error: error.toJSON()
      });
    } else {
      throw error;
    }
  } finally {
    const closing = closeRuntime();
    let timedOutOnHungSocket = false;
    if (controller.signal.aborted && inFlightRequest) {
      let graceTimer;
      const grace = new Promise((resolve6) => {
        forceCloseSkip = () => resolve6("timed-out");
        graceTimer = setTimeout(() => resolve6("timed-out"), CLOSE_GRACE_MS);
        graceTimer.unref?.();
      });
      const settled = await Promise.race([
        closing.then((value) => ({ done: true, value })),
        grace.then(() => ({ done: false }))
      ]);
      if (graceTimer !== void 0) clearTimeout(graceTimer);
      forceCloseSkip = void 0;
      if (!settled.done) {
        timedOutOnHungSocket = true;
        closing.catch(() => void 0);
      } else if (exitCode === 0 && settled.value.failed) {
        exitCode = 1;
      }
    } else {
      const closed = await closing;
      if (exitCode === 0 && closed.failed) exitCode = 1;
    }
    io.signal?.removeEventListener("abort", onExternalAbort);
    unbindInterrupt?.();
    if (timedOutOnHungSocket) io.forceExit?.(exitCode);
  }
  return exitCode;
}
async function reportBusy(io, plan, quiet, alreadyReported) {
  if (alreadyReported || quiet) return alreadyReported;
  if (plan.streamFormat !== "human" && io.stderrIsTTY !== true) return alreadyReported;
  const styler = createStyler(resolveColor(io, "stderr"));
  await safeWriteStderr(
    io,
    `${styler.dim(`Файл лога занят сервером, повтор через ${plan.intervalSec} с…`)}
`
  );
  return true;
}
async function safeWriteStderr(io, text) {
  try {
    await io.writeError(text);
  } catch {
  }
}

// src/cli/progress.ts
var SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
var CLEAR_LINE = "\r\x1B[2K";
var DEFAULT_DELAY_MS = 250;
var DEFAULT_INTERVAL_MS = 80;
var DEFAULT_TIMERS = {
  setTimeout: (callback, ms) => {
    const handle = setTimeout(callback, ms);
    handle.unref?.();
    return handle;
  },
  clearTimeout: (handle) => clearTimeout(handle),
  setInterval: (callback, ms) => {
    const handle = setInterval(callback, ms);
    handle.unref?.();
    return handle;
  },
  clearInterval: (handle) => clearInterval(handle)
};
function clipLabel(text, columns) {
  const maxWidth = columns !== void 0 && columns > 8 ? columns - 4 : 76;
  if (text.length <= maxWidth) return text;
  return `${text.slice(0, Math.max(1, maxWidth - 1))}…`;
}
function createProgress(io, options) {
  const active = options.enabled && io.stderrIsTTY === true;
  if (!active) {
    return {
      enabled: false,
      start: () => void 0,
      update: () => void 0,
      clear: async () => void 0,
      stop: async () => void 0
    };
  }
  const timers = io.timers ?? DEFAULT_TIMERS;
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const styler = createStyler(resolveColor(io, "stderr"));
  let running = false;
  let visible = false;
  let dirty = false;
  let frameIndex = 0;
  let currentLabel = "Выполнение…";
  let delayHandle;
  let tickHandle;
  let writing;
  const writeDirect = (text) => {
    let result;
    try {
      result = io.writeError(text);
    } catch {
      return Promise.resolve();
    }
    if (result && typeof result.then === "function") {
      const tracked = result.catch(() => void 0).finally(() => {
        if (writing === tracked) {
          writing = void 0;
          if (dirty && running && visible) {
            dirty = false;
            render();
          }
        }
      });
      writing = tracked;
      return tracked;
    }
    return Promise.resolve();
  };
  const render = () => {
    visible = true;
    if (writing !== void 0) {
      dirty = true;
      return;
    }
    dirty = false;
    const frame = SPINNER_FRAMES[frameIndex % SPINNER_FRAMES.length];
    frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length;
    const text = clipLabel(currentLabel, io.columns);
    void writeDirect(`${CLEAR_LINE}${styler.cyan(frame)} ${styler.dim(text)}`);
  };
  const clearLine = async () => {
    dirty = false;
    const wasVisible = visible;
    visible = false;
    if (writing !== void 0) await writing;
    if (!wasVisible) return;
    await writeDirect(CLEAR_LINE);
  };
  const ensureInterval = () => {
    if (tickHandle !== void 0) return;
    tickHandle = timers.setInterval(() => {
      if (!running) return;
      render();
    }, intervalMs);
  };
  const cancelTimers = () => {
    if (delayHandle !== void 0) {
      timers.clearTimeout(delayHandle);
      delayHandle = void 0;
    }
    if (tickHandle !== void 0) {
      timers.clearInterval(tickHandle);
      tickHandle = void 0;
    }
  };
  return {
    enabled: true,
    start(label = "Выполнение…") {
      currentLabel = label;
      if (running) return;
      running = true;
      dirty = false;
      frameIndex = 0;
      delayHandle = timers.setTimeout(() => {
        delayHandle = void 0;
        if (!running) return;
        render();
        ensureInterval();
      }, delayMs);
    },
    update(label) {
      currentLabel = label;
      if (running && visible) render();
    },
    async clear() {
      await clearLine();
    },
    async stop() {
      running = false;
      cancelTimers();
      await clearLine();
    }
  };
}

// src/cli/query-all.ts
var DEFAULT_ALL_PAGE_SIZE = 200;
var STREAM_FLUSH_CHARS = 64 * 1024;
var MAX_SINGLE_ITEM_CHARS = 8 * 1024 * 1024;
var MAX_WRAPPER_CHARS = 256 * 1024;
var StreamOutputError = class extends Error {
  constructor(result) {
    super(result.error?.message ?? "Ошибка вывода.");
    this.result = result;
  }
};
function isRecord6(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function queryAllOptions(args) {
  if (args.options.all !== true) return void 0;
  const pageSize = integerOption(args, "page-size", 1, 1e3) ?? DEFAULT_ALL_PAGE_SIZE;
  const maxRows = integerOption(args, "max-rows", 1, 1e7);
  return {
    pageSize,
    ...maxRows === void 0 ? {} : { maxRows }
  };
}
function extractPageMeta(value) {
  return {
    ...typeof value.total === "number" ? { total: value.total } : {},
    ...typeof value.nextStartPosition === "number" ? { nextStartPosition: value.nextStartPosition } : {},
    ...value.incomplete === true ? { incomplete: true } : {},
    ...typeof value.hint === "string" ? { hint: value.hint } : {},
    ...Array.isArray(value.unknownFields) ? {
      unknownFields: value.unknownFields.filter(
        (field) => typeof field === "string"
      )
    } : {}
  };
}
function asQueryPage(value) {
  if (!isRecord6(value) || !Array.isArray(value.items)) return void 0;
  return { items: value.items, ...extractPageMeta(value) };
}
function incompleteResult(source, hint) {
  return {
    ok: false,
    error: {
      code: "QUERY_INCOMPLETE",
      message: "Страница запроса неполная: строки после неё не прочитаны.",
      ...hint === void 0 ? {} : { hint },
      retryable: false
    },
    meta: source.meta
  };
}
function columnsChangedResult(source, headers, added) {
  const suggested = [...headers, ...added].join(",");
  return {
    ok: false,
    error: {
      code: "QUERY_COLUMNS_CHANGED",
      message: `На следующей странице появились новые поля (${added.join(", ")}), которых не было в заголовке.`,
      hint: `Задать столбцы явно через --fields ${suggested} или переключиться на --format jsonl.`,
      retryable: false
    },
    meta: source.meta
  };
}
function formatProgressLabel(received, total) {
  if (total !== void 0 && total > received) {
    return `получено ${received} строк (из ${total})`;
  }
  return `получено ${received} строк`;
}
function memoryTextWriter(path, io) {
  const parts = [];
  let closed = false;
  return {
    write(chunk) {
      if (chunk) parts.push(chunk);
    },
    async commit() {
      if (closed) return 0;
      closed = true;
      const text = parts.join("");
      await io.writeFile(path, text);
      return Buffer.byteLength(text, "utf8");
    },
    async abort() {
      closed = true;
      parts.length = 0;
    }
  };
}
async function* readResultJsonChunks(runtime, resultId, storedError) {
  let offset = 0;
  while (offset !== void 0) {
    const chunk = await runtime.call("results.read", {
      resultId,
      offset,
      limit: 65536,
      format: "json"
    });
    if (!chunk.ok) throw storedError("Не удалось дочитать сохранённую страницу запроса.");
    const data = isRecord6(chunk.data) ? chunk.data : void 0;
    if (data?.format !== "json" || typeof data.text !== "string") {
      throw storedError("Не удалось дочитать сохранённую страницу запроса в формате JSON.");
    }
    yield data.text;
    if (data.nextOffset === void 0) {
      offset = void 0;
    } else if (typeof data.nextOffset === "number" && Number.isSafeInteger(data.nextOffset) && data.nextOffset > offset) {
      offset = data.nextOffset;
    } else {
      throw storedError("Чтение сохранённой страницы запроса не продвигается.");
    }
  }
}
async function streamStoredQueryPage(runtime, result, maxItems, mode) {
  const resultId = storedResultId(result);
  if (!resultId) {
    throw new HcmError(
      "RESULT_TRUNCATED",
      "Страница запроса обрезана, а resultId для дочитывания отсутствует."
    );
  }
  const storedError = (message) => new HcmError(
    "RESULT_STORED",
    message,
    `Уменьшить --page-size или прочитать результат: wtctl result read ${resultId}.`,
    { resultId }
  );
  const isRawMode = mode.kind === "raw-jsonl" || mode.kind === "raw-json-array" || mode.kind === "raw-spill";
  let depth = 0;
  let inString = false;
  let escaped = false;
  let expectKey = false;
  let readingTopKey = false;
  let topKey = "";
  let afterTopKey = false;
  let expectTopValue = false;
  let isItemsValue = false;
  let inItems = false;
  let foundItems = false;
  let hasItemContent = false;
  let itemPrefixEmitted = false;
  let pendingRawSpillBegin = false;
  let rawSpillOpen = false;
  const previewItemParts = [];
  let previewItemBytes = 0;
  const wrapperParts = [];
  let wrapperLen = 0;
  const itemParts = [];
  let itemLen = 0;
  const outParts = [];
  let outLen = 0;
  let seenItems = 0;
  let emittedItems = 0;
  const flushRaw = async () => {
    if (!isRawMode) return;
    if (mode.kind === "raw-spill") {
      if (pendingRawSpillBegin) {
        pendingRawSpillBegin = false;
        rawSpillOpen = true;
        await mode.saver.beginRawItem();
      }
      if (!outParts.length) return;
      const text2 = outParts.length === 1 ? outParts[0] : outParts.join("");
      outParts.length = 0;
      outLen = 0;
      await mode.saver.writeRawChunk(text2);
      return;
    }
    if (!outParts.length) return;
    const text = outParts.length === 1 ? outParts[0] : outParts.join("");
    outParts.length = 0;
    outLen = 0;
    await mode.writeRaw(text);
  };
  const pushCaptured = (slice) => {
    if (!slice) return;
    if (isRawMode) {
      if (mode.kind === "raw-json-array" && !itemPrefixEmitted) {
        itemPrefixEmitted = true;
        if (!mode.state.started) {
          mode.state.started = true;
          outParts.push('{"ok":true,"data":{"items":[');
          outLen += 28;
        }
        if (mode.state.items > 0) {
          outParts.push(",");
          outLen += 1;
        }
      } else if (mode.kind === "raw-spill") {
        if (!itemPrefixEmitted) {
          itemPrefixEmitted = true;
          pendingRawSpillBegin = true;
        }
        if (mode.preview.open) {
          previewItemBytes += Buffer.byteLength(slice, "utf8");
          const sep = mode.preview.items.length > 0 ? 1 : 0;
          if (mode.preview.bytes + sep + previewItemBytes <= mode.preview.budget) {
            previewItemParts.push(slice);
          } else {
            mode.preview.open = false;
            previewItemParts.length = 0;
            previewItemBytes = 0;
          }
        }
      }
      outParts.push(slice);
      outLen += slice.length;
      return;
    }
    itemLen += slice.length;
    if (itemLen > MAX_SINGLE_ITEM_CHARS) {
      throw new HcmError(
        "RESULT_TOO_LARGE_FOR_FORMAT",
        "Отдельная строка результата превышает 8 МиБ и не форматируется в таблице/CSV.",
        "Для потокового вывода больших строк подходит --format jsonl.",
        { resultId }
      );
    }
    itemParts.push(slice);
  };
  const pushWrapper = (slice) => {
    if (!slice) return;
    wrapperLen += slice.length;
    if (wrapperLen > MAX_WRAPPER_CHARS) {
      throw storedError("Служебные поля сохранённой страницы превысили допустимый размер.");
    }
    wrapperParts.push(slice);
  };
  const finishItem = async () => {
    const emitThis = seenItems < maxItems;
    seenItems++;
    hasItemContent = false;
    itemPrefixEmitted = false;
    if (!emitThis) {
      itemParts.length = 0;
      itemLen = 0;
      previewItemParts.length = 0;
      previewItemBytes = 0;
      return;
    }
    if (mode.kind === "raw-jsonl") {
      outParts.push("\n");
      outLen += 1;
      emittedItems++;
      if (outLen >= STREAM_FLUSH_CHARS) await flushRaw();
      return;
    }
    if (mode.kind === "raw-json-array") {
      mode.state.items++;
      emittedItems++;
      if (outLen >= STREAM_FLUSH_CHARS) await flushRaw();
      return;
    }
    if (mode.kind === "raw-spill") {
      await flushRaw();
      if (rawSpillOpen) {
        rawSpillOpen = false;
        await mode.saver.endRawItem();
      }
      if (mode.preview.open && previewItemParts.length > 0) {
        const rawPreview = previewItemParts.join("");
        try {
          const parsedItem = JSON.parse(rawPreview);
          const step = Buffer.byteLength(compactJson(parsedItem), "utf8") + (mode.preview.items.length > 0 ? 1 : 0);
          if (mode.preview.bytes + step <= mode.preview.budget) {
            mode.preview.items.push(parsedItem);
            mode.preview.bytes += step;
          } else {
            mode.preview.open = false;
          }
        } catch {
          mode.preview.open = false;
        }
      }
      previewItemParts.length = 0;
      previewItemBytes = 0;
      emittedItems++;
      return;
    }
    const raw = itemParts.length === 1 ? itemParts[0] : itemParts.join("");
    itemParts.length = 0;
    itemLen = 0;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw storedError("Сохранённая страница запроса содержит повреждённый JSON.");
    }
    await mode.onItem(parsed);
    emittedItems++;
  };
  const chunks = runtime.results?.openJsonStream ? runtime.results.openJsonStream(resultId) : readResultJsonChunks(runtime, resultId, storedError);
  for await (const text of chunks) {
    let captureStart = -1;
    let wrapperStart = -1;
    const flushCaptureSlice = (end) => {
      if (captureStart >= 0) {
        if (end > captureStart) pushCaptured(text.slice(captureStart, end));
        captureStart = -1;
      }
    };
    const flushWrapperSlice = (end) => {
      if (wrapperStart >= 0) {
        if (end > wrapperStart) pushWrapper(text.slice(wrapperStart, end));
        wrapperStart = -1;
      }
    };
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inItems) {
        if (inString) {
          if (seenItems < maxItems && captureStart < 0) captureStart = i;
          if (escaped) escaped = false;
          else if (ch === "\\") escaped = true;
          else if (ch === '"') inString = false;
          continue;
        }
        if (depth === 2 && (ch === "," || ch === "]")) {
          flushCaptureSlice(i);
          if (hasItemContent) await finishItem();
          if (ch === "]") {
            inItems = false;
            depth = 1;
          }
          continue;
        }
        if (depth === 2 && !hasItemContent && (ch === " " || ch === "\n" || ch === "\r" || ch === "	")) {
          continue;
        }
        hasItemContent = true;
        if (seenItems < maxItems) {
          if (mode.kind === "raw-jsonl" && (ch === "\n" || ch === "\r")) {
            flushCaptureSlice(i);
          } else if (captureStart < 0) {
            captureStart = i;
          }
        }
        if (ch === '"') inString = true;
        else if (ch === "{" || ch === "[") depth++;
        else if (ch === "}" || ch === "]") depth--;
        continue;
      }
      if (!inString && depth === 1 && expectTopValue && isItemsValue && ch === "[") {
        flushWrapperSlice(i);
        inItems = true;
        foundItems = true;
        depth = 2;
        expectTopValue = false;
        isItemsValue = false;
        hasItemContent = false;
        itemParts.length = 0;
        itemLen = 0;
        pushWrapper("[]");
        continue;
      }
      if (wrapperStart < 0) wrapperStart = i;
      if (inString) {
        if (escaped) {
          escaped = false;
          if (readingTopKey) topKey = "\0";
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
          if (readingTopKey) {
            readingTopKey = false;
            afterTopKey = true;
          }
        } else if (readingTopKey && topKey.length < 16) {
          topKey += ch;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
        if (depth === 1 && expectKey) {
          expectKey = false;
          readingTopKey = true;
          topKey = "";
        } else if (depth === 1) {
          expectTopValue = false;
          isItemsValue = false;
        }
      } else if (ch === ":" && depth === 1 && afterTopKey) {
        afterTopKey = false;
        expectTopValue = true;
        isItemsValue = topKey === "items";
      } else if (ch === "," && depth === 1) {
        expectKey = true;
        afterTopKey = false;
        expectTopValue = false;
        isItemsValue = false;
      } else if (ch === "{") {
        if (depth === 0) expectKey = true;
        else if (depth === 1) {
          expectTopValue = false;
          isItemsValue = false;
        }
        depth++;
      } else if (ch === "[") {
        if (depth === 1) {
          expectTopValue = false;
          isItemsValue = false;
        }
        depth++;
      } else if (ch === "}" || ch === "]") {
        depth--;
      } else if (depth === 1 && expectTopValue && ch !== " " && ch !== "\n" && ch !== "\r" && ch !== "	") {
        expectTopValue = false;
        isItemsValue = false;
      }
    }
    flushCaptureSlice(text.length);
    flushWrapperSlice(text.length);
    if (outLen >= STREAM_FLUSH_CHARS) await flushRaw();
  }
  await flushRaw();
  if (!foundItems || depth !== 0 || inString) {
    throw storedError("Сохранённая страница запроса имеет неполную структуру JSON.");
  }
  let metaObj;
  try {
    metaObj = JSON.parse(wrapperParts.join(""));
  } catch {
    throw storedError("Сохранённая страница запроса содержит повреждённый JSON.");
  }
  if (!isRecord6(metaObj)) {
    throw storedError("Сохранённая страница запроса не является объектом JSON.");
  }
  return {
    ...extractPageMeta(metaObj),
    seenItems,
    emittedItems
  };
}
async function runQueryAll(baseArgs, options, parsed, config, io, runtime, outputMode, progress, closeRuntime) {
  if (baseArgs.startPosition !== void 0) {
    const rawStart = baseArgs.startPosition;
    if (typeof rawStart !== "number" || !Number.isSafeInteger(rawStart) || rawStart < 0 || rawStart > 1e6) {
      throw new CliInputError("startPosition должен быть целым числом от 0 до 1000000.");
    }
  }
  const streaming = outputMode.format === "csv" || outputMode.format === "tsv" || outputMode.format === "jsonl" || outputMode.format === "raw";
  const output = stringOption(parsed, "output");
  const streamingJsonFile = !streaming && output !== void 0 && outputMode.format === "json";
  const requestedFields = Array.isArray(baseArgs.fields) && baseArgs.fields.every((item) => typeof item === "string") ? [...new Set(baseArgs.fields)] : void 0;
  let startPosition = typeof baseArgs.startPosition === "number" ? baseArgs.startPosition : 0;
  let totalRows = 0;
  let totalDurationMs = 0;
  let lastTotal;
  let lastNextStartPosition;
  let lastHint;
  let connection = config.name;
  const unknownFields = /* @__PURE__ */ new Set();
  const collected = [];
  let collectedBytes = 12;
  const limitBytes = config.outputLimitBytes;
  const previewState = {
    items: [],
    budget: Math.floor(limitBytes / 2),
    bytes: 12,
    open: true
  };
  let spillSaver;
  const jsonFileState = { started: false, items: 0 };
  let headers = requestedFields && requestedFields.length > 0 ? requestedFields : void 0;
  let headerSet = headers ? new Set(headers) : void 0;
  let headerWritten = false;
  let writer;
  let textBuffer = "";
  const openWriter = async () => {
    if (writer) return writer;
    writer = io.openTextWriter ? await io.openTextWriter(output) : memoryTextWriter(output, io);
    return writer;
  };
  const openSpillSaver = async () => {
    if (spillSaver) return spillSaver;
    spillSaver = runtime.results?.openListSaver ? await runtime.results.openListSaver("items") : await new ResultStore(config).openListSaver("items");
    return spillSaver;
  };
  const writeRaw = async (chunk) => {
    if (!chunk) return;
    try {
      if (output) {
        await (await openWriter()).write(chunk);
        return;
      }
      if (io.stdoutIsTTY === true) await progress.clear();
      await io.writeOut(chunk);
    } catch {
      throw new StreamOutputError(
        failure(
          output ? "cli.output_failed" : "OUTPUT_WRITE_FAILED",
          output ? "Не удалось записать результат в локальный файл." : "Не удалось записать результат в stdout."
        )
      );
    }
  };
  const flushTextBuffer = async () => {
    if (!textBuffer) return;
    const chunk = textBuffer;
    textBuffer = "";
    await writeRaw(chunk);
  };
  const appendJsonChunk = async (chunk) => {
    textBuffer += chunk;
    if (textBuffer.length >= STREAM_FLUSH_CHARS) await flushTextBuffer();
  };
  const collectNonStreamItem = async (item) => {
    if (streamingJsonFile) {
      if (!jsonFileState.started) {
        jsonFileState.started = true;
        await appendJsonChunk('{"ok":true,"data":{"items":[');
      }
      if (jsonFileState.items > 0) await appendJsonChunk(",");
      await appendJsonChunk(compactJson(item));
      jsonFileState.items++;
      return;
    }
    const serialized = compactJson(item);
    const rawItemBytes = Buffer.byteLength(serialized, "utf8");
    const previewStep = rawItemBytes + (previewState.items.length > 0 ? 1 : 0);
    if (previewState.open) {
      if (previewState.bytes + previewStep <= previewState.budget) {
        previewState.items.push(item);
        previewState.bytes += previewStep;
      } else {
        previewState.open = false;
      }
    }
    if (spillSaver) {
      await spillSaver.writeItem(item);
      return;
    }
    const collectStep = rawItemBytes + (collected.length > 0 ? 1 : 0);
    if (collectedBytes + collectStep > limitBytes) {
      const saver = await openSpillSaver();
      for (const prev of collected) await saver.writeItem(prev);
      collected.length = 0;
      await saver.writeItem(item);
      return;
    }
    collected.push(item);
    collectedBytes += collectStep;
  };
  const appendTextLine = async (line) => {
    textBuffer += `${line}
`;
    if (textBuffer.length >= STREAM_FLUSH_CHARS) await flushTextBuffer();
  };
  const emitTabularHeader = async (format) => {
    if (headerWritten || !headers || headers.length === 0) return;
    headerWritten = true;
    if (format === "csv") await appendTextLine(formatCsvRow(headers));
    else if (format === "tsv") await appendTextLine(formatTsvRow(headers));
  };
  const emitStreamItem = async (item, format, sourceResult) => {
    if (format === "jsonl") {
      await appendTextLine(compactJson(item));
      return;
    }
    const record = isRecord6(item) ? item : {};
    if (headers === void 0) {
      const detected = collectObjectKeys([record]);
      if (detected && detected.length > 0) {
        headers = detected;
        headerSet = new Set(detected);
      }
    } else if (requestedFields === void 0 && headerSet !== void 0) {
      const added = [];
      for (const key of Object.keys(record)) {
        if (!headerSet.has(key)) added.push(key);
      }
      if (added.length > 0) {
        throw new StreamOutputError(columnsChangedResult(sourceResult, headers, added));
      }
    }
    if (!headers || headers.length === 0) return;
    await emitTabularHeader(format);
    const values = headers.map((key) => Object.hasOwn(record, key) ? record[key] : "");
    if (format === "csv") await appendTextLine(formatCsvRow(values));
    else if (format === "tsv") await appendTextLine(formatTsvRow(values));
    else if (headers.length === 1) await appendTextLine(tabularCellText(values[0]));
    else await appendTextLine(formatTsvRow(values));
  };
  const failStream = async (errorResult) => {
    textBuffer = "";
    await writer?.abort().catch(() => void 0);
    await spillSaver?.abort().catch(() => void 0);
    await progress.stop();
    await closeRuntime();
    await safeDiagnostic(
      io,
      errorInFrontendTerms(errorResult, "cli"),
      outputMode.humanErrors ? "human" : "json"
    );
    return { handled: true, exitCode: 1 };
  };
  const handleFailure = async (errorResult) => {
    if (streaming) return await failStream(errorResult);
    textBuffer = "";
    await writer?.abort().catch(() => void 0);
    await spillSaver?.abort().catch(() => void 0);
    return { handled: false, result: errorResult };
  };
  try {
    for (; ; ) {
      const remaining = options.maxRows === void 0 ? options.pageSize : Math.min(options.pageSize, options.maxRows - totalRows);
      if (remaining <= 0) break;
      const pageArgs = {
        ...baseArgs,
        limit: remaining,
        startPosition
      };
      const result = await runtime.call("runtime.query", pageArgs);
      totalDurationMs += result.meta.durationMs;
      connection = result.meta.connection;
      if (!result.ok) return await handleFailure(result);
      const sliceLimit = options.maxRows === void 0 ? Infinity : Math.max(0, options.maxRows - totalRows);
      let pageMeta;
      let pageItemsSeen;
      let pageItemsEmitted;
      if (result.meta.truncated === true) {
        const preview = isRecord6(result.data) && isRecord6(result.data.preview) ? result.data.preview : void 0;
        if (isRecord6(result.data) && result.data.incomplete === true || preview?.incomplete === true) {
          const hint = typeof preview?.hint === "string" ? preview.hint : isRecord6(result.data) && typeof result.data.hint === "string" ? result.data.hint : void 0;
          return await handleFailure(incompleteResult(result, hint));
        }
        const format = outputMode.format;
        if (streaming && format === "jsonl") {
          const summary = await streamStoredQueryPage(runtime, result, sliceLimit, {
            kind: "raw-jsonl",
            writeRaw
          });
          pageMeta = summary;
          pageItemsSeen = summary.seenItems;
          pageItemsEmitted = summary.emittedItems;
        } else if (streaming) {
          const tabularFormat = format;
          if (headers === void 0) {
            const seenKeys = /* @__PURE__ */ new Set();
            const preScan = await streamStoredQueryPage(runtime, result, sliceLimit, {
              kind: "items",
              onItem: async (item) => {
                if (isRecord6(item)) {
                  for (const key of Object.keys(item)) seenKeys.add(key);
                }
              }
            });
            if (preScan.incomplete === true) {
              return await handleFailure(incompleteResult(result, preScan.hint));
            }
            if (seenKeys.size > 0) {
              headers = [...seenKeys];
              headerSet = seenKeys;
            }
          }
          const summary = await streamStoredQueryPage(runtime, result, sliceLimit, {
            kind: "items",
            onItem: (item) => emitStreamItem(item, tabularFormat, result)
          });
          if (!headerWritten && headers !== void 0 && headers.length > 0) {
            await emitTabularHeader(tabularFormat);
          }
          await flushTextBuffer();
          pageMeta = summary;
          pageItemsSeen = summary.seenItems;
          pageItemsEmitted = summary.emittedItems;
        } else if (streamingJsonFile) {
          await flushTextBuffer();
          const summary = await streamStoredQueryPage(runtime, result, sliceLimit, {
            kind: "raw-json-array",
            writeRaw,
            state: jsonFileState
          });
          pageMeta = summary;
          pageItemsSeen = summary.seenItems;
          pageItemsEmitted = summary.emittedItems;
        } else {
          const saver = await openSpillSaver();
          if (collected.length > 0) {
            for (const prev of collected) await saver.writeItem(prev);
            collected.length = 0;
          }
          const summary = await streamStoredQueryPage(runtime, result, sliceLimit, {
            kind: "raw-spill",
            saver,
            preview: previewState
          });
          pageMeta = summary;
          pageItemsSeen = summary.seenItems;
          pageItemsEmitted = summary.emittedItems;
        }
        if (pageMeta.incomplete === true) {
          return await handleFailure(incompleteResult(result, pageMeta.hint));
        }
      } else {
        const page = asQueryPage(result.data);
        if (!page) {
          return await handleFailure(
            failure(
              "QUERY_RESPONSE_INVALID",
              "Не удалось разобрать страницу ответа runtime.query."
            )
          );
        }
        if (page.incomplete === true) {
          return await handleFailure(incompleteResult(result, page.hint));
        }
        pageMeta = page;
        pageItemsSeen = page.items.length;
        const items = page.items.length > sliceLimit ? page.items.slice(0, sliceLimit) : page.items;
        pageItemsEmitted = items.length;
        if (streaming) {
          const format = outputMode.format;
          if (format !== "jsonl") {
            if (headers === void 0 && items.length > 0) {
              const detected = collectObjectKeys(items);
              if (detected && detected.length > 0) {
                headers = detected;
                headerSet = new Set(detected);
              }
            }
            if (!headerWritten && headers !== void 0 && headers.length > 0) {
              await emitTabularHeader(format);
            }
          }
          for (const item of items) {
            await emitStreamItem(item, format, result);
          }
          await flushTextBuffer();
        } else {
          for (const item of items) await collectNonStreamItem(item);
        }
      }
      totalRows += pageItemsEmitted;
      if (pageMeta.total !== void 0) lastTotal = pageMeta.total;
      if (pageMeta.hint !== void 0) lastHint = pageMeta.hint;
      if (pageMeta.unknownFields) {
        for (const field of pageMeta.unknownFields) unknownFields.add(field);
      }
      const reachedMax = options.maxRows !== void 0 && totalRows >= options.maxRows;
      if (reachedMax) {
        lastNextStartPosition = pageItemsSeen > pageItemsEmitted ? startPosition + pageItemsEmitted : pageMeta.nextStartPosition;
        break;
      }
      if (pageMeta.nextStartPosition === void 0) {
        lastNextStartPosition = void 0;
        break;
      }
      if (pageMeta.nextStartPosition <= startPosition) {
        return await handleFailure(
          incompleteResult(result, "Смещение следующей страницы не продвинулось; чтение прервано.")
        );
      }
      progress.update(formatProgressLabel(totalRows, lastTotal));
      startPosition = pageMeta.nextStartPosition;
    }
    const extraFields = {
      ...lastTotal === void 0 ? {} : { total: lastTotal },
      ...lastNextStartPosition === void 0 ? {} : { nextStartPosition: lastNextStartPosition },
      ...unknownFields.size > 0 ? { unknownFields: [...unknownFields] } : {},
      ...lastHint === void 0 ? {} : { hint: lastHint }
    };
    if (streamingJsonFile) {
      if (!jsonFileState.started) {
        jsonFileState.started = true;
        await appendJsonChunk('{"ok":true,"data":{"items":[');
      }
      await appendJsonChunk("]");
      const extraJson = compactJson(extraFields);
      if (extraJson !== "{}") await appendJsonChunk(`,${extraJson.slice(1)}`);
      else await appendJsonChunk("}");
      const meta = {
        operationId: "runtime.query",
        connection,
        durationMs: totalDurationMs
      };
      await appendJsonChunk(`,"meta":${compactJson(meta)}}
`);
      await flushTextBuffer();
      await progress.stop();
      const closed2 = await closeRuntime();
      let bytes;
      try {
        const targetWriter = await openWriter();
        bytes = await targetWriter.commit();
      } catch {
        return await failStream(
          failure(
            "cli.output_failed",
            "Результат получен, но сохранить локальный файл не удалось."
          )
        );
      }
      const receipt = {
        ok: !closed2.failed,
        data: { saved: true, output, bytes },
        ...closed2.failed && closed2.diagnostic?.error ? { error: closed2.diagnostic.error } : {},
        meta: {
          ...meta,
          ...closed2.failed ? { cleanupFailed: true } : {}
        }
      };
      try {
        await io.writeOut(serializeResult(receipt, io.pretty === true));
      } catch {
        return { handled: true, exitCode: 1 };
      }
      return { handled: true, exitCode: closed2.failed ? 1 : 0 };
    }
    if (!streaming) {
      const meta = {
        operationId: "runtime.query",
        connection,
        durationMs: totalDurationMs
      };
      const prettyReply = outputMode.format === "json" && io.pretty === true;
      const quiet = parsed.options.quiet === true;
      const connectionArg = stringOption(parsed, "connection");
      const measureTable = output === void 0 && (outputMode.format === "human" || outputMode.format === "table");
      const replyBytes = (reply) => {
        if (measureTable) {
          const formatted = formatOperationOutput(
            reply,
            reply.meta.truncated ? "human" : outputMode.format,
            {
              ...io.columns === void 0 ? {} : { columns: io.columns },
              color: resolveColor(io, "stdout"),
              quiet,
              ...reply.meta.truncated ? {} : {
                ...requestedFields === void 0 ? {} : { requestedFields },
                requestArgs: baseArgs,
                ...connectionArg === void 0 ? {} : { connectionArg }
              }
            }
          );
          return formatted.kind === "text" ? Buffer.byteLength(formatted.text, "utf8") : formatted.bytes.length;
        }
        return Buffer.byteLength(serializeResult(reply, prettyReply), "utf8");
      };
      if (!spillSaver) {
        const fullResult = {
          ok: true,
          data: { items: collected, ...extraFields },
          meta
        };
        if (replyBytes(fullResult) <= limitBytes) {
          return {
            handled: false,
            result: fullResult
          };
        }
        const saver = await openSpillSaver();
        for (const item of collected) await saver.writeItem(item);
        collected.length = 0;
      }
      const saved = await spillSaver.commit(extraFields);
      const buildTruncated = (previewObj, shownCount) => ({
        ok: true,
        data: {
          ...previewObj === void 0 ? {} : { preview: previewObj },
          resultId: saved.resultId,
          hint: `Ответ не поместился и сохранён целиком: wtctl result read ${saved.resultId} читает список items по элементам${shownCount < totalRows ? ` (в preview первые ${shownCount} из ${totalRows})` : ""}, wtctl result export ${saved.resultId} --to ФАЙЛ --format jsonl сохраняет в файл.`
        },
        meta: {
          ...meta,
          truncated: true,
          resultId: saved.resultId,
          resultBytes: saved.bytes
        }
      });
      const previewItems = previewState.items;
      while (previewItems.length > 0 && replyBytes(buildTruncated({ items: previewItems, ...extraFields }, previewItems.length)) > limitBytes) {
        previewItems.pop();
      }
      let finalReply = buildTruncated({ items: previewItems, ...extraFields }, previewItems.length);
      if (replyBytes(finalReply) > limitBytes) {
        const compactPreview = {
          kind: "stored-result",
          items: [],
          ...lastTotal === void 0 ? {} : { total: lastTotal },
          ...lastNextStartPosition === void 0 ? {} : { nextStartPosition: lastNextStartPosition },
          ...unknownFields.size > 0 ? { unknownFields: `[список: ${unknownFields.size}]` } : {},
          ...lastHint === void 0 ? {} : { hint: lastHint.length > 120 ? `${lastHint.slice(0, 120)}…` : lastHint }
        };
        finalReply = buildTruncated(compactPreview, 0);
        if (replyBytes(finalReply) > limitBytes) {
          finalReply = buildTruncated({ kind: "stored-result", items: [] }, 0);
        }
        if (replyBytes(finalReply) > limitBytes) {
          finalReply = buildTruncated(void 0, 0);
        }
      }
      return {
        handled: false,
        result: finalReply
      };
    }
    await progress.stop();
    const closed = await closeRuntime();
    const summaryResult = {
      ok: !closed.failed,
      data: { rows: totalRows },
      meta: { operationId: "runtime.query", connection, durationMs: totalDurationMs }
    };
    const finalResult = closed.failed && closed.diagnostic ? frontendFailure(summaryResult, closed.diagnostic, "cleanupFailed") : summaryResult;
    if (output) {
      let bytes;
      try {
        const targetWriter = await openWriter();
        bytes = await targetWriter.commit();
      } catch {
        return await failStream(
          failure(
            "cli.output_failed",
            "Результат получен, но сохранить локальный файл не удалось."
          )
        );
      }
      if (!await reportSaved(output, bytes, finalResult, parsed, io, `строк: ${totalRows}`)) {
        return { handled: true, exitCode: 1 };
      }
    }
    return { handled: true, exitCode: closed.failed ? 1 : 0 };
  } catch (error) {
    if (error instanceof StreamOutputError) return await failStream(error.result);
    await writer?.abort().catch(() => void 0);
    await spillSaver?.abort().catch(() => void 0);
    throw error;
  }
}

// src/cli/run.ts
function setupCommand(local) {
  if (!local) return void 0;
  const command = /[\\/]_npx[\\/]/.test(local.script) ? "npx -y wtctl" : `"${local.node}" "${local.script}"`;
  return `Файл создаёт человек в своём терминале, полная команда: ${command} config init`;
}
function withSettings(local, args) {
  if (!local) return void 0;
  const configPath = stringOption(args, "config") ?? process.env.WTCTL_CONFIG;
  const connection = stringOption(args, "connection") ?? process.env.WTCTL_CONNECTION;
  return {
    ...local,
    settings: {
      ...configPath === void 0 ? {} : { configPath: resolve5(configPath) },
      ...connection === void 0 ? {} : { connection },
      environment: configPath === void 0 && process.env.WTCTL_URL !== void 0
    }
  };
}
var TTY_DEFAULT_OUTPUT_LIMIT_BYTES = 256 * 1024;
var JSON_OUTPUT_MODE = { requested: "json", format: "json", humanErrors: false };
async function runCli(argv, io, dependencies) {
  let runtime;
  let parsed;
  let progress;
  try {
    parsed = parseArguments(argv);
    const [command, action] = parsed.positionals;
    if (command === "__complete-connections") {
      return await runCompleteConnections(parsed, io);
    }
    if (!command || command === "help") {
      rejectPasswordStdin(parsed, "Ввод пароля не нужен для help.");
      exactPositionals(parsed, 0, 3);
      const subcommand = parsed.positionals[2];
      if (action === "help" && subcommand !== void 0)
        throw new CliInputError("Лишние аргументы команды.");
      const helpArgs = parsed.options.help === true && usesLocalFormatArgv(argv) ? { positionals: parsed.positionals, options: { ...parsed.options, format: false } } : parsed;
      if (helpArgs !== parsed) delete helpArgs.options.format;
      const helpMode = resolveOutputMode(helpArgs, io);
      if (helpMode.requested !== "auto") assertFormatSupported("cli.help", helpMode.format);
      const topic2 = action === "help" ? void 0 : action;
      if (helpMode.requested === "json")
        return await emit(
          frontendResult("cli.help", "unselected", cliHelp(topic2, subcommand)),
          parsed,
          io,
          void 0,
          JSON_OUTPUT_MODE
        );
      return await emitText(cliHelpText(topic2, subcommand), parsed, io);
    }
    const outputMode = command === "mcp" ? void 0 : resolveOutputMode(parsed, io);
    if (command === "version") {
      rejectPasswordStdin(parsed, "Ввод пароля не нужен для version.");
      exactPositionals(parsed, 1);
      assertFormatSupported("cli.version", outputMode.format);
      return await emit(
        frontendResult("cli.version", "unselected", {
          name: "wtctl",
          version: VERSION,
          node: process.versions.node
        }),
        parsed,
        io,
        void 0,
        outputMode
      );
    }
    if (command === "guide") {
      rejectPasswordStdin(parsed, "Ввод пароля не нужен для guide.");
      exactPositionals(parsed, 1, 2);
      if (outputMode.requested !== "auto") assertFormatSupported("cli.guide", outputMode.format);
      const page = await guide(action, withSettings(dependencies.local, parsed));
      if (outputMode.requested === "json")
        return await emit(
          frontendResult("cli.guide", "unselected", page),
          parsed,
          io,
          void 0,
          JSON_OUTPUT_MODE
        );
      return await emitText(`${page.text}
`, parsed, io);
    }
    if (command === "completion") {
      rejectPasswordStdin(parsed, "Ввод пароля не нужен для completion.");
      exactPositionals(parsed, 1, 2);
      if (outputMode.requested !== "auto")
        assertFormatSupported("cli.completion", outputMode.format);
      const shell = parseCompletionShell(action);
      const script = generateCompletion(shell);
      if (outputMode.requested === "json")
        return await emit(
          frontendResult("cli.completion", "unselected", { shell, script }),
          parsed,
          io,
          void 0,
          JSON_OUTPUT_MODE
        );
      return await emitText(script, parsed, io);
    }
    if (command === "config") {
      const configAction = action === "rm" ? "remove" : action;
      if (configAction === "init" || configAction === "list" || configAction === "set" || configAction === "use" || configAction === "remove" || configAction === "path" || configAction === "example") {
        assertFormatSupported(`cli.config.${configAction}`, outputMode.format);
      }
      const configOutcome = await runConfigCommand(action, parsed, io);
      if (configOutcome?.kind === "cancelled") return configOutcome.exitCode;
      if (configOutcome?.kind === "result")
        return await emit(configOutcome.result, parsed, io, void 0, outputMode);
    }
    const interactiveConfirm = isInteractiveConfirm(io);
    const discovery = command === "api" && (action === "list" || action === "describe");
    let discoveryFilter = {};
    let invocation;
    let logPlan;
    let queryAll;
    let editPlan;
    if (command === "mcp") {
      exactPositionals(parsed, 1);
      if (parsed.options.output)
        throw new CliInputError("wtctl mcp не принимает --output: stdout занят протоколом MCP.");
      rejectPasswordStdin(
        parsed,
        "--password-stdin несовместим с MCP: stdin занят протоколом.",
        "Для MCP пароль берётся из файла подключений или переменной окружения."
      );
    } else if ((command === "files" || command === "object") && action === "edit") {
      editPlan = planEditCommand(parsed, outputMode, io);
    } else if (!discovery) {
      invocation = await commandInvocation(parsed, io, { interactive: interactiveConfirm });
      if (command === "logs") {
        logPlan = planLogExecution(parsed, invocation, outputMode, io);
      } else {
        assertFormatSupported(invocation.operationId, outputMode.format, invocation.args);
        if (command === "query") queryAll = queryAllOptions(parsed);
      }
    } else if (action === "describe") {
      exactPositionals(parsed, 3);
      assertFormatSupported("api.describe", outputMode.format);
    } else {
      exactPositionals(parsed, 2);
      assertFormatSupported("api.list", outputMode.format);
      const effect = enumOption(
        parsed,
        "effect",
        ["read", "write", "execute", "unknown"],
        "--effect должен быть read, write, execute или unknown."
      );
      discoveryFilter = {
        ...optional("query", stringOption(parsed, "query")),
        ...optional("topic", stringOption(parsed, "topic")),
        ...optional("group", stringOption(parsed, "group")),
        ...optional("effect", effect),
        ...optional("cursor", integerOption(parsed, "cursor", 0, Number.MAX_SAFE_INTEGER)),
        ...optional("limit", integerOption(parsed, "limit", 1, 100))
      };
    }
    if (discovery) {
      rejectPasswordStdin(parsed, "Пароль не нужен: команда не обращается к серверу.");
      const data = action === "describe" ? operationHelp(describeHcmOperation(requirePositional(parsed, 2, "ID операции"))) : discoverOperations(listHcmOperations, discoveryFilter);
      return await emit(
        frontendResult(`api.${action}`, "unselected", data),
        parsed,
        io,
        void 0,
        outputMode
      );
    }
    let password;
    if (parsed.options["password-stdin"]) {
      password = (await io.readStdin(65536)).replace(/\r?\n$/, "");
      if (!password || /[\r\n\0]/.test(password) || Buffer.byteLength(password, "utf8") > 65536)
        throw new CliInputError("Пароль из stdin должен быть одной непустой строкой до 64 КиБ.");
    }
    const selected = parsed;
    const defaultOutputLimitBytes = command !== "mcp" && (io.stdoutIsTTY === true && outputMode !== void 0 && (outputMode.format === "human" || outputMode.format === "table") || logPlan?.kind === "stream") ? TTY_DEFAULT_OUTPUT_LIMIT_BYTES : void 0;
    const load = () => dependencies.loadConfiguration({
      ...optional("configPath", stringOption(selected, "config")),
      ...optional("connection", stringOption(selected, "connection")),
      ...optional("password", password),
      ...optional("defaultOutputLimitBytes", defaultOutputLimitBytes)
    });
    if (command === "mcp") {
      const served = async () => markServedByMcp(await load());
      let name = "unconfigured";
      let serving;
      try {
        const config2 = await served();
        name = config2.name;
        serving = dependencies.createRuntime(config2);
      } catch (error) {
        if (!(error instanceof HcmError)) throw error;
        serving = new DeferredRuntime(
          served,
          dependencies.createRuntime,
          error,
          setupCommand(dependencies.local)
        );
      }
      runtime = serving;
      await dependencies.runMcp(serving, name, io, withSettings(dependencies.local, selected));
      runtime = void 0;
      await serving.close();
      return 0;
    }
    const progressEnabled = outputMode !== void 0 && outputMode.format !== "json" && outputMode.requested !== "json" && parsed.options.quiet !== true && logPlan?.kind !== "stream";
    progress = createProgress(io, { enabled: progressEnabled });
    progress.start(queryAll ? "Запрос строк…" : editPlan ? "Чтение данных…" : "Выполнение…");
    const config = await load();
    runtime = dependencies.createRuntime(config);
    if (!invocation && !editPlan) throw new CliInputError("Команда не определена.");
    let closingRuntime;
    const closeRuntimeOnce = async () => {
      if (!runtime) return { failed: false };
      const target = runtime;
      runtime = void 0;
      closingRuntime = target;
      try {
        await target.close();
        return { failed: false };
      } catch {
        const cleanup = failure(
          "cli.cleanup_failed",
          "Основная операция завершилась, но закрыть подключение не удалось.",
          "Результат основной операции сохранён в data/meta. Её из-за ошибки закрытия не повторять."
        );
        await safeDiagnostic(io, cleanup, outputMode?.humanErrors ? "human" : "json");
        return { failed: true, diagnostic: cleanup };
      }
    };
    if (logPlan?.kind === "stream") {
      await progress.stop();
      return await runLogStream(
        logPlan,
        parsed,
        io,
        runtime,
        outputMode,
        config.outputLimitBytes,
        config.maxResponseBytes,
        closeRuntimeOnce
      );
    }
    let result;
    let emitRequestArgs = invocation?.args;
    if (editPlan) {
      const outcome = await runEditCommand(
        editPlan,
        parsed,
        config,
        io,
        runtime,
        outputMode,
        progress,
        closeRuntimeOnce
      );
      if (outcome.handled) return outcome.exitCode;
      result = outcome.result;
      emitRequestArgs = outcome.requestArgs;
    } else if (logPlan?.kind === "tail") {
      const outcome = await runLogTail(
        logPlan,
        parsed,
        io,
        runtime,
        outputMode,
        config.outputLimitBytes,
        config.maxResponseBytes,
        progress,
        closeRuntimeOnce
      );
      if (outcome.handled) return outcome.exitCode;
      result = outcome.result;
    } else if (queryAll) {
      const outcome = await runQueryAll(
        invocation.args,
        queryAll,
        parsed,
        config,
        io,
        runtime,
        outputMode,
        progress,
        closeRuntimeOnce
      );
      if (outcome.handled) return outcome.exitCode;
      result = outcome.result;
    } else {
      let callArgs = invocation.args;
      if (logPlan?.kind === "single" && logPlan.resolveType && typeof callArgs.file === "string") {
        const resolved = await resolveLogFile(
          callArgs.file,
          runtime,
          io,
          outputMode,
          parsed.options.quiet === true,
          progress
        );
        if (!resolved.ok) {
          result = resolved.result;
          callArgs = {};
        } else {
          callArgs = { ...callArgs, file: resolved.file };
          result = await runtime.call(invocation.operationId, callArgs);
        }
      } else {
        const confirmTarget = interactiveConfirm && parsed.options.yes !== true ? command === "object" && action === "delete" && parsed.options.permanent !== true ? "objects.delete" : command === "files" && action === "delete" && parsed.options.permanent !== true ? "files.delete" : command === "tasks" && action === "kill" ? "web.spxml.killAsyncMethod" : command === "agent" && action === "cancel" ? "agents.cancel" : void 0 : void 0;
        if (confirmTarget !== void 0) {
          const confirmed = await confirmDestructiveAction(
            confirmTarget,
            callArgs,
            config,
            runtime,
            io,
            progress
          );
          if (!confirmed) {
            await closeRuntimeOnce();
            return 1;
          }
          if (confirmTarget === "objects.delete") {
            callArgs = { ...callArgs, permanent: true };
          }
          progress.start(
            confirmTarget === "web.spxml.killAsyncMethod" ? "Остановка задачи…" : confirmTarget === "agents.cancel" ? "Остановка агента…" : "Удаление…"
          );
        }
        result = await runtime.call(invocation.operationId, callArgs);
        if (command === "agent" && action === "run" && parsed.options.logs === true && result.ok) {
          result = await attachAgentRunLogs(
            result,
            runtime,
            config,
            progress,
            stringOption(parsed, "output") !== void 0
          );
        }
      }
    }
    await progress.stop();
    const closed = await closeRuntimeOnce();
    if (closed.failed && closed.diagnostic) {
      result = frontendFailure(result, closed.diagnostic, "cleanupFailed");
    }
    const requestedFields = Array.isArray(invocation?.args.fields) && invocation.args.fields.every((item) => typeof item === "string") ? invocation.args.fields : void 0;
    return await emit(
      result,
      parsed,
      io,
      closingRuntime,
      outputMode,
      requestedFields,
      emitRequestArgs
    );
  } catch (error) {
    await progress?.stop();
    const result = error instanceof CliInputError ? failure(
      error.code,
      error.message,
      [error.hint, `Справка: ${helpCommand(commandOf(argv))}.`].filter(Boolean).join(" ")
    ) : error instanceof HcmError ? {
      ...failure(error.code, error.message),
      error: {
        hint: "Проверить подключение и api.describe.",
        ...error.toJSON()
      }
    } : failure(
      "cli.failed",
      "Команда не завершена.",
      "Проверить подключение и api.describe; неизвестные ошибки не выводят реквизиты или серверный ответ."
    );
    await safeDiagnostic(
      io,
      errorInFrontendTerms(result, "cli"),
      resolveErrorMode(argv, parsed, io)
    );
    return error instanceof CliInputError ? 2 : 1;
  } finally {
    await progress?.stop();
    if (runtime) {
      try {
        await runtime.close();
      } catch {
        await safeDiagnostic(
          io,
          failure("cli.cleanup_failed", "Не удалось закрыть сессию подключения."),
          resolveErrorMode(argv, parsed, io)
        );
      }
    }
  }
}

// src/cli/local-install.ts
import { existsSync, realpathSync as realpathSync2 } from "node:fs";
import { dirname as dirname4, join as join4 } from "node:path";
import process5 from "node:process";
import { pathToFileURL } from "node:url";
function localInstall() {
  const started = process5.argv[1];
  if (!started) return void 0;
  let script;
  try {
    script = realpathSync2(started);
  } catch {
    return void 0;
  }
  const sdk = join4(dirname4(script), "..", "index.js");
  return {
    node: process5.execPath,
    script,
    ...existsSync(sdk) ? { sdk: pathToFileURL(sdk).href } : {}
  };
}

// src/cli/bin.ts
process6.stdout.on("error", () => {
});
process6.stderr.on("error", () => {
});
process6.exitCode = await runCli(process6.argv.slice(2), nodeIo(), {
  loadConfiguration: ({ defaultOutputLimitBytes, ...options }) => loadConfigWithDefaults(
    options,
    defaultOutputLimitBytes === void 0 ? void 0 : { outputLimitBytes: defaultOutputLimitBytes }
  ),
  createRuntime: (config) => new HcmRuntime(config),
  runMcp: async (runtime, connectionName, streams, local) => {
    const { runMcpStdio } = await import("../chunks/stdio-ZPFAA25Q.js");
    await runMcpStdio(runtime, connectionName, (text) => streams.writeError(text), local);
  },
  local: localInstall()
});
