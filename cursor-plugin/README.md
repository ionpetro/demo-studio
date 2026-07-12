# Loopa for Cursor

Record captioned demo videos of live web pages without leaving Cursor. A cloud
browser agent drives the page through a goal you describe and composes a
branded MP4 with a shareable watch link on [loopa.sh](https://loopa.sh).

## What's included

- **MCP server** — connects Cursor to `https://api.loopa.sh/mcp`
  (`create_loopa`, `get_loopa`, `confirm_login`). Sign-in happens via the
  standard MCP OAuth flow the first time Cursor connects.
- **`record-loopa` skill** — teaches the agent when a video beats a text
  answer and how to run the record → poll → share workflow, including the
  login-handoff flow for pages behind auth.
- **`/record-loopa` command** — kick off a recording explicitly.
- **Rule** — nudges the agent to reach for Loopa when a walkthrough of a
  deployed page is the clearest way to communicate.

## Try it

Ask the agent things like:

> record a demo of the new pricing page on staging

> make a loopa showing the signup flow on https://example.com

The agent starts a run, shares the watch link right away, and polls until the
video is composed (a few minutes).

## Local development

Symlink this directory and reload Cursor:

```bash
ln -s "$(pwd)/cursor-plugin" ~/.cursor/plugins/local/loopa
```

## Safety notes

- The recording agent follows the goal literally, including submitting forms —
  never ask it to pay for anything or change real data.
- Finished loopas are viewable by anyone with the link; keep secrets out of
  goals and recorded pages.
- Login walls are handed off to the user's own browser; the agent never sees
  or enters credentials.
