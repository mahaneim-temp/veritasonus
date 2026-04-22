/**
 * Gemini (Google AI Studio) HTTP 래퍼.
 *
 * 용도:
 *   - Assist 모드 1회성 텍스트 생성 (runAssist)
 *   - 사후 복원 4축 JSON 생성 (callGeminiChat — OpenAI 의 callOpenAIChat 과 같은 시그니처)
 *
 * 인증: API key 1개. Google AI Studio (https://aistudio.google.com/apikey) 에서 발급.
 */

import { ENV } from "../env.js";
import type { OpenAIArgs, OpenAIResponse } from "../reconstruct.js";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

const ASSIST_SYSTEM = `당신은 동시 통역 보조 AI 입니다. 출력은 한 줄만, 불필요한 수식어 없이.`;

function assistPromptFor(intent: string, priorText?: string): string {
  switch (intent) {
    case "speak_self":
      return `사용자가 이제 직접 말하려 한다. 다음에 이어서 자연스럽게 한 문장만 제안해라. 참고 문맥:
${priorText ?? "(없음)"}`;
    case "listen_only":
      return `사용자는 듣고만 있다. 직전 발화의 핵심 의도/감정/뉘앙스를 한 문장으로 요약해라.
${priorText ?? ""}`;
    default:
      return `통역 어시스트. 두 줄:
SAY: (사용자가 이어서 말할 만한 한 문장)
INTENT: (직전 화자의 의도 한 줄)
${priorText ?? ""}`;
  }
}

interface GeminiGenerateRequest {
  contents: Array<{
    role: "user";
    parts: Array<{ text: string }>;
  }>;
  systemInstruction?: { parts: Array<{ text: string }> };
  generationConfig?: Record<string, unknown>;
}

interface GeminiGenerateResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  error?: { message?: string; code?: number };
}

async function geminiGenerate(
  model: string,
  body: GeminiGenerateRequest,
): Promise<{ ok: true; text: string } | { ok: false; message: string; status: number }> {
  const key = ENV.GOOGLE_AI_API_KEY;
  if (!key) return { ok: false, message: "missing_google_ai_api_key", status: 0 };
  const url = `${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await resp.json()) as GeminiGenerateResponse;
    if (!resp.ok) {
      return {
        ok: false,
        message: json.error?.message ?? `http_${resp.status}`,
        status: resp.status,
      };
    }
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    return { ok: true, text };
  } catch (e) {
    return { ok: false, message: `network: ${String(e)}`, status: 0 };
  }
}

/** Assist 텍스트 생성. 한 문장 수준이라 Flash 가 적합. */
export async function runAssist(
  intent: string,
  priorText?: string,
): Promise<string> {
  const r = await geminiGenerate("gemini-1.5-flash", {
    systemInstruction: { parts: [{ text: ASSIST_SYSTEM }] },
    contents: [
      { role: "user", parts: [{ text: assistPromptFor(intent, priorText) }] },
    ],
    generationConfig: { temperature: 0.3, maxOutputTokens: 120 },
  });
  if (!r.ok) throw new Error(r.message);
  return r.text.trim();
}

/**
 * reconstruct.ts 의 callOpenAIChat 과 같은 시그니처로 호출 가능.
 * JSON 출력은 `response_mime_type: application/json` 으로 유도 + 서버 Zod 검증에 의존.
 */
export async function callGeminiChat(
  args: OpenAIArgs,
): Promise<OpenAIResponse> {
  // 모델 매핑: gpt-4o-mini → flash, gpt-4o → pro
  const model =
    args.model.includes("4o-mini") || args.model.includes("flash")
      ? "gemini-1.5-flash"
      : "gemini-1.5-pro";
  const r = await geminiGenerate(model, {
    systemInstruction: { parts: [{ text: args.systemPrompt }] },
    contents: [{ role: "user", parts: [{ text: args.userPrompt }] }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
    },
  });
  if (!r.ok) {
    return {
      ok: false,
      status: r.status,
      content: null,
      errorMessage: r.message,
    };
  }
  return { ok: true, status: 200, content: r.text };
}
