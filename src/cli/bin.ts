#!/usr/bin/env node
import process from "node:process";
import { loadConfigWithDefaults } from "../config.js";
import { HcmRuntime } from "../runtime.js";
import { runCli } from "./run.js";
import { nodeIo } from "./node-io.js";
import { localInstall } from "./local-install.js";

process.stdout.on("error", () => {
  /* Обратный вызов записи сообщает о закрытых каналах без исходного ввода. */
});
process.stderr.on("error", () => {
  /* Сбои диагностических потоков не должны раскрывать данные. */
});
process.exitCode = await runCli(process.argv.slice(2), nodeIo(), {
  loadConfiguration: ({ defaultOutputLimitBytes, ...options }) =>
    loadConfigWithDefaults(
      options,
      defaultOutputLimitBytes === undefined
        ? undefined
        : { outputLimitBytes: defaultOutputLimitBytes },
    ),
  createRuntime: (config) => new HcmRuntime(config),
  runMcp: async (runtime, connectionName, streams, local) => {
    const { runMcpStdio } = await import("../mcp/stdio.js");
    await runMcpStdio(runtime, connectionName, (text) => streams.writeError(text), local);
  },
  local: localInstall(),
});
