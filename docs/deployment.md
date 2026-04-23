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

### 2-2. 시크릿 설정

```bash
fly secrets set \
  REALTIME_GATEWAY_SECRET="<웹앱과 동일한 값>" \
  SUPABASE_URL="https://xxx.supabase.co" \
  SUPABASE_SERVICE_ROLE_KEY="eyJ..." \
  OPENAI_API_KEY="sk-..." \
  TASTE_TRIAL_SECONDS="60"
```

> **Google STT 사용 시 추가**:
> ```bash
> fly secrets set GOOGLE_APPLICATION_CREDENTIALS_JSON='{"type":"service_account",...}'
> ```
> (gateway 코드에서 `GOOGLE_APPLICATION_CREDENTIALS_JSON` 환경변수 파싱 지원 필요)

### 2-3. Redis 설정 (게스트 트라이얼 카운터)

```bash
fly redis create --name veritasonus-redis --region nrt
fly redis attach veritasonus-redis     # FLY_REDIS_URL 자동 주입
```

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

## §4. 환경별 도메인 구조 (권장)

| 환경 | 웹앱 URL | Gateway URL |
|---|---|---|
| Production | `https://veritasonus.com` | `wss://gw.veritasonus.com` |
| Staging | `https://staging.veritasonus.com` | `wss://gw-staging.veritasonus.com` |
| Local dev | `http://localhost:3000` | `ws://localhost:8787` |

Fly.io 커스텀 도메인 설정:
```bash
fly certs add gw.veritasonus.com
# → DNS에 CNAME veritasonus-gw.fly.dev 추가
```

---

## §5. 배포 후 smoke test 체크리스트

- [ ] `https://veritasonus.com` 홈페이지 로딩
- [ ] `/trial` 페이지 접근 (비로그인 상태)
- [ ] `/trial` 1분 맛보기 WebSocket 연결 → 통역 동작
- [ ] `/signup` 회원가입 → `/start/quick` 리디렉션
- [ ] `/start/quick` 세션 시작 → 통역 동작
- [ ] 지갑 10분 소진 후 `/api/realtime/token` → 402 반환
- [ ] `/pricing` 크레딧 팩 표시
- [ ] `MOCK_PAYMENT_ENABLED=true` 상태에서 팩 구매 → 지갑 충전 확인
- [ ] `/admin/users` 관리자 로그인 후 접근
- [ ] `/legal/refund`, `/legal/business` 페이지 표시

---

## §6. 빠른 장애 대응

| 증상 | 확인 포인트 |
|---|---|
| 게이트웨이 연결 불가 | `fly status`, `fly logs`, `REALTIME_GATEWAY_SECRET` 일치 여부 |
| 로그인 후 홈으로 리디렉션 루프 | `NEXT_PUBLIC_SUPABASE_URL` / `ANON_KEY` 오입력 |
| 401 on token API | Supabase session 쿠키 미전달, `runtime = "nodejs"` 누락 |
| 지갑 차감 안 됨 | `user_wallet` 테이블 row 생성 여부 확인 (`/api/account/consent` 최초 1회 호출 필요) |
| mock topup 미동작 | `MOCK_PAYMENT_ENABLED=true` 환경변수 확인 |
