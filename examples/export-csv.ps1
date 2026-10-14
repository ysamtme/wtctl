# Сотрудники в CSV постранично. Подключение то же, что у команды wtctl:
# файл подключений (wtctl config init) либо WTCTL_URL, WTCTL_USERNAME, WTCTL_PASSWORD.
# Работает в PowerShell 7 и Windows PowerShell 5.1:
#   .\examples\export-csv.ps1 -Path collaborators.csv
param(
  [string]$Path = 'collaborators.csv',
  [string]$Fields = 'id,fullname,hire_date'
)
$ErrorActionPreference = 'Stop'

# wtctl печатает в UTF-8; в консоли с кодовой страницей 866 кириллица иначе испортится.
[Console]::OutputEncoding = [Text.UTF8Encoding]::new()
# Предел ответа — наибольший, 1 МБ: 500 строк в 24 КБ по умолчанию не помещаются.
# Скрипт идёт в процессе оболочки, которая его вызвала: прежний предел возвращается в конце.
$limit = $env:WTCTL_OUTPUT_LIMIT_BYTES
$env:WTCTL_OUTPUT_LIMIT_BYTES = 1048576

$rows = @()
$start = 0
try {
  while ($null -ne $start) {
    $out = wtctl query --catalog collaborators --where '{\"is_dismiss\":false}' --fields $Fields --order id --limit 500 --start-position $start
    # Код 3: страница не поместилась, в ответе только её начало.
    if ($LASTEXITCODE -eq 3) { throw 'Страница не поместилась в ответ: уменьшить --limit.' }
    if ($LASTEXITCODE -ne 0) { throw "wtctl завершился с кодом ${LASTEXITCODE}: $out" }
    $page = ($out | ConvertFrom-Json).data
    # incomplete — страница, которую отвергла база данных, а не конец строк.
    if ($page.incomplete) { throw "Сервер отверг запрос: $($page.hint)" }
    $rows += $page.items
    $start = $page.nextStartPosition
  }
} finally {
  $env:WTCTL_OUTPUT_LIMIT_BYTES = $limit
}

# Без -Encoding UTF8 Windows PowerShell 5.1 пишет кириллицу знаками «?».
$rows | Export-Csv $Path -NoTypeInformation -Encoding UTF8
Write-Host "Строк: $($rows.Count), файл: $Path"
