/**
 * realtime-gateway ↔ 브라우저 이벤트 계약 (SSOT §10.2 확장).
 * 이 파일은 브라우저와 게이트웨이가 공유한다.
 */

import type {
  ConfidenceLevel,
  SessionState,
  AssistIntent,
} from "./session";

// ── Server → Client ──────────────────────────────────────────
export type ServerEvent =
  | { type: "session_ready"; session_id: string; gateway_version: string }
  | { type: "state"; state: SessionState }
  | {
      type: "network_warning";
      severity: "warn" | "error";
      reason: string;
    }
  | { type: "speech_started"; at_ms: number }
  | { type: "speech_partial"; seq: number; text: string }
  | {
      type: "speech_final";
      seq: number;
      text: string;
      confidence_score: number;
    }
  | { type: "translation_partial"; seq: number; text: string }
  | {
      type: "translation_final";
      seq: number;
      text: string;
      confidence_level: ConfidenceLevel;
      confidence_score: number;
      flags: string[];
    }
  | {
      type: "confidence_update";
      seq: number;
      level: ConfidenceLevel;
      score: number;
    }
  | {
      type: "clarification_needed";
      seq: number;
      reason: "low_confidence" | "number" | "date" | "negation" | "money";
      suggestion?: string;
    }
  | {
      type: "listener_topic_updated";
      topic: string;
      keywords: string[];
      confidence: number;
    }
  | { type: "recording_started"; at_ms: number }
  | { type: "recording_stopped"; at_ms: number; file_path: string }
  | { type: "reconstruction_done"; reconstruction_id: string }
  | { type: "trial_time_remaining"; remaining_s: number }
  | { type: "trial_expired" }
  | {
      type: "error";
      code: string;
      message: string;
      retriable: boolean;
    };

// ── Client → Server ──────────────────────────────────────────
export type ClientEvent =
  | { type: "auth.hello"; token: string }
  | {
      type: "client.command";
      command: "pause" | "resume" | "end" | "manual_clarify";
      utterance_seq?: number;
    }
  | { type: "client.intent"; intent: AssistIntent };
// 바이너리 프레임(오디오)는 ArrayBuffer로 별도 채널 전송.

/** 게이트웨이 엔드포인트 버전 prefix */
export const GATEWAY_PROTOCOL_VERSION = "v1" as const;
