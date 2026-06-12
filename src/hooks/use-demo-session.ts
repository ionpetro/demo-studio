"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ChatPart =
  | { type: "text"; text: string }
  | { type: "tool-call"; toolCallId: string; toolName: string };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  parts: ChatPart[];
}

export type StageState =
  | { mode: "idle" }
  | { mode: "plan"; goal: string; startUrl: string }
  | { mode: "live"; jobId: string; liveViewUrl?: string; composing: boolean }
  | { mode: "done"; jobId: string; videoUrl: string; durationSec: number };

export interface Tick {
  n: number;
  action: string;
  caption: string;
  ok: boolean;
}

let nextId = 0;
const uid = (prefix: string) => `${prefix}-${++nextId}`;

/**
 * Owns the demo-studio session: SSE connection, chat messages, busy flag,
 * and stage state.
 */
export function useDemoSession() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<StageState>({ mode: "idle" });
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [recStart, setRecStart] = useState<number | null>(null);

  const sessionIdRef = useRef<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  /** Append to the open assistant message, or start a new one. */
  const pushAssistantPart = useCallback((part: ChatPart) => {
    setMessages((ms) => {
      const last = ms[ms.length - 1];
      if (last?.role === "assistant") {
        const parts = [...last.parts];
        const tail = parts[parts.length - 1];
        if (part.type === "text" && tail?.type === "text") {
          parts[parts.length - 1] = { type: "text", text: tail.text + part.text };
        } else {
          parts.push(part);
        }
        return [...ms.slice(0, -1), { ...last, parts }];
      }
      return [...ms, { id: uid("a"), role: "assistant", parts: [part] }];
    });
  }, []);

  const connect = useCallback(async (): Promise<string> => {
    if (sessionIdRef.current) return sessionIdRef.current;
    const res = await fetch("/api/session", { method: "POST" });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "could not create session");
    const id: string = body.sessionId;
    sessionIdRef.current = id;

    const es = new EventSource(`/api/session/${id}/events`);
    esRef.current = es;
    es.onmessage = (e) => {
      const ev = JSON.parse(e.data);
      switch (ev.type) {
        case "agent_text":
          pushAssistantPart({ type: "text", text: ev.text });
          break;
        case "tool_call":
          pushAssistantPart({
            type: "tool-call",
            toolCallId: uid("tc"),
            toolName: ev.name === "mcp" ? "studio_tool" : ev.name,
          });
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
  }, [pushAssistantPart]);

  useEffect(() => () => esRef.current?.close(), []);

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || busy) return;
      setError(null);
      setBusy(true);
      setMessages((ms) => [...ms, { id: uid("u"), role: "user", parts: [{ type: "text", text: message }] }]);
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
        throw err;
      }
    },
    [busy, connect],
  );

  return { messages, busy, stage, setStage, ticks, error, recStart, send };
}
