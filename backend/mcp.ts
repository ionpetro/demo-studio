/**
 * MCP server for Demo Studio — lets external coding agents (Claude Code,
 * Cursor, Codex, …) request demo videos over streamable HTTP at /mcp.
 *
 * Stateless: a fresh McpServer + transport is created per request, so no MCP
 * session affinity is needed. Runs themselves live in the engine's run
 * registry (src/engine/headless-run.ts).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { startDemoRun, getDemoRun, type DemoRun } from "../src/engine/headless-run.ts";

function runSnapshot(run: DemoRun, baseUrl: string) {
  return {
    runId: run.id,
    status: run.status,
    // Stable link — works as soon as the run exists, streams the MP4 once done.
    watchUrl: `${baseUrl}/api/runs/${run.id}/video`,
    statusUrl: `${baseUrl}/api/runs/${run.id}`,
    liveViewUrl: run.liveViewUrl,
    durationSec: run.durationSec,
    error: run.error,
    actionsSoFar: run.actions.length,
    lastAction: run.actions.at(-1)?.caption,
  };
}

const asText = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });

export function buildMcpServer(baseUrl: string): McpServer {
  const server = new McpServer({ name: "demo-studio", version: "0.1.0" });

  server.registerTool(
    "create_demo_video",
    {
      title: "Create demo video",
      description:
        "Record a short browser demo video. An agent drives a real cloud browser through the goal on a live " +
        "public web page, captures every frame, and composes a captioned, branded MP4. Returns immediately " +
        "with a runId and a stable watchUrl; generation takes a few minutes — poll get_demo_video until " +
        "status is 'done'. Public pages only: the agent never logs in, signs up, pays, or changes data.",
      inputSchema: {
        goal: z.string().min(1).describe("What the video should demonstrate, in one or two sentences."),
        startUrl: z.string().url().describe("Full https:// URL of the page where the demo starts."),
      },
    },
    async ({ goal, startUrl }) => {
      const run = startDemoRun(goal, startUrl);
      return asText({
        ...runSnapshot(run, baseUrl),
        note: "Video generation started. Share the watchUrl now (it is stable), then poll get_demo_video every ~30s until status is 'done'.",
      });
    },
  );

  server.registerTool(
    "get_demo_video",
    {
      title: "Get demo video status",
      description:
        "Check the status of a demo video run created with create_demo_video. Status is one of: planning, " +
        "recording, composing, done, error. When 'done', the watchUrl serves the final MP4.",
      inputSchema: {
        runId: z.string().describe("The runId returned by create_demo_video."),
      },
    },
    async ({ runId }) => {
      const run = getDemoRun(runId);
      if (!run) return { ...asText({ error: `no run with id ${runId}` }), isError: true };
      return asText(runSnapshot(run, baseUrl));
    },
  );

  return server;
}
