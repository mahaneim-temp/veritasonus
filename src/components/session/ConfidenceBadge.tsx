import { Badge } from "@/components/ui/badge";
import type { ConfidenceLevel } from "@/types/session";

const LABEL: Record<ConfidenceLevel, string> = {
  high: "높음",
  medium: "보통",
  low: "낮음",
};

export function ConfidenceBadge({ level }: { level: ConfidenceLevel }) {
  const tone =
    level === "high" ? "success" : level === "medium" ? "warning" : "danger";
  return (
    <Badge tone={tone} dot>
      신뢰도 {LABEL[level]}
    </Badge>
  );
}
