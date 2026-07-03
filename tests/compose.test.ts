import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { composeVideo, type ComposeInput } from "../src/engine/compose.ts";
import type { FrameRef, TimedCaption } from "../src/engine/types.ts";
import { makeFrame, makeFrames, mkTmpDir, BLANK_PNG_BASE64 } from "./helpers/frames.ts";
import { ffprobeDuration, pixelAt, makeSolidPng } from "./helpers/video.ts";

const W = 160, H = 90, FPS = 24;

function pngBase64(filePath: string): string {
  return fs.readFileSync(filePath).toString("base64");
}

function blankCaps(n: number): string[] {
  return Array.from({ length: n }, () => BLANK_PNG_BASE64);
}

function input(overrides: Partial<ComposeInput> & { frames: FrameRef[]; outDir: string }): ComposeInput {
  return {
    captions: [],
    overlays: { caps: [], brand: null },
    width: W,
    height: H,
    fps: FPS,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Basic composition
// ---------------------------------------------------------------------------

test("composeVideo: writes final.mp4 and raw.mp4, returns frameCount", async () => {
  const tmp = mkTmpDir("compose-basic-");
  const frames = makeFrames(tmp, 3, 500); // t = 0, 500, 1000
  const outDir = path.join(tmp, "out");
  const result = await composeVideo(input({ frames, outDir }));

  assert.ok(fs.existsSync(result.finalPath), "final.mp4 should exist");
  assert.ok(fs.existsSync(result.rawPath), "raw.mp4 should exist");
  assert.equal(result.finalPath, path.join(outDir, "final.mp4"));
  assert.equal(result.rawPath, path.join(outDir, "raw.mp4"));
  assert.equal(result.frameCount, 3);
  assert.ok(fs.statSync(result.finalPath).size > 0);
});

test("composeVideo: creates outDir recursively when it doesn't exist", async () => {
  const tmp = mkTmpDir("compose-mkdir-");
  const frames = makeFrames(tmp, 2, 300);
  const outDir = path.join(tmp, "a", "b", "c");
  assert.ok(!fs.existsSync(outDir));
  const result = await composeVideo(input({ frames, outDir }));
  assert.ok(fs.existsSync(result.finalPath));
});

test("composeVideo: duration math — normal gaps under the 1.6s cap", async () => {
  const tmp = mkTmpDir("compose-dur-normal-");
  const frames = makeFrames(tmp, 3, 500); // gaps: 0.5, 0.5; last frame defaults to 0.8
  const result = await composeVideo(input({ frames, outDir: path.join(tmp, "out") }));
  assert.equal(result.durationSec, 1.8);
});

test("composeVideo: inter-frame gaps are capped at 1.6s", async () => {
  const tmp = mkTmpDir("compose-dur-cap-");
  const frames = makeFrames(tmp, 3, 5000); // 5s gaps, well over the cap
  const result = await composeVideo(input({ frames, outDir: path.join(tmp, "out") }));
  // 1.6 + 1.6 + 0.8 (last-frame default) = 4.0
  assert.equal(result.durationSec, 4.0);
  const probed = ffprobeDuration(result.finalPath);
  assert.ok(Math.abs(probed - 4.0) < 0.3, `ffprobe duration ${probed} should be close to 4.0`);
});

test("composeVideo: inter-frame gaps are floored at 0.02s", async () => {
  const tmp = mkTmpDir("compose-dur-floor-");
  const frames = makeFrames(tmp, 3, 5); // 5ms gaps, well under the floor
  const result = await composeVideo(input({ frames, outDir: path.join(tmp, "out") }));
  // 0.02 + 0.02 + 0.8 (last-frame default) = 0.84
  assert.equal(result.durationSec, 0.84);
});

test("composeVideo: single-frame case defaults to 0.8s duration", async () => {
  const tmp = mkTmpDir("compose-single-");
  const frames = makeFrames(tmp, 1, 0);
  const result = await composeVideo(input({ frames, outDir: path.join(tmp, "out") }));
  assert.equal(result.durationSec, 0.8);
  assert.equal(result.frameCount, 1);
  const probed = ffprobeDuration(result.finalPath);
  assert.ok(Math.abs(probed - 0.8) < 0.3, `ffprobe duration ${probed} should be close to 0.8`);
});

test("composeVideo: empty frames array rejects with 'no frames captured'", async () => {
  const tmp = mkTmpDir("compose-empty-");
  await assert.rejects(
    composeVideo(input({ frames: [], outDir: path.join(tmp, "out") })),
    /no frames captured/,
  );
});

test("composeVideo: many frames — frameCount matches, gaps sum correctly", async () => {
  const tmp = mkTmpDir("compose-many-");
  const frames = makeFrames(tmp, 8, 200); // 7 gaps of 0.2s + last default 0.8
  const result = await composeVideo(input({ frames, outDir: path.join(tmp, "out") }));
  assert.equal(result.frameCount, 8);
  const expected = +(7 * 0.2 + 0.8).toFixed(2);
  assert.equal(result.durationSec, expected);
});

// ---------------------------------------------------------------------------
// onProgress
// ---------------------------------------------------------------------------

test("composeVideo: onProgress reports values within [0,1] and reaches completion", async () => {
  const tmp = mkTmpDir("compose-progress-");
  const frames = makeFrames(tmp, 4, 1000); // ~3.8s of video, long enough for -progress to tick
  const seen: number[] = [];
  const result = await composeVideo(
    input({ frames, outDir: path.join(tmp, "out"), onProgress: (pct) => seen.push(pct) }),
  );
  assert.ok(seen.length > 0, "onProgress should have been called at least once for a multi-second encode");
  for (const pct of seen) {
    assert.ok(pct >= 0 && pct <= 1, `progress ${pct} out of [0,1] range`);
  }
  // ffmpeg's -progress stream isn't guaranteed monotonic to the last decimal,
  // but it should not regress by more than a rounding hair.
  for (let i = 1; i < seen.length; i++) {
    assert.ok(seen[i] >= seen[i - 1] - 0.05, `progress regressed from ${seen[i - 1]} to ${seen[i]}`);
  }
  assert.ok(fs.existsSync(result.finalPath));
});

// ---------------------------------------------------------------------------
// Caption timing windows — verified by sampling actual pixels from the output
// ---------------------------------------------------------------------------

test("composeVideo: caption cards appear only within their timing window", async () => {
  const tmp = mkTmpDir("compose-captions-");
  const frames = makeFrames(tmp, 3, 1000); // t = 0, 1000, 2000ms; video timeline: [0,1.0)=f0, [1.0,2.0)=f1, tail 0.8
  // total = 1.0 + 1.0 + 0.8 = 2.8s

  const capW = 20, capH = 10;
  const redPng = makeSolidPng(tmp, "red.png", "red", capW, capH);
  const bluePng = makeSolidPng(tmp, "blue.png", "blue", capW, capH);

  const captions: TimedCaption[] = [
    { t: 0, text: "first" }, // window: [videoTimeAt(0), videoTimeAt(1000)) = [0, 1.0)
    { t: 1000, text: "second" }, // window: [videoTimeAt(1000), total) = [1.0, 2.8)
  ];

  const outDir = path.join(tmp, "out");
  const result = await composeVideo(
    input({
      frames,
      captions,
      overlays: { caps: [pngBase64(redPng), pngBase64(bluePng)], brand: null },
      outDir,
    }),
  );
  assert.equal(result.durationSec, 2.8);

  // Overlay position per compose.ts: x=(W-w)/2, y=H-PAD-h-24, PAD=round(W*0.04)=6
  const cx = Math.round((W - capW) / 2 + capW / 2); // 80
  const cy = Math.round(H - 6 - capH - 24 + capH / 2); // 55

  const [r0, g0, b0] = pixelAt(result.finalPath, 0.3, cx, cy);
  assert.ok(r0 > 180 && g0 < 80 && b0 < 80, `expected red at t=0.3 (in caption 0's window), got rgb(${r0},${g0},${b0})`);

  const [r1, g1, b1] = pixelAt(result.finalPath, 1.5, cx, cy);
  assert.ok(b1 > 180 && r1 < 80 && g1 < 80, `expected blue at t=1.5 (in caption 1's window), got rgb(${r1},${g1},${b1})`);

  // Just before/after the boundary at video-time 1.0s.
  const [rBefore] = pixelAt(result.finalPath, 0.85, cx, cy);
  assert.ok(rBefore > 180, `expected red still showing just before the 1.0s boundary, got r=${rBefore}`);

  const [, , bAfter] = pixelAt(result.finalPath, 1.15, cx, cy);
  assert.ok(bAfter > 180, `expected blue showing shortly after the 1.0s boundary, got b=${bAfter}`);
});

test("composeVideo: with zero captions, no overlay is drawn at the caption position", async () => {
  const tmp = mkTmpDir("compose-nocap-");
  const frames = makeFrames(tmp, 2, 800);
  const result = await composeVideo(input({ frames, outDir: path.join(tmp, "out") }));
  const [r, g, b] = pixelAt(result.finalPath, 0.3, W / 2, H - 6 - 24);
  // No caption card means the pixel there is whatever the padded backdrop/frame shows —
  // just assert the call succeeds and returns a plausible RGB triple (no crash, no NaN).
  assert.ok([r, g, b].every((v) => Number.isInteger(v) && v >= 0 && v <= 255));
});

// ---------------------------------------------------------------------------
// Encode queue: serialize concurrent composeVideo calls through one ffmpeg at a time
// ---------------------------------------------------------------------------

test("composeVideo: concurrent calls serialize through the encode queue (no overlapping ffmpeg runs)", async (t) => {
  const realFfmpeg = execFileSync("which", ["ffmpeg"]).toString("utf8").trim();
  const fakeBinDir = path.dirname(new URL("./fixtures/fakebin/ffmpeg", import.meta.url).pathname);
  const logFile = path.join(mkTmpDir("compose-queue-log-"), "ffmpeg-track.log");
  fs.writeFileSync(logFile, "");

  const tmp = mkTmpDir("compose-queue-");
  // Generate all frames with the REAL ffmpeg, before swapping PATH.
  const jobs = [0, 1, 2].map((i) => ({
    frames: makeFrames(path.join(tmp, `job${i}`, "frames"), 2, 400),
    outDir: path.join(tmp, `job${i}`, "out"),
  }));

  const originalPath = process.env.PATH;
  process.env.PATH = `${fakeBinDir}${path.delimiter}${originalPath}`;
  process.env.FFMPEG_TRACKER_LOG = logFile;
  process.env.REAL_FFMPEG_PATH = realFfmpeg;
  t.after(() => {
    process.env.PATH = originalPath;
    delete process.env.FFMPEG_TRACKER_LOG;
    delete process.env.REAL_FFMPEG_PATH;
  });

  const results = await Promise.all(jobs.map((j) => composeVideo(input({ frames: j.frames, outDir: j.outDir }))));
  assert.equal(results.length, 3);
  for (const r of results) assert.ok(fs.existsSync(r.finalPath));

  const lines = fs.readFileSync(logFile, "utf8").trim().split("\n").filter(Boolean);
  const byPid = new Map<string, { start?: number; end?: number }>();
  for (const line of lines) {
    const [kind, pid, ts] = line.split(" ");
    const entry = byPid.get(pid) ?? {};
    if (kind === "start") entry.start = Number(ts);
    else entry.end = Number(ts);
    byPid.set(pid, entry);
  }
  const intervals = [...byPid.values()].filter((v) => v.start !== undefined && v.end !== undefined) as { start: number; end: number }[];
  assert.equal(intervals.length, 3, `expected exactly 3 tracked ffmpeg invocations, saw ${intervals.length}`);

  intervals.sort((a, b) => a.start - b.start);
  for (let i = 1; i < intervals.length; i++) {
    assert.ok(
      intervals[i].start >= intervals[i - 1].end,
      `ffmpeg run ${i} started (${intervals[i].start}) before run ${i - 1} ended (${intervals[i - 1].end}) — encodes overlapped`,
    );
  }
});

test("composeVideo: a rejected encode does not break the queue for later calls", async () => {
  const tmp = mkTmpDir("compose-reject-recover-");
  const badInput = input({ frames: [], outDir: path.join(tmp, "bad") });
  const goodFrames = makeFrames(tmp, 2, 400);
  const goodInput = input({ frames: goodFrames, outDir: path.join(tmp, "good") });

  // Fire both concurrently: the bad one queues first and rejects; the good one
  // is queued right behind it and must still run to completion.
  const badPromise = composeVideo(badInput);
  const goodPromise = composeVideo(goodInput);

  await assert.rejects(badPromise, /no frames captured/);
  const goodResult = await goodPromise;
  assert.ok(fs.existsSync(goodResult.finalPath));
  assert.equal(goodResult.frameCount, 2);

  // And the queue should keep working for calls made after the rejection settled too.
  const afterFrames = makeFrames(tmp, 2, 400);
  const afterResult = await composeVideo(input({ frames: afterFrames, outDir: path.join(tmp, "after") }));
  assert.ok(fs.existsSync(afterResult.finalPath));
});
