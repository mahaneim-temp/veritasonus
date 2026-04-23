-- 2026-04-23: user_wallet, credit_packs_ledger, users marketing columns, guest_sessions mode column

-- 1) Users: marketing consent fields
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS marketing_opt_in boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS marketing_opt_in_at timestamptz,
  ADD COLUMN IF NOT EXISTS marketing_opt_out_at timestamptz;

-- 2) user_wallet: per-user credit balance
CREATE TABLE IF NOT EXISTS public.user_wallet (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  free_seconds_remaining int NOT NULL DEFAULT 600,
  free_reset_yyyymm text NOT NULL DEFAULT '',
  purchased_seconds int NOT NULL DEFAULT 0,
  granted_seconds int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.user_wallet ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wallet_owner_read" ON public.user_wallet
  FOR SELECT USING (auth.uid() = user_id);

-- service role has full access via supabaseService() — no policy needed for that path.

-- 3) credit_packs_ledger: immutable record of each pack purchase
CREATE TABLE IF NOT EXISTS public.credit_packs_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pack_id text NOT NULL,
  base_seconds int NOT NULL,
  bonus_seconds int NOT NULL,
  carried_free_seconds int NOT NULL DEFAULT 0,
  price_krw int NOT NULL,
  payment_provider text NOT NULL DEFAULT 'mock',
  provider_event_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.credit_packs_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ledger_owner_read" ON public.credit_packs_ledger
  FOR SELECT USING (auth.uid() = user_id);

CREATE UNIQUE INDEX IF NOT EXISTS ledger_event_unique
  ON public.credit_packs_ledger(payment_provider, provider_event_id)
  WHERE provider_event_id IS NOT NULL;

-- 4) guest_sessions: add mode column for taste vs regular trial
ALTER TABLE public.guest_sessions
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'trial'
  CHECK (mode IN ('trial', 'taste'));
