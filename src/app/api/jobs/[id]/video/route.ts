import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { loadJobRecord } from "@/engine/db";
import { jobDir } from "@/engine/jobs";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-z0-9-]+$/.test(id)) return new Response("bad id", { status: 400 });

  const file = path.join(jobDir(id), "final.mp4");
  const download = new URL(req.url).searchParams.has("download");
  if (!fs.existsSync(file)) {
    // Recorded on another machine (or the disk was wiped): fall back to the
    // durable storage copy so the stable link works from any instance.
    const stored = (await loadJobRecord(id))?.videoUrl;
    if (stored) return Response.redirect(download ? `${stored}?download=${id}.mp4` : stored, 302);
    return new Response("video not found", { status: 404 });
  }

  const stat = fs.statSync(file);
  const stream = Readable.toWeb(fs.createReadStream(file)) as ReadableStream;

  return new Response(stream, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(stat.size),
      ...(download ? { "Content-Disposition": `attachment; filename="${id}.mp4"` } : {}),
    },
  });
}
