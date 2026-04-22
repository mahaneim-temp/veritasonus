/**
 * 환경 변수 fail-fast 점검.
 * dev에서 잘못된 키로 쥐도새도 모르게 작동하는 일을 막는다.
 */

const required = [
  "OPENAI_API_KEY",
  "REALTIME_GATEWAY_SECRET",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

const missing = required.filter((k) => !process.env[k]);
if (missing.length > 0) {
  // eslint-disable-next-line no-console
  console.error(
    JSON.stringify({
      lvl: "error",
      msg: "missing_env",
      keys: missing,
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
};
