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
            </tr>
          ))}
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
