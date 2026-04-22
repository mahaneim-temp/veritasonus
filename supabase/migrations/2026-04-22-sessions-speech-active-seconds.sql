-- 2026-04-22 — sessions 에 speech_active_seconds 추가.
-- 목적: 세션 종료 시 gateway 가 "실제 말한 누적 초수" 를 세션 수준에 기록. 일별 집계에 필요.
-- schema.sql 은 `create table if not exists` 라 기존 테이블엔 컬럼이 추가되지 않는다.
-- Supabase SQL Editor 에서 본 파일을 한 번 실행하면 된다 (idempotent).

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS speech_active_seconds int NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS sessions_ended_at_idx
  ON public.sessions(ended_at DESC);
