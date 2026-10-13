// Загружается перед каждым файлом тестов: тесты не должны читать собственную папку клиента разработчика.
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.WTCTL_HOME = join(tmpdir(), "wtctl-tests-home");
