"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { useNetworkPreflight } from "@/hooks/useNetworkPreflight";
import { Button } from "@/components/ui/button";

interface Props {
  onReady: () => void;
  onMicPermissionChange?: (ok: boolean) => void;
}

type Step = "mic" | "network" | "gateway";

export function PreflightCheck({ onReady, onMicPermissionChange }: Props) {
  const [mic, setMic] = useState<"unknown" | "ok" | "denied">("unknown");
  const network = useNetworkPreflight();
  const ready = mic === "ok" && (network.level === "good" || network.level === "fair");

  async function requestMic() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000,
          channelCount: 1,
        },
      });
      // 권한 확인 후 즉시 닫기. 실제 캡처는 useMicrophone 에서.
      stream.getTracks().forEach((t) => t.stop());
      setMic("ok");
      onMicPermissionChange?.(true);
    } catch {
      setMic("denied");
      onMicPermissionChange?.(false);
    }
  }

  useEffect(() => {
    requestMic();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="rounded-2xl border border-border-subtle bg-surface p-6">
      <h2 className="text-lg font-semibold">준비 점검</h2>
      <p className="mt-1 text-sm text-ink-secondary">
        세션 시작 전, 마이크와 네트워크를 확인합니다.
      </p>
      <ul className="mt-5 space-y-3">
        <Row
          name="mic"
          label="마이크 권한"
          status={mic === "ok" ? "ok" : mic === "denied" ? "fail" : "loading"}
          hint={mic === "denied" ? "브라우저 주소창 자물쇠 → 권한 → 허용" : undefined}
        />
        <Row
          name="network"
          label={`네트워크 품질${network.rttMs ? ` · ${network.rttMs}ms` : ""}`}
          status={
            network.level === "good"
              ? "ok"
              : network.level === "fair"
              ? "warn"
              : network.level === "unknown"
              ? "loading"
              : "fail"
          }
          hint={
            network.level === "poor"
              ? "Wi-Fi 또는 더 빠른 회선을 권장합니다."
              : undefined
          }
        />
      </ul>
      <div className="mt-6 flex items-center justify-end gap-2">
        {mic === "denied" && (
          <Button variant="secondary" onClick={requestMic}>
            다시 확인
          </Button>
        )}
        <Button disabled={!ready} onClick={onReady}>
          세션 시작
        </Button>
      </div>
    </div>
  );
}

function Row({
  name,
  label,
  status,
  hint,
}: {
  name: Step;
  label: string;
  status: "loading" | "ok" | "warn" | "fail";
  hint?: string;
}) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5">
        {status === "ok" && <CheckCircle2 className="h-5 w-5 text-success" />}
        {status === "warn" && <CheckCircle2 className="h-5 w-5 text-warning" />}
        {status === "fail" && <XCircle className="h-5 w-5 text-danger" />}
        {status === "loading" && (
          <Loader2 className="h-5 w-5 text-ink-muted animate-spin" />
        )}
      </span>
      <div>
        <p className="text-sm text-ink-primary">{label}</p>
        {hint && <p className="text-xs text-ink-muted mt-0.5">{hint}</p>}
      </div>
    </li>
  );
}
