# Demo Studio

Chat with an agent about the browser demo you want, watch it drive a live cloud
browser, and download the finished MP4.

```
You ──chat──▶ Cursor SDK agent (composer-2.5)
                 │  plans the walkthrough with you
                 ▼
              Kernel cloud browser ◀── you watch via live-view iframe
                 │  agent drives it (playwright over CDP)
                 │  CDP screencast captures every frame
                 ▼
              ffmpeg: captions · brand · intro/outro
                 ▼
              final.mp4 (download in the app)
```

## Stack

- **Next.js** (App Router) — UI + API routes; the whole pipeline runs in-process
  on the Node server (local-first, no extra infra).
- **@cursor/sdk** — the planning/driving agent with custom browser tools.
- **@onkernel/sdk** — Kernel cloud browsers (free tier; recording is CDP
  screencast, no paid replay needed).
- **playwright-core** — connected straight to the Kernel browser's CDP websocket.
- **ffmpeg** — must be on PATH.

## Setup

```bash
cp .env.example .env   # fill in CURSOR_API_KEY + KERNEL_API_KEY
npm install
npm run dev
```

## Engine smoke test (no UI)

```bash
npm run smoke -- "show the referral leaderboard and open the top referrer" https://www.gamerplug.app/en/leaderboard
```

Outputs land in `data/jobs/<id>/` — `final.mp4`, `raw.mp4`, `recipe.json`,
`report.json`. Recipes are deterministic and reusable: re-render a demo after a
UI change without calling the model again.
