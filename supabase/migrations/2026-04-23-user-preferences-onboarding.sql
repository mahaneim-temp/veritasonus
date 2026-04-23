-- 2026-04-23: signup/onboarding redesign
--   * user_preferences  : 가입 후 Step 2 온보딩에서 수집한 개인화 값을 보관.
--   * user_terms        : v1.1 용어 바이어싱용 사전 컬럼. 이번 릴리스에선 스키마만.
-- (user_voice_profiles 는 실제 음성 적응 기능 구현 시 별도 마이그레이션에서 추가.)
--
-- 원칙:
--   * 자주 바뀌거나 배열형인 취향은 users 테이블에서 분리해서 여기에 둔다.
--   * onboarding_completed_at 이 NULL 이면 middleware 가 /onboarding 으로 유도.
--   * 스킵한 사용자도 onboarding_completed_at 만 채워진 빈 행을 갖는다.

-- 1) user_preferences ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_preferences (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,

  -- 사용 목적(다중): business_meeting | church | medical | legal | education
  --                  travel | media | personal | other
  primary_purpose text[] NOT NULL DEFAULT '{}',

  -- 자유 키워드 도메인 태그(예: '스타트업','의료','교회')
  domain_tags text[] NOT NULL DEFAULT '{}',

  -- /start/quick 등의 기본값. NULL 이면 매번 선택.
  default_source_lang text,
  default_target_lang text,

  -- 첫 진입 시 추천 흐름. NULL 이면 /onboarding/next 에서 카드 3개로 선택.
  preferred_mode session_mode,

  -- 품질 기본값. 사용자가 바꿔도 이 테이블은 안 건드림(세션별).
  default_quality_mode quality_mode NOT NULL DEFAULT 'auto',

  -- v1.1: 용어/자료 선등록 기능 공지 대상인지.
  wants_term_registration boolean NOT NULL DEFAULT false,

  -- NULL = 온보딩 미완료. 스킵해도 값은 채워짐(빈 preferences 상태).
  onboarding_completed_at timestamptz,

  updated_at timestamptz NOT NULL DEFAULT now()
);

-- onboarding 게이트 미들웨어에서 자주 조회하므로 인덱스(=PK) 외 추가 필요 없음.

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS prefs_owner_read   ON public.user_preferences;
DROP POLICY IF EXISTS prefs_owner_upsert ON public.user_preferences;
DROP POLICY IF EXISTS prefs_owner_update ON public.user_preferences;
DROP POLICY IF EXISTS prefs_admin_all    ON public.user_preferences;

CREATE POLICY prefs_owner_read ON public.user_preferences
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY prefs_owner_upsert ON public.user_preferences
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY prefs_owner_update ON public.user_preferences
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY prefs_admin_all ON public.user_preferences
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());


-- 2) user_terms (v1.1 바이어싱 사전 준비) ─────────────────────────
CREATE TABLE IF NOT EXISTS public.user_terms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  source_text text NOT NULL,
  target_text text NOT NULL,
  lang_pair text NOT NULL,           -- 'ko-en' 형태
  domain_tag text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_terms_by_user
  ON public.user_terms(user_id, lang_pair);

ALTER TABLE public.user_terms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS terms_owner_all ON public.user_terms;
DROP POLICY IF EXISTS terms_admin_all ON public.user_terms;

CREATE POLICY terms_owner_all ON public.user_terms
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY terms_admin_all ON public.user_terms
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());


-- 3) handle_new_user 트리거 보강: auth.users INSERT 시 user_preferences 빈 행 동시 생성
--    (RLS bypass — security definer)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email, role, locale, display_name)
  VALUES (
    new.id,
    new.email,
    'member',
    coalesce(new.raw_user_meta_data->>'locale', 'ko'),
    new.raw_user_meta_data->>'display_name'
  )
  ON CONFLICT (id) DO NOTHING;

  -- 온보딩 행 미리 생성(onboarding_completed_at = NULL → 미완료 상태).
  INSERT INTO public.user_preferences (user_id)
  VALUES (new.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN new;
END;
$$;

-- 이미 가입되어 있는 기존 사용자(온보딩 도입 전 가입자)에 대한 backfill:
--   빈 preferences 행을 만들되 onboarding_completed_at 을 now() 로 세팅하여
--   기존 사용자는 온보딩 게이트에 걸리지 않게 한다. 원하면 언제든 설정 페이지에서 채움.
INSERT INTO public.user_preferences (user_id, onboarding_completed_at)
SELECT u.id, now()
FROM public.users u
LEFT JOIN public.user_preferences p ON p.user_id = u.id
WHERE p.user_id IS NULL;
