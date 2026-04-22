/**
 * Service-role Supabase client — RLS bypass. 서버 전용.
 * 사용처:
 *  - 게스트 세션(guest_sessions) 쓰기
 *  - webhook 처리, 관리자 집계
 *  - realtime-gateway 는 별도 init (동일 패턴).
 *
 * NEVER import from client bundle.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types.gen";

let _client: SupabaseClient<Database> | null = null;

export function supabaseService(): SupabaseClient<Database> {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const srv = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !srv) throw new Error("Supabase service env missing");
  _client = createClient<Database>(url, srv, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}
