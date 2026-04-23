/**
 * /api/onboarding
 *
 * GET  — 현재 로그인 사용자의 preferences 반환(없으면 빈 행 생성).
 * POST — Step 2 온보딩 폼 저장 + onboarding_completed_at=now().
 *         body.skip=true 이면 필드는 그대로 두고 completed 시각만 찍는다.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { isSupportedLangCode } from "@/lib/constants/languages";
import type { Database } from "@/lib/supabase/types.gen";

// 주의: `Tables["user_preferences"]["Update"]` 를 변수 타입으로 쓰면 Supabase TS 추론이
// `.update()` 호출을 `never` 로 좁힌다(알려진 v2 타입 버그). 그래서 아래에서는
// 인라인 객체 리터럴을 만든 뒤, 그 리터럴을 바로 `.update()` 에 전달한다.
type PrefPatch = {
  onboarding_completed_at: string;
  updated_at: string;
  primary_purpose?: string[];
  domain_tags?: string[];
  default_source_lang?: string | null;
  default_target_lang?: string | null;
  preferred_mode?:
    | Database["public"]["Enums"]["session_mode"]
    | null;
  default_quality_mode?: Database["public"]["Enums"]["quality_mode"];
  wants_term_registration?: boolean;
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Purpose = z.enum([
  "business_meeting",
  "church",
  "medical",
  "legal",
  "education",
  "travel",
  "media",
  "personal",
  "other",
]);

const Mode = z.enum([
  "interactive_interpretation",
  "listener_live",
  "listener_live_recorded",
  "assist_interpretation",
  "conversation_learning",
]);

const Quality = z.enum(["standard", "premium", "auto"]);

const Body = z.object({
  skip: z.boolean().optional(),
  primary_purpose: z.array(Purpose).max(9).optional(),
  domain_tags: z.array(z.string().max(40)).max(20).optional(),
  default_source_lang: z
    .string()
    .optional()
    .refine((v) => v === undefined || isSupportedLangCode(v), {
      message: "unsupported source_lang",
    }),
  default_target_lang: z
    .string()
    .optional()
    .refine((v) => v === undefined || isSupportedLangCode(v), {
      message: "unsupported target_lang",
    }),
  preferred_mode: Mode.nullable().optional(),
  default_quality_mode: Quality.optional(),
  wants_term_registration: z.boolean().optional(),
  display_name: z.string().trim().max(40).optional(),
});

function requireAuth(sb: ReturnType<typeof supabaseServer>) {
  return sb.auth.getUser();
}

export async function GET() {
  const sb = supabaseServer();
  const {
    data: { user },
  } = await requireAuth(sb);
  if (!user) {
    return NextResponse.json(
      { error: { code: "unauthenticated" } },
      { status: 401 },
    );
  }
  const { data } = await sb
    .from("user_preferences")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!data) {
    // 트리거 누락/구 사용자 → service-role 로 빈 행 생성 후 반환.
    const { data: created } = await supabaseService()
      .from("user_preferences")
      .insert({ user_id: user.id })
      .select("*")
      .single();
    return NextResponse.json({ preferences: created ?? null });
  }
  return NextResponse.json({ preferences: data });
}

export async function POST(req: NextRequest) {
  const sb = supabaseServer();
  const {
    data: { user },
  } = await requireAuth(sb);
  if (!user) {
    return NextResponse.json(
      { error: { code: "unauthenticated" } },
      { status: 401 },
    );
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "validation",
          message: "입력 검증 실패",
          issues: parsed.error.issues,
        },
      },
      { status: 422 },
    );
  }
  const input = parsed.data;

  // display_name 업데이트 (선택 입력).
  if (typeof input.display_name === "string") {
    const dn = input.display_name.trim();
    await supabaseService()
      .from("users")
      .update({ display_name: dn.length > 0 ? dn : null })
      .eq("id", user.id);
  }

  // preferences update — auth.users 트리거가 가입 시 빈 행을 생성하므로 update 로 충분.
  // 트리거 실패/구 사용자 대비: 없으면 service-role 로 먼저 insert.
  const now = new Date().toISOString();
  const patch: PrefPatch = {
    onboarding_completed_at: now,
    updated_at: now,
  };

  if (input.skip !== true) {
    if (input.primary_purpose !== undefined)
      patch.primary_purpose = input.primary_purpose;
    if (input.domain_tags !== undefined) patch.domain_tags = input.domain_tags;
    if (input.default_source_lang !== undefined)
      patch.default_source_lang = input.default_source_lang;
    if (input.default_target_lang !== undefined)
      patch.default_target_lang = input.default_target_lang;
    if (input.preferred_mode !== undefined)
      patch.preferred_mode = input.preferred_mode;
    if (input.default_quality_mode !== undefined)
      patch.default_quality_mode = input.default_quality_mode;
    if (input.wants_term_registration !== undefined)
      patch.wants_term_registration = input.wants_term_registration;
  }

  // 빈 행이 없으면 먼저 만들어두고(service-role, RLS bypass), 이후 동일 클라이언트로 UPDATE.
  // service-role 로 쓰지만 이미 `auth.getUser()` 로 사용자 확인 + `.eq("user_id", user.id)` 로
  // 자기 행만 건드리도록 고정했으므로 안전.
  // (supabaseServer() 가 `@supabase/ssr` 의 타입 quirk 로 .update() 를 never 로 좁히는 이슈 회피)
  const svc = supabaseService();
  const { data: existing } = await svc
    .from("user_preferences")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!existing) {
    await svc.from("user_preferences").insert({ user_id: user.id });
  }

  const { error } = await svc
    .from("user_preferences")
    .update(patch)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json(
      { error: { code: "internal", message: error.message } },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, skipped: input.skip === true });
}
