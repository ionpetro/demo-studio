/**
 * Standalone API server for Railway — same routes as the Next.js API handlers,
 * without the UI bundle.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { verifyToken } from "@clerk/backend";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { getOrCreateSession } from "../src/engine/agent-session.ts";
import type { SessionEvent } from "../src/engine/types.ts";
import { jobDir } from "../src/engine/jobs.ts";
import { loadDemoRun } from "../src/engine/headless-run.ts";
import { buildMcpServer } from "./mcp.ts";

const PORT = Number(process.env.PORT ?? 3001);

function loadDotEnv() {
  const file = path.join(process.cwd(), ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

loadDotEnv();

const DEFAULT_ORIGINS = [
  "http://localhost:3000",
  "https://demo-studio-three.vercel.app",
];

function allowedOrigins(): string[] {
  const fromEnv = (process.env.FRONTEND_URL ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set([...DEFAULT_ORIGINS, ...fromEnv])];
}

function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  const list = allowedOrigins();
  if (list.includes("*") || list.includes(origin)) return true;
  if (process.env.ALLOW_VERCEL_ORIGINS === "0") return false;
  try {
    const { protocol, hostname } = new URL(origin);
    return protocol === "https:" && hostname.endsWith(".vercel.app");
  } catch {
    return false;
  }
}

function cors(origin: string | undefined): Record<string, string> {
  if (!isOriginAllowed(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version",
    Vary: "Origin",
  };
}

/** Public base URL for links returned to agents (watchUrl etc.). */
function publicBase(req: http.IncomingMessage): string {
  const fromEnv = (process.env.PUBLIC_URL ?? "").replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  const proto = (req.headers["x-forwarded-proto"] as string)?.split(",")[0] ?? "http";
  return `${proto}://${req.headers.host ?? `localhost:${PORT}`}`;
}

function mcpAuthorized(req: http.IncomingMessage): boolean {
  const token = process.env.MCP_AUTH_TOKEN;
  if (!token) return true;
  return req.headers.authorization === `Bearer ${token}`;
}

/**
 * Resolve the Clerk user for a request. Returns the user id, undefined when
 * Clerk isn't configured (auth disabled, e.g. bare local runs), or null for
 * an invalid/missing token when Clerk IS configured.
 */
async function clerkUserId(req: http.IncomingMessage): Promise<string | undefined | null> {
  if (!process.env.CLERK_SECRET_KEY) return undefined;
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;
  try {
    const claims = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY });
    return claims.sub;
  } catch {
    return null;
  }
}

function json(res: http.ServerResponse, status: number, body: unknown, origin?: string) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
    ...cors(origin),
  });
  res.end(payload);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
  const origin = req.headers.origin;
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const { pathname } = url;

  if (req.method === "OPTIONS") {
    res.writeHead(204, cors(origin));
    res.end();
    return;
  }

  if (req.method === "GET" && pathname === "/health") {
    json(res, 200, { ok: true }, origin);
    return;
  }

  // --- MCP endpoint (streamable HTTP, stateless) ---------------------------
  if (pathname === "/mcp") {
    if (!mcpAuthorized(req)) {
      json(res, 401, { jsonrpc: "2.0", error: { code: -32000, message: "Unauthorized" }, id: null }, origin);
      return;
    }
    if (req.method !== "POST") {
      json(res, 405, { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null }, origin);
      return;
    }
    if (!process.env.CURSOR_API_KEY || !process.env.KERNEL_API_KEY) {
      json(res, 500, { error: "CURSOR_API_KEY and KERNEL_API_KEY must be set on the server." }, origin);
      return;
    }
    let body: unknown;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      json(res, 400, { jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }, origin);
      return;
    }
    const mcpServer = buildMcpServer(publicBase(req));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
      mcpServer.close();
    });
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, body);
    return;
  }

  // --- Run status + stable watch URL for MCP-created runs ------------------
  const runMatch = pathname.match(/^\/api\/runs\/(run-[a-z0-9-]+)(\/video)?$/);
  if (req.method === "GET" && runMatch) {
    const run = await loadDemoRun(runMatch[1]);
    if (!run) {
      json(res, 404, { error: "run not found" }, origin);
      return;
    }
    const wantsVideo = Boolean(runMatch[2]);
    if (wantsVideo && run.status === "done" && run.jobId) {
      res.writeHead(302, { Location: `/api/jobs/${run.jobId}/video${url.search}`, ...cors(origin) });
      res.end();
      return;
    }
    // Not (yet) watchable: report status. 202 = still generating, 410 = failed.
    const status = !wantsVideo ? 200 : run.status === "error" ? 410 : 202;
    json(res, status, {
      runId: run.id,
      status: run.status,
      jobId: run.jobId,
      liveViewUrl: run.liveViewUrl,
      durationSec: run.durationSec,
      error: run.error,
      actions: run.actions,
    }, origin);
    return;
  }

  const sessionMatch = pathname.match(/^\/api\/session\/(sess-[a-z0-9-]+)$/);
  if (req.method === "POST" && sessionMatch) {
    if (!process.env.CURSOR_API_KEY || !process.env.KERNEL_API_KEY) {
      json(res, 500, { error: "CURSOR_API_KEY and KERNEL_API_KEY must be set on the server." }, origin);
      return;
    }

    const userId = await clerkUserId(req);
    if (userId === null) {
      json(res, 401, { error: "sign in required" }, origin);
      return;
    }

    const session = getOrCreateSession(sessionMatch[1]);
    session.setUser(userId);
    let message: unknown;
    try {
      message = JSON.parse(await readBody(req)).message;
    } catch {
      json(res, 400, { error: "invalid json" }, origin);
      return;
    }
    if (typeof message !== "string" || !message.trim()) {
      json(res, 400, { error: "message required" }, origin);
      return;
    }
    if (session.isBusy) {
      json(res, 409, { error: "agent is busy" }, origin);
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      ...cors(origin),
    });

    const send = (ev: SessionEvent) => {
      try {
        res.write(`data: ${JSON.stringify(ev)}\n\n`);
      } catch {
        cleanup();
      }
    };

    const unsubscribe = session.subscribe(send);
    const cleanup = () => unsubscribe();

    try {
      await session.handleMessage(message.trim());
    } finally {
      cleanup();
      res.end();
    }
    return;
  }

  const videoMatch = pathname.match(/^\/api\/jobs\/([a-z0-9-]+)\/video$/);
  if (req.method === "GET" && videoMatch) {
    const id = videoMatch[1];
    const file = path.join(jobDir(id), "final.mp4");
    if (!fs.existsSync(file)) {
      res.writeHead(404, cors(origin));
      res.end("video not found");
      return;
    }
    const stat = fs.statSync(file);
    const download = url.searchParams.has("download");

    const headers: Record<string, string> = {
      "Content-Type": "video/mp4",
      "Content-Length": String(stat.size),
      ...cors(origin),
      ...(download ? { "Content-Disposition": `attachment; filename="${id}.mp4"` } : {}),
    };
    res.writeHead(200, headers);
    const nodeStream = fs.createReadStream(file);
    nodeStream.pipe(res);
    return;
  }

  res.writeHead(404, cors(origin));
  res.end("not found");
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) json(res, 500, { error: "internal error" });
  });
});

server.listen(PORT, () => {
  console.log(`demo-studio backend listening on :${PORT}`);
});
