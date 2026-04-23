-- 2026-04-23: 무제한 권한 화이트리스트 + 가입 트리거 확장 + 기존 계정 승격.
-- 선행: '2026-04-23-unlimited-role-enum.sql' 이 먼저 적용되어 있어야 한다
-- (user_role enum 에 'unlimited' 값이 존재해야 함).

-- 1. 화이트리스트 테이블.
--    여기에 이메일이 있으면 가입 즉시 users.role = 'unlimited' 로 부여된다.
--    admin 과는 별개 권한 — /admin 접근 권한은 부여되지 않는다.
CREATE TABLE IF NOT EXISTS public.unlimited_whitelist (
  email text PRIMARY KEY,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 2. RLS: 관리자만 볼 수 있도록.
ALTER TABLE public.unlimited_whitelist ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS whitelist_admin_read ON public.unlimited_whitelist;
CREATE POLICY whitelist_admin_read ON public.unlimited_whitelist
  FOR SELECT
  USING (public.is_admin());
DROP POLICY IF EXISTS whitelist_admin_write ON public.unlimited_whitelist;
CREATE POLICY whitelist_admin_write ON public.unlimited_whitelist
  FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 3. 가입 트리거 확장: 화이트리스트 hit 이면 role='unlimited' 로 생성.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  assigned_role user_role := 'member';
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.unlimited_whitelist w WHERE w.email = new.email
  ) THEN
    assigned_role := 'unlimited';
  END IF;

  INSERT INTO public.users (id, email, role, locale, display_name)
  VALUES (
    new.id,
    new.email,
    assigned_role,
    COALESCE(new.raw_user_meta_data->>'locale', 'ko'),
    new.raw_user_meta_data->>'display_name'
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_preferences (user_id)
  VALUES (new.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN new;
END;
$$;

-- 4. 화이트리스트 시드: mashiah@gmail.com.
INSERT INTO public.unlimited_whitelist (email, note)
VALUES ('mashiah@gmail.com', '내부 테스트·장기 QA')
ON CONFLICT (email) DO NOTHING;

-- 5. 기존 사용자 승격: 이미 가입된 화이트리스트 이메일은 즉시 unlimited 로 변경.
--    단, 이미 admin/superadmin 인 계정은 건드리지 않는다(권한 하향 방지).
UPDATE public.users u
SET role = 'unlimited'
FROM public.unlimited_whitelist w
WHERE u.email = w.email
  AND u.role NOT IN ('admin', 'superadmin', 'unlimited');
