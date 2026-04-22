"use client";

import { useState } from "react";
import { Mic, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";

export type ListenerSource = "mic" | "tab_audio";

export function ListenerSourcePicker({
  value,
  onChange,
}: {
  value: ListenerSource;
  onChange: (v: ListenerSource) => void;
}) {
  const [error, setError] = useState<string | null>(null);

  async function testTab() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      const hasAudio = stream.getAudioTracks().length > 0;
      stream.getTracks().forEach((t) => t.stop());
      if (!hasAudio) {
        setError(
          "선택한 소스에 오디오가 없습니다. Chrome/Edge에서 '오디오 포함' 옵션을 선택하세요.",
        );
      } else {
        onChange("tab_audio");
      }
    } catch {
      setError("탭 오디오 권한이 거부되었습니다.");
    }
  }

  return (
    <div className="rounded-2xl border border-border-subtle bg-surface p-5">
      <h3 className="font-medium">음원 선택</h3>
      <p className="text-sm text-ink-secondary mt-1">
        현장 음성을 어떻게 받으실까요?
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <SourceTile
          active={value === "mic"}
          onClick={() => onChange("mic")}
          icon={<Mic className="h-4 w-4" />}
          title="마이크"
          hint="스마트폰/노트북 내장 마이크"
        />
        <SourceTile
          active={value === "tab_audio"}
          onClick={testTab}
          icon={<Monitor className="h-4 w-4" />}
          title="탭 오디오"
          hint="온라인 회의/영상의 시스템 오디오"
        />
      </div>
      {error && (
        <p className="mt-3 text-xs text-danger">{error}</p>
      )}
    </div>
  );
}

function SourceTile({
  active,
  onClick,
  icon,
  title,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "text-left rounded-xl border p-4 transition-colors",
        active
          ? "border-primary bg-primary/5"
          : "border-border-subtle hover:border-border-strong",
      ].join(" ")}
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        {icon}
        {title}
      </div>
      <p className="text-xs text-ink-muted mt-1">{hint}</p>
    </button>
  );
}
