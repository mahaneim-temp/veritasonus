/**
 * 업로드 자료의 extracted_text 를 Realtime API instructions 로 변환.
 * 토큰 상한 4000(대략 12k chars) 을 넘지 않도록 잘라낸다.
 */

import type { AssetType } from "@/types/session";

export interface Asset {
  asset_type: AssetType;
  extracted_text: string | null;
}

const HEADER_TEMPLATE = `당신은 중요한 통역 상황에서 작동합니다.
아래는 이 세션에 대한 사전 자료입니다. 자료에 등장하는 고유명사, 수치, 용어는 그대로 사용하세요.
낮은 신뢰도 구간에서는 명시적으로 clarification_needed 이벤트를 발송하세요.`;

const ASSET_MAX_CHARS = 3500; // 자료당 상한
const TOTAL_MAX_CHARS = 10000; // 전체 상한

export function buildInstructions(
  baseInstructions: string,
  assets: Asset[],
): string {
  const parts: string[] = [baseInstructions, "", HEADER_TEMPLATE];

  let remaining = TOTAL_MAX_CHARS;
  // glossary 우선, 그다음 script, 그다음 나머지
  const priority: AssetType[] = [
    "glossary",
    "script",
    "sermon_note",
    "slides",
    "speaker_profile",
  ];

  for (const type of priority) {
    const items = assets.filter(
      (a) => a.asset_type === type && a.extracted_text,
    );
    for (const item of items) {
      if (remaining <= 200) break;
      const text = (item.extracted_text ?? "").slice(0, ASSET_MAX_CHARS);
      if (text.length === 0) continue;
      parts.push("", `# ${labelOf(type)}`, text);
      remaining -= text.length + labelOf(type).length + 3;
    }
  }
  return parts.join("\n");
}

function labelOf(t: AssetType): string {
  switch (t) {
    case "glossary":
      return "용어집";
    case "script":
      return "원고";
    case "sermon_note":
      return "설교 노트";
    case "slides":
      return "슬라이드";
    case "speaker_profile":
      return "화자 프로필";
  }
}
