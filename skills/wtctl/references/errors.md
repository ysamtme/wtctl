# Ошибки

Ошибка приходит так:

```json
{ "ok": false, "error": { "code": "UNKNOWN_FIELD", "message": "…", "hint": "…", "details": { "fields": ["…"] }, "mutationOutcome": "not_sent" } }
```

Сначала читай `hint`: там сказано, что делать. `details` и `mutationOutcome` есть не у каждой ошибки. `mutationOutcome` есть у операций записи и выполнения кода; у запроса XQuery, который сервер отверг, его нет — такой запрос ничего не менял:

| Значение | Что значит | Что делать |
| --- | --- | --- |
| `not_sent` | запрос на сервер не ушёл | исправить и повторить можно |
| `confirmed` | запись прошла и проверена | повторять не нужно |
| `indeterminate` | запрос ушёл; ответа нет, проверка после записи не сошлась или не состоялась | прочитать объект и только потом решать, повторять ли |

## Запреты

| Код | Что делать |
| --- | --- |
| `WRITE_DISABLED`, `EXECUTE_DISABLED` | подключению не дано это право. Остановиться и сказать пользователю; другой способ сделать то же самое не искать |
| `PLATFORM_AUTH`, `PLATFORM_PERMISSION` | сервер не принял логин или не дал доступ. Сказать пользователю. Сессию, которую сервер закрыл за время простоя, клиент открывает заново сам: эта ошибка значит отказ в самом входе |

## Отказ сервера

`PLATFORM_SOAP-FAULT` или `PLATFORM_HTTP` с `details.status: 500` — сервер отказал и причину в ответе не назвал. Обычную причину подсказывает `hint`. Строка об отказе бывает в логе: `hcm_log_follow {file:"xhttp_ГГГГ-ММ-ДД.log"}`, см. [logs.md](logs.md). Она может быть короткой («Элемент не найден»), а после ошибки в тексте запроса её может не быть вовсе.

Частые причины: объекта с таким ID нет; файла по адресу нет; ошибка в тексте XQuery; имени каталога нет на сервере.

`PLATFORM_HTTP` без статуса или `PLATFORM_PROTOCOL` — нет связи с сервером или ответ не разобран. Проверь `hcm_status`, затем `hcm_check`: он показывает, какой шаг не проходит.

## Неверный вызов

| Код | Что делать |
| --- | --- |
| `mcp.invalid_arguments` | аргументы не подходят инструменту MCP; какие — в `details.validation` |
| `mcp.effect_mismatch` | операция вызвана не тем инструментом из `hcm_api_read`, `_write`, `_execute`: нужный назван в `hint` |
| `cli.invalid_input` | неверные аргументы команды: `wtctl help КОМАНДА` |
| `INVALID_ARGUMENT` | в `message` назван аргумент. Сверить с описанием инструмента или `hcm_api_describe` |
| `INVALID_IDENTIFIER`, `DUPLICATE_STEP` | имя каталога, поля или шага пакета (`as`): латинские буквы, цифры и `_`, первой не цифра; имена шагов не повторяются |
| `UNKNOWN_TYPE`, `UNKNOWN_CATALOG` | взять имя из `hcm_types` |
| `UNKNOWN_CATALOG_FIELD` | поля нет в каталоге: взять поле с `query:true` из `hcm_schema` или читать документ через `hcm_object_get` |
| `UNKNOWN_OPERATION`, `UNKNOWN_TOPIC` | взять ID из `hcm_api_list` |
| `UNKNOWN_RPC_TARGET` | такой функции или библиотеки на сервере нет: в `hint` — похожие имена; искать через `rpc.list` с `query` и `all:true` |
| `RPC_SERVER_ONLY` | функция вызывается только из кода на сервере: `hcm_script`, см. [scripts.md](scripts.md) |
| `INVALID_FILTER_OPERATOR`, `INVALID_FILTER_VALUE` | см. [queries.md](queries.md) |
| `INVALID_PATCH_PATH`, `PATCH_PATH_MISSING`, `PATCH_INDEX_MISSING`, `AMBIGUOUS_PATCH` | путь в `patch` или `remove` неверен, см. [objects.md](objects.md) |
| `INVALID_RPC_ARGUMENT` | аргумент функции задан неверно, см. [scripts.md](scripts.md) |

## Запись

| Код | Что случилось | Что делать |
| --- | --- | --- |
| `CONFLICT` | объект изменился после чтения; ничего не записано | прочитать заново и повторить |
| `UNKNOWN_FIELD` | у типа нет поля с таким именем; ничего не записано | взять имя из `hint` или из `hcm_schema` |
| `READ_BACK_MISMATCH` | документ сохранён, но поля из `details.fields` не приняли значение; что не совпало — в `details.differences` | проверить поля в `hcm_schema`, прочитать объект; заново не создавать. При удалении — объект остался в каталоге, см. [objects.md](objects.md) |
| `IMMUTABLE_ID` | попытка изменить `id` | ID не меняется |
| `TYPE_MISMATCH` | объект другого типа, чем указан | настоящий тип — в `details.actualType`; проверить `type` и ID |
| `TARGET_MISMATCH` | `id` и `url` указывают на разные объекты | передать `id` и `url` одного объекта или что-то одно |
| `DELETE_MODE_REQUIRED` | удаление без `permanent:true`; в MCP это `mcp.invalid_arguments` с `permanent` в `details.validation` | добавить `permanent:true`: корзины нет |
| `BATCH_FAILED` | шаг пакета не выполнен | номера и коды отказавших шагов — в `error.details.failed`, ответы всех шагов — в `data.results` (большой ответ сохранён, его читает `hcm_result_read`); выполненные шаги не откатываются |

## Код и запросы

| Код | Что делать |
| --- | --- |
| `SCRIPT_FAILED` | текст ошибки кода — в `details.scriptError`, см. [scripts.md](scripts.md) |
| `SCRIPT_RESPONSE` | код не присвоил `RESULT` массив или вернул то, что не передаётся (документ, структуру) |
| `QUERY_REPRESENTATION` | запрос XQuery вернул не строки каталога: закончить на `return $e` |

## Логи и результаты

| Код | Что делать |
| --- | --- |
| `LOG_READ_UNAVAILABLE` | сервер не отдал этот файл и со второй попытки: повторить через десять секунд или взять лог за прошлую дату |
| `LOG_NOT_FOUND` | взять имя файла из `hcm_logs_list` |
| `LOG_CHANGED` | лог дописан между страницами: начать заново |
| `INVALID_LOG_CURSOR` | начать `hcm_log_follow` без `cursor` |
| `RESULT_NOT_FOUND`, `INVALID_RESULT_ID` | сохранённого результата с таким ID нет: взять `meta.resultId` из ответа или повторить исходный вызов |
| `INVALID_RESULT_FORMAT` | у результата нет такой формы: `text` — для текста (лог, файл), `jsonl` — для списка, `json` подходит любому |

`INTERNAL_ERROR` — дефект клиента, а не ошибка в вызове: аргументы не подбирай, сообщи пользователю.

Неизвестный код: действуй по `hint`. Если запись могла пройти (`indeterminate`), сначала проверь состояние на сервере.
