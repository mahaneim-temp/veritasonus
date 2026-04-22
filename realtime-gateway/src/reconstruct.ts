/**
 * 사후 복원 코어 (A-3).
 *
 * `runReconstruction(reconId, sessionId)` 가 단일 엔트리 포인트.
 * 워커(reconstruct-worker.ts) 가 이것을 호출하고, DB 에 결과를 반영한다.
 *
 * 책임:
 *   1) 세션 메타 + utterances 로드.
 *   2) prompts/reconstruct.ts 의 빌더로 system/user 메시지 생성.
 *   3) OpenAI Chat Completions (response_format: json_schema) 호출.
 *   4) Zod 로 이중 검증. 실패 시 1회 재시도.
 *   5) 성공 / 실패 결과를 구조화된 Result 로 반환.
 *
 * 이 파일은 Supabase 읽기 + OpenAI 호출을 한다. DB write 는 워커가 담당.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./db-types.js";
import { ENV } from "./env.js";
import {
  buildReconstructPrompt,
  RECONSTRUCT_JSON_SCHEMA,
  ReconstructResultSchema,
  type ReconstructResult,
  type SessionMeta,
  type UtteranceForPrompt,
} from "./prompts/reconstruct.js";

/** 발화 수 / 녹음 여부에 따른 모델 선택. */
export function pickReconstructModel(opts: {
  utteranceCount: number;
  recordingEnabled: boolean;
}): string {
  const escalate = opts.recordingEnabled || opts.utteranceCount > 300;
  return escalate ? "gpt-4o" : "gpt-4o-mini";
}

export type RunOutcome =
  | { kind: "ok"; result: ReconstructResult; model: string }
  | {
      kind: "fail";
      code:
        | "no_utterances"
        | "session_not_found"
        | "openai_error"
        | "schema_parse_failed"
        | "network_error";
      message: string;
      model?: string;
    };

export interface RunDeps {
  sb: SupabaseClient<Database>;
  /** OpenAI Chat Completions 호출. 테스트에서 모킹 대상. */
  callOpenAI: (args: OpenAIArgs) => Promise<OpenAIResponse>;
  /** 관측용 로거 (pino child). */
  log: {
    info: (obj: object, msg: string) => void;
    warn: (obj: object, msg: string) => void;
    error: (obj: object, msg: string) => void;
  };
}

export interface OpenAIArgs {
  model: string;
  systemPrompt: string;
  userPrompt: string;
}

export interface OpenAIResponse {
  ok: boolean;
  status: number;
  /** 모델이 반환한 content (JSON 문자열). 실패 시 null. */
  content: string | null;
  /** 에러 메시지 (실패 시). */
  errorMessage?: string;
}

/** 세션 1건의 사후 복원을 수행. */
export async function runReconstruction(
  sessionId: string,
  deps: RunDeps,
): Promise<RunOutcome> {
  // 1. 세션 메타.
  const { data: session, error: sErr } = await deps.sb
    .from("sessions")
    .select("source_lang,target_lang,mode,started_at,ended_at,recording_enabled")
    .eq("id", sessionId)
    .maybeSingle();
  if (sErr || !session) {
    return {
      kind: "fail",
      code: "session_not_found",
      message: sErr ? String(sErr) : "세션을 찾을 수 없습니다.",
    };
  }

  // 2. utterances (seq 순).
  const { data: utterances, error: uErr } = await deps.sb
    .from("utterances")
    .select("seq,speaker_label,source_text,translated_text")
    .eq("session_id", sessionId)
    .order("seq", { ascending: true });
  if (uErr) {
    return {
      kind: "fail",
      code: "session_not_found",
      message: String(uErr),
    };
  }
  if (!utterances || utterances.length === 0) {
    return {
      kind: "fail",
      code: "no_utterances",
      message: "세션에 저장된 발화가 없습니다.",
    };
  }

  // 3. 프롬프트 빌드.
  const meta: SessionMeta = {
    source_lang: session.source_lang,
    target_lang: session.target_lang,
    mode: session.mode,
    started_at: session.started_at,
    ended_at: session.ended_at,
  };
  const built = buildReconstructPrompt(
    meta,
    utterances as UtteranceForPrompt[],
  );
  const model = pickReconstructModel({
    utteranceCount: utterances.length,
    recordingEnabled: session.recording_enabled,
  });
  deps.log.info(
    {
      session: sessionId,
      model,
      utterances: utterances.length,
      included: built.includedCount,
      truncated: built.truncated,
    },
    "reconstruct_calling_model",
  );

  // 4. OpenAI 호출 (최대 2회 = 초기 + 재시도 1).
  let lastErr: string = "";
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const resp = await deps.callOpenAI({
      model,
      systemPrompt: built.systemPrompt,
      userPrompt: built.userPrompt,
    });
    if (!resp.ok) {
      lastErr = resp.errorMessage ?? `http_${resp.status}`;
      deps.log.warn(
        { session: sessionId, attempt, status: resp.status, err: lastErr },
        "reconstruct_openai_failed",
      );
      continue;
    }
    if (!resp.content) {
      lastErr = "empty_content";
      continue;
    }
    // 5. JSON parse + Zod.
    const parsed = tryParseResult(resp.content);
    if (parsed.kind === "ok") {
      return { kind: "ok", result: parsed.value, model };
    }
    lastErr = parsed.reason;
    deps.log.warn(
      { session: sessionId, attempt, err: lastErr },
      "reconstruct_schema_failed",
    );
  }

  // 모든 재시도 실패.
  return {
    kind: "fail",
    code: lastErr.startsWith("schema") ? "schema_parse_failed" : "openai_error",
    message: lastErr,
    model,
  };
}

function tryParseResult(
  content: string,
): { kind: "ok"; value: ReconstructResult } | { kind: "err"; reason: string } {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch (e) {
    return { kind: "err", reason: `schema_json_parse: ${String(e)}` };
  }
  const result = ReconstructResultSchema.safeParse(json);
  if (!result.success) {
    return {
      kind: "err",
      reason: `schema_zod: ${result.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".")}:${i.message}`)
        .join("; ")}`,
    };
  }
  return { kind: "ok", value: result.data };
}

// ── 실제 OpenAI 호출 어댑터 (기본 구현) ───────────────────
/**
 * production default. 테스트에서는 deps.callOpenAI 를 직접 모킹해 이 함수를 bypass 한다.
 */
export async function callOpenAIChat(
  args: OpenAIArgs,
): Promise<OpenAIResponse> {
  const url = "https://api.openai.com/v1/chat/completions";
  const body = {
    model: args.model,
    messages: [
      { role: "system", content: args.systemPrompt },
      { role: "user", content: args.userPrompt },
    ],
    response_format: {
      type: "json_schema",
      json_schema: RECONSTRUCT_JSON_SCHEMA,
    },
    temperature: 0.2,
  };
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ENV.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      return {
        ok: false,
        status: resp.status,
        content: null,
        errorMessage: `http_${resp.status}: ${text.slice(0, 500)}`,
      };
    }
    const json = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content ?? null;
    return { ok: true, status: 200, content };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      content: null,
      errorMessage: `network: ${String(e)}`,
    };
  }
}
