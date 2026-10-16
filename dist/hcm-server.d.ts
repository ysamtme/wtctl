import { type ScriptData } from "./scripts.js";
import { type WriteOutcome } from "./write-outcome.js";
/** Шов к серверу HCM: низкоуровневая операция явного реестра. Рабочий адаптер — NativeGateway. */
export interface ServerPort {
    call(id: string, args: Record<string, unknown>): Promise<unknown>;
    /** Двоичный ответ потоком, без предела ответа: read читает тело, пока порт занят запросом. */
    stream<T>(id: string, args: Record<string, unknown>, read: (body: AsyncIterable<Uint8Array>) => Promise<T>): Promise<T>;
}
/** Сервер для составных операций: каждый запрос к порту проходит здесь. */
export declare class HcmServer implements ServerPort {
    private readonly port;
    private appInfo;
    constructor(port: ServerPort);
    /** Запрос операции, которую реестр считает чтением. Всё остальное обязано сказать, что это. */
    call(id: string, args: Record<string, unknown>, outcome?: WriteOutcome): Promise<unknown>;
    /** Только чтение, хотя операция умеет больше (xQuery, rpc.call); запись реестра отклоняется. */
    read(id: string, args: Record<string, unknown>): Promise<unknown>;
    /** Чтение реестра с двоичным ответом потоком: read получает тело. */
    stream<T>(id: string, args: Record<string, unknown>, read: (body: AsyncIterable<Uint8Array>) => Promise<T>): Promise<T>;
    /** Сведения о приложении, хранятся 30 секунд; отклонённый запрос не хранится. */
    applicationInfo(): Promise<Record<string, unknown>>;
    /**
     * Код, подготовленный prepareScript, выполняется на сервере; ответ проверяется на
     * перехваченную ошибку. `idle` по ответу узнаёт, что код ничего не сделал: отметка снимается.
     */
    runCode(script: {
        request: Record<string, unknown>;
        executionId: string;
    }, outcome: WriteOutcome, idle?: (data: ScriptData) => boolean): Promise<ScriptData>;
}
