import fs from "node:fs";
import path from "node:path";
import { JsonlLocalAgentStore } from "@cursor/sdk";
import { log } from "./log.ts";
import { writableDataDir } from "./paths.ts";

let store: JsonlLocalAgentStore | null = null;

/**
 * Reclaim disk from the SDK's append-only NDJSON store. Unlike job dirs these
 * files are shared and always freshly appended, so an age-based sweep never
 * fires — cap by size instead and drop the whole file. Safe because the store
 * only serves resume/debug for the current process: in-memory maps are the
 * source of truth for live work, and failStaleWork errors anything from a
 * previous process at boot anyway. Also removes .tmp strays from crashed
 * writes. Must run before getLocalAgentStore() first opens the store.
 */
export function sweepSdkAgentStore(maxBytes = 64 * 1024 * 1024): void {
  const root = path.join(writableDataDir(), "sdk-agent-store");
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return; // no store yet
  }
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const file = path.join(root, entry.name);
    try {
      if (entry.name.endsWith(".tmp") || fs.statSync(file).size > maxBytes) {
        fs.rmSync(file, { force: true });
        removed++;
      }
    } catch {}
  }
  if (removed) log.info("sdk-store", `swept ${removed} oversized/stray file(s) from sdk-agent-store`);
}

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
