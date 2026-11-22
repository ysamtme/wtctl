# CLI

```text
wtctl [--config ФАЙЛ] [-c ИМЯ] [--format ВИД | --json] КОМАНДА …
```

`wtctl help` показывает сгруппированный список команд, а `wtctl help КОМАНДА [ПОДКОМАНДА]` или `wtctl КОМАНДА [ПОДКОМАНДА] --help` — аргументы, флаги и примеры конкретной команды или подкоманды. Справка встроена в CLI и всегда соответствует установленной версии, а здесь дан обзор.

## Установка

Нужен Node.js 22.16 или новее.

```shell
npm install -g wtctl
wtctl config init
wtctl check
```

Без установки те же команды запускаются через `npx -y wtctl` (`npx` скачивает пакет из npm и запускает его); в документации используется короткая запись `wtctl`. В папке с исходниками это `node dist/cli/bin.js` после `npm ci` и `npm run build`.

`config init` создаёт подключение по умолчанию `default` с правом только на чтение в `~/.wtctl/connections.json`, а `check` проверяет вход и основные возможности сервера; для отдельного тестового сервера можно добавить именованное подключение `wtctl config init --name test` (подробнее — в [configuration.md](configuration.md#создание-подключения)).

## Настройка терминала

Эти параметры необязательны и обычно задаются один раз в профиле оболочки:

- **Кодировка в Windows PowerShell 5.1 и cmd.** `wtctl` печатает в UTF-8, а Windows PowerShell 5.1 в русской Windows по умолчанию читает вывод в CP866 и передаёт `--stdin` в ASCII — без настройки кириллица в таблицах, ответах и подсказках автодополнения портится. В `$PROFILE` (до строки с `completion pwsh`) добавляются:

  ```shell
  [Console]::OutputEncoding = [Text.UTF8Encoding]::new()
  $OutputEncoding = [Text.UTF8Encoding]::new()
  ```

  В `cmd.exe` кодировку переключает `chcp 65001`. Если в старом окне консоли Windows (`conhost`) вместо цветов отображаются escape-последовательности, цвета отключаются переменной окружения (`$env:NO_COLOR = "1"` в PowerShell, `set "NO_COLOR=1"` в `cmd.exe`); если управляющие символы видны и во время ожидания ответа, индикатор отключается флагом `-q`.

- **Редактор для `object edit` и `files edit`.** По умолчанию открывается `notepad` в Windows или `vi` в Unix. Чтобы использовать свой редактор, задаётся переменная `WTCTL_EDITOR` (флаг `--editor` имеет приоритет; если `WTCTL_EDITOR` не задана, проверяются `VISUAL` и `EDITOR`). Графическим редакторам нужен флаг ожидания закрытия файла — иначе команда завершится сразу до сохранения:

  ```shell
  # PowerShell ($PROFILE)
  $env:WTCTL_EDITOR = "code --wait"
  ```

  ```shell
  # bash (~/.bashrc) / zsh (~/.zshrc)
  export WTCTL_EDITOR="code --wait"
  ```

- **Автодополнение по `Tab`.** `wtctl completion pwsh|bash|zsh` дополняет команды, подкоманды, флаги, допустимые значения перечислений и имена подключений из файла подключений (без паролей и без обращения к серверу). Регистрация рассчитана на установленную команду `wtctl` в `PATH` (не `npx -y wtctl`); флаг `--format raw` защищает от ситуации, когда в сеансе задан `WTCTL_FORMAT=json`:

  ```shell
  # PowerShell (добавить в $PROFILE)
  wtctl completion pwsh --format raw | Out-String | Invoke-Expression
  ```

  ```shell
  # bash (добавить в ~/.bashrc; в Git Bash для login shell ~/.bash_profile должен подключать ~/.bashrc)
  eval "$(wtctl completion bash --format raw)"

  # zsh (добавить в ~/.zshrc после autoload -Uz compinit && compinit)
  eval "$(wtctl completion zsh --format raw)"
  ```

- **Подключение, формат и цвета.** Подключение по умолчанию переключается командой `wtctl config use ИМЯ`, на один сеанс — переменной `WTCTL_CONNECTION`, на один вызов — флагом `-c ИМЯ`. Формат вывода на весь сеанс задаётся переменной `WTCTL_FORMAT` (`auto`, `table`, `json`, `jsonl`, `csv`, `tsv`, `raw`; флаги `--format` и `--json` имеют приоритет), а цвета управляются стандартными переменными `NO_COLOR` и `FORCE_COLOR`.

## Первые вызовы

```shell
wtctl types сотрудник
wtctl schema collaborator логин
wtctl query collaborators -w is_dismiss=false -f id,fullname -n 5
wtctl object get collaborator ID -f login,lastname
```

- `types` находит тип объекта и его каталог: тип `collaborator`, каталог `collaborators`.
- `schema` показывает поля типа.
- `query` ищет в каталоге. В строке каталога только часть полей документа.
- `object get` читает документ целиком или только нужные поля (подставляется `id` из предыдущего шага).

В интерактивном терминале CLI печатает таблицы, сводки, обычный текст и читаемые сообщения об ошибках. При перенаправлении вывода (в скриптах, pipe и для агентов) возвращается одна строка JSON `{"ok":true,"data":…,"meta":…}`, а с явным `--json` в интерактивном терминале — тот же JSON с отступами.

Условия поиска задаются флагами `-w` (их можно повторять):

```shell
wtctl query collaborators -w is_dismiss=false -w fullname~Иванов -f id,fullname -n 5
```

Для предпросмотра правок (`--preview`) достаточно права чтения; сама запись объекта требует [права](configuration.md#права) `write`, а выполнение кода — `execute` (для тестового подключения включаются отдельно: `wtctl config set test --write true --execute true`):

```shell
wtctl -c test object patch group 0x65CCCF743BBDFFB7 -s "name=Отдел продаж" --preview
wtctl -c test exec --input-file script.js
```

С `--preview` команда показывает, что изменится, и ничего не записывает. Когда изменений много, вместо флагов `-s` передаётся файл (`--input-file patch.json`) с парами «путь: значение»:

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
| `status` | адрес и версия сервера, база данных, пользователь и права подключения |
| `check` | проверка подключения по шагам |
| `server info` | сведения о сервере: версия, ОС, ограничения |
| `ws heartbeat` | проверка службы WebSocket |
| `types [ТЕКСТ]` | типы объектов и их каталоги |
| `schema (ТИП [ТЕКСТ] \| --url АДРЕС)` | поля типа или формы |
| `query [КАТАЛОГ \| XQUERY]` | поиск в каталоге и чтение всех страниц (`--all`); запрос XQuery |
| `object get`, `create`, `patch`, `edit`, `delete` | чтение, создание, правка полями, правка в редакторе и удаление объекта |
| `doc get`, `put`, `delete` | документ по адресу (в терминале и `--format table\|raw` — XML, в JSON — разобранная структура) |
| `exec` | код на сервере (SP-XML Script) |
| `rpc list`, `describe`, `БИБЛИОТЕКА.ФУНКЦИЯ` | функции библиотек сервера и их вызов |
| `agent run` | запуск агента сервера с ожиданием завершения и чтением логов (`--logs`) |
| `tasks list`, `status`, `kill` | список, статус и остановка асинхронных вызовов функций библиотек (`rpc --async`) |
| `run` | несколько операций одним вызовом |
| `files read`, `exists`, `list`, `write`, `edit`, `delete`, `upload` | чтение и сохранение на диск, проверка существования, список папки, запись, правка в редакторе, удаление и загрузка файла в папку загрузок (прежнее имя `file upload` сохранено) |
| `logs list`, `read`, `tail`, `search`, `follow` | логи сервера: список, чтение, хвост, поиск и слежение |
| `result read`, `export` | чтение и выгрузка сохранённого результата |
| `config init`, `list`, `set`, `use`, `remove` (`rm`), `path`, `example` | управление файлом подключений |
| `api list`, `describe`, `call` | остальные операции по ID |
| `mcp` | запуск MCP-сервера (stdio) |
| `guide`, `guide ТЕМА` | встроенный гайд (текст; с `--json` — ответ JSON) |
| `completion pwsh\|bash\|zsh` | генерация скрипта автодополнения команд |
| `version` | версия клиента |

Общие короткие флаги: `-c` (`--connection`), `-o` (`--output`), `-q` (`--quiet`), `-y` (`--yes`), `-h` (`--help`), `-v` (`--version`). Локальные короткие флаги зависят от команды: `-n` (`--limit`, а в `logs tail` — `--lines`), `-f` (`--fields` в `query`, `object get` и `object edit`, `--follow` в `logs tail`), `-w` (`--where`), `-s` (`--set` в `object create`/`patch`, `--search` в `types`/`schema`/`files list`, `--query` в `rpc list`), `-p` (`--params` в `exec`), `-i` (`--input-file`).

## Примеры

Поиск, сортировка, чтение всех страниц и запрос XQuery (в `cmd.exe` вместо одиночных кавычек вокруг запроса используются двойные):

```shell
wtctl query collaborators -w is_dismiss=false -w hire_date:gte=2025-01-01 -f id,fullname,hire_date --order "fullname, hire_date desc"
wtctl query collaborators -w is_dismiss=false -f id,fullname --all --format csv -o collaborators.csv
wtctl query 'for $e in collaborators order by $e/fullname return $e' -f id,fullname
```

Объекты: чтение одного и нескольких, правка флагами и файлом, правка в редакторе, пересохранение и удаление (примеры записи — для тестового подключения `-c test`; в терминале без `--permanent` удаление спрашивает `[y/N]`, а в скриптах добавляется `--permanent`):

```shell
wtctl object get 0x5555555555555501 0x65CCCE16EC975831 -f login,lastname
wtctl -c test object patch group 0x65CCCF743BBDFFB7 -s "name=Отдел продаж" --remove comment --preview
wtctl -c test object patch group 0x65CCCF743BBDFFB7 -i patch.json --preview
wtctl -c test object edit group 0x65CCCF743BBDFFB7 -f name,code
wtctl -c test object patch collaborator 0x65CCCE16EC975831 --resave
wtctl -c test object delete group 0x65CCCF743BBDFFB7
```

Код на сервере, синхронный и асинхронный вызов функций библиотек и агенты сервера (примеры выполнения — для `-c test`):

```shell
wtctl -c test exec -i script.js
wtctl -c test exec -i examples/script-params.js -p name=Иван -p limit=5
wtctl -c test rpc tools.get_version wtv
wtctl -c test rpc tools.my_long_job --async
wtctl -c test tasks list tools.my_long_job
wtctl -c test tasks status TRACKING_ID
wtctl -c test agent run 0x65D6BB73BFE67019 --logs
```

Логи, файлы и подключения:

```shell
wtctl logs tail xhttp -n 20 -f
wtctl logs search xhttp "XQUERY FAILED" --level error -n 5
wtctl files read x-local://wt/web/default.html --to ./default.html
wtctl -c test files write x-local://share/reports/2026.zip ./2026.zip
wtctl -c test files upload ./archive.zip
wtctl -c test files edit x-local://share/notes.txt
wtctl config use test
wtctl config remove old-test
```

Файл правки бывает и длиннее одной пары:

```json
{ "name": "Отдел продаж", "access.access_level": 3, "custom_elems.custom_elem[name=код_поля].value": "значение" }
```

Чтобы убрать поле из документа через файл, его структура совпадает с аргументами инструмента MCP: `{"patch":{"name":"Отдел продаж"},"remove":["comment"]}`.

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

Команды поддерживают короткий ввод без ручного JSON и передачу JSON из файла, stdin или аргумента — оба способа совместимы.

### Короткий ввод и повторяемые флаги

- **`query`:** каталог принимается первым аргументом (`wtctl query collaborators …`, прежний `--catalog` сохранён); строка с пробелами или выражением XQuery распознаётся как запрос XQuery. Флаг `-w` / `--where` повторяемый: разные условия на одном поле соединяются через И (повтор одного оператора отклоняется), `true`, `false` и `null` распознаются автоматически, остальные значения типизирует ядро по форме каталога. В bash и cmd символы `>` и `<` без кавычек обрабатывает оболочка даже внутри слова, поэтому для переносимых сравнений без кавычек предусмотрены записи с двоеточием (значения с пробелами берутся в кавычки целиком):

  | Условие | Короткая запись | Переносимая запись | Пример |
  | --- | --- | --- | --- |
  | равно / не равно | `поле=значение`, `поле!=значение` | `поле:eq=…`, `поле:ne=…` | `-w is_dismiss=false` |
  | подстрока | `поле~значение` | `поле:contains=…` | `-w fullname~Иванов` |
  | больше / больше или равно | `поле>значение`, `поле>=значение` | `поле:gt=…`, `поле:gte=…` | `-w hire_date:gte=2025-01-01` |
  | меньше / меньше или равно | `поле<значение`, `поле<=значение` | `поле:lt=…`, `поле:lte=…` | `-w hire_date:lt=2026-01-01` |
  | одно из значений | — | `поле:in=a,b,c` | `-w state_id:in=1,2` |
  | объект JSON | `'{…}'` | — | `--where '{\"is_dismiss\":false}'` |

- **`object create` и `object patch`:** повторяемые `-s` / `--set путь=значение` (строка) и `--set-json путь=JSON` работают самостоятельно и вместе с `--input-file`, `--stdin` и `--args`; флаги `--remove путь`, `--preview` и `--resave` (как и селекторы `[…]` в путях) относятся только к `object patch`.
- **`object get`:** принимает несколько ID позиционно (`wtctl object get 0x1 0x2` или `wtctl object get collaborator 0x1 0x2`, до 100 штук) наравне с `--ids`.
- **Позиционный поиск:** `types`, `schema ТИП`, `rpc list`, `files list АДРЕС` и `logs search ФАЙЛ` принимают строку поиска позиционно либо через прежние флаги (`--search`, `--query`, `--text`) — два источника одновременно отклоняются.
- **`rpc`:** принимает как `БИБЛИОТЕКА ФУНКЦИЯ`, так и `БИБЛИОТЕКА.ФУНКЦИЯ`, а простые скалярные аргументы можно передавать позиционно после имени функции (целые до 15 цифр и `true`/`false`/`null` распознаются автоматически, ведущие нули, дробные и 64-битные ID остаются строками; остальные типы — через `--args`, `--input-file` или `--stdin`).
- **`exec`:** параметры `PARAMS` задаются либо файлом `--params-file`, либо повторяемыми `-p ключ=значение` (целые до 15 цифр и `true`/`false`/`null` распознаются автоматически, дробные, ведущие нули и 64-битные ID остаются строками; строку вроде `"5"` передают через `--param-json 'x=\"5\"'` или файл) и `--param-json ключ=JSON` (совмещать `--params-file` с `-p`/`--param-json` нельзя). `-p` также принимает JSON-объект `'{…}'`.
- **`files write` и `files upload`:** локальный файл можно указать аргументом без флага (`wtctl files write АДРЕС ФАЙЛ`, `wtctl files upload ФАЙЛ [--name ИМЯ]`), а прежний вид с `--input-file` продолжает работать.

Повторяемые флаги — `-w`/`--where`, `-s`/`--set`, `--set-json`, `--remove`, `-p`/`--params`, `--param-json`, а также `--objects` в `agent run`; повтор остальных флагов отклоняется как ошибка аргументов.

### Файлы, stdin и JSON

Структурированные данные передаются одним из трёх способов:

- `-i` / `--input-file ФАЙЛ` — JSON, код или содержимое файла;
- `--stdin` — то же из stdin;
- `--args 'JSON'` — короткий JSON в аргументе.

PowerShell, cmd и bash по-разному обрабатывают кавычки внутри аргумента. В PowerShell и bash короткий JSON записывается как `'{\"is_dismiss\":false}'`; в `cmd.exe` одиночные кавычки не считаются разделителями, поэтому весь аргумент берётся в двойные кавычки (`--where "{\"is_dismiss\":false}"`, `wtctl query "for …"`, `wtctl exec "RESULT = …"`). Всё, что длиннее пары полей, удобнее передавать файлом.

У `query` файл читается по-разному:

- с каталогом (`--catalog` или позиционным) в файле лежат условия `where`;
- без каталога объект JSON — это все аргументы сразу: `{"catalog":"…","where":{…},"fields":[…],"order":[…],"limit":20,"startPosition":0}` или `{"query":"…","fields":[…],"limit":20,"startPosition":0}`;
- любой другой текст — запрос XQuery.

`--limit`, `--start-position`, `--fields` и `--order` в командной строке имеют приоритет над значениями из файла. С флагом `--all` команда читает все страницы по очереди с проверкой `incomplete` (как `queryRows` в SDK); размер страницы задаётся через `--page-size` (по умолчанию `200`, до `1000`), общее ограничение строк — через `--max-rows` (с `--limit` флаг `--all` несовместим, даже если `limit` задан в файле). В форматах `csv`, `tsv`, `jsonl` и `raw` строки при `--all` выводятся потоково по страницам (для `csv`, `tsv` и `raw` столбцы лучше задавать через `--fields`: при появлении новых полей на следующих страницах команда остановится с `QUERY_COLUMNS_CHANGED`). В режимах `json` и `table` без `--output` соблюдается предел `outputLimitBytes`: крупный итог сохраняется локально с кодом `3`, а с `--json -o ФАЙЛ` записывается потоково.

`files write` с локальным файлом (без флага или через `--input-file`) передаёт операции путь, и файл читается с диска частями: память не растёт с размером файла. `--stdin` держит весь ввод в памяти, потому что длину файла сервер получает до начала записи. Большой файл передаётся путём к файлу.

`files read` с `--to ФАЙЛ` сохраняет файл сервера на диск байт в байт, текст или двоичный, любого размера: предел `maxResponseBytes` на него не действует, и память не растёт с размером файла. Файл появляется под своим именем, только когда прочитан целиком. Существующий файл заменяется только с `--overwrite`, без него — `FILE_EXISTS`. Флаг `--output` работает поверх ответа операции (ограничен `maxResponseBytes`): в JSON-выводе содержимое UTF-8 файла записывается в `data.text`, двоичное содержимое — в `data.base64` (`--base64` принудительно выбирает base64), в терминале для двоичного файла запишет текстовую сводку вместо байт, а с `--format raw` сохранит байты. Для скачивания файлов с сервера используется `--to`.

ID объекта пишется как есть, `0x…` или десятичной записью: `0x5555555555555501`, `6148914691236517121`.

## Вывод

Формат вывода выбирается флагом `--format ВИД`, переменной окружения `WTCTL_FORMAT` (флаг имеет приоритет) или коротким синонимом `--json` (то же, что `--format json`; одновременно `--json` и `--format` не задаются). У команд `result read` и `result export` собственный флаг `--format` сохраняет прежнее значение формата выгрузки результата, а `--json` переключает ответ CLI в JSON.

| Формат | Поведение |
| --- | --- |
| `auto` (по умолчанию) | в интерактивном терминале (`stdout` — TTY) — читаемый вывод (таблицы, сводки, текст); при перенаправлении (в скриптах и pipe) — одна строка JSON `{ok, data, meta}` |
| `table` | читаемый вывод даже при перенаправлении (удобно для просмотра в `less` или сохранения таблицы в текстовый файл через `-o`) |
| `json` | ответ `{"ok":true,"data":{…},"meta":{…}}` или `{"ok":false,"error":{…}}` (в скриптах и pipe указывать не обязательно: `auto` сам отдаст однострочный JSON; в терминале `--json` печатает его с отступами) |
| `jsonl` | по одному объекту JSON на строку для элементов списка без обёртки `{ok, data, meta}` (или один объект `data`) |
| `csv`, `tsv` | табличный вывод (RFC 4180 для CSV, табуляция для TSV) для табличных команд; для остальных команд — ошибка аргументов |
| `raw` | данные без обёртки и заголовков: текст или байты файла в `files read`, текст лога/XML/кода, путь в `config path`, версия в `version`, значения полей в `query` |

В читаемом выводе (интерактивный терминал и `--format table`):

- списки (`types`, `schema`, `query`, `logs list`, `files list`, `rpc list`, `config list`, `api list`, `tasks list`) выводятся таблицами с выравниванием, учётом ширины терминала (`COLUMNS`), числом показанных строк и параметром следующей страницы;
- одиночные ответы (`status`, `server info`, `version`, `object get/create/patch/delete`, `files exists/write/upload`, `agent run`, `tasks status`, `ws heartbeat`, `config`) выводятся компактными сводками; `check` — списком шагов с отметками `✓`, `✗`, `−`;
- текстовые данные (`files read` для текста, `logs read/tail/search/follow`, `rpc describe --source`) печатаются как есть, без JSON-экранирования; `doc get` в терминале и с `--format table|raw` собирает XML из ответа `native.lds.loadDoc` (для исходного файла байт в байт нужен `files read АДРЕС --to ФАЙЛ`); для двоичных файлов `files read` показывает сводку и подсказку про `--to`;
- `object patch --preview` показывает построчный diff с предупреждением о полях, которые сервер заполняет сам (`serverFilled`);
- цвета в таблицах, логах и diff зависят от TTY и учитывают `NO_COLOR` и `FORCE_COLOR`;
- при долгих вызовах, если `stderr` подключён к терминалу (без `-q`/`--quiet` и вне `--json`), через ~250 мс появляется индикатор ожидания, который стирает свою строку перед выводом ответа или ошибки;
- ошибки печатаются в `stderr` читаемо (`Ошибка [КОД]: …`, `Подсказка: …`, для `SCRIPT_FAILED` — текст `scriptError`, при исходе `indeterminate` — предупреждение не повторять запись). В текстах ошибок операции названы командами CLI: `wtctl types`, а не `schema.types`.

При перенаправлении вывода (`auto` без TTY) и с `--json` формат JSON и коды выхода не меняются (при перенаправлении — одна строка JSON в `stdout`, в интерактивном терминале с `--json` — JSON с отступами):

```json
{"ok":true,"data":{…},"meta":{"operationId":"runtime.query","connection":"test","durationMs":12}}
```

`help`, `guide` и `completion` печатают текст, а с `--json` — такой же ответ JSON.

| Код выхода | Значение |
| --- | --- |
| 0 | успех |
| 1 | ошибка операции, закрытия сессии, записи локального файла или записи ответа в `stdout` (для записи нельзя повторять команду по одному коду `1` — нужно проверить `error.mutationOutcome` и состояние цели) |
| 2 | неверные аргументы команды |
| 3 | ответ не поместился и сохранён локально: `result read`, `result export` или `--output` |

Если `outputLimitBytes` не задан явно ни в файле подключений, ни в `WTCTL_OUTPUT_LIMIT_BYTES`, предел по умолчанию составляет **256 КиБ** для читаемого вывода в терминале (`auto` и `--format table`) и при потоковом слежении за логами (в том числе при перенаправлении); в остальных случаях действуют прежние **24 КиБ**. Без `--output` ответ больше этого предела сохраняется локально, CLI печатает `meta.resultId` и завершается с кодом `3` (операция при этом уже выполнена: запись или код на сервере повторять не нужно; дочитать можно через `wtctl result read ID` или `wtctl result export ID --to ФАЙЛ`, подробнее — в [configuration.md](configuration.md#сохранённые-результаты)).

`-o` / `--output ФАЙЛ` сохраняет полный ответ в файл: для `json`, `jsonl`, `csv`, `tsv`, а также `files read` и `logs read` в формате `raw` выгрузка из сохранённого результата идёт потоково (без предела форматирования 8 МиБ, но сама операция по-прежнему ограничена `maxResponseBytes`), а для читаемого вывода (`auto` в терминале и `--format table`) и остальных команд в формате `raw` результат форматируется в памяти (до 8 МиБ):

- в JSON-режиме в `stdout` остаётся короткая сводка (у записи в ней `id` и `mutationOutcome`, у большого ответа — `bytes` и `meta.resultId`), а при ошибке операции код выхода `1`, в сводке есть `error`, и в файл записывается полный ответ с `"ok":false`;
- в остальных форматах (`table`, `csv`, `tsv`, `jsonl`, `raw`) короткая сводка о сохранении идёт в `stderr` (если хотя бы один поток вывода подключён к терминалу; если перенаправлены оба — в `stdout`, в скриптах её отключает `-q`), а при отказе операции файл не создаётся (кроме отчётов `check` и `run`); `help`, `guide` и `completion` без `--json` записывают текст в файл без сводки;
- ошибки аргументов (код `2`) и настроек подключения (код `1`) всегда печатаются в `stderr` без создания файла (файл от прошлого запуска остаётся как был, поэтому в скриптах сначала проверяется код выхода).

## Работа в терминале

### Слежение за логами

Список файлов на сервере показывает `wtctl logs list` (можно сузить через `--type xhttp`, `--date 2026-10-01` или `--name-contains ТЕКСТ`). В команды `logs read`, `logs tail`, `logs search` и `logs follow` первым аргументом передаётся один из двух вариантов:

- **конкретный файл с `.log`** (например, `wtctl logs tail xhttp_2026-10-01.log -n 20`) — открывается ровно этот файл;
- **имя типа без `.log`** (любое значение из столбца «Тип»: `xhttp`, `agent`, `auth-events` и т. д.) — CLI сам находит самый свежий файл этого типа через `logs.list` и в читаемом выводе без `-q` печатает выбранное имя в `stderr`.

| Команда | Поведение в терминале |
| --- | --- |
| `wtctl logs read ФАЙЛ` | Печатает текст файла как есть (последние байты или `--full` целиком) и выходит |
| `wtctl logs search ФАЙЛ [ТЕКСТ]` | Ищет события по тексту, `--level` или `--context` и выходит |
| `wtctl logs tail ФАЙЛ [-n N]` | Показывает последние `N` событий (в читаемом выводе без `--tail-bytes` по умолчанию `50`; с `-n` в JSON-выводе возвращается `data.text`, а строки событий — с `-n N --format jsonl\|csv\|tsv`) и выходит |
| `wtctl logs tail ФАЙЛ [-n N] -f` | Показывает последние `N` событий и показывает новые до `Ctrl+C` (`--interval` допустим только с `-f`; `--json`, `--output` и `--format json\|csv\|tsv` с `-f` отклоняются) |
| `wtctl logs follow ФАЙЛ` | Сразу включает слежение за новыми событиями до `Ctrl+C` (до 10 последних событий для контекста, затем опрос циклом) |

В потоковом режиме (`logs follow` в терминале с `auto` или с `--format table` даже при перенаправлении, а также `logs tail -f`) интервал опроса задаётся через `--interval СЕК` (по умолчанию `2`, от `0.5` до `60`), `Ctrl+C` завершает работу с кодом `0`, при `LOG_READ_UNAVAILABLE` CLI ждёт до следующего опроса и использует тот же курсор, а при указании типа без `.log` сам переходит на новый файл при смене суток; потоковый режим не принимает `--output`. Для потокового вывода `logs follow` в формате `jsonl` или `raw` (в том числе при перенаправлении: `wtctl logs follow xhttp --format jsonl --interval 2`) нужно явно задать `--interval` (без `--interval` форматы `jsonl` и `raw` выполняют один опрос даже в терминале). Один опрос с возвратом `data.cursor` в JSON даёт `wtctl logs follow ФАЙЛ --once --json` (либо перенаправление вывода без `--interval` и без `--format table`; комбинации `--json --interval` и `--once --interval` отклоняются с кодом `2`).

Устройство чтения логов на сервере и коды ошибок описаны в [logs.md](logs.md).

### Правка в редакторе

Обе команды работают по одной схеме: скачивают содержимое во временную копию, открывают редактор (см. [Настройка терминала](#настройка-терминала) про `WTCTL_EDITOR` и `--wait` внутри строки редактора), ждут сохранения и закрытия файла, показывают diff, запрашивают подтверждение `[y/N]` (или записывают сразу с `-y`/`--yes`; без интерактивного терминала без `-y` правки не сохраняются и возвращается `CONFIRMATION_REQUIRED`), проверяют, что на сервере не было параллельных правок, сохраняют изменения и удаляют временный файл (если удалить временную папку не удалось, выводится предупреждение). Если файл не менялся, на сервер ничего не отправляется; флаг `--output` в этих командах не поддерживается.

- `wtctl files edit АДРЕС [--editor "code --wait"] [-y]` открывает текстовый файл сервера (двоичный файл отклоняется) во временной копии с тем же расширением, для файлов до 512 КиБ показывает построчный diff (для более крупных — изменение размера) и записывает правки через `files.write`.
- `wtctl object edit [ТИП] ID [-f ПОЛЯ] [--editor "code --wait"] [-y]` открывает выбранные (`-f`) или все поля объекта в `.json`, по разнице «было / стало» строит минимальный `patch` / `remove` (удаление ключа в JSON удаляет поле, остальные узлы XML не затрагиваются), показывает предпросмотр `objects.patch` с предупреждением о `serverFilled` и записывает с `expectedFingerprint`.
- `wtctl object edit [ТИП] ID --xml [--editor "code --wait"] [-y]` открывает исходный XML документа (`native.lds.loadDoc`/`putDoc`), сохраняя форматирование и порядок узлов, но отклоняет некорректный XML, смену корневого элемента, изменение `<id>` и параллельные правки на сервере (`--xml` и `--fields` несовместимы).

### Подтверждение удаления и остановки асинхронных вызовов

Когда `stdin`, `stdout` и `stderr` подключены к интерактивному терминалу, команды `object delete`, `files delete`, `tasks kill` и `config remove` (`rm`) перед выполнением показывают имя подключения и краткие сведения о цели и запрашивают подтверждение `[y/N]` в `stderr`. При отказе запрос на удаление не отправляется (при этом клиент мог предварительно прочитать объект или проверить файл), печатается «Отменено.» и возвращается код выхода `1`. Вопрос отключается флагом `-y` / `--yes` (а для `object delete` и `files delete` также флагом `--permanent`). Если хотя бы один из потоков (`stdin`, `stdout` или `stderr`) перенаправлен, интерактивного вопроса нет: `object delete` в таком запуске требует `--permanent` (даже при `--yes`), а `files delete`, `tasks kill` и `config remove` выполняются сразу. Команды `doc delete`, `api call` и шаги внутри `run` интерактивного подтверждения не запрашивают.

## Скрипты

Рецепты ниже записаны на PowerShell (в bash и cmd отличаются синтаксис сценариев и правила кавычек, сами вызовы `wtctl` те же). В скриптах, которые разбирают JSON, рекомендуется указывать `--json` явно, чтобы на результат не влияла переменная `WTCTL_FORMAT` из окружения. Автономные `.ps1`-скрипты, которые могут запускаться без `$PROFILE` в Windows PowerShell 5.1, начинают со строк UTF-8 (`[Console]::OutputEncoding = [Text.UTF8Encoding]::new()`, а при использовании `--stdin` также `$OutputEncoding = [Text.UTF8Encoding]::new()`, см. [Настройка терминала](#настройка-терминала)).

### Выгрузка в CSV

Для быстрой выгрузки из терминала хватает `wtctl query collaborators -w is_dismiss=false -f id,fullname,hire_date --order id --all --format csv -o collaborators.csv` (для двоичных файлов с сервера аналогично используется `wtctl files read АДРЕС --to ./file.bin`, одинаково работающий в PowerShell 5.1, PowerShell 7 и bash). Когда нужна собственная обработка полей и контроль каждой страницы в скрипте, используется постраничный цикл с `--json`:

```shell
$env:WTCTL_OUTPUT_LIMIT_BYTES = 1048576
$rows = @()
$start = 0
while ($null -ne $start) {
  $out = wtctl query --catalog collaborators --where '{\"is_dismiss\":false}' --fields id,fullname,hire_date --order id --limit 500 --start-position $start --json
  if ($LASTEXITCODE -eq 3) { throw 'Страница не поместилась в ответ: уменьшить --limit.' }
  if ($LASTEXITCODE -ne 0) { throw "wtctl завершился с кодом ${LASTEXITCODE}: $out" }
  $page = ($out | ConvertFrom-Json).data
  if ($page.incomplete) { throw "База данных отвергла запрос: $($page.hint)" }
  foreach ($row in $page.items) {
    foreach ($field in $row.PSObject.Properties) { if ($field.Value -is [datetime]) { $field.Value = $field.Value.ToString('s') } }
  }
  $rows += $page.items
  $start = $page.nextStartPosition
}
$rows | Export-Csv collaborators.csv -NoTypeInformation -Encoding UTF8
```

- `WTCTL_OUTPUT_LIMIT_BYTES` поднимает [предел ответа](configuration.md#сохранённые-результаты) до наибольшего: в предел по умолчанию 500 строк не помещаются.
- Код 3 значит, что страница всё равно не поместилась: в `$out` только её начало, а не все строки.
- `incomplete` — страница, которую отвергла база данных, а не конец строк.
- Столбцы идут в порядке `--fields`.
- PowerShell 7 `ConvertFrom-Json` делает из даты `DateTime`, а `Export-Csv` пишет его в формате региональных настроек: `16.09.2019 0:00:00`. Цикл по полям возвращает запись сервера, `2019-09-16T00:00:00`; в Windows PowerShell 5.1 дата и так остаётся строкой.
- `Export-Csv` в Windows PowerShell 5.1 без `-Encoding UTF8` пишет кириллицу знаками `?`. Excel узнаёт UTF-8 по BOM: в PowerShell 7 для него нужно `-Encoding utf8BOM`.

Тот же скрипт с параметрами — [examples/export-csv.ps1](../examples/export-csv.ps1).

### Объект со списком

Группа с одним сотрудником, затем ещё один сотрудник в ней (для тестового подключения `-c test`):

```shell
$created = wtctl -c test object create group --input-file group.json --json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw "wtctl завершился с кодом $LASTEXITCODE" }
wtctl -c test object patch $created.data.id --input-file add-member.json --json
if ($LASTEXITCODE -ne 0) { throw "wtctl завершился с кодом $LASTEXITCODE" }
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
- Удаление одного элемента: `{"remove":["collaborators.collaborator[collaborator_id=0x65CCCE16EC975831]"]}`.

### Перевод сотрудника в другое подразделение

Подразделение сотрудника — это подразделение его должности. Сначала меняется должность, затем сотрудник сохраняется заново (для тестового подключения `-c test`):

```shell
$person = '0x65CCCE16EC975831'
$subdivision = '0x66A4196000001003'
$position = (wtctl -c test object get $person --fields position_id --json | ConvertFrom-Json).data.data.position_id
if ($LASTEXITCODE -ne 0 -or -not $position) { throw "Не удалось прочитать должность сотрудника" }
@{ parent_object_id = $subdivision } | ConvertTo-Json | Set-Content position.json -Encoding UTF8
wtctl -c test object patch $position --input-file position.json --json
if ($LASTEXITCODE -ne 0) { throw "Не удалось обновить должность (код $LASTEXITCODE)" }
wtctl -c test object patch $person --resave --json
if ($LASTEXITCODE -ne 0) { throw "Не удалось пересохранить сотрудника (код $LASTEXITCODE)" }
```

Без `--resave` документ сотрудника и каталог `collaborators` показывают прежнее подразделение: название должности и подразделения в них — копии, их сервер заполняет при сохранении сотрудника. Если должности нет, `position_id` придёт в `data.emptyFields`.

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

Это не транзакция: по умолчанию выполнение останавливается после первой ошибки (`"stopOnError": false` продолжает остальные шаги), а уже выполненные шаги не откатываются. Права проверяются для каждого шага, интерактивных подтверждений для `objects.delete`, `files.delete` и `tasks kill` внутри пакета нет.

## Список операций без подключения

`wtctl api list` и `wtctl api describe ОПЕРАЦИЯ` читают список операций из пакета без настроек подключения и не обращаются к серверу (флаг `--offline` сохранён для совместимости).

## Встроенный гайд

`wtctl guide` печатает обзор и список тем, `wtctl guide ТЕМА` — выбранную тему. Темы перечислены в [README](../README.md#документация).
