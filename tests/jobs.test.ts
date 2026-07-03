import "./helpers/env.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createJob, getJob, jobDir, DATA_DIR } from "../src/engine/jobs.ts";

test("createJob returns a job with expected shape (no owner)", () => {
  const before = Date.now();
  const job = createJob("say hello", "https://example.com");
  const after = Date.now();

  assert.match(job.id, /^job-[a-z0-9]+-[a-z0-9]{5}$/);
  assert.equal(job.status, "recording");
  assert.deepEqual(job.actions, []);
  assert.equal(job.goal, "say hello");
  assert.equal(job.startUrl, "https://example.com");
  assert.equal(job.userId, undefined);
  assert.equal(job.sessionId, undefined);
  assert.ok(job.createdAt >= before && job.createdAt <= after, "createdAt should be within [before, after]");
});

test("createJob passes through owner userId/sessionId", () => {
  const job = createJob("say hi", "https://example.com", { userId: "u1", sessionId: "s1" });
  assert.equal(job.userId, "u1");
  assert.equal(job.sessionId, "s1");
});

test("createJob with partial owner (only userId)", () => {
  const job = createJob("goal", "https://example.com", { userId: "u1" });
  assert.equal(job.userId, "u1");
  assert.equal(job.sessionId, undefined);
});

test("getJob returns the same object reference right after createJob", () => {
  const job = createJob("goal", "https://example.com");
  const fetched = getJob(job.id);
  assert.equal(fetched, job);
});

test("getJob returns undefined for an unknown id", () => {
  assert.equal(getJob("job-does-not-exist-00000"), undefined);
});

test("createJob produces unique ids across many calls", () => {
  const ids = new Set<string>();
  for (let i = 0; i < 20; i++) {
    const job = createJob("goal", "https://example.com");
    ids.add(job.id);
  }
  assert.equal(ids.size, 20, "all 20 generated ids should be unique");
});

test("jobDir returns path.join(DATA_DIR, 'jobs', id)", () => {
  const id = "job-abc123-xyz99";
  assert.equal(jobDir(id), path.join(DATA_DIR, "jobs", id));
});

test("DATA_DIR reflects DEMO_STUDIO_DATA_DIR set by the test bootstrap", () => {
  assert.equal(DATA_DIR, process.env.DEMO_STUDIO_DATA_DIR);
});
