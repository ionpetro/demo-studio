import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Writable data root — `/tmp` on Vercel, `./data` locally. */
export function writableDataDir(): string {
  const dir =
    process.env.DEMO_STUDIO_DATA_DIR ??
    (process.env.VERCEL ? path.join(os.tmpdir(), "demo-studio-data") : path.join(process.cwd(), "data"));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
