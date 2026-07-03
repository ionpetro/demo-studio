import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writableDataDir } from "../src/engine/paths.ts";

// writableDataDir() is a plain function (not cached/memoized) — it re-reads
// env on every call. We save/restore the two env vars it consults around
// each test case so cases don't bleed into each other.
const ORIG_DEMO_STUDIO_DATA_DIR = process.env.DEMO_STUDIO_DATA_DIR;
const ORIG_VERCEL = process.env.VERCEL;

function resetEnv() {
  if (ORIG_DEMO_STUDIO_DATA_DIR === undefined) delete process.env.DEMO_STUDIO_DATA_DIR;
  else process.env.DEMO_STUDIO_DATA_DIR = ORIG_DEMO_STUDIO_DATA_DIR;
  if (ORIG_VERCEL === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = ORIG_VERCEL;
}

test("writableDataDir() with DEMO_STUDIO_DATA_DIR set returns that exact path and creates it", (t) => {
  t.after(resetEnv);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "demo-studio-paths-test-"));
  const target = path.join(dir, "nested", "data-dir");
  process.env.DEMO_STUDIO_DATA_DIR = target;
  delete process.env.VERCEL;

  const result = writableDataDir();

  assert.equal(result, target);
  assert.ok(fs.existsSync(target), "directory should exist on disk after call");
  assert.ok(fs.statSync(target).isDirectory());
});

test("writableDataDir() with DEMO_STUDIO_DATA_DIR unset and VERCEL unset returns cwd()/data", (t) => {
  t.after(resetEnv);
  delete process.env.DEMO_STUDIO_DATA_DIR;
  delete process.env.VERCEL;

  const result = writableDataDir();

  assert.equal(result, path.join(process.cwd(), "data"));
  assert.ok(fs.existsSync(result));

  // Clean up the directory this call created in the repo, so the test
  // suite doesn't leave stray state behind (per the "no data/ dir left
  // behind" verification requirement — this only applies to the jobs.ts
  // module-load path; this test intentionally exercises the fallback branch
  // but removes what it creates).
  fs.rmSync(result, { recursive: true, force: true });
});

test("writableDataDir() with DEMO_STUDIO_DATA_DIR unset and VERCEL set returns a path under os.tmpdir()", (t) => {
  t.after(resetEnv);
  delete process.env.DEMO_STUDIO_DATA_DIR;
  process.env.VERCEL = "1";

  const result = writableDataDir();

  assert.equal(result, path.join(os.tmpdir(), "demo-studio-data"));
  assert.ok(result.startsWith(os.tmpdir()));
  assert.ok(fs.existsSync(result));
});

test("writableDataDir() is idempotent for the same DEMO_STUDIO_DATA_DIR value (mkdirSync recursive doesn't throw)", (t) => {
  t.after(resetEnv);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "demo-studio-paths-test-"));
  process.env.DEMO_STUDIO_DATA_DIR = dir;
  delete process.env.VERCEL;

  const first = writableDataDir();
  const second = writableDataDir();

  assert.equal(first, dir);
  assert.equal(second, dir);
});
