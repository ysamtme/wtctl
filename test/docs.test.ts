import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import {
  documentedMcpToolNames,
  unknownDocumentedMcpTools,
} from "../scripts/documented-mcp-tools.mjs";
import { HcmMcpTools } from "../src/mcp/server.js";
import type { RuntimePort } from "../src/cli/types.js";

function actualToolNames(): Set<string> {
  const noBackend = (): never => {
    throw new Error("Documentation discovery attempted backend access.");
  };
  const runtime: RuntimePort = {
    listOperations: noBackend,
    describe: noBackend,
    getOperationEffect: noBackend,
    call: noBackend,
    close: noBackend,
  };
  return new Set(new HcmMcpTools(runtime).list().map((tool) => tool.name));
}

test("документированные вызовы отклоняют выдуманные инструменты, не принимая за вызовы ID сводок и семейства с подстановкой", () => {
  const markdown = [
    'Use `hcm_api_read({operationId:"rpc.list",args:{}})` and `hcm_rpc_list`.',
    "Families `hcm_*` and `hcm_logs_*`, receipt `hcm_inline_` and `hcm_inline_123abc` are identifiers.",
    '```json\n{"name":"hcm_rpc_describe","arguments":{}}\n```',
    '```javascript\nthrow "hcm_conformance_expected_error";\n```',
    "Bare prose hcm_unknown is not a concrete command example.",
  ].join("\n\n");
  assert.deepEqual(documentedMcpToolNames(markdown), [
    "hcm_api_read",
    "hcm_rpc_describe",
    "hcm_rpc_list",
  ]);
  assert.deepEqual(unknownDocumentedMcpTools(markdown, actualToolNames()), [
    "hcm_rpc_describe",
    "hcm_rpc_list",
  ]);
});

test("навык из пакета и гайд называют только инструменты, которые MCP-сервер действительно объявляет", async () => {
  const knownNames = actualToolNames();
  const skill = "../skills/wtctl/";
  const references = (await readdir(new URL(skill + "references/", import.meta.url)))
    .filter((name) => name.endsWith(".md"))
    .map((name) => `${skill}references/${name}`);
  for (const relative of [skill + "SKILL.md", ...references, "../docs/mcp.md"]) {
    const source = await readFile(new URL(relative, import.meta.url), "utf8");
    assert.deepEqual(unknownDocumentedMcpTools(source, knownNames), [], relative);
  }
});
