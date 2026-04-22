"use client";

import { useNetworkPreflight } from "@/hooks/useNetworkPreflight";
import { Badge } from "@/components/ui/badge";

export function NetworkStatus() {
  const { level, rttMs } = useNetworkPreflight();
  const tone = level === "good" ? "success" : level === "fair" ? "warning" : "danger";
  const label =
    level === "good"
      ? "네트워크 양호"
      : level === "fair"
      ? "네트워크 보통"
      : level === "poor"
      ? "네트워크 불안정"
      : "확인 중";
  return (
    <Badge tone={tone} dot>
      {label}
      {rttMs != null && ` · ${rttMs}ms`}
    </Badge>
  );
}
