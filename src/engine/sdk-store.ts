import path from "node:path";
import { JsonlLocalAgentStore } from "@cursor/sdk";
import { writableDataDir } from "./paths.ts";

let store: JsonlLocalAgentStore | null = null;

/**
 * Cursor's default SQLite store writes under `~/.cursor/...`, which is not
 * writable on Vercel serverless. Use a JSONL store under our data dir instead.
 */
export function getLocalAgentStore(): JsonlLocalAgentStore {
  if (!store) {
    const root = path.join(writableDataDir(), "sdk-agent-store");
    store = new JsonlLocalAgentStore(root);
  }
  return store;
}
