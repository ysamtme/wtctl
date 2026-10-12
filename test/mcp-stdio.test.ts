import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mcpJson } from "./mcp-json.js";

const cwd = fileURLToPath(new URL("..", import.meta.url));
// Synthetic runtime only. This subprocess never creates a network client or reads config.
const fixtureCode = [
  "import { runMcpStdio } from './src/mcp/stdio.ts';",
  "const runtime = {",
  "listOperations() { return {operations:[],total:0}; },",
  "describe(id) { return {id,group:'test',title:'Synthetic',description:'Synthetic',effect:'read',status:'implemented',inputSchema:{type:'object'}}; },",
  "getOperationEffect() { return 'read'; },",
  "async call(id,args={}) { return {ok:true,data:{args},meta:{operationId:id,connection:'synthetic',durationMs:0}}; },",
  'async close() { process.stderr.write(\'{"cleanup":"closed"}\\n\'); }',
  "};",
  "await runMcpStdio(runtime, 'synthetic', (text) => process.stderr.write(text));",
  "await runtime.close();",
].join("\n");

test(
  "real stdio process speaks MCP exclusively and closes its runtime after EOF",
  { timeout: 15000 },
  async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", "--input-type=module", "-e", fixtureCode],
      cwd,
      stderr: "pipe",
    });
    let diagnostics = "";
    transport.stderr?.on("data", (chunk: Buffer) => {
      diagnostics += chunk.toString("utf8");
    });
    const client = new Client({ name: "stdio-tests", version: "1.0.0" });
    try {
      await client.connect(transport);
      assert.equal((await client.listTools()).tools.length, 23);
      const result = await client.callTool({ name: "hcm_status", arguments: {} });
      assert.equal(mcpJson(result).ok, true);
      const mismatch = await client.callTool({
        name: "hcm_api_write",
        arguments: { operationId: "test.read" },
      });
      assert.equal(mismatch.isError, true);
    } finally {
      await client.close();
    }
    assert.match(diagnostics, /"cleanup":"closed"/);
    for (const line of diagnostics.trim().split("\n")) assert.doesNotThrow(() => JSON.parse(line));
  },
);

test(
  "invalid stdio framing emits safe stderr diagnostics and clean EOF closure",
  { timeout: 15000 },
  async () => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", fixtureCode],
      { cwd, stdio: ["pipe", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    const exit = new Promise<number | null>((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", resolve);
    });
    child.stdin.end("not-json synthetic-private-input\n");
    assert.equal(await exit, 0);
    assert.equal(stdout, "");
    assert.match(stderr, /mcp.protocol_error/);
    assert.match(stderr, /"cleanup":"closed"/);
    assert.doesNotMatch(stderr, /synthetic-private-input/);
  },
);
