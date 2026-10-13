# Сведения о сервере и проверка служб

Всё на этой странице только читает: права `write` и `execute` не нужны.

## Версия и права

`wtctl status` (инструмент `hcm_status`, метод `status()`) — версия сервера, база данных (`database`, как в `server info`) и права подключения.

`wtctl check` (`hcm_check`, `check()`) — проверка по шагам, см. [configuration.md](configuration.md#проверка-подключения).

## Сведения о сервере

```shell
wtctl server info
```

В MCP: `hcm_api_read {operationId:"server.info"}`. В SDK: `client.serverInfo()`.

```json
{
  "profile": "native",
  "versionServer": "2025.2.1535 (2026-09-25)",
  "osType": "windows",
  "capabilityMask": "118039011",
  "database": "mssql",
  "catalogLimits": [{ "objectTypeName": "collaborator", "maxRecordsNum": "250" }],
  "dataFolders": ["share", "wt_data", "trash"],
  "codeFolders": ["wt", "wtv", "custom"]
}
```

| Поле | Значение |
| --- | --- |
| `versionServer` | версия установленной поставки и её дата |
| `osType` | `windows` или `linux` |
| `capabilityMask` | набор флагов, которыми сервер описывает возможности своей базы; передаётся в том виде, в каком прислал сервер: на MS SQL запись десятичная, на PostgreSQL — шестнадцатеричная (`0x00000002070821E3`) |
| `database` | база данных сервера, выведена из `capabilityMask`: `mssql`, `postgresql`, `oracle`, `azure`, `xml` (файловая) или `other` |
| `catalogLimits` | ограничения на число записей по типам объектов, которые сервер объявляет при запуске |
| `dataFolders`, `codeFolders` | папки, в которые `files.write` пишет под правом `write`, и папки кода, где нужны `write` и `execute`; списки сервер сообщает сам, порядок — как у сервера |

Как определяется `database`: `mssql`, `oracle`, `azure` и `xml` — теми же флагами, по которым тип базы показывает сам сервер. У PostgreSQL такого флага нет, значение `postgresql` выводится по признаку, наблюдавшемуся на 2025.1.1171 — 2025.2.1535. Проверено на MS SQL, PostgreSQL и файловой базе.

Числа приходят строками. Это те же сведения, которые сервер отдаёт админке при её запуске.

## Служба WebSocket

```shell
wtctl ws heartbeat
```

В MCP: `hcm_api_read {operationId:"web.websocket.heartbeat"}`. В SDK: `client.heartbeat()`.

Команда открывает соединение со службой `/services/main_ws_service`, отправляет служебное сообщение, ждёт ответ и закрывает соединение. `heartbeatObserved: true` значит, что служба ответила. Остальные поля описывают, как закрылось соединение. `warning: "PEER_CLOSE_ACK_NOT_OBSERVED"` при успешном ответе — не ошибка: сервер закрыл соединение без подтверждения.

`--timeout-ms` задаёт таймаут от 250 до 10000 мс, по умолчанию 5000.

Ошибки: `WS_AUTHENTICATION_REQUIRED` и `WS_PERMISSION_DENIED` — сервер не принял учётную запись; `WS_HANDSHAKE_FAILED` — служба не открыла соединение; `WS_HEARTBEAT_FAILED` — служба не успела ответить до таймаута.

## Портал

`hcm_api_read {operationId:"anonymous.diagnostics.portal"}` показывает, отвечает ли портал: `{"status":200}`. То же проверяет шаг `portal` в `check`.

## Служебная страница сервера

`hcm_api_read {operationId:"anonymous.diagnostics.xhttpInfo"}` отдаёт страницу `/xhttp_info` — HTML со сведениями о сборке сервера.
