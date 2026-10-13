import type { ConnectionConfig } from "../contracts.js";
import type { RuntimePort } from "../runtime-port.js";
export type { RuntimePort } from "../runtime-port.js";

export interface CliIo {
  /** Отступы в JSON для человека в терминале; иначе результат — одна компактная строка. */
  readonly pretty?: boolean;
  writeOut(text: string): void | Promise<void>;
  writeError(text: string): void | Promise<void>;
  readFile(path: string, maximumBytes: number): Promise<string>;
  readStdin(maximumBytes: number): Promise<string>;
  readBinaryFile?(path: string, maximumBytes: number): Promise<Uint8Array>;
  readBinaryStdin?(maximumBytes: number): Promise<Uint8Array>;
  writeFile(path: string, text: string): Promise<void>;
  /** Спрашивает человека в терминале; без него отсутствует. Секреты при вводе не показываются. */
  prompt?(question: string, secret?: boolean): Promise<string>;
}

export interface CliDependencies {
  loadConfiguration(options: {
    configPath?: string;
    connection?: string;
    password?: string;
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
