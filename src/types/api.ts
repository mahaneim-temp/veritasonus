/** REST API 요청/응답 DTO. 서버/클라 공유. */

import type {
  SessionMode,
  QualityMode,
  AssetType,
} from "./session";

export type { AssetType };

// ── 공통 ─────────────────────────────────────────────────────
export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

// ── /api/auth/guest/start ────────────────────────────────────
export interface GuestStartRequest {
  invite_code?: string;
  user_agent?: string;
}
export interface GuestStartResponse {
  guest_id: string;
  expires_at: string;
  trial_seconds: number;
}

// ── /api/sessions ────────────────────────────────────────────
export interface CreateSessionRequest {
  mode: SessionMode;
  source_lang: string;
  target_lang: string;
  quality_mode: QualityMode;
  context_note?: string;
  audience?: string;
  recording_enabled?: boolean;
}
export interface CreateSessionResponse {
  session_id: string;
  state: "preflight";
}

// ── /api/sessions/[id]/assets ────────────────────────────────
export interface UploadAssetResponse {
  asset_id: string;
  parse_status: "pending";
}

// ── /api/sessions/[id]/reconstruct ───────────────────────────
export interface ReconstructRequest {
  include_recording?: boolean;
  force?: boolean;
}
export interface ReconstructResponse {
  reconstruction_id: string;
  status: "pending";
}

// ── /api/realtime/token ──────────────────────────────────────
export interface RealtimeTokenRequest {
  session_id: string;
}
export interface RealtimeTokenResponse {
  token: string;
  gateway_url: string;
  expires_at: string;
}

// ── /api/billing/checkout ────────────────────────────────────
export interface CheckoutRequest {
  plan: "pro_monthly" | "pro_yearly";
  return_url: string;
}
export interface CheckoutResponse {
  checkout_url: string;
}

// ── /api/admin/overview ──────────────────────────────────────
export interface AdminOverviewResponse {
  active_sessions: number;
  trial_active: number;
  today_signups: number;
  today_revenue_krw: number;
  abuse_flags: number;
}
