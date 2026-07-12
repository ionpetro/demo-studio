---
description: Record a demo video of a live web page with Loopa
---

# Record a loopa

Record a demo video of a live web page with Loopa.

Follow the bundled `record-loopa` skill. In short:

1. Work out the `goal` (one or two sentences of what to demonstrate) and the
   `startUrl` from the user's request and the conversation so far. Infer the
   URL from a casual site name; only ask if it is genuinely ambiguous. If the
   conversation is about a change that was just deployed, default to
   demonstrating that change on its deployed URL.
2. Call `create_loopa`, report the `runId`, and share the `watchUrl`
   immediately if it is marked `shareable: true`.
3. Poll `get_loopa` every ~30 seconds until `status` is `done` or `error`,
   handling `awaiting_login` by handing the `loginUrl` to the user (never sign
   in yourself), then `confirm_login`.
4. Finish with the watch link and a one-sentence description of what the video
   covers; report errors verbatim.
