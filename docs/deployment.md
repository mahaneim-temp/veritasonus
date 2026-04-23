# 배포 가이드 — Veritasonus 외부 베타

> **전제**: pnpm, Node 20+, Supabase CLI, Fly CLI, Vercel CLI 설치 완료.

---

## 아키텍처 한눈에 보기

```
브라우저
  │  HTTPS
  ▼
Vercel (Next.js 웹앱)          ← 이 가이드 §1
  │  WebSocket (wss://)
  ▼
Fly.io (realtime-gateway)      ← 이 가이드 §2
  │  REST
  ▼
Supabase (DB + Auth)           ← 이 가이드 §3
```

---

## §1. Vercel 배포 (Next.js 웹앱)

### 1-1. 저장소 연결

```bash
vercel login
vercel link          # 프로젝트 선택 또는 신규 생성
```

### 1-2. 필수 환경 변수 (Vercel Dashboard → Settings → Environment Variables)

| 변수명 | 값 예시 | 설명 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xxx.supabase.co` | Supabase 프로젝트 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJ...` | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` | **서버 전용** service role key |
| `REALTIME_GATEWAY_URL` | `wss://veritasonus-gw.fly.dev` | gateway WebSocket 주소 |
| `REALTIME_GATEWAY_SECRET` | 32자 이상 랜덤 문자열 | JWT 서명 공유 시크릿 |
| `MOCK_PAYMENT_ENABLED` | `true` (베타) / `false` (실서비스) | 결제 mock 모드 |
| `TASTE_TRIAL_SECONDS` | `60` | 맛보기 체험 시간(초) |
| `NEXT_PUBLIC_GATEWAY_WS_URL` | `wss://veritasonus-gw.fly.dev` | 브라우저→gateway 주소 |

> `REALTIME_GATEWAY_SECRET`은 gateway의 동일 환경 변수와 **반드시** 동일해야 함.

### 1-3. 배포

```bash
vercel --prod
```

### 1-4. 도메인 연결

Vercel Dashboard → Domains → `veritasonus.com` 추가 → DNS A/CNAME 설정.

---

## §2. Fly.io 배포 (realtime-gateway)

### 2-1. 앱 생성 (최초 1회)

```bash
cd realtime-gateway
fly launch --name veritasonus-gw --region nrt    # Tokyo (한국 가장 가까운 리전)
```

`fly.toml`이 자동 생성되거나 기존 파일 사용. 확인 사항:

```toml
[env]
  PORT = "8080"

[[services]]
  internal_port = 8080
  protocol = "tcp"

  [[services.ports]]
    handlers = ["tls", "http"]
    port = 443
    tls_options = { alpn = ["h2", "http/1.1"], versions = ["TLSv1.2", "TLSv1.3"] }
```

### 2-2. 시크릿 설정 (Google 운영 기준 — 현재 표준)

현재 `REALTIME_PROVIDER=google` 이므로 **OpenAI 키는 불필요**하다.
Google 서비스 계정 JSON 과 Gemini API 키가 필수다.

```bash
# ── 필수 (없으면 시작 불가) ──────────────────────────────────────
fly secrets set \
  REALTIME_PROVIDER="google" \
  RECONSTRUCT_PROVIDER="google" \
  REALTIME_GATEWAY_SECRET="<웹앱과 동일한 32자 이상 값>" \
  SUPABASE_URL="https://xxx.supabase.co" \
  SUPABASE_SERVICE_ROLE_KEY="eyJ..." \
  GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account","project_id":"..."}' \
  GOOGLE_AI_API_KEY="AIza..."

# ── 강력 권장 (없으면 게스트 트라이얼 무한 → abuse 위험) ──────────
fly secrets set \
  UPSTASH_REDIS_REST_URL="https://xxx.upstash.io" \
  UPSTASH_REDIS_REST_TOKEN="AXxx..."

# ── 선택 (기본값으로 동작하나 명시 권장) ────────────────────────
fly secrets set \
  TASTE_TRIAL_SECONDS="60" \
  LOG_LEVEL="info"
```

> **`GOOGLE_SERVICE_ACCOUNT_JSON`** — GCP 콘솔에서 서비스 계정 키(JSON) 다운로드 후
> 파일 전체를 한 줄 문자열로 붙여넣기. 필요 권한: Cloud Speech-to-Text User, Cloud Translation API User.
>
> **`GOOGLE_AI_API_KEY`** — Google AI Studio (aistudio.google.com) → API Keys → 새 키 생성.
> Gemini 모델을 사용하는 assist/재구성 워커에 필요.
>
> **Redis (Upstash)** — 없으면 `UNLIMITED_TRIAL` 처럼 게스트 트라이얼 타이머가 동작하지 않아
> 60초 제한이 무력화된다. 베타 오픈 전 반드시 설정할 것.

---

> **OpenAI로 전환할 경우** (별도 결정 필요):
> ```bash
> fly secrets set \
>   REALTIME_PROVIDER="openai" \
>   RECONSTRUCT_PROVIDER="openai" \
>   OPENAI_API_KEY="sk-..."
> # Google 자격은 제거해도 되지만 남겨둬도 무방 (사용 안 됨)
> ```

### 2-3. Redis 설정 (게스트 트라이얼 카운터)

gateway는 Upstash HTTP REST 클라이언트를 사용한다 (`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`).
Fly.io Redis는 Upstash 기반이므로 `fly redis attach` 가 이 두 변수를 자동 주입한다.

```bash
fly redis create --name veritasonus-redis --region nrt
fly redis attach veritasonus-redis
# → UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN 자동 주입
```

> 또는 직접 Upstash 계정(upstash.com)을 생성해 REST URL/Token을 위 §2-2 `fly secrets set` 에 포함해도 됨.

### 2-4. 배포

```bash
fly deploy
fly status
fly logs     # 실시간 로그 확인
```

### 2-5. 스케일 (베타는 최소 사양으로 시작)

```bash
fly scale count 1
fly scale vm shared-cpu-1x --memory 512
```

---

## §3. Supabase 설정

### 3-1. 프로젝트 생성

Supabase Dashboard에서 새 프로젝트 생성 → 한국에 가장 가까운 리전: **Northeast Asia (Tokyo)**.

### 3-2. 스키마 적용

```bash
# 방법 A: Supabase CLI (로컬 → 원격 push)
supabase link --project-ref <ref>
supabase db push

# 방법 B: Dashboard SQL Editor에서 직접 실행
#   supabase/schema.sql → 실행
#   supabase/policies.sql → 실행
#   supabase/migrations/2026-04-23-wallet-billing-marketing.sql → 실행
```

### 3-3. Auth 설정

- **Site URL**: `https://veritasonus.com`
- **Redirect URLs**: `https://veritasonus.com/**`, `http://localhost:3000/**`
- Email 확인: 베타 기간 중 "Confirm email" 비활성화 가능 (빠른 가입 테스트)

### 3-4. RLS 확인

```sql
-- policies.sql 적용 후 RLS 상태 확인
SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';
-- 모든 테이블이 rowsecurity=true 이어야 함
```

---

## §4. Veritasonus.com 도메인 연결 권장 구조

도메인 `veritasonus.com` 이 확보되었으므로 아래 구조를 권장한다.

### 4-1. 권장 서브도메인 배치

| 서브도메인 | 용도 | 대상 |
|---|---|---|
| `veritasonus.com` | 메인 서비스 (홈, 로그인, 서비스 전체) | Vercel |
| `app.veritasonus.com` | (선택) 서비스 진입점 별도 분리 시 사용 | Vercel |
| `gw.veritasonus.com` | realtime-gateway WebSocket | Fly.io |

> **베타 단계 권장**: `veritasonus.com` (루트) → 웹앱, `gw.veritasonus.com` → gateway.
> `app.` 서브도메인은 나중에 모바일 앱 등과 분기가 필요할 때 추가.

### 4-2. DNS 설정

**Vercel (웹앱)**:
```
veritasonus.com        A      76.76.21.21          (Vercel IP)
www.veritasonus.com    CNAME  cname.vercel-dns.com
```
또는 Vercel Dashboard → Domains → `veritasonus.com` 추가 후 안내된 레코드 사용.

**Fly.io (gateway)**:
```bash
fly certs add gw.veritasonus.com
# → Fly가 안내하는 CNAME 레코드를 DNS에 추가
# 예: gw.veritasonus.com  CNAME  veritasonus-gw.fly.dev
```

### 4-3. 환경별 URL 정리

| 환경 | 웹앱 | Gateway |
|---|---|---|
| Production | `https://veritasonus.com` | `wss://gw.veritasonus.com` |
| Staging (선택) | `https://staging.veritasonus.com` | `wss://gw-staging.veritasonus.com` |
| Local dev | `http://localhost:3000` | `ws://localhost:8787` |

### 4-4. 도메인 확정 후 코드 업데이트 (2곳)

```ts
// src/lib/brand.ts
export const BRAND_DOMAIN = "veritasonus.com";          // ← 이미 설정됨
export const BRAND_SUPPORT_EMAIL = "support@veritasonus.com";  // ← 확인 후 실 메일로 교체
```

```bash
# Vercel env (NEXT_PUBLIC_GATEWAY_WS_URL)
NEXT_PUBLIC_GATEWAY_WS_URL=wss://gw.veritasonus.com

# Fly.io secrets (REALTIME_GATEWAY_URL — 웹앱이 서버 사이드에서 호출 시)
# 현재는 브라우저가 직접 연결하므로 웹앱 서버에는 불필요할 수 있음
```

---

## §5. 외부 베타 직전 체크리스트

### 🔴 MUST-HAVE — 이게 안 되면 베타 오픈 불가

| # | 항목 | 확인 방법 |
|---|---|---|
| M-1 | `REALTIME_GATEWAY_SECRET` 웹앱·gateway 동일 여부 | `fly secrets list` 값과 Vercel env 값 비교 |
| M-2 | `GOOGLE_SERVICE_ACCOUNT_JSON` 설정 + STT 권한 확인 | `fly logs` 에서 startup 에러 없음 |
| M-3 | `GOOGLE_AI_API_KEY` 설정 (Gemini) | 재구성 워커 로그 에러 없음 |
| M-4 | Upstash Redis 연결 — 게스트 트라이얼 타이머 동작 | `/trial` 60초 후 실제 차단되는지 확인 |
| M-5 | `/trial` 비로그인 접근 가능, `/start/quick` 로그인 요구 | 직접 브라우저 확인 |
| M-6 | 회원가입 → `/start/quick` 리디렉션 | 신규 가입 계정으로 테스트 |
| M-7 | 지갑 소진 시 세션 시작 차단 (402) | 테스터 계정 free_seconds=0 설정 후 토큰 API 호출 |
| M-8 | Supabase RLS 모든 테이블 활성화 | `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public'` |
| M-9 | `/legal/terms`, `/legal/privacy` 페이지 존재 (법적 최소) | 브라우저 접근, 404 없음 |
| M-10 | 관리자 계정 1개 이상 생성·검증 | `/admin/users` 접근, 사용자 조회 동작 |

### 🟡 BETA-OK — 베타 중 있으면 좋고, 없어도 운영 가능

| # | 항목 | 비고 |
|---|---|---|
| B-1 | Mock 결제 → 지갑 충전 동작 | `MOCK_PAYMENT_ENABLED=true` 확인 |
| B-2 | 관리자 시간 부여(grant) 동작 | `/admin/users` grant 모달 테스트 |
| B-3 | `/trial` 후 가입 유도 모달 → `/signup` 링크 동작 | 맛보기 60초 소진 후 확인 |
| B-4 | 마케팅 동의 체크박스 (선택, 기본 unchecked) | 가입 폼 확인 |
| B-5 | 지갑 잔액 소진 후 `/pricing` 자연 유도 | 서비스 UI 흐름 확인 |
| B-6 | `/legal/refund`, `/legal/business` 내용 표시 | 링크 동작, 빈 페이지 없음 |
| B-7 | `fly logs` 에서 구글 STT 정상 응답 확인 | 세션 1회 테스트 로그 확인 |
| B-8 | Supabase `audit_log` 에 grant 기록 남는지 | grant 후 테이블 직접 확인 |

### ⚪ POST-BETA — 공개 전 필요, 베타 중 작업해도 무방

| # | 항목 | 이유 |
|---|---|---|
| P-1 | `/legal/terms` — 실제 이용약관 작성 (현재 placeholder) | 법적 의무 |
| P-2 | `/legal/privacy` — PIPA 최소 요건 충족 개인정보 처리방침 | 법적 의무 (C-1) |
| P-3 | `/legal/business` — 실제 사업자 정보 기입 (상호·번호·주소) | 전자상거래법 |
| P-4 | `MOCK_PAYMENT_ENABLED=false` + 실 결제 연동 (Toss/Stripe) | 실제 결제 수익화 |
| P-5 | 이메일 확인(Supabase Confirm email) 활성화 | 계정 검증 |
| P-6 | `BRAND_DOMAIN` 실제 도메인 연결 | `src/lib/brand.ts` 수정 |
| P-7 | 사용자 데이터 삭제 API (`/api/account/data` DELETE) | PIPA C-1 |
| P-8 | Playwright E2E 기본 경로 커버 | 회귀 방지 |
| P-9 | Fly.io 인스턴스 오토스케일 설정 | 트래픽 급증 대비 |
| P-10 | 에러 모니터링 연결 (Sentry 등) | 운영 가시성 |

---

## §6. 빠른 장애 대응

| 증상 | 확인 포인트 |
|---|---|
| 게이트웨이 연결 불가 | `fly status`, `fly logs`, `REALTIME_GATEWAY_SECRET` 일치 여부 |
| Google STT 에러 | `fly logs` 에서 `credential` / `permission denied` 확인, 서비스 계정 권한 재확인 |
| 로그인 후 홈으로 리디렉션 루프 | `NEXT_PUBLIC_SUPABASE_URL` / `ANON_KEY` 오입력 |
| 401 on token API | Supabase session 쿠키 미전달, `runtime = "nodejs"` 누락 |
| 지갑 차감 안 됨 | `user_wallet` row 생성 여부 (`/api/account/consent` 최초 1회 호출 필요) |
| 트라이얼 60초 제한 무효화 | Redis 미연결 — `UPSTASH_REDIS_REST_URL` 확인 |
| mock topup 미동작 | `MOCK_PAYMENT_ENABLED=true` 확인 |
| Gemini 재구성 실패 | `GOOGLE_AI_API_KEY` 설정 및 모델 사용 한도 확인 |
