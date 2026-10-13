import { WsHcmApiError } from "./protocol/error.js";
import type { NetworkFailure } from "./protocol/transport.js";

export interface FailureText {
  readonly message: string;
  readonly hint?: string;
}

/** The server answers every refusal with a bare HTTP 500; the reason goes only to its log. */
const USUAL_CAUSES: Readonly<Record<string, string>> = {
  "runtime.query": "нет такого каталога или поля, ошибка в запросе XQuery",
  "objects.get":
    "объекта с таким ID или адресом нет; ID строки каталога без своего типа объекта — не ID документа",
  "objects.patch": "объекта с таким ID или адресом нет",
  "objects.delete": "объекта с таким ID или адресом нет",
  "objects.create": "значение, которое тип объекта не принимает",
  "schema.get": "формы по этому адресу нет",
  "rpc.call": "нет такой функции, неверные аргументы или ошибка внутри функции",
  "files.read": "по этому адресу ничего нет",
  "files.write":
    "сервер не сообщил, какие папки принимают запись; в папку кода файл записывает код на сервере",
  "files.delete":
    "по адресу нет файла или в папке есть файлы; если сервер не сообщил, какие папки принимают запись, это может быть папка кода, где файл удаляет код на сервере",
  "native.lds.loadDoc": "по этому адресу ничего нет",
  "native.lds.createDoc": "для этого типа объекта сервер заготовку не даёт",
  "native.lds.getModDeletedObjects": "на проверенных серверах эта операция не работает",
};
function refusalHint(operation: string): string {
  const cause = USUAL_CAUSES[operation];
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

/** What a failed exchange with the server means for the person who set the connection up. */
export function platformFailure(
  error: WsHcmApiError,
  baseUrl: string,
  operation: string,
): FailureText {
  let address = baseUrl.replace(/\/+$/, "");
  let host = address;
  try {
    const url = new URL(baseUrl);
    address = `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
    host = url.hostname;
  } catch {
    /* The address is shown as configured. */
  }
  const status = error.status;
  if (status === undefined) {
    const reason = error.details?.network;
    if (error.kind === "http")
      // Without a stated reason the response broke off after its headers.
      return network(
        typeof reason === "string" ? (reason as NetworkFailure) : "reset",
        address,
        host,
      );
    if (error.kind === "auth")
      return {
        message: "Не заданы имя пользователя и пароль подключения.",
        hint: "Нужно задать WTCTL_USERNAME и WTCTL_PASSWORD (для MCP-сервера — в env его записи) или создать файл подключений: wtctl config init.",
      };
    // A local check that sent nothing states its reason itself.
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
    return { message: "Сервер отклонил запрос (HTTP 500).", hint: refusalHint(operation) };
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
