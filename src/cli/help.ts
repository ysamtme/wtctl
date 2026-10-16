import { guideTopics } from "../guide.js";

interface CommandHelp {
  /** Одна строка для обзора. */
  readonly summary: string;
  readonly usage: readonly string[];
  /** Только то, чего нет в строках usage; по предложению на пункт, в текстовом виде — по строке. */
  readonly notes?: readonly string[];
}

const COMMANDS: Readonly<Record<string, CommandHelp>> = {
  status: {
    summary: "Адрес и версия сервера, пользователь и права подключения.",
    usage: ["wtctl status"],
  },
  check: {
    summary: "Проверка подключения по шагам.",
    usage: ["wtctl check"],
    notes: [
      "Шаги: вход, версия, запрос, документ, схема, библиотеки, логи, портал, выполнение кода.",
      "Ничего не записывает.",
      "При сбое хотя бы одного шага код выхода 1.",
    ],
  },
  types: {
    summary: "Типы объектов сервера и их каталоги.",
    usage: ["wtctl types [--search ТЕКСТ] [--limit N] [--cursor N]"],
    notes: [
      "search ищет по имени типа, каталогу и заголовку.",
      "По умолчанию 50 строк, не больше 1000.",
      'customFields "by kind" — настраиваемые поля у каждого вида объекта свои: schema ТИП --kind ID.',
    ],
  },
  schema: {
    summary: "Поля типа объекта.",
    usage: [
      "wtctl schema ТИП [--search ТЕКСТ] [--path ПУТЬ] [--deep] [--origin own,inherited,custom,catalog] [--kind ID] [--include methods] [--language ЯЗЫК] [--limit N] [--cursor N]",
    ],
    notes: [
      "Без --search показывает верхний уровень, с ним ищет на любой глубине.",
      "--deep — вложенные поля всех уровней одним списком; страницы те же (--limit, --cursor), cutBySize — страница короче запрошенной.",
      "query:true — поле есть в каталоге и годится для query; computed:true — вычисляемое.",
      "По умолчанию 80 полей, не больше 1000.",
    ],
  },
  query: {
    summary: "Поиск в каталоге; запрос XQuery.",
    usage: [
      String.raw`wtctl query --catalog collaborators --where '{\"is_dismiss\":false}' --fields id,fullname --limit 20`,
      'wtctl query --catalog collaborators --input-file where.json --fields id,fullname --order "fullname, hire_date desc"',
      "wtctl query 'for $e in collaborators order by $e/fullname return $e' --fields id,fullname --limit 20",
      "wtctl query --input-file query.json",
      "wtctl query --input-file query.xquery",
    ],
    notes: [
      "where — условия через «и»; значение или {оператор: значение} с eq, ne, gt, gte, lt, lte, contains, in.",
      "С --catalog файл из --input-file содержит условия where: так кавычки JSON не зависят от оболочки.",
      "Без --catalog файл с объектом JSON — все аргументы сразу: {catalog, where, fields, order, limit, startPosition} или {query, fields, limit, startPosition}; иначе это текст XQuery.",
      "--limit, --start-position, --fields и --order в командной строке сильнее значений из файла.",
      "--order: поля сортировки через запятую, «поле desc» — по убыванию; работает с --catalog, в тексте XQuery пишут order by.",
      "--limit — строк на странице: по умолчанию 20, не больше 1000.",
      "Ответ: items, total; пока строки не кончились, есть nextStartPosition — он передаётся в --start-position.",
      "Запрос XQuery требует права execute.",
    ],
  },
  object: {
    summary: "Объект: get, create, patch, delete.",
    usage: [
      "wtctl object get [ТИП] ID [--fields id,name]",
      "wtctl object get (--id ID | --url АДРЕС) [--type ТИП]",
      "wtctl object get --ids ID,ID,… [--type ТИП] [--fields id,name] — несколько объектов, до 100",
      String.raw`wtctl object create ТИП (--input-file object.json | --stdin | --args '{\"name\":\"…\"}')`,
      "wtctl object patch [ТИП] ID --input-file patch.json [--preview] [--resave] [--expected-fingerprint ОТПЕЧАТОК]",
      "wtctl object delete [ТИП] ID --permanent [--catalog КАТАЛОГ]",
    ],
    notes: [
      "ТИП перед ID не обязателен: с ним команда проверяет, что объект этого типа.",
      "patch.json — {путь: значение}, [{op:'set'|'remove', path, value}] или {patch:{…}, remove:[пути]}.",
      "Путь: name; a.b; items[0]; custom_elems.custom_elem[name=код].value.",
      "JSON для create и patch принимается тремя способами: --input-file, --stdin, --args.",
      "patch и delete принимают объект и по адресу: (--id ID | --url АДРЕС) [--type ТИП] вместо [ТИП] ID.",
      "--preview показывает изменения без записи.",
      "Правка, которая ничего не меняет, не записывается (noop:true).",
      "--resave сохраняет документ и без правок — сервер заново заполняет поля, которые берёт из связанных объектов; --resave можно дать без JSON.",
      "delete удаляет безвозвратно; --catalog проверяет, что объект был в каталоге и исчез.",
      "create принимает ещё --form-url и --db-name.",
      "Ответ create — id нового объекта и mutationOutcome; patch — changes и mutationOutcome; delete — mutationOutcome и verification.",
    ],
  },
  exec: {
    summary: "Выполнить код на сервере (SP-XML Script).",
    usage: [
      String.raw`wtctl exec --input-file script.js [--params-file params.json | --params '{\"name\":\"…\"}']`,
      "wtctl exec --stdin",
    ],
    notes: [
      "Параметры — объект JSON; в коде это готовая переменная PARAMS: PARAMS.ids, PARAMS.name.",
      "Код присваивает массив переменной RESULT, например RESULT = [{name: doc.TopElem.name + ''}]; ответ — в data.result, числа и логические значения приходят строками.",
      "Значение из String() в ответ не попадает, дата — не на всех версиях сервера: приводить к строке нужно так — x + '', StrDate(d).",
      "Текст ошибки кода — в error.details.scriptError.",
      "Нужно право execute.",
      "Код может менять данные, отката нет.",
    ],
  },
  rpc: {
    summary: "Функции библиотек сервера: list, describe, вызов.",
    usage: [
      "wtctl rpc list [--query ТЕКСТ] [--library БИБЛИОТЕКА] [--method ФУНКЦИЯ] [--all] [--limit N] [--cursor N]",
      "wtctl rpc describe БИБЛИОТЕКА.ФУНКЦИЯ [--source]",
      String.raw`wtctl rpc tools get_version --args '[\"wtv\"]'`,
      "wtctl rpc БИБЛИОТЕКА ФУНКЦИЯ --input-file args.json [--async]",
    ],
    notes: [
      "list читает с сервера функции, разрешённые для вызова с клиента; --all добавляет те, что вызываются только из кода на сервере (serverOnly:true) — их вызывают через exec.",
      "describe знает и те, и другие; --source добавляет код функции.",
      "--built-in берёт встроенную таблицу сборки 2025.1.1171 без обращения к серверу.",
      "Аргументы вызова — массив JSON, ответ — в data.value.",
      "Вызов требует права execute.",
    ],
  },
  logs: {
    summary: "Логи сервера: list, read, tail, search, follow.",
    usage: [
      "wtctl logs list [--type xhttp] [--date ГГГГ-ММ-ДД] [--name-contains ТЕКСТ] [--start-date Д] [--end-date Д] [--offset N] [--limit N]",
      "wtctl logs read ФАЙЛ [--tail-bytes N | --full]",
      "wtctl logs tail ФАЙЛ [--tail-bytes N]",
      "wtctl logs search ФАЙЛ [--text ТЕКСТ] [--level error] [--context ТЕКСТ] [--newest-first] [--full] [--offset N] [--limit N] [--expected-fingerprint ОТПЕЧАТОК]",
      "wtctl logs follow ФАЙЛ [--cursor КУРСОР]",
    ],
    notes: [
      "list показывает сначала свежие файлы, по умолчанию 30; --type — имя лога без даты.",
      "ФАЙЛ — имя из logs list.",
      "read по умолчанию отдаёт конец файла, сколько помещается в один ответ.",
      "Уровень события определяется по словам в тексте.",
      "search ищет в конце файла, с --full — во всём файле; --newest-first отдаёт сначала последние события.",
      "cutBySize:true в ответе search — на страницу поместилось меньше событий, чем --limit, дальше — nextOffset.",
      "follow делает один опрос: первый раз отдаёт последние 10 событий и cursor, дальше передаётся cursor из ответа.",
      "LOG_READ_UNAVAILABLE — сервер сейчас пишет в этот файл: повторить чуть позже.",
    ],
  },
  result: {
    summary: "Большой результат: read, export.",
    usage: [
      "wtctl result read RESULT_ID [--offset N] [--limit N] [--format auto|json|text]",
      "wtctl result export RESULT_ID --to ФАЙЛ [--format json|jsonl|text] [--overwrite]",
    ],
    notes: [
      "Когда в ответе meta.truncated, данные сохранены локально под meta.resultId, а в data.preview — их начало; сервер повторно не вызывается.",
      "read: список ответа (items, types, fields, results) — по элементам, до 1000; остальное — текстом, до 65536 символов. cutBySize — страница короче запрошенной.",
      "export --format jsonl — по строке на элемент списка.",
      "Текст лога или файла читается и сохраняется как текст (--format text).",
    ],
  },
  file: {
    summary: "Загрузка файла в папку загрузок сервера: upload.",
    usage: [
      "wtctl file upload ИМЯ --input-file resource.bin [--content-type application/octet-stream]",
    ],
    notes: ["В ответе url — адрес файла, folderUrl — папка, созданная для него."],
  },
  files: {
    summary: "Файл сервера: read (текстом или на диск), exists, list, write, delete.",
    usage: [
      "wtctl files read АДРЕС",
      "wtctl files read АДРЕС --base64",
      "wtctl files read АДРЕС --to ФАЙЛ [--overwrite]",
      "wtctl files exists АДРЕС",
      "wtctl files list АДРЕС [--search ЧАСТЬ_ИМЕНИ]",
      "wtctl files write АДРЕС --input-file ФАЙЛ",
      "wtctl files delete АДРЕС",
    ],
    notes: [
      "read отдаёт text, если файл — текст в UTF-8, иначе base64; --base64 отдаёт base64 и для текста. --to сохраняет файл на диск байт в байт, любого размера; --overwrite заменяет существующий.",
      "list показывает один уровень папки и требует права execute.",
      "write читает ФАЙЛ с диска частями и сверяет записанное; --stdin держит весь ввод в памяти. В папку кода (wt, wtv, custom…) нужно ещё право execute: файл в ней — код сервера.",
    ],
  },
  doc: {
    summary: "Документ как XML по адресу: get, put, delete.",
    usage: [
      "wtctl doc get АДРЕС",
      "wtctl doc put АДРЕС --input-file document.xml",
      "wtctl doc delete АДРЕС",
    ],
    notes: [
      "Для объектов удобнее object: он сохраняет остальное содержимое документа.",
      "put с --args JSON задаёт все параметры операции native.lds.putDoc.",
    ],
  },
  api: {
    summary: "Остальные операции: list (карта по темам), describe, call.",
    usage: [
      "wtctl api list [--offline]",
      "wtctl api list --topic ТЕМА | --query ТЕКСТ [--effect read|write|execute|unknown] [--limit N] [--cursor N] [--offline]",
      "wtctl api describe ОПЕРАЦИЯ [--offline]",
      String.raw`wtctl api call ОПЕРАЦИЯ (--input-file args.json | --stdin | --args '{\"id\":\"…\"}')`,
    ],
    notes: [
      "list без фильтров показывает темы и ID операций.",
      "--offline читает список из пакета без подключения к серверу.",
    ],
  },
  run: {
    summary: "Несколько операций одним вызовом.",
    usage: ["wtctl run --input-file batch.json", "wtctl run --stdin"],
    notes: [
      "Файл: {steps:[{id, args?, as?}], stopOnError?}; as — имя шага: латинские буквы, цифры и _, первой не цифра.",
      "Значение из прошлого шага: {$ref:'имя_шага.data.id'}.",
      "Права проверяются для каждого шага.",
      "Это не транзакция: выполненные шаги не откатываются.",
    ],
  },
  server: {
    summary: "Сведения о сервере: версия, операционная система, ограничения.",
    usage: ["wtctl server info [--profile native|web]"],
  },
  ws: {
    summary: "Отвечает ли служба WebSocket.",
    usage: ["wtctl ws heartbeat [--timeout-ms N]"],
    notes: ["timeout-ms от 250 до 10000, по умолчанию 5000."],
  },
  mcp: {
    summary: "MCP-сервер для агента (stdio).",
    usage: ["wtctl --config ФАЙЛ --connection ИМЯ mcp"],
    notes: ["Пароль задаётся переменной окружения из подключения: stdin занят протоколом."],
  },
  config: {
    summary: "Файл подключений: init, path, example.",
    usage: [
      "wtctl config init",
      "wtctl config init --url http://localhost:8088 --username user1 --password-stdin < пароль.txt",
      "wtctl config init --name prod --url https://hcm.example.org --username admin --password-env WTCTL_PROD_PASSWORD",
      "wtctl config path",
      "wtctl config example",
    ],
    notes: [
      "init добавляет подключение в файл; в терминале сам спрашивает адрес, имя и пароль.",
      "Первое подключение становится подключением по умолчанию.",
      "Файл по умолчанию — ~/.wtctl/connections.json; другой задают --config или WTCTL_CONFIG.",
      "Новое подключение только читает: --allow-write разрешает запись, --allow-execute — выполнение кода на сервере.",
      "--force заменяет подключение с тем же именем.",
    ],
  },
  guide: {
    summary: "Гайд по работе с сервером: порядок действий, примеры, ошибки.",
    usage: ["wtctl guide", "wtctl guide ТЕМА"],
    notes: [
      "Без темы — общий порядок и список тем.",
      `Темы: ${guideTopics().slice(1).join(", ")}.`,
      "Печатает текст; с --json — обычный ответ с полем data.text.",
      "К серверу не обращается.",
    ],
  },
  version: {
    summary: "Версия клиента.",
    usage: ["wtctl version"],
  },
};

const USAGE = "wtctl [--config ФАЙЛ] [--connection ИМЯ] КОМАНДА …";

const OPTIONS: Readonly<Record<string, string>> = {
  "--config ФАЙЛ": "Файл подключений.",
  "--connection ИМЯ": "Подключение из файла.",
  "--input-file ФАЙЛ | --stdin | --args JSON": "Откуда взять ввод команды; один источник.",
  "--output ФАЙЛ": "Сохранить полный результат в файл; в stdout останется короткая сводка.",
  "--json": "help и guide: ответ JSON вместо текста.",
  "--password-stdin": "Прочитать пароль подключения из stdin.",
};

const NOTES: readonly string[] = [
  "Аргументы и примеры команды: wtctl help КОМАНДА.",
  "Ответ команды — JSON {ok, data, meta} или {ok:false, error:{code, message, hint}}; help и guide печатают текст.",
  "Код выхода: 0 — успех, 1 — ошибка операции, 2 — ошибка аргументов, 3 — ответ не поместился и сохранён локально: result read, result export или --output.",
  "С --output при ошибке операции в сводке есть error, в файле — полный ответ с ok:false; ошибка аргументов или настроек подключения печатается в stderr, файл не создаётся.",
  "ID передаётся строкой: 0x… или десятичной записью.",
  "При коде 3 операция выполнена, в ответе meta.truncated и meta.resultId: запись или код не повторять.",
  "При error.mutationOutcome = indeterminate запись могла пройти: перед повтором проверить объект.",
];

// Имя приходит из командной строки: имена, унаследованные каждым объектом, не команды.
function known(command: string): CommandHelp | undefined {
  return Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : undefined;
}

/** Команда справки к ошибке разбора: справка самой команды, если она есть. */
export function helpCommand(command: string | undefined): string {
  return command !== undefined && command !== "help" && known(command)
    ? `wtctl help ${command}`
    : "wtctl help";
}

export function cliHelp(command?: string): Record<string, unknown> {
  if (command === undefined)
    return {
      usage: USAGE,
      commands: Object.fromEntries(
        Object.entries(COMMANDS).map(([name, help]) => [name, help.summary]),
      ),
      options: OPTIONS,
      notes: NOTES,
    };
  const help = known(command);
  return help === undefined
    ? { command, error: "Неизвестная команда.", commands: Object.keys(COMMANDS) }
    : { command, usage: help.usage, ...(help.notes === undefined ? {} : { notes: help.notes }) };
}

function rows(pairs: readonly (readonly [string, string])[]): string[] {
  const width = Math.max(...pairs.map(([name]) => name.length));
  return pairs.map(([name, text]) => `  ${name.padEnd(width)}  — ${text}`);
}

/** Та же справка, что у cliHelp, разложенная по строкам для чтения. */
export function cliHelpText(command?: string): string {
  const commands = [
    "Команды:",
    ...rows(Object.entries(COMMANDS).map(([name, help]) => [name, help.summary])),
  ];
  const help = command === undefined ? undefined : known(command);
  const lines =
    command === undefined
      ? [USAGE, "", ...commands, "", "Параметры:", ...rows(Object.entries(OPTIONS)), "", ...NOTES]
      : help === undefined
        ? [`Неизвестная команда: ${command}.`, "", ...commands]
        : [
            `wtctl ${command} — ${help.summary}`,
            "",
            ...help.usage.map((line) => `  ${line}`),
            ...(help.notes === undefined ? [] : ["", ...help.notes]),
          ];
  return `${lines.join("\n")}\n`;
}
