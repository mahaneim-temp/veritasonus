"use client";

import { useEffect, useState } from "react";

interface Row {
  id: string;
  email: string;
  role: string;
  locale: string;
  display_name: string | null;
  billing_status: string | null;
  created_at: string;
}
interface Resp {
  items: Row[];
  total: number;
  page: number;
  size: number;
}

const ROLES = ["", "guest", "member", "paid", "admin", "superadmin"];

export default function AdminUsersPage() {
  const [data, setData] = useState<Resp | null>(null);
  const [page, setPage] = useState(0);
  const [role, setRole] = useState("");
  const [q, setQ] = useState("");
  const [qInput, setQInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creditTarget, setCreditTarget] = useState<Row | null>(null);

  async function load() {
    const qs = new URLSearchParams({ page: String(page), size: "50" });
    if (role) qs.set("role", role);
    if (q) qs.set("q", q);
    const res = await fetch(`/api/admin/users?${qs.toString()}`, {
      credentials: "include",
    });
    if (!res.ok) {
      setError((await res.json())?.error?.message ?? "load_failed");
      return;
    }
    setData(await res.json());
  }

  useEffect(() => {
    void load();
  }, [page, role, q]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="container py-10 space-y-5">
      <h1 className="text-2xl font-semibold">사용자</h1>

      <form
        className="flex flex-wrap items-center gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(qInput);
          setPage(0);
        }}
      >
        <label>
          역할:
          <select
            value={role}
            onChange={(e) => {
              setRole(e.target.value);
              setPage(0);
            }}
            className="ml-2 rounded border border-border-subtle bg-surface px-2 py-1"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r || "전체"}
              </option>
            ))}
          </select>
        </label>
        <input
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          placeholder="이메일 검색"
          className="rounded border border-border-subtle bg-surface px-2 py-1"
        />
        <button type="submit" className="rounded border border-border-subtle px-3 py-1">
          검색
        </button>
        {data && (
          <span className="text-ink-muted">{data.total.toLocaleString()} 건</span>
        )}
      </form>
      {error && <p className="text-sm text-danger">{error}</p>}

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-subtle text-left">
            <th className="py-2">가입</th>
            <th>이메일</th>
            <th>역할</th>
            <th>표시명</th>
            <th>결제 상태</th>
            <th>ID</th>
            <th className="text-right">액션</th>
          </tr>
        </thead>
        <tbody>
          {data?.items.map((r) => (
            <tr key={r.id} className="border-b border-border-subtle">
              <td className="py-2 font-mono text-xs">
                {new Date(r.created_at).toISOString().slice(0, 10)}
              </td>
              <td className="py-2">{r.email}</td>
              <td className="py-2">{r.role}</td>
              <td className="py-2">{r.display_name ?? "-"}</td>
              <td className="py-2">{r.billing_status ?? "-"}</td>
              <td className="py-2 font-mono text-xs">{r.id.slice(0, 8)}…</td>
              <td className="py-2 text-right">
                <button
                  onClick={() => setCreditTarget(r)}
                  className="rounded border border-border-subtle px-2 py-1 text-xs hover:bg-elev"
                >
                  시간 지급
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {creditTarget && (
        <CreditGrantModal
          target={creditTarget}
          onClose={() => setCreditTarget(null)}
        />
      )}

      <div className="flex items-center justify-between">
        <button
          disabled={page === 0}
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          className="rounded border border-border-subtle px-3 py-1 text-sm disabled:opacity-50"
        >
          이전
        </button>
        <span className="text-sm text-ink-muted">페이지 {page + 1}</span>
        <button
          disabled={!data || (page + 1) * 50 >= data.total}
          onClick={() => setPage((p) => p + 1)}
          className="rounded border border-border-subtle px-3 py-1 text-sm disabled:opacity-50"
        >
          다음
        </button>
      </div>
    </div>
  );
}

function CreditGrantModal({
  target,
  onClose,
}: {
  target: Row;
  onClose: () => void;
}) {
  const [minutes, setMinutes] = useState<number>(10);
  const [reason, setReason] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!reason.trim() || minutes <= 0) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/admin/credit/grant", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          user_id: target.id,
          grant_seconds: Math.round(minutes * 60),
          reason: reason.trim(),
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error?.message ?? "실패");
      setResult(
        `${(j.actually_granted_seconds / 60).toFixed(1)}분 지급됨 ` +
          `(이전 ${(j.prev_seconds_used / 60).toFixed(1)}분 → 현재 ${(
            j.next_seconds_used / 60
          ).toFixed(1)}분)`,
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : "unknown");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md rounded-2xl bg-surface p-6 shadow-xl">
        <h2 className="text-lg font-semibold">사용 시간 지급</h2>
        <p className="mt-1 text-xs text-ink-muted">
          대상: <span className="font-mono">{target.email}</span>
        </p>
        <p className="mt-3 text-xs text-ink-secondary">
          이번 달 사용량(usage_monthly.seconds_used)에서 아래 만큼 빼줍니다
          (0 미만으로는 내려가지 않음). 모든 내역은 audit_log 에 기록됩니다.
        </p>

        <div className="mt-4 space-y-3 text-sm">
          <label className="block">
            <span className="text-ink-secondary">지급 시간 (분)</span>
            <input
              type="number"
              min={1}
              max={43200}
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value) || 0)}
              disabled={busy || !!result}
              className="mt-1 w-full rounded border border-border-subtle bg-surface px-2 py-1"
            />
          </label>
          <label className="block">
            <span className="text-ink-secondary">사유 (필수)</span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={busy || !!result}
              placeholder="예: 2026-04-22 장애 보상"
              className="mt-1 w-full rounded border border-border-subtle bg-surface px-2 py-1"
            />
          </label>
        </div>

        {result && <p className="mt-3 text-sm text-success">{result}</p>}
        {err && <p className="mt-3 text-sm text-danger">{err}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded border border-border-subtle px-3 py-1.5 text-sm"
          >
            {result ? "닫기" : "취소"}
          </button>
          {!result && (
            <button
              onClick={submit}
              disabled={busy || !reason.trim() || minutes <= 0}
              className="rounded bg-primary px-3 py-1.5 text-sm text-primary-fg disabled:opacity-50"
            >
              {busy ? "지급 중…" : "지급"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
