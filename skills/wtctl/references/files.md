# Файлы сервера и документ как XML

Файл на сервере задаётся адресом `x-local://…` — путь от папки установки сервера. Примеры: `x-local://wt/web/default.html`, `x-local://share/uploaded_files/…`.

Операции вызываются по ID через `hcm_api_read`, `hcm_api_write` и `hcm_api_execute`. Аргументы одной операции показывает `hcm_api_describe {operationId:"…"}`.

## Файлы

| Действие | Вызов |
| --- | --- |
| Есть ли файл или папка | `hcm_api_read {operationId:"files.exists", args:{url:"x-local://wt/web/default.html"}}` → `{"exists":true}` |
| Прочитать | `hcm_api_read {operationId:"files.read", args:{url:"…"}}` → `{"text":"…","bytes":48}`; если файл не текст в UTF-8 или в нём есть управляющие байты — `{"base64":"…","bytes":6}`. С `encoding:"base64"` в ответе всегда `base64` |
| Список папки | `hcm_api_execute {operationId:"files.list", args:{url:"x-local://wt/web"}}` → `{"items":[{"name":"default.html","bytes":48},{"name":"img","folder":true}],"total":2}`. С `search:"default"` в ответе только имена с этой частью: так узнаётся и размер одного файла |
| Записать текст | `hcm_api_write {operationId:"files.write", args:{url:"…", text:"текст файла"}}` → `{"bytes":21,"mutationOutcome":"confirmed"}` |
| Записать двоичные данные | то же с `base64:"AAECAwT/"` вместо `text` |
| Удалить | `hcm_api_write {operationId:"files.delete", args:{url:"…"}}` |

Текст записывается в UTF-8 как есть. Запись заменяет файл целиком, прежнее содержимое не сохраняется: чтобы дописать строку, прочитай файл и запиши его заново. Копия делается так же: прочитай файл и запиши по новому адресу. Вложенные папки сервер создаёт сам.

Куда можно писать, зависит от папки — первой части адреса после `x-local://`. Способ записи операция выбирает сама:

- папки данных (обычно `share`, `source`, `wt_data`, `trash`): хватает права `write`; `files.delete` удаляет и пустую папку, на непустую сервер отвечает отказом;
- папки кода (`wt`, `wtv`, `applications`, `custom` и другие): файл записывает и удаляет код на сервере, поэтому нужны оба права, `write` и `execute`; текст — до 750 КБ, двоичные данные — до 580 КБ; удаляется только файл, пустая папка остаётся;
- остальные адреса, например `x-local://Logs/…`: операция отказывает до отправки и называет папки, которые запись принимают.

Списки папок подключённого сервера: `hcm_api_read {operationId:"server.info"}` → `dataFolders`, `codeFolders`.

`files.list` показывает один уровень папки и требует права `execute`: список даёт только код на сервере. Штатная функция `tools.read_directory_server` для этого не подходит: на версиях 2025.1.1171–2025.2.1535 она отвечает `Prohibited by security policy`.

Чтение несуществующего файла даёт `PLATFORM_SOAP-FAULT` с HTTP 500: сначала проверь адрес через `files.exists`. Папку логов (`x-local://Logs/…`) сервер так не отдаёт: логи читают инструменты `hcm_log_*`.

Большой файл читай командой: `wtctl files read АДРЕС --output ФАЙЛ.json` сохраняет ответ на диск и не тратит контекст.

## Загрузка файла

`hcm_api_write {operationId:"web.pages.uploadFile", args:{filename:"report.txt", data:"…"}}` кладёт файл до 8 МБ в папку загрузок сервера. В ответе `url` — адрес файла (`x-local://share/uploaded_files/1244386602490721313/report.txt`), `folderUrl` — папка с номером, которую сервер создал для него. Вместе с файлом папка не исчезает: её удаляет отдельный вызов `files.delete` с адресом из `folderUrl`.

`data` — текст файла или `{base64:"…"}`. Двоичный или большой файл с диска этого компьютера загружает команда: `wtctl file upload report.pdf --input-file ./report.pdf`.

## Документ как XML

Обычно документ читают и правят через `hcm_object_get` и `hcm_object_patch`. Операции ниже нужны, когда нужен документ целиком в исходном виде.

- Адрес документа — поле `url` в ответе `hcm_object_get`, например `x-local://wt_data/objects/607999B973FFE0/44.xml`. Адрес существующего документа бери оттуда; как составить адрес для нового ID, см. [objects.md](objects.md), раздел «Создание».
- Прочитать текст XML: `hcm_api_read {operationId:"files.read", args:{url:"…"}}` → `{"text":"<group SPXML-FORM=\"x-local://wtv/wtv_group.xmd\"><id>…</id>…</group>"}`. Как записаны значения в тексте, зависит от базы данных сервера: логическое поле бывает `false` и `0`, отступы и заголовок `<?xml …?>` есть не везде.
- Прочитать разобранным в JSON: `hcm_api_read {operationId:"native.lds.loadDoc", args:{url:"…"}}`. Документ приходит в `data.Data.<тип>`. Повторяемый элемент из одного элемента здесь объект, а не список. Даты здесь и в тексте XML записаны со смещением `+00:00`: это местное время сервера.
- Сохранить: `hcm_api_write {operationId:"native.lds.putDoc", args:{url:"…", data:"<group>…</group>"}}`. `data` — текст XML всего документа: он заменяет документ целиком. `neverSaved:true` — документ записывается впервые. С `writeDocInfo:true` сервер обновляет дату и автора изменения; без него они остаются как в тексте, и поиск по `modification_date` правку не видит. Чужую правку операция не замечает: `fingerprint` из `hcm_object_get` сверяй до записи сами. Чтобы изменить несколько полей, используй `hcm_object_patch`.
- Создать из готового XML: `native.physicalDocuments.createFromXml`. Удалить: `native.lds.deleteDoc`.
