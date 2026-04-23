-- ============================================================
-- Lucid Interpret · Row Level Security policies
-- 적용 순서: schema.sql → policies.sql
-- ============================================================

alter table public.users           enable row level security;
alter table public.guest_sessions  enable row level security;
alter table public.sessions        enable row level security;
alter table public.session_assets  enable row level security;
alter table public.utterances      enable row level security;
alter table public.reconstructions enable row level security;
alter table public.billing_events  enable row level security;
alter table public.quality_events  enable row level security;
alter table public.user_preferences enable row level security;
alter table public.user_terms       enable row level security;

-- ── users ────────────────────────────────────────────────────
drop policy if exists users_self_read   on public.users;
drop policy if exists users_self_update on public.users;
drop policy if exists users_admin_all   on public.users;

create policy users_self_read on public.users
  for select using (auth.uid() = id);

create policy users_self_update on public.users
  for update using (auth.uid() = id) with check (auth.uid() = id);

create policy users_admin_all on public.users
  for all using (public.is_admin()) with check (public.is_admin());

-- ── guest_sessions: anon 접근 안 함. service_role만. ─────────
-- (RLS 활성 + 정책 미부여 = 접근 차단. service-role 키는 RLS bypass)

-- ── sessions ─────────────────────────────────────────────────
drop policy if exists sessions_owner_read   on public.sessions;
drop policy if exists sessions_owner_write  on public.sessions;
drop policy if exists sessions_admin_all    on public.sessions;

create policy sessions_owner_read on public.sessions
  for select using (
    (owner_type = 'member' and owner_id = auth.uid())
  );

create policy sessions_owner_write on public.sessions
  for insert with check (
    (owner_type = 'member' and owner_id = auth.uid())
  );

create policy sessions_owner_update on public.sessions
  for update using (owner_type = 'member' and owner_id = auth.uid())
  with check (owner_type = 'member' and owner_id = auth.uid());

create policy sessions_admin_all on public.sessions
  for all using (public.is_admin()) with check (public.is_admin());

-- ── session_assets ───────────────────────────────────────────
drop policy if exists assets_member_rw on public.session_assets;
drop policy if exists assets_admin_all on public.session_assets;

create policy assets_member_rw on public.session_assets
  for all using (
    exists (
      select 1 from public.sessions s
      where s.id = session_assets.session_id
        and s.owner_type = 'member' and s.owner_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.sessions s
      where s.id = session_assets.session_id
        and s.owner_type = 'member' and s.owner_id = auth.uid()
    )
  );

create policy assets_admin_all on public.session_assets
  for all using (public.is_admin()) with check (public.is_admin());

-- ── utterances ───────────────────────────────────────────────
drop policy if exists utt_member_read on public.utterances;
drop policy if exists utt_admin_all   on public.utterances;

create policy utt_member_read on public.utterances
  for select using (
    exists (
      select 1 from public.sessions s
      where s.id = utterances.session_id
        and s.owner_type = 'member' and s.owner_id = auth.uid()
    )
  );

create policy utt_admin_all on public.utterances
  for all using (public.is_admin()) with check (public.is_admin());
-- INSERT/UPDATE는 service-role(realtime-gateway/edge func)만 수행

-- ── reconstructions ──────────────────────────────────────────
drop policy if exists recon_member_read on public.reconstructions;
drop policy if exists recon_admin_all   on public.reconstructions;

create policy recon_member_read on public.reconstructions
  for select using (
    exists (
      select 1 from public.sessions s
      where s.id = reconstructions.session_id
        and s.owner_type = 'member' and s.owner_id = auth.uid()
    )
  );

create policy recon_admin_all on public.reconstructions
  for all using (public.is_admin()) with check (public.is_admin());

-- ── billing_events ───────────────────────────────────────────
drop policy if exists billing_self_read on public.billing_events;
drop policy if exists billing_admin_all on public.billing_events;

create policy billing_self_read on public.billing_events
  for select using (user_id = auth.uid());

create policy billing_admin_all on public.billing_events
  for all using (public.is_admin()) with check (public.is_admin());

-- ── quality_events: 관리자만 SELECT. INSERT는 service-role. ──
drop policy if exists quality_admin_read on public.quality_events;

create policy quality_admin_read on public.quality_events
  for select using (public.is_admin());

-- ── user_preferences ─────────────────────────────────────────
drop policy if exists prefs_owner_read   on public.user_preferences;
drop policy if exists prefs_owner_upsert on public.user_preferences;
drop policy if exists prefs_owner_update on public.user_preferences;
drop policy if exists prefs_admin_all    on public.user_preferences;

create policy prefs_owner_read on public.user_preferences
  for select using (auth.uid() = user_id);

create policy prefs_owner_upsert on public.user_preferences
  for insert with check (auth.uid() = user_id);

create policy prefs_owner_update on public.user_preferences
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy prefs_admin_all on public.user_preferences
  for all using (public.is_admin()) with check (public.is_admin());

-- ── user_terms (v1.1 용어 바이어싱) ─────────────────────────
drop policy if exists terms_owner_all on public.user_terms;
drop policy if exists terms_admin_all on public.user_terms;

create policy terms_owner_all on public.user_terms
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy terms_admin_all on public.user_terms
  for all using (public.is_admin()) with check (public.is_admin());

-- ============================================================
-- Storage 버킷 정책 (Supabase Storage)
-- ------------------------------------------------------------
-- Supabase Studio → Storage 에서 다음 버킷 생성:
--   recordings (private)
--   uploads    (private)
--   reconstructions (private)
--
-- 객체 키 규칙:  {session_id}/{filename}
-- RLS: 객체의 (storage.foldername(name))[1] 가 sessions.id 와 매칭되고
--      해당 세션이 사용자의 것일 때만 SELECT 허용. INSERT는 service-role.
-- ============================================================
