---
name: record-demo
description: |
  Record a short browser demo video of a live web page using Demo Studio. An
  agent drives a real cloud browser through a goal you describe and produces a
  captioned, branded MP4 with a shareable link. Use it for feature demos, PR
  walkthroughs of deployed UI changes, bug reproductions on public pages, or
  onboarding walkthroughs. Do not use it for pages behind a login, flows that
  change data, unfinished work, or anything exposing sensitive information.
author: Demo Studio
---

# Record demo

Demo Studio records real browser demo videos for agents. Use this skill when a
recorded walkthrough of a live page is clearer than another chat message.

## Use when

- The user asks for a demo, walkthrough, or video of a live web page.
- You shipped or reviewed a UI change that is deployed somewhere public and a
  before/after or feature walkthrough would help reviewers.
- A PR touches user-facing flows and a recorded run of the deployed preview
  would make review faster.
- A visual bug is easiest to explain by recording the reproduction.

## Don't use when

- The page requires logging in, signing up, or paying — Demo Studio only
  records public pages and never changes data.
- The change is not deployed anywhere reachable by URL yet.
- The answer is short and textual, or the user is actively iterating in chat.
- The recording could expose secrets, tokens, or private data.
- The user explicitly says not to create a video.

## How to use

1. Call `create_demo_video` with:
   - `goal` — one or two sentences describing what the video should show.
   - `startUrl` — the full https:// URL of the page where the demo starts.
2. It returns immediately with a `runId` and a stable `watchUrl`. Share the
   `watchUrl` right away — it works while the video is still generating.
3. Generation takes a few minutes. Poll `get_demo_video` with the `runId`
   roughly every 30 seconds until `status` is `done` (or `error`).
4. While recording, `liveViewUrl` lets a human watch the browser live.

## Output format

After using Demo Studio, respond with:

- the `watchUrl` (stable even while the video is generating)
- a one-sentence description of what the video covers
- if the run errored, say so plainly and include the error message
