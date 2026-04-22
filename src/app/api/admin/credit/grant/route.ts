/**
 * POST /api/admin/credit/grant
 *
 * 관리자가 특정 회원에게 '사용 시간' 을 수동으로 지급 (보상, 장애 보상 등).
 * 본 구현은 가장 단순한 방식 — 해당 회원의 이번 달 `usage_monthly.seconds_used`
 * 에서 `grant_seconds` 만큼 빼준다 (0 미만으로는 내려가지 않음).
 * 플랜 한도는 기존 그대로, "사용 시간" 만 되돌리는 효과.
 *
 * 누가 누구에게 얼마나 지급했는지 모두 `audit_log` 에 기록된다 (성공·실패 모두).
 *
 * body:
 *   { user_id: uuid, grant_seconds: int(>0), reason: string }
 *
 * 권한: admin | superadmin. 수퍼관리자 전용으로 올리고 싶으면 requireAdmin 조건 강화.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { audit } from "@/lib/audit";
import { kstYyyymm } from "@/lib/billing/quota";
import { logger } from "@/lib/utils/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  user_id: z.string().uuid(),
  grant_seconds: z.number().int().positive().max(24 * 3600 * 30),
  reason: z.string().min(1).max(500),
});

async function requireAdmin() {
  const sb = supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return null;
  const { data: prof } = await sb
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle<{ role: string }>();
  if (!prof || !["admin", "superadmin"].includes(prof.role)) return null;
  return user;
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json(
      { error: { code: "forbidden", message: "관리자 전용" } },
      { status: 403 },
    );
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation", message: "검증 실패" } },
      { status: 422 },
    );
  }
  const { user_id, grant_seconds, reason } = parsed.data;

  const svc = supabaseService();
  const yyyymm = kstYyyymm();

  try {
    // 현재 사용량 조회 → 차감할 new_value 계산.
    const { data: existing } = await svc
      .from("usage_monthly")
      .select("seconds_used")
      .eq("user_id", user_id)
      .eq("yyyymm", yyyymm)
      .maybeSingle();
    const prev = Number(existing?.seconds_used ?? 0);
    const next = Math.max(0, prev - grant_seconds);
    const actuallyGranted = prev - next;

    const { error: upErr } = await svc.from("usage_monthly").upsert(
      { user_id, yyyymm, seconds_used: next },
      { onConflict: "user_id,yyyymm" },
    );
    if (upErr) throw upErr;

    await audit({
      actorId: admin.id,
      action: "quota_override",
      targetType: "user",
      targetId: user_id,
      payload: {
        kind: "credit_grant",
        yyyymm,
        requested_seconds: grant_seconds,
        actually_granted_seconds: actuallyGranted,
        prev_seconds_used: prev,
        next_seconds_used: next,
        reason,
      },
    });

    return NextResponse.json({
      ok: true,
      yyyymm,
      requested_seconds: grant_seconds,
      actually_granted_seconds: actuallyGranted,
      prev_seconds_used: prev,
      next_seconds_used: next,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("admin_credit_grant_failed", { user_id, err: msg });
    await audit({
      actorId: admin.id,
      action: "quota_override",
      targetType: "user",
      targetId: user_id,
      payload: {
        kind: "credit_grant",
        ok: false,
        requested_seconds: grant_seconds,
        reason,
        error: msg.slice(0, 500),
      },
    });
    return NextResponse.json(
      { error: { code: "internal", message: "크레딧 지급 실패" } },
      { status: 500 },
    );
  }
}
