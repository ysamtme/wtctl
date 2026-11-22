import { createStyler, resolveColor } from "./format/ansi.js";
import type { CliIo, CliTimers } from "./types.js";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
const CLEAR_LINE = "\r\x1b[2K";
const DEFAULT_DELAY_MS = 250;
const DEFAULT_INTERVAL_MS = 80;

export interface ProgressIndicator {
  readonly enabled: boolean;
  /** Запускает спиннер с задержкой перед первой отрисовкой. */
  start(label?: string): void;
  /** Обновляет подпись; перерисовывает строку, только если задержка уже прошла. */
  update(label: string): void;
  /** Стирает текущую строку индикатора, если она выведена, оставляя таймеры работать. */
  clear(): Promise<void>;
  /** Останавливает таймеры и стирает строку индикатора; безопасен при повторном вызове. */
  stop(): Promise<void>;
}

const DEFAULT_TIMERS: CliTimers = {
  setTimeout: (callback, ms) => {
    const handle = setTimeout(callback, ms);
    handle.unref?.();
    return handle;
  },
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  setInterval: (callback, ms) => {
    const handle = setInterval(callback, ms);
    handle.unref?.();
    return handle;
  },
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

function clipLabel(text: string, columns?: number): string {
  const maxWidth = columns !== undefined && columns > 8 ? columns - 4 : 76;
  if (text.length <= maxWidth) return text;
  return `${text.slice(0, Math.max(1, maxWidth - 1))}…`;
}

/**
 * Компактный спиннер и строка прогресса в stderr.
 * Работает только при stderrIsTTY === true, без --quiet и вне JSON-вывода.
 */
export function createProgress(
  io: CliIo,
  options: {
    readonly enabled: boolean;
    readonly delayMs?: number;
    readonly intervalMs?: number;
  },
): ProgressIndicator {
  const active = options.enabled && io.stderrIsTTY === true;
  if (!active) {
    return {
      enabled: false,
      start: () => undefined,
      update: () => undefined,
      clear: async () => undefined,
      stop: async () => undefined,
    };
  }

  const timers = io.timers ?? DEFAULT_TIMERS;
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const styler = createStyler(resolveColor(io, "stderr"));

  let running = false;
  let visible = false;
  let dirty = false;
  let frameIndex = 0;
  let currentLabel = "Выполнение…";
  let delayHandle: unknown;
  let tickHandle: unknown;
  let writing: Promise<void> | undefined;

  const writeDirect = (text: string): Promise<void> => {
    let result: void | Promise<void>;
    try {
      result = io.writeError(text);
    } catch {
      /* Ошибка вывода прогресса в stderr не должна прерывать основную команду. */
      return Promise.resolve();
    }
    if (result && typeof (result as Promise<void>).then === "function") {
      const tracked = (result as Promise<void>)
        .catch(() => undefined)
        .finally(() => {
          if (writing === tracked) {
            writing = undefined;
            if (dirty && running && visible) {
              dirty = false;
              render();
            }
          }
        });
      writing = tracked;
      return tracked;
    }
    return Promise.resolve();
  };

  const render = (): void => {
    visible = true;
    // Если предыдущая запись в stderr ещё не завершилась, пропускаем промежуточный кадр.
    if (writing !== undefined) {
      dirty = true;
      return;
    }
    dirty = false;
    const frame = SPINNER_FRAMES[frameIndex % SPINNER_FRAMES.length]!;
    frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length;
    const text = clipLabel(currentLabel, io.columns);
    void writeDirect(`${CLEAR_LINE}${styler.cyan(frame)} ${styler.dim(text)}`);
  };

  const clearLine = async (): Promise<void> => {
    dirty = false;
    const wasVisible = visible;
    visible = false;
    if (writing !== undefined) await writing;
    if (!wasVisible) return;
    await writeDirect(CLEAR_LINE);
  };

  const ensureInterval = (): void => {
    if (tickHandle !== undefined) return;
    tickHandle = timers.setInterval(() => {
      if (!running) return;
      render();
    }, intervalMs);
  };

  const cancelTimers = (): void => {
    if (delayHandle !== undefined) {
      timers.clearTimeout(delayHandle);
      delayHandle = undefined;
    }
    if (tickHandle !== undefined) {
      timers.clearInterval(tickHandle);
      tickHandle = undefined;
    }
  };

  return {
    enabled: true,
    start(label = "Выполнение…"): void {
      currentLabel = label;
      if (running) return;
      running = true;
      dirty = false;
      frameIndex = 0;
      delayHandle = timers.setTimeout(() => {
        delayHandle = undefined;
        if (!running) return;
        render();
        ensureInterval();
      }, delayMs);
    },
    update(label: string): void {
      currentLabel = label;
      if (running && visible) render();
    },
    async clear(): Promise<void> {
      await clearLine();
    },
    async stop(): Promise<void> {
      running = false;
      cancelTimers();
      await clearLine();
    },
  };
}
