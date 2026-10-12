#!/usr/bin/env node
import process from "node:process";
import { loadConfig } from "../config.js";
import { HcmRuntime } from "../runtime.js";
import { runMcpStdio } from "../mcp/stdio.js";
import { runCli } from "./run.js";
import { nodeIo } from "./node-io.js";
import { localInstall } from "./local-install.js";

process.stdout.on("error", () => {
  /* The write callback reports closed pipes without raw input. */
});
process.stderr.on("error", () => {
  /* Diagnostic stream failures must not expose data. */
});
process.exitCode = await runCli(process.argv.slice(2), nodeIo(), {
  loadConfiguration: loadConfig,
  createRuntime: (config) => new HcmRuntime(config),
  runMcp: (runtime, connectionName, streams, local) =>
    runMcpStdio(runtime, connectionName, (text) => streams.writeError(text), local),
  local: localInstall(),
});
