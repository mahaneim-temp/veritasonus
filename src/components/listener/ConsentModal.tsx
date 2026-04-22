"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * 리스너 모드 시작 전 표시하는 상대방 동의 확인 모달 (C-1 PIPA / 통신비밀보호법).
 *
 * 사용자가 "상대방의 동의를 받았다" 를 자기 확인하고 `consent_logs` 에 이력을
 * 기록해야 리스너 세션이 시작된다. 녹음 모드에서는 특히 중요.
 */
export function ListenerConsentModal(props: {
  open: boolean;
  recordingEnabled: boolean;
  onConfirm: () => Promise<void> | void;
  onCancel: () => void;
}) {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!props.open) return null;

  async function confirm() {
    setBusy(true);
    try {
      await props.onConfirm();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="listener-consent-title"
    >
      <div className="w-full max-w-md rounded-2xl bg-surface p-6 shadow-xl">
        <h2 id="listener-consent-title" className="text-lg font-semibold">
          상대방 동의 확인
        </h2>
        <p className="mt-2 text-sm text-ink-secondary">
          리스너 모드는 <strong>타인의 발화</strong>를 캡처·전사합니다.
          {props.recordingEnabled
            ? " 녹음 옵션이 켜져 있어 원본 오디오도 서버에 저장됩니다."
            : ""}
        </p>
        <p className="mt-3 text-sm text-ink-secondary">
          대한민국 <strong>통신비밀보호법</strong>은 대화 당사자 전원의 동의
          없이 대화를 녹음하는 행위를 금지합니다. 본 기능을 시작하기 전에 대화
          상대방(들)에게 명시적으로 동의를 받아야 합니다.
        </p>

        <label className="mt-4 flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
          />
          <span>
            대화 상대방에게 동의를 받았음을 확인합니다. 미동의 상태에서의
            사용으로 발생하는 법적 책임은 본인에게 있음을 이해했습니다. 자세한
            내용은{" "}
            <Link
              href="/legal/terms"
              target="_blank"
              className="underline"
            >
              이용약관 제6조
            </Link>{" "}
            참조.
          </span>
        </label>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={props.onCancel} disabled={busy}>
            취소
          </Button>
          <Button onClick={confirm} disabled={!checked || busy}>
            {busy ? "확인 중…" : "시작"}
          </Button>
        </div>
      </div>
    </div>
  );
}
