/**
 * 환경 변수 fail-fast 점검.
 * dev에서 잘못된 키로 쥐도새도 모르게 작동하는 일을 막는다.
 * Provider 선택(openai|google) 에 따라 필수 키가 달라진다.
 */

import dotenv from "dotenv";
// `.env` 는 realtime-gateway/.env (tsx watch 의 cwd 기준). 운영은 flyctl secrets 로 주입.
dotenv.config();

type ProviderKey = "openai" | "google";
function normalizeProvider(raw: string | undefined): ProviderKey {
  return raw === "openai" ? "openai" : "google";
}

const realtimeProvider = normalizeProvider(process.env.REALTIME_PROVIDER);
const reconstructProvider = normalizeProvider(
  process.env.RECONSTRUCT_PROVIDER ?? process.env.REALTIME_PROVIDER,
);

const required: string[] = [
  "REALTIME_GATEWAY_SECRET",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
];
if (realtimeProvider === "openai") {
  required.push("OPENAI_API_KEY");
} else {
  // Google STT/Translate 용 인증. ADC(GOOGLE_APPLICATION_CREDENTIALS) 또는
  // GOOGLE_SERVICE_ACCOUNT_JSON 둘 중 하나는 반드시 있어야 함.
  if (
    !process.env.GOOGLE_APPLICATION_CREDENTIALS &&
    !process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  ) {
    required.push("GOOGLE_APPLICATION_CREDENTIALS");
  }
}
if (reconstructProvider === "openai" && realtimeProvider !== "openai") {
  required.push("OPENAI_API_KEY");
} else if (reconstructProvider === "google") {
  required.push("GOOGLE_AI_API_KEY");
}

const missing = required.filter((k) => !process.env[k]);
if (missing.length > 0) {
  // eslint-disable-next-line no-console
  console.error(
    JSON.stringify({
      lvl: "error",
      msg: "missing_env",
      keys: missing,
      realtime_provider: realtimeProvider,
      reconstruct_provider: reconstructProvider,
    }),
  );
  if (process.env.NODE_ENV === "production") {
    process.exit(1);
  }
}

export const ENV = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "",
  OPENAI_REALTIME_MODEL:
    process.env.OPENAI_REALTIME_MODEL ?? "gpt-4o-realtime-preview",
  OPENAI_REALTIME_URL:
    process.env.OPENAI_REALTIME_URL ??
    "wss://api.openai.com/v1/realtime",
  REALTIME_GATEWAY_SECRET: process.env.REALTIME_GATEWAY_SECRET ?? "",
  SUPABASE_URL: process.env.SUPABASE_URL ?? "",
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL ?? "",
  UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN ?? "",
  TRIAL_DECREMENT_INTERVAL_MS: Number(
    process.env.TRIAL_DECREMENT_INTERVAL_MS ?? 5000,
  ),
  PARSER_POLL_INTERVAL_MS: Number(
    process.env.PARSER_POLL_INTERVAL_MS ?? 5000,
  ),
  PARSER_STORAGE_BUCKET: process.env.PARSER_STORAGE_BUCKET ?? "uploads",
  RECONSTRUCT_POLL_INTERVAL_MS: Number(
    process.env.RECONSTRUCT_POLL_INTERVAL_MS ?? 10_000,
  ),
  // Provider 선택 — 실시간/복원 모두 공통.
  REALTIME_PROVIDER: normalizeProvider(process.env.REALTIME_PROVIDER),
  RECONSTRUCT_PROVIDER: normalizeProvider(
    process.env.RECONSTRUCT_PROVIDER ?? process.env.REALTIME_PROVIDER,
  ),
  // Google AI Studio API key — Gemini 호출용.
  GOOGLE_AI_API_KEY: process.env.GOOGLE_AI_API_KEY ?? "",
};
