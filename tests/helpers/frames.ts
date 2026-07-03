import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FrameRef } from "../../src/engine/types.ts";

/** A known-good 1x1 transparent PNG, base64-encoded (same bytes browser-session.ts uses as its blank fallback). */
export const BLANK_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/** Generate a small solid-color JPEG frame on disk via the real ffmpeg binary. */
export function makeFrame(dir: string, name: string, color: string, size = "64x48"): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=${color}:s=${size}`, "-frames:v", "1", file]);
  return file;
}

/** Build `count` synthetic frames spaced `stepMs` apart starting at t=0, cycling through a small color palette. */
export function makeFrames(dir: string, count: number, stepMs: number): FrameRef[] {
  const palette = ["red", "green", "blue", "yellow", "cyan", "magenta"];
  const frames: FrameRef[] = [];
  for (let i = 0; i < count; i++) {
    const file = makeFrame(dir, `f_${String(i).padStart(3, "0")}.jpg`, palette[i % palette.length]);
    frames.push({ t: i * stepMs, file });
  }
  return frames;
}

export function mkTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), prefix));
}
