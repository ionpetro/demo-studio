// Tests for backend/server.ts — the standalone Node http server that mirrors
// the Next.js API routes for Railway deploys.
//
// backend/server.ts has no named exports: importing it calls server.listen()
// immediately at module top level and installs SIGINT/SIGTERM handlers. So
// this file:
//   1. Sets PORT to a high, unlikely-to-collide value and points
//      DEMO_STUDIO_DATA_DIR at a fresh temp dir (jobs.ts calls
//      writableDataDir() at import time — real fs.mkdirSync — so it must not
//      write into the repo's data/ folder).
//   2. mock.module()s the four engine modules server.ts (and its own
//      transitive imports, e.g. backend/mcp.ts and src/engine/jobs.ts, which
//      resolve to the SAME absolute file paths) pull in, so no real
//      browser/DB/Clerk work ever happens.
//   3. Dynamically imports server.ts (must be dynamic — a static import
//      would be hoisted above the mock.module calls above).
//   4. Drives the running server with the global fetch().
//
// The fake run/job/author maps below are plain objects mutated per test
// (never reassigned), captured by closures inside the mock.module factory
// functions, so each test controls exactly what the mocked engine returns.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.PORT = "38173";
process.env.DEMO_STUDIO_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "demo-studio-server-test-"));

const fakeRuns: Record<string, any> = {};
const fakeJobRecords: Record<string, any> = {};
let fakeAuthor: { name: string; imageUrl: string | null } | null = null;

const agentSessionSpec = new URL("../src/engine/agent-session.ts", import.meta.url).pathname;
const dbSpec = new URL("../src/engine/db.ts", import.meta.url).pathname;
const headlessRunSpec = new URL("../src/engine/headless-run.ts", import.meta.url).pathname;
const authorSpec = new URL("../src/engine/author.ts", import.meta.url).pathname;

mock.module(agentSessionSpec, {
  namedExports: {
    disposeAllSessions: async () => {},
    getOrCreateSession: () => {
      throw new Error("not exercised in these tests");
    },
  },
});

mock.module(dbSpec, {
  namedExports: {
    // Full real export surface of src/engine/db.ts stubbed out — server.ts,
    // backend/mcp.ts (imported by server.ts), and src/engine/jobs.ts (real,
    // not mocked — imports persistJob) all resolve "../src/engine/db.ts" to
    // this same file, so every name any of them import must exist here.
    dbEnabled: () => false,
    flushDb: async () => {},
    persistSession: () => {},
    persistMessage: () => {},
    persistJob: () => {},
    persistRun: () => {},
    listUserJobs: async () => [],
    loadJobRecord: async (id: string) => fakeJobRecords[id],
    loadRunRecord: async () => undefined,
  },
});

mock.module(headlessRunSpec, {
  namedExports: {
    // backend/mcp.ts (imported by server.ts) also imports startDemoRun from
    // this module — it must be present even though no test here reaches a
    // real tool call (POST /mcp always short-circuits before invoking it).
    startDemoRun: () => {
      throw new Error("not exercised in these tests");
    },
    failAllActiveRuns: () => {},
    loadDemoRun: async (id: string) => fakeRuns[id],
  },
});

mock.module(authorSpec, {
  namedExports: {
    getAuthor: async (_userId: string | null | undefined) => fakeAuthor,
  },
});

// Dynamic import: must run after all mock.module() calls above.
await import("../backend/server.ts");
// server.listen()'s callback fires quickly, but give it a brief moment so
// the very first request in the suite isn't racing the listen() call.
await new Promise((r) => setTimeout(r, 50));

const base = `http://localhost:${process.env.PORT}`;

function resetRunsAndJobs() {
  for (const k of Object.keys(fakeRuns)) delete fakeRuns[k];
  for (const k of Object.keys(fakeJobRecords)) delete fakeJobRecords[k];
  fakeAuthor = null;
}

// --- basic routes ------------------------------------------------------

test("GET /health returns 200 { ok: true }", async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test("GET /nonexistent-route returns 404 'not found'", async () => {
  const res = await fetch(`${base}/nonexistent-route`);
  assert.equal(res.status, 404);
  assert.equal(await res.text(), "not found");
});

// --- CORS ----------------------------------------------------------------

test("OPTIONS with an allow-listed Origin (localhost:3000) returns 204 and echoes Access-Control-Allow-Origin", async () => {
  const res = await fetch(`${base}/anything`, {
    method: "OPTIONS",
    headers: { Origin: "http://localhost:3000" },
  });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), "http://localhost:3000");
});

test("OPTIONS with a non-allow-listed Origin omits Access-Control-Allow-Origin entirely", async () => {
  const res = await fetch(`${base}/anything`, {
    method: "OPTIONS",
    headers: { Origin: "https://evil.example.com" },
  });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), null);
});

test("OPTIONS with a *.vercel.app Origin is allowed", async () => {
  const res = await fetch(`${base}/anything`, {
    method: "OPTIONS",
    headers: { Origin: "https://my-app.vercel.app" },
  });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), "https://my-app.vercel.app");
});

test("OPTIONS with a *.vercel.app Origin is rejected when ALLOW_VERCEL_ORIGINS=0", async (t) => {
  process.env.ALLOW_VERCEL_ORIGINS = "0";
  t.after(() => delete process.env.ALLOW_VERCEL_ORIGINS);

  const res = await fetch(`${base}/anything`, {
    method: "OPTIONS",
    headers: { Origin: "https://my-app.vercel.app" },
  });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), null);
});

// --- /mcp ------------------------------------------------------------------

test("POST /mcp with no CURSOR_API_KEY/KERNEL_API_KEY returns 500 with the expected error body", async () => {
  const res = await fetch(`${base}/mcp`, { method: "POST", body: "{}" });
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: "CURSOR_API_KEY and KERNEL_API_KEY must be set on the server." });
});

test("GET /mcp returns 405 with a JSON-RPC-shaped 'Method not allowed' error", async () => {
  const res = await fetch(`${base}/mcp`);
  assert.equal(res.status, 405);
  assert.deepEqual(await res.json(), {
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed" },
    id: null,
  });
});

test("POST /mcp with MCP_AUTH_TOKEN set requires the bearer token", async (t) => {
  process.env.MCP_AUTH_TOKEN = "secret123";
  t.after(() => delete process.env.MCP_AUTH_TOKEN);

  const unauthed = await fetch(`${base}/mcp`, { method: "POST", body: "{}" });
  assert.equal(unauthed.status, 401);
  assert.deepEqual(await unauthed.json(), {
    jsonrpc: "2.0",
    error: { code: -32000, message: "Unauthorized" },
    id: null,
  });

  // Correct bearer token should pass the auth gate and fall through to the
  // next check (missing CURSOR_API_KEY/KERNEL_API_KEY) — 500, not 401,
  // proves the auth check itself passed.
  const authed = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { Authorization: "Bearer secret123" },
    body: "{}",
  });
  assert.equal(authed.status, 500);
});

// --- /api/runs/:id (+/video) -------------------------------------------

test("GET /api/runs/:id for an unknown run returns 404 { error: 'run not found' }", async () => {
  const res = await fetch(`${base}/api/runs/run-doesnotexist`);
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "run not found" });
});

test("GET /api/runs/:id (no /video) returns the run status object", async (t) => {
  t.after(resetRunsAndJobs);
  fakeRuns["run-abc"] = {
    id: "run-abc",
    goal: "g",
    startUrl: "https://x.com",
    status: "recording",
    actions: [],
    createdAt: 1700000000000,
    liveViewUrl: "https://live.example.com",
  };

  const res = await fetch(`${base}/api/runs/run-abc`);
  assert.equal(res.status, 200);
  const body = await res.json();
  // jobId/durationSec/error are undefined on this run, and JSON.stringify
  // drops undefined-valued keys entirely, so they must be absent (not
  // present-with-null) on the wire.
  assert.deepEqual(body, {
    runId: "run-abc",
    status: "recording",
    liveViewUrl: "https://live.example.com",
    actions: [],
  });
  assert.ok(!("jobId" in body) && !("durationSec" in body) && !("error" in body));
});

test("GET /api/runs/:id/video for an errored run returns 410", async (t) => {
  t.after(resetRunsAndJobs);
  fakeRuns["run-abc"] = {
    id: "run-abc",
    goal: "g",
    startUrl: "https://x.com",
    status: "error",
    error: "boom",
    actions: [],
    createdAt: 1700000000000,
  };

  const res = await fetch(`${base}/api/runs/run-abc/video`);
  assert.equal(res.status, 410);
});

test("GET /api/runs/:id/video for a still-recording run returns 202", async (t) => {
  t.after(resetRunsAndJobs);
  fakeRuns["run-abc"] = {
    id: "run-abc",
    goal: "g",
    startUrl: "https://x.com",
    status: "recording",
    actions: [],
    createdAt: 1700000000000,
  };

  const res = await fetch(`${base}/api/runs/run-abc/video`);
  assert.equal(res.status, 202);
});

test("GET /api/runs/:id/video for a done run with a stored videoUrl redirects to it", async (t) => {
  t.after(resetRunsAndJobs);
  fakeRuns["run-abc"] = {
    id: "run-abc",
    goal: "g",
    startUrl: "https://x.com",
    status: "done",
    jobId: "job-x",
    actions: [],
    createdAt: 1700000000000,
  };
  fakeJobRecords["job-x"] = {
    videoUrl: "https://cdn.example.com/v.mp4",
    id: "job-x",
    title: null,
    goal: "g",
    status: "done",
    userId: null,
    durationSec: 5,
    createdAt: 1700000000000,
  };

  const res = await fetch(`${base}/api/runs/run-abc/video`, { redirect: "manual" });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "https://cdn.example.com/v.mp4");

  const download = await fetch(`${base}/api/runs/run-abc/video?download=1`, { redirect: "manual" });
  assert.equal(download.status, 302);
  assert.equal(download.headers.get("location"), "https://cdn.example.com/v.mp4?download=job-x.mp4");
});

test("GET /api/runs/:id/video for a done run with no stored copy redirects to the local job route, preserving query", async (t) => {
  t.after(resetRunsAndJobs);
  fakeRuns["run-abc"] = {
    id: "run-abc",
    goal: "g",
    startUrl: "https://x.com",
    status: "done",
    jobId: "job-x",
    actions: [],
    createdAt: 1700000000000,
  };
  // fakeJobRecords["job-x"] intentionally left undefined (no stored copy).

  const res = await fetch(`${base}/api/runs/run-abc/video`, { redirect: "manual" });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "/api/jobs/job-x/video");

  const download = await fetch(`${base}/api/runs/run-abc/video?download=1`, { redirect: "manual" });
  assert.equal(download.status, 302);
  assert.equal(download.headers.get("location"), "/api/jobs/job-x/video?download=1");
});

// --- /api/me/videos ----------------------------------------------------

test("GET /api/me/videos with no Authorization header returns 401 (Clerk unconfigured)", async () => {
  // CLERK_SECRET_KEY is unset in this environment, so clerkUserId() always
  // returns undefined (auth "disabled") rather than null (invalid token) —
  // and the route treats any falsy id, undefined included, as "not signed
  // in". Worth pinning down: this is the surprising branch the task callout
  // flags, since undefined here means "Clerk isn't configured" rather than
  // "no token was sent", yet the route still 401s either way.
  const res = await fetch(`${base}/api/me/videos`);
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: "sign in required" });
});

// --- /api/videos/:jobId ---------------------------------------------------

test("GET /api/videos/:jobId for an unknown job returns 404 { error: 'video not found' }", async () => {
  const res = await fetch(`${base}/api/videos/job-doesnotexist`);
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "video not found" });
});

test("GET /api/videos/:jobId strips userId and includes author", async (t) => {
  t.after(resetRunsAndJobs);
  fakeJobRecords["job-y"] = {
    id: "job-y",
    status: "done",
    videoUrl: "https://cdn.example.com/y.mp4",
    userId: "user-secret",
    title: "T",
    goal: "g",
    durationSec: 3,
    createdAt: 1700000000000,
  };
  fakeAuthor = { name: "Ion Petro", imageUrl: null };

  const res = await fetch(`${base}/api/videos/job-y`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.author, { name: "Ion Petro", imageUrl: null });
  // Privacy-relevant: server.ts does `{ ...job, userId: undefined, author }`
  // and JSON.stringify drops undefined-valued keys, so userId must not
  // appear in the wire response at all — a real bug here would leak the
  // owning user's id to anyone with the (public) video link.
  assert.ok(!("userId" in body), "response body must not contain a userId key");
});

// --- /api/session/:id ----------------------------------------------------

test("POST /api/session/:id with no CURSOR_API_KEY/KERNEL_API_KEY returns 500 with the shared error body", async () => {
  const res = await fetch(`${base}/api/session/sess-test1`, { method: "POST", body: "{}" });
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: "CURSOR_API_KEY and KERNEL_API_KEY must be set on the server." });
});

// --- /api/jobs/:id/video (local-file fallback to storage) ------------------

test("GET /api/jobs/:id/video with no local file and no stored record returns 404 'video not found'", async () => {
  const res = await fetch(`${base}/api/jobs/job-nonexistent/video`);
  assert.equal(res.status, 404);
  assert.equal(await res.text(), "video not found");
});

test("GET /api/jobs/:id/video with no local file but a stored videoUrl redirects to it", async (t) => {
  t.after(resetRunsAndJobs);
  fakeJobRecords["job-z"] = { videoUrl: "https://cdn.example.com/z.mp4" };

  const res = await fetch(`${base}/api/jobs/job-z/video`, { redirect: "manual" });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "https://cdn.example.com/z.mp4");
});
