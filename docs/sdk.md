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

`settings` с `baseUrl` — отдельное подключение. Файл подключений и переменные адреса, учётных данных и прав не читаются; логин, пароль и `permissions` задаются в тех же `settings`, права по умолчанию выключены. Имя подключения — из `connection`, иначе `default`. Вместе с `configPath` или `WTCTL_CONFIG` такое `settings` отклоняется с `INVALID_CONFIG`.

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
| Поиск | `query({catalog, where, fields, order, limit, startPosition})`, `query({query: "текст XQuery", fields})` |
| Объект | `get({id, fields})`, `getMany({ids, fields})`, `create({type, data})`, `patch({id, patch, remove, preview, expectedFingerprint})`, `delete({id, permanent: true})` |
| Код и функции | `execute(code, params)`, `runAgent({id, objectId, objectIds})`, `rpc({library, method, arguments})`, `listRpc({query})`, `describeRpc("библиотека.функция", {source: true})` |
| Логи | `listLogs()`, `searchLogs({file, text, level})`, `readLog({file})`, `followLog({file, cursor})` |
| Файлы | `fileExists({url})`, `readFile({url})`, `listFiles({url})`, `writeFile({url, text})`, `deleteFile({url})`, `uploadFile({filename, data})` |
| Несколько операций | `batch({steps})` |
| Большой результат | `readResult({resultId, offset, limit})`, `exportResult({resultId, path, format})` |
| Любая операция по ID | `call("native.lds.loadDoc", {url})` |

Аргументы и ответы такие же, как у инструментов MCP. Правила по задачам описаны в гайде, его темы перечислены в [README.md](../README.md#документация).

Список операций для `call` возвращает `client.listOperations({query})`, аргументы одной операции — `client.describe(id)`. Без подключения к серверу то же делают `listHcmOperations()` и `describeHcmOperation(id)`.

## Постраничное чтение

```javascript
let startPosition = 0;
while (startPosition !== undefined) {
  const page = unwrap(
    await client.query({ catalog: "collaborators", fields: ["id", "fullname"], order: ["id"], limit: 500, startPosition }),
  );
  for (const row of page.items) handle(row);
  startPosition = page.nextStartPosition;
}
```

`nextStartPosition` приходит, пока строки не кончились. Пустая страница с `incomplete: true` — это не конец данных, а запрос, который сервер отверг, поэтому `page.incomplete` нужно проверять. Страницы не дают снимка: если данные меняются во время чтения, строка может повториться или потеряться.

## Большие ответы

Ответ больше `outputLimitBytes` (по умолчанию 24 КБ) клиент сохраняет на диск, см. [configuration.md](configuration.md#сохранённые-результаты). `unwrap` в этом случае бросает `HcmStoredResultError` с полем `resultId` — чтобы кусок данных нельзя было принять за все данные. Дальше два варианта:

- Поднять предел: `loadConfig({ settings: { outputLimitBytes: 1024 * 1024 } })`. Больше 1 МБ поставить нельзя.
- Читать сохранённое частями: `client.readResult({ resultId, offset, limit })`.
  - Сохранённый текст (лог, файл) приходит текстом. `exportResult({ resultId, path, format: "text" })` пишет его в файл как есть.
  - Список (`items`, `types`, `fields`, шаги пакета) читается по элементам: они лежат в `items` страницы, имя списка — в `list`. `cutBySize` значит, что страница вышла короче запрошенной.
  - `exportResult({ resultId, path, format: "jsonl" })` пишет список в файл по строке на элемент.

Большие выборки читаются постранично и с `fields`.

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

## Типы

В пакете есть типы TypeScript. Основные: `ConnectionConfig`, `HcmResult<T>`, `QueryData<T>`, `ObjectData<T>`, `PatchedObjectData`, `ScriptData<T>`, `HcmOperationError`.

```typescript
interface Person { id: string; fullname: string }
const page = unwrap(await client.query<Person>({ catalog: "collaborators", fields: ["id", "fullname"] }));
```

## Вызовы протокола напрямую

Точки входа пакета `wtctl/native` и `wtctl/protocol` вызывают сервер напрямую, без проверок и удобств клиента. Они нужны, чтобы разрабатывать сам клиент. В своём коде нужен `HcmClient`.
