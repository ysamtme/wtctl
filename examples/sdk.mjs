// Список сотрудников. Подключение то же, что у команды wtctl:
// файл подключений (wtctl config init) либо WTCTL_URL, WTCTL_USERNAME, WTCTL_PASSWORD.
import { loadConfig, withHcmClient } from 'wtctl';

// Страница в 500 строк не помещается в предел ответа по умолчанию (24 КБ), поэтому он поднят до наибольшего.
const config = loadConfig({ settings: { outputLimitBytes: 1024 * 1024 } });

await withHcmClient(config, async (client) => {
  // queryRows сам листает страницы; отвергнутая базой данных страница — ошибка, а не конец строк.
  const rows = client.queryRows({
    catalog: 'collaborators',
    where: { is_dismiss: false },
    fields: ['id', 'fullname'],
    order: ['id'],
    limit: 500,
  });
  for await (const row of rows) console.log(row.id, row.fullname);
});
