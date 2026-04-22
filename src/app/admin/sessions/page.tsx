"use client";

import { useEffect, useState } from "react";

interface Row {
  id: string;
  owner_type: string;
  owner_id: string;
  mode: string;
  state: string;
  source_lang: string;
  target_lang: string;
  recording_enabled: boolean;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
}
interface Resp {
  items: Row[];
  total: number;
  page: number;
  size: number;
}

const STATES = [
  "",
  "idle",
  "preflight",
  "prepared",
  "live",
  "paused",
  "ended",
  "post_reconstructing",
  "completed",
];
const MODES = [
  "",
  "interactive_interpretation",
  "listener_live",
  "listener_live_recorded",
  "assist_interpretation",
];

export default function AdminSessionsPage() {
  const [data, setData] = useState<Resp | null>(null);
  const [page, setPage] = useState(0);
  const [state, setState] = useState("");
  const [mode, setMode] = useState("");
  const [selected, setSelected] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const qs = new URLSearchParams({ page: String(page), size: "50" });
    if (state) qs.set("state", state);
    if (mode) qs.set("mode", mode);
    const res = await fetch(`/api/admin/sessions?${qs.toString()}`, {
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
  }, [page, state, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="container py-10 space-y-5">
      <h1 className="text-2xl font-semibold">세션 목록</h1>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label>
          상태:
          <select
            value={state}
            onChange={(e) => {
              setState(e.target.value);
              setPage(0);
            }}
            className="ml-2 rounded border border-border-subtle bg-surface px-2 py-1"
          >
            {STATES.map((s) => (
              <option key={s} value={s}>
                {s || "전체"}
              </option>
            ))}
          </select>
        </label>
        <label>
          모드:
          <select
            value={mode}
            onChange={(e) => {
              setMode(e.target.value);
              setPage(0);
            }}
            className="ml-2 rounded border border-border-subtle bg-surface px-2 py-1"
          >
            {MODES.map((m) => (
              <option key={m} value={m}>
                {m || "전체"}
              </option>
            ))}
          </select>
        </label>
        {data && (
          <span className="text-ink-muted">{data.total.toLocaleString()} 건</span>
        )}
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-subtle text-left">
            <th className="py-2">생성</th>
            <th>ID</th>
            <th>모드</th>
            <th>상태</th>
            <th>언어</th>
            <th>녹음</th>
            <th>소유</th>
          </tr>
        </thead>
        <tbody>
          {data?.items.map((r) => (
            <tr
              key={r.id}
              className="cursor-pointer border-b border-border-subtle hover:bg-elev"
              onClick={() => setSelected(r)}
            >
              <td className="py-2 font-mono text-xs">
                {new Date(r.created_at).toISOString().slice(0, 19).replace("T", " ")}
              </td>
              <td className="py-2 font-mono text-xs">{r.id.slice(0, 8)}…</td>
              <td className="py-2">{r.mode}</td>
              <td className="py-2">{r.state}</td>
              <td className="py-2">
                {r.source_lang} → {r.target_lang}
              </td>
              <td className="py-2">{r.recording_enabled ? "O" : "-"}</td>
              <td className="py-2 font-mono text-xs">
                {r.owner_type}:{r.owner_id.slice(0, 6)}…
              </td>
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

      {selected && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/50"
          onClick={() => setSelected(null)}
        >
          <div
            className="w-full max-w-lg rounded-2xl bg-surface p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold">세션 상세</h2>
            <dl className="mt-3 grid grid-cols-2 gap-y-1.5 text-sm">
              <dt className="text-ink-muted">ID</dt>
              <dd className="font-mono text-xs">{selected.id}</dd>
              <dt className="text-ink-muted">소유자</dt>
              <dd className="font-mono text-xs">
                {selected.owner_type}:{selected.owner_id}
              </dd>
              <dt className="text-ink-muted">생성</dt>
              <dd>{selected.created_at}</dd>
              <dt className="text-ink-muted">시작 / 종료</dt>
              <dd>
                {selected.started_at ?? "-"} / {selected.ended_at ?? "-"}
              </dd>
              <dt className="text-ink-muted">모드</dt>
              <dd>{selected.mode}</dd>
              <dt className="text-ink-muted">상태</dt>
              <dd>{selected.state}</dd>
              <dt className="text-ink-muted">언어</dt>
              <dd>
                {selected.source_lang} → {selected.target_lang}
              </dd>
              <dt className="text-ink-muted">녹음</dt>
              <dd>{selected.recording_enabled ? "활성" : "비활성"}</dd>
            </dl>
            <div className="mt-5 flex justify-end">
              <button
                className="rounded border border-border-subtle px-3 py-1.5 text-sm"
                onClick={() => setSelected(null)}
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
