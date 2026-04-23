"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Download, Mail, Copy, Sparkles } from "lucide-react";
import type { UtteranceRow, ReconstructionRow } from "@/types/session";

export default function ReviewPage({
  params,
}: {
  params: { id: string };
}) {
  const { id } = params;
  const [tab, setTab] = useState<"summary" | "transcript" | "reconstruction" | "export">(
    "summary",
  );
  const [items, setItems] = useState<UtteranceRow[]>([]);
  const [recon, setRecon] = useState<Pick<
    ReconstructionRow,
    | "id"
    | "status"
    | "summary"
    | "key_decisions"
    | "action_items"
    | "important_numbers"
    | "completed_at"
  > | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** /summary 응답 1회 불러와 recon 상태 세팅. */
  async function fetchSummary() {
    try {
      const res = await fetch(`/api/sessions/${id}/summary`, {
        credentials: "include",
      });
      if (!res.ok) return;
      const j = (await res.json()) as {
        reconstruction: {
          id: string;
          status: string;
          summary: string | null;
          key_decisions: string[] | null;
          action_items: unknown[] | null;
          important_numbers: unknown[] | null;
          completed_at: string | null;
        } | null;
      };
      setRecon(
        j.reconstruction
          ? {
              id: j.reconstruction.id,
              status: j.reconstruction.status as ReconstructionRow["status"],
              summary: j.reconstruction.summary,
              key_decisions: j.reconstruction.key_decisions,
              action_items: j.reconstruction.action_items,
              important_numbers: j.reconstruction.important_numbers,
              completed_at: j.reconstruction.completed_at,
            }
          : null,
      );
    } catch {
      // 최초 로드 실패는 조용히 — 사용자가 새로고침하면 재시도.
    }
  }

  useEffect(() => {
    fetch(`/api/sessions/${id}/transcript`, { credentials: "include" })
      .then((r) => r.json())
      .then((j) => setItems(j.items ?? []))
      .catch(() => {});
    void fetchSummary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /**
   * 복원 요청 후 pending → done/failed 로 바뀔 때까지 3초마다 폴링.
   * 서버 워커가 10초 간격으로 돌므로 대부분 첫 1~2회 poll 안에 도착.
   * 실패/완료 시 폴링 종료.
   */
  useEffect(() => {
    if (recon?.status !== "pending") return;
    const iv = setInterval(() => {
      void fetchSummary();
    }, 3000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recon?.status, id]);

  async function requestReconstruct() {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/sessions/${id}/reconstruct`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ include_recording: true }),
      });
      const j = await r.json();
      if (r.ok) {
        // 새 pending 행이 잡히도록 바로 /summary 를 한 번 재조회.
        await fetchSummary();
      } else {
        setError(j?.error?.message ?? "복원 요청에 실패했어요");
      }
    } catch (e) {
      setError(`네트워크 오류: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const reconStatusLabel =
    recon?.status === "done"
      ? "완료"
      : recon?.status === "pending"
      ? "생성 중…"
      : recon?.status === "failed"
      ? "실패"
      : recon?.status ?? "대기";

  return (
    <div className="container max-w-5xl py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">세션 리뷰</h1>
        <Link href="/" className="text-sm text-ink-secondary hover:underline">
          홈으로
        </Link>
      </div>

      <div className="mt-6 flex gap-1 border-b border-border-subtle">
        {(
          [
            ["summary", "요약"],
            ["transcript", "전문"],
            ["reconstruction", "사후 복원"],
            ["export", "내보내기"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={[
              "px-4 py-2.5 text-sm border-b-2 -mb-px transition-colors",
              tab === k
                ? "border-primary text-primary font-medium"
                : "border-transparent text-ink-secondary hover:text-ink-primary",
            ].join(" ")}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {tab === "summary" && (
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>요약</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed text-ink-primary whitespace-pre-wrap">
                  {recon?.summary ?? "요약이 아직 생성되지 않았습니다. '사후 복원' 탭에서 생성할 수 있어요."}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>주요 결정 · 액션 아이템</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {recon?.key_decisions?.length ? (
                  <ul className="list-disc pl-5 space-y-1">
                    {recon.key_decisions.map((d, i) => (
                      <li key={i}>
                        {typeof d === "string" ? d : JSON.stringify(d)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-ink-muted">아직 항목 없음.</p>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {tab === "transcript" && (
          <div className="space-y-3">
            {items.map((it) => (
              <div
                key={it.seq}
                className="rounded-xl border border-border-subtle p-4 text-sm"
              >
                <div className="text-xs text-ink-muted mb-2">
                  {it.speaker_label ?? "화자"} · seq {it.seq}
                </div>
                <p>{it.source_text}</p>
                <p className="mt-1 text-ink-secondary">{it.translated_text}</p>
              </div>
            ))}
            {items.length === 0 && (
              <p className="text-ink-muted text-sm">발화 기록이 없습니다.</p>
            )}
          </div>
        )}

        {tab === "reconstruction" && (
          <Card>
            <CardHeader>
              <CardTitle>사후 복원</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-ink-secondary">
                실시간 결과와 녹음·업로드 자료를 종합해 더 정확한 최종본을 생성합니다.
                서버 워커가 약 10초 간격으로 처리하며, 완료되면 이 화면이 자동 갱신됩니다.
              </p>
              <div className="flex items-center gap-3">
                <Button
                  onClick={requestReconstruct}
                  disabled={busy || recon?.status === "pending"}
                >
                  <Sparkles className="h-4 w-4" />
                  {recon?.status === "done" ? "다시 복원" : "복원 요청"}
                </Button>
                {recon && (
                  <span className="text-sm text-ink-secondary">
                    상태:{" "}
                    <span className="font-medium text-ink-primary">
                      {reconStatusLabel}
                    </span>
                  </span>
                )}
              </div>
              {error && (
                <p className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
                  {error}
                </p>
              )}
              {recon?.status === "done" && recon.summary && (
                <div className="space-y-2 rounded-xl border border-border-subtle bg-canvas p-4 text-sm">
                  <p className="text-[11px] uppercase tracking-wider text-ink-muted">
                    복원 요약
                  </p>
                  <p className="leading-relaxed whitespace-pre-wrap text-ink-primary">
                    {recon.summary}
                  </p>
                  {recon.completed_at && (
                    <p className="text-[11px] text-ink-muted">
                      {new Date(recon.completed_at).toLocaleString("ko-KR")} 완료
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {tab === "export" && (
          <Card>
            <CardHeader>
              <CardTitle>내보내기</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button variant="secondary">
                <Download className="h-4 w-4" /> PDF
              </Button>
              <Button variant="secondary">
                <Mail className="h-4 w-4" /> 이메일로 보내기
              </Button>
              <Button variant="secondary">
                <Copy className="h-4 w-4" /> 복사
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
