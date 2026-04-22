"use client";

import { useEffect, useState } from "react";

interface MonthRow {
  yyyymm: string;
  total_seconds: number;
  users: number;
}
interface UserRow {
  user_id: string;
  seconds_used: number;
}
interface UsageResponse {
  this_month: string;
  byMonth: MonthRow[];
  topUsers: UserRow[];
}

export default function AdminUsagePage() {
  const [data, setData] = useState<UsageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/admin/usage", { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json())?.error?.message ?? "load_failed");
        return (await r.json()) as UsageResponse;
      })
      .then(setData)
      .catch((e) => setError(String(e)));
  }, []);

  if (error) return <div className="container py-10 text-danger">{error}</div>;
  if (!data) return <div className="container py-10">불러오는 중…</div>;

  const maxSec = Math.max(1, ...data.byMonth.map((r) => r.total_seconds));

  return (
    <div className="container py-10 space-y-8">
      <h1 className="text-2xl font-semibold">사용량 대시보드</h1>
      <p className="text-sm text-ink-secondary">
        이번 달 (KST 기준 {data.this_month}) 이후 최근 6개월 집계. F-1 쿼터 관측용.
      </p>

      <section>
        <h2 className="text-lg font-medium">월별 합계</h2>
        <div className="mt-3 space-y-2">
          {data.byMonth.map((r) => (
            <div
              key={r.yyyymm}
              className="rounded border border-border-subtle p-3"
            >
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{r.yyyymm}</span>
                <span className="text-ink-muted">
                  {(r.total_seconds / 3600).toFixed(1)} 시간 · 사용자 {r.users} 명
                </span>
              </div>
              <div className="mt-2 h-2 rounded bg-elev overflow-hidden">
                <div
                  className="h-full bg-primary"
                  style={{ width: `${(r.total_seconds / maxSec) * 100}%` }}
                />
              </div>
            </div>
          ))}
          {data.byMonth.length === 0 && (
            <p className="text-sm text-ink-muted">데이터 없음.</p>
          )}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-medium">이번 달 상위 사용자</h2>
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="text-left text-ink-muted">
              <th className="pb-2">User ID</th>
              <th className="pb-2 text-right">사용 (분)</th>
            </tr>
          </thead>
          <tbody>
            {data.topUsers.map((u) => (
              <tr key={u.user_id} className="border-t border-border-subtle">
                <td className="py-1.5 font-mono text-xs">
                  {u.user_id.slice(0, 8)}…
                </td>
                <td className="py-1.5 text-right">
                  {(u.seconds_used / 60).toFixed(1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.topUsers.length === 0 && (
          <p className="mt-2 text-sm text-ink-muted">데이터 없음.</p>
        )}
      </section>
    </div>
  );
}
