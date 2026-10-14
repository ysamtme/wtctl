// Список сотрудников постранично. Подключение то же, что у команды wtctl:
// файл подключений (wtctl config init) либо WTCTL_URL, WTCTL_USERNAME, WTCTL_PASSWORD.
import { loadConfig, withHcmClient, unwrap } from 'wtctl';

// Скрипту нужен ответ целиком, поэтому предел размера ответа поднят до наибольшего.
const config = loadConfig({ settings: { outputLimitBytes: 1024 * 1024 } });

await withHcmClient(config, async (client) => {
  let startPosition = 0;
  while (startPosition !== undefined) {
    const page = unwrap(
      await client.query({
        catalog: 'collaborators',
        where: { is_dismiss: false },
        fields: ['id', 'fullname'],
        order: ['id'],
        limit: 500,
        startPosition,
      }),
    );
    for (const row of page.items) console.log(row.id, row.fullname);
    startPosition = page.nextStartPosition;
  }
});
