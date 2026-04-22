/**
 * 서버(RSC/Route Handler/Server Action)용 Supabase 클라이언트.
 * anon key + cookie-bound auth. RLS가 적용된다.
 */

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./types.gen";

export function supabaseServer() {
  const store = cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("Supabase env missing");

  return createServerClient<Database>(url, anon, {
    cookies: {
      getAll: () =>
        store.getAll().map(({ name, value }) => ({ name, value })),
      setAll: (
        all: { name: string; value: string; options: CookieOptions }[],
      ) => {
        all.forEach(({ name, value, options }) => {
          store.set(name, value, options);
        });
      },
    },
  });
}
