import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Users as UsersIcon,
  ListChecks,
  BarChart3,
  FileSearch,
  ArrowRight,
  AlertTriangle,
  Info,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseService } from "@/lib/supabase/service";
import { kstYyyymm } from "@/lib/billing/quota";

/**
 * Server Component 기반 관리자 대시보드.
 * 이전에는 self-fetch 로 /api/admin/overview 를 호출했지만 SSR 요청에 쿠키가
 * 없어 인증 실패로 KPI 가 전부 "—" 로 떨어졌다. 이제 service-role 로 직접 집계.
 */

async function requireAdmin() {
  const sb = supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login");
  const { data: prof } = await sb
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle<{ role: string }>();
  if (!prof || !["admin", "superadmin"].includes(prof.role)) {
    redirect("/");
  }
}

/** 원가 가정값 (admin/usage 와 동일 상수). 실측 후 확정 예정. */
const ASSUMED_COST_USD_PER_MINUTE = 0.028;
const ASSUMED_USD_TO_KRW = 1400;

function kstMidnightISO(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 3600 * 1000);
  kst.setUTCHours(0, 0, 0, 0);
  return new Date(kst.getTime() - 9 * 3600 * 1000).toISOString();
}

async function loadOverview() {
  const svc = supabaseService();
  const since = kstMidnightISO();
  const yyyymm = kstYyyymm();
  const abuseSince = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  const [active, trial, signups, revenue, abuse, thisMonthUsage] =
    await Promise.all([
      svc
        .from("sessions")
        .select("id", { count: "exact", head: true })
        .in("state", ["preflight", "prepared", "live", "paused"]),
      svc
        .from("guest_sessions")
        .select("id", { count: "exact", head: true })
        .gt("expires_at", new Date().toISOString()),
      svc
        .from("users")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since),
      svc
        .from("billing_events")
        .select("payload,created_at")
        .gte("created_at", since)
        .in("event_type", ["checkout.session.completed", "invoice.paid"]),
      svc
        .from("quality_events")
        .select("id", { count: "exact", head: true })
        .eq("event_type", "abuse_flag")
        .gte("created_at", abuseSince),
      svc
        .from("usage_monthly")
        .select("seconds_used,user_id")
        .eq("yyyymm", yyyymm),
    ]);

  const totalSecondsThisMonth =
    (thisMonthUsage.data ?? []).reduce(
      (acc, r) => acc + Number(r.seconds_used ?? 0),
      0,
    ) ?? 0;
  const activeUsersThisMonth = thisMonthUsage.data?.length ?? 0;

  const costUsd =
    (totalSecondsThisMonth / 60) * ASSUMED_COST_USD_PER_MINUTE;
  const costKrw = costUsd * ASSUMED_USD_TO_KRW;

  const todayRevenueKrw =
    (revenue.data ?? []).reduce((acc: number, row) => {
      const payload = row.payload as
        | { data?: { object?: Record<string, unknown> } }
        | null;
      const obj = payload?.data?.object ?? {};
      const amount =
        (obj["amount_total"] as number | undefined) ??
        (obj["amount_paid"] as number | undefined) ??
        (obj["amount_due"] as number | undefined) ??
        0;
      const currency =
        (obj["currency"] as string | undefined)?.toLowerCase() ?? "krw";
      if (currency !== "krw") return acc;
      return acc + Number(amount || 0);
    }, 0);

  return {
    activeSessions: active.count ?? 0,
    trialActive: trial.count ?? 0,
    todaySignups: signups.count ?? 0,
    todayRevenueKrw,
    abuseFlags24h: abuse.count ?? 0,
    thisMonth: {
      yyyymm,
      totalSeconds: totalSecondsThisMonth,
      activeUsers: activeUsersThisMonth,
      estimatedCostKrw: costKrw,
      estimatedCostUsd: costUsd,
    },
  };
}

function budgetBannerTone(ratio: number): {
  tone: "info" | "warning" | "danger";
  label: string;
} {
  if (ratio >= 1) return { tone: "danger", label: "예산 초과" };
  if (ratio >= 0.8) return { tone: "warning", label: "예산 임계 (80%)" };
  if (ratio >= 0.5) return { tone: "info", label: "예산 50% 도달" };
  return { tone: "info", label: "정상" };
}

export default async function AdminDashboardPage() {
  await requireAdmin();
  const ov = await loadOverview();

  const budgetKrw = Number(process.env.BUDGET_MONTHLY_KRW ?? 0);
  const showBudget = budgetKrw > 0;
  const ratio = showBudget ? ov.thisMonth.estimatedCostKrw / budgetKrw : 0;
  const bannerState = budgetBannerTone(ratio);
  const showBanner = showBudget && ratio >= 0.5;

  return (
    <div className="container max-w-6xl py-10 space-y-10">
      <header>
        <h1 className="text-2xl font-semibold">관리자 대시보드</h1>
        <p className="mt-1 text-sm text-ink-secondary">
          {ov.thisMonth.yyyymm} · KST 기준 · 원가는 가정 단가 기반 추정치
        </p>
      </header>

      {showBanner && (
        <div
          className={
            "flex items-start gap-2 rounded-xl border px-4 py-3 text-sm " +
            (bannerState.tone === "danger"
              ? "border-danger/40 bg-danger/5 text-danger"
              : bannerState.tone === "warning"
              ? "border-warning/40 bg-warning/5 text-warning"
              : "border-primary/30 bg-primary/5 text-primary")
          }
        >
          {bannerState.tone === "danger" ? (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          ) : (
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
          )}
          <div className="flex-1">
            <p className="font-medium">{bannerState.label}</p>
            <p className="mt-0.5 text-xs text-ink-secondary">
              이번 달 추정 원가{" "}
              <strong className="text-ink-primary tabular-nums">
                ₩{Math.round(ov.thisMonth.estimatedCostKrw).toLocaleString()}
              </strong>{" "}
              / 설정 예산{" "}
              <strong className="text-ink-primary tabular-nums">
                ₩{budgetKrw.toLocaleString()}
              </strong>{" "}
              ({Math.round(ratio * 100)}%). 가정 단가 기반이므로 실제 GCP
              Billing 의 예산 경고와 별도로 관리하세요.
            </p>
          </div>
        </div>
      )}

      {/* Today / realtime KPI */}
      <section>
        <h2 className="text-xs uppercase tracking-wider text-ink-muted mb-3">
          실시간 / 오늘
        </h2>
        <div className="grid gap-4 md:grid-cols-4">
          <Kpi label="활성 세션" value={ov.activeSessions.toLocaleString()} />
          <Kpi label="체험 진행 중" value={ov.trialActive.toLocaleString()} />
          <Kpi label="오늘 가입" value={ov.todaySignups.toLocaleString()} />
          <Kpi
            label="오늘 매출"
            value={`₩${ov.todayRevenueKrw.toLocaleString()}`}
          />
        </div>
      </section>

      {/* This month KPI */}
      <section>
        <h2 className="text-xs uppercase tracking-wider text-ink-muted mb-3">
          이번 달
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          <Kpi
            label="총 사용 시간"
            value={`${(ov.thisMonth.totalSeconds / 3600).toFixed(1)} 시간`}
            sub={`${Math.round(ov.thisMonth.totalSeconds / 60)} 분 · ${ov.thisMonth.activeUsers} 명`}
          />
          <Kpi
            label="추정 API 원가"
            value={`₩${Math.round(ov.thisMonth.estimatedCostKrw).toLocaleString()}`}
            sub={`≈ $${ov.thisMonth.estimatedCostUsd.toFixed(2)} · 가정 $${ASSUMED_COST_USD_PER_MINUTE}/분`}
            warning
          />
          <Kpi
            label="abuse 플래그 (24h)"
            value={ov.abuseFlags24h.toLocaleString()}
            sub="quality_events(event_type='abuse_flag') 집계"
          />
        </div>
      </section>

      {/* Navigation hub */}
      <section>
        <h2 className="text-xs uppercase tracking-wider text-ink-muted mb-3">
          상세 화면
        </h2>
        <div className="grid gap-3 md:grid-cols-2">
          <NavCard
            href="/admin/sessions"
            icon={<ListChecks className="h-4 w-4" />}
            title="세션 목록"
            sub="상태/모드/기간 필터, 상세 drawer"
          />
          <NavCard
            href="/admin/users"
            icon={<UsersIcon className="h-4 w-4" />}
            title="사용자"
            sub="역할 필터, 이메일 검색, 이번 달 사용량, 시간 지급"
          />
          <NavCard
            href="/admin/usage"
            icon={<BarChart3 className="h-4 w-4" />}
            title="사용량 / 원가"
            sub="월별 합계, 상위 사용자, 추정 API 원가"
          />
          <NavCard
            href="/admin/audit"
            icon={<FileSearch className="h-4 w-4" />}
            title="감사 로그"
            sub="환불, 크레딧 지급, 데이터 삭제 이력"
          />
        </div>
      </section>
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  warning = false,
}: {
  label: string;
  value: string | number;
  sub?: string;
  warning?: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xs uppercase tracking-wider text-ink-muted">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p
          className={
            "text-3xl font-semibold tabular-nums " +
            (warning ? "text-warning" : "")
          }
        >
          {value}
        </p>
        {sub && <p className="mt-1 text-xs text-ink-muted">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function NavCard({
  href,
  icon,
  title,
  sub,
}: {
  href: "/admin/sessions" | "/admin/users" | "/admin/usage" | "/admin/audit";
  icon: React.ReactNode;
  title: string;
  sub: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-2xl border border-border-subtle bg-surface p-4 transition-colors hover:border-border-strong"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-primary">
          {icon}
          <span className="font-medium text-ink-primary">{title}</span>
        </div>
        <ArrowRight className="h-4 w-4 text-ink-muted group-hover:text-ink-primary transition-colors" />
      </div>
      <p className="mt-1 text-xs text-ink-secondary">{sub}</p>
    </Link>
  );
}
