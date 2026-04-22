/**
 * /waitlist — 베타 초대 미보유 방문자에게 보여주는 안내 페이지.
 * 초대 코드를 URL (?invite=CODE) 로 가져오면 middleware 가 쿠키 설정 후 통과.
 */

export default function WaitlistPage() {
  return (
    <div className="container max-w-xl py-20 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">
        베타 초대 진행 중
      </h1>
      <p className="mt-3 text-ink-secondary">
        아직 정식 오픈 전이에요. 초대 코드가 있다면 URL 뒤에{" "}
        <code className="rounded bg-surface-raised px-1.5 py-0.5 text-sm">
          ?invite=코드
        </code>
        를 붙여 다시 들어와 주세요.
      </p>
      <p className="mt-6 text-sm text-ink-muted">
        정식 오픈 알림을 받고 싶다면{" "}
        <a className="underline" href="mailto:hello@lucid-interpret.app">
          hello@lucid-interpret.app
        </a>{" "}
        으로 이메일을 보내주세요.
      </p>
    </div>
  );
}
