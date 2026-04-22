"use client";

import { useEffect, useState } from "react";

interface Trial {
  guest_id: string;
  remaining_s: number;
  expires_at: string;
}

/**
 * 쿠키 lucid_guest_id 가 존재하면 서버에서 잔여 시간을 가져와 1초 단위로 로컬 카운트다운한다.
 * 30초마다 서버와 재동기화하여 drift 방지.
 */
export function useGuestTrial(): Trial | null {
  const [trial, setTrial] = useState<Trial | null>(null);

  useEffect(() => {
    let alive = true;
    let ticker: ReturnType<typeof setInterval> | null = null;

    async function fetchTrial() {
      try {
        const res = await fetch("/api/auth/guest/me", {
          credentials: "include",
        });
        if (!res.ok) return;
        const json = (await res.json()) as Trial;
        if (!alive) return;
        setTrial(json);
      } catch {
        // silent
      }
    }

    fetchTrial();
    const resync = setInterval(fetchTrial, 30_000);

    ticker = setInterval(() => {
      setTrial((prev) =>
        prev ? { ...prev, remaining_s: Math.max(0, prev.remaining_s - 1) } : prev,
      );
    }, 1000);

    return () => {
      alive = false;
      clearInterval(resync);
      if (ticker) clearInterval(ticker);
    };
  }, []);

  return trial;
}
