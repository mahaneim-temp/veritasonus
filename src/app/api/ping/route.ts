/**
 * GET /api/ping
 * useNetworkPreflight 가 RTT/jitter를 측정하기 위한 가장 가벼운 엔드포인트.
 * 의도적으로 supabase / 외부 호출 없음. Edge runtime로 두어 latency 최소화.
 */

import { NextResponse } from "next/server";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(
    { ok: true, t: Date.now() },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
