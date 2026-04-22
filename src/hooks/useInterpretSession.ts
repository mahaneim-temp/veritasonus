"use client";

/**
 * 실시간 통역 세션 훅 (A-4 안정화 완료).
 *
 * 책임:
 *   - /api/realtime/token 으로 ephemeral JWT 획득 + 만료 5분 전 재발급
 *   - WebSocket 연결 + auth.hello 인증
 *   - 30초 주기 heartbeat.ping / pong RTT 수집
 *   - ws.close 비정상 종료 시 지수 백오프(1s/2s/4s, 최대 3회) 재연결
 *   - 30초 이상 median RTT > 600ms → rttLevel='degraded' UI 신호
 *   - paused 상태에서 mic track 완전 중단 (audioInFlight=false 유지)
 *   - 서버 이벤트 수신 → utterances state 병합
 *   - 상태기계 transition() 반영 (live / paused / reconnecting / ended)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  transition,
  INITIAL_STATE,
  type Context,
  type SessionEvent,
} from "@/lib/session/state-machine";
import {
  planNextAttempt,
  resetBackoff,
  INITIAL_BACKOFF,
  type BackoffState,
} from "@/lib/realtime/backoff";
import {
  sample as rttSample,
  INITIAL_WATCHDOG,
  type RttWatchdogState,
  type WatchdogLevel,
} from "@/lib/realtime/rtt-watchdog";
import {
  parseExpiresAt,
  scheduleRefreshDelayMs,
} from "@/lib/realtime/token-lifecycle";
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

const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 10_000;

/** 체험 총 시간(초). 서버 GUEST_TRIAL_SECONDS 와 일치해야 함. */
const TRIAL_TOTAL_SEC =
  Number(process.env["NEXT_PUBLIC_GUEST_TRIAL_SECONDS"]) || 600;

/** transcript 임시 저장용 localStorage 키 + 만료 (24시간). */
const TRANSCRIPT_STORAGE_PREFIX = "lucid-transcript-";
const TRANSCRIPT_TTL_MS = 24 * 60 * 60 * 1000;

interface Options {
  sessionId: string;
  mode: SessionMode;
  qualityMode: QualityMode;
  audioSource?: "mic" | "tab_audio";
  assistAvailable?: boolean;
}

export function useInterpretSession(opts: Options) {
  const [state, setState] = useState<SessionState>(INITIAL_STATE);
  // localStorage 에 백업된 transcript 가 있으면 재진입 시 복원 — 실수로 페이지 이탈했을 때 복구.
  const [items, setItems] = useState<UtteranceRow[]>(() =>
    restoreTranscript(opts.sessionId),
  );
  /** 서버에서 받는 체험 잔여 초. null = 아직 모름 (회원 세션은 계속 null). */
  const [trialRemaining, setTrialRemaining] = useState<number | null>(null);
  /** 세션이 live 로 진입한 이후 흐른 wall-clock 초 (pause 포함, ended 시 정지). */
  const [sessionElapsedSec, setSessionElapsedSec] = useState<number>(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const [rttLevel, setRttLevel] = useState<WatchdogLevel>("ok");

  const wsRef = useRef<WebSocket | null>(null);
  const gatewayUrlRef = useRef<string | null>(null);
  const currentTokenRef = useRef<string | null>(null);
  const backoffRef = useRef<BackoffState>(INITIAL_BACKOFF);
  const rttRef = useRef<RttWatchdogState>(INITIAL_WATCHDOG);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeatDeadlineRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const tokenRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);
  /** 세션이 live 로 전이된 wall-clock 시각(ms). utterance started_at_ms 계산 근거. */
  const liveStartedAtRef = useRef<number | null>(null);

  /** 현재 시점의 세션 경과(ms). live 진입 전이면 0. */
  const sessionElapsedMsAt = useCallback(() => {
    const t0 = liveStartedAtRef.current;
    return t0 == null ? 0 : Math.max(0, Date.now() - t0);
  }, []);

  const ctxRef = useRef<Context>({
    mode: opts.mode,
    hasMicPermission: false,
    hasGatewayToken: false,
    trialRemainingS: Number.POSITIVE_INFINITY,
    utterancesCount: 0,
    recordingEnabled: false,
    topicDiscoveryActive:
      opts.mode === "listener_live" || opts.mode === "listener_live_recorded",
    reconnectReturnTo: null,
  });

  const mic = useMicrophone({
    source: opts.audioSource ?? "mic",
    onChunk: (buf) => {
      const ws = wsRef.current;
      if (ws?.readyState === 1) ws.send(buf);
    },
  });
  const micRef = useRef(mic);
  micRef.current = mic;

  // ── 상태기계 dispatch ─────────────────────────────────────

  const dispatch = useCallback((ev: SessionEvent) => {
    setState((prev) => {
      const { state: next, effects } = transition(prev, ev, ctxRef.current);
      for (const eff of effects) {
        if (eff.type === "ws_close") {
          closeWsSilently();
        }
        if (eff.type === "ws_reconnect") {
          const returnTo =
            (eff.payload as { returnTo?: "live" | "paused" })?.returnTo ??
            "live";
          ctxRef.current.reconnectReturnTo = returnTo;
          scheduleReconnect();
        }
        if (eff.type === "show_warning") {
          setLastError(
            (eff.payload as { reason?: string })?.reason ?? "warning",
          );
        }
      }
      return next;
    });
  }, []);

  // ── 서버 이벤트 → 상태 병합 ───────────────────────────────

  const applyServerEvent = useCallback(
    (ev: ServerEvent) => {
      switch (ev.type) {
        case "state":
          setState(ev.state);
          return;
        case "speech_partial":
          // 실시간성 체감 개선: STT interim 결과를 즉시 표시.
          // speech_final 이 뒤따라 와서 같은 seq 를 덮어쓴다.
          setItems((prev) =>
            upsert(prev, ev.seq, {
              source_text: ev.text,
              // 해당 발화가 처음 나타난 세션 경과 시각(ms). 이후 update 에서는 유지.
              started_at_ms: sessionElapsedMsAt(),
            }),
          );
          return;
        case "speech_final":
          setItems((prev) =>
            upsert(prev, ev.seq, {
              source_text: ev.text,
              started_at_ms: sessionElapsedMsAt(),
            }),
          );
          return;
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
          return;
        case "confidence_update":
          setItems((prev) =>
            upsert(prev, ev.seq, {
              confidence_level: ev.level,
              confidence_score: ev.score,
            }),
          );
          return;
        case "trial_time_remaining":
          // 서버가 이미 decrement 한 remaining 을 보낸다. TRIAL_TOTAL_SEC 과 함께
          // "사용/남은" 값을 일관되게 계산한다 — 두 값의 합은 항상 TRIAL_TOTAL_SEC.
          setTrialRemaining(Math.max(0, ev.remaining_s));
          ctxRef.current.trialRemainingS = ev.remaining_s;
          return;
        case "trial_expired":
          setTrialRemaining(0);
          ctxRef.current.trialRemainingS = 0;
          dispatch({ type: "end", reason: "trial" });
          return;
        case "heartbeat.pong": {
          const now = Date.now();
          const rtt = now - ev.t;
          clearHeartbeatDeadline();
          const r = rttSample(rttRef.current, now, rtt);
          rttRef.current = r.next;
          setRttLevel(r.level);
          return;
        }
        case "auth.refreshed":
          // 서버가 새 토큰을 수락. 별도 처리 불필요.
          return;
        case "error":
          setLastError(ev.message);
          if (!ev.retriable) dispatch({ type: "end", reason: "error" });
          return;
        default:
          return;
      }
    },
    [dispatch],
  );

  // ── 토큰 ─────────────────────────────────────────────────

  async function fetchToken(): Promise<{
    token: string;
    gateway_url: string;
    expires_at: string;
  }> {
    const res = await fetch("/api/realtime/token", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ session_id: opts.sessionId }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j?.error?.message ?? "token_failed");
    }
    return (await res.json()) as {
      token: string;
      gateway_url: string;
      expires_at: string;
    };
  }

  function scheduleTokenRefresh(expiresAtIso: string) {
    const expiresAt = parseExpiresAt(expiresAtIso);
    if (!expiresAt) return;
    const delay = scheduleRefreshDelayMs(expiresAt, new Date());
    clearTokenRefreshTimer();
    tokenRefreshTimerRef.current = setTimeout(() => {
      void refreshToken();
    }, delay);
  }

  async function refreshToken() {
    try {
      const { token, expires_at } = await fetchToken();
      currentTokenRef.current = token;
      const ws = wsRef.current;
      if (ws?.readyState === 1) {
        const ev: ClientEvent = { type: "auth.refresh", token };
        ws.send(JSON.stringify(ev));
      }
      scheduleTokenRefresh(expires_at);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : "token_refresh_failed");
      // 재발급 실패는 치명적 아님. 기존 토큰이 만료될 때 ws.close 가 먼저 발생 → 재연결 루틴이 받는다.
    }
  }

  // ── Heartbeat ────────────────────────────────────────────

  function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimerRef.current = setInterval(() => {
      const ws = wsRef.current;
      if (ws?.readyState !== 1) return;
      const t = Date.now();
      const ev: ClientEvent = { type: "heartbeat.ping", t };
      try {
        ws.send(JSON.stringify(ev));
      } catch {
        return;
      }
      // pong 10초 내 안 오면 끊고 재연결.
      clearHeartbeatDeadline();
      heartbeatDeadlineRef.current = setTimeout(() => {
        // 강제 close → onclose 가 ws_disconnected 이벤트 트리거.
        try {
          ws.close(4000, "heartbeat_timeout");
        } catch {
          // ignore
        }
      }, HEARTBEAT_TIMEOUT_MS);
    }, HEARTBEAT_INTERVAL_MS);
  }

  function stopHeartbeat() {
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
    clearHeartbeatDeadline();
  }

  function clearHeartbeatDeadline() {
    if (heartbeatDeadlineRef.current) {
      clearTimeout(heartbeatDeadlineRef.current);
      heartbeatDeadlineRef.current = null;
    }
  }

  // ── WS 연결 (공통 경로) ───────────────────────────────────

  function connectWs(token: string, gatewayUrl: string): WebSocket {
    const ws = new WebSocket(gatewayUrl);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      const hello: ClientEvent = { type: "auth.hello", token };
      ws.send(JSON.stringify(hello));
      startHeartbeat();
    };

    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") {
        try {
          const parsed = JSON.parse(ev.data) as ServerEvent;
          applyServerEvent(parsed);
        } catch {
          // malformed frame ignored
        }
      }
    };

    ws.onerror = () => {
      setLastError("gateway_error");
    };

    ws.onclose = (closeEv) => {
      stopHeartbeat();
      if (unmountedRef.current) return;
      // 정상 종료(1000) 또는 이미 ended 상태면 재연결 시도 안 함.
      const clean = closeEv.code === 1000 || stateSnapshotRef.current === "ended";
      if (clean) return;
      // 비정상 종료 → 상태기계에 ws_disconnected 이벤트.
      // 재연결 return-to 는 현재 상태를 보고 결정.
      const wasPaused = stateSnapshotRef.current === "paused";
      dispatch({ type: "ws_disconnected", wasPaused });
    };

    return ws;
  }

  // 최신 state 를 ref 로 보관 (onclose 콜백에서 참조).
  const stateSnapshotRef = useRef<SessionState>(INITIAL_STATE);
  useEffect(() => {
    stateSnapshotRef.current = state;
  }, [state]);

  function closeWsSilently() {
    const ws = wsRef.current;
    if (!ws) return;
    try {
      ws.onclose = null;
      ws.close(1000, "client_close");
    } catch {
      // ignore
    }
    wsRef.current = null;
    stopHeartbeat();
  }

  // ── 재연결 ───────────────────────────────────────────────

  function scheduleReconnect() {
    if (unmountedRef.current) return;
    const { delayMs, next } = planNextAttempt(backoffRef.current);
    backoffRef.current = next;
    if (delayMs === null) {
      dispatch({ type: "reconnect_gave_up" });
      return;
    }
    clearReconnectTimer();
    reconnectTimerRef.current = setTimeout(() => {
      void attemptReconnect();
    }, delayMs);
  }

  async function attemptReconnect() {
    if (unmountedRef.current) return;
    try {
      // 재발급된 토큰으로 재연결 (만료됐을 가능성 대비).
      const { token, gateway_url, expires_at } = await fetchToken();
      currentTokenRef.current = token;
      gatewayUrlRef.current = gateway_url;
      scheduleTokenRefresh(expires_at);
      const ws = connectWs(token, gateway_url);
      // open 이 실제로 확정됐는지 onopen 안에서 재연결 완료 이벤트를 쏜다.
      ws.addEventListener(
        "open",
        () => {
          backoffRef.current = resetBackoff();
          dispatch({ type: "ws_reconnected" });
          // paused 상태였으면 mic 재시작하지 않고 유지. live 였으면 start.
          if (ctxRef.current.reconnectReturnTo === "live") {
            void micRef.current.start();
          }
        },
        { once: true },
      );
    } catch (e) {
      setLastError(e instanceof Error ? e.message : "reconnect_failed");
      scheduleReconnect();
    }
  }

  function clearReconnectTimer() {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }

  function clearTokenRefreshTimer() {
    if (tokenRefreshTimerRef.current) {
      clearTimeout(tokenRefreshTimerRef.current);
      tokenRefreshTimerRef.current = null;
    }
  }

  // ── 공용 API ─────────────────────────────────────────────

  async function start() {
    setLastError(null);
    try {
      const { token, gateway_url, expires_at } = await fetchToken();
      currentTokenRef.current = token;
      gatewayUrlRef.current = gateway_url;
      ctxRef.current.hasGatewayToken = true;
      scheduleTokenRefresh(expires_at);

      await mic.start();
      ctxRef.current.hasMicPermission = true;

      connectWs(token, gateway_url);

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
    mic.stop(); // A-4: mic track 완전 중단. audioInFlight 가 자연스럽게 0.
    dispatch({ type: "pause" });
  }

  async function resume() {
    const cmd: ClientEvent = { type: "client.command", command: "resume" };
    wsRef.current?.send(JSON.stringify(cmd));
    await mic.start(); // 권한은 유지되나 track 은 새로 요청.
    dispatch({ type: "resume" });
  }

  function end() {
    const cmd: ClientEvent = { type: "client.command", command: "end" };
    try {
      wsRef.current?.send(JSON.stringify(cmd));
    } catch {
      // ignore
    }
    dispatch({ type: "end", reason: "user" });
    mic.stop();
  }

  function requestClarify(seq: number) {
    const cmd: ClientEvent = {
      type: "client.command",
      command: "manual_clarify",
      utterance_seq: seq,
    };
    wsRef.current?.send(JSON.stringify(cmd));
  }

  // transcript 임시 저장 — items 변경 시마다 localStorage 에 기록.
  // 탭 이탈·새로고침 후 같은 세션 ID 로 재진입하면 복구된다.
  useEffect(() => {
    try {
      if (items.length === 0) return;
      localStorage.setItem(
        TRANSCRIPT_STORAGE_PREFIX + opts.sessionId,
        JSON.stringify({ savedAt: Date.now(), items }),
      );
    } catch {
      // Safari private mode 등 localStorage 실패는 무시.
    }
  }, [items, opts.sessionId]);

  // 세션이 정상 종료(ended/completed) 되면 백업 제거.
  useEffect(() => {
    if (state === "ended" || state === "completed") {
      try {
        localStorage.removeItem(TRANSCRIPT_STORAGE_PREFIX + opts.sessionId);
      } catch {
        // ignore
      }
    }
  }, [state, opts.sessionId]);

  // 세션 경과 타이머 — live/paused/reconnecting 동안 매초 증가, ended/completed 시 정지.
  // Wall clock 기준 (pause 포함). 체험 소진 시간과는 별개.
  useEffect(() => {
    const active =
      state === "live" || state === "paused" || state === "reconnecting";
    if (!active) return;
    // live 로 처음 진입한 시각을 기록 — utterance started_at_ms 기준으로 쓴다.
    if (liveStartedAtRef.current == null) {
      liveStartedAtRef.current = Date.now();
    }
    const id = setInterval(() => setSessionElapsedSec((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [state]);

  // 언마운트 정리.
  useEffect(
    () => () => {
      unmountedRef.current = true;
      clearReconnectTimer();
      clearTokenRefreshTimer();
      stopHeartbeat();
      closeWsSilently();
      micRef.current.stop();
    },
    [],
  );

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
    /** 체험 잔여 초. 게스트 외에는 null. */
    trialRemaining,
    /** 체험 총 초 (env 기반, 고정). 사용/남은 계산의 분모. */
    trialTotal: trialRemaining != null ? TRIAL_TOTAL_SEC : null,
    /** 실제 차감된 체험 시간 (초). 남은 + 사용 = 총 이 항상 성립. */
    trialConsumed:
      trialRemaining != null
        ? Math.max(0, TRIAL_TOTAL_SEC - trialRemaining)
        : null,
    /** 세션 시작(live 진입) 이후 wall-clock 경과 초. pause 중에도 흐름. */
    sessionElapsedSec,
    lastError,
    rttLevel,
  };
}

/** TTL 내 localStorage 백업이 있으면 복구. 없거나 만료면 빈 배열. */
function restoreTranscript(sessionId: string): UtteranceRow[] {
  try {
    const raw = localStorage.getItem(TRANSCRIPT_STORAGE_PREFIX + sessionId);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as {
      savedAt?: number;
      items?: UtteranceRow[];
    };
    if (!parsed.savedAt || !parsed.items) return [];
    if (Date.now() - parsed.savedAt > TRANSCRIPT_TTL_MS) {
      localStorage.removeItem(TRANSCRIPT_STORAGE_PREFIX + sessionId);
      return [];
    }
    return Array.isArray(parsed.items) ? parsed.items : [];
  } catch {
    return [];
  }
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
