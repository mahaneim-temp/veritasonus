"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

interface Summary {
  sessions_count: number;
  consent_logs_count: number;
  usage_last_6_months: Array<{ yyyymm: string; seconds_used: number }>;
}

export default function AccountDataPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/account/data", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setSummary(j));
  }, []);

  async function requestDelete() {
    const ok = window.confirm(
      "정말로 모든 세션·전사·복원·사용 이력을 삭제하시겠습니까? 되돌릴 수 없습니다.",
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account/data", {
        method: "DELETE",
        credentials: "include",
      });
      const j = await res.json();
      if (!res.ok && res.status !== 207) {
        throw new Error(j?.error?.message ?? "delete_failed");
      }
      setDone(j?.note ?? "삭제가 완료되었습니다.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container max-w-2xl py-12">
      <h1 className="text-2xl font-semibold">내 데이터</h1>
      <p className="mt-2 text-sm text-ink-secondary">
        수집·보유된 데이터를 확인하고, 필요하면 전체 삭제를 요청할 수 있습니다.
        (개인정보 보호법 제36조)
      </p>

      {summary && (
        <dl className="mt-6 grid grid-cols-2 gap-4 text-sm">
          <div className="rounded-lg border border-border-subtle p-3">
            <dt className="text-ink-muted">세션 수</dt>
            <dd className="mt-1 text-lg font-medium">
              {summary.sessions_count.toLocaleString()}
            </dd>
          </div>
          <div className="rounded-lg border border-border-subtle p-3">
            <dt className="text-ink-muted">동의 기록</dt>
            <dd className="mt-1 text-lg font-medium">
              {summary.consent_logs_count.toLocaleString()}건
            </dd>
          </div>
          <div className="col-span-2 rounded-lg border border-border-subtle p-3">
            <dt className="text-ink-muted">최근 6개월 사용 시간</dt>
            <dd className="mt-2 text-sm">
              {summary.usage_last_6_months.length === 0 ? (
                <span className="text-ink-muted">기록 없음</span>
              ) : (
                <ul className="space-y-1">
                  {summary.usage_last_6_months.map((r) => (
                    <li key={r.yyyymm}>
                      {r.yyyymm}: {(r.seconds_used / 60).toFixed(1)} 분
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </div>
        </dl>
      )}

      <div className="mt-10 rounded-lg border border-danger/40 bg-danger/5 p-4">
        <h2 className="text-sm font-medium text-danger">전체 데이터 삭제</h2>
        <p className="mt-1 text-xs text-ink-secondary">
          세션·전사·번역·복원·업로드 자료·사용 이력이 즉시 삭제됩니다. 결제
          구독이 활성화되어 있는 경우 별도 해지 절차가 필요합니다.
        </p>
        <Button
          onClick={requestDelete}
          disabled={busy || !!done}
          className="mt-3"
          variant="destructive"
        >
          {busy ? "삭제 중…" : "내 데이터 전체 삭제"}
        </Button>
        {done && <p className="mt-3 text-sm text-success">{done}</p>}
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </div>
    </div>
  );
}
