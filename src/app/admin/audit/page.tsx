"use client";

import { useEffect, useState } from "react";

interface Row {
  id: string;
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}
interface Resp {
  items: Row[];
  total: number;
  page: number;
  size: number;
}

const ACTIONS = [
  "",
  "refund",
  "role_change",
  "session_terminate",
  "abuse_flag",
  "data_delete",
  "quota_override",
  "other",
];

export default function AuditPage() {
  const [data, setData] = useState<Resp | null>(null);
  const [page, setPage] = useState(0);
  const [action, setAction] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const qs = new URLSearchParams({ page: String(page), size: "50" });
    if (action) qs.set("action", action);
    const res = await fetch(`/api/admin/audit?${qs.toString()}`, {
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
  }, [page, action]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="container py-10 space-y-5">
      <h1 className="text-2xl font-semibold">감사 로그</h1>
      <div className="flex items-center gap-3 text-sm">
        <label>
          액션:
          <select
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setPage(0);
            }}
            className="ml-2 rounded border border-border-subtle bg-surface px-2 py-1"
          >
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a || "전체"}
              </option>
            ))}
          </select>
        </label>
        {data && (
          <span className="text-ink-muted">
            {data.total.toLocaleString()} 건
          </span>
        )}
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-subtle text-left">
            <th className="py-2">시각</th>
            <th>행위자</th>
            <th>액션</th>
            <th>대상</th>
            <th>페이로드</th>
          </tr>
        </thead>
        <tbody>
          {data?.items.map((r) => (
            <tr key={r.id} className="border-b border-border-subtle align-top">
              <td className="py-2 font-mono text-xs">
                {new Date(r.created_at).toISOString().replace("T", " ").slice(0, 19)}
              </td>
              <td className="py-2 font-mono text-xs">
                {r.actor_id ? r.actor_id.slice(0, 8) + "…" : "system"}
              </td>
              <td className="py-2">{r.action}</td>
              <td className="py-2">
                {r.target_type}:
                <span className="font-mono text-xs ml-1">
                  {r.target_id ? r.target_id.slice(0, 8) + "…" : "-"}
                </span>
              </td>
              <td className="py-2 max-w-[320px]">
                <code className="block truncate text-[11px] text-ink-muted">
                  {JSON.stringify(r.payload)}
                </code>
              </td>
            </tr>
          ))}
          {data?.items.length === 0 && (
            <tr>
              <td colSpan={5} className="py-6 text-center text-ink-muted">
                로그 없음
              </td>
            </tr>
          )}
        </tbody>
      </table>

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
