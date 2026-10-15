<!-- Собрано scripts/generate-sdk-reference.mjs из описаний в типах; править описания в src и выполнить npm run generate. -->

# Справочник SDK

Всё, что экспортирует `wtctl`: функции, методы `HcmClient`, ошибки и типы аргументов и ответов. Текст тот же, что в подсказке редактора. Как пользоваться SDK — в [sdk.md](sdk.md).

Методы `HcmClient` возвращают [HcmResult](#hcmresult): в таблицах ответа описано его поле `data`. Поля объекта или строки каталога без своего типа — [HcmData](#hcmdata). Знак `?` после имени поля — поле может отсутствовать.

## Функции

### describeHcmOperation

```ts
describeHcmOperation(id: string): OperationDefinition
```

Описание операции по ID, без подключения к серверу: то же, что client.describe. Неизвестный
ID — HcmError UNKNOWN_OPERATION.

Типы: [OperationDefinition](#operationdefinition).

### getCleanupError

```ts
getCleanupError(error: unknown): HcmError | undefined
```

Ошибка закрытия подключения, если withHcmClient или use не смогли закрыть его после ошибки
операции; иначе undefined. Пойманная ошибка при этом — ошибка операции.

Типы: [HcmError](#hcmerror).

### listHcmOperations

```ts
listHcmOperations(filter?: OperationFilter): OperationPage
```

Операции клиента по странице, без подключения к серверу: то же, что client.listOperations.

Типы: [OperationFilter](#operationfilter), [OperationPage](#operationpage).

### loadConfig

```ts
loadConfig(options?: ConfigOptions): ConnectionConfig
```

Подключение из файла подключений или переменных WTCTL_\*, как у CLI. settings сильнее и того
и другого; settings с baseUrl — подключение целиком, без файла. Бросает HcmError INVALID_CONFIG
при ошибке в настройках.

Типы: [ConfigOptions](#configoptions), [ConnectionConfig](#connectionconfig).

### unwrap

```ts
unwrap<T>(result: HcmResult<T>): T
```

data ответа. Бросает HcmOperationError при ok:false и HcmStoredResultError, если ответ сохранён
локально (meta.truncated).

```ts
unwrap<T = unknown>(result: OperationResult): T
```

data ответа любой операции; бросает так же, как для HcmResult.

Типы: [OperationResult](#operationresult).

### withHcmClient

```ts
withHcmClient<T>(config: ConnectionConfig, action: (client: HcmClient) => Promise<T>): Promise<T>
```

Создаёт клиент по подключению, вызывает action и закрывает подключение — и после успеха, и после
ошибки. Возвращает то, что вернул action. Права — те, что заданы в подключении.

Типы: [ConnectionConfig](#connectionconfig), [HcmClient](#hcmclient).

## Клиент

### HcmClient

Клиент сервера по одному подключению. Каждый метод — операция клиента: ответ, права и исходы
записи те же, что у call, CLI и MCP-сервера. Методы не бросают при отказе сервера: ответ
приходит с ok:false, data достаёт unwrap. Подключение закрывает close или сам withHcmClient.

```ts
new HcmClient(config: ConnectionConfig): HcmClient
```

Клиент по подключению из loadConfig; сессия на сервере открывается при первом вызове.

Типы: [ConnectionConfig](#connectionconfig).

#### client.listOperations

```ts
client.listOperations(filter?: OperationFilter): OperationPage
```

Операции клиента, по странице: поиск по словам, теме, группе, эффекту. Сервер не вызывается.

Типы: [OperationFilter](#operationfilter), [OperationPage](#operationpage).

#### client.describe

```ts
client.describe(id: string): OperationDefinition
```

Описание операции по ID со схемой аргументов; неизвестный ID — HcmError UNKNOWN_OPERATION.

Типы: [OperationDefinition](#operationdefinition).

#### client.call

```ts
client.call<T = unknown>(id: string, args?: HcmData): Promise<HcmResult<T>>
```

Любая операция по ID: call("native.lds.loadDoc", {url}). Аргументы — как в describe(id).
Тип data задаёт параметр T; клиент его не проверяет.

#### client.getMany

```ts
client.getMany<T extends object = HcmData>(input: GetManyInput): Promise<HcmResult<GetManyData<T>>>
```

Несколько объектов за один вызов, до 100; у непрочитанного объекта в его элементе стоит error.

Типы: [GetManyInput](#getmanyinput), [GetManyData](#getmanydata).

#### client.status

```ts
client.status(): Promise<HcmResult<StatusData>>
```

Связь с сервером: версия сервера и права подключения. Ничего не меняет.

Типы: [StatusData](#statusdata).

#### client.check

```ts
client.check(): Promise<HcmResult<CheckData>>
```

Проверка подключения по шагам: вход, версия, запрос, документ, схема, библиотеки, логи, портал;
при праве execute — ещё код на сервере. Запись не проверяется.

Типы: [CheckData](#checkdata).

#### client.serverInfo

```ts
client.serverInfo(input?: ServerInfoInput): Promise<HcmResult<ServerInfoData>>
```

Сведения о сервере, которые он отдаёт админке при запуске: версия, ОС, база, папки.

Типы: [ServerInfoInput](#serverinfoinput), [ServerInfoData](#serverinfodata).

#### client.fileExists

```ts
client.fileExists(input: FileExistsInput): Promise<HcmResult<FileExistsData>>
```

Есть ли файл или папка по адресу x-local://…; о содержимом и правах ответ ничего не говорит.

Типы: [FileExistsInput](#fileexistsinput), [FileExistsData](#fileexistsdata).

#### client.readFile

```ts
client.readFile(input: FileSaveInput): Promise<HcmResult<FileSaveData>>
```

Сохраняет файл сервера на этот компьютер байт в байт, любого размера.

Типы: [FileSaveInput](#filesaveinput), [FileSaveData](#filesavedata).

```ts
client.readFile(input: FileReadInput): Promise<HcmResult<FileReadData>>
```

Файл по адресу сервера: text, если это текст в UTF-8, иначе base64.

Типы: [FileReadInput](#filereadinput), [FileReadData](#filereaddata).

#### client.listFiles

```ts
client.listFiles(input: FileListInput): Promise<HcmResult<FileListData>>
```

Один уровень папки сервера: файлы с размером и вложенные папки. Нужно право execute.

Типы: [FileListInput](#filelistinput), [FileListData](#filelistdata).

#### client.writeFile

```ts
client.writeFile(input: FileWriteInput): Promise<HcmResult<FileWriteData>>
```

Записывает файл по адресу x-local://… целиком из text, base64 или файла на диске (file) и сверяет
записанное; папки сервер создаёт сам. Нужно право write, в папку кода (wt, wtv, custom…) — ещё
execute.

Типы: [FileWriteInput](#filewriteinput), [FileWriteData](#filewritedata).

#### client.deleteFile

```ts
client.deleteFile(input: FileDeleteInput): Promise<HcmResult<FileDeleteData>>
```

Удаляет файл по адресу x-local://…. Нужно право write, в папке кода — ещё execute.

Типы: [FileDeleteInput](#filedeleteinput), [FileDeleteData](#filedeletedata).

#### client.query

```ts
client.query<T = HcmData>(input: QueryInput): Promise<HcmResult<QueryData<T>>>
```

Одна страница поиска: в каталоге по условиям или запросом XQuery (ему нужно право execute).
Дальше — startPosition: nextStartPosition; все страницы сразу перебирает queryRows.

Типы: [QueryInput](#queryinput), [QueryData](#querydata).

#### client.queryRows

```ts
client.queryRows<T = HcmData>(input: QueryInput): AsyncGenerator<T, void, undefined>
```

Строки каталога или запроса XQuery со всех страниц по порядку; страницы листает сам.
Аргументы те же, что у query. Неполная страница (incomplete) — ошибка QUERY_INCOMPLETE
после её строк, большой ответ — HcmStoredResultError, как в unwrap.

Типы: [QueryInput](#queryinput).

#### client.get

```ts
client.get<T extends object = HcmData>(input: ObjectTarget & GetOptions): Promise<HcmResult<ObjectData<T>>>
```

Документ объекта по id или url; fields — только эти поля верхнего уровня.

Типы: [ObjectTarget](#objecttarget), [GetOptions](#getoptions), [ObjectData](#objectdata).

#### client.create

```ts
client.create(input: CreateInput<object>): Promise<HcmResult<CreatedObjectData>>
```

Создаёт объект; ID выдаёт сервер, после записи объект перечитывается и сверяется. Нужно право
write. Обработчики, которые админка выполняет при создании, не запускаются.

Типы: [CreateInput](#createinput), [CreatedObjectData](#createdobjectdata).

#### client.patch

```ts
client.patch(input: ObjectTarget & PatchOptions): Promise<HcmResult<PatchedObjectData | PatchPreviewData>>
```

Меняет поля объекта, остальное содержимое документа сохраняется. Нужно право write.
С preview:true или правкой без изменений ничего не записывает: ответ — PatchPreviewData.

Типы: [ObjectTarget](#objecttarget), [PatchOptions](#patchoptions), [PatchedObjectData](#patchedobjectdata), [PatchPreviewData](#patchpreviewdata).

#### client.delete

```ts
client.delete(input: ObjectTarget & DeleteOptions): Promise<HcmResult<DeletedObjectData>>
```

Удаляет документ объекта безвозвратно; нужны permanent:true и право write.

Типы: [ObjectTarget](#objecttarget), [DeleteOptions](#deleteoptions), [DeletedObjectData](#deletedobjectdata).

#### client.schema

```ts
client.schema(input: SchemaInput): Promise<HcmResult<SchemaResult>>
```

Поля типа объекта по странице: свои, унаследованные, настраиваемые и поля каталога.

Типы: [SchemaInput](#schemainput), [SchemaResult](#schemaresult).

#### client.types

```ts
client.types(input?: SchemaTypesInput): Promise<HcmResult<SchemaTypesResult>>
```

Типы объектов сервера: тип, каталог, заголовок, число настраиваемых полей.

Типы: [SchemaTypesInput](#schematypesinput), [SchemaTypesResult](#schematypesresult).

#### client.rpc

```ts
client.rpc<T = unknown>(input: RpcInput): Promise<HcmResult<T>>
```

Вызывает функцию библиотеки сервера. Нужно право execute; функция может менять данные.

Типы: [RpcInput](#rpcinput).

#### client.listRpc

```ts
client.listRpc(input?: RpcCatalogFilter): Promise<HcmResult<RpcCatalogPage>>
```

Функции библиотек сервера по странице: имя и параметры. Сами функции не вызываются.

Типы: [RpcCatalogFilter](#rpccatalogfilter), [RpcCatalogPage](#rpccatalogpage).

#### client.describeRpc

```ts
client.describeRpc(targetId: string, options?: RpcDescribeOptions): Promise<HcmResult<RpcTargetDescription>>
```

Параметры функции «библиотека.функция», с source:true — и её код. Функция не вызывается.

Типы: [RpcDescribeOptions](#rpcdescribeoptions), [RpcTargetDescription](#rpctargetdescription).

#### client.execute

```ts
client.execute<T = unknown>(code: string | { code: string; params?: object; }, params?: object): Promise<HcmResult<ScriptData<T>>>
```

Выполняет код SP-XML Script на сервере; нужно право execute, отката нет. Код присваивает
массив переменной RESULT, params доступен в коде как PARAMS. Код и params можно передать
и одним объектом {code, params}.

| Поле | Тип | Описание |
| --- | --- | --- |
| `code.code` | `string` | Код SP-XML Script. |
| `code.params?` | `object` | Параметры: в коде переменная PARAMS. |

Типы: [ScriptData](#scriptdata).

#### client.runAgent

```ts
client.runAgent(input: RunAgentInput): Promise<HcmResult<AgentRunData>>
```

Запускает агента сервера и ждёт конца его кода; нужно право execute. Ошибки кода агента —
только в логе xhttp между startedAt и finishedAt.

Типы: [RunAgentInput](#runagentinput), [AgentRunData](#agentrundata).

#### client.batch

```ts
client.batch(input: BatchInput): Promise<HcmResult<BatchData>>
```

Несколько операций одним вызовом; права проверяются для каждого шага. Не транзакция:
выполненные шаги не откатываются.

Типы: [BatchInput](#batchinput), [BatchData](#batchdata).

#### client.readResult

```ts
client.readResult<T = unknown>(input: ResultReadInput): Promise<HcmResult<ResultPage<T>>>
```

Страница сохранённого результата: список — по элементам, текст — по символам.

Типы: [ResultReadInput](#resultreadinput), [ResultPage](#resultpage).

#### client.exportResult

```ts
client.exportResult(input: ResultExportInput): Promise<HcmResult<ResultExportData>>
```

Записывает сохранённый результат целиком в файл на этом компьютере.

Типы: [ResultExportInput](#resultexportinput), [ResultExportData](#resultexportdata).

#### client.uploadFile

```ts
client.uploadFile(input: UploadFileInput): Promise<HcmResult<UploadedFileData>>
```

Загружает файл до 8 МБ так же, как админка; нужно право write.

Типы: [UploadFileInput](#uploadfileinput), [UploadedFileData](#uploadedfiledata).

#### client.uploadChunk

```ts
client.uploadChunk(input: UploadChunkInput): Promise<HcmResult<UploadedChunkData>>
```

Отправляет одну часть загрузки по частям; последняя часть собирает файл. Нужно право write.
Перед последней частью загруженное проверить чтением; после ошибки на последней части не повторять.

Типы: [UploadChunkInput](#uploadchunkinput), [UploadedChunkData](#uploadedchunkdata).

#### client.clearUploadChunks

```ts
client.clearUploadChunks(input: ClearUploadChunksInput): Promise<HcmResult<ClearedUploadChunksData>>
```

Просит сервер удалить части загрузки fileId; нужно право write. Удаление ответ не подтверждает.

Типы: [ClearUploadChunksInput](#clearuploadchunksinput), [ClearedUploadChunksData](#cleareduploadchunksdata).

#### client.heartbeat

```ts
client.heartbeat(input?: WebSocketHeartbeatInput): Promise<HcmResult<WebSocketHeartbeatData>>
```

Проверка WebSocket сервера: одно сообщение $hbt и ожидание $ok.

Типы: [WebSocketHeartbeatInput](#websocketheartbeatinput), [WebSocketHeartbeatData](#websocketheartbeatdata).

#### client.listLogs

```ts
client.listLogs(input?: LogListInput): Promise<HcmResult<LogFiles>>
```

Логи сервера, сначала свежие.

Типы: [LogListInput](#loglistinput), [LogFiles](#logfiles).

#### client.readLog

```ts
client.readLog(input: LogReadInput): Promise<HcmResult<LogText>>
```

Текст лога: конец файла или весь файл.

Типы: [LogReadInput](#logreadinput), [LogText](#logtext).

#### client.searchLogs

```ts
client.searchLogs(input: LogSearchInput): Promise<HcmResult<LogMatches>>
```

События лога по тексту, уровню или потоку; многострочное событие приходит целиком.

Типы: [LogSearchInput](#logsearchinput), [LogMatches](#logmatches).

#### client.followLog

```ts
client.followLog(input: LogFollowInput): Promise<HcmResult<LogNews>>
```

Новые события лога с прошлого вызова: cursor из прошлого ответа.

Типы: [LogFollowInput](#logfollowinput), [LogNews](#lognews).

#### client.close

```ts
client.close(): Promise<void>
```

Закрывает сессию на сервере. После close методы отвечают ошибкой RUNTIME_CLOSED.

#### client.use

```ts
client.use<T>(action: (client: HcmClient) => Promise<T>): Promise<T>
```

Вызывает action с этим клиентом и закрывает подключение ровно один раз — и после успеха,
и после ошибки. Как withHcmClient, но для уже созданного клиента.

Типы: [HcmClient](#hcmclient).

## Ошибки

### HcmCleanupError

Операция в withHcmClient или use выполнена, но подключение не закрылось. Код CLEANUP_FAILED.
Результат операции — в value; повторять её не нужно.

```ts
class HcmCleanupError<T = unknown>
```

Наследует [HcmError](#hcmerror).

| Поле | Тип | Описание |
| --- | --- | --- |
| `value` | `T` | Что вернула функция, переданная в withHcmClient или use. |

### HcmError

Ошибка клиента: её бросает loadConfig, от неё наследуют остальные ошибки SDK. Тело запроса
и учётные данные в неё не попадают.

| Поле | Тип | Описание |
| --- | --- | --- |
| `code` | `string` | Код ошибки: INVALID_CONFIG, WRITE_DISABLED… Программа сравнивает его, а не текст. |
| `hint?` | `string` | Что сделать дальше. |
| `details?` | `Readonly<Record<string, unknown>>` | Подробности: путь к неверному аргументу, ID, похожие имена. |
| `mutationOutcome?` | `MutationOutcome` | Исход записи; только у операций записи и выполнения кода. |

#### error.toJSON

```ts
error.toJSON(): OperationError
```

Ошибка в виде error ответа.

Типы: [OperationError](#operationerror).

### HcmOperationError

Ошибка, которую бросает unwrap при ok:false: code, message, hint, details и mutationOutcome
взяты из error ответа.

Наследует [HcmError](#hcmerror).

| Поле | Тип | Описание |
| --- | --- | --- |
| `result` | `OperationResult` | Ответ целиком, с частичными данными. В JSON ошибки не попадает. |
| `cleanupError?` | `HcmError` | Ошибка закрытия подключения, если и оно не удалось; её же возвращает getCleanupError. |

#### error.toJSON

```ts
error.toJSON(): OperationError
```

error ответа, как его вернула операция.

Типы: [OperationError](#operationerror).

### HcmStoredResultError

Ответ больше outputLimitBytes и сохранён локально; unwrap бросает эту ошибку, чтобы начало данных
нельзя было принять за все данные. Код RESULT_STORED.

Наследует [HcmOperationError](#hcmoperationerror).

| Поле | Тип | Описание |
| --- | --- | --- |
| `resultId` | `string` | ID сохранённого результата: его читают readResult и exportResult. |

## Типы

### AgentRunData

Ответ runAgent.

| Поле | Тип | Описание |
| --- | --- | --- |
| `started` | `boolean` | false: сервер не запустил агента; причина — в логе `agent`. |
| `startedAt` | `string` | Местное время сервера перед запуском: строки агента в логах лежат после него. |
| `finishedAt` | `string` | Местное время сервера после конца кода агента. |
| `hint` | `string` | В каком логе искать строки и ошибки агента. |

### BatchData

Ответ batch.

| Поле | Тип | Описание |
| --- | --- | --- |
| `results` | `OperationResult[]` | Ответы выполненных шагов по порядку. |
| `completed` | `number` | Сколько шагов выполнено. |
| `requested` | `number` | Сколько шагов запрошено. |
| `atomic` | `false` | Всегда false: это не транзакция, выполненные шаги не откатываются. |
| `ok` | `boolean` | Все шаги выполнены без ошибок. |

### BatchInput

Аргументы batch.

| Поле | Тип | Описание |
| --- | --- | --- |
| `steps` | `readonly BatchStep[]` | Шаги по порядку. |
| `stopOnError?` | `boolean` | false — продолжать после сбоя шага; по умолчанию первый сбой останавливает остальные. |

### BatchStep

Шаг batch: операция и её аргументы.

| Поле | Тип | Описание |
| --- | --- | --- |
| `id` | `string` | ID операции шага. |
| `args?` | `HcmData` | Аргументы операции; значение из прошлого шага — {$ref:'имя.data.items.0.id'}. |
| `as?` | `string` | Имя шага для ссылок из следующих шагов: латинские буквы, цифры и _, первой не цифра. |

### CheckData

Ответ check: шаги проверки и их итог.

| Поле | Тип | Описание |
| --- | --- | --- |
| `version?` | `string` | Версия сервера, если шаг version прошёл. |
| `language?` | `string` | Язык интерфейса сервера: ru, en… |
| `permissions` | `ConnectionConfig["permissions"]` | Права подключения. |
| `checks` | `{…}[]` | Шаги проверки по порядку. |
| `checks[].name` | `string` | Шаг: login, version, query, document, schema, titles, libraries, logs, portal, execute. |
| `checks[].result` | `"ok" \| "failed" \| "skipped"` | ok — прошёл, failed — не прошёл, skipped — не выполнялся. |
| `checks[].reason?` | `string` | Почему шаг не прошёл или пропущен. |
| `summary` | `{…}` | Сколько шагов в каждом исходе. |
| `summary.ok` | `number` | Прошли. |
| `summary.failed` | `number` | Не прошли. |
| `summary.skipped` | `number` | Пропущены. |

### ClearedUploadChunksData

Сервер принял запрос. Ошибки удаления он не сообщает, поэтому удаление не проверено.

| Поле | Тип | Описание |
| --- | --- | --- |
| `acknowledged` | `true` | Запрос принят. |
| `fileId` | `string` | ID загрузки. |
| `chunksTotal` | `number` | Сколько частей запрошено удалить. |
| `absenceVerified` | `false` | Всегда false: что части удалены, по ответу сервера не проверить. |

### ClearUploadChunksInput

Аргументы clearUploadChunks.

| Поле | Тип | Описание |
| --- | --- | --- |
| `fileId` | `string` | ID загрузки. |
| `chunksTotal` | `number` | Сколько частей удалить: номера от 0 до chunksTotal-1. |

### ConfigOptions

Аргументы loadConfig: откуда взять подключение.

| Поле | Тип | Описание |
| --- | --- | --- |
| `configPath?` | `string` | Файл подключений; по умолчанию WTCTL_CONFIG, иначе ~/.wtctl/connections.json. |
| `connection?` | `string` | Имя подключения в файле; по умолчанию WTCTL_CONNECTION, иначе defaultConnection файла. |
| `password?` | `string` | Пароль вместо пароля из файла и переменных. |
| `settings?` | `ConnectionSettings` | Настройки кодом, сильнее переменных и файла; с baseUrl — подключение без файла и переменных. |

### ConnectionConfig

Подключение, которое возвращает loadConfig: сервер, учётная запись, права и локальные пределы.

| Поле | Тип | Описание |
| --- | --- | --- |
| `name` | `string` | Имя подключения; оно же в meta.connection ответов. |
| `outputLimitBytes` | `number` | Предел ответа в байтах: больший ответ сохраняется локально; loadConfig ставит 24 КБ, не больше 1 МБ. |
| `runtimeDir` | `string` | Папка сохранённых результатов и журнала записей. |
| `permissions` | `{…}` | Права подключения. Чтение разрешено всегда. |
| `permissions.write` | `boolean` | Право на запись: создание, правку и удаление объектов и файлов. |
| `permissions.execute` | `boolean` | Право на выполнение кода на сервере. |
| `resultsMaxBytes?` | `number` | Предел сохранённых результатов подключения в байтах, приблизительный; 0 — без предела, по умолчанию 1 ГБ. |
| `resultsMaxAgeDays?` | `number` | Сколько дней хранятся сохранённые результаты; 0 — без срока, по умолчанию 7. |
| `journalMaxBytes?` | `number` | Предел журнала записей mutations.jsonl в байтах; 0 — без предела, по умолчанию 10 МБ. |
| `logBusyMs?` | `number` | Сколько сервер держит лог нечитаемым после записи в него; по умолчанию 5500 мс. |
| `baseUrl` | `string` | Адрес сервера: http://сервер:порт. |
| `username?` | `string` | Логин учётной записи. В ответы и ошибки не попадает. |
| `password?` | `string` | Пароль учётной записи. В ответы и ошибки не попадает. |
| `timeoutMs` | `number` | Предел времени одного запроса к серверу, мс; loadConfig ставит 30000. |
| `maxResponseBytes` | `number` | Предел тела ответа сервера в байтах; loadConfig ставит 32 МБ. |
| `fetch?` | `typeof globalThis.fetch` | Своя функция fetch вместо глобальной: прокси, запись запросов. |

### ConnectionSettings

Поля подключения кодом: loadConfig({ settings }). Сильнее переменных и файла; с baseUrl —
отдельное подключение без файла и переменных, права по умолчанию выключены.

| Поле | Тип | Описание |
| --- | --- | --- |
| `baseUrl?` | `string` | Адрес сервера: http://сервер:порт. |
| `username?` | `string` | Логин учётной записи. В ответы и ошибки не попадает. |
| `password?` | `string` | Пароль учётной записи. В ответы и ошибки не попадает. |
| `timeoutMs?` | `number` | Предел времени одного запроса к серверу, мс; loadConfig ставит 30000. |
| `maxResponseBytes?` | `number` | Предел тела ответа сервера в байтах; loadConfig ставит 32 МБ. |
| `outputLimitBytes?` | `number` | Предел ответа в байтах: больший ответ сохраняется локально; loadConfig ставит 24 КБ, не больше 1 МБ. |
| `runtimeDir?` | `string` | Папка сохранённых результатов и журнала записей. |
| `resultsMaxBytes?` | `number` | Предел сохранённых результатов подключения в байтах, приблизительный; 0 — без предела, по умолчанию 1 ГБ. |
| `resultsMaxAgeDays?` | `number` | Сколько дней хранятся сохранённые результаты; 0 — без срока, по умолчанию 7. |
| `journalMaxBytes?` | `number` | Предел журнала записей mutations.jsonl в байтах; 0 — без предела, по умолчанию 10 МБ. |
| `permissions?` | `Partial<ConnectionConfig["permissions"]>` | Права отдельного подключения (с baseUrl); по умолчанию выключены. |

### CreatedObjectData

Запись возвращает сводку, а не копию документа; нужны поля — прочитать объект.

| Поле | Тип | Описание |
| --- | --- | --- |
| `id` | `string` | ID нового объекта, 0x…. |
| `type` | `string` | Тип объекта. |
| `url` | `string` | Адрес документа. |
| `fingerprint` | `string` | Отпечаток записанного документа: expectedFingerprint для правки. |
| `mutationId` | `string` | ID записи в журнале записей mutations.jsonl. |
| `mutationOutcome` | `"confirmed"` | Исход записи: подтверждена. |

### CreateInput

Аргументы create.

```ts
CreateInput<T extends object = HcmData>
```

| Поле | Тип | Описание |
| --- | --- | --- |
| `type` | `string` | Тип объекта: collaborator, group… |
| `data` | `T` | Поля нового объекта; id выдаёт сервер. |
| `dbName?` | `string` | База сервера для объекта; по умолчанию wt_data. |
| `formUrl?` | `string` | Адрес формы типа; по умолчанию x-local://wtv/wtv_&lt;type>.xmd. |

### DeletedObjectData

Ответ delete.

| Поле | Тип | Описание |
| --- | --- | --- |
| `id?` | `string` | ID удалённого объекта. |
| `mutationId` | `string` | ID записи в журнале записей mutations.jsonl. |
| `mutationOutcome` | `"confirmed"` | Исход записи: подтверждена. |
| `verification` | `"server" \| "catalog"` | Чем проверено удаление: server — ответом сервера, catalog — объекта больше нет в каталоге. |
| `catalog?` | `string` | Каталог, по которому проверено удаление. |

### DeleteOptions

Аргументы delete помимо объекта.

| Поле | Тип | Описание |
| --- | --- | --- |
| `permanent` | `true` | Обязателен: удаление безвозвратное, корзины нет. |
| `catalog?` | `string` | Каталог объекта: проверить, что объект был в нём и после удаления исчез. |

### FileDeleteData

Ответ deleteFile.

| Поле | Тип | Описание |
| --- | --- | --- |
| `deleted` | `true` | Файл удалён. |
| `mutationOutcome` | `"confirmed"` | Исход записи: подтверждена. |

### FileDeleteInput

Аргументы deleteFile.

| Поле | Тип | Описание |
| --- | --- | --- |
| `url` | `string` | Адрес файла на сервере: x-local://…. |

### FileExistsData

Ответ fileExists.

| Поле | Тип | Описание |
| --- | --- | --- |
| `exists` | `boolean` | Существует файл, папка или адрес хранилища из настроек; содержимое и доступ не проверяются. |

### FileExistsInput

Аргументы fileExists.

| Поле | Тип | Описание |
| --- | --- | --- |
| `url` | `string` | Адрес на сервере: x-local://…, до 256 знаков. |

### FileListData

Ответ listFiles.

| Поле | Тип | Описание |
| --- | --- | --- |
| `items` | `readonly ({…} \| {…} )[]` | По имени; у файла указан размер в байтах, у папки folder:true. |
| `items[].name` | `string` | Имя файла. |
| `items[].bytes` | `number` | Размер файла в байтах. |
| `items[].name` | `string` | Имя папки. |
| `items[].folder` | `true` | Это папка. |
| `total` | `number` | Сколько элементов в списке. |

### FileListInput

Аргументы listFiles.

| Поле | Тип | Описание |
| --- | --- | --- |
| `url` | `string` | Папка на сервере: x-local://папка или x-local://папка/путь. |
| `search?` | `string` | Оставить имена с этой частью; регистр не важен. |

### FileReadData

Ответ readFile: ровно одно из text и base64.

| Поле | Тип | Описание |
| --- | --- | --- |
| `text?` | `string` | Содержимое, если это текст UTF-8; метка порядка байтов в начале убирается. |
| `base64?` | `string` | Содержимое, если это не текст или запрошен base64. |
| `bytes` | `number` | Размер файла в байтах. |

### FileReadInput

Аргументы readFile без file: файл приходит в ответе.

| Поле | Тип | Описание |
| --- | --- | --- |
| `url` | `string` | Адрес файла на сервере: x-local://…. |
| `encoding?` | `"base64"` | "base64" отдаёт байты, даже если файл текстовый. |

### FileSaveData

Ответ readFile с file.

| Поле | Тип | Описание |
| --- | --- | --- |
| `bytes` | `number` | Размер файла в байтах. |
| `file` | `string` | Полный путь к сохранённому файлу. |

### FileSaveInput

Аргументы readFile с file: файл сохраняется на этот компьютер.

| Поле | Тип | Описание |
| --- | --- | --- |
| `url` | `string` | Адрес файла на сервере: x-local://…. |
| `file` | `string` | Полный путь, куда сохранить файл байт в байт; размер не ограничен. Папка должна быть. |
| `overwrite?` | `boolean` | Заменить файл, если он уже есть; иначе FILE_EXISTS. |

### FileWriteData

Ответ writeFile.

| Поле | Тип | Описание |
| --- | --- | --- |
| `bytes` | `number` | Сколько байт записано. |
| `mutationOutcome` | `"confirmed"` | Исход записи: файл на сервере прочитан назад и совпал с отправленным. |

### FileWriteInput

Ровно одно из text, base64 и file.

| Поле | Тип | Описание |
| --- | --- | --- |
| `url` | `string` | Адрес файла на сервере: x-local://…; файл заменяется целиком. |
| `text?` | `string` | Текст; пишется в UTF-8. |
| `base64?` | `string` | Двоичные данные в base64. |
| `file?` | `string` | Полный путь к файлу на этом компьютере: он читается частями, память не растёт с размером. |

### FilterCondition

Условие на поле каталога; несколько операторов соединяются через «и».

| Поле | Тип | Описание |
| --- | --- | --- |
| `eq?` | `FilterValue` | Равно. |
| `ne?` | `FilterValue` | Не равно. |
| `gt?` | `FilterValue` | Больше. |
| `gte?` | `FilterValue` | Больше или равно. |
| `lt?` | `FilterValue` | Меньше. |
| `lte?` | `FilterValue` | Меньше или равно. |
| `contains?` | `FilterValue` | Содержит строку. |
| `in?` | `FilterValue[]` | Одно из значений списка, от 1 до 100. |

### FilterValue

Значение в условии поиска.

```ts
type FilterValue = string | number | boolean | null
```

### GetManyData

Ответ getMany.

```ts
GetManyData<T extends object = HcmData>
```

| Поле | Тип | Описание |
| --- | --- | --- |
| `items` | `(ObjectData<T> \| {…} )[]` | Объекты в порядке ids; непрочитанный — {id, error}. |
| `items[].id` | `string` | ID непрочитанного объекта. |
| `items[].error` | `{…}` | Почему объект не прочитан. |
| `items[].error.code` | `string` | Код ошибки: NOT_FOUND, TYPE_MISMATCH… |
| `items[].error.message` | `string` | Что случилось. |
| `total` | `number` | Сколько объектов запрошено. |
| `failed?` | `number` | Сколько объектов не прочитано. |
| `hint?` | `string` | Пояснение к непрочитанным. |

### GetManyInput

Аргументы getMany.

| Поле | Тип | Описание |
| --- | --- | --- |
| `ids` | `readonly string[]` | ID объектов, до 100. |
| `type?` | `string` | Ожидаемый тип объектов. |
| `fields?` | `readonly string[]` | Поля верхнего уровня; без fields — документы целиком. |

### GetOptions

Что прочитать у объекта.

| Поле | Тип | Описание |
| --- | --- | --- |
| `fields?` | `readonly string[]` | Поля верхнего уровня; без fields приходит весь документ. |

### HcmData

Поля объекта или строки каталога: имя поля — значение.

```ts
type HcmData = Record<string, unknown>
```

### HcmResult

Ответ метода. Три вида: данные целиком; ответ сохранён локально (meta.truncated, в data
только начало); ошибка (ok:false). unwrap отдаёт data только в первом случае.

```ts
HcmResult<T = unknown>
```

Вариант 1:

| Поле | Тип | Описание |
| --- | --- | --- |
| `ok` | `true` | Операция выполнена. |
| `data` | `T` | Данные ответа целиком. |
| `meta` | `ResultMeta & {…}` | Сведения о вызове. |
| `meta.truncated?` | `false` | Ответ целиком. |

Вариант 2:

| Поле | Тип | Описание |
| --- | --- | --- |
| `ok` | `true` | Операция выполнена, но ответ сохранён локально. |
| `data` | `StoredResultData` | Начало данных и ID сохранённого результата. |
| `meta` | `ResultMeta & {…}` | Сведения о вызове; truncated:true и resultId. |
| `meta.truncated` | `true` | Ответ сохранён локально. |
| `meta.resultId` | `string` | ID сохранённого результата. |

Вариант 3:

| Поле | Тип | Описание |
| --- | --- | --- |
| `ok` | `false` | Операция не выполнена. |
| `data?` | `T \| StoredResultData` | Частичные данные, если операция успела их получить. |
| `error` | `OperationError` | Код, текст и подсказка ошибки. |
| `meta` | `ResultMeta` | Сведения о вызове. |

### JsonSchema

Схема JSON аргументов операции.

```ts
type JsonSchema = Readonly<Record<string, unknown>>
```

### LogEntry

Событие лога: строка с временем и продолжающие её строки.

| Поле | Тип | Описание |
| --- | --- | --- |
| `sequence` | `number` | Номер события в прочитанной части файла, с 1. |
| `time?` | `string` | Местное время сервера. |
| `context?` | `string` | Поток: текст в квадратных скобках в начале сообщения. |
| `level` | `LogLevel` | Уровень события. |
| `text` | `string` | Сообщение с продолжающими строками; время и контекст — отдельные поля. |
| `partialBeginning?` | `true` | Начало события не попало в прочитанную часть файла. |

### LogFiles

Страница логов: ответ listLogs.

| Поле | Тип | Описание |
| --- | --- | --- |
| `files` | `readonly LogFileSummary[]` | Файлы страницы, сначала свежие. |
| `total` | `number` | Сколько файлов подходит всего. |
| `nextOffset?` | `number` | offset следующей страницы; нет — страница последняя. |

### LogFileSummary

Файл лога.

| Поле | Тип | Описание |
| --- | --- | --- |
| `name` | `string` | Имя файла: его принимают readLog, searchLogs и followLog. |
| `type` | `string` | Имя лога без даты: xhttp, agent… |
| `sizeBytes` | `number` | Размер файла в байтах. |
| `date?` | `string` | Календарная дата файла по времени сервера, YYYY-MM-DD. |

### LogFollowInput

Аргументы followLog.

| Поле | Тип | Описание |
| --- | --- | --- |
| `cursor?` | `string` | cursor прошлого ответа; без него — события в прочитанной части файла. |
| `file` | `string` | Имя файла лога из listLogs. |
| `tailBytes?` | `number` | Сколько байт с конца файла читать; по умолчанию 512 КБ. Вместе с full не задаётся. |
| `full?` | `boolean` | Читать весь файл, а не конец. |

### LogLevel

Уровень события; определяется по словам в тексте.

```ts
type LogLevel = "normal" | "debug" | "info" | "warning" | "error" | "critical"
```

### LogListInput

Аргументы listLogs.

| Поле | Тип | Описание |
| --- | --- | --- |
| `type?` | `string` | Имя лога без даты: xhttp, agent… |
| `nameContains?` | `string` | Часть имени файла; регистр не важен. |
| `startDate?` | `string` | Файлы не раньше этой даты сервера, ГГГГ-ММ-ДД. |
| `endDate?` | `string` | Файлы не позже этой даты сервера, ГГГГ-ММ-ДД. |
| `offset?` | `number` | Сколько файлов пропустить: nextOffset прошлой страницы. |
| `limit?` | `number` | Файлов на странице, 1–1000; по умолчанию 30. |

### LogMatches

Страница событий: ответ searchLogs.

| Поле | Тип | Описание |
| --- | --- | --- |
| `file` | `string` | Имя файла. |
| `events` | `readonly LogEntry[]` | Подходящие события страницы. |
| `totalEvents` | `number` | Сколько событий в прочитанной части файла. |
| `matches` | `number` | Сколько событий подходит. |
| `fingerprint` | `string` | Отпечаток прочитанного текста: expectedFingerprint следующей страницы. |
| `tailOnly` | `boolean` | Искался только конец файла: totalEvents и matches считают эту часть. |
| `nextOffset?` | `number` | offset следующей страницы; нет — страница последняя. |
| `cutBySize?` | `true` | В странице меньше событий, чем просили: остальные не влезли в ответ. Продолжает nextOffset. |

### LogNews

Ответ followLog.

| Поле | Тип | Описание |
| --- | --- | --- |
| `file` | `string` | Имя файла. |
| `events` | `readonly LogEntry[]` | Новые события. Последнее событие прошлого вызова может повториться. |
| `omitted?` | `number` | Новые события, которые не уместились; они старше возвращённых. Читает logs.search. |
| `cursor` | `string` | cursor следующего вызова; после ошибки чтения передать прежний. |
| `changed` | `boolean` | Файл изменился с прошлого вызова. |
| `gapPossible` | `boolean` | Часть событий могла быть пропущена; причина — в resetReason. |
| `windowTruncated` | `boolean` | Прочитан только конец файла. |
| `resetReason?` | `LogResetReason` | Почему чтение началось заново. |

### LogReadInput

Аргументы readLog: файл и сколько читать.

| Поле | Тип | Описание |
| --- | --- | --- |
| `file` | `string` | Имя файла лога из listLogs. |
| `tailBytes?` | `number` | Сколько байт с конца файла читать; по умолчанию 512 КБ. Вместе с full не задаётся. |
| `full?` | `boolean` | Читать весь файл, а не конец. |

### LogResetReason

Почему followLog начал заново: overlap-not-found — прошлых событий в файле не найдено,
file-size-decreased — файл стал короче, ambiguous-overlap — прошлое событие встречается дважды.

```ts
type LogResetReason = "overlap-not-found" | "file-size-decreased" | "ambiguous-overlap"
```

### LogSearchInput

Аргументы searchLogs.

| Поле | Тип | Описание |
| --- | --- | --- |
| `text?` | `string` | Часть текста события; регистр не важен. |
| `level?` | `LogLevel` | Только события этого уровня. |
| `context?` | `string` | Часть потока события — текста в квадратных скобках в начале сообщения. |
| `offset?` | `number` | Сколько подходящих событий пропустить: nextOffset прошлой страницы. |
| `limit?` | `number` | Событий на странице, 1–1000; по умолчанию 100. |
| `newestFirst?` | `boolean` | Сначала новейшие совпадения; offset тогда считается с конца файла. |
| `expectedFingerprint?` | `string` | fingerprint прошлой страницы: если файл изменился, ошибка LOG_CHANGED. |
| `file` | `string` | Имя файла лога из listLogs. |
| `tailBytes?` | `number` | Сколько байт с конца файла читать; по умолчанию 512 КБ. Вместе с full не задаётся. |
| `full?` | `boolean` | Читать весь файл, а не конец. |

### LogText

Ответ readLog.

| Поле | Тип | Описание |
| --- | --- | --- |
| `file` | `string` | Имя файла. |
| `text` | `string` | Текст лога. |
| `sizeBytes` | `number` | Размер файла в байтах. |
| `tailOnly` | `boolean` | Текст — только конец длинного файла. Обрезка сохранённого ответа — это meta.truncated. |
| `fingerprint` | `string` | Отпечаток прочитанного текста. |

### MutationOutcome

Исход записи: not_sent — запрос не ушёл на сервер, confirmed — запись подтверждена,
indeterminate — запрос мог дойти: прочитать объект, прежде чем повторять.

```ts
type MutationOutcome = "not_sent" | "confirmed" | "indeterminate"
```

### NativeProfile

Профиль протокола, которым идёт низкоуровневая операция; anonymous — без входа.

```ts
type NativeProfile = "native" | "web" | "anonymous"
```

### ObjectData

Документ объекта: ответ get.

```ts
ObjectData<T extends object = HcmData>
```

| Поле | Тип | Описание |
| --- | --- | --- |
| `id?` | `string` | ID объекта, 0x…. |
| `type` | `string` | Тип объекта. |
| `url` | `string` | Адрес документа. |
| `data` | `T` | Поля документа; повторяемый элемент — всегда список. |
| `fromCatalog?` | `HcmData` | Запрошенные поля, которые документ не хранит: сервер вычисляет их для строки каталога. |
| `emptyFields?` | `string[]` | Поля, запрошенные по имени, для которых у объекта нет значения. |
| `unknownFields?` | `string[]` | Запрошенные поля, которых нет ни у типа, ни у его каталога. |
| `fingerprint` | `string` | Отпечаток документа: expectedFingerprint для правки. |
| `formUrl?` | `string` | Адрес формы типа. |

### ObjectTarget

Какой объект: id или url документа; type — проверить тип объекта (иначе TYPE_MISMATCH).

Вариант 1:

| Поле | Тип | Описание |
| --- | --- | --- |
| `url` | `string` | Адрес документа: url из ответа get. |
| `type?` | `string` | Ожидаемый тип объекта. |
| `id?` | `string` | ID объекта, строкой: 0x… или десятичная запись. |

Вариант 2:

| Поле | Тип | Описание |
| --- | --- | --- |
| `id` | `string` | ID объекта, строкой: 0x… или десятичная запись. |
| `type?` | `string` | Ожидаемый тип объекта. |
| `url?` | `string` | Адрес документа: url из ответа get. |

### OperationDefinition

Описание операции. Доступна ли она, решает подключённый сервер в момент вызова.

| Поле | Тип | Описание |
| --- | --- | --- |
| `id` | `string` | ID операции: objects.get, native.lds.loadDoc. |
| `group` | `string` | Группа операций: objects, lds, files… |
| `title` | `string` | Короткое название. |
| `description` | `string` | Что делает операция и чем ограничена. |
| `effect` | `OperationEffect` | Что операция делает с сервером; по нему проверяются права. |
| `inputSchema` | `JsonSchema` | Схема JSON аргументов. |
| `profile?` | `NativeProfile` | Профиль протокола; только у низкоуровневых операций. |
| `method?` | `string` | Метод API сервера; только у низкоуровневых операций. |

### OperationEffect

Что операция делает с сервером: read — читает, write — записывает, execute — выполняет код
на сервере. unknown — эффект зависит от аргументов (HTTP-запрос с любым методом): права
проверяются по самим аргументам.

```ts
type OperationEffect = "read" | "write" | "execute" | "unknown"
```

### OperationError

Ошибка операции в ответе с ok:false.

| Поле | Тип | Описание |
| --- | --- | --- |
| `code` | `string` | Код ошибки: WRITE_DISABLED, NOT_FOUND… Программа сравнивает его, а не текст. |
| `message` | `string` | Что случилось. |
| `hint?` | `string` | Что сделать дальше. |
| `retryable?` | `boolean` | Можно ли повторить вызов без изменений. |
| `mutationOutcome?` | `MutationOutcome` | Исход записи; только у операций записи и выполнения кода. |
| `details?` | `Readonly<Record<string, unknown>>` | Подробности: путь к неверному аргументу, ID, похожие имена. |

### OperationFilter

Отбор операций для listOperations и listHcmOperations.

| Поле | Тип | Описание |
| --- | --- | --- |
| `query?` | `string` | Слова в ID, названии и описании; read, write, execute или unknown целиком — операции с этим эффектом. |
| `topic?` | `string` | Тема обзора: functions, tasks, agents, files, documents… Неизвестная тема — UNKNOWN_TOPIC. |
| `group?` | `string` | Группа операций: objects, lds, files… |
| `effect?` | `OperationEffect` | Только операции с этим эффектом. |
| `cursor?` | `number` | Сколько операций пропустить: nextCursor прошлой страницы. |
| `limit?` | `number` | Операций на странице, 1–1000; по умолчанию 30. |

### OperationPage

Страница списка операций.

| Поле | Тип | Описание |
| --- | --- | --- |
| `operations` | `readonly OperationDefinition[]` | Операции страницы. |
| `total` | `number` | Сколько операций подходит всего. |
| `nextCursor?` | `number` | cursor следующей страницы; нет — страница последняя. |

### OperationResult

Ответ операции: {ok:true, data, meta} или {ok:false, error, meta}.

| Поле | Тип | Описание |
| --- | --- | --- |
| `ok` | `boolean` | true — операция выполнена, false — ошибка в error. |
| `data?` | `unknown` | Данные ответа; при meta.truncated — начало данных и resultId. |
| `error?` | `OperationError` | Ошибка при ok:false. |
| `meta` | `{…}` | Сведения о вызове. |
| `meta.operationId` | `string` | ID выполненной операции. |
| `meta.connection` | `string` | Имя подключения. |
| `meta.durationMs` | `number` | Время вызова, мс. |
| `meta.truncated?` | `boolean` | Ответ больше outputLimitBytes и сохранён локально: в data только начало. |
| `meta.resultId?` | `string` | ID сохранённого результата: его читают readResult и exportResult. |
| `meta.resultBytes?` | `number` | Размер сохранённого ответа в байтах. |

### PatchChange

Одно изменение документа. Значения показаны как были и как записаны; у структуры — поля первого уровня, вложенное названо, а не скопировано.

| Поле | Тип | Описание |
| --- | --- | --- |
| `op` | `"set" \| "remove"` | set — значение записано, remove — путь удалён. |
| `path` | `string` | Путь в документе. |
| `before?` | `unknown` | Значение до правки. |
| `after?` | `unknown` | Значение после правки. |

### PatchedObjectData

Ответ patch, когда правка записана.

| Поле | Тип | Описание |
| --- | --- | --- |
| `id?` | `string` | ID объекта. |
| `type` | `string` | Тип объекта. |
| `url` | `string` | Адрес документа. |
| `fingerprint` | `string` | Отпечаток записанного документа. |
| `changes` | `PatchChange[]` | Что изменено. |
| `serverChanged?` | `string[]` | Поля верхнего уровня вне правки, которые сервер сам изменил при сохранении. |
| `mutationId` | `string` | ID записи в журнале записей mutations.jsonl. |
| `mutationOutcome` | `"confirmed"` | Исход записи: подтверждена. |

### PatchOperation

Одна операция правки: set записывает value по path, remove удаляет path.

Вариант 1:

| Поле | Тип | Описание |
| --- | --- | --- |
| `op` | `"set"` | Записать значение. |
| `path` | `string` | Путь в документе: name, access.access_level. |
| `value` | `unknown` | Записываемое значение. |

Вариант 2:

| Поле | Тип | Описание |
| --- | --- | --- |
| `op` | `"remove"` | Удалить путь. |
| `path` | `string` | Путь в документе. |

### PatchOptions

Что изменить в объекте: patch, remove или resave.

| Поле | Тип | Описание |
| --- | --- | --- |
| `patch?` | `HcmData \| readonly PatchOperation[]` | Что записать: {path: value} или список операций. |
| `remove?` | `readonly string[]` | Пути, которые удалить из документа. |
| `expectedFingerprint?` | `string` | fingerprint из чтения: если объект с тех пор изменился, запись отклоняется с CONFLICT. |
| `preview?` | `boolean` | Только показать изменения, ничего не записывая. |
| `resave?` | `boolean` | Сохранить документ, даже если правка ничего не меняет: сервер заново заполняет вычисляемое. |

### PatchPreviewData

Ничего не записано: запрошен предпросмотр или правка ничего не меняет (noop).

| Поле | Тип | Описание |
| --- | --- | --- |
| `preview` | `boolean` | Запрошен предпросмотр. |
| `noop` | `boolean` | Правка ничего не меняет, и resave не задан. |
| `changes` | `PatchChange[]` | Что изменила бы правка. |
| `fingerprint` | `string` | Отпечаток документа сейчас: expectedFingerprint для записи. |
| `serverFilled?` | `string[]` | Поля правки, которые сервер заполняет сам при сохранении: записанное значение он, скорее всего, заменит. |

### QueryData

Страница поиска: ответ query.

```ts
QueryData<T = HcmData>
```

| Поле | Тип | Описание |
| --- | --- | --- |
| `items` | `T[]` | Строки страницы; поля — в порядке fields. |
| `total?` | `number` | Строки, подходящие запросу на сервере, если сервер сообщает согласованный счётчик. |
| `nextStartPosition?` | `number` | Строки могут идти дальше: передать как startPosition. Смещения — не стабильный снимок. |
| `incomplete?` | `true` | Конец не установлен и смещение не растёт; hint говорит почему. |
| `hint?` | `string` | Пояснение к странице: почему она неполная, как сузить запрос. |
| `unknownFields?` | `string[]` | Запрошенные поля, которых нет в каталоге. |

### QueryInput

Поиск в каталоге (catalog, where, order) или запрос XQuery целиком (query, нужно право execute).
Запрос XQuery возвращает элементы каталога и заканчивается на return $elem; отдельные значения
возвращает низкоуровневая операция native.lds.xQuery.

Вариант 1:

| Поле | Тип | Описание |
| --- | --- | --- |
| `fields?` | `readonly string[]` | Поля строки, в этом порядке; без fields — все поля каталога. |
| `limit?` | `number` | Строк на странице, 1–1000; по умолчанию 20. |
| `startPosition?` | `number` | С какой строки читать: nextStartPosition прошлой страницы; до 1000000. |
| `catalog` | `string` | Каталог: collaborators, groups… |
| `where?` | `Record<string, FilterValue \| FilterCondition>` | Условия на поля каталога, через «и»: {is_dismiss: false, hire_date: {gte: "2026-01-01"}}. |
| `order?` | `string \| readonly string[]` | Поля каталога для сортировки: "fullname", "hire_date desc". |

Вариант 2:

| Поле | Тип | Описание |
| --- | --- | --- |
| `fields?` | `readonly string[]` | Поля строки, в этом порядке; без fields — все поля каталога. |
| `limit?` | `number` | Строк на странице, 1–1000; по умолчанию 20. |
| `startPosition?` | `number` | С какой строки читать: nextStartPosition прошлой страницы; до 1000000. |
| `query` | `string` | Запрос XQuery: for $elem in collaborators where … return $elem. |

### QueryOptions

Поля и страница поиска: общие для каталога и запроса XQuery.

| Поле | Тип | Описание |
| --- | --- | --- |
| `fields?` | `readonly string[]` | Поля строки, в этом порядке; без fields — все поля каталога. |
| `limit?` | `number` | Строк на странице, 1–1000; по умолчанию 20. |
| `startPosition?` | `number` | С какой строки читать: nextStartPosition прошлой страницы; до 1000000. |

### ResultExportData

Ответ exportResult.

| Поле | Тип | Описание |
| --- | --- | --- |
| `path` | `string` | Путь к файлу, как передан. |
| `bytes` | `number` | Размер файла в байтах. |
| `format` | `"json" \| "jsonl" \| "text"` | Формат записи. |
| `items?` | `number` | Сколько элементов записано; только у jsonl. |

### ResultExportInput

Аргументы exportResult.

| Поле | Тип | Описание |
| --- | --- | --- |
| `resultId` | `string` | ID сохранённого результата: meta.resultId ответа. |
| `path` | `string` | Путь к файлу на этом компьютере; папка должна быть, иначе FOLDER_NOT_FOUND. |
| `format?` | `"json" \| "jsonl" \| "text"` | json — ответ целиком одним JSON (по умолчанию); jsonl — элементы списка, по строке на элемент; text — сохранённый текст как есть. |
| `overwrite?` | `boolean` | Заменить файл, если он уже есть; иначе FILE_EXISTS. |

### ResultMeta

Сведения о вызове: операция, подключение, время, признак сохранённого ответа.

| Поле | Тип | Описание |
| --- | --- | --- |
| `operationId` | `string` | ID выполненной операции. |
| `connection` | `string` | Имя подключения. |
| `durationMs` | `number` | Время вызова, мс. |
| `truncated?` | `boolean` | Ответ больше outputLimitBytes и сохранён локально: в data только начало. |
| `resultId?` | `string` | ID сохранённого результата: его читают readResult и exportResult. |
| `resultBytes?` | `number` | Размер сохранённого ответа в байтах. |

### ResultPage

Страница сохранённого результата: элементы списка или кусок текста.

```ts
ResultPage<T = unknown>
```

Вариант 1:

| Поле | Тип | Описание |
| --- | --- | --- |
| `items` | `T[]` | Элементы страницы. |
| `total` | `number` | Сколько элементов в списке. |
| `nextOffset?` | `number` | offset следующей страницы; нет — страница последняя. |
| `blockedItem?` | `{…}` | Элемент, который один больше предела ответа: его номер и размер. |
| `blockedItem.index` | `number` | Номер элемента в списке. |
| `blockedItem.bytes` | `number` | Размер элемента в байтах. |
| `hint?` | `string` | Как прочитать blockedItem. |
| `cutBySize?` | `true` | Страница короче запрошенной: в один ответ больше не входит. |
| `list?` | `string` | Поле сохранённого ответа, откуда взяты элементы; для голого списка отсутствует. |

Вариант 2:

| Поле | Тип | Описание |
| --- | --- | --- |
| `text` | `string` | Кусок текста. |
| `totalChars` | `number` | Сколько символов в тексте. |
| `nextOffset?` | `number` | offset следующего куска; нет — кусок последний. |
| `format?` | `"text" \| "json"` | text — сохранённый текст, json — текст JSON сохранённого ответа. |
| `cutBySize?` | `true` | Кусок короче запрошенного: в один ответ больше не входит. |

### ResultReadInput

Аргументы readResult.

| Поле | Тип | Описание |
| --- | --- | --- |
| `resultId` | `string` | ID сохранённого результата: meta.resultId ответа. |
| `offset?` | `number` | С какого элемента списка или символа текста читать: nextOffset прошлой страницы. |
| `limit?` | `number` | Элементов на странице (по умолчанию 100, до 1000) или символов (по умолчанию 12000). |
| `format?` | `"auto" \| "json" \| "text"` | auto — список по элементам, текст по символам (по умолчанию); json — любой результат как текст JSON по частям; text — только сохранённый текст. |

### RpcArgument

Аргумент функции библиотеки: строка, целое, логическое значение и null — как есть.

```ts
type RpcArgument = string | boolean | number | null | RpcTypedArgument | RpcXmlArgument
```

Типы: [RpcTypedArgument](#rpctypedargument), [RpcXmlArgument](#rpcxmlargument).

### RpcCatalogFilter

Аргументы listRpc.

| Поле | Тип | Описание |
| --- | --- | --- |
| `query?` | `string` | Часть имени функции или параметра. |
| `library?` | `string` | Библиотека: tools, ms_tools… |
| `method?` | `string` | Имя функции целиком. |
| `builtIn?` | `boolean` | Встроенная таблица функций сервера 2025.1.1171, без обращения к серверу. |
| `all?` | `boolean` | Включить функции, которые может вызывать только код сервера. |
| `cursor?` | `number` | Сколько функций пропустить: nextCursor прошлой страницы. |
| `limit?` | `number` | Функций на странице, 1–100; по умолчанию 30. |

### RpcCatalogPage

Страница функций: ответ listRpc.

| Поле | Тип | Описание |
| --- | --- | --- |
| `targets` | `readonly RpcTargetCard[]` | Функции страницы. |
| `total` | `number` | Сколько функций подходит всего. |
| `serverOnlyHidden?` | `number` | Подходящие функции, пропущенные из-за того, что клиент их не вызовет; all:true выводит их. |
| `hint?` | `string` | Есть при serverOnlyHidden: как их показать. |
| `nextCursor?` | `number` | cursor следующей страницы; нет — страница последняя. |
| `source` | `"server" \| "built-in 2025.1.1171"` | Откуда список: с сервера или из встроенной таблицы 2025.1.1171. |
| `skipped?` | `readonly string[]` | Библиотеки, список функций которых сервер не отдал. |

### RpcDescribeOptions

Аргументы describeRpc помимо targetId.

| Поле | Тип | Описание |
| --- | --- | --- |
| `builtIn?` | `boolean` | Встроенная таблица функций сервера 2025.1.1171, без обращения к серверу. |
| `source?` | `boolean` | Добавить код функции, до 8 КБ. |

### RpcInput

Аргументы rpc: функция библиотеки и её аргументы.

| Поле | Тип | Описание |
| --- | --- | --- |
| `library` | `string` | Библиотека: tools, ms_tools… |
| `method` | `string` | Функция библиотеки. |
| `arguments?` | `readonly RpcArgument[]` | Аргументы по порядку параметров функции. |
| `async?` | `boolean` | Запустить фоновой задачей: в ответе TrackingID вместо значения. |

### RpcTargetCard

Функция библиотеки сервера.

| Поле | Тип | Описание |
| --- | --- | --- |
| `id` | `string` | «библиотека.функция»: tools.get_version. |
| `parameters` | `readonly string[]` | Имена параметров по порядку; типов сервер не объявляет. |
| `allowed` | `boolean \| null` | Разрешён ли вызов с клиента; null — не установлено. |
| `serverOnly?` | `true` | Функция не допускает вызова с клиента: её зовёт только код сервера. |

### RpcTargetDescription

Функция библиотеки с кодом: ответ describeRpc.

| Поле | Тип | Описание |
| --- | --- | --- |
| `note?` | `string` | Как вызвать функцию, которую клиент вызвать не может. |
| `code?` | `string` | С source:true: код функции, до 8 КБ. |
| `codeTruncated?` | `true` | Код длиннее 8 КБ и обрезан. |
| `id` | `string` | «библиотека.функция»: tools.get_version. |
| `parameters` | `readonly string[]` | Имена параметров по порядку; типов сервер не объявляет. |
| `allowed` | `boolean \| null` | Разрешён ли вызов с клиента; null — не установлено. |
| `serverOnly?` | `true` | Функция не допускает вызова с клиента: её зовёт только код сервера. |
| `source` | `"server" \| "built-in 2025.1.1171"` | Откуда список: с сервера или из встроенной таблицы 2025.1.1171. |
| `skipped?` | `readonly string[]` | Библиотеки, список функций которых сервер не отдал. |

### RpcTypedArgument

Аргумент функции с явным типом: дата, дробное или большое число, объект, XML.

| Поле | Тип | Описание |
| --- | --- | --- |
| `valueType` | `string` | Тип значения сервера: date, integer, real, string, bool… |
| `lexicalValue` | `string \| {…}` | Значение в записи сервера: "2026-10-01T00:00:00", "6148914691236517121"; XML — {xml}. |
| `lexicalValue.xml` | `string` | Текст XML. |

### RpcXmlArgument

Аргумент функции — XML.

| Поле | Тип | Описание |
| --- | --- | --- |
| `lexicalValue` | `{…}` | XML значения. |
| `lexicalValue.xml` | `string` | Текст XML. |

### RunAgentInput

Аргументы runAgent.

| Поле | Тип | Описание |
| --- | --- | --- |
| `id` | `string` | ID агента сервера (server_agent). |
| `objectId?` | `string` | ID объекта: в коде агента это OBJECT_ID. |
| `objectIds?` | `readonly string[]` | ID нескольких объектов: в коде агента это OBJECTS_ID_STR, через «;». |

### SchemaField

Поле типа объекта.

| Поле | Тип | Описание |
| --- | --- | --- |
| `path` | `string` | Путь поля в документе: name, access.access_level. |
| `type` | `string` | Тип значения: string, integer, date, bool… element — структура. |
| `origin` | `string` | own — своё поле типа, inherited:… — унаследованное, custom — настраиваемое, catalog — только в строке каталога. |
| `name?` | `string` | Имя настраиваемого поля. |
| `title?` | `string` | Заголовок на языке сервера. |
| `references?` | `string` | Каталог или список, ID элемента которого лежит в поле. |
| `multiple?` | `true` | Элемент повторяется: в данных всегда список. |
| `required?` | `true` | Поле обязательно. |
| `key?` | `string` | Поле-ключ элемента списка. |
| `children?` | `number` | Структура: сколько в ней полей; их показывает path. |
| `values?` | `string[]` | Допустимые значения настраиваемого поля. |
| `sheet?` | `string` | Вкладка настраиваемого поля в форме. |
| `query?` | `true` | Поле есть в каталоге: по нему ищет query. |
| `computed?` | `true` | Значение вычисляет сервер: записанное не сохраняется. |

### SchemaInput

Аргументы schema: тип или url и отбор полей.

| Поле | Тип | Описание |
| --- | --- | --- |
| `type?` | `string` | Тип объекта: collaborator, group…; вместо него можно url. |
| `url?` | `string` | Адрес документа: поля типа этого объекта. |
| `search?` | `string` | Слова в пути, заголовке или каталоге ссылки, на любой глубине; все слова — в одном поле. |
| `path?` | `string` | Структура, чьи поля показать: access, custom_elems. |
| `deep?` | `boolean` | Вложенные поля всех глубин одним списком, а не по уровню за вызов. |
| `origin?` | `("own" \| "inherited" \| "custom" \| "catalog")[]` | Только поля этого происхождения: own, inherited, custom, catalog. |
| `kind?` | `string` | ID вида объекта: настраиваемые поля этого вида, когда у типа customFields "by kind". |
| `include?` | `"methods"[]` | methods — добавить методы формы. |
| `language?` | `string` | Язык заголовков: ru, en…; по умолчанию язык интерфейса сервера. |
| `limit?` | `number` | Полей на странице, 1–1000; по умолчанию 80. |
| `cursor?` | `number` | Сколько полей пропустить: nextCursor прошлой страницы. |

### SchemaResult

Страница полей типа: ответ schema.

| Поле | Тип | Описание |
| --- | --- | --- |
| `type` | `string` | Тип объекта. |
| `catalog?` | `string` | Каталог типа, если есть. |
| `formUrl` | `string` | Адрес формы типа. |
| `element?` | `SchemaField` | С path: элемент, чьи поля перечислены — список ли он, какой у него ключ. |
| `fields` | `SchemaField[]` | Поля страницы. |
| `total` | `number` | Сколько полей подходит всего. |
| `nextCursor?` | `number` | cursor следующей страницы; нет — страница последняя. |
| `cutBySize?` | `true` | Страница короче запрошенной: больше не умещается в один ответ. |
| `notes` | `string[]` | Пояснения: где хранится вид объекта, что не удалось прочитать. |
| `methods?` | `{…}[]` | С include:["methods"]: методы формы. |
| `methods[].name` | `string` | Имя метода. |
| `methods[].parameters` | `string[]` | Имена параметров. |

### SchemaTypesInput

Аргументы types.

| Поле | Тип | Описание |
| --- | --- | --- |
| `search?` | `string` | Слова в типе, каталоге или заголовке. |
| `limit?` | `number` | Строк на странице, 1–1000; по умолчанию 50. |
| `cursor?` | `number` | Сколько строк пропустить: nextCursor прошлой страницы. |

### SchemaTypesResult

Страница типов объектов: ответ types.

| Поле | Тип | Описание |
| --- | --- | --- |
| `types` | `{…}[]` | Типы страницы, за ними — каталоги без своего типа объекта. |
| `types[].type?` | `string` | Тип объекта; нет — строка каталога без своего типа объекта: документов у его строк нет. |
| `types[].catalog?` | `string` | Каталог; у части типов каталога нет. |
| `types[].title?` | `string` | Заголовок на языке сервера. |
| `types[].customFields?` | `number \| "by kind"` | Сколько настраиваемых полей у типа; "by kind" — они зависят от вида объекта (kind у schema). |
| `total` | `number` | Сколько строк подходит всего. |
| `nextCursor?` | `number` | cursor следующей страницы; нет — страница последняя. |
| `notes?` | `string[]` | Пояснения к списку. |

### ScriptData

Ответ execute.

```ts
ScriptData<T = unknown>
```

| Поле | Тип | Описание |
| --- | --- | --- |
| `result` | `readonly T[]` | Массив RESULT из кода; числа, даты и логические значения — строками. |
| `columns?` | `readonly unknown[]` | Описания столбцов, если сервер их вернул. |
| `data?` | `Readonly<Record<string, unknown>>` | Дополнительные данные коллекции, если сервер их вернул. |
| `executionId` | `string` | Имя несохранённой коллекции, несшей код; оно попадает в строки лога сервера. |

### ServerCatalogLimit

Лицензионный предел числа объектов одного типа.

| Поле | Тип | Описание |
| --- | --- | --- |
| `objectTypeName` | `string` | Тип объекта. |
| `maxRecordsNum` | `string` | Предел числа объектов, строкой. |

### ServerDatabase

База за сервером по флагам, которыми сам сервер определяет тип своей базы.

```ts
type ServerDatabase = "mssql" | "postgresql" | "oracle" | "azure" | "xml" | "other"
```

### ServerInfoData

Ответ serverInfo.

| Поле | Тип | Описание |
| --- | --- | --- |
| `profile` | `ServerInfoProfile` | Профиль, которым прочитаны сведения. |
| `versionServer` | `string` | Версия сервера. |
| `osType` | `"windows" \| "linux"` | Операционная система сервера. |
| `capabilityMask` | `string` | Маска возможностей базы, целое строкой. Это не права пользователя. |
| `database` | `ServerDatabase` | База за сервером, по маске возможностей. |
| `catalogLimits` | `readonly ServerCatalogLimit[]` | Лицензионные пределы числа объектов по типам, объявленные при запуске, не текущие числа. |
| `dataFolders?` | `readonly string[]` | Профиль native: папки данных, куда writeFile пишет без права execute. |
| `codeFolders?` | `readonly string[]` | Профиль native: папки кода, куда writeFile пишет только с правом execute. |

### ServerInfoInput

Аргументы serverInfo.

| Поле | Тип | Описание |
| --- | --- | --- |
| `profile?` | `ServerInfoProfile` | native (по умолчанию) или web; папки dataFolders и codeFolders есть только у native. |

### ServerInfoProfile

Профиль протокола, которым читаются сведения.

```ts
type ServerInfoProfile = "native" | "web"
```

### StatusData

Ответ status.

| Поле | Тип | Описание |
| --- | --- | --- |
| `connection` | `string` | Имя подключения. |
| `baseUrl` | `string` | Адрес сервера. |
| `version` | `string` | Версия сервера: 2025.2.1535. |
| `database?` | `ServerDatabase` | База за сервером, если сервер её описывает. |
| `userId?` | `string` | ID пользователя, под которым подключение вошло, если сервер его называет. |
| `operationCount` | `number` | Сколько операций у клиента. |
| `permissions` | `{…}` | Права подключения. |
| `permissions.write` | `boolean` | Право на запись. |
| `permissions.execute` | `boolean` | Право на выполнение кода на сервере. |

### StoredResultData

data ответа, который больше outputLimitBytes и сохранён локально.

| Поле | Тип | Описание |
| --- | --- | --- |
| `preview` | `unknown` | Начало данных. Это не все данные. |
| `resultId` | `string` | ID сохранённого результата: его читают readResult и exportResult. |
| `hint?` | `string` | Какие операции читают сохранённый ответ. |

### UploadChunkInput

Одна часть загрузки по частям. fileId у всех частей один, последнюю часть слать последней.

| Поле | Тип | Описание |
| --- | --- | --- |
| `fileId` | `string` | ID загрузки: 32 шестнадцатеричные цифры, выбирает вызывающий. |
| `index` | `number` | Номер части с 0. |
| `chunksTotal` | `number` | Сколько частей всего. |
| `totalBytes` | `number` | Размер файла целиком в байтах. |
| `offset` | `number` | Смещение части в файле в байтах. |
| `filename` | `string` | Имя файла на сервере. |
| `data` | `string \| {…}` | Содержимое: строка пишется в UTF-8, двоичные данные — {base64}. |
| `data.base64` | `string` | Двоичные данные в base64. |
| `contentType?` | `string` | Тип содержимого (Content-Type); по умолчанию application/octet-stream. |

### UploadedChunkData

Ответ сервера на часть. Url не подтверждает, что файл собран целиком: проверить чтением.

| Поле | Тип | Описание |
| --- | --- | --- |
| `error` | `0` | 0 — сервер принял часть. |
| `Url` | `string` | Адрес файла, который назвал сервер. |

### UploadedFileData

Ответ uploadFile.

| Поле | Тип | Описание |
| --- | --- | --- |
| `url` | `string` | Адрес файла: x-local://share/uploaded_files/&lt;folder>/&lt;name>. |
| `folderUrl` | `string` | Папка, которую сервер создал для файла; остаётся после удаления файла. |

### UploadFileInput

Аргументы uploadFile.

| Поле | Тип | Описание |
| --- | --- | --- |
| `filename` | `string` | Имя файла на сервере. |
| `data` | `string \| {…}` | Содержимое: строка пишется в UTF-8, двоичные данные — {base64}. |
| `data.base64` | `string` | Двоичные данные в base64. |
| `contentType?` | `string` | Тип содержимого (Content-Type); по умолчанию application/octet-stream. |

### WebSocketHeartbeatData

Проверка прошла: подключение принято, $ok получен.

| Поле | Тип | Описание |
| --- | --- | --- |
| `handshakeValidated` | `true` | Всегда true. |
| `heartbeatObserved` | `true` | Всегда true. |
| `route` | `"/services/main_ws_service"` | Адрес WebSocket на сервере. |
| `phase` | `"preflight" \| "connecting" \| "heartbeat" \| "closing" \| "disposed"` | До какой фазы дошла проверка. |
| `httpStatus?` | `number` | Статус HTTP при повышении протокола или отказе, если был; без него ответа не наблюдали. |
| `heartbeatWritten` | `boolean` | Сообщение $hbt отправлено. |
| `closeRequested` | `boolean` | Клиент запросил закрытие. |
| `peerCloseObserved` | `boolean` | Сервер прислал кадр закрытия. |
| `peerEofObserved` | `boolean` | Сервер закрыл соединение. |
| `libraryCloseCode?` | `number` | Код закрытия WebSocket, если был. |
| `closeWriteVerified` | `false` | Всегда false: что кадр закрытия дошёл до сервера, не проверить. |
| `localSocketDisposed` | `boolean` | Соединение на стороне клиента закрыто. |
| `forcedLocalTermination` | `boolean` | Клиент оборвал соединение сам: истёк срок или превышен предел. |
| `warning?` | `"PEER_CLOSE_ACK_NOT_OBSERVED"` | Ответа сервера на закрытие не было; $ok при этом получен. |
| `durationMs` | `number` | Время проверки, мс. |
| `limits` | `{…}` | Пределы проверки. |
| `limits.timeoutMs` | `number` | Срок проверки, мс. |
| `limits.maxMessageBytes` | `number` | Предел одного сообщения в байтах. |
| `limits.maxMessages` | `number` | Предел числа сообщений. |
| `limits.maxTotalBytes` | `number` | Предел всех полученных байт. |
| `counts` | `{…}` | Сколько получено. |
| `counts.messages` | `number` | Сообщений. |
| `counts.receivedBytes` | `number` | Байт. |

### WebSocketHeartbeatInput

Аргументы heartbeat.

| Поле | Тип | Описание |
| --- | --- | --- |
| `timeoutMs?` | `number` | Срок проверки WebSocket, 250–10000 мс; по умолчанию 5000. |
