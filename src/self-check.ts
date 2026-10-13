import type { ConnectionConfig } from "./contracts.js";
import { HcmError, inputObject, requiredString } from "./errors.js";
import { WsHcmApiError } from "./protocol/error.js";
import { languageFileUrl } from "./schema.js";
import { platformFailure } from "./platform-errors.js";

export interface CheckData {
  version?: string;
  language?: string;
  permissions: ConnectionConfig["permissions"];
  checks: { name: string; result: "ok" | "failed" | "skipped"; reason?: string }[];
  summary: { ok: number; failed: number; skipped: number };
}
type Invoke = (id: string, args: Record<string, unknown>) => Promise<unknown>;

/** Фиксированные пробы не сохраняют в отчёте ни payload сервера, ни тексты ошибок. */
export async function checkServer(config: ConnectionConfig, invoke: Invoke): Promise<CheckData> {
  const report: CheckData = {
    permissions: config.permissions,
    checks: [],
    summary: { ok: 0, failed: 0, skipped: 0 },
  };
  let info: Record<string, unknown> = {};
  const rows = (value: unknown): Record<string, unknown>[] =>
    Array.isArray(value) ? value.filter((v) => v && typeof v === "object") : [];
  const text = (value: unknown, max = 128): string => {
    const result = requiredString(value, "ответ проверки");
    if (result.length > max) throw new Error();
    return result;
  };
  const probe = async (
    name: string,
    id: string,
    args = {},
    accept = (_: unknown): void => {},
  ): Promise<void> => {
    const skipped =
      name !== "login" && report.checks[0]?.result === "failed"
        ? "сессия не открыта"
        : name === "execute" && !config.permissions.execute
          ? "выполнение кода не разрешено подключением"
          : undefined;
    if (skipped) {
      report.checks.push({ name, result: "skipped", reason: skipped });
      return;
    }
    // Каждый запрос уже ограничен транспортом; это ограничивает пробу из нескольких запросов.
    let late = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          late = true;
          reject(new Error());
        }, config.timeoutMs);
      });
      const pending = invoke(id, args);
      pending.catch(() => {});
      accept(await Promise.race([pending, timeout]));
      report.checks.push({ name, result: "ok" });
    } catch (error) {
      const status = error instanceof WsHcmApiError ? error.status : undefined;
      // Первый шаг — там, где проявляется неверный адрес, остановленный сервер или неверный пароль.
      const explained =
        error instanceof WsHcmApiError && (name === "login" || status === undefined)
          ? platformFailure(error, config.baseUrl)
          : undefined;
      const reason = late
        ? "превышено время проверки"
        : status === 500 && name === "portal"
          ? "HTTP 500: проверить порт в объекте «хост» и адрес подключения"
          : explained
            ? [explained.message, explained.hint].filter(Boolean).join(" ")
            : status !== undefined
              ? `HTTP ${status}`
              : error instanceof HcmError
                ? `проверка не пройдена: ${error.code}`
                : "проверка не пройдена";
      report.checks.push({ name, result: "failed", reason });
    } finally {
      clearTimeout(timer);
    }
  };
  await probe("login", "native.session.open", {}, (v) => {
    if (inputObject(v).opened !== true) throw new Error();
  });
  await probe("version", "runtime.status", {}, (v) => {
    report.version = text(inputObject(v).version);
  });
  await probe("appInfo", "native.spxml2.getAppInfo", { fastStart: true }, (v) => {
    info = inputObject(v);
    if (typeof info.ui_lang_id === "string") report.language = text(info.ui_lang_id, 16);
    const database = rows(info.databases).find((db) => db.id === text(info.default_db_name));
    if (!rows(database?.catalogs).length) throw new Error();
  });
  await probe("query", "runtime.query", { catalog: "collaborators", limit: 1, fields: ["id"] });
  await probe("document", "objects.get", {
    url: rows(info.shared_docs).find((doc) => doc.id === "custom_templates")?.url,
  });
  await probe("schema", "schema.get", { type: "collaborator", cursor: 0 }, (v) => {
    const fields = rows(inputObject(v).fields);
    if (!fields.length || !fields.some((f) => String(f.origin).startsWith("inherited:")))
      throw new Error();
  });
  await probe("titles", "objects.get", { url: languageFileUrl(info.ui_lang_id) });
  await probe("libraries", "rpc.list", { library: "tools", limit: 1 }, (v) => {
    if (inputObject(v).source !== "server") throw new Error();
  });
  await probe("logs", "logs.list", { limit: 1 });
  await probe("portal", "anonymous.diagnostics.portal", {}, (v) => {
    const status = Number(inputObject(v).status);
    if (!Number.isInteger(status) || status < 100 || status > 599) throw new Error();
    if (status >= 500) throw new WsHcmApiError("http", "Ошибка портала", { status });
  });
  await probe("execute", "execute.script", { code: "RESULT = [1 + 1];" }, (v) => {
    const result = inputObject(v).result;
    if (!Array.isArray(result) || result.length !== 1 || String(result[0]) !== "2")
      throw new Error();
  });
  for (const { result } of report.checks) report.summary[result]++;
  return report;
}
