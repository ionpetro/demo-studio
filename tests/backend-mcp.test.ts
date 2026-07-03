// Tests for backend/mcp.ts — the MCP server exposing create_demo_video and
// get_demo_video tools.
//
// Approach: @modelcontextprotocol/sdk ships InMemoryTransport
// (@modelcontextprotocol/sdk/inMemory.js, via its "./*" export map wildcard),
// which creates a linked pair of transports for connecting a real Client to a
// real McpServer within the same process. We use that instead of the
// low-level "just list tool names off mcpServer.server" fallback, so we
// exercise the actual MCP request/response wire path (list_tools, call_tool,
// zod input validation, isError handling) exactly like a real MCP client
// would.
//
// ../src/engine/headless-run.ts and ../src/engine/db.ts are mocked (via
// node:test's mock.module) so no real browser/DB work ever happens. The
// specifier passed to mock.module is the *pathname* of a URL resolved
// relative to this file's import.meta.url — since tests/ and backend/ are
// both direct children of the repo root, "../src/engine/X.ts" resolves to
// the exact same absolute path whether resolved from tests/ or from
// backend/, so mock.module's path-based matching lines up with what
// backend/mcp.ts itself imports.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

// --- Fake state for the mocked engine modules, mutated per test -----------
// (Closures below capture these objects directly rather than reassigning
// them, so mutating their contents per-test is visible to already-mocked
// exports.)
const fakeRuns: Record<string, any> = {};
const fakeJobRecords: Record<string, any> = {};
const startDemoRunCalls: Array<{ goal: string; startUrl: string }> = [];

const CANNED_RUN = {
  id: "run-fake1",
  status: "planning" as const,
  actions: [] as unknown[],
  createdAt: 1700000000000,
};

const headlessRunSpec = new URL("../src/engine/headless-run.ts", import.meta.url).pathname;
const dbSpec = new URL("../src/engine/db.ts", import.meta.url).pathname;

mock.module(headlessRunSpec, {
  namedExports: {
    startDemoRun: (goal: string, startUrl: string) => {
      startDemoRunCalls.push({ goal, startUrl });
      return { ...CANNED_RUN, goal, startUrl };
    },
    loadDemoRun: async (id: string) => fakeRuns[id],
  },
});

mock.module(dbSpec, {
  namedExports: {
    loadJobRecord: async (id: string) => fakeJobRecords[id],
  },
});

// Must be a dynamic import so it happens after the mock.module calls above —
// static imports of mcp.ts (and its transitive imports) would be hoisted
// above these mock registrations.
const { buildMcpServer } = await import("../backend/mcp.ts");

async function connectedClient(server: Awaited<ReturnType<typeof buildMcpServer>>) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.1.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

function toolResultJson(result: any): any {
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0].type, "text");
  return JSON.parse(result.content[0].text);
}

// --- listTools: exact names/descriptions/schemas ---------------------------

test("listTools returns create_demo_video and get_demo_video with exact schemas", async () => {
  const server = buildMcpServer("https://demo.example.com");
  const client = await connectedClient(server);

  const { tools } = await client.listTools();
  assert.equal(tools.length, 2);

  const create = tools.find((t: any) => t.name === "create_demo_video") as any;
  assert.ok(create, "create_demo_video should be registered");
  assert.equal(create.title, "Create demo video");
  assert.match(create.description, /^Record a short browser demo video\./);
  assert.deepEqual(create.inputSchema.required, ["goal", "startUrl"]);
  assert.equal(create.inputSchema.properties.goal.type, "string");
  assert.equal(create.inputSchema.properties.goal.minLength, 1);
  assert.equal(create.inputSchema.properties.startUrl.type, "string");
  assert.equal(create.inputSchema.properties.startUrl.format, "uri");

  const get = tools.find((t: any) => t.name === "get_demo_video") as any;
  assert.ok(get, "get_demo_video should be registered");
  assert.equal(get.title, "Get demo video status");
  assert.match(get.description, /^Check the status of a demo video run/);
  assert.deepEqual(get.inputSchema.required, ["runId"]);
  assert.equal(get.inputSchema.properties.runId.type, "string");
});

// --- create_demo_video happy path ------------------------------------------

test("create_demo_video invokes startDemoRun with exact args and returns runSnapshot shape", async () => {
  startDemoRunCalls.length = 0;
  const server = buildMcpServer("https://demo.example.com");
  const client = await connectedClient(server);

  const result = await client.callTool({
    name: "create_demo_video",
    arguments: { goal: "test goal", startUrl: "https://example.com" },
  });

  assert.deepEqual(startDemoRunCalls.at(-1), { goal: "test goal", startUrl: "https://example.com" });

  const body = toolResultJson(result);
  assert.equal(body.runId, "run-fake1");
  assert.equal(body.status, "planning");
  assert.equal(body.watchUrl, "https://demo.example.com/api/runs/run-fake1/video");
  assert.equal(body.shareable, true);
  assert.equal(body.statusUrl, "https://demo.example.com/api/runs/run-fake1");
  assert.equal(body.liveViewUrl, undefined);
  assert.equal(body.durationSec, undefined);
  assert.equal(body.error, undefined);
  assert.equal(body.actionsSoFar, 0);
  assert.equal(body.lastAction, undefined);
  assert.equal("linkNote" in body, false, "shareable result should not include linkNote");
  assert.match(body.note, /^Video generation started\. Share the watchUrl now/);
});

// --- get_demo_video: unknown run -------------------------------------------

test("get_demo_video with an unknown runId returns isError:true with the id in the message", async () => {
  const server = buildMcpServer("https://demo.example.com");
  const client = await connectedClient(server);

  const result = await client.callTool({ name: "get_demo_video", arguments: { runId: "run-does-not-exist" } });

  assert.equal(result.isError, true);
  const body = toolResultJson(result);
  assert.match(body.error, /run-does-not-exist/);
});

// --- shareability logic (isShareableBase is unexported, so we exercise it
// only through tool-call results, per task instructions) --------------------

test("create_demo_video against a localhost base is not shareable and includes linkNote", async () => {
  const server = buildMcpServer("http://localhost:3001");
  const client = await connectedClient(server);

  const result = await client.callTool({
    name: "create_demo_video",
    arguments: { goal: "g", startUrl: "https://example.com" },
  });
  const body = toolResultJson(result);

  assert.equal(body.shareable, false);
  assert.ok(body.linkNote, "linkNote should be present for a non-shareable base");
  assert.match(body.linkNote, /only resolves on the machine running the backend/);
  assert.match(body.note, /^Video generation started\. Do NOT share this watchUrl/);
});

test("create_demo_video against a public https base is shareable with no linkNote", async () => {
  const server = buildMcpServer("https://demo.example.com");
  const client = await connectedClient(server);

  const result = await client.callTool({
    name: "create_demo_video",
    arguments: { goal: "g", startUrl: "https://example.com" },
  });
  const body = toolResultJson(result);

  assert.equal(body.shareable, true);
  assert.equal("linkNote" in body, false);
});

test("get_demo_video prefers the stored job videoUrl and is shareable even on a localhost base", async () => {
  fakeRuns["run-done1"] = {
    ...CANNED_RUN,
    id: "run-done1",
    goal: "g",
    startUrl: "https://example.com",
    status: "done",
    jobId: "job-x",
  };
  fakeJobRecords["job-x"] = {
    id: "job-x",
    title: null,
    goal: "g",
    status: "done",
    userId: null,
    videoUrl: "https://cdn.example.com/v.mp4",
    durationSec: 5,
    createdAt: 1700000000000,
  };

  // Base itself is non-shareable (localhost), but a stored videoUrl should
  // still force shareable: true and become the watchUrl, per
  // `shareable = Boolean(storedUrl) || isShareableBase(baseUrl)` and
  // `watchUrl: storedUrl ?? ...` in backend/mcp.ts.
  const server = buildMcpServer("http://localhost:3001");
  const client = await connectedClient(server);

  const result = await client.callTool({ name: "get_demo_video", arguments: { runId: "run-done1" } });
  const body = toolResultJson(result);

  assert.equal(body.shareable, true);
  assert.equal(body.watchUrl, "https://cdn.example.com/v.mp4");
  assert.equal("linkNote" in body, false);
});
