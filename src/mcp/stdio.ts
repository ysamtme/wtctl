import process from "node:process";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { RuntimePort } from "../cli/types.js";
import type { LocalInstall } from "../guide.js";
import { createHcmMcpServer } from "./server.js";

/** Keep the owning CLI/runtime alive until the MCP client disconnects. */
export async function runMcpStdio(
  runtime: RuntimePort,
  connectionName: string,
  writeDiagnostic: (text: string) => void | Promise<void>,
  local?: LocalInstall,
): Promise<void> {
  const server = createHcmMcpServer(runtime, { connectionName, local });
  let resolveClosed!: () => void;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  server.onclose = resolveClosed;
  server.onerror = () => {
    void Promise.resolve(
      writeDiagnostic(
        '{"level":"error","code":"mcp.protocol_error","message":"Ошибка MCP-протокола; исходные данные скрыты."}\n',
      ),
    ).catch(() => {});
  };
  const stop = (): void => {
    void server.close().catch(() => {
      resolveClosed();
    });
  };
  process.stdin.once("end", stop);
  process.stdin.once("close", stop);
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    await server.connect(new StdioServerTransport());
    if (process.stdin.readableEnded) stop();
    await closed;
  } finally {
    process.stdin.off("end", stop);
    process.stdin.off("close", stop);
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    await server.close();
  }
}
