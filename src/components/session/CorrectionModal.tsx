"use client";

/**
 * 통역 결과 수정 모달.
 *
 * UX:
 *   - 원문과 자동 번역을 함께 보여주고, 사용자가 번역을 고쳐 쓸 수 있게 한다.
 *   - 저장하면 utterances.corrected_text 로 들어가며 기존 translated_text 는 보존.
 *   - 실시간 subtitle = first-pass 번역, delayed correction = 여기서 저장되는 corrected_text.
 *     이중 레이어를 명시적으로 구분한다.
 *
 * 호출:
 *   - LiveTranscript 의 재확인 버튼 → page 레벨에서 열기
 *   - review 화면에서도 같은 컴포넌트 재사용 가능.
 */

import { useEffect, useState } from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import type { UtteranceRow } from "@/types/session";

interface Props {
  open: boolean;
  item: UtteranceRow | null;
  onClose: () => void;
  onSubmit: (
    seq: number,
    correctedText: string,
  ) => Promise<{ ok: true } | { ok: false; message: string }>;
}

export function CorrectionModal({ open, item, onClose, onSubmit }: Props) {
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // item 이 바뀔 때 초안 초기값을 현재 translated_text(또는 기존 corrected_text)로 셋업.
  useEffect(() => {
    if (!open || !item) return;
    setDraft(item.corrected_text ?? item.translated_text ?? "");
    setError(null);
  }, [open, item]);

  // ESC 로 닫기 — 저장 중이 아닐 때만.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, saving, onClose]);

  if (!open || !item) return null;

  async function handleSave() {
    if (!item) return;
    const body = draft.trim();
    if (!body) {
      setError("수정문을 입력해 주세요");
      return;
    }
    setSaving(true);
    setError(null);
    const result = await onSubmit(item.seq, body);
    setSaving(false);
    if (result.ok) {
      onClose();
    } else {
      setError(result.message);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="correction-modal-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-2xl border border-border-subtle bg-surface shadow-xl">
        <header className="flex items-center gap-2 border-b border-border-subtle px-5 py-3">
          <Sparkles className="h-4 w-4 text-primary" />
          <h2
            id="correction-modal-title"
            className="text-sm font-semibold text-ink-primary"
          >
            번역 수정
          </h2>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md p-1 text-ink-muted hover:bg-border-subtle disabled:opacity-40"
            aria-label="닫기"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-4 px-5 py-4">
          <section>
            <p className="text-[11px] uppercase tracking-wider text-ink-muted">
              원문
            </p>
            <p className="mt-1 text-sm text-ink-primary leading-relaxed">
              {item.source_text}
            </p>
          </section>

          <section>
            <p className="text-[11px] uppercase tracking-wider text-ink-muted">
              자동 번역
            </p>
            <p className="mt-1 text-sm text-ink-secondary leading-relaxed">
              {item.translated_text ?? "(번역 대기 중)"}
            </p>
          </section>

          <section>
            <label
              htmlFor="corrected-text"
              className="text-[11px] uppercase tracking-wider text-ink-muted"
            >
              수정 번역
            </label>
            <textarea
              id="corrected-text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={saving}
              rows={4}
              maxLength={4000}
              className="mt-1 w-full resize-y rounded-xl border border-border-subtle bg-canvas px-3 py-2 text-sm text-ink-primary focus:border-primary focus:outline-none disabled:opacity-60"
              placeholder="고쳐 쓸 번역을 입력하세요…"
              autoFocus
            />
            <div className="mt-1 flex items-center justify-between text-[11px] text-ink-muted">
              <span>
                저장하면 원본 번역은 보존되고 수정본이 별도로 표시됩니다.
              </span>
              <span className="tabular-nums">{draft.length} / 4000</span>
            </div>
          </section>

          {error && (
            <p className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
              {error}
            </p>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-border-subtle px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-xl px-3 py-1.5 text-sm text-ink-secondary hover:bg-border-subtle disabled:opacity-40"
          >
            취소
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || draft.trim().length === 0}
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-fg hover:bg-primary-hover disabled:opacity-40"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            저장
          </button>
        </footer>
      </div>
    </div>
  );
}
