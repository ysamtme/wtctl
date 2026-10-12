import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import type { LocalInstall } from "../guide.js";

/** Where this process's Node.js, command file and SDK are; undefined when the script is not a file. */
export function localInstall(): LocalInstall | undefined {
  const started = process.argv[1];
  if (!started) return undefined;
  let script: string;
  try {
    script = realpathSync(started);
  } catch {
    return undefined;
  }
  const sdk = join(dirname(script), "..", "index.js");
  return {
    node: process.execPath,
    script,
    ...(existsSync(sdk) ? { sdk: pathToFileURL(sdk).href } : {}),
  };
}
