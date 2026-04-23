/**
 * /trial/live — 1분 맛보기 세션 UI.
 * 자료 업로드, 녹음, 사후복원 전부 비활성. 1분 타이머.
 * 종료 후 회원가입 유도 모달.
 */
"use client";

import { Suspense, useEffect, useRef, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Mic, MicOff, Clock, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

const TOTAL_SECONDS = 60;

type Phase = "idle" | "live" | "ended";

function TrialLiveInner() {
  const router = useRouter();
  const params = useSearchParams();
  const sessionId = params.get("sid");
  const sourceLang = params.get("src") ?? "ko";
  const targetLang = params.get("tgt") ?? "en";

  const [phase, setPhase] = useState<Phase>("idle");
  const [remaining, setRemaining] = useState(TOTAL_SECONDS);
  const [micOn, setMicOn] = useState(false);
  const [transcript, setTranscript] = useState<{ src: string; tgt: string }[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const endSession = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setMicOn(false);
    setPhase("ended");
  }, []);

  // 1분 타이머
  useEffect(() => {
    if (phase !== "live") return;
    timerRef.current = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          endSession();
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [phase, endSession]);

  async function connect() {
    if (!sessionId) {
      router.push("/trial" as never);
      return;
    }
    try {
      // JWT 발급
      const tr = await fetch("/api/realtime/token", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: sessionId }),
      });
      if (!tr.ok) {
        const j = await tr.json();
        throw new Error(j?.error?.message ?? "token_failed");
      }
      const { token, gateway_url } = await tr.json();
      const ws = new WebSocket(`${gateway_url}?token=${token}`);
      wsRef.current = ws;

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string);
          if (msg.type === "translation_final") {
            setTranscript((prev) => [
              ...prev.slice(-19), // 최근 20개만
              { src: msg.source_text ?? "", tgt: msg.translated_text ?? "" },
            ]);
          }
        } catch {
          // ignore
        }
      };

      ws.onerror = () => endSession();
      ws.onclose = (e) => {
        if (e.code === 4001) endSession(); // trial_expired
      };

      setPhase("live");
      setMicOn(true);
    } catch (e) {
      alert(e instanceof Error ? e.message : "연결 실패");
    }
  }

  function fmt(s: number) {
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }

  if (!sessionId) {
    return (
      <div className="container py-10">
        <p className="text-danger">세션 정보가 없습니다.</p>
        <Link href={"/trial" as never}><Button className="mt-4">맛보기 다시 시작</Button></Link>
      </div>
    );
  }

  return (
    <div className="container max-w-2xl py-8 space-y-6">
      {/* 맛보기 안내 배너 */}
      <div className="flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/5 px-4 py-2.5 text-sm text-warning">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>1분 맛보기 체험 · 기록이 저장되지 않습니다</span>
      </div>

      {/* 타이머 + 상태 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className={`h-5 w-5 ${remaining <= 10 ? "text-danger" : "text-ink-muted"}`} />
          <span className={`text-2xl font-mono font-semibold tabular-nums ${remaining <= 10 ? "text-danger" : "text-ink-primary"}`}>
            {fmt(remaining)}
          </span>
        </div>
        <div className="text-sm text-ink-muted">
          {sourceLang.toUpperCase()} → {targetLang.toUpperCase()}
        </div>
      </div>

      {/* 통역 결과 */}
      <div className="min-h-48 rounded-2xl border border-border-subtle bg-surface p-4 space-y-3 overflow-y-auto max-h-72">
        {transcript.length === 0 ? (
          <p className="text-sm text-ink-muted text-center mt-8">
            {phase === "live" ? "발화를 기다리는 중…" : "시작 버튼을 눌러 체험을 시작하세요."}
          </p>
        ) : (
          transcript.map((t, i) => (
            <div key={i} className="space-y-0.5">
              <p className="text-xs text-ink-muted">{t.src}</p>
              <p className="text-sm text-ink-primary font-medium">{t.tgt}</p>
            </div>
          ))
        )}
      </div>

      {/* 컨트롤 */}
      {phase === "idle" && (
        <Button size="lg" className="w-full" onClick={connect}>
          <Mic className="h-5 w-5" />
          체험 시작
        </Button>
      )}
      {phase === "live" && (
        <div className="flex gap-3">
          <Button
            variant={micOn ? "primary" : "secondary"}
            size="lg"
            className="flex-1"
            onClick={() => setMicOn((v) => !v)}
          >
            {micOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
            {micOn ? "마이크 켜짐" : "마이크 꺼짐"}
          </Button>
          <Button variant="secondary" size="lg" onClick={endSession}>
            종료
          </Button>
        </div>
      )}

      {/* 종료 후 회원가입 유도 모달 */}
      {phase === "ended" && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-2xl bg-surface p-8 shadow-2xl space-y-4">
            <h2 className="text-xl font-semibold text-ink-primary">
              맛보기 체험이 끝났습니다 🎉
            </h2>
            <p className="text-sm text-ink-secondary">
              실시간 AI 통역 품질이 어떠셨나요? 회원가입 후 매달 10분 무료로 이용하실 수 있으며,
              추가 충전으로 더 길게 사용 가능합니다.
            </p>
            <div className="flex flex-col gap-2 pt-2">
              <Link href={"/signup" as never}>
                <Button size="lg" className="w-full">
                  무료 회원가입 → 월 10분 무료
                </Button>
              </Link>
              <Link href={"/pricing" as never}>
                <Button size="lg" variant="secondary" className="w-full">
                  충전 요금 확인
                </Button>
              </Link>
              <Link href={"/trial" as never}>
                <Button size="lg" variant="ghost" className="w-full text-ink-muted">
                  다시 맛보기
                </Button>
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function TrialLivePage() {
  return (
    <Suspense fallback={<div className="container max-w-2xl py-8 text-ink-muted">로딩 중…</div>}>
      <TrialLiveInner />
    </Suspense>
  );
}
