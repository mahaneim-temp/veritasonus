export default function AdminSessionsPage() {
  return (
    <div className="container py-10">
      <h1 className="text-2xl font-semibold">세션 목록</h1>
      <p className="mt-2 text-ink-secondary text-sm">
        Claude Code 세션에서 필터·검색·상세 페이지를 완성합니다. 기본 쿼리: `sessions.created_at desc`.
      </p>
      <div className="mt-6 rounded-2xl border border-dashed border-border-subtle p-10 text-center text-ink-muted">
        테이블 컴포넌트 (TanStack Table) 연결 예정
      </div>
    </div>
  );
}
