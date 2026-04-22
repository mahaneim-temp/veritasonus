/**
 * A-6 감사 로그 (audit_log) 공용 래퍼.
 *
 * 관리자 API 가 중요한 행위(환불·권한 변경·abuse 처리·데이터 삭제 등) 를 수행하기 직전/직후에
 * 호출하여 `audit_log` 에 기록한다.
 *
 * 원칙:
 *   - 실패해도 본 행위를 막지 않는다 (best-effort). 단, 치명적인 경우 로그로 남긴다.
 *   - 시스템(actor=null) 이 자동 기록할 때도 사용 가능.
 */

import { supabaseService } from "@/lib/supabase/service";
import { logger } from "@/lib/utils/logger";
import type { Json } from "@/lib/supabase/types.gen";

export type AuditAction =
  | "refund"
  | "role_change"
  | "session_terminate"
  | "abuse_flag"
  | "data_delete"
  | "quota_override"
  | "other";

export type AuditTargetType =
  | "session"
  | "user"
  | "billing_event"
  | "reconstruction"
  | "asset"
  | "other";

export interface AuditEntry {
  actorId: string | null;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string | null;
  payload?: Record<string, unknown>;
}

export async function audit(entry: AuditEntry): Promise<void> {
  try {
    const { error } = await supabaseService()
      .from("audit_log")
      .insert({
        actor_id: entry.actorId,
        action: entry.action,
        target_type: entry.targetType,
        target_id: entry.targetId,
        payload: (entry.payload ?? {}) as Json,
      });
    if (error) throw error;
  } catch (e) {
    logger.error("audit_log_failed", {
      err: String(e),
      action: entry.action,
      target: entry.targetType,
    });
  }
}
