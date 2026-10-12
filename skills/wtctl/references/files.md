# Файлы сервера и документ как XML

Файл на сервере задаётся адресом `x-local://…` — путь от папки установки сервера. Примеры: `x-local://wt/web/default.html`, `x-local://share/uploaded_files/…`.

Операции вызываются через `hcm_api_read` и `hcm_api_write` по ID. Аргументы одной операции показывает `hcm_api_describe {operationId:"…"}`.

## Файлы

| Действие | Вызов |
| --- | --- |
| Есть ли файл или папка | `hcm_api_read {operationId:"files.exists", args:{url:"x-local://wt/web/default.html"}}` → `{"exists":true}` |
| Прочитать | `hcm_api_read {operationId:"files.read", args:{url:"…"}}` → `{"text":"…","bytes":48}`; если файл не текст в UTF-8 — `{"base64":"…","bytes":6}`. С `encoding:"base64"` в ответе всегда `base64` |
| Записать текст | `hcm_api_write {operationId:"native.lds.putUrl", args:{url:"…", data:"текст файла"}}` |
| Записать двоичные данные | то же с `data:{base64:"AAECAwT/"}` |
| Удалить | `hcm_api_write {operationId:"native.lds.deleteUrl", args:{url:"…"}}` |
| Скопировать | `hcm_api_write {operationId:"web.pages.copyUrl", args:{srcUrl:"…", destUrl:"…"}}`; оба адреса — `x-local://…` |

Запись заменяет файл целиком, прежнее содержимое не сохраняется: чтобы дописать строку, прочитай файл и запиши его заново. Запись, копирование и удаление отвечают пустым значением; результат проверяй через `files.exists` и `files.read`. Чтение несуществующего файла даёт `PLATFORM_SOAP-FAULT` с HTTP 500: сначала проверь адрес через `files.exists`. Папку логов (`x-local://Logs/…`) сервер так не отдаёт: логи читают инструменты `hcm_log_*`.

Большой файл читай командой: `wtctl files read АДРЕС --output ФАЙЛ.json` сохраняет ответ на диск и не тратит контекст.

## Загрузка файла

`hcm_api_write {operationId:"web.pages.uploadFile", args:{filename:"report.txt", data:"…"}}` кладёт файл до 8 МБ в папку загрузок сервера. В ответе `url` — адрес файла (`x-local://share/uploaded_files/1244386602490721313/report.txt`), `folderUrl` — папка с номером, которую сервер создал для него. После удаления файла папку удаляют тем же `native.lds.deleteUrl`.

`data` — текст файла или `{base64:"…"}`. Двоичный или большой файл с диска этого компьютера загружает команда: `wtctl file upload report.pdf --input-file ./report.pdf`.

## Документ как XML

Обычно документ читают и правят через `hcm_object_get` и `hcm_object_patch`. Операции ниже нужны, когда нужен документ целиком в исходном виде.

- Адрес документа — поле `url` в ответе `hcm_object_get`, например `x-local://wt_data/objects/607999B973FFE0/44.xml`. Адрес существующего документа бери оттуда; как составить адрес для нового ID, см. [objects.md](objects.md), раздел «Создание».
- Прочитать текст XML: `hcm_api_read {operationId:"files.read", args:{url:"…"}}` → `{"text":"<group SPXML-FORM=\"x-local://wtv/wtv_group.xmd\"><id>…</id>…</group>"}`. Как записаны значения в тексте, зависит от базы данных сервера: логическое поле бывает `false` и `0`, отступы и заголовок `<?xml …?>` есть не везде.
- Прочитать разобранным в JSON: `hcm_api_read {operationId:"native.lds.loadDoc", args:{url:"…"}}`. Документ приходит в `data.Data.<тип>`. Повторяемый элемент из одного элемента здесь объект, а не список. Даты здесь и в тексте XML записаны со смещением `+00:00`: это местное время сервера.
- Сохранить: `hcm_api_write {operationId:"native.lds.putDoc", args:{url:"…", data:"<group>…</group>"}}`. `data` — текст XML всего документа: он заменяет документ целиком. `neverSaved:true` — документ записывается впервые. С `writeDocInfo:true` сервер обновляет дату и автора изменения; без него они остаются как в тексте, и поиск по `modification_date` правку не видит. Чужую правку операция не замечает: `fingerprint` из `hcm_object_get` сверяй до записи сами. Чтобы изменить несколько полей, используй `hcm_object_patch`.
- Создать из готового XML: `native.physicalDocuments.createFromXml`. Удалить: `native.lds.deleteDoc`.
