# lucid-interpret

웹 우선 실시간 통역 서비스 (가칭 `lucid-interpret`).
한국어→영어 양방향 v1, 다른 모드(통역/듣기/어시스트/사후 복원/회화 학습) 통합.

> 자세한 설계는 상위 디렉토리 `0_설계_패키지/` 의 12개 문서와 SSOT (`web_interpretation_full_technical_spec_for_claude_v1_1.docx`) 를 보세요. 본 README는 빠른 개발자 가이드입니다.

## 빠른 시작

전제: Node 20+, pnpm 9+, Supabase CLI, fly.io CLI(선택).

```bash
pnpm install

cp .env.example .env.local                              # 채우기
cp realtime-gateway/.env.example realtime-gateway/.env  # 채우기

# DB (로컬 docker 또는 원격 supabase)
supabase db reset

# 서버 두 개를 동시에 띄운다
pnpm dev                                       # web → http://localhost:3000
pnpm --filter lucid-realtime-gateway dev       # gateway → ws://localhost:8787

# 단위 테스트
pnpm test
```

## 디렉토리

- `src/` — Next.js 14 (App Router) 웹 앱
- `realtime-gateway/` — Node + ws 기반 OpenAI Realtime 브릿지
- `supabase/` — schema.sql, policies.sql
- `tests/` — vitest 단위 테스트
- `0_설계_패키지/` (상위) — 12종 설계 문서

## 핵심 흐름

1. 방문자 → `/start/quick` → `/api/sessions` (401) → `/api/auth/guest/start` → 게스트 쿠키 + Redis 카운터
2. 다시 `/api/sessions` → `session_id`
3. `/session/[id]` 마이크 권한 + `/api/realtime/token` 으로 ephemeral JWT 발급
4. 브라우저 ↔ `wss://gateway/v1/stream` (PCM16 16k) ↔ OpenAI Realtime
5. gateway는 utterances persist + 게스트 5초마다 차감
6. 종료 → `/session/[id]/review` 에서 사후 복원 요청

## 주요 환경변수

자세한 목록은 `.env.example`. 필수:
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `REALTIME_GATEWAY_SECRET` (web ↔ gateway 공유, 32+ bytes)
- `NEXT_PUBLIC_REALTIME_GATEWAY_URL`
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO_*`
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
- gateway: `OPENAI_API_KEY`

## 배포

- web → Vercel (`pnpm build && pnpm start` 또는 Vercel 빌드)
- gateway → Fly.io (`fly launch && fly deploy`, Dockerfile/fly.toml 포함)
- DB → Supabase Cloud (RLS 정책 적용 후 `supabase db push`)

## 문서

- `CLAUDE.md` — Claude Code용 인수인계
- `0_설계_패키지/01..12` — 결정/구조/스키마/UI/배포/검토
