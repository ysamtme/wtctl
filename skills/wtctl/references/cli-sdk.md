# Команда `wtctl`, SDK, несколько операций одним вызовом

## Как запустить

Если `wtctl` есть в `PATH`, вызывай `wtctl`. Если нет, команду для этого компьютера называет гайд сервера: `hcm_guide {topic:"cli-sdk"}`, раздел «На этом компьютере» в конце.

Подключение команда и SDK берут из файла подключений (какой файл — показывает `wtctl config path`) или из переменных `WTCTL_URL`, `WTCTL_USERNAME`, `WTCTL_PASSWORD` своей оболочки. Переменные, заданные в записи MCP-сервера, им не видны. `--connection ИМЯ` выбирает подключение из файла; без него берётся подключение по умолчанию.

`wtctl help` показывает команды, `wtctl help КОМАНДА` — аргументы и примеры одной команды. Сначала читай справку нужной команды, флаги не угадывай.

## Соответствие инструментам MCP

| Инструмент                                                           | Команда                                                                                                                                                                                                                      |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hcm_status`, `hcm_check`                                            | `wtctl status`, `wtctl check`                                                                                                                                                                                                |
| `hcm_types`, `hcm_schema`                                            | `wtctl types --search сотрудник`, `wtctl schema collaborator --search логин`                                                                                                                                                 |
| `hcm_query`                                                          | `wtctl query --catalog collaborators --input-file where.json --fields id,fullname --order "fullname, hire_date desc"`; в файле условия: `{"is_dismiss":false}`                                                               |
| `hcm_xquery`                                                         | `wtctl query 'for $e in collaborators order by $e/fullname return $e' --fields id,fullname`                                                                                                                                  |
| `hcm_object_get`                                                     | `wtctl object get collaborator 0x5555555555555501 --fields login,lastname`; несколько объектов — `wtctl object get --ids 0x…,0x… --fields login`                                                                             |
| `hcm_object_create`, `_patch`, `_delete`                             | `wtctl object create ТИП --input-file object.json`, `object patch ТИП ID --input-file patch.json --preview` (`--resave` — сохранить и без правок), `object delete ТИП ID --permanent`; вместо `ТИП ID` годится `--url АДРЕС` |
| `hcm_script`                                                         | `wtctl exec --input-file script.js`; параметры кода — `--params-file params.json` или `--params '{\"id\":\"0x…\"}'`                                                                                                          |
| `hcm_logs_list`, `hcm_logs_search`, `hcm_log_read`, `hcm_log_follow` | `wtctl logs list`, `logs search ФАЙЛ --level error --newest-first`, `logs read ФАЙЛ`, `logs follow ФАЙЛ`                                                                                                                     |
| `hcm_api_list`, `hcm_api_describe`                                   | `wtctl api list`, `wtctl api describe ОПЕРАЦИЯ`                                                                                                                                                                              |
| `hcm_api_read`, `_write`, `_execute`                                 | `wtctl api call ОПЕРАЦИЯ --input-file args.json`                                                                                                                                                                             |
| `hcm_result_read`, `hcm_result_export`                               | `wtctl result read ID`, `wtctl result export ID --to ФАЙЛ`                                                                                                                                                                   |
| `hcm_guide`                                                          | `wtctl guide`, `wtctl guide ТЕМА`                                                                                                                                                                                            |

## Ввод и вывод

- JSON и код передавай файлом (`--input-file`) или через stdin (`--stdin`). `--args '…'` и `--where '…'` годятся для короткого JSON. Оболочки по-разному обрабатывают кавычки внутри аргумента; запись `\"` команда понимает в любой из них: `--where '{\"is_dismiss\":false}'`. В cmd весь JSON берут в двойные кавычки.
- Файл для `query` без `--catalog`: объект JSON — это все аргументы сразу (`{"catalog":"…","where":{…},"fields":[…],"order":[…],"limit":20,"startPosition":0}` или `{"query":"…","fields":[…],"limit":20,"startPosition":0}`), иначе — текст запроса XQuery. `--limit`, `--start-position`, `--fields` и `--order` в командной строке сильнее значений из файла.
- Ответ — одна строка JSON в stdout: `{"ok":true,"data":…,"meta":…}` или `{"ok":false,"error":{"code","message","hint"},"meta":…}`. `help` и `guide` печатают текст; с `--json` — такой же ответ JSON.
- Код выхода: 0 — успех, 1 — операция не выполнена, 2 — неверные аргументы команды, 3 — ответ не поместился и сохранён локально: `result read`, `result export` или `--output`.
- `--output ФАЙЛ.json` сохраняет полный ответ в файл, какого бы размера он ни был; в stdout остаётся короткая сводка (у записи в ней `id` и `mutationOutcome`). Табличных форматов (CSV) команда не пишет. Используй для больших ответов. Если операция не выполнена, код выхода 1, в сводке есть `error`, в файле — полный ответ с `"ok":false`. Ошибка аргументов (код 2) и ошибка настроек подключения (код 1) печатаются в stderr; файл не создаётся, а файл от прошлого запуска остаётся как был. Сначала проверяй код выхода.
- Без `--output` ответ больше лимита обрезается: `meta.truncated` и `meta.resultId`, в `data.preview` — начало, код выхода 3. Операция при этом выполнена: запись или код не повторяй. Дочитать: `wtctl result read ID` (список ответа читается по элементам) или `wtctl result export ID --to ФАЙЛ` (`--format jsonl` — по строке на элемент списка). Сохранённый текст лога или файла выгружается текстом: `--format text`. Страница короче запрошенной помечена `cutBySize`.

## Несколько операций одним вызовом

`wtctl run --input-file batch.json`:

```json
{
  "steps": [
    {
      "id": "runtime.query",
      "as": "found",
      "args": { "catalog": "groups", "fields": ["id", "name"], "limit": 1 }
    },
    {
      "id": "objects.get",
      "args": { "id": { "$ref": "found.data.items.0.id" }, "fields": ["name"] }
    }
  ]
}
```

- `id` — ID операции. ID основных операций: `runtime.query`, `objects.get`, `objects.create`, `objects.patch`, `objects.delete`, `schema.get`, `schema.types`, `execute.script`, `rpc.call`; остальные показывает `wtctl api list`.
- `as` даёт шагу имя: латинские буквы, цифры и `_`, первой не цифра. `{"$ref":"имя.data.путь"}` подставляет значение из ответа этого шага; элемент массива — по номеру (`items.0.id`).
- Ответ: `results` — ответы шагов по порядку (у шага с именем оно повторено в `as`), `completed` — сколько шагов выполнено.
- Это не транзакция: первый отказ останавливает остальные шаги, выполненные не откатываются. `stopOnError:false` выполняет все шаги.
- Если отказал хоть один шаг, ответ всего вызова — `BATCH_FAILED`, а ответы шагов остаются в `data.results`. Какие шаги отказали, сказано в `error.details.failed`. Большой ответ пакета сохраняется: шаги читает `hcm_result_read` по `meta.resultId`.
- Права проверяются для каждого шага.

В MCP тот же вызов идёт через инструмент по самому сильному шагу: только чтение — `hcm_api_read {operationId:"runtime.batch", args:{steps:[…]}}`, есть запись — `hcm_api_write`, есть код или вызов функции — `hcm_api_execute`. При ошибке выбора ответ называет нужный инструмент.

## SDK

SDK нужен, когда задачу удобнее решить скриптом: цикл по сотням объектов, своя обработка данных. Скрипт на JavaScript (Node.js 22.16 или новее):

```javascript
// script.mjs
import { loadConfig, withHcmClient } from "wtctl";

await withHcmClient(loadConfig(), async (client) => {
  const rows = client.queryRows({
    catalog: "collaborators",
    where: { is_dismiss: false },
    fields: ["id", "fullname"],
  });
  for await (const row of rows) console.log(row.id, row.fullname);
});
```

Так пишут в проекте, где пакет установлен. Без установки SDK импортируют по адресу из гайда сервера: `hcm_guide {topic:"cli-sdk"}`, раздел «На этом компьютере». `loadConfig()` без аргументов берёт то же подключение, что и команда.

- `withHcmClient` открывает подключение и закрывает его после функции.
- Каждый метод возвращает тот же ответ `{ok, data, meta}` или `{ok:false, error}`. `unwrap` достаёт `data` или бросает ошибку с полями `code`, `hint`, `mutationOutcome`.
- Методы: `status`, `check`, `types`, `schema`, `query`, `queryRows`, `get`, `create`, `patch`, `delete`, `execute` (код), `runAgent`, `rpc`, `listRpc`, `describeRpc`, `batch`, `listLogs`, `searchLogs`, `readLog`, `followLog`, `readFile`, `fileExists`, `listFiles`, `writeFile`, `deleteFile`, `uploadFile`, `readResult`, `exportResult`. Любая операция по ID: `client.call("native.lds.loadDoc", { url })`.
- Аргументы методов те же, что у инструментов MCP: `client.patch({ id, patch: { name: "…" }, preview: true })`; код принимается и строкой, параметры кода — вторым аргументом: `client.execute("RESULT = [PARAMS.n];", { n: 1 })`. Код из файла: `client.execute(await readFile("check.js", "utf8"), params)`. Запустить агента и дождаться конца: `client.runAgent({ id })`. Запрос XQuery — тот же `query`: `client.query({ query: "for $e in … return $e", fields: ["id"] })`.
- `queryRows` принимает те же аргументы, что `query`, и сам листает страницы. Страница с `incomplete:true` (запрос отвергнут, а не конец данных) — ошибка `QUERY_INCOMPLETE`. Массив строк — `await Array.fromAsync(client.queryRows(…))`.
- Ответ больше 24 КБ сохраняется на диск, и `unwrap` и `queryRows` бросают `HcmStoredResultError` (`RESULT_STORED`). В скрипте подними предел — `loadConfig({ settings: { outputLimitBytes: 1024 * 1024 } })`, больше 1 МБ нельзя — и задавай `fields`.
- `loadConfig({ connection: "имя" })` выбирает подключение, `configPath` — другой файл подключений. Права `write` и `execute` заданы в подключении, скрипт их не расширяет.
