"use client";

import { useEffect, useState } from "react";

type Level = "unknown" | "good" | "fair" | "poor";

export function useNetworkPreflight() {
  const [rttMs, setRttMs] = useState<number | null>(null);
  const [level, setLevel] = useState<Level>("unknown");

  useEffect(() => {
    let cancelled = false;

    async function probe() {
      const started = performance.now();
      try {
        // 경량 ping 엔드포인트 — /api/ping 는 그냥 200 반환
        const res = await fetch("/api/ping", { cache: "no-store" });
        if (cancelled || !res.ok) return;
        const rtt = Math.round(performance.now() - started);
        setRttMs(rtt);
        setLevel(rtt <= 200 ? "good" : rtt <= 500 ? "fair" : "poor");
      } catch {
        if (!cancelled) setLevel("poor");
      }
    }

    probe();
    const id = setInterval(probe, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return { level, rttMs };
}
