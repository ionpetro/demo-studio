import { getAuthor } from "@/engine/author";
import { loadJobRecord } from "@/engine/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^job-[a-z0-9-]+$/.test(id)) return Response.json({ error: "invalid id" }, { status: 400 });
  const job = await loadJobRecord(id);
  if (!job || job.status !== "done" || !job.videoUrl) {
    return Response.json({ error: "video not found" }, { status: 404 });
  }
  const author = await getAuthor(job.userId);
  return Response.json({ ...job, userId: undefined, author });
}
