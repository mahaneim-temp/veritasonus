import { test, expect } from "@playwright/test";

/**
 * signup conversion — 가입 페이지의 약관·처리방침 체크박스 동작을 검증.
 *
 * 실제 가입(Supabase 호출) 은 하지 않는다. UI 단의 필수 체크 로직만 검증.
 */
test("signup form requires TOS + privacy checkboxes before enabling submit", async ({
  page,
}) => {
  await page.goto("/signup");

  const submit = page.getByRole("button", { name: /가입하기|sign up/i });
  await expect(submit).toBeDisabled();

  // 체크박스 2개 중 하나만 체크 → 여전히 disabled.
  const checks = page.getByRole("checkbox");
  const first = checks.nth(0);
  const second = checks.nth(1);
  await first.check();
  await expect(submit).toBeDisabled();

  // 둘 다 체크 + 이메일·비밀번호 입력 → enabled.
  await second.check();
  await page.getByLabel(/이메일|email/i).fill("e2e-test@example.com");
  await page.getByLabel(/비밀번호|password/i).fill("test-password-1234");
  await expect(submit).toBeEnabled();

  // 약관 링크는 새 탭으로 열리는 (target=_blank) 구조인지 확인.
  const termsLink = page.getByRole("link", { name: /이용약관|terms/i });
  await expect(termsLink).toHaveAttribute("target", "_blank");
});
