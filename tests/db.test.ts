import { test, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {
  dbEnabled,
  persistSession,
  persistMessage,
  persistJob,
  persistRun,
  listUserJobs,
  loadJobRecord,
  loadRunRecord,
  flushDb,
} from "../src/engine/db.ts";
import type { RunRecord } from "../src/engine/db.ts";
import type { DemoJob, ChatPart } from "../src/engine/types.ts";

// ---- Monkeypatch pg.Pool.prototype.query so no real socket ever opens. ----
// We keep the REAL pg.Pool class (getPool() still constructs one); we only
// intercept its `.query` method. Installed once at module load so it's in
// place for every test in this file, including the "disabled" tests below
// (which should never call it at all).
interface Call {
  sql: string;
  params: unknown[];
}
const calls: Call[] = [];
// Optional per-test override of the canned response / error. Reset to null
// (default `{ rows: [] }` response) after each test that sets it.
let responder: ((sql: string, params: unknown[]) => Promise<{ rows: any[] }>) | null = null;
const origQuery = pg.Pool.prototype.query;
(pg.Pool.prototype as any).query = function (sql: string, params?: unknown[]) {
  const p = params ?? [];
  calls.push({ sql, params: p });
  if (responder) return responder(sql, p);
  return Promise.resolve({ rows: [] });
};
after(() => {
  pg.Pool.prototype.query = origQuery;
});

function callsMatching(substr: string): Call[] {
  return calls.filter((c) => c.sql.includes(substr));
}

function withSilencedConsoleError<T>(fn: () => Promise<T>): Promise<{ result: T; errors: unknown[][] }> {
  const orig = console.error;
  const errors: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    errors.push(args);
  };
  return fn()
    .then((result) => ({ result, errors }))
    .finally(() => {
      console.error = orig;
    });
}

// ===========================================================================
// Section 1: DATABASE_URL unset -> dbEnabled() false -> everything no-ops.
// Run this section FIRST, before DATABASE_URL is ever set, so we know the
// disabled code path is genuinely exercised (not just "happens to return
// early because of a mock").
// ===========================================================================

test("dbEnabled() is false when DATABASE_URL is unset", () => {
  delete process.env.DATABASE_URL;
  assert.equal(dbEnabled(), false);
});

test("persist* functions no-op (no query call) when DATABASE_URL is unset", async () => {
  delete process.env.DATABASE_URL;
  const before = calls.length;
  persistSession("s1", "u1");
  persistMessage("s1", "user", [{ type: "text", text: "hi" }]);
  persistJob({
    id: "j1",
    goal: "g",
    startUrl: "https://x",
    status: "recording",
    actions: [],
    createdAt: Date.now(),
  });
  persistRun({
    id: "r1",
    goal: "g",
    startUrl: "https://x",
    status: "recording",
    actions: [],
    createdAt: Date.now(),
  });
  await flushDb();
  assert.equal(calls.length, before, "no query should have been issued while disabled");
});

test("listUserJobs/loadJobRecord/loadRunRecord resolve to []/undefined/undefined when DATABASE_URL unset", async () => {
  delete process.env.DATABASE_URL;
  const before = calls.length;
  assert.deepEqual(await listUserJobs("u1"), []);
  assert.equal(await loadJobRecord("j1"), undefined);
  assert.equal(await loadRunRecord("r1"), undefined);
  assert.equal(calls.length, before, "no query should have been issued while disabled");
});

test("flushDb() resolves to undefined even with nothing queued", async () => {
  const result = await flushDb();
  assert.equal(result, undefined);
});

// ===========================================================================
// Section 2: DATABASE_URL set -> dbEnabled() true -> exercise real queries
// (against the mocked pg.Pool.prototype.query).
// ===========================================================================

test("dbEnabled() is true once DATABASE_URL is set", () => {
  process.env.DATABASE_URL = "postgres://fake/fake";
  assert.equal(dbEnabled(), true);
});

test("persistSession inserts with userId, and coerces missing userId to null", async () => {
  process.env.DATABASE_URL = "postgres://fake/fake";
  persistSession("sess-1", "user-1");
  persistSession("sess-2", undefined);
  await flushDb();

  const matches = callsMatching("insert into demo_sessions");
  assert.equal(matches.length, 2);
  assert.deepEqual(matches[0].params, ["sess-1", "user-1"]);
  assert.deepEqual(matches[1].params, ["sess-2", null]);
});

test("persistMessage inserts session_id, role, and JSON-stringified parts", async () => {
  process.env.DATABASE_URL = "postgres://fake/fake";
  const parts: ChatPart[] = [
    { type: "text", text: "hello" },
    { type: "tool-call", toolCallId: "tc1", toolName: "click" },
  ];
  persistMessage("sess-1", "assistant", parts);
  await flushDb();

  const matches = callsMatching("insert into demo_messages");
  assert.equal(matches.length, 1);
  assert.deepEqual(matches[0].params, ["sess-1", "assistant", JSON.stringify(parts)]);
});

test("persistJob inserts full params in exact order for a fully-populated job", async () => {
  process.env.DATABASE_URL = "postgres://fake/fake";
  const job: DemoJob = {
    id: "job-full",
    goal: "record a demo",
    title: "My Demo",
    startUrl: "https://example.com",
    status: "done",
    userId: "user-1",
    sessionId: "sess-1",
    actions: [{ n: 1, action: "click", caption: "click it", ok: true }],
    videoUrl: "https://videos/x.mp4",
    durationSec: 42.5,
    error: undefined,
    createdAt: 1700000000000,
  };
  persistJob(job);
  await flushDb();

  const matches = callsMatching("insert into demo_jobs (id");
  assert.equal(matches.length, 1);
  assert.deepEqual(matches[0].params, [
    "job-full",
    "user-1",
    "sess-1",
    "record a demo",
    "My Demo",
    "https://example.com",
    "done",
    JSON.stringify(job.actions),
    "https://videos/x.mp4",
    42.5,
    null, // error ?? null
    1700000000000,
  ]);
});

test("persistJob coerces undefined optional fields to null for a minimal job", async () => {
  process.env.DATABASE_URL = "postgres://fake/fake";
  const job: DemoJob = {
    id: "job-min",
    goal: "minimal",
    startUrl: "https://example.com",
    status: "recording",
    actions: [],
    createdAt: 1700000001000,
  };
  persistJob(job);
  await flushDb();

  const matches = callsMatching("insert into demo_jobs (id");
  assert.equal(matches.length, 2, "one from the previous test, one from this one");
  const params = matches[1].params;
  assert.deepEqual(params, [
    "job-min",
    null, // userId
    null, // sessionId
    "minimal",
    null, // title
    "https://example.com",
    "recording",
    JSON.stringify([]),
    null, // videoUrl
    null, // durationSec
    null, // error
    1700000001000,
  ]);
});

test("persistRun inserts full params in exact order for a fully-populated run", async () => {
  process.env.DATABASE_URL = "postgres://fake/fake";
  const run: RunRecord = {
    id: "run-full",
    goal: "record a demo",
    startUrl: "https://example.com",
    status: "done",
    userId: "user-1",
    jobId: "job-full",
    liveViewUrl: "https://live/view",
    durationSec: 10.25,
    error: undefined,
    actions: [{ some: "action" }],
    createdAt: 1700000002000,
  };
  persistRun(run);
  await flushDb();

  const matches = callsMatching("insert into demo_runs (id");
  assert.equal(matches.length, 1);
  assert.deepEqual(matches[0].params, [
    "run-full",
    "user-1",
    "record a demo",
    "https://example.com",
    "done",
    "job-full",
    "https://live/view",
    10.25,
    null, // error ?? null
    JSON.stringify(run.actions),
    1700000002000,
  ]);
});

test("persistRun coerces undefined optional fields to null for a minimal run", async () => {
  process.env.DATABASE_URL = "postgres://fake/fake";
  const run: RunRecord = {
    id: "run-min",
    goal: "minimal",
    startUrl: "https://example.com",
    status: "recording",
    actions: [],
    createdAt: 1700000003000,
  };
  persistRun(run);
  await flushDb();

  const matches = callsMatching("insert into demo_runs (id");
  assert.equal(matches.length, 2);
  assert.deepEqual(matches[1].params, [
    "run-min",
    null, // userId
    "minimal",
    "https://example.com",
    "recording",
    null, // jobId
    null, // liveViewUrl
    null, // durationSec
    null, // error
    JSON.stringify([]),
    1700000003000,
  ]);
});

test("listUserJobs maps canned rows to camelCase JobRecord[]", async () => {
  process.env.DATABASE_URL = "postgres://fake/fake";
  const createdAt = new Date(1700000000000);
  responder = async (sql) => {
    if (sql.includes("from demo_jobs where user_id")) {
      return {
        rows: [
          {
            id: "job-1",
            title: null,
            goal: "g",
            status: "done",
            user_id: "u1",
            video_url: "http://x/video.mp4",
            duration_sec: 12.3,
            created_at: createdAt,
          },
        ],
      };
    }
    return { rows: [] };
  };
  const result = await listUserJobs("u1");
  responder = null;

  assert.deepEqual(result, [
    {
      id: "job-1",
      title: null,
      goal: "g",
      status: "done",
      userId: "u1",
      videoUrl: "http://x/video.mp4",
      durationSec: 12.3,
      createdAt: createdAt.getTime(),
    },
  ]);
});

test("listUserJobs resolves to [] and logs (not throws) on query error", async () => {
  process.env.DATABASE_URL = "postgres://fake/fake";
  responder = async () => {
    throw new Error("boom");
  };
  const { result, errors } = await withSilencedConsoleError(() => listUserJobs("u1"));
  responder = null;

  assert.deepEqual(result, []);
  assert.ok(errors.length >= 1, "should have logged the error");
});

test("loadJobRecord maps a single canned row to a camelCase JobRecord", async () => {
  process.env.DATABASE_URL = "postgres://fake/fake";
  const createdAt = new Date(1700000005000);
  responder = async (sql) => {
    if (sql.includes("from demo_jobs where id")) {
      return {
        rows: [
          {
            id: "job-2",
            title: "A title",
            goal: "g2",
            status: "error",
            user_id: null,
            video_url: null,
            duration_sec: null,
            created_at: createdAt,
          },
        ],
      };
    }
    return { rows: [] };
  };
  const result = await loadJobRecord("job-2");
  responder = null;

  assert.deepEqual(result, {
    id: "job-2",
    title: "A title",
    goal: "g2",
    status: "error",
    userId: null,
    videoUrl: null,
    durationSec: null,
    createdAt: createdAt.getTime(),
  });
});

test("loadJobRecord resolves to undefined when no row matches", async () => {
  process.env.DATABASE_URL = "postgres://fake/fake";
  responder = async (sql) => {
    if (sql.includes("from demo_jobs where id")) return { rows: [] };
    return { rows: [] };
  };
  const result = await loadJobRecord("does-not-exist");
  responder = null;
  assert.equal(result, undefined);
});

test("loadJobRecord resolves to undefined and logs (not throws) on query error", async () => {
  process.env.DATABASE_URL = "postgres://fake/fake";
  responder = async () => {
    throw new Error("boom");
  };
  const { result, errors } = await withSilencedConsoleError(() => loadJobRecord("job-x"));
  responder = null;

  assert.equal(result, undefined);
  assert.ok(errors.length >= 1, "should have logged the error");
});

test("loadRunRecord maps a fully-populated canned row to a RunRecord", async () => {
  process.env.DATABASE_URL = "postgres://fake/fake";
  const createdAt = new Date(1700000006000);
  responder = async (sql) => {
    if (sql.includes("from demo_runs where id")) {
      return {
        rows: [
          {
            id: "run-2",
            goal: "g3",
            start_url: "https://x",
            status: "done",
            user_id: "u2",
            job_id: "job-2",
            live_view_url: "https://live",
            duration_sec: 5.5,
            error: null,
            actions: [{ a: 1 }],
            created_at: createdAt,
          },
        ],
      };
    }
    return { rows: [] };
  };
  const result = await loadRunRecord("run-2");
  responder = null;

  assert.deepEqual(result, {
    id: "run-2",
    goal: "g3",
    startUrl: "https://x",
    status: "done",
    userId: "u2",
    jobId: "job-2",
    liveViewUrl: "https://live",
    durationSec: 5.5,
    error: undefined, // null ?? undefined
    actions: [{ a: 1 }],
    createdAt: createdAt.getTime(),
  });
});

test("loadRunRecord defaults actions to [] when the column is null", async () => {
  process.env.DATABASE_URL = "postgres://fake/fake";
  const createdAt = new Date(1700000007000);
  responder = async (sql) => {
    if (sql.includes("from demo_runs where id")) {
      return {
        rows: [
          {
            id: "run-3",
            goal: "g4",
            start_url: "https://x",
            status: "recording",
            user_id: null,
            job_id: null,
            live_view_url: null,
            duration_sec: null,
            error: null,
            actions: null,
            created_at: createdAt,
          },
        ],
      };
    }
    return { rows: [] };
  };
  const result = await loadRunRecord("run-3");
  responder = null;

  assert.deepEqual(result?.actions, []);
  assert.equal(result?.userId, undefined);
  assert.equal(result?.jobId, undefined);
  assert.equal(result?.liveViewUrl, undefined);
  assert.equal(result?.durationSec, undefined);
});

test("loadRunRecord resolves to undefined when no row matches", async () => {
  process.env.DATABASE_URL = "postgres://fake/fake";
  responder = async (sql) => {
    if (sql.includes("from demo_runs where id")) return { rows: [] };
    return { rows: [] };
  };
  const result = await loadRunRecord("does-not-exist");
  responder = null;
  assert.equal(result, undefined);
});

test("loadRunRecord resolves to undefined and logs (not throws) on query error", async () => {
  process.env.DATABASE_URL = "postgres://fake/fake";
  responder = async () => {
    throw new Error("boom");
  };
  const { result, errors } = await withSilencedConsoleError(() => loadRunRecord("run-x"));
  responder = null;

  assert.equal(result, undefined);
  assert.ok(errors.length >= 1, "should have logged the error");
});

test("ensureSchema DDL ran exactly once across the whole file (schemaReady is a singleton)", () => {
  const ddlCalls = callsMatching("create table if not exists demo_sessions");
  assert.equal(ddlCalls.length, 1);
});
