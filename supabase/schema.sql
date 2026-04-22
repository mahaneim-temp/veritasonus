-- ============================================================
-- Lucid Interpret · Postgres schema (Supabase)
-- SSOT: web_interpretation_full_technical_spec_for_claude_v1_1.docx §9
-- ------------------------------------------------------------
-- 적용:  supabase db reset   (schema.sql + policies.sql 순차 실행)
-- ============================================================

-- ── extensions ────────────────────────────────────────────────
create extension if not exists "pgcrypto";

-- ── enums ─────────────────────────────────────────────────────
do $$ begin
  create type user_role as enum ('guest','member','paid','admin','superadmin');
exception when duplicate_object then null; end $$;

do $$ begin
  create type session_mode as enum (
    'interactive_interpretation',
    'listener_live','listener_live_recorded',
    'assist_interpretation',
    'conversation_learning'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type quality_mode as enum ('standard','premium','auto');
exception when duplicate_object then null; end $$;

do $$ begin
  create type confidence_level as enum ('high','medium','low');
exception when duplicate_object then null; end $$;

do $$ begin
  create type asset_type as enum ('script','slides','glossary','sermon_note','speaker_profile');
exception when duplicate_object then null; end $$;

do $$ begin
  create type recon_status as enum ('pending','running','done','failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type session_state as enum (
    'idle','preflight','prepared','live','paused','ended','post_reconstructing','completed'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type owner_type as enum ('member','guest');
exception when duplicate_object then null; end $$;

do $$ begin
  create type billing_event as enum (
    'subscription_created','subscription_renewed','subscription_canceled',
    'one_time_payment','refund','usage_meter'
  );
exception when duplicate_object then null; end $$;

-- ── tables ────────────────────────────────────────────────────
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  role user_role not null default 'member',
  locale text not null default 'ko',
  display_name text,
  stripe_customer_id text,
  billing_status text,
  created_at timestamptz not null default now()
);
create index if not exists users_stripe_customer_idx on public.users(stripe_customer_id);

create table if not exists public.guest_sessions (
  id uuid primary key default gen_random_uuid(),
  invite_code text,
  ip_hash text not null,
  user_agent text,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_seconds int not null default 0
);
create index if not exists guest_expires_idx on public.guest_sessions(expires_at);

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  owner_type owner_type not null,
  owner_id uuid not null,
  mode session_mode not null,
  state session_state not null default 'idle',
  source_lang text not null,
  target_lang text not null,
  quality_mode quality_mode not null default 'standard',
  topic_guess text,
  audience text,
  context_note text,
  recording_enabled boolean not null default false,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists sessions_owner_idx on public.sessions(owner_type, owner_id, created_at desc);
create index if not exists sessions_state_idx on public.sessions(state);

create table if not exists public.session_assets (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  asset_type asset_type not null,
  file_name text,
  file_path text,
  mime_type text,
  size_bytes int,
  extracted_text text,
  parse_status text not null default 'pending',
  created_at timestamptz not null default now()
);
create index if not exists assets_session_idx on public.session_assets(session_id);

create table if not exists public.utterances (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  seq int not null,
  speaker_label text,
  started_at_ms int,
  ended_at_ms int,
  source_text text not null,
  corrected_text text,
  translated_text text,
  confidence_level confidence_level not null default 'medium',
  confidence_score real,
  requires_review boolean not null default false,
  flags jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique(session_id, seq)
);
create index if not exists utterances_session_seq on public.utterances(session_id, seq);

create table if not exists public.reconstructions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  status recon_status not null default 'pending',
  include_recording boolean not null default false,
  reconstructed_text text,
  summary text,
  key_decisions jsonb,
  action_items jsonb,
  important_numbers jsonb,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  error_message text,
  retry_count int not null default 0
);
create index if not exists reconstructions_status on public.reconstructions(status, requested_at);

-- billing_events 는 두 가지 역할을 한 테이블에 담는다:
--   1) 비즈니스 분류 로그 (event enum: subscription_created / _renewed / _canceled / refund / ...)
--   2) Stripe 웹훅 원본 감사 로그 (event_type + payload: 분류 전 저장, 나중에 백필)
-- 현행 webhook 은 (2) 만 수행 — 원본을 그대로 저장하고 provider_event_id 로 멱등 보장.
-- (1) 분류는 야간 재처리 cron 또는 별도 워커가 수행 (F-1/A-6 이후 범위).
create table if not exists public.billing_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  session_id uuid references public.sessions(id) on delete set null,
  event billing_event,
  event_type text,
  payload jsonb,
  plan text,
  usage_seconds int,
  amount_cents int,
  currency text not null default 'KRW',
  provider text not null default 'stripe',
  provider_event_id text unique,
  created_at timestamptz not null default now()
);
create index if not exists billing_user_idx on public.billing_events(user_id, created_at desc);

create table if not exists public.quality_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.sessions(id) on delete set null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists quality_events_session on public.quality_events(session_id, created_at desc);

-- ── new-user trigger (auth.users → public.users 동기화) ──────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, email, role, locale, display_name)
  values (
    new.id,
    new.email,
    'member',
    coalesce(new.raw_user_meta_data->>'locale', 'ko'),
    new.raw_user_meta_data->>'display_name'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ── helper: 게스트 세션 검증 (쿠키 기반) ─────────────────────
-- service_role 또는 RPC를 통해 호출. 직접 노출하지 않음.
create or replace function public.is_admin()
returns boolean
language sql
security definer set search_path = public
as $$
  select exists(
    select 1 from public.users u
    where u.id = auth.uid() and u.role in ('admin','superadmin')
  );
$$;
