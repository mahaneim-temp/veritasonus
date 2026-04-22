import { test, expect } from "@playwright/test";

/**
 * guest quick-start — 게스트가 /start/quick 에 진입해 세션 생성 폼을 볼 수 있는지.
 * 실제 마이크·WebSocket 은 건드리지 않는다 (브라우저 보안 + OpenAI 호출 회피).
 */
test("guest lands on quick-start and can see mode/language form", async ({ page }) => {
  await page.goto("/start/quick");
  // 페이지 타이틀·모드 카드·언어 선택 중 하나는 보여야 한다.
  await expect(page).toHaveTitle(/lucid|통역|interpret/i);
  // 대표적인 UI 요소들 — 구현이 바뀌어도 최소 한 가지는 살아있을 가능성이 높게 느슨하게.
  const candidates = [
    page.getByRole("heading", { name: /빠른 시작|quick/i }),
    page.getByText(/통역|interpretation/i).first(),
    page.getByRole("button", { name: /시작|start/i }).first(),
  ];
  let foundAny = false;
  for (const c of candidates) {
    if (await c.count()) {
      foundAny = true;
      break;
    }
  }
  expect(foundAny).toBeTruthy();
});
