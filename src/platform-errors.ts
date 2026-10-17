import { WsHcmApiError } from "./protocol/error.js";
import type { NetworkFailure } from "./protocol/transport.js";

export interface FailureText {
  readonly message: string;
  readonly hint?: string;
}

/** Сервер отвечает на каждый отказ голым HTTP 500; причина попадает только в его лог. */
function refusalHint(cause: string | undefined): string {
  return `${cause ? `Обычная причина: ${cause}. ` : ""}Причину сервер в ответе не сообщает. Строка о ней может быть в логе xhttp за сегодня (последние строки показывает logs.follow); отклонённый запрос часто строки не оставляет.`;
}

const ADDRESS_HINT =
  "Проверить адрес и порт подключения: WTCTL_URL или baseUrl в файле подключений.";
function network(reason: NetworkFailure, address: string, host: string): FailureText {
  switch (reason) {
    case "refused":
      return {
        message: `Сервер ${address} не отвечает: соединение отклонено.`,
        hint: `Проверить, что сервер запущен. ${ADDRESS_HINT}`,
      };
    case "unknown_host":
      return { message: `Адрес сервера не найден: ${host}.`, hint: ADDRESS_HINT };
    case "unreachable":
      return { message: `Сервер ${address} недоступен по сети.`, hint: ADDRESS_HINT };
    case "certificate":
      return {
        message: `Сертификат сервера ${address} не прошёл проверку.`,
        hint: "Если сертификат выпущен внутренним центром сертификации, нужно указать его корневой сертификат в переменной NODE_EXTRA_CA_CERTS.",
      };
    case "tls":
      return {
        message: `Не удалось установить защищённое соединение с ${address}.`,
        hint: "Проверить схему в адресе подключения: https для защищённого порта, http для обычного.",
      };
    case "not_http":
      return { message: `По адресу ${address} отвечает не сервер HTTP.`, hint: ADDRESS_HINT };
    case "redirect":
      return {
        message: `Сервер ${address} перенаправляет запросы на другой адрес.`,
        hint: "Нужно указать в подключении конечный адрес сервера, например с https вместо http.",
      };
    case "timeout":
      return {
        message: `Сервер ${address} не ответил за отведённое время.`,
        hint: "Проверить, что сервер работает. Для долгих операций увеличить timeoutMs подключения.",
      };
    case "reset":
      return {
        message: `Соединение с ${address} оборвалось.`,
        hint: "Проверить, что сервер работает, и повторить.",
      };
    case "aborted":
      return { message: `Запрос к ${address} прерван.` };
    default:
      return {
        message: `Запрос к ${address} не выполнен: нет связи с сервером.`,
        hint: `Проверить, что сервер запущен. ${ADDRESS_HINT}`,
      };
  }
}

/**
 * Что значит неудавшийся обмен с сервером для того, кто настраивал подключение. indeterminate —
 * запрос на запись или код ушёл и исход не определён: совет повторить без проверки неверен.
 */
export function platformFailure(
  error: WsHcmApiError,
  baseUrl: string,
  usualCause?: string,
  indeterminate = false,
): FailureText {
  let address = baseUrl.replace(/\/+$/, "");
  let host = address;
  try {
    const url = new URL(baseUrl);
    address = `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
    host = url.hostname;
  } catch {
    /* Адрес показывается так, как настроен. */
  }
  const status = error.status;
  if (status === undefined) {
    if (error.kind === "http") {
      // Без названной причины ответ оборвался после заголовков.
      const reason =
        typeof error.details?.network === "string"
          ? (error.details.network as NetworkFailure)
          : "reset";
      const text = network(reason, address, host);
      if (!indeterminate) return text;
      return {
        message: text.message,
        hint: `Запрос на запись ушёл, а ответа нет: проверить, прошла ли запись, прежде чем повторять.${reason === "timeout" ? " Для долгих операций — увеличить timeoutMs подключения." : ""}`,
      };
    }
    if (error.kind === "auth")
      return {
        message: "Не заданы имя пользователя и пароль подключения.",
        hint: "Нужно задать WTCTL_USERNAME и WTCTL_PASSWORD (для MCP-сервера — в env его записи) или создать файл подключений: wtctl config init.",
      };
    // Локальная проверка, ничего не отправившая, сама называет причину.
    if (error.requestSent === false) return { message: error.message };
    if (error.kind === "cleanup") return { message: "Не удалось закрыть сессию на сервере." };
    return {
      message: "Ответ сервера не соответствует ожидаемому виду.",
      hint: "Если так отвечает любая операция, по адресу подключения может работать не сервер WebSoft HCM или его версия не поддерживается: выполнить runtime.check.",
    };
  }
  if (status === 401)
    return {
      message: "Сервер отказал во входе (HTTP 401).",
      hint: "Проверить имя пользователя и пароль подключения.",
    };
  if (status === 403)
    return {
      message: "Сервер запретил запрос (HTTP 403).",
      hint: "У пользователя подключения нет прав на это действие.",
    };
  if (status === 500)
    return { message: "Сервер отклонил запрос (HTTP 500).", hint: refusalHint(usualCause) };
  if (status === 404)
    return {
      message: "Сервер ответил HTTP 404: по этому адресу ничего нет.",
      hint: "Если так отвечает любая операция, проверить адрес подключения: по нему может работать не сервер WebSoft HCM.",
    };
  if (status === 502 || status === 503 || status === 504)
    return {
      message: `Сервер недоступен (HTTP ${status}).`,
      hint: "Так отвечает промежуточный сервер, когда сам сервер WebSoft HCM остановлен или перегружен.",
    };
  if (error.requestSent === false) return { message: error.message };
  if (status >= 200 && status < 300)
    return { message: `Сервер ответил HTTP ${status}, но разобрать ответ не удалось.` };
  return { message: `Сервер ответил ошибкой HTTP ${status}.` };
}
