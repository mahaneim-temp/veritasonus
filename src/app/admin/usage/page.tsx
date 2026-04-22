"use client";

import { useEffect, useState } from "react";
import { Info } from "lucide-react";

interface MonthRow {
  yyyymm: string;
  total_seconds: number;
  users: number;
}
interface UserRow {
  user_id: string;
  seconds_used: number;
}
interface TodayRow {
  since: string;
  total_seconds: number;
  session_count: number;
  active_members: number;
}

interface UsageResponse {
  this_month: string;
  byMonth: MonthRow[];
  topUsers: UserRow[];
  today: TodayRow;
}

/**
 * API 원가 가정값 (USD, 분당).
 *   - Google Cloud STT latest_long: ≈ $0.024/분
 *   - Google Cloud Translation v2  : ≈ $0.003/분 (1분 발화당 평균 150 단어 기준)
 *   - Gemini 1.5 Flash (assist+reconstruct): ≈ $0.001/분 실측 평균 가정
 *   합계 ≈ $0.028/분. 실측 후 교체할 상수.
 */
const ASSUMED_COST_USD_PER_MINUTE = 0.028;
const ASSUMED_USD_TO_KRW = 1400; // 환율도 확정값 아님

function estimateCostKrw(seconds: number): number {
  return (seconds / 60) * ASSUMED_COST_USD_PER_MINUTE * ASSUMED_USD_TO_KRW;
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

  const thisMonthRow = data.byMonth.find((r) => r.yyyymm === data.this_month);
  const thisMonthSec = thisMonthRow?.total_seconds ?? 0;
  const thisMonthUsers = thisMonthRow?.users ?? 0;
  const thisMonthCostKrw = estimateCostKrw(thisMonthSec);

  const todaySec = data.today?.total_seconds ?? 0;
  const todayCostKrw = estimateCostKrw(todaySec);

  return (
    <div className="container py-10 space-y-8">
      <h1 className="text-2xl font-semibold">사용량 대시보드</h1>
      <p className="text-sm text-ink-secondary">
        KST 기준. 오늘({new Date(data.today.since).toLocaleDateString("ko-KR")})·이번 달({data.this_month})·최근 6개월. 원가는 가정 단가 추정치.
      </p>

      {/* 오늘 KPI — sessions.speech_active_seconds 직접 합산 (종료된 세션만 포함). */}
      <section>
        <h2 className="text-xs uppercase tracking-wider text-ink-muted mb-3">
          오늘 (KST)
        </h2>
        <div className="grid gap-3 md:grid-cols-3">
          <KpiCard
            label="오늘 사용"
            primary={`${(todaySec / 60).toFixed(1)} 분`}
            sub={`${data.today.session_count} 세션 · 회원 ${data.today.active_members} 명`}
          />
          <KpiCard
            label="오늘 추정 원가"
            primary={`₩${Math.round(todayCostKrw).toLocaleString()}`}
            sub={`≈ $${(todayCostKrw / ASSUMED_USD_TO_KRW).toFixed(3)}`}
            warning
          />
          <KpiCard
            label="기준 시각"
            primary={new Date(data.today.since).toLocaleString("ko-KR", {
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}
            sub="이 시각 이후 ended_at 세션만 포함"
          />
        </div>
      </section>

      {/* 이번 달 KPI — 원가는 가정값 기반 추정치 */}
      <section>
        <h2 className="text-xs uppercase tracking-wider text-ink-muted mb-3">
          이번 달
        </h2>
        <div className="grid gap-3 md:grid-cols-3">
          <KpiCard
            label="이번 달 사용"
            primary={`${(thisMonthSec / 3600).toFixed(1)} 시간`}
            sub={`${(thisMonthSec / 60).toFixed(0)} 분 · ${thisMonthUsers} 명`}
          />
          <KpiCard
            label="이번 달 추정 API 원가"
            primary={`₩${Math.round(thisMonthCostKrw).toLocaleString()}`}
            sub={`≈ $${(thisMonthCostKrw / ASSUMED_USD_TO_KRW).toFixed(2)} · 가정 단가 $${ASSUMED_COST_USD_PER_MINUTE}/분`}
            warning
          />
          <KpiCard
            label="분당 원가 상수"
            primary={`$${ASSUMED_COST_USD_PER_MINUTE.toFixed(3)}`}
            sub={`환율 ${ASSUMED_USD_TO_KRW.toLocaleString()} KRW/USD`}
          />
        </div>
      </section>

      <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-ink-secondary">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <p>
          원가는{" "}
          <strong className="text-ink-primary">가정 단가 기반 추정</strong>
          입니다. Google Cloud Billing 의 실측과 대조한 뒤 상수
          (<code className="text-xs">ASSUMED_COST_USD_PER_MINUTE</code>) 를 확정하세요.
        </p>
      </div>

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
                  <span className="ml-2 text-warning">
                    ≈ ₩{Math.round(estimateCostKrw(r.total_seconds)).toLocaleString()}
                  </span>
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

function KpiCard({
  label,
  primary,
  sub,
  warning = false,
}: {
  label: string;
  primary: string;
  sub?: string;
  warning?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border-subtle bg-surface p-4">
      <p className="text-xs uppercase tracking-wider text-ink-muted">{label}</p>
      <p
        className={
          "mt-1 text-2xl font-semibold tabular-nums " +
          (warning ? "text-warning" : "text-ink-primary")
        }
      >
        {primary}
      </p>
      {sub && <p className="mt-1 text-xs text-ink-muted">{sub}</p>}
    </div>
  );
}
