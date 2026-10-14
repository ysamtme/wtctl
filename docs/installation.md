# Установка

Агенту нужны MCP-сервер `wtctl` с инструментами `hcm_*` и гайд по работе с ними. Поставить их можно двумя способами:

- **Плагин.** Ставит MCP-сервер и навык (skill) с гайдом. Основной способ для Claude Code и Codex.
- **Только MCP-сервер.** Для приложений без плагинов. Гайд MCP-сервер отдаёт сам, инструментом `hcm_guide`.

Шаг 1 общий для всех вариантов. На сервер HCM ничего ставить не нужно.

## Что нужно

- Node.js 22.16 или новее. Версию покажет `node --version`. Команды `node` и `npx` должны быть в `PATH`, с которым запускается приложение.
- git: через него Claude Code и Codex скачивают плагин.
- Учётная запись, которую сервер HCM пускает в админку.

## Шаг 1. Подключение к серверу HCM

```shell
npx -y wtctl config init
```

`npx` скачивает пакет `wtctl` из npm и запускает его CLI, заранее ничего ставить не нужно. Команда спросит адрес сервера, логин и пароль и сохранит подключение в `~/.wtctl/connections.json` (в Windows это `C:\Users\ИМЯ\.wtctl\connections.json`). Файл один на компьютер: его читают и MCP-сервер в любом приложении, и CLI, и SDK, из какой бы папки они ни запускались.

Новое подключение умеет только читать. Как включить запись и выполнение кода, добавить второй сервер HCM или создать подключение без вопросов в терминале, написано в [configuration.md](configuration.md#создание-подключения).

Пароль лежит в файле открытым текстом. Его можно держать в переменной окружения и записать в файл только её имя: `--password-env WTCTL_PASSWORD`. Тогда эту переменную должен видеть и процесс MCP-сервера. Codex передаёт MCP-серверам только названные переменные, поэтому с плагином в Codex пароль хранится в файле.

Проверка подключения:

```shell
npx -y wtctl check
```

`check` идёт по шагам: вход, версия, запрос к каталогу, чтение документа, поля типа, библиотеки, логи, портал и другие. На сервер он ничего не пишет. Если шаг не прошёл, в ответе будет причина; частые отказы разобраны [ниже](#если-не-получилось).

Чтобы писать просто `wtctl`, пакет ставится глобально:

```shell
npm install -g wtctl
```

В остальной документации CLI так и пишется: `wtctl check`. Без глобальной установки это `npx -y wtctl check`.

## Шаг 2. Установка в приложение

Нужен один вариант из трёх.

| Приложение | Вариант |
| --- | --- |
| Claude Code, Codex | А. Плагин |
| Cursor, VS Code с Copilot, Copilot CLI, Gemini CLI | Б. Плагин, не проверено |
| Любое приложение с поддержкой MCP | В. Только MCP-сервер |

Плагин и отдельный MCP-сервер в одном приложении не нужны: агент увидит два MCP-сервера и два навыка. Если MCP-сервер `wtctl` уже добавлен в конфиг приложения вручную или навык `wtctl` уже лежит отдельной папкой (`~/.claude/skills/wtctl`, `~/.agents/skills/wtctl`), перед установкой плагина их нужно убрать.

### Вариант А. Плагин в Claude Code и Codex

Claude Code:

```shell
claude plugin marketplace add ysamtme/wtctl
claude plugin install wtctl@wtctl
```

Codex:

```shell
codex plugin marketplace add ysamtme/wtctl
codex plugin add wtctl@wtctl
```

Первая команда запоминает репозиторий как источник плагинов с именем `wtctl`. Вторая скачивает собранный плагин и включает его.

В Claude Code плагин ставится для пользователя: он появится и в терминале, и в десктопном приложении, и в расширении VS Code. В чате те же команды пишутся как `/plugin marketplace add ysamtme/wtctl` и `/plugin install wtctl@wtctl`.

Навык из плагина в обоих приложениях называется `wtctl:wtctl`.

#### Только в нужных проектах

Навык и MCP-сервер плагина занимают часть контекста в каждом чате, даже там, где wtctl не нужен. Если он нужен в нескольких проектах, плагин можно включить только в них.

Claude Code. Команда выполняется в папке проекта:

```shell
claude plugin install wtctl@wtctl --scope local
```

Отметка о включении записывается в `.claude/settings.local.json` проекта и в git не попадает. В остальных папках плагин выключен. Если плагин уже стоит для пользователя, он выключается для всех папок, затем включается в папке каждого проекта:

```shell
claude plugin disable wtctl@wtctl --scope user
claude plugin enable wtctl@wtctl --scope local
```

`--scope local` действует только в основной папке проекта, в его worktree плагин выключен. Для worktree и для всех участников проекта подходит `--scope project`: отметка записывается в `.claude/settings.json` и попадает в git вместе с проектом. Каждому участнику после клонирования нужно один раз выполнить `claude plugin marketplace add ysamtme/wtctl` и `claude plugin install wtctl@wtctl --scope project`.

Codex. Плагин ставится как обычно и выключается в `~/.codex/config.toml`:

```toml
[plugins."wtctl@wtctl"]
enabled = false
```

В `.codex/config.toml` проекта пишется та же запись с `enabled = true`. Конфиг проекта Codex читает, только если проект доверенный. Повторный `codex plugin add` (так плагин и обновляется) снова ставит `enabled = true` в `~/.codex/config.toml`, после него запись нужно вернуть.

### Вариант Б. Плагин в других приложениях

В собранном пакете есть описание плагина по открытому стандарту Agent Plugins 1.0 (`plugin.json`, `mcp.json`, `skills/`) и описание для Gemini CLI (`gemini-extension.json`). Установка в этих приложениях не проверялась, способы взяты из их документации.

Gemini CLI ставит плагин из репозитория:

```shell
gemini extensions install https://github.com/ysamtme/wtctl --ref plugin
```

Остальным нужна [папка пакета](#установка-из-папки) на диске.

| Приложение | Как указать папку |
| --- | --- |
| Cursor | Копия папки в `~/.cursor/plugins/local/wtctl`. Ссылку на папку в другом месте Cursor пропускает. |
| VS Code с Copilot | Настройка `chat.pluginLocations`: `{"ПАПКА": true}`. |
| Copilot CLI | `copilot plugin install ПАПКА` |

<details>
<summary>Только в нужных проектах (по документации приложений, не проверено)</summary>

- Gemini CLI: `gemini extensions disable wtctl`, затем в папке проекта `gemini extensions enable wtctl --scope workspace`. Правила хранятся в `~/.gemini/extensions/extension-enablement.json`. В Windows отключение для пользователя действует только на папки внутри домашней; для проектов на другом диске расширение отключается командой `gemini extensions disable wtctl --scope workspace` в корне этого диска.
- VS Code с Copilot: Extensions → Agent Plugins - Installed, в меню плагина Disable, затем в нужном проекте Enable (Workspace). `chat.pluginLocations` действует только в настройках пользователя, в `.vscode/settings.json` проекта — нет.
- Copilot CLI: `copilot plugin disable wtctl`, затем `enabledPlugins` в настройках репозитория: `.github/copilot/settings.json` (попадает в git) или `.github/copilot/settings.local.json` (личный). На один сеанс плагин подключает `copilot --plugin-dir=ПАПКА`.
- Cursor: для плагина из `~/.cursor/plugins/local` включения по проектам нет. Плагин можно подключать hook-ом `workspaceOpen`: он получает папки проекта и возвращает пути плагинов ([документация Cursor](https://cursor.com/docs/hooks)).

</details>

### Вариант В. Только MCP-сервер

MCP-сервер добавляется в конфиг приложения:

```json
{
  "mcpServers": {
    "wtctl": {
      "command": "npx",
      "args": ["-y", "wtctl", "mcp"]
    }
  }
}
```

В Claude Code и Codex то же делает команда:

```shell
claude mcp add --scope user wtctl -- npx -y wtctl mcp
```

```shell
codex mcp add wtctl -- npx -y wtctl mcp
```

Через `npx` MCP-сервер стартует около секунды: перед запуском `npx` сверяется с npm. После `npm install -g wtctl` в конфиге можно написать `"command": "wtctl", "args": ["mcp"]`, тогда сеть при старте не нужна.

Навыка в этом варианте нет. Агент читает гайд через `hcm_guide`. Навык можно положить отдельно: скопировать папку [skills/wtctl](../skills/wtctl/SKILL.md) в папку навыков приложения.

## Шаг 3. Проверка

- Claude Code: `claude mcp list`. В списке должен быть MCP-сервер с пометкой `Connected`. Из плагина он называется `plugin:wtctl:wtctl`.
- Codex: `codex mcp list`. В списке должен быть MCP-сервер `wtctl`. Запускается ли он, эта команда не проверяет.

Затем в новом чате попросить агента вызвать `hcm_status`. В ответе должны быть версия сервера HCM и права подключения.

MCP-сервер запускается и без подключения. В этом случае его инструменты отвечают, чего не хватает, и подсказывают готовую команду для терминала. Пока подключения нет, он перечитывает конфиг при каждом вызове, так что после `config init` перезапускать приложение не нужно.

## Если не получилось

Инструментов `hcm_*` в чате нет:

- Плагин и MCP-сервер появляются в новом чате. Чаты, открытые до установки, их не видят.
- `claude mcp list` показывает, запустился ли MCP-сервер. Если нет, нужно проверить `node --version` в том окружении, из которого запускается приложение: Node.js должен быть 22.16 или новее, а `node` и `npx` — в `PATH`.
- Инструменты видны дважды — в приложении стоят и плагин, и отдельный MCP-сервер. Один из них нужно убрать.

Инструменты или команды отвечают ошибкой. Причина — в `error.code`:

| Ответ | Что это значит |
| --- | --- |
| `NOT_CONFIGURED` | подключения нет: нужен `wtctl config init` или переменные `WTCTL_URL`, `WTCTL_USERNAME`, `WTCTL_PASSWORD` |
| `PLATFORM_HTTP`, «Сервер … не отвечает» | причина в `message`: соединение отклонено, имя не найдено, сертификат, таймаут. Проверить адрес и запущен ли сервер HCM |
| `PLATFORM_AUTH` | сервер HCM не пустил: неверный логин или пароль, либо этой учётной записи закрыт вход в админку |
| `UNKNOWN_CONNECTION` | подключения с таким именем в файле нет; `message` говорит, откуда взято имя, в `hint` — подключения, которые есть |
| `WRITE_DISABLED`, `EXECUTE_DISABLED` | у подключения выключено это право: [как включить](configuration.md#права) |

Какой файл подключений читается, покажет `wtctl config path`. На каком шаге проблема, покажет `wtctl check`.

## Другое подключение

Один MCP-сервер работает с одним подключением. MCP-сервер из плагина берёт подключение по умолчанию.

Чтобы агент видел второй сервер HCM, в конфиг приложения добавляется ещё один MCP-сервер с другим именем, например `wtctl-prod`. Подключение указывается перед `mcp`: `npx -y wtctl --connection prod mcp`.

На боевом сервере `write` и `execute` стоит включать, только когда они нужны.

### Подключение для одного проекта

Codex. В `.codex/config.toml` доверенного проекта добавляется MCP-сервер с тем же именем `wtctl`. В этом проекте он заменяет MCP-сервер из плагина.

```toml
[mcp_servers.wtctl]
command = "npx"
args = ["-y", "wtctl", "--connection", "prod", "mcp"]
```

Claude Code. MCP-сервер добавляется в проект командой из папки проекта:

```shell
claude mcp add --scope project wtctl-prod -- npx -y wtctl --connection prod mcp
```

Команда записывает его в файл `.mcp.json` в папке проекта. При первом запуске в этом проекте Claude Code спрашивает разрешение на MCP-сервер из `.mcp.json`. MCP-сервер из плагина при этом не заменяется, даже при одинаковом имени: в Claude Code он называется `plugin:wtctl:wtctl`, и в проекте работают оба. Поэтому MCP-серверу проекта нужно другое имя, по которому агент отличит подключение.

## Без файла подключений

Подключение можно задать переменными окружения MCP-сервера. Сам он при этом добавляется как в варианте В:

```shell
claude mcp add --scope user wtctl --env WTCTL_URL=http://localhost:8088 --env WTCTL_USERNAME=user1 --env WTCTL_PASSWORD=… -- npx -y wtctl mcp
```

```shell
codex mcp add wtctl --env WTCTL_URL=http://localhost:8088 --env WTCTL_USERNAME=user1 --env WTCTL_PASSWORD=… -- npx -y wtctl mcp
```

Права включаются переменными `WTCTL_ALLOW_WRITE=true` и `WTCTL_ALLOW_EXECUTE=true`.

Пароль при этом остаётся в конфиге приложения и в истории терминала. CLI и скрипты на SDK этих переменных не видят: им нужен файл подключений или те же переменные в своём окружении.

## Гайд для агента

Как работать, примеры вызовов и разбор ошибок агент берёт у MCP-сервера:

- `hcm_guide` без аргументов — обзор и список тем;
- `hcm_guide {topic:"queries"}` — одна тема.

Тот же текст печатает `wtctl guide`.

Тема `cli-sdk` заканчивается разделом «На этом компьютере». В нём путь к Node.js, путь к файлу CLI, адрес для импорта SDK и способ взять то же подключение, что у MCP-сервера. С этими данными агент может вызвать CLI и написать скрипт, даже если `wtctl` нет в `PATH`.

С плагином тот же текст приходит ещё и навыком: агент открывает его сам, когда берётся за задачу с сервером HCM.

## CLI и SDK без агента

CLI — команда `wtctl` после `npm install -g wtctl` или `npx -y wtctl` без установки: [cli.md](cli.md).

SDK ставится в свой проект:

```shell
npm install wtctl
```

После этого работает `import … from "wtctl"`, а CLI в этом проекте вызывается как `npx wtctl`. Зависимостей пакет за собой не тянет: [sdk.md](sdk.md).

## Обновление

Что изменилось в версии, написано в [CHANGELOG](../CHANGELOG.md).

**Claude Code.**

```shell
claude plugin update wtctl@wtctl
```

Новая версия заработает в новом чате. Чтобы плагин обновлялся сам, в чате открыть `/plugin`, на вкладке Marketplaces выбрать `wtctl` и включить Enable auto-update.

**Codex.** Повторить `codex plugin add wtctl@wtctl`. Codex хранит свою копию плагина и сам её не обновляет. В Windows перед этим нужно закрыть сеансы Codex: пока MCP-сервер плагина запущен, его копия занята.

**Пакет из npm.** Глобально установленный обновляется командой `npm install -g wtctl@latest`. `npx` берёт новую версию сам.

## Удаление

- Плагин в Claude Code:

  ```shell
  claude plugin uninstall wtctl@wtctl
  claude plugin marketplace remove wtctl
  ```

  Плагин, установленный с `--scope local` или `--scope project`, удаляется из папки проекта командой `uninstall` с тем же `--scope`.

- Плагин в Codex:

  ```shell
  codex plugin remove wtctl@wtctl
  codex plugin marketplace remove wtctl
  ```

- Глобальный пакет, если он ставился: `npm uninstall -g wtctl`.
- Папка `~/.wtctl`: в ней лежат файл подключений и сохранённые большие ответы.

## Установка из папки

Запасной способ: без npm и для приложений, которым плагин указывают папкой. Собранный пакет лежит в ветке `plugin` репозитория:

```shell
git clone --branch plugin https://github.com/ysamtme/wtctl.git ПАПКА
```

`ПАПКА` — полный путь к этой папке. Ей нужно постоянное место: приложения запускают MCP-сервер прямо из неё. Зависимостей у пакета нет, `npm install` не нужен.

- CLI: `node ПАПКА/dist/cli/bin.js`, например `node ПАПКА/dist/cli/bin.js config init`.
- Плагин: `claude plugin marketplace add ПАПКА` и `codex plugin marketplace add ПАПКА`, дальше как в варианте А. Claude Code читает плагин прямо из папки.
- Только MCP-сервер: `"command": "node", "args": ["ПАПКА/dist/cli/bin.js", "mcp"]`. В JSON обратные слэши пути Windows нужно удваивать: `C:\\tools\\wtctl\\dist\\cli\\bin.js`.
- SDK: `npm install ПАПКА` в своём проекте.
- Обновление: `git -C ПАПКА pull`, затем новый чат в Claude Code и повторный `codex plugin add wtctl@wtctl` в Codex.
