import { execFileSync } from "node:child_process";
import fs from "node:fs";

/** Container duration in seconds, via ffprobe. */
export function ffprobeDuration(file: string): number {
  const out = execFileSync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    file,
  ]).toString("utf8").trim();
  return Number(out);
}

/** RGB of a single pixel at (x, y) in the frame closest to `atSec`. */
export function pixelAt(file: string, atSec: number, x: number, y: number): [number, number, number] {
  const out = execFileSync("ffmpeg", [
    "-y", "-loglevel", "error",
    "-ss", atSec.toFixed(3),
    "-i", file,
    "-frames:v", "1",
    // format=rgb24 before crop: cropping a 1x1 region directly on yuv420p rounds
    // the chroma plane crop down to 0px and ffmpeg refuses to filter it.
    "-vf", `format=rgb24,crop=1:1:${x}:${y}`,
    "-f", "rawvideo",
    "-pix_fmt", "rgb24",
    "-",
  ]);
  if (out.length < 3) throw new Error(`pixelAt got ${out.length} bytes, expected >= 3`);
  return [out[0], out[1], out[2]];
}

/** Generate a small solid-color, fully opaque PNG (no alpha channel needed for our pixel checks). */
export function makeSolidPng(dir: string, name: string, color: string, w: number, h: number): string {
  fs.mkdirSync(dir, { recursive: true });
  const path = `${dir}/${name}`;
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=${color}:s=${w}x${h}`, "-frames:v", "1", path]);
  return path;
}
