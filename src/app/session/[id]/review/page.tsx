"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Download, Mail, Copy, Sparkles } from "lucide-react";
import type { UtteranceRow, ReconstructionRow } from "@/types/session";

export default function ReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [tab, setTab] = useState<"summary" | "transcript" | "reconstruction" | "export">(
    "summary",
  );
  const [items, setItems] = useState<UtteranceRow[]>([]);
  const [recon, setRecon] = useState<ReconstructionRow | null>(null);
  const [summary, setSummary] = useState<{
    summary?: string;
    key_decisions?: string[];
    action_items?: unknown[];
    important_numbers?: unknown[];
  } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/sessions/${id}/transcript`, { credentials: "include" })
      .then((r) => r.json())
      .then((j) => setItems(j.items ?? []))
      .catch(() => {});
    fetch(`/api/sessions/${id}/summary`, { credentials: "include" })
      .then((r) => r.json())
      .then((j) => setSummary(j))
      .catch(() => {});
  }, [id]);

  async function requestReconstruct() {
    setBusy(true);
    try {
      const r = await fetch(`/api/sessions/${id}/reconstruct`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ include_recording: true }),
      });
      const j = await r.json();
      if (r.ok) {
        setRecon({
          id: j.reconstruction_id,
          session_id: id,
          status: "pending",
          reconstructed_text: null,
          summary: null,
          key_decisions: null,
          action_items: null,
          important_numbers: null,
          requested_at: new Date().toISOString(),
          completed_at: null,
          error_message: null,
          retry_count: 0,
        });
      }
    } finally {
      setBusy(false);
    }
  }

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
                  {summary?.summary ?? "요약이 아직 생성되지 않았습니다."}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>주요 결정 · 액션 아이템</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {summary?.key_decisions?.length ? (
                  <ul className="list-disc pl-5 space-y-1">
                    {summary.key_decisions.map((d, i) => (
                      <li key={i}>{d}</li>
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
              {!recon ? (
                <>
                  <p className="text-sm text-ink-secondary">
                    실시간 결과와 녹음·업로드 자료를 종합해 더 정확한 최종본을 생성합니다.
                  </p>
                  <Button onClick={requestReconstruct} disabled={busy}>
                    <Sparkles className="h-4 w-4" />
                    복원 요청
                  </Button>
                </>
              ) : (
                <p className="text-sm">
                  상태: <span className="font-medium">{recon.status}</span>
                </p>
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
