import { test, expect } from "@playwright/test";

/**
 * admin role-gate — 비로그인 상태에서 /admin 진입 시 /login 으로 리다이렉트 되는지.
 *
 * (member·paid 역할로 진입했을 때 403 처리는 별도 서버 테스트 범위. 이 E2E 는
 *  middleware 의 게이트만 확인.)
 */
test("unauthenticated /admin redirects to /login with next param", async ({ page }) => {
  const res = await page.goto("/admin");
  // Next.js middleware 의 redirect 는 클라이언트 navigate 로 URL 이 /login 이 된다.
  await expect(page).toHaveURL(/\/login(\?next=)?/);
  // 원래 가려던 경로가 next 쿼리에 encode 된 형태로 보존되는지.
  const url = new URL(page.url());
  expect(url.pathname).toBe("/login");
  expect(url.searchParams.get("next") ?? "").toContain("/admin");
});

test("unauthenticated /admin/audit also redirects", async ({ page }) => {
  await page.goto("/admin/audit");
  await expect(page).toHaveURL(/\/login/);
});
