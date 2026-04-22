import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabaseServer } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

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
    .maybeSingle();
  if (!prof || !["admin", "superadmin"].includes((prof as any).role)) {
    redirect("/");
  }
}

export default async function AdminDashboardPage() {
  await requireAdmin();
  // KPI는 /api/admin/overview 에서 가져옴 (SSR fetch는 서버 기반 토큰 복제 필요)
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const res = await fetch(`${base}/api/admin/overview`, { cache: "no-store" });
  const overview = res.ok ? await res.json() : null;

  return (
    <div className="container max-w-6xl py-10">
      <h1 className="text-2xl font-semibold">관리자 대시보드</h1>
      <div className="mt-6 grid gap-4 md:grid-cols-4">
        <Kpi label="활성 세션" value={overview?.active_sessions ?? "—"} />
        <Kpi label="체험 진행 중" value={overview?.trial_active ?? "—"} />
        <Kpi label="오늘 가입" value={overview?.today_signups ?? "—"} />
        <Kpi
          label="오늘 매출"
          value={
            overview?.today_revenue_krw != null
              ? `₩${Number(overview.today_revenue_krw).toLocaleString()}`
              : "—"
          }
        />
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xs uppercase tracking-wider text-ink-muted">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}
