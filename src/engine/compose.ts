import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { Overlays } from "./browser-session.ts";
import type { FrameRef, TimedCaption } from "./types.ts";

const execFileAsync = promisify(execFile);

// Async so a long encode never blocks the server's event loop; the timeout
// keeps a hung ffmpeg from wedging the job forever.
const ff = async (args: string[], cwd: string) => {
  try {
    await execFileAsync("ffmpeg", ["-y", "-loglevel", "error", ...args], { cwd, timeout: 10 * 60_000 });
  } catch (err) {
    // exec errors only carry the command line; the actual cause is on stderr.
    const stderr = (err as { stderr?: string }).stderr?.trim().slice(-500);
    throw new Error(`${err instanceof Error ? err.message : err}${stderr ? `\nffmpeg stderr: ${stderr}` : ""}`);
  }
};

/**
 * Full-frame backdrop the (padded, rounded) recording is composited onto.
 * Resolved from the repo root rather than `import.meta.url` so it survives
 * Next.js's webpack bundling (which rewrites `new URL(..., import.meta.url)`).
 */
const BG_PATH = path.join(process.cwd(), "src/engine/assets/background.png");

export interface ComposeInput {
  frames: FrameRef[];
  captions: TimedCaption[];
  overlays: Overlays;
  outDir: string;
  width: number;
  height: number;
  fps: number;
}

export interface ComposeResult {
  finalPath: string;
  rawPath: string;
  durationSec: number;
  frameCount: number;
}

/**
 * Stitch screencast frames into a captioned, branded MP4.
 * Inter-frame duration is capped at 1.6s — the screencast only emits frames
 * when pixels change, so long agent "thinking" pauses collapse automatically.
 */
export async function composeVideo(input: ComposeInput): Promise<ComposeResult> {
  const { frames, captions, overlays, outDir } = input;
  const W = input.width, H = input.height, FPS = input.fps;
  if (!frames.length) throw new Error("no frames captured");

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "demo-studio-"));
  fs.mkdirSync(outDir, { recursive: true });

  const t0 = frames[0].t;
  const lines: string[] = [];
  let total = 0;
  frames.forEach((f, i) => {
    let dur = i < frames.length - 1 ? (frames[i + 1].t - f.t) / 1000 : 0.8;
    dur = Math.max(0.02, Math.min(1.6, dur));
    total += dur;
    lines.push(`file '${f.file.replace(/'/g, "'\\''")}'`, `duration ${dur.toFixed(3)}`);
  });
  lines.push(`file '${frames[frames.length - 1].file.replace(/'/g, "'\\''")}'`);
  fs.writeFileSync(path.join(tmp, "concat.txt"), lines.join("\n") + "\n");

  overlays.caps.forEach((b, i) => fs.writeFileSync(path.join(tmp, `cap_${i}.png`), Buffer.from(b, "base64")));

  // Caption windows on the compressed timeline: map each caption's real capture
  // time to video time by summing the capped frame durations up to it.
  const videoTimeAt = (t: number): number => {
    let vt = 0;
    for (let i = 0; i < frames.length - 1; i++) {
      if (frames[i].t >= t) break;
      vt += Math.max(0.02, Math.min(1.6, (frames[i + 1].t - frames[i].t) / 1000));
    }
    return vt;
  };

  // Inset the recording inside the backdrop with even padding + rounded corners.
  const PAD = Math.round(W * 0.04);
  const RADIUS = Math.round(Math.min(W, H) * 0.025);
  const IW = W - PAD * 2, IH = H - PAD * 2;

  // Input 0 = recording frames, 1 = backdrop, then captions.
  // Fall back to a solid-black backdrop if the image asset is missing.
  const bgInput = fs.existsSync(BG_PATH)
    ? ["-i", BG_PATH]
    : ["-f", "lavfi", "-i", `color=c=black:s=${W}x${H}`];
  const inputs = ["-f", "concat", "-safe", "0", "-i", "concat.txt", ...bgInput];
  overlays.caps.forEach((_, i) => inputs.push("-i", `cap_${i}.png`));
  const capBase = 2;

  // Alpha = opaque everywhere except outside the corner-radius arcs → rounded corners.
  const r = RADIUS;
  const rounded =
    `a='if(gt(abs(X-W/2),W/2-${r})*gt(abs(Y-H/2),H/2-${r}),` +
    `if(lte(hypot(abs(X-W/2)-(W/2-${r}),abs(Y-H/2)-(H/2-${r})),${r}),255,0),255)'`;

  let fc =
    `[1:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1[bg]` +
    `;[0:v]scale=${IW}:${IH}:force_original_aspect_ratio=decrease:force_divisible_by=2,fps=${FPS},` +
    `format=yuva420p,geq=lum='p(X,Y)':cb='p(X,Y)':cr='p(X,Y)':${rounded}[fg]` +
    `;[bg][fg]overlay=x=(W-w)/2:y=(H-h)/2[comp]`;
  let cur = "comp";
  captions.forEach((c, i) => {
    const s = Math.max(0, videoTimeAt(Math.max(c.t, t0)));
    const e = i < captions.length - 1 ? Math.max(s, videoTimeAt(captions[i + 1].t)) : total;
    const lbl = `c${i}`;
    fc += `;[${cur}][${capBase + i}:v]overlay=x=(W-w)/2:y=H-${PAD}-h-24:enable='between(t,${s.toFixed(2)},${e.toFixed(2)})'[${lbl}]`;
    cur = lbl;
  });
  fc += `;[${cur}]format=yuv420p[v]`;
  await ff([...inputs, "-filter_complex", fc, "-map", "[v]", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "22", "main.mp4"], tmp);

  const finalPath = path.join(outDir, "final.mp4");
  const rawPath = path.join(outDir, "raw.mp4");
  fs.copyFileSync(path.join(tmp, "main.mp4"), finalPath);
  fs.copyFileSync(path.join(tmp, "main.mp4"), rawPath);
  fs.rmSync(tmp, { recursive: true, force: true });

  return { finalPath, rawPath, durationSec: +total.toFixed(2), frameCount: frames.length };
}
