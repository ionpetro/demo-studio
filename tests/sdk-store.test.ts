import "./helpers/env.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { getLocalAgentStore } from "../src/engine/sdk-store.ts";

test("getLocalAgentStore() does not throw with DEMO_STUDIO_DATA_DIR set", () => {
  assert.doesNotThrow(() => getLocalAgentStore());
});

test("getLocalAgentStore() returns the same singleton instance on repeated calls", () => {
  const first = getLocalAgentStore();
  const second = getLocalAgentStore();
  const third = getLocalAgentStore();
  assert.equal(first, second);
  assert.equal(second, third);
});

test("getLocalAgentStore() returns a truthy instance", () => {
  const store = getLocalAgentStore();
  assert.ok(store);
});
