import { describe, it, expect, vi } from "vitest";
import {
  buildReconstructPrompt,
  ReconstructResultSchema,
  RECONSTRUCT_SYSTEM_PROMPT,
  type SessionMeta,
  type UtteranceForPrompt,
} from "../realtime-gateway/src/prompts/reconstruct";
import {
  pickReconstructModel,
  runReconstruction,
  type OpenAIArgs,
  type OpenAIResponse,
  type RunDeps,
} from "../realtime-gateway/src/reconstruct";

const defaultMeta: SessionMeta = {
  source_lang: "ko",
  target_lang: "en",
  mode: "interactive_interpretation",
  started_at: "2026-04-22T10:00:00Z",
  ended_at: "2026-04-22T10:30:00Z",
};

function makeUtterance(
  seq: number,
  src: string,
  tr: string | null = null,
  speaker: string | null = "speaker",
): UtteranceForPrompt {
  return {
    seq,
    speaker_label: speaker,
    source_text: src,
    translated_text: tr,
  };
}

// ── 프롬프트 빌더 ────────────────────────────────────────────

describe("buildReconstructPrompt", () => {
  it("includes system prompt verbatim (한국어 톤 + 환각 금지)", () => {
    const r = buildReconstructPrompt(defaultMeta, [
      makeUtterance(1, "hello"),
    ]);
    expect(r.systemPrompt).toBe(RECONSTRUCT_SYSTEM_PROMPT);
    expect(r.systemPrompt).toContain("환각 금지");
    expect(r.systemPrompt).toContain("key_decisions");
    expect(r.systemPrompt).toContain("[미지정]");
  });

  it("includes session meta in user prompt", () => {
    const r = buildReconstructPrompt(defaultMeta, [
      makeUtterance(1, "hi", "안녕"),
    ]);
    expect(r.userPrompt).toContain("ko → en");
    expect(r.userPrompt).toContain("interactive_interpretation");
    expect(r.userPrompt).toContain("2026-04-22T10:00:00Z");
    expect(r.userPrompt).toContain("총 발화 수: 1");
  });

  it("formats utterance lines with source | translation", () => {
    const r = buildReconstructPrompt(defaultMeta, [
      makeUtterance(1, "안녕하세요", "Hello", "A"),
      makeUtterance(2, "How are you?", "잘 지내?", "B"),
    ]);
    expect(r.userPrompt).toContain("[A] 안녕하세요 | Hello");
    expect(r.userPrompt).toContain("[B] How are you? | 잘 지내?");
  });

  it("omits ' | ' when translation is missing", () => {
    const r = buildReconstructPrompt(defaultMeta, [
      makeUtterance(1, "source only", null),
    ]);
    expect(r.userPrompt).toContain("[speaker] source only");
    expect(r.userPrompt).not.toContain("source only |");
  });

  it("does not truncate when under budget", () => {
    const us = Array.from({ length: 10 }, (_, i) =>
      makeUtterance(i + 1, `line ${i + 1}`, `번역 ${i + 1}`),
    );
    const r = buildReconstructPrompt(defaultMeta, us, { maxChars: 10_000 });
    expect(r.truncated).toBe(false);
    expect(r.includedCount).toBe(10);
    expect(r.originalCount).toBe(10);
    expect(r.userPrompt).not.toContain("중간");
  });

  it("preserves head + tail when exceeding budget", () => {
    // 200개 발화, 각 ~50자 → 약 10,000자. maxChars=2,000 로 강제 clamp.
    const us = Array.from({ length: 200 }, (_, i) =>
      makeUtterance(i + 1, `original utterance number ${i + 1}`, "번역"),
    );
    const r = buildReconstructPrompt(defaultMeta, us, { maxChars: 2000 });
    expect(r.truncated).toBe(true);
    expect(r.originalCount).toBe(200);
    expect(r.includedCount).toBeLessThan(200);
    expect(r.userPrompt).toContain("중간");
    // 첫 번째와 마지막 발화는 유지되어야 한다.
    expect(r.userPrompt).toContain("original utterance number 1 |");
    expect(r.userPrompt).toContain("original utterance number 200 |");
  });

  it("reflects included count in meta line when truncated", () => {
    const us = Array.from({ length: 200 }, (_, i) =>
      makeUtterance(i + 1, "long utterance text here ".repeat(3), "번역"),
    );
    const r = buildReconstructPrompt(defaultMeta, us, { maxChars: 1500 });
    expect(r.truncated).toBe(true);
    expect(r.userPrompt).toMatch(/프롬프트에는 \d+개만 포함/);
  });
});

// ── 모델 선택 ────────────────────────────────────────────────

describe("pickReconstructModel", () => {
  it("defaults to gpt-4o-mini for small free sessions", () => {
    expect(
      pickReconstructModel({ utteranceCount: 50, recordingEnabled: false }),
    ).toBe("gpt-4o-mini");
  });

  it("escalates to gpt-4o when recording is enabled (premium hint)", () => {
    expect(
      pickReconstructModel({ utteranceCount: 20, recordingEnabled: true }),
    ).toBe("gpt-4o");
  });

  it("escalates to gpt-4o when utterance count exceeds 300", () => {
    expect(
      pickReconstructModel({ utteranceCount: 500, recordingEnabled: false }),
    ).toBe("gpt-4o");
  });

  it("does not escalate at exactly 300 utterances", () => {
    expect(
      pickReconstructModel({ utteranceCount: 300, recordingEnabled: false }),
    ).toBe("gpt-4o-mini");
  });
});

// ── Zod 스키마 ────────────────────────────────────────────────

describe("ReconstructResultSchema", () => {
  const valid = {
    summary: "회의에서 예산 문제를 논의했습니다.",
    key_decisions: ["매주 금요일 정기 회의"],
    action_items: ["[미지정] 예산 초안 작성"],
    important_numbers: [{ label: "예산", value: "3,000만원" }],
  };

  it("accepts valid output", () => {
    expect(ReconstructResultSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects empty summary", () => {
    expect(
      ReconstructResultSchema.safeParse({ ...valid, summary: "" }).success,
    ).toBe(false);
  });

  it("rejects array elements that are empty strings", () => {
    expect(
      ReconstructResultSchema.safeParse({
        ...valid,
        key_decisions: [""],
      }).success,
    ).toBe(false);
  });

  it("rejects important_numbers missing label", () => {
    expect(
      ReconstructResultSchema.safeParse({
        ...valid,
        important_numbers: [{ value: "3,000만원" }],
      }).success,
    ).toBe(false);
  });

  it("caps arrays at documented maximums", () => {
    const tooMany = Array.from({ length: 21 }, (_, i) => `item ${i}`);
    expect(
      ReconstructResultSchema.safeParse({ ...valid, key_decisions: tooMany })
        .success,
    ).toBe(false);
  });
});

// ── runReconstruction (모킹) ───────────────────────────────

function makeMockSb(opts: {
  session: {
    source_lang: string;
    target_lang: string;
    mode: string;
    started_at: string | null;
    ended_at: string | null;
    recording_enabled: boolean;
  } | null;
  utterances: UtteranceForPrompt[];
}) {
  return {
    from(table: string) {
      if (table === "sessions") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: opts.session, error: null }),
            }),
          }),
        };
      }
      if (table === "utterances") {
        return {
          select: () => ({
            eq: () => ({
              order: async () => ({ data: opts.utterances, error: null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
    // deps.sb 는 SupabaseClient 이지만 테스트에서는 최소 surface 만.
  } as unknown as RunDeps["sb"];
}

const silentLog: RunDeps["log"] = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe("runReconstruction", () => {
  const goodOutputJson = JSON.stringify({
    summary: "짧은 회의 요약입니다.",
    key_decisions: ["결정 1"],
    action_items: ["[미지정] 할 일 1"],
    important_numbers: [{ label: "예산", value: "500만원" }],
  });

  const session = {
    source_lang: "ko",
    target_lang: "en",
    mode: "interactive_interpretation",
    started_at: "2026-04-22T10:00:00Z",
    ended_at: "2026-04-22T10:30:00Z",
    recording_enabled: false,
  };

  it("returns ok on first-try valid response", async () => {
    const callOpenAI = vi.fn(
      async (_args: OpenAIArgs): Promise<OpenAIResponse> => ({
        ok: true,
        status: 200,
        content: goodOutputJson,
      }),
    );
    const outcome = await runReconstruction("sess-1", {
      sb: makeMockSb({
        session,
        utterances: [makeUtterance(1, "hi", "안녕")],
      }),
      callOpenAI,
      log: silentLog,
    });
    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") {
      expect(outcome.result.summary).toBe("짧은 회의 요약입니다.");
      expect(outcome.model).toBe("gpt-4o-mini");
    }
    expect(callOpenAI).toHaveBeenCalledTimes(1);
  });

  it("fails fast when session has no utterances", async () => {
    const callOpenAI = vi.fn();
    const outcome = await runReconstruction("sess-1", {
      sb: makeMockSb({ session, utterances: [] }),
      callOpenAI,
      log: silentLog,
    });
    expect(outcome.kind).toBe("fail");
    if (outcome.kind === "fail") expect(outcome.code).toBe("no_utterances");
    expect(callOpenAI).not.toHaveBeenCalled();
  });

  it("fails when session not found", async () => {
    const callOpenAI = vi.fn();
    const outcome = await runReconstruction("sess-missing", {
      sb: makeMockSb({ session: null, utterances: [] }),
      callOpenAI,
      log: silentLog,
    });
    expect(outcome.kind).toBe("fail");
    if (outcome.kind === "fail") expect(outcome.code).toBe("session_not_found");
  });

  it("retries once on malformed JSON then succeeds", async () => {
    const calls: string[] = [];
    const callOpenAI = vi.fn(
      async (_args: OpenAIArgs): Promise<OpenAIResponse> => {
        calls.push("call");
        if (calls.length === 1) {
          return { ok: true, status: 200, content: "{ not: valid json" };
        }
        return { ok: true, status: 200, content: goodOutputJson };
      },
    );
    const outcome = await runReconstruction("sess-1", {
      sb: makeMockSb({
        session,
        utterances: [makeUtterance(1, "hi", "안녕")],
      }),
      callOpenAI,
      log: silentLog,
    });
    expect(outcome.kind).toBe("ok");
    expect(callOpenAI).toHaveBeenCalledTimes(2);
  });

  it("gives up after 2 schema failures and returns schema_parse_failed", async () => {
    const callOpenAI = vi.fn(
      async (_args: OpenAIArgs): Promise<OpenAIResponse> => ({
        ok: true,
        status: 200,
        content: JSON.stringify({ summary: "" }), // fails Zod
      }),
    );
    const outcome = await runReconstruction("sess-1", {
      sb: makeMockSb({
        session,
        utterances: [makeUtterance(1, "hi", "안녕")],
      }),
      callOpenAI,
      log: silentLog,
    });
    expect(outcome.kind).toBe("fail");
    if (outcome.kind === "fail")
      expect(outcome.code).toBe("schema_parse_failed");
    expect(callOpenAI).toHaveBeenCalledTimes(2);
  });

  it("returns openai_error when API fails both tries", async () => {
    const callOpenAI = vi.fn(
      async (_args: OpenAIArgs): Promise<OpenAIResponse> => ({
        ok: false,
        status: 500,
        content: null,
        errorMessage: "http_500: server error",
      }),
    );
    const outcome = await runReconstruction("sess-1", {
      sb: makeMockSb({
        session,
        utterances: [makeUtterance(1, "hi", "안녕")],
      }),
      callOpenAI,
      log: silentLog,
    });
    expect(outcome.kind).toBe("fail");
    if (outcome.kind === "fail") expect(outcome.code).toBe("openai_error");
    expect(callOpenAI).toHaveBeenCalledTimes(2);
  });

  it("escalates to gpt-4o for recording-enabled session", async () => {
    const callOpenAI = vi.fn(
      async (args: OpenAIArgs): Promise<OpenAIResponse> => {
        expect(args.model).toBe("gpt-4o");
        return { ok: true, status: 200, content: goodOutputJson };
      },
    );
    const outcome = await runReconstruction("sess-1", {
      sb: makeMockSb({
        session: { ...session, recording_enabled: true },
        utterances: [makeUtterance(1, "hi", "안녕")],
      }),
      callOpenAI,
      log: silentLog,
    });
    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") expect(outcome.model).toBe("gpt-4o");
  });
});
