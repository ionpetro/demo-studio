/**
 * Engine smoke test, no UI / no Cursor agent:
 * scripted actions against a live page → recorded → composed MP4.
 *
 *   npm run smoke
 */
import fs from "node:fs";
import path from "node:path";
import { BrowserSession } from "../src/engine/browser-session.ts";
import { composeVideo } from "../src/engine/compose.ts";

// load .env without a dependency
for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const START_URL = process.argv[2] ?? "https://www.gamerplug.app/en/leaderboard";
const outDir = path.join(process.cwd(), "data", "jobs", "smoke");
fs.rmSync(outDir, { recursive: true, force: true });

console.log("▶ creating Kernel browser…");
const session = await BrowserSession.create(path.join(outDir, "frames"));
console.log(`  session: ${session.sessionId}`);
console.log(`  live view: ${session.liveViewUrl ?? "(none)"}`);

const captions: { t: number; text: string }[] = [];
try {
  await session.startRecording({ width: 1280, height: 720, quality: 60 });

  captions.push({ t: session.now(), text: "Open the leaderboard" });
  let r = await session.act({ action: "goto", url: START_URL });
  console.log(`  goto → ok=${r.ok} ${r.error ?? ""}`);

  const obs = await session.observe(false);
  console.log(`  observed ${obs.elements.length} elements on ${obs.url}`);

  captions.push({ t: session.now(), text: "Scroll to the table" });
  r = await session.act({ action: "scroll", dy: 500 });
  console.log(`  scroll → ok=${r.ok}`);

  await session.act({ action: "wait", ms: 1200 });

  const frames = await session.stopRecording();
  console.log(`  captured ${frames.length} frames`);

  console.log("▶ rendering overlays…");
  const overlays = await session.renderOverlays({
    W: 1280, H: 720,
    captions: captions.map((c) => c.text),
    brand: "SMOKE TEST",
  });

  await session.close();

  console.log("▶ composing…");
  const out = await composeVideo({ frames, captions, overlays, outDir, width: 1280, height: 720, fps: 30 });
  console.log(`✓ ${out.finalPath} (${out.durationSec}s, ${out.frameCount} frames)`);
} catch (err) {
  await session.close().catch(() => {});
  console.error("✗ smoke failed:", err);
  process.exit(1);
}
