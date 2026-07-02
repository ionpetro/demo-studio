import { auth } from "@clerk/nextjs/server";
import { listUserJobs } from "@/engine/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "sign in required" }, { status: 401 });
  return Response.json({ videos: await listUserJobs(userId) });
}
