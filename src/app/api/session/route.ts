import { NextResponse } from "next/server";
import { createSession } from "@/engine/agent-session";

export const runtime = "nodejs";

export async function POST() {
  if (!process.env.CURSOR_API_KEY || !process.env.KERNEL_API_KEY) {
    return NextResponse.json(
      { error: "Set CURSOR_API_KEY and KERNEL_API_KEY in .env, then restart the dev server." },
      { status: 500 },
    );
  }
  const session = createSession();
  return NextResponse.json({ sessionId: session.id });
}
