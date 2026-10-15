# SDK

SDK — для кода на JavaScript и TypeScript: цикл по сотням объектов, своя обработка данных, перенос между серверами. Возможности те же, что у CLI и MCP-сервера.

## С чего начать

```javascript
import { loadConfig, withHcmClient, unwrap } from "wtctl";

const config = loadConfig();

await withHcmClient(config, async (client) => {
  const page = unwrap(
    await client.query({
      catalog: "collaborators",
      where: { is_dismiss: false },
      fields: ["id", "fullname"],
      limit: 100,
    }),
  );
  for (const row of page.items) console.log(row.id, row.fullname);
});
```

- `loadConfig` читает файл подключений или переменные окружения, см. [configuration.md](configuration.md). Без аргументов берёт то же подключение, что и CLI. `loadConfig({ connection: "prod" })` выбирает подключение по имени, `configPath` — другой файл, `settings` — поля подключения кодом, см. [ниже](#настройки-подключения-кодом).
- `withHcmClient` открывает подключение, вызывает переданную функцию и закрывает подключение — и при успехе, и при ошибке.
- Каждый метод возвращает `{ok, data, meta}` или `{ok:false, error, meta}`. Если сервер отказал, исключения не будет.
- `unwrap` достаёт `data`. При `ok:false` он бросает `HcmOperationError` с полями `code`, `message`, `hint`, `details`, `mutationOutcome`.

Подключить SDK к своему коду можно двумя способами:

- Поставить пакет в проект: `npm install wtctl`. После этого SDK импортируется как `wtctl`. Зависимостей пакет за собой не тянет.
- Импортировать прямо из файла: `import { … } from "file:///…/dist/index.js"`. Точный адрес называет `wtctl guide cli-sdk` в разделе «На этом компьютере».

## Настройки подключения кодом

`settings` принимает поля подключения из [файла подключений](configuration.md#файл-подключений), кроме `usernameEnv` и `passwordEnv`. Значение проверяется так же, как в файле, и сильнее переменной и поля в файле:

```javascript
const config = loadConfig({ settings: { outputLimitBytes: 1024 * 1024 } });
```

Адрес, учётные данные и права подключения из файла или переменных `settings` не меняет: `username`, `password` или `permissions` без `baseUrl` отклоняются с `INVALID_CONFIG`.

`settings` с `baseUrl` — отдельное подключение. Файл подключений не читается, даже если его называет `WTCTL_CONFIG`; переменные адреса, учётных данных и прав не действуют. Логин, пароль и `permissions` задаются в тех же `settings`, права по умолчанию выключены. Имя подключения — из `connection`, иначе `default`. Вместе с `configPath` такое `settings` отклоняется с `INVALID_CONFIG`.

```javascript
const config = loadConfig({
  settings: { baseUrl: "http://localhost:8088", username: "admin", password: process.env.HCM_PASSWORD },
});
```

## Методы

| Задача | Метод |
| --- | --- |
| Состояние и проверка | `status()`, `check()`, `serverInfo()`, `heartbeat()` |
| Типы и поля | `types({search})`, `schema({type, search, path, deep, origin, kind})` |
| Поиск | `query({catalog, where, fields, order, limit, startPosition})`, `query({query: "текст XQuery", fields})`, все строки — `queryRows(…)` |
| Объект | `get({id, fields})`, `getMany({ids, fields})`, `create({type, data})`, `patch({id, patch, remove, preview, expectedFingerprint})`, `delete({id, permanent: true})` |
| Код и функции | `execute(code, params)`, `runAgent({id, objectId, objectIds})`, `rpc({library, method, arguments})`, `listRpc({query})`, `describeRpc("библиотека.функция", {source: true})` |
| Логи | `listLogs()`, `searchLogs({file, text, level})`, `readLog({file})`, `followLog({file, cursor})` |
| Файлы | `fileExists({url})`, `readFile({url})`, `listFiles({url})`, `writeFile({url, text | base64 | file})`, `deleteFile({url})`, `uploadFile({filename, data})` |
| Несколько операций | `batch({steps})` |
| Большой результат | `readResult({resultId, offset, limit})`, `exportResult({resultId, path, format})` |
| Любая операция по ID | `call("native.lds.loadDoc", {url})` |

Аргументы и ответы такие же, как у инструментов MCP; каждый метод с аргументами и полями ответа описан в [справочнике SDK](sdk-reference.md). Правила по задачам описаны в гайде, его темы перечислены в [README.md](../README.md#документация).

Список операций для `call` возвращает `client.listOperations({query})`, аргументы одной операции — `client.describe(id)`. Без подключения к серверу то же делают `listHcmOperations()` и `describeHcmOperation(id)`.

## Все строки запроса

```javascript
const rows = client.queryRows({ catalog: "collaborators", fields: ["id", "fullname"], order: ["id"], limit: 500 });
for await (const row of rows) handle(row);
```

`queryRows` принимает те же аргументы, что `query`, и сам листает страницы: `limit` — размер страницы, а не число строк. Запрос XQuery перебирается так же: `client.queryRows({ query: "for $e in … return $e", fields: ["id"] })`. Все строки массивом — `await Array.fromAsync(client.queryRows(…))`.

- Страница с `incomplete: true` — это не конец данных, а запрос, который отвергла база данных. `queryRows` выдаёт её строки, затем бросает `HcmOperationError` с кодом `QUERY_INCOMPLETE` и подсказкой сервера.
- Страница больше `outputLimitBytes` бросает `HcmStoredResultError`, как `unwrap`: см. [большие ответы](#большие-ответы).
- Страницы не дают снимка: если данные меняются во время чтения, строка может повториться или потеряться.

Одна страница — `query`: `nextStartPosition` в её ответе приходит, пока строки не кончились, и передаётся в `startPosition` следующего вызова.

## Значения

- Логические значения в строке каталога и в документе — строки `"1"` и `"0"`. Строка `"0"` в JavaScript — истина, поэтому сравнивать нужно со строкой: `row.is_dismiss === "1"`. В условиях `where` и в правке пишут `true` и `false`.
- Числа — тоже строки: `"5"`.
- ID — строка. Код на сервере (`execute`) отдаёт ID в десятичной записи: `"7336568271880514489"` — тот же объект, что `"0x65D0B9F8F3D6EBB9"`. Методы принимают его как есть. В `Number` ID превращать нельзя: теряются разряды.
- Повторяемый элемент — всегда список, даже из одного элемента: `doc.collaborators.collaborator` — массив.
- Даты — местное время сервера без смещения: `"2026-10-02T16:42:00"`.

## Большие ответы

Ответ больше `outputLimitBytes` (по умолчанию 24 КБ) клиент сохраняет на диск, см. [configuration.md](configuration.md#сохранённые-результаты). `unwrap` в этом случае бросает `HcmStoredResultError` с полем `resultId` — чтобы кусок данных нельзя было принять за все данные. Дальше два варианта:

- Поднять предел: `loadConfig({ settings: { outputLimitBytes: 1024 * 1024 } })`. Больше 1 МБ поставить нельзя.
- Читать сохранённое частями: `client.readResult({ resultId, offset, limit })`.
  - Сохранённый текст (лог, файл) приходит текстом. `exportResult({ resultId, path, format: "text" })` пишет его в файл как есть.
  - Список (`items`, `types`, `fields`, шаги пакета) читается по элементам: они лежат в `items` страницы, имя списка — в `list`. `cutBySize` значит, что страница вышла короче запрошенной.
  - `exportResult({ resultId, path, format: "jsonl" })` пишет список в файл по строке на элемент.

Большие выборки читаются через `queryRows` и с `fields`.

## Запись

```javascript
const preview = unwrap(await client.patch({ id, patch: { name: "Отдел продаж" }, preview: true }));
console.log(preview.changes);

const saved = unwrap(
  await client.patch({ id, patch: { name: "Отдел продаж" }, expectedFingerprint: preview.fingerprint }),
);
```

`expectedFingerprint` страхует от чужой правки между чтением и записью: если объект за это время изменился, вернётся `CONFLICT`.

Если запись не удалась, исход — в `error.mutationOutcome`:

```javascript
try {
  unwrap(await client.create({ type: "group", data: { code: "sales", name: "Отдел продаж" } }));
} catch (error) {
  if (error.mutationOutcome === "indeterminate") {
    // Запрос ушёл, исход неизвестен: сначала найти объект, повторять нельзя.
  }
  throw error;
}
```

Права `write` и `execute` заданы в подключении. Из кода их не расширить.

## Закрытие подключения

`withHcmClient` закрывает подключение сам. Клиент, созданный через `new HcmClient(config)`, закрывается вручную: `await client.close()` в `finally`. Если ошибкой закончились и операция, и закрытие, бросается ошибка операции, а ошибку закрытия вернёт `getCleanupError(error)`.

## Что экспортирует пакет

У каждого имени в типах пакета есть описание, его показывает подсказка редактора и в JavaScript, и в TypeScript.

- `HcmClient` — клиент по подключению из `loadConfig`, методы перечислены [выше](#методы).
- `withHcmClient(config, action)` — создаёт клиент, вызывает `action` и закрывает подключение.
- `loadConfig(options)` — подключение из файла подключений, переменных окружения или `settings`.
- `unwrap(result)` — `data` ответа; бросает `HcmOperationError` или `HcmStoredResultError`.
- `getCleanupError(error)` — ошибка закрытия подключения, если оно не закрылось после ошибки операции.
- `HcmError` — ошибка клиента с `code`, `message`, `hint`, `details`, `mutationOutcome`; её бросает `loadConfig`, от неё наследуют остальные.
- `HcmOperationError` — ошибка операции из `unwrap`; ответ целиком — в `result`.
- `HcmStoredResultError` — ответ сохранён локально, ID — в `resultId`.
- `HcmCleanupError` — операция выполнена, но подключение не закрылось; её результат — в `value`.
- `listHcmOperations(filter)` и `describeHcmOperation(id)` — список операций и описание одной без подключения к серверу.

Аргументы, поля ответа и описание каждого метода, функции и типа — в [справочнике SDK](sdk-reference.md). Тип строки или документа задаёт параметр-тип метода:

```typescript
interface Person { id: string; fullname: string }
const page = unwrap(await client.query<Person>({ catalog: "collaborators", fields: ["id", "fullname"] }));
```

## Вызовы протокола напрямую

Точки входа пакета `wtctl/native` и `wtctl/protocol` вызывают сервер напрямую, без проверок и удобств клиента. Они нужны, чтобы разрабатывать сам клиент. В своём коде нужен `HcmClient`.
