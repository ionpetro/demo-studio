import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { storageEnabled, uploadVideo } from "../src/engine/storage.ts";

const ORIG_SUPABASE_URL = process.env.SUPABASE_URL;
const ORIG_SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

function resetEnv() {
  if (ORIG_SUPABASE_URL === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = ORIG_SUPABASE_URL;
  if (ORIG_SUPABASE_SECRET_KEY === undefined) delete process.env.SUPABASE_SECRET_KEY;
  else process.env.SUPABASE_SECRET_KEY = ORIG_SUPABASE_SECRET_KEY;
}

// storage.ts keeps a module-level `bucketReady` promise that memoizes the
// FIRST ensureBucket() call forever (success or failure — see bug note in
// the final report). To test several distinct bucket-create scenarios
// within one process/test-file, each scenario needs its own fresh module
// instance; a cache-busting query string on the dynamic import gives us
// that (same underlying file, distinct ESM module-cache entry, so
// `bucketReady` starts out null again).
let freshCounter = 0;
async function freshStorageModule(): Promise<typeof import("../src/engine/storage.ts")> {
  freshCounter += 1;
  return import(`../src/engine/storage.ts?fresh=${Date.now()}-${freshCounter}`);
}

function makeTmpVideoFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "demo-studio-storage-test-"));
  const file = path.join(dir, "video.mp4");
  fs.writeFileSync(file, "fake video bytes");
  return file;
}

function jsonRes(status: number, ok: boolean, body: string) {
  return {
    ok,
    status,
    text: async () => body,
  } as Response;
}

// ---------------------------------------------------------------------------
// storageEnabled() — all four combinations of the two gating env vars.
// ---------------------------------------------------------------------------

test("storageEnabled() is false when neither SUPABASE_URL nor SUPABASE_SECRET_KEY is set", (t) => {
  t.after(resetEnv);
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
  assert.equal(storageEnabled(), false);
});

test("storageEnabled() is false when only SUPABASE_URL is set", (t) => {
  t.after(resetEnv);
  process.env.SUPABASE_URL = "https://proj.supabase.co";
  delete process.env.SUPABASE_SECRET_KEY;
  assert.equal(storageEnabled(), false);
});

test("storageEnabled() is false when only SUPABASE_SECRET_KEY is set", (t) => {
  t.after(resetEnv);
  delete process.env.SUPABASE_URL;
  process.env.SUPABASE_SECRET_KEY = "secret";
  assert.equal(storageEnabled(), false);
});

test("storageEnabled() is true when both SUPABASE_URL and SUPABASE_SECRET_KEY are set", (t) => {
  t.after(resetEnv);
  process.env.SUPABASE_URL = "https://proj.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "secret";
  assert.equal(storageEnabled(), true);
});

// ---------------------------------------------------------------------------
// uploadVideo() — disabled path: must return undefined immediately without
// ever touching fetch (we deliberately do NOT mock fetch here; if the code
// tried to call it, this test would fail with a real network/connection
// error rather than silently succeeding).
// ---------------------------------------------------------------------------

test("uploadVideo() returns undefined immediately when storage is not enabled", async (t) => {
  t.after(resetEnv);
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;

  const file = makeTmpVideoFile();
  const result = await uploadVideo("job-1", file);
  assert.equal(result, undefined);
});

// ---------------------------------------------------------------------------
// uploadVideo() — enabled path, with globalThis.fetch mocked via t.mock.
// Each of these uses a fresh module instance (see freshStorageModule above)
// so its bucket-create scenario isn't short-circuited by a previous test's
// cached `bucketReady`.
// ---------------------------------------------------------------------------

test("uploadVideo() succeeds when bucket-create 409s (tolerated) and upload returns 200", async (t) => {
  t.after(resetEnv);
  process.env.SUPABASE_URL = "https://proj.supabase.co/";
  process.env.SUPABASE_SECRET_KEY = "secret";
  const file = makeTmpVideoFile();
  const { uploadVideo: freshUpload } = await freshStorageModule();

  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string | URL, _init?: unknown) => {
    const u = String(url);
    calls.push(u);
    if (u.includes("/storage/v1/bucket")) {
      return jsonRes(409, false, "bucket already exists");
    }
    if (u.includes("/storage/v1/object/videos/")) {
      return jsonRes(200, true, "");
    }
    throw new Error(`unexpected fetch to ${u}`);
  });

  const result = await freshUpload("job-abc", file);

  assert.equal(result, "https://proj.supabase.co/storage/v1/object/public/videos/job-abc.mp4");
  assert.equal(calls.length, 2, "expected one bucket-create call and one upload call");
  assert.match(calls[0], /\/storage\/v1\/bucket$/);
  assert.match(calls[1], /\/storage\/v1\/object\/videos\/job-abc\.mp4$/);
});

test("uploadVideo() returns undefined when bucket-create fails with a non-409, non-'already exists' error", async (t) => {
  t.after(resetEnv);
  process.env.SUPABASE_URL = "https://proj.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "secret";
  const file = makeTmpVideoFile();
  const { uploadVideo: freshUpload } = await freshStorageModule();

  let uploadAttempted = false;
  t.mock.method(globalThis, "fetch", async (url: string | URL) => {
    const u = String(url);
    if (u.includes("/storage/v1/bucket")) {
      return jsonRes(500, false, "internal server error");
    }
    uploadAttempted = true;
    throw new Error(`unexpected fetch to ${u} (upload should not be attempted)`);
  });

  const result = await freshUpload("job-fail-bucket", file);
  assert.equal(result, undefined);
  assert.equal(uploadAttempted, false, "the upload POST should never be reached when bucket-create fails");
});

test("uploadVideo() tolerates a bucket-create failure whose body says 'already exists' even off a non-409 status", async (t) => {
  t.after(resetEnv);
  process.env.SUPABASE_URL = "https://proj.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "secret";
  const file = makeTmpVideoFile();
  const { uploadVideo: freshUpload } = await freshStorageModule();

  t.mock.method(globalThis, "fetch", async (url: string | URL) => {
    const u = String(url);
    if (u.includes("/storage/v1/bucket")) {
      return jsonRes(400, false, "Bucket already exists");
    }
    if (u.includes("/storage/v1/object/videos/")) {
      return jsonRes(200, true, "");
    }
    throw new Error(`unexpected fetch to ${u}`);
  });

  const result = await freshUpload("job-tolerated", file);
  assert.equal(result, "https://proj.supabase.co/storage/v1/object/public/videos/job-tolerated.mp4");
});

test("uploadVideo() returns undefined when the upload POST itself returns non-ok", async (t) => {
  t.after(resetEnv);
  process.env.SUPABASE_URL = "https://proj.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "secret";
  const file = makeTmpVideoFile();
  const { uploadVideo: freshUpload } = await freshStorageModule();

  t.mock.method(globalThis, "fetch", async (url: string | URL) => {
    const u = String(url);
    if (u.includes("/storage/v1/bucket")) {
      return jsonRes(200, true, "");
    }
    if (u.includes("/storage/v1/object/videos/")) {
      return jsonRes(500, false, "disk full");
    }
    throw new Error(`unexpected fetch to ${u}`);
  });

  const result = await freshUpload("job-fail-upload", file);
  assert.equal(result, undefined);
});

test("uploadVideo() sends Authorization/apikey headers derived from SUPABASE_SECRET_KEY on both calls", async (t) => {
  t.after(resetEnv);
  process.env.SUPABASE_URL = "https://proj.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "my-secret-key";
  const file = makeTmpVideoFile();
  const { uploadVideo: freshUpload } = await freshStorageModule();

  const seenHeaders: Record<string, string>[] = [];
  t.mock.method(globalThis, "fetch", async (url: string | URL, init?: { headers?: Record<string, string> }) => {
    seenHeaders.push((init?.headers as Record<string, string>) ?? {});
    const u = String(url);
    if (u.includes("/storage/v1/bucket")) return jsonRes(409, false, "already exists");
    return jsonRes(200, true, "");
  });

  await freshUpload("job-headers", file);

  assert.equal(seenHeaders.length, 2, "expected headers captured for both the bucket-create and upload calls");
  for (const h of seenHeaders) {
    assert.equal(h.Authorization, "Bearer my-secret-key");
    assert.equal(h.apikey, "my-secret-key");
  }
});

test("uploadVideo() builds the object path as `${jobId}.mp4` and strips a trailing slash from SUPABASE_URL", async (t) => {
  t.after(resetEnv);
  process.env.SUPABASE_URL = "https://proj.supabase.co///"; // only a single trailing slash is stripped by the source regex
  process.env.SUPABASE_SECRET_KEY = "secret";
  const file = makeTmpVideoFile();
  const { uploadVideo: freshUpload } = await freshStorageModule();

  t.mock.method(globalThis, "fetch", async (url: string | URL) => {
    const u = String(url);
    if (u.includes("/storage/v1/bucket")) return jsonRes(409, false, "already exists");
    return jsonRes(200, true, "");
  });

  const result = await freshUpload("job-slash", file);
  // Source only replaces a single trailing slash (`/\/$/`), so two extra
  // slashes survive into the base and thus into the returned URL.
  assert.equal(result, "https://proj.supabase.co///storage/v1/object/public/videos/job-slash.mp4");
});
