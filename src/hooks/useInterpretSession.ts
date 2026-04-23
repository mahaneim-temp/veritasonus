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

/**
 * WS 가 열린 뒤 서버로부터 첫 메시지(auth.ok 등)가 이 시간 안에 오지 않으면 좀비로 간주하고
 * 강제로 닫아 재연결 사이클을 돌린다. Google STT 가 내부 에러로 첫 byte 도 밀어내지 못하는 경우를 잡음.
 * 값은 "느린 네트워크에서도 false positive 를 내지 않을 만큼 여유" + "좀비일 때 사용자가 기다리는 한계" 사이 절충.
 */
const AUTH_WATCHDOG_MS = 15_000;

/** 체험 총 시간(초). 서버 GUEST_TRIAL_SECONDS 와 일치해야 함. */
const TRIAL_TOTAL_SEC =
  Number(process.env["NEXT_PUBLIC_GUEST_TRIAL_SECONDS"]) || 600;

/** transcript 임시 저장용 localStorage 키 + 만료 (24시간). */
const TRANSCRIPT_STORAGE_PREFIX = "lucid-transcript-";
const TRANSCRIPT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * 에러 코드 → 사용자에게 보여줄 한국어 메시지.
 * 코드 키가 맵에 없으면 원문(짧게 자른) 그대로 노출.
 *
 * 설계: raw 코드(ex: "gateway_error", "google_stt_error")를 사용자에게 그대로 던지지 않는다.
 *   — "gateway_error" 같은 영단어는 겁만 주고 정보는 없다. 대신 "재연결 중"·"음성 인식 일시 오류"
 *     처럼 "상황 + 다음 행동" 을 설명한다.
 */
const ERROR_MESSAGES: Record<string, string> = {
  gateway_error: "게이트웨이 연결이 불안정해요. 자동으로 다시 연결하고 있어요.",
  google_stt_error: "음성 인식 서버에 일시적 문제가 있어 다시 연결하고 있어요.",
  token_failed: "세션 인증 토큰을 받지 못했어요. 로그인 상태를 확인해 주세요.",
  token_refresh_failed: "세션 토큰 갱신에 실패했어요. 연결이 곧 끊길 수 있어요.",
  reconnect_failed: "재연결에 실패했어요. 잠시 뒤 다시 시도해 주세요.",
  reconnect_gave_up: "자동 재연결을 포기했어요. 새로고침하거나 다시 시도해 주세요.",
  auth_watchdog: "서버 응답이 없어 다시 연결하고 있어요.",
  heartbeat_timeout: "네트워크 응답이 느려 연결을 재설정하고 있어요.",
  server_retry: "서버가 세션 재시작을 요청했어요. 다시 연결하고 있어요.",
  unknown: "연결 중 알 수 없는 오류가 발생했어요.",
};

export function humanizeSessionError(raw: string | null): string | null {
  if (!raw) return null;
  const mapped = ERROR_MESSAGES[raw];
  if (mapped) return mapped;
  // unknown code — 너무 길면 잘라서 보여준다.
  return raw.length > 80 ? raw.slice(0, 80) + "…" : raw;
}

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
  const authWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * "이 연결이 충분히 안정적이다" 판정 타이머.
   *
   * 왜 필요:
   *   WS open 직후 바로 backoff 를 리셋하면, 서버가 auth.ok 를 보낸 직후 provider 에러로
   *   WS 를 닫는 시나리오에서 클라가 open→close→open 루프를 영원히 반복한다. 화면에는
   *   "재연결 중" 만 반복 표시되고 원인을 알 수 없게 된다 (예: Google STT 가 미지원 언어에
   *   latest_long 모델을 거부해 즉사하는 경우).
   *
   * 해법:
   *   open 되면 이 타이머를 10 초 뒤 시작. 실제로 10 초를 버티면 그때서야 backoff reset.
   *   10 초 안에 close 되면 reset 건너뛰기 → 3 회 시도 후 진짜 포기.
   */
  const stableConnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
          // 서버가 보내 준 원인 코드를 저장하고, UI 는 humanizeSessionError 로 친화 문구를 만든다.
          // 서버 관점에서는 code 쪽이 "영문 키" 라 쓸만하고, message 는 raw 에러 문자열이라
          // 사용자에게 그대로 보이기엔 부적절 — 우선순위: code > message > "unknown".
          setLastError(ev.code || ev.message || "unknown");
          if (!ev.retriable) {
            dispatch({ type: "end", reason: "error" });
          }
          // retriable:true 는 서버가 WS 를 닫지 않은 "경고" 수준 — 클라가 먼저 끊지 않는다.
          // 진짜 치명적 에러는 서버가 직접 ws.close(1011) 해서 onclose 에서 재연결 루프 합류.
          // (과거엔 여기서도 close 했는데, preflight/idle 단계에서 받으면 재연결 무한 루프가 생겼다.)
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
    // eslint-disable-next-line no-console
    console.info("[session] WebSocket new", { gatewayUrl });
    const ws = new WebSocket(gatewayUrl);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      // eslint-disable-next-line no-console
      console.info("[session] ws.onopen → sending auth.hello");
      const hello: ClientEvent = { type: "auth.hello", token };
      ws.send(JSON.stringify(hello));
      startHeartbeat();
      // 서버가 auth.hello 를 받고 auth.ok (또는 다른 메시지) 를 보내오는 데까지 감시.
      // 기한 내 무응답이면 연결을 닫아 재연결 루프에 합류시킨다.
      armAuthWatchdog(ws);
      // 연결이 10초간 유지되면 backoff 리셋. open 즉시 리셋하지 않는 이유는
      // clearStableConnTimer 주석 참조(서버가 auth.ok 직후 provider 오류로 닫는 시나리오 대비).
      armStableConnTimer();
    };

    ws.onmessage = (ev) => {
      // 서버로부터 첫 메시지 수신 → 응답 채널 살아있음. 워치독 해제.
      clearAuthWatchdog();
      if (typeof ev.data === "string") {
        try {
          const parsed = JSON.parse(ev.data) as ServerEvent;
          // 고빈도 이벤트(speech_partial)는 noisy 해서 생략.
          if (parsed.type !== "speech_partial" && parsed.type !== "heartbeat.pong") {
            // eslint-disable-next-line no-console
            console.info("[session] ws.onmessage", parsed.type, parsed);
          }
          applyServerEvent(parsed);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn("[session] ws.onmessage parse failed", err);
        }
      }
    };

    ws.onerror = (ev) => {
      // 주의: ws.onerror 는 종종 onclose 직전에 발화한다. 여기서 raw 코드를 사용자에게
      // 노출하지 않는다 — onclose 쪽에서 일관된 재연결 루틴이 맡는다.
      // (과거엔 여기서 setLastError("gateway_error") 를 던져 배너를 오염시켰다.)
      // eslint-disable-next-line no-console
      console.warn("[session] ws.onerror", ev);
    };

    ws.onclose = (closeEv) => {
      // eslint-disable-next-line no-console
      console.info("[session] ws.onclose", {
        code: closeEv.code,
        reason: closeEv.reason,
        wasClean: closeEv.wasClean,
        state: stateSnapshotRef.current,
      });
      stopHeartbeat();
      clearAuthWatchdog();
      // 안정 연결 타이머 취소 — 10초 넘기지 못하고 끊겼다는 뜻이니 backoff 리셋은 스킵.
      clearStableConnTimer();
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

  function armAuthWatchdog(ws: WebSocket) {
    clearAuthWatchdog();
    authWatchdogRef.current = setTimeout(() => {
      // onmessage 가 한 번이라도 호출됐으면 이미 clearAuthWatchdog 가 실행되어 여기 도달 불가.
      // 여기 도달 = 서버가 auth.ok 조차 못 보낸 진짜 좀비 상황 → close 해서 재연결 루틴에 맡김.
      setLastError("auth_watchdog");
      try {
        ws.close(4006, "auth_watchdog");
      } catch {
        // ignore
      }
    }, AUTH_WATCHDOG_MS);
  }

  function clearAuthWatchdog() {
    if (authWatchdogRef.current) {
      clearTimeout(authWatchdogRef.current);
      authWatchdogRef.current = null;
    }
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
      // 재연결 3회 모두 실패. 사용자에게 터미널 에러 메시지 한 번 더 명확히.
      setLastError("reconnect_gave_up");
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
          // backoff 는 바로 리셋하지 않는다 — 10초 이상 연결이 유지되면 그때 리셋.
          // 이렇게 해야 서버가 auth.ok 직후 provider 에러로 WS 를 닫는 시나리오(예: Google STT
          // 미지원 언어에 latest_long 모델 거부)에서 무한 open/close 루프가 생기지 않는다.
          armStableConnTimer();
          // 재연결 성공 → 이전 에러 배너 해소.
          setLastError(null);
          dispatch({ type: "ws_reconnected" });
          // paused 상태였으면 mic 재시작하지 않고 유지. live 였으면 start.
          if (ctxRef.current.reconnectReturnTo === "live") {
            void micRef.current.start();
          }
        },
        { once: true },
      );
    } catch (e) {
      setLastError(
        e instanceof Error && e.message ? e.message : "reconnect_failed",
      );
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

  function clearStableConnTimer() {
    if (stableConnTimerRef.current) {
      clearTimeout(stableConnTimerRef.current);
      stableConnTimerRef.current = null;
    }
  }

  /**
   * 연결이 10초간 유지되면 backoff 카운터를 리셋.
   * 중간에 close 되면 clearStableConnTimer 가 호출되어 리셋이 취소되고,
   * 재연결 시도 카운터가 누적되므로 "무한 open/close 루프" 를 자연스럽게 종결시킨다.
   */
  function armStableConnTimer() {
    clearStableConnTimer();
    stableConnTimerRef.current = setTimeout(() => {
      backoffRef.current = resetBackoff();
      stableConnTimerRef.current = null;
    }, 10_000);
  }

  // ── 공용 API ─────────────────────────────────────────────

  async function start() {
    setLastError(null);
    // 진단 로그 — 실측 원인 파악용. 정상화되면 제거 예정.
    // eslint-disable-next-line no-console
    console.info("[session] start() begin", { sessionId: opts.sessionId, mode: opts.mode });
    try {
      // eslint-disable-next-line no-console
      console.info("[session] fetching token");
      const { token, gateway_url, expires_at } = await fetchToken();
      // eslint-disable-next-line no-console
      console.info("[session] token received", { gateway_url, expires_at });
      currentTokenRef.current = token;
      gatewayUrlRef.current = gateway_url;
      ctxRef.current.hasGatewayToken = true;
      scheduleTokenRefresh(expires_at);

      // eslint-disable-next-line no-console
      console.info("[session] requesting mic");
      await mic.start();
      // eslint-disable-next-line no-console
      console.info("[session] mic ready");
      ctxRef.current.hasMicPermission = true;

      // eslint-disable-next-line no-console
      console.info("[session] connecting ws");
      connectWs(token, gateway_url);

      dispatch({ type: "preflight_ok" });
      dispatch({ type: "start_quick" });
      // eslint-disable-next-line no-console
      console.info("[session] start() dispatched preflight_ok + start_quick");
    } catch (e) {
      // 실패 원인은 lastError 로 남기되, 호출자가 "시작 실패" 를 감지해 로컬 UI 상태
      // (예: 리스너 페이지의 started=true) 를 되돌릴 수 있도록 re-throw.
      const code = e instanceof Error && e.message ? e.message : "unknown";
      // eslint-disable-next-line no-console
      console.error("[session] start() failed", { code, error: e });
      setLastError(code);
      mic.stop();
      closeWsSilently();
      throw e instanceof Error ? e : new Error(code);
    }
  }

  /** 사용자가 배너에서 "닫기" 를 눌렀을 때. */
  function clearLastError() {
    setLastError(null);
  }

  /**
   * 사용자가 배너에서 "다시 시도" 를 눌렀을 때.
   * 아직 라이브 중이면 무의미 — 자동 재연결 루프에 맡긴다. 종료 상태면 start() 재시도.
   */
  async function retry() {
    if (
      stateSnapshotRef.current === "live" ||
      stateSnapshotRef.current === "paused" ||
      stateSnapshotRef.current === "reconnecting"
    ) {
      return;
    }
    // 백오프 상태 리셋 + 미연결 타이머/소켓 정리.
    backoffRef.current = resetBackoff();
    clearReconnectTimer();
    clearTokenRefreshTimer();
    closeWsSilently();
    await start();
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
    // 기존: gateway 로 manual_clarify 명령 전송(서버 측 핸들러 없음 — dead path).
    // 지금은 UI 가 CorrectionModal 을 열어 사용자 수정 텍스트를 받아 submitCorrection() 으로 저장한다.
    // 이 함수는 하위 호환용(가드 시그널)으로 남기고, 클라리파이어는 페이지 쪽 상태로 관리.
    const cmd: ClientEvent = {
      type: "client.command",
      command: "manual_clarify",
      utterance_seq: seq,
    };
    try {
      wsRef.current?.send(JSON.stringify(cmd));
    } catch {
      // 게이트웨이 미연결(종료 후 review 에서 수정) 케이스는 무시 — 저장은 REST 로 진행.
    }
  }

  /**
   * 사용자가 직접 입력한 수정 번역을 서버에 저장하고 로컬 state 의 corrected_text 를 갱신.
   * 성공 시 수정된 row 를, 실패 시 에러 메시지를 반환.
   */
  async function submitCorrection(
    seq: number,
    correctedText: string,
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const body = correctedText.trim();
    if (!body) return { ok: false, message: "수정문을 입력해 주세요" };
    try {
      const res = await fetch(
        `/api/sessions/${encodeURIComponent(opts.sessionId)}/utterances/${seq}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ corrected_text: body }),
        },
      );
      if (!res.ok) {
        let msg = "수정 저장에 실패했어요";
        try {
          const data = (await res.json()) as {
            error?: { message?: string };
          };
          if (data?.error?.message) msg = data.error.message;
        } catch {
          // 본문 파싱 실패는 기본 메시지 유지.
        }
        return { ok: false, message: msg };
      }
      setItems((prev) => upsert(prev, seq, { corrected_text: body }));
      return { ok: true };
    } catch (e) {
      return { ok: false, message: `네트워크 오류: ${String(e)}` };
    }
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
      clearAuthWatchdog();
      clearStableConnTimer();
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
    submitCorrection,
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
    /** 원인 코드(영문 키) 또는 짧은 영문 에러 문자열. UI 는 lastErrorMessage 를 쓰는 것이 권장. */
    lastError,
    /** 사용자에게 보여주는 한국어 친화 메시지(null 이면 에러 없음). */
    lastErrorMessage: humanizeSessionError(lastError),
    /** 에러 배너 "닫기" 핸들러. */
    clearLastError,
    /**
     * 에러 배너 "다시 시도" 핸들러.
     * 세션이 live/paused/reconnecting 이면 no-op (자동 재연결 루프가 맡음).
     * 그 외 상태에서는 start() 재시도.
     */
    retry,
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
