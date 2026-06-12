"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ChatItem =
  | { kind: "user"; text: string }
  | { kind: "agent"; text: string }
  | { kind: "tool"; name: string };

type StageState =
  | { mode: "idle" }
  | { mode: "plan"; goal: string; startUrl: string }
  | { mode: "live"; jobId: string; liveViewUrl?: string; composing: boolean }
  | { mode: "done"; jobId: string; videoUrl: string; durationSec: number };

interface Tick {
  n: number;
  action: string;
  caption: string;
  ok: boolean;
}

const SUGGESTIONS = [
  "Demo the GamerPlug referral leaderboard",
  "Walk through gamerplug.app tournaments",
  "Show searching Hacker News for 'AI agents'",
];

function fmtTimecode(ms: number): string {
  const s = Math.floor(ms / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  const ff = String(Math.floor((ms % 1000) / 40)).padStart(2, "0");
  return `${mm}:${ss}:${ff}`;
}

export default function Home() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [chat, setChat] = useState<ChatItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState("");
  const [stage, setStage] = useState<StageState>({ mode: "idle" });
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [recStart, setRecStart] = useState<number | null>(null);
  const [clock, setClock] = useState(0);

  const threadRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  // recording timecode
  useEffect(() => {
    if (recStart == null) return;
    const t = setInterval(() => setClock(Date.now() - recStart), 80);
    return () => clearInterval(t);
  }, [recStart]);

  // autoscroll chat
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [chat, busy]);

  const connect = useCallback(async (): Promise<string> => {
    if (sessionId) return sessionId;
    const res = await fetch("/api/session", { method: "POST" });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "could not create session");
    const id: string = body.sessionId;
    setSessionId(id);

    const es = new EventSource(`/api/session/${id}/events`);
    esRef.current = es;
    es.onmessage = (e) => {
      const ev = JSON.parse(e.data);
      switch (ev.type) {
        case "agent_text":
          setChat((c) => {
            const last = c[c.length - 1];
            if (last?.kind === "agent") {
              return [...c.slice(0, -1), { kind: "agent", text: last.text + ev.text }];
            }
            return [...c, { kind: "agent", text: ev.text }];
          });
          break;
        case "tool_call":
          setChat((c) => [...c, { kind: "tool", name: ev.name }]);
          break;
        case "agent_turn_done":
          setBusy(false);
          break;
        case "plan":
          setStage({ mode: "plan", goal: ev.goal, startUrl: ev.startUrl });
          break;
        case "job_created":
          setTicks([]);
          setError(null);
          setStage({ mode: "live", jobId: ev.jobId, composing: false });
          setRecStart(Date.now());
          break;
        case "live_view":
          setStage((s) => (s.mode === "live" ? { ...s, liveViewUrl: ev.url } : s));
          break;
        case "action":
          setTicks((t) => [...t.slice(-3), { n: ev.n, action: ev.action, caption: ev.caption, ok: ev.ok }]);
          break;
        case "job_status":
          if (ev.status === "composing") {
            setRecStart(null);
            setStage((s) => (s.mode === "live" ? { ...s, composing: true } : s));
          } else if (ev.status === "error") {
            setRecStart(null);
            setStage({ mode: "idle" });
          }
          break;
        case "video_ready":
          setRecStart(null);
          setStage({ mode: "done", jobId: ev.jobId, videoUrl: ev.videoUrl, durationSec: ev.durationSec });
          break;
        case "error":
          setError(ev.message);
          break;
      }
    };
    return id;
  }, [sessionId]);

  useEffect(() => () => esRef.current?.close(), []);

  const send = useCallback(
    async (raw?: string) => {
      const message = (raw ?? input).trim();
      if (!message || busy) return;
      setInput("");
      setError(null);
      setBusy(true);
      setChat((c) => [...c, { kind: "user", text: message }]);
      try {
        const id = await connect();
        const res = await fetch(`/api/session/${id}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `request failed (${res.status})`);
        }
      } catch (err) {
        setBusy(false);
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [busy, connect, input],
  );

  const recording = stage.mode === "live" && !stage.composing;

  return (
    <div className="app">
      <aside className="rail">
        <div className="rail-head">
          <div className="wordmark">
            demo<em>·</em>studio
          </div>
          <div className="rail-sub">producer line</div>
        </div>

        <div className="thread" ref={threadRef}>
          {chat.length === 0 && (
            <div className="msg">
              <div className="msg-tag">producer</div>
              <div className="msg-body">
                Tell me what you want recorded — a feature, a flow, a page. I&apos;ll plan the
                shot list with you, then drive a live browser while you watch, and hand you
                the MP4.
              </div>
            </div>
          )}
          {chat.map((m, i) =>
            m.kind === "tool" ? (
              <div className="toolline" key={i}>
                ⚙ <b>{m.name}</b>
              </div>
            ) : (
              <div className={`msg ${m.kind}`} key={i}>
                <div className="msg-tag">{m.kind === "user" ? "you" : "producer"}</div>
                <div className="msg-body">{m.text}</div>
              </div>
            ),
          )}
          {busy && (
            <div className="thinking">
              <i /> <i /> <i />
            </div>
          )}
        </div>

        {error && <div className="errbox">{error}</div>}

        <div className="composer">
          <div className="composer-box">
            <textarea
              rows={1}
              placeholder={busy ? "agent is working…" : "Describe the demo you want…"}
              value={input}
              disabled={busy}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <button className="send" disabled={busy || !input.trim()} onClick={() => void send()} aria-label="send">
              ↵
            </button>
          </div>
          <div className="hint">ENTER TO SEND · SHIFT+ENTER FOR NEWLINE</div>
        </div>
      </aside>

      <main className="stage">
        <div className="stage-head">
          <span className={`tally ${recording ? "rec" : ""}`}>
            <span className="dot" /> {recording ? "rec" : stage.mode === "done" ? "wrap" : "standby"}
          </span>
          <span>cam·01 / kernel cloud</span>
          <span className="timecode">{fmtTimecode(recording ? clock : 0)}</span>
        </div>

        <div className={`viewport ${recording ? "live" : ""}`}>
          <div className="vf">
            {stage.mode === "idle" && (
              <div className="standby">
                <div className="osd">— standby —</div>
                <h1>
                  Direct it.
                  <br />
                  I&apos;ll shoot it.
                </h1>
                <p>
                  An agent plans your browser demo with you, drives a real cloud browser on
                  camera, and delivers a captioned MP4.
                </p>
                <div className="chips">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} className="chip" onClick={() => void send(s)} disabled={busy}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {stage.mode === "plan" && (
              <div className="plan">
                <div className="plan-card">
                  <div className="osd">shot list locked</div>
                  <h2>{stage.goal}</h2>
                  <div className="plan-row">
                    <span className="k">opens at</span>
                    <span className="v">{stage.startUrl}</span>
                  </div>
                  <div className="plan-row">
                    <span className="k">output</span>
                    <span className="v">1280×720 MP4 · captions · intro/outro</span>
                  </div>
                  <button
                    className="action-btn"
                    disabled={busy}
                    onClick={() => void send("Looks good — start recording now.")}
                  >
                    {busy ? "rolling…" : "● roll camera"}
                  </button>
                </div>
              </div>
            )}

            {stage.mode === "live" && (
              <>
                {stage.liveViewUrl ? (
                  <iframe src={stage.liveViewUrl} allow="clipboard-read; clipboard-write" />
                ) : (
                  <div className="standby">
                    <div className="osd">— opening camera —</div>
                  </div>
                )}
                {!stage.composing && ticks.length > 0 && (
                  <div className="ticker">
                    {ticks.map((t, i) => (
                      <div className={`tick ${i < ticks.length - 1 ? "dim" : ""}`} key={`${t.n}-${i}`}>
                        <span className="n">{String(t.n).padStart(2, "0")}</span>
                        <span className="a">{t.action}</span>
                        <span>{t.caption}</span>
                        <span className={t.ok ? "ok" : "bad"}>{t.ok ? "✓" : "✗"}</span>
                      </div>
                    ))}
                  </div>
                )}
                {stage.composing && (
                  <div className="composing">
                    <div className="spool" />
                    <div className="osd">developing film · ffmpeg</div>
                  </div>
                )}
              </>
            )}

            {stage.mode === "done" && (
              <>
                <video src={stage.videoUrl} controls autoPlay />
                <div className="done-bar">
                  <span className="done-meta">
                    <b>wrap ✓</b> · {stage.durationSec.toFixed(1)}s · 1280×720 · h264
                  </span>
                  <span className="done-actions">
                    <a href={`${stage.videoUrl}?download`}>
                      <button className="action-btn">↓ download mp4</button>
                    </a>
                    <button className="action-btn ghost" onClick={() => setStage({ mode: "idle" })}>
                      new take
                    </button>
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
