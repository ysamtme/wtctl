import type { ConnectionConfig } from "../contracts.js";
import type { RuntimePort } from "../runtime-port.js";
export type { RuntimePort } from "../runtime-port.js";

/** Потоковая запись текста в локальный файл (атомарная публикация через commit или откат через abort). */
export interface FileTextWriter {
  write(chunk: string): void | Promise<void>;
  /** Завершить запись и опубликовать файл; возвращает размер файла в байтах. */
  commit(): Promise<number>;
  /** Отменить запись и удалить временный файл. */
  abort(): Promise<void>;
}

/** Планировщик таймеров для индикации ожидания (шов для быстрых детерминированных тестов). */
export interface CliTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface CliIo {
  /** Отступы в JSON для человека в терминале; иначе результат — одна компактная строка. */
  readonly pretty?: boolean;
  /** Интерактивный ли поток stdout (автовыбор читаемого вывода при --format auto). */
  readonly stdoutIsTTY?: boolean;
  /** Интерактивный ли поток stderr (читаемые ошибки и пометки). */
  readonly stderrIsTTY?: boolean;
  /** Ширина терминала в столбцах для табличного вывода. */
  readonly columns?: number;
  /** Явное управление цветами ANSI (с учётом NO_COLOR и FORCE_COLOR). */
  readonly color?: boolean;
  /** Сигнал прерывания (Ctrl+C / SIGTERM; в тестах — AbortController.signal). */
  readonly signal?: AbortSignal;
  /** Подписка на сигналы прерывания процесса; возвращает функцию отписки. */
  onInterrupt?(handler: () => void): () => void;
  /** Ожидание с поддержкой отмены (шов для тестов без реальных задержек). */
  sleep?(ms: number, signal?: AbortSignal): Promise<void>;
  /** Пользовательский планировщик таймеров для тестов индикатора ожидания. */
  readonly timers?: CliTimers;
  writeOut(text: string): void | Promise<void>;
  /** Запись двоичных байт в stdout (например files read --format raw для двоичного файла). */
  writeBinaryOut?(bytes: Uint8Array): void | Promise<void>;
  writeError(text: string): void | Promise<void>;
  /** Без maximumBytes размер не ограничен. */
  readFile(path: string, maximumBytes?: number): Promise<string>;
  readStdin(maximumBytes?: number): Promise<string>;
  readBinaryFile?(path: string): Promise<Uint8Array>;
  readBinaryStdin?(): Promise<Uint8Array>;
  writeFile(path: string, text: string): Promise<void>;
  /** Атомарная запись двоичного файла (для --output при двоичном выводе). */
  writeBinaryFile?(path: string, bytes: Uint8Array): Promise<void>;
  /** Потоковая запись текстового файла с атомарной публикацией (например query --all --output). */
  openTextWriter?(path: string): Promise<FileTextWriter>;
  /** Атомарно записывает файл, только если его содержимое не изменилось (undefined — файла не было). */
  writeFileIfUnchanged?(
    path: string,
    expectedText: string | undefined,
    text: string,
  ): Promise<void>;
  /** Спрашивает человека в терминале; без него отсутствует. Секреты при вводе не показываются. */
  prompt?(question: string, secret?: boolean): Promise<string>;
  /** Спрашивает подтверждение [y/N] в терминале; без терминала отсутствует. */
  readonly confirm?: (question: string) => Promise<boolean>;
  /** Запускает внешний редактор для временного файла и возвращает его код выхода. */
  readonly launchEditor?: (
    command: string | undefined,
    filePath: string,
    options?: { readonly redirectStdoutToStderr?: boolean },
  ) => Promise<number>;
  /** Немедленное завершение процесса после SIGINT/SIGTERM, если зависший сетевой сокет держит event loop. */
  forceExit?(code: number): void;
}

export interface CliDependencies {
  loadConfiguration(options: {
    configPath?: string;
    connection?: string;
    password?: string;
    defaultOutputLimitBytes?: number;
  }): ConnectionConfig | Promise<ConnectionConfig>;
  createRuntime(config: ConnectionConfig): RuntimePort;
  runMcp(
    runtime: RuntimePort,
    connectionName: string,
    io: CliIo,
    local?: import("../guide.js").LocalInstall,
  ): Promise<void>;
  /** Откуда запущена программа; гайд называет это место, чтобы агент мог вызвать команду и SDK. */
  readonly local?: import("../guide.js").LocalInstall | undefined;
}
