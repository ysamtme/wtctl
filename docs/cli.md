# CLI

```text
wtctl [--config ФАЙЛ] [--connection ИМЯ] КОМАНДА …
```

`wtctl help` показывает список команд, `wtctl help КОМАНДА` или `wtctl КОМАНДА --help` — аргументы и примеры одной команды. Справка встроена в CLI и всегда соответствует установленной версии, а здесь только обзор.

## Установка

Нужен Node.js 22.16 или новее.

```shell
npm install -g wtctl
wtctl version
```

Без установки то же делает `npx -y wtctl version`: `npx` скачивает пакет из npm и запускает его. В документации команда пишется как `wtctl`; без установки перед ней ставится `npx -y`. В папке с исходниками это `node dist/cli/bin.js` после `npm ci` и `npm run build`.

Командам, которые обращаются к серверу, нужно подключение: [как его создать](configuration.md#создание-подключения).

## Первые вызовы

```shell
wtctl types --search сотрудник
wtctl schema collaborator --search логин
wtctl query --catalog collaborators --fields id,fullname --limit 5
wtctl object get collaborator 0x5555555555555501 --fields login,lastname
```

- `types` находит тип объекта и его каталог: тип `collaborator`, каталог `collaborators`.
- `schema` показывает поля типа.
- `query` ищет в каталоге. В строке каталога только часть полей документа.
- `object get` читает документ целиком или только нужные поля.

Условия поиска — JSON в `--where`:

```shell
wtctl query --catalog collaborators --where '{\"is_dismiss\":false}' --fields id,fullname --limit 5
```

Кавычки внутри JSON записаны как `\"`: в таком виде аргумент одинаково работает в Windows PowerShell, PowerShell 7 и bash. В cmd весь JSON берётся в двойные кавычки: `"{\"is_dismiss\":false}"`. JSON длиннее пары полей передаётся файлом: `--catalog collaborators --input-file where.json`, а в файле `{"is_dismiss":false}`.

Запись и выполнение кода работают, когда у подключения включены [права](configuration.md#права) `write` и `execute`:

```shell
wtctl object patch group 0x65CCCF743BBDFFB7 --input-file patch.json --preview
wtctl exec --input-file script.js
```

С `--preview` команда показывает, что изменится, и ничего не записывает. В `patch.json` — пары «путь: значение»:

```json
{ "name": "Отдел продаж" }
```

В `script.js` — код на SP-XML Script. Он присваивает массив переменной `RESULT`, это и будет ответ:

```javascript
var doc = OpenDoc(UrlFromDocID(Int('0x5555555555555501')));
RESULT = [{ id: doc.DocID + '', lastname: doc.TopElem.lastname + '' }];
```

## Команды

| Команда | Что делает |
| --- | --- |
| `status` | версия сервера и права подключения |
| `check` | проверка подключения по шагам |
| `types` | типы объектов и их каталоги |
| `schema ТИП` | поля типа |
| `query` | поиск в каталоге; запрос XQuery |
| `object get`, `create`, `patch`, `delete` | работа с объектом |
| `exec` | код на сервере |
| `rpc list`, `rpc describe`, `rpc БИБЛИОТЕКА ФУНКЦИЯ` | функции библиотек сервера |
| `logs list`, `read`, `tail`, `search`, `follow` | логи сервера |
| `files read`, `exists`, `list`, `write`, `delete` | файлы сервера: прочитать (текст приходит текстом, остальное — в base64), проверить адрес, показать папку, записать, удалить |
| `file upload` | загрузить файл в папку загрузок сервера |
| `doc get`, `put`, `delete` | документ как XML по адресу |
| `api list`, `api describe`, `api call` | остальные операции по ID |
| `run` | несколько операций одним вызовом |
| `result read`, `result export` | большой сохранённый результат |
| `server info`, `ws heartbeat` | сведения о сервере, проверка службы WebSocket |
| `mcp` | запустить MCP-сервер для агента |
| `config init`, `config path`, `config example` | добавить подключение, показать файл подключений, пример файла |
| `guide`, `guide ТЕМА` | гайд по задачам: текстом, а с `--json` — обычным ответом JSON |
| `version` | версия клиента |

## Примеры

Поиск: условия из файла, сортировка, запрос XQuery.

```shell
wtctl query --catalog collaborators --input-file where.json --fields id,fullname --limit 20
wtctl query --catalog collaborators --fields id,fullname,hire_date --order "fullname, hire_date desc"
wtctl query 'for $e in collaborators order by $e/fullname return $e' --fields id,fullname
```

Объекты: чтение одного и нескольких, правка без записи, сохранение без правок, удаление.

```shell
wtctl object get 0x5555555555555501 --fields login,lastname
wtctl object get --ids 0x5555555555555501,0x65CCCE16EC975831 --fields login,lastname
wtctl object patch group 0x65CCCF743BBDFFB7 --input-file patch.json --preview
wtctl object patch collaborator 0x65CCCE16EC975831 --resave
wtctl object delete group 0x65CCCF743BBDFFB7 --permanent
```

Код, функция библиотеки, агент сервера.

```shell
wtctl exec --input-file script.js
wtctl exec --input-file examples/script-params.js --params '{\"name\":\"Иван\",\"limit\":5}'
wtctl rpc tools get_version --args '[\"wtv\"]'
wtctl api call agents.run --args '{\"id\":\"0x65D6BB73BFE67019\"}'
```

Логи и файлы.

```shell
wtctl logs search xhttp_2026-10-01.log --level error --limit 5
wtctl files read x-local://wt/web/default.html --output page.json
```

Файл правки бывает и длиннее одной пары:

```json
{ "name": "Отдел продаж", "access.access_level": 3, "custom_elems.custom_elem[name=код_поля].value": "значение" }
```

Чтобы убрать поле из документа, файл пишется так же, как аргументы инструмента MCP: `{"patch":{"name":"Отдел продаж"},"remove":["comment"]}`.

Готовые входные файлы лежат в папке `examples`:

| Файл | Что в нём | Команда |
| --- | --- | --- |
| [catalog-query.json](../examples/catalog-query.json) | все аргументы поиска в одном файле | `wtctl query --input-file examples/catalog-query.json` |
| [patch.json](../examples/patch.json), [patch-paths.json](../examples/patch-paths.json) | правка парами «путь: значение» и списком действий | `wtctl object patch group ID --input-file examples/patch.json --preview` |
| [script-params.js](../examples/script-params.js) | код с параметрами | `wtctl exec --input-file examples/script-params.js --params '{\"name\":\"Иван\",\"limit\":5}'` |
| [rpc-arguments.json](../examples/rpc-arguments.json) | аргументы функции с явным типом | `wtctl rpc tools get_version --input-file examples/rpc-arguments.json` |
| [batch-read.json](../examples/batch-read.json) | несколько операций одним вызовом | `wtctl run --input-file examples/batch-read.json` |
| [connections.example.json](../examples/connections.example.json) | файл подключений | — |
| [mcp.example.json](../examples/mcp.example.json) | MCP-сервер в конфиге приложения | — |
| [export-csv.ps1](../examples/export-csv.ps1) | скрипт на PowerShell: сотрудники в CSV постранично | `.\examples\export-csv.ps1 -Path collaborators.csv` |
| [sdk.mjs](../examples/sdk.mjs) | скрипт на SDK: список сотрудников через `queryRows` | `node examples/sdk.mjs` |

## Ввод

Данные команде передаются одним способом из трёх:

- `--input-file ФАЙЛ` — JSON, код или данные из файла;
- `--stdin` — то же из stdin;
- `--args 'JSON'` — короткий JSON в аргументе.

PowerShell, cmd и bash по-разному обрабатывают кавычки внутри аргумента. Запись `\"` CLI понимает в любом из них; в cmd весь JSON при этом берётся в двойные кавычки. Всё, что длиннее пары полей, передаётся файлом.

У `query` файл читается по-разному:

- с `--catalog` в файле условия `where`;
- без `--catalog` объект JSON — это все аргументы сразу: `{"catalog":"…","where":{…},"fields":[…],"order":[…],"limit":20,"startPosition":0}` или `{"query":"…","fields":[…],"limit":20,"startPosition":0}`;
- любой другой текст — запрос XQuery.

`--limit`, `--start-position`, `--fields` и `--order` в командной строке важнее значений из файла.

ID объекта пишется как есть: `0x5555555555555501`.

## Вывод

CLI печатает в stdout одну строку JSON:

```json
{"ok":true,"data":{…},"meta":{"operationId":"runtime.query","connection":"test","durationMs":12}}
```

`help` и `guide` печатают текст, а с `--json` — такой же ответ JSON. В текстах ошибок операции названы командами: `wtctl types`, а не `schema.types`.

| Код выхода | Значение |
| --- | --- |
| 0 | успех |
| 1 | операция не выполнена: `{"ok":false,"error":{"code","message","hint"}}` |
| 2 | неверные аргументы команды |
| 3 | ответ не поместился и сохранён локально: `result read`, `result export` или `--output` |

`--output ФАЙЛ` сохраняет полный ответ в файл, какого бы размера он ни был:

- в stdout остаётся короткая сводка: у записи в ней `id` и `mutationOutcome`, у большого ответа — `bytes` и `meta.resultId` локальной копии;
- если операция не выполнена, код выхода 1, в сводке есть `error`, а в файле — полный ответ с `"ok":false`;
- ошибка в аргументах (код 2) и ошибка в настройках подключения (код 1) печатаются в stderr. Файл при этом не создаётся, а файл от прошлого запуска остаётся как был, поэтому сначала нужно проверить код выхода.

Без `--output` ответ больше `outputLimitBytes` сохраняется локально, а CLI печатает `meta.resultId` и завершается с кодом 3. Операция при этом выполнена: запись или код на сервере повторять не нужно. Дочитать его можно через `wtctl result read ID` или `wtctl result export ID --to ФАЙЛ`: [сохранённые результаты](configuration.md#сохранённые-результаты).

## Скрипты

Рецепты записаны для PowerShell. В bash и cmd команды те же, отличаются только кавычки, см. [Ввод](#ввод).

`wtctl` печатает в UTF-8, а PowerShell читает вывод команды в кодировке консоли. В консоли с кодовой страницей 866 кириллица в ответе портится, поэтому скрипт, который разбирает ответ, начинается с этой строки:

```powershell
[Console]::OutputEncoding = [Text.UTF8Encoding]::new()
```

### Выгрузка в CSV

```powershell
$env:WTCTL_OUTPUT_LIMIT_BYTES = 1048576
$rows = @()
$start = 0
while ($null -ne $start) {
  $out = wtctl query --catalog collaborators --where '{\"is_dismiss\":false}' --fields id,fullname,hire_date --order id --limit 500 --start-position $start
  if ($LASTEXITCODE -eq 3) { throw 'Страница не поместилась в ответ: уменьшить --limit.' }
  if ($LASTEXITCODE -ne 0) { throw "wtctl завершился с кодом ${LASTEXITCODE}: $out" }
  $page = ($out | ConvertFrom-Json).data
  if ($page.incomplete) { throw "Сервер отверг запрос: $($page.hint)" }
  $rows += $page.items
  $start = $page.nextStartPosition
}
$rows | Export-Csv collaborators.csv -NoTypeInformation -Encoding UTF8
```

- `WTCTL_OUTPUT_LIMIT_BYTES` поднимает предел ответа до наибольшего, 1 МБ: 500 строк в 24 КБ по умолчанию не помещаются.
- Код 3 значит, что страница всё равно не поместилась: в `$out` только её начало, а не все строки.
- `incomplete` — страница, которую отвергла база данных, а не конец строк.
- Столбцы идут в порядке `--fields`.
- `Export-Csv` в Windows PowerShell 5.1 без `-Encoding UTF8` пишет кириллицу знаками `?`. Excel узнаёт UTF-8 по BOM: в PowerShell 7 для него нужно `-Encoding utf8BOM`.

Тот же скрипт с параметрами — [examples/export-csv.ps1](../examples/export-csv.ps1).

### Объект со списком

Группа с одним сотрудником, затем ещё один сотрудник в ней:

```powershell
$created = wtctl object create group --input-file group.json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw "wtctl завершился с кодом $LASTEXITCODE" }
wtctl object patch $created.data.id --input-file add-member.json
```

`group.json`:

```json
{ "code": "sales", "name": "Отдел продаж", "collaborators": { "collaborator": [{ "collaborator_id": "0x5555555555555501" }] } }
```

`add-member.json`:

```json
{ "collaborators.collaborator[collaborator_id=0x65CCCE16EC975831].collaborator_id": "0x65CCCE16EC975831" }
```

- Повторяемый элемент — всегда список, даже из одного элемента: `collaborator` — массив.
- Список целиком записывает структура-родитель `collaborators`. В правке так же, и прежние элементы при этом заменяются.
- Запись по ключу добавляет элемент, если элемента с этим ключом нет. Когда элементу нужен только ключ, значение повторяет ключ.
- Убрать один элемент: `{"remove":["collaborators.collaborator[collaborator_id=0x65CCCE16EC975831]"]}`.

### Перевод сотрудника в другое подразделение

Подразделение сотрудника — это подразделение его должности. Сначала меняется должность, затем карточка сотрудника сохраняется заново:

```powershell
$person = '0x65CCCE16EC975831'
$subdivision = '0x66A4196000001003'
$position = (wtctl object get $person --fields position_id | ConvertFrom-Json).data.data.position_id
@{ parent_object_id = $subdivision } | ConvertTo-Json | Set-Content position.json -Encoding UTF8
wtctl object patch $position --input-file position.json
wtctl object patch $person --resave
```

Без `--resave` карточка сотрудника и каталог `collaborators` показывают прежнее подразделение: название должности и подразделения в них — копии, их сервер заполняет при сохранении сотрудника. Если должности нет, `position_id` придёт в `data.emptyFields`.

### Код с параметрами из файла

```shell
wtctl exec --input-file examples/script-params.js --params-file params.json
```

`params.json`:

```json
{ "name": "Иван", "limit": 5 }
```

В коде параметры — готовый объект `PARAMS`, в текст кода их подставлять не нужно. ID передаётся строкой, в коде из неё получают число: `Int(PARAMS.id)`.

### Значения в ответе

- Логические значения — строки `"1"` и `"0"`. В PowerShell непустая строка — истина, и `"0"` тоже, поэтому сравнивать нужно со строкой: `$row.is_dismiss -eq '1'`.
- Числа — тоже строки.
- ID из кода на сервере приходит в десятичной записи: `7336568271880514489` — тот же объект, что `0x65D0B9F8F3D6EBB9`. Команды принимают его как есть.

### Windows PowerShell 5.1

- Кириллицу через `--stdin` Windows PowerShell 5.1 отправляет знаками `?`: в `$OutputEncoding` там `us-ascii`, и поиск по такому условию молча ничего не находит. Перед такой командой: `$OutputEncoding = [Text.UTF8Encoding]::new()`.
- JSON из переменной в аргументе теряет кавычки. Такой JSON записывается в файл и передаётся через `--input-file`, как `position.json` выше. Файл пишет `Set-Content -Encoding UTF8`: `>` пишет UTF-16, его команда не прочитает.

## Несколько операций одним вызовом

`wtctl run --input-file batch.json` выполняет шаги по порядку. Значение из ответа прошлого шага подставляет `{"$ref":"имя.data.путь"}`:

```json
{
  "steps": [
    { "id": "runtime.query", "as": "found", "args": { "catalog": "groups", "fields": ["id"], "limit": 1 } },
    { "id": "objects.get", "args": { "id": { "$ref": "found.data.items.0.id" } } }
  ]
}
```

Это не транзакция: после первой ошибки остальные шаги не выполняются, а уже выполненные не откатываются. Права проверяются для каждого шага.

## Список операций без подключения

`wtctl api list --offline` и `wtctl api describe ОПЕРАЦИЯ --offline` читают список операций из пакета и не обращаются к серверу.

## Гайд по задачам

`wtctl guide` печатает порядок работы и список тем, `wtctl guide ТЕМА` — одну тему. Темы перечислены в [README](../README.md#документация).
