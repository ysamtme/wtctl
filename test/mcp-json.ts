import type { OperationResult } from "../src/contracts.js";

/** Инструмент MCP возвращает один текстовый блок JSON; эта функция читает его обратно как результат операции. */
export function mcpJson(response: unknown): OperationResult {
  const content = (response as { content: { type: string; text: string }[] }).content;
  if (content.length !== 1 || content[0]!.type !== "text")
    throw new Error("Expected exactly one text block.");
  if ((response as { structuredContent?: unknown }).structuredContent !== undefined)
    throw new Error("A second structured copy would double the result in the model's context.");
  return JSON.parse(content[0]!.text) as OperationResult;
}
