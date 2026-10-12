import type { OperationResult } from "../src/contracts.js";

/** The MCP frontend returns one JSON text block; this reads it back as the operation result. */
export function mcpJson(response: unknown): OperationResult {
  const content = (response as { content: { type: string; text: string }[] }).content;
  if (content.length !== 1 || content[0]!.type !== "text")
    throw new Error("Expected exactly one text block.");
  if ((response as { structuredContent?: unknown }).structuredContent !== undefined)
    throw new Error("A second structured copy would double the result in the model's context.");
  return JSON.parse(content[0]!.text) as OperationResult;
}
