/**
 * 세션 관련 공통 타입
 * SSOT §9 Data Model과 일치해야 한다.
 */

export type UserRole =
  | "guest"
  | "member"
  | "paid"
  | "admin"
  | "superadmin";

export type SessionMode =
  | "interactive_interpretation"
  | "listener_live"
  | "listener_live_recorded"
  | "assist_interpretation"
  | "conversation_learning";

export type QualityMode = "standard" | "premium" | "auto";

export type ConfidenceLevel = "high" | "medium" | "low";

export type AssetType =
  | "script"
  | "slides"
  | "glossary"
  | "sermon_note"
  | "speaker_profile";

export type ReconStatus = "pending" | "running" | "done" | "failed";

export type SessionState =
  | "idle"
  | "preflight"
  | "prepared"
  | "live"
  | "paused"
  | "reconnecting"
  | "ended"
  | "post_reconstructing"
  | "completed";

export type OwnerType = "member" | "guest";

export interface SessionRow {
  id: string;
  owner_type: OwnerType;
  owner_id: string;
  mode: SessionMode;
  state: SessionState;
  source_lang: string;
  target_lang: string;
  quality_mode: QualityMode;
  topic_guess: string | null;
  audience: string | null;
  context_note: string | null;
  recording_enabled: boolean;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  metadata: Record<string, unknown>;
}

export interface UtteranceRow {
  id: string;
  session_id: string;
  seq: number;
  speaker_label: string | null;
  started_at_ms: number | null;
  ended_at_ms: number | null;
  source_text: string;
  corrected_text: string | null;
  translated_text: string | null;
  confidence_level: ConfidenceLevel;
  confidence_score: number | null;
  requires_review: boolean;
  flags: string[];
  created_at: string;
}

export interface ReconstructionRow {
  id: string;
  session_id: string;
  status: ReconStatus;
  reconstructed_text: string | null;
  summary: string | null;
  key_decisions: unknown[] | null;
  action_items: unknown[] | null;
  important_numbers: unknown[] | null;
  requested_at: string;
  completed_at: string | null;
  error_message: string | null;
  retry_count: number;
}

/** Assist Mode sub-intent */
export type AssistIntent = "speak_self" | "listen_only" | "assist";

/** UI에서 모드 카드 선택지 */
export const SESSION_MODE_LABELS: Record<SessionMode, string> = {
  interactive_interpretation: "통역",
  listener_live: "듣기만 할래요",
  listener_live_recorded: "듣기 + 녹음",
  assist_interpretation: "통역 어시스트",
  conversation_learning: "회화 학습",
};
