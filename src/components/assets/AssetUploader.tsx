"use client";

import { useRef, useState } from "react";
import { Upload, FileText, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AssetType } from "@/types/session";

const MAX_ASSET_MB = Number(process.env.NEXT_PUBLIC_MAX_ASSET_SIZE_MB ?? 20);
const MAX_SESSION_MB = Number(
  process.env.NEXT_PUBLIC_MAX_ASSETS_PER_SESSION_MB ?? 50,
);
const MAX_BYTES = MAX_ASSET_MB * 1024 * 1024;

interface UploadedAsset {
  id: string;
  filename: string;
  status: "uploading" | "pending" | "done" | "failed";
  asset_type: AssetType;
}

export function AssetUploader({ sessionId }: { sessionId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [assetType, setAssetType] = useState<AssetType>("script");
  const [items, setItems] = useState<UploadedAsset[]>([]);

  async function handleFiles(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) {
      if (file.size > MAX_BYTES) {
        setItems((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            filename: file.name,
            status: "failed",
            asset_type: assetType,
          },
        ]);
        continue;
      }
      const localId = crypto.randomUUID();
      setItems((prev) => [
        ...prev,
        { id: localId, filename: file.name, status: "uploading", asset_type: assetType },
      ]);

      const fd = new FormData();
      fd.append("file", file);
      fd.append("asset_type", assetType);
      try {
        const res = await fetch(`/api/sessions/${sessionId}/assets`, {
          method: "POST",
          body: fd,
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error?.message ?? "upload_failed");
        setItems((prev) =>
          prev.map((it) =>
            it.id === localId
              ? { ...it, id: json.asset_id, status: "pending" }
              : it,
          ),
        );
      } catch {
        setItems((prev) =>
          prev.map((it) =>
            it.id === localId ? { ...it, status: "failed" } : it,
          ),
        );
      }
    }
  }

  return (
    <div className="rounded-2xl border border-border-subtle bg-surface p-5">
      {/* 타이틀 + 한 줄 설명 */}
      <div>
        <h3 className="font-medium">원고 · 자료</h3>
        <p className="mt-1 text-xs text-ink-secondary">
          업로드한 자료의 용어·고유명사가 통역에 반영됩니다.
        </p>
      </div>

      {/* 제약 요약 — 한 줄, 작은 글씨로 정돈 */}
      <p className="mt-2 text-[11px] text-ink-muted">
        PDF · DOCX · PPTX · TXT · MD
        <span className="mx-1.5">·</span>
        파일당 {MAX_ASSET_MB}MB
        <span className="mx-1.5">·</span>
        세션당 {MAX_SESSION_MB}MB
      </p>

      {/* 컨트롤 한 줄: 유형 셀렉트 + 업로드 버튼.
          좁은 사이드바(320px)에서도 줄바꿈 자연스럽게. */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Select value={assetType} onValueChange={(v) => setAssetType(v as AssetType)}>
          <SelectTrigger className="h-9 flex-1 min-w-[120px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="script">원고</SelectItem>
            <SelectItem value="slides">슬라이드</SelectItem>
            <SelectItem value="glossary">용어집</SelectItem>
            <SelectItem value="sermon_note">설교 노트</SelectItem>
            <SelectItem value="speaker_profile">화자 프로필</SelectItem>
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="h-4 w-4" /> 업로드
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.docx,.pptx,.txt,.md"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {items.length > 0 && (
        <ul className="mt-4 space-y-1.5 text-sm">
          {items.map((it) => (
            <li key={it.id} className="flex items-center gap-2 min-w-0">
              {it.status === "uploading" && (
                <Loader2 className="h-4 w-4 shrink-0 text-ink-muted animate-spin" />
              )}
              {it.status === "pending" && (
                <FileText className="h-4 w-4 shrink-0 text-primary" />
              )}
              {it.status === "done" && (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
              )}
              {it.status === "failed" && (
                <XCircle className="h-4 w-4 shrink-0 text-danger" />
              )}
              <span className="truncate flex-1 min-w-0">{it.filename}</span>
              <span className="shrink-0 text-xs text-ink-muted">
                {it.status === "pending"
                  ? "파싱 중"
                  : it.status === "done"
                  ? "적용됨"
                  : it.status === "failed"
                  ? "실패"
                  : "업로드 중"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
