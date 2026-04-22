"use client";

/**
 * 실시간 통역 세션 훅.
 *   - /api/realtime/token 으로 ephemeral JWT 획득
 *   - WebSocket 연결 + hello 인증
 *   - 서버 이벤트 수신 → utterances state 병합
 *   - 상태기계 transition() 반영
 *   - 마이크 PCM 을 binary frame 으로 송출
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  transition,
  INITIAL_STATE,
  type Context,
  type SessionEvent,
} from "@/lib/session/state-machine";
import type {
  ServerEvent,
  ClientEvent,
} from "@/lib/realtime/events";
import type {
  SessionMode,
  SessionState,
  UtteranceRow,
  QualityMode,
} from "@/types/session";
import { useMicrophone } from "./useMicrophone";

interface Options {
  sessionId: string;
  mode: SessionMode;
  qualityMode: QualityMode;
  audioSource?: "mic" | "tab_audio";
  assistAvailable?: boolean;
}

export function useInterpretSession(opts: Options) {
  const [state, setState] = useState<SessionState>(INITIAL_STATE);
  const [items, setItems] = useState<UtteranceRow[]>([]);
  const [trialRemaining, setTrialRemaining] = useState<number | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const ctxRef = useRef<Context>({
    mode: opts.mode,
    hasMicPermission: false,
    hasGatewayToken: false,
    trialRemainingS: Number.POSITIVE_INFINITY,
    utterancesCount: 0,
    recordingEnabled: false,
    topicDiscoveryActive:
      opts.mode === "listener_live" || opts.mode === "listener_live_recorded",
  });

  const mic = useMicrophone({
    source: opts.audioSource ?? "mic",
    onChunk: (buf) => wsRef.current?.readyState === 1 && wsRef.current.send(buf),
  });

  const dispatch = useCallback(
    (ev: SessionEvent) => {
      const { state: next, effects } = transition(
        // 가장 최신 state 를 캡처하기 위해 ref 대신 setState 콜백 사용
        (() => state)(),
        ev,
        ctxRef.current,
      );
      for (const eff of effects) {
        if (eff.type === "ws_close") {
          wsRef.current?.close();
          mic.stop();
        }
        if (eff.type === "ws_open") {
          // 실제 open 은 start() 에서 수행
        }
        if (eff.type === "show_warning") {
          setLastError(
            (eff.payload as { reason?: string })?.reason ?? "warning",
          );
        }
      }
      setState(next);
    },
    [state, mic],
  );

  const applyServerEvent = useCallback((ev: ServerEvent) => {
    switch (ev.type) {
      case "state":
        setState(ev.state);
        break;
      case "speech_final": {
        setItems((prev) => upsert(prev, ev.seq, { source_text: ev.text }));
        break;
      }
      case "translation_final":
        setItems((prev) =>
          upsert(prev, ev.seq, {
            translated_text: ev.text,
            confidence_level: ev.confidence_level,
            confidence_score: ev.confidence_score,
            flags: ev.flags,
            requires_review: ev.confidence_level === "low",
          }),
        );
        break;
      case "confidence_update":
        setItems((prev) =>
          upsert(prev, ev.seq, {
            confidence_level: ev.level,
            confidence_score: ev.score,
          }),
        );
        break;
      case "trial_time_remaining":
        setTrialRemaining(ev.remaining_s);
        ctxRef.current.trialRemainingS = ev.remaining_s;
        break;
      case "trial_expired":
        setTrialRemaining(0);
        ctxRef.current.trialRemainingS = 0;
        dispatch({ type: "end", reason: "trial" });
        break;
      case "error":
        setLastError(ev.message);
        if (!ev.retriable) dispatch({ type: "end", reason: "error" });
        break;
      default:
        break;
    }
  }, [dispatch]);

  async function start() {
    setLastError(null);
    try {
      const tokRes = await fetch("/api/realtime/token", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: opts.sessionId }),
      });
      if (!tokRes.ok) {
        const j = await tokRes.json().catch(() => ({}));
        throw new Error(j?.error?.message ?? "token_failed");
      }
      const { token, gateway_url } = await tokRes.json();
      ctxRef.current.hasGatewayToken = true;

      await mic.start();
      ctxRef.current.hasMicPermission = true;

      const ws = new WebSocket(gateway_url);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;
      ws.onopen = () => {
        const hello: ClientEvent = { type: "auth.hello", token };
        ws.send(JSON.stringify(hello));
      };
      ws.onmessage = (ev) => {
        if (typeof ev.data === "string") {
          try {
            const parsed = JSON.parse(ev.data) as ServerEvent;
            applyServerEvent(parsed);
          } catch {
            // ignore malformed
          }
        }
        // 바이너리(TTS 응답 등) 처리는 v1.1에서.
      };
      ws.onerror = () => setLastError("gateway_error");
      ws.onclose = () => mic.stop();

      dispatch({ type: "preflight_ok" });
      dispatch({ type: "start_quick" });
    } catch (e) {
      setLastError(e instanceof Error ? e.message : "unknown");
      mic.stop();
    }
  }

  function pause() {
    const cmd: ClientEvent = { type: "client.command", command: "pause" };
    wsRef.current?.send(JSON.stringify(cmd));
    dispatch({ type: "pause" });
  }
  function resume() {
    const cmd: ClientEvent = { type: "client.command", command: "resume" };
    wsRef.current?.send(JSON.stringify(cmd));
    dispatch({ type: "resume" });
  }
  function end() {
    const cmd: ClientEvent = { type: "client.command", command: "end" };
    wsRef.current?.send(JSON.stringify(cmd));
    dispatch({ type: "end", reason: "user" });
  }
  function requestClarify(seq: number) {
    const cmd: ClientEvent = {
      type: "client.command",
      command: "manual_clarify",
      utterance_seq: seq,
    };
    wsRef.current?.send(JSON.stringify(cmd));
  }

  useEffect(() => () => {
    wsRef.current?.close();
    mic.stop();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    state,
    items,
    micMuted: mic.muted,
    toggleMic: () => mic.setMuted((v) => !v),
    start,
    pause,
    resume,
    end,
    requestClarify,
    trialRemaining,
    lastError,
  };
}

function upsert(
  prev: UtteranceRow[],
  seq: number,
  patch: Partial<UtteranceRow>,
): UtteranceRow[] {
  const idx = prev.findIndex((x) => x.seq === seq);
  if (idx === -1) {
    const fresh: UtteranceRow = {
      id: String(seq),
      session_id: "",
      seq,
      speaker_label: null,
      started_at_ms: null,
      ended_at_ms: null,
      source_text: "",
      corrected_text: null,
      translated_text: null,
      confidence_level: "medium",
      confidence_score: null,
      requires_review: false,
      flags: [],
      created_at: new Date().toISOString(),
      ...patch,
    };
    return [...prev, fresh];
  }
  const existing = prev[idx]!;
  const next = [...prev];
  next[idx] = { ...existing, ...patch };
  return next;
}
