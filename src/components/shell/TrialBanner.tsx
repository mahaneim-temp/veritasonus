"use client";

import Link from "next/link";
import { useGuestTrial } from "@/hooks/useGuestTrial";
import { formatDurationSec } from "@/lib/utils/time";

/**
 * 게스트 트라이얼 배너. 쿠키에 guest_id 가 있을 때만 표시.
 * 2분 이하 남으면 경고 톤.
 */
export function TrialBanner() {
  const trial = useGuestTrial();
  if (!trial) return null;

  const warn = trial.remaining_s <= 120;
  const expired = trial.remaining_s <= 0;

  return (
    <div
      className={[
        "w-full border-b text-center text-xs py-1.5 px-4",
        expired
          ? "bg-danger text-white border-danger"
          : warn
          ? "bg-warning/15 text-warning border-warning/30"
          : "bg-primary/10 text-primary border-primary/20",
      ].join(" ")}
    >
      {expired ? (
        <span>
          체험 시간이 모두 소진되었습니다 ·{" "}
          <Link href="/signup" className="underline font-medium">
            회원가입하고 계속
          </Link>
        </span>
      ) : (
        <span>
          게스트 체험 남은 시간 {formatDurationSec(trial.remaining_s)} ·{" "}
          <Link href="/signup" className="underline font-medium">
            회원가입하면 제한 해제
          </Link>
        </span>
      )}
    </div>
  );
}
