import { test } from "node:test";
import assert from "node:assert/strict";
import { timeAgo } from "../src/lib/timeago.ts";

// timeAgo() calls Date.now() internally (no injectable clock), so we compute
// each timestamp as Date.now() - deltaMs immediately before calling it.
// Deltas are chosen comfortably inside/across each threshold boundary (60,
// 3600, 86400, 604800, 2629800 seconds) rather than exactly on them, to avoid
// flakiness from the few ms of jitter between computing the timestamp and
// timeAgo() calling Date.now() again.

test("5s ago -> 'just now'", () => {
  assert.equal(timeAgo(Date.now() - 5_000), "just now");
});

test("59s ago -> 'just now' (just under the 60s boundary)", () => {
  assert.equal(timeAgo(Date.now() - 59_000), "just now");
});

test("65s ago -> '1m ago' (just over the 60s boundary)", () => {
  assert.equal(timeAgo(Date.now() - 65_000), "1m ago");
});

test("15 minutes ago -> '15m ago'", () => {
  assert.equal(timeAgo(Date.now() - 15 * 60_000), "15m ago");
});

test("~61.6 minutes ago -> '1h ago' (just over the 3600s boundary)", () => {
  assert.equal(timeAgo(Date.now() - 3_700_000), "1h ago");
});

test("5 hours ago -> '5h ago'", () => {
  assert.equal(timeAgo(Date.now() - 5 * 3_600_000), "5h ago");
});

test("2 days ago -> '2d ago'", () => {
  assert.equal(timeAgo(Date.now() - 2 * 86_400_000 - 60_000), "2d ago");
});

test("3 weeks ago -> '3w ago'", () => {
  assert.equal(timeAgo(Date.now() - 3 * 604_800_000 - 60_000), "3w ago");
});

test("40 days ago (past the ~30.4 day / 2629800s cutoff) falls through to the date fallback", () => {
  const result = timeAgo(Date.now() - 40 * 86_400_000);
  assert.doesNotMatch(result, /ago$/);
  assert.match(result, /[A-Za-z]{3} \d{1,2}, \d{4}/);
});

test("timeAgo(Date.now()) (delta ~= 0) -> 'just now'", () => {
  assert.equal(timeAgo(Date.now()), "just now");
});

test("a timestamp slightly in the future is clamped to 0 seconds via Math.max(0, ...) -> 'just now'", () => {
  assert.equal(timeAgo(Date.now() + 10_000), "just now");
});

test("a timestamp far in the future is also clamped to 0 seconds -> 'just now'", () => {
  assert.equal(timeAgo(Date.now() + 10_000_000), "just now");
});
