/**
 * Supabase service-role 클라이언트로 utterance/세션을 persist.
 * 큰 파일(녹음)은 Storage 'recordings' 버킷에 별도 업로드.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ENV } from "./env.js";
import { logger } from "./logger.js";
import type { Database } from "./db-types.js";
import { addSessionUsage } from "./usage.js";

let _sb: SupabaseClient<Database> | null = null;
function sb(): SupabaseClient<Database> {
  if (_sb) return _sb;
  _sb = createClient<Database>(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _sb;
}

export interface UtteranceWrite {
  session_id: string;
  seq: number;
  speaker_label?: string | null;
  started_at_ms?: number | null;
  ended_at_ms?: number | null;
  source_text: string;
  translated_text?: string | null;
  confidence_level: "high" | "medium" | "low";
  confidence_score?: number | null;
  requires_review: boolean;
  flags: string[];
}

export async function writeUtterance(u: UtteranceWrite): Promise<void> {
  try {
    const { error } = await sb().from("utterances").insert(u);
    if (error) throw error;
  } catch (e) {
    logger.error({ err: String(e), session: u.session_id }, "utterance_write_failed");
  }
}

/**
 * 특정 utterance(session_id, seq) 의 translated_text 를 UPDATE.
 * partial 스트림은 마지막 final 값으로 덮어쓴다 — 이력 보존 필요 시 별도 테이블 방식으로 전환.
 */
export async function updateUtteranceTranslation(
  sessionId: string,
  seq: number,
  translatedText: string,
): Promise<void> {
  try {
    const { error } = await sb()
      .from("utterances")
      .update({ translated_text: translatedText })
      .eq("session_id", sessionId)
      .eq("seq", seq);
    if (error) throw error;
  } catch (e) {
    logger.error(
      { err: String(e), session: sessionId, seq },
      "utterance_translation_update_failed",
    );
  }
}

type SessionUpdate = Database["public"]["Tables"]["sessions"]["Update"];

/**
 * F-1: 세션 종료 시 usage_monthly 누적 + 세션 수준 speech_active_seconds 기록.
 * session-handler 가 control.end / ws close 양 경로에서 호출.
 * 세션 수준 누적값은 "오늘 사용량" 등 일별 집계에 사용.
 */
export async function finalizeSessionUsage(
  sessionId: string,
  ownerType: "member" | "guest",
  ownerId: string,
  elapsedSeconds: number,
): Promise<void> {
  await addSessionUsage(sb(), ownerType, ownerId, elapsedSeconds);
  try {
    const { error } = await sb()
      .from("sessions")
      .update({ speech_active_seconds: Math.max(0, Math.floor(elapsedSeconds)) })
      .eq("id", sessionId);
    if (error) throw error;
  } catch (e) {
    logger.warn(
      { err: String(e), session: sessionId },
      "session_speech_active_write_failed",
    );
  }
}

export async function markSessionState(
  sessionId: string,
  state: "live" | "paused" | "ended",
): Promise<void> {
  const patch: SessionUpdate = { state };
  if (state === "live") patch.started_at = new Date().toISOString();
  if (state === "ended") patch.ended_at = new Date().toISOString();
  try {
    const { error } = await sb()
      .from("sessions")
      .update(patch)
      .eq("id", sessionId);
    if (error) throw error;
  } catch (e) {
    logger.error({ err: String(e), session: sessionId, state }, "session_state_write_failed");
  }
}
