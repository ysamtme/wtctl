# История изменений

Пока версия ниже 1.0, имена инструментов, команд и аргументов могут меняться. Такие изменения идут в описании версии первыми, в разделе «Несовместимые изменения».

## Не выпущено

Несовместимые изменения:

- Убраны пять низкоуровневых операций, которые повторяли другие: `native.lds.openSession` и `web.lds.openSession` — вместо них `native.session.open` и `web.session.open`; `native.lds.closeSession` и `web.lds.closeSession` — вместо них `native.session.close` и `web.session.close`; `native.spxml.call` — вместо неё `native.rpc.call`. Вызов убранного ID отвечает `UNKNOWN_OPERATION`. Ответ `*.session.*` содержит ещё поле `profile`. В `wtctl/protocol` у `NativeSession` убрано поле `spxml`: это был тот же объект, что `rpc`.
- В SDK убрано поле `status` у операций: оно у всех было `implemented` и ничего не значило. Его больше нет в ответе `getNativeOperations()`, `listHcmOperations()` и `describeHcmOperation()` и в типе `OperationDefinition`; убраны фильтр `status` у `listHcmOperations()` и флаг `--status` у `wtctl api list`.
- В SDK у `LogReader` убраны поля-константы с английскими пояснениями: `semantics` и `consistency` у ответа `read()`, `severityDetection` и `lineNumbers` у `search()`, `semantics` у `follow()`. Их нет и в типах `LogReadData`, `LogSearchData`, `LogFollowData`. В ответы `logs.*` они и раньше не попадали.
- Команда `wtctl` завершается с кодом 3, когда ответ не поместился в `outputLimitBytes` и сохранён локально: в stdout прежний JSON с `ok:true`, `meta.truncated` и `meta.resultId`, но данных в нём только начало. Раньше код был 0, и скрипт мог принять начало за весь ответ. Скрипт, который считает ошибкой любой ненулевой код, теперь остановится и на таком ответе: дочитать его — `wtctl result read` или `wtctl result export`, получить сразу целиком — `--output ФАЙЛ`, с ним код 0. Операция при коде 3 выполнена: запись или код на сервере повторять не нужно.
- Точка входа `wtctl` отдаёт только то, что описано для вызывающего: `HcmClient`, `withHcmClient`, `loadConfig`, `unwrap`, `getCleanupError`, `HcmError`, `HcmOperationError`, `HcmStoredResultError`, `HcmCleanupError`, `listHcmOperations`, `describeHcmOperation` и типы аргументов и ответов. Убраны `HcmRuntime`, `NativeGateway`, `getNativeOperations`, `LogReader`, `LogReadUnavailableError`, `RpcCatalog`, `withHcm`, `parseFileExists`, `parseServerInfo`, `configExample` и типы `HcmSdkRuntime`, `NativeConfig`, `NativeOperation`, `LogFile`, `LogEvent`, `LogListData`, `LogReadData`, `LogSearchData`, `LogFollowData`. Убран `HcmClient.fromRuntime`; конструктор `HcmClient` в типах принимает только подключение, поля `runtime` в типах нет. `NativeGateway` и `getNativeOperations` по-прежнему есть в `wtctl/native`. Вместо `withHcm` — `withHcmClient`, вместо `LogReader` — `client.listLogs`, `readLog`, `searchLogs`, `followLog`.
- Поле `verification` в ответе `objects.delete` — `server` или `catalog`, как другие значения протокола клиента. Раньше было `server acknowledgement` и `catalog absence`. Тип `DeletedObjectData.verification` в SDK — `"server" | "catalog"`.

Добавлено:

- Клиент сам удаляет старые сохранённые результаты, когда сохраняет новый: старше `resultsMaxAgeDays` (по умолчанию 7 дней), затем самые старые, пока результаты подключения больше `resultsMaxBytes` (1 ГБ). Результаты моложе часа остаются, поэтому предел приблизительный. Чтение удалённого результата отвечает `RESULT_NOT_FOUND` с подсказкой повторить запрос. Раньше папка результатов только росла.
- Журнал записей `mutations.jsonl` не больше `journalMaxBytes` (10 МБ): переполненный файл становится `mutations.1.jsonl`, новые строки идут в новый файл. Журнал описан в `docs/configuration.md`.
- `0` в `resultsMaxBytes`, `resultsMaxAgeDays` и `journalMaxBytes` снимает предел.
- Переменные `WTCTL_MAX_RESPONSE_BYTES`, `WTCTL_OUTPUT_LIMIT_BYTES`, `WTCTL_RESULTS_MAX_BYTES`, `WTCTL_RESULTS_MAX_AGE_DAYS` и `WTCTL_JOURNAL_MAX_BYTES`: теперь все поля подключения, кроме адреса, учётных данных и прав, задаются и без файла, в том числе в `env` MCP-сервера. Как и `WTCTL_TIMEOUT_MS`, они действуют и при файле с разделом `connections`. Ошибка в значении называет поле и переменную. Число в переменной и в файле записывается только цифрами: `5e3` и пробелы вокруг числа больше не принимаются.
- `loadConfig({ settings })` в SDK задаёт те же поля кодом, с той же проверкой; `settings` сильнее переменных и файла. Адрес, учётные данные и права подключения из файла или переменных `settings` не меняет. `settings` с `baseUrl` — отдельное подключение без файла и переменных, права по умолчанию выключены.
- `wtctl object get`, `patch` и `delete` принимают ID без типа: `wtctl object get 0x… --fields login`. Тип перед ID по-прежнему можно указать, тогда команда проверяет тип объекта.
- У каждого имени, которое экспортирует `wtctl`, у методов `HcmClient` и у полей их аргументов и ответов в типах пакета есть описание по-русски: что делает метод, что значит поле, когда `unwrap` бросает. Его показывает подсказка редактора. Новые имена типов вместо безымянных: `GetManyInput`, `GetManyData`, `RunAgentInput`, `FileListInput`, `ResultExportData`, `LogResetReason`. `docs/sdk.md` перечисляет функции и классы пакета.
- Справочник SDK `docs/sdk-reference.md`: каждая функция, метод `HcmClient`, ошибка и тип с аргументами, полями ответа и описанием — тот же текст, что в подсказке редактора. Таблица типов методов в `docs/sdk.md` заменена ссылкой на него.
- `client.queryRows(args)` в SDK перебирает строки каталога или запроса XQuery одним `for await`: аргументы те же, что у `query`, страницы метод листает сам. Страница с `incomplete:true` бросает `HcmOperationError` с кодом `QUERY_INCOMPLETE` и подсказкой сервера, а не выглядит как конец данных. Большой ответ бросает `HcmStoredResultError`, как `unwrap`.
- В `docs/cli.md` раздел «Скрипты»: выгрузка в CSV постранично в PowerShell с проверкой кода выхода, объект со списком и добавление элемента по ключу, перевод сотрудника в другое подразделение, код с параметрами из файла, какие значения приходят в ответе и что учесть в Windows PowerShell 5.1. Новый пример `examples/export-csv.ps1`; `examples/sdk.mjs` перебирает строки через `queryRows`. В `docs/sdk.md` — `queryRows` вместо своего цикла по страницам и раздел «Значения».

Исправления:

- У ошибок SDK в `name` имя класса: `HcmStoredResultError`, `HcmOperationError`, `HcmCleanupError`. Раньше у всех было `HcmError`. Подсказка `HcmStoredResultError` называет методы SDK `readResult` и `exportResult` и `loadConfig({ settings: { outputLimitBytes } })`, а не операции и инструменты MCP.
- Сбой в коде самого клиента отвечает `INTERNAL_ERROR`. Раньше часть таких сбоев приходила как `INVALID_ARGUMENT` с английским сообщением движка JavaScript и подсказкой про аргументы, хотя аргументы были в порядке. Отказы по аргументам остались `INVALID_ARGUMENT` с прежними текстами. Подсказка у `INTERNAL_ERROR` говорит, что это дефект клиента и подбирать аргументы не нужно; то же сказано в теме гайда `errors`.
- Отказы по аргументу, у которых был английский текст Node, получили русский: неверные `path` и `headers` у `*.experimental.rawRequest`, значение в `params` у `execute.script`, которое нельзя записать как JSON, нулевой символ в `path` у `results.export`. Неверный `method` у `*.experimental.rawRequest` отклоняется до запроса как `INVALID_ARGUMENT`, а не как `PLATFORM_HTTP`. `objects.get` по адресу файла не в UTF-8 отвечает `INVALID_XML` с подсказкой про `files.read`.
- Неизвестный ID операции CLI и MCP-сервер называют в ошибке так, как его передали, а похожие на него — ID операций. Раньше в них подставлялись имена команд или инструментов: `wtctl api call api.list` отвечал «Операции wtctl api list нет». Ошибки, которые CLI получает до вызова операции, тоже называют команды CLI.
- Подсказка `TARGET_MISMATCH` не говорит «Запись не отправлена»: так было и у `objects.get`, где записи нет, и после записи с исходом `indeterminate`. Подсказка `CATALOG_MISMATCH` у `objects.delete` тоже больше не говорит об исходе. Его сообщает `mutationOutcome`.
- Отказы по аргументу, которые шлюз находит до отправки, у низкоуровневых операций записи и выполнения кода отвечают `mutationOutcome: not_sent`, а не `indeterminate`: недопустимый в XML символ у `native.lds.*` и `web.lds.*`, `path`, `headers` и `method` у `*.experimental.rawRequest`, `dbName` у `native.physicalDocuments.createFromXml`.
- `native.resources.getImage` и `web.resources.getImage` не оставляют соединение, которое сервер закрывает после картинки. Раньше на только что запущенном сервере следующий запрос в это соединение обрывался: `PLATFORM_HTTP` «Соединение оборвалось». Так бывало на серверах 2025.1.1171 и 2025.1.1333.
- `objects.create` с `dbName`, которого нет на сервере, отвечает `INVALID_ARGUMENT` до выдачи ID, исход — `not_sent`; подсказка называет базы сервера. Раньше сервер выдавал ID, запись отвечала HTTP 500 с исходом `indeterminate`, а подсказка говорила о значении поля.
- `wtctl query --fields id,fullname` без кавычек работает в PowerShell: списки `--fields`, `--ids`, `--order`, `--origin` и `--include` делятся и по запятой, и по пробелу. Раньше PowerShell передавал `id,fullname` команде через обёртку npm как `id fullname`, и поиск отвечал `INVALID_FIELDS`. В `--order` `desc` и `asc` остаются при поле перед ними.
- Поля строки ответа `query` идут в порядке `fields`. Раньше пустое поле, которое сервер в строке опускает, вставало в конец, и столбцы выгрузки перемешивались.
- Примеры JSON в справке команд записаны как `'{\"…\"}'`, как в `docs/cli.md`: в таком виде они работают и в Windows PowerShell 5.1.
- Ошибки разбора командной строки (`cli.invalid_input`) называют справку той команды, где ошибка: `wtctl help query`, а не `wtctl help <группа>`. Неизвестный флаг назван по имени, рядом — похожий настоящий: «Неизвестный флаг --feilds», «Похожий: --fields». Значение флага не печатается. Подсказка про пароль в командной строке — только у флагов вроде `--password` и `--token`. Тексты ошибок переписаны без английских слов: например, удаление без `--permanent` объясняет, что корзины нет.
- Подсказка `READ_BACK_MISMATCH` у `objects.delete` на сервере 2025.2 с MS SQL называет причину и выход: такой сервер не удаляет документы, пока после запуска или простоя не сохранён ни один документ, поэтому нужно сохранить любой документ (`objects.patch` с `resave:true`) и повторить удаление. Раньше это было сказано только в теме гайда `objects`. На других серверах подсказка прежняя.
- У операций чтения в ошибке нет поля `mutationOutcome`: раньше часть отказов приходила с `not_sent`, хотя записи не было. `RUNTIME_CLOSED` у записи и выполнения кода отвечает `not_sent`; раньше исхода в нём не было.
- Файл подключений, где `connections`, подключение или `permissions` — не объект, отвечает `INVALID_CONFIG`, а не `INVALID_ARGUMENT`.

## 0.4.0 — 2026-10-13

Все тексты клиента — по-русски. Имена инструментов, команд, операций и аргументов, коды ошибок и ответы операций не менялись.

Изменения:

- Описания низкоуровневых операций в `api list`, `api describe` и инструментах `hcm_api_*` написаны по-русски; раньше они были английскими. У пяти операций в `api describe` появилось поле `details` с полным описанием. Страница `api list` вмещает на несколько карточек меньше: её предел считается в байтах.
- Сообщения ошибок клиента, шлюза и слоя протокола и сообщения CLI написаны по-русски. Коды ошибок, условия отказов и исходы записи прежние: программе нужно сравнивать `error.code`, а не текст.
- Комментарии в объявлениях типов пакета (`.d.ts`) написаны по-русски.
- Описание пакета в `package.json` написано по-русски; английская строка в начале README убрана.
- Внутреннее устройство клиента: каждая операция описана одним определением вместе со своим обработчиком, runtime держит только конвейер вызова. Тип ответа методов SDK сверяется с обработчиком операции при сборке. На проверенных серверах ответы CLI и MCP-сервера совпали с 0.3.1.

## 0.3.1 — 2026-10-13

Исправление исхода записи и переработка внутреннего устройства клиента без изменения операций.

Исправления:

- Запись, которую сервер принял, а проверочное чтение отклонил отказом во входе, даёт `indeterminate`, а не `not_sent`; подсказка говорит, что запрос на запись уже ушёл и что запись нужно проверить, прежде чем повторять. Отказ во входе на первом же запросе по-прежнему даёт `not_sent`.

Изменения:

- Внутреннее устройство клиента переработано: все запросы к серверу идут через один модуль, исход записи считает один модуль, ответ собирает один модуль. Операции, их аргументы и ответы прежние: на серверах 2025.1.1171 — 2025.2.1535 ответы CLI и MCP-сервера совпали с ответами 0.3.0.
- В типах пакета у конструктора `HcmRuntime` появился необязательный второй параметр — способ обращения к серверу. Без него всё работает как раньше.

## 0.3.0 — 2026-10-13

Чистка операций по итогам прогона на проверенных серверах и уточнение прав.

Несовместимые изменения:

- Убраны шесть операций, которые отказывали на всех проверенных серверах: `native.lds.getModDeletedObjects`, `native.lds.createDoc`, `web.pages.createDoc`, `web.pages.getIcon`, `web.experimental.getUiTemplate`, `web.lifecycle.logout2`.
- Убраны операции больших полей: `native.lds.loadLargeField`, `native.lds.putLargeField`, `native.lds.deleteLargeField`, `web.spxml.putLargeField`, `web.spxml.putLargeFieldFromUrl`. На проверенных серверах полей с адресом `x-db-obj://` нет, и ни одна из этих операций ни разу не отработала.
- Убрана группа `native.experimental.spxml` (восемь операций): она повторяла `web.spxml.*`. Вместо неё — `web.spxml.callMethodAsync`, `getAsyncMethodStatus`, `killAsyncMethod`, `getBackgroundTasksByName`, `getDoc`, `putDoc`.
- `native.lds.getNewObjectId` требует права `write` и вызывается через `hcm_api_write`: каждый вызов расходует ID.
- `files.delete` в папках `wt_data` и `trash` отказывает до отправки (`FILE_NOT_DELETABLE`): сервер там файлы и папки по адресу не удаляет. В 0.2.2 запрос уходил, и операция отвечала `READ_BACK_MISMATCH`.
- `wtctl/protocol`: убраны методы и типы ушедших операций и класс `NativeExperimentalSpXmlApi`.

Изменения:

- `rawRequest` с методом GET или HEAD считается чтением и не требует прав `write` и `execute`; признак `unsafe: true` нужен по-прежнему.
- MCP SDK обновлён до 1.31.0.

## 0.2.2 — 2026-10-13

Исправления:

- `files.delete` проверяет адрес после ответа сервера. В папках базы сервера `wt_data` и `trash` сервер отвечает на удаление файла и пустой папки как на успешное, а файл остаётся: раньше операция отвечала `deleted:true` с исходом `confirmed`, теперь — `READ_BACK_MISMATCH` с исходом `indeterminate`. Проверено на 2025.1.1333 — 2025.2.1535; в остальных папках данных удаление работает как раньше.

Документация:

- Гайд по файлам и [страница совместимости](docs/compatibility.md): `wt_data` и `trash` сервер читает через память. Файл и папка там по адресу не удаляются, а после перезаписи файла `files.read` может отдать прежнее содержимое.

## 0.2.1 — 2026-10-13

Несовместимые изменения:

- Убраны операции `web.spxml.getLargeField` и `native.experimental.spxml.getLargeField`. На сервере 2025.2.1535 вызов с адресом `x-db-obj://` типа, у которого нет хранилища больших полей, завершал процесс сервера. Операция числилась чтением и не требовала прав `write` и `execute`; ни на одном проверенном сервере она не отработала. В версиях до 0.2.1 её лучше не вызывать.
- `wtctl/protocol`: убраны методы `getLargeField` и тип `GetLargeFieldRequest`.

## 0.2.0 — 2026-10-13

Файлы сервера: запись и удаление в любой папке, куда сервер принимает файлы, и список папки. Убраны операции, которые не работали.

Несовместимые изменения:

- Операции с файлом по адресу убраны: `native.lds.loadUrl`, `native.lds.putUrl`, `native.lds.deleteUrl`, `native.lds.unlockUrl`, `web.lds.deleteUrl`, `web.pages.copyUrl`. Вместо них — `files.read`, `files.write`, `files.delete`, `files.list`; копия файла — чтение и запись по новому адресу.
- Команды `wtctl file get`, `file put`, `file delete` убраны: их заменяют `wtctl files read`, `files write`, `files delete`. `wtctl file upload` осталась.
- Убраны 16 операций, на всех проверенных серверах они отвечали отказом или не использовались: группа `legacy.xhttp` (9 операций), `legacy.session.open`, `legacy.session.close`, `legacy.experimental.rawRequest`, `native.lds.eval`, `web.lds.eval`, `native.experimental.readDirectory`, `web.pages.putUrl`. Профиль `legacy` убран целиком.
- Ключи подключения `installationId` и `installationIdFile`, переменные `WTCTL_INSTALLATION_ID` и `WTCTL_INSTALLATION_ID_FILE` убраны; оставшиеся в файле подключений ключи игнорируются.
- `wtctl/protocol`: убраны `LegacySession`, `XHttpBinaryResponse`, типы `LegacyCatalogKey` и `XHttpResult`, методы клиента `openLegacySession` и `withLegacySession`, вид ошибки `xhttp-result`, методы `NativeLdsApi.unlockUrl`, `WebLdsApi.deleteUrl`, `WebPageApi.copyUrl`. У двоичного результата больше нет поля `records`.

Новое:

- `files.write` и `files.delete` работают в любой папке, куда сервер принимает файлы. Путь клиент выбирает до отправки, по спискам папок самого сервера: в папке данных (`share`, `wt_data` и других) хватает права `write`; в папке кода (`wt`, `wtv`, `custom` и других) файл записывает и удаляет код на сервере, нужны `write` и `execute`; в остальные папки запрос не отправляется. `files.delete` в папке данных удаляет и пустую папку.
- `files.list` — один уровень папки: файлы с размером и вложенные папки; `search` оставляет имена с заданной частью. Нужно право `execute`.
- `server.info` называет папки подключённого сервера: `dataFolders`, `codeFolders`.
- CLI: `wtctl files write`, `files delete`, `files list`. SDK: `writeFile`, `deleteFile`, `listFiles`.
- Страница [docs/compatibility.md](docs/compatibility.md): что отличается между версиями сервера и базами, что не работает ни на одном проверенном сервере, что не проверено.

Исправления:

- Синтаксическая ошибка во всём коде для сервера даёт исход `not_sent`: такой код сервер не выполняет. Раньше подсказка говорила то же, а исход был `indeterminate`.
- `files.delete` по адресу без файла в папке кода отвечает `FILE_NOT_FOUND`.
- `results.export` с путём к папке вместо файла отвечает `INVALID_ARGUMENT`, а не внутренней ошибкой.

Прочее:

- `scripts/generate-native-registry.mjs --check` сверяет `src/native/generated.ts` с кодом протокола; проверка входит в `npm run verify`.

## 0.1.2 — 2026-10-13

Только тексты, код не менялся.

- Гайд по файлам: `native.lds.putUrl` и `native.lds.deleteUrl` работают только в папках данных сервера. Как положить и удалить файл в папке кода и получить список папки кодом на сервере.
- `docs/security.md`: `write` без `execute` — не запрет на код: объекты с кодом, например агенты сервера, сервер запускает сам.
- README: что проверено на файловой базе.

## 0.1.1 — 2026-10-12

- Установка: плагин ставится прямо с GitHub (`claude plugin marketplace add ysamtme/wtctl`, `codex plugin marketplace add ysamtme/wtctl`), пакет `wtctl` опубликован в npm: `npx -y wtctl`, `npm install wtctl`. Установка из папки осталась запасным способом.
- Документация: README и страницы переработаны. Страницы `docs/getting-started.md` больше нет: подключение и проверка описаны в `docs/configuration.md`, первые вызовы — в `docs/cli.md`, разбор неполадок — в `docs/installation.md`. Добавлены `CONTRIBUTING.md` и `SECURITY.md`.
- Тексты для агента (навык, гайд, описания инструментов) обращаются на «ты»; ошибки, подсказки и справка CLI — без обращения.
- Код на сервере принимает параметры: `params` в `hcm_script` и SDK, `--params` и `--params-file` в `wtctl exec`. В коде это готовая переменная `PARAMS`. `hcm_script` выполняет и код из файла: `file`.
- Операция `agents.run` и метод SDK `runAgent`: запустить агента сервера и дождаться конца его кода.
- Поиск: рядом с `unknownFields` ответ подсказывает, что поле документа читает `hcm_object_get`.
- Гайд: ошибка в `XQuery("sql: …")` из кода выглядит как пустая выборка.
- Гайд: когда сервер 2025.2 на MS SQL не удаляет объект (`READ_BACK_MISMATCH` при удалении) и что помогает.

## 0.1.0 — 2026-10-06, первая альфа

Клиент для сервера WebSoft HCM в трёх видах: MCP-сервер (23 инструмента `hcm_*`), CLI `wtctl` и SDK. Работает через те же API, что и админка; на сервер ничего не ставится. В npm и на GitHub эта версия не публиковалась.

- Объекты: поиск в каталогах, чтение, создание, правка с предпросмотром и сверкой после записи, удаление. Типы и поля, включая настраиваемые, читаются с подключённого сервера.
- Код на сервере, запросы XQuery, функции библиотек и фоновые задачи.
- Логи сервера: список, поиск событий, чтение, слежение.
- Файлы сервера: проверка, чтение, запись, загрузка.
- Остальные операции сервера доступны по ID: карта по темам, описание операции, вызов.
- Права подключения: запись и выполнение кода выключены, пока их не разрешили. У записи три исхода: не отправлено, подтверждено, не определён.
- Большие ответы сохраняются локально и читаются частями по `resultId`.
- Гайд по задачам встроен в MCP-сервер (`hcm_guide`) и CLI (`wtctl guide`), тот же текст лежит навыком.
- Установка: папка пакета — плагин для Claude Code, Codex и других приложений. У пакета нет зависимостей, CLI собран в один файл. Подключения лежат в `~/.wtctl/connections.json`.
- Сообщения об ошибках и подсказки — на русском.
- Проверено на WebSoft HCM 2025.1 и 2025.2 с базами MS SQL и PostgreSQL: [что проверено](README.md#совместимость).
