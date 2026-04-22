import { defineConfig, devices } from "@playwright/test";

/**
 * A-7 E2E 설정.
 *
 * 주의:
 *   - `pnpm exec playwright install` 로 브라우저 바이너리를 먼저 받아야 한다.
 *   - `E2E_BASE_URL` 환경변수가 없으면 로컬 dev 서버(localhost:3000) 를 가정.
 *   - Supabase / Stripe 실제 서비스를 건드리지 않는다 — 테스트 대상 페이지는 모두
 *     초기 진입 화면(이메일·비밀번호 입력 폼 등)까지만 검증.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    locale: "ko-KR",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
