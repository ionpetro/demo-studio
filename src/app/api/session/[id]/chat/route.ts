import { NextResponse } from "next/server";
import { getSession } from "@/engine/agent-session";

export const runtime = "nodejs";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });

  const { message } = await req.json();
  if (typeof message !== "string" || !message.trim()) {
    return NextResponse.json({ error: "message required" }, { status: 400 });
  }
  if (session.isBusy) {
    return NextResponse.json({ error: "agent is busy" }, { status: 409 });
  }

  // Fire and forget — all output flows through the events SSE stream.
  void session.handleMessage(message.trim());
  return NextResponse.json({ ok: true }, { status: 202 });
}
