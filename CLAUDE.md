# CLAUDE.md — `lucid-interpret` Handoff

이 파일은 **Claude Code(이 디렉토리에서 실행)** 가 빠르게 컨텍스트를 잡고 후속 작업을 이어갈 수 있도록 작성된 인수인계 문서입니다. SSOT는 저장소 외부의 `web_interpretation_full_technical_spec_for_claude_v1_1.docx` 와 본 저장소의 `0_설계_패키지/` (상위 디렉토리) 입니다. 둘이 충돌하면 SSOT를 따른 후 설계 패키지를 갱신합니다.

## 1. 프로젝트 한 줄 정의

웹 우선 실시간 통역 서비스. 모드 = `interactive_interpretation` / `listener_live(_recorded)` / `assist_interpretation` / `conversation_learning(예약)` / 사후 복원.

## 2. 모노레포 구조

```
lucid-interpret/
├─ src/                       # Next.js 14 App Router (web 앱)
│  ├─ app/                    # 페이지 + API routes
│  ├─ components/             # UI (shadcn 패턴)
│  ├─ hooks/                  # useInterpretSession, useMicrophone, useGuestTrial …
│  ├─ lib/                    # 도메인/인프라
│  │  ├─ session/             # state-machine, biasing
│  │  ├─ confidence/          # 신뢰도/플래그 정책
│  │  ├─ guest/               # 트라이얼·초대코드
│  │  ├─ realtime/            # JWT, adapter, events
│  │  ├─ supabase/            # client/server/service
│  │  ├─ billing/             # plans, stripe
│  │  └─ ratelimit/           # Upstash 래핑
│  ├─ types/                  # session, realtime, api 공통 타입
│  └─ middleware.ts           # auth refresh + invite gate + /admin guard
├─ realtime-gateway/          # 별도 Node 프로세스 (Fly.io)
│  ├─ src/                    # server, openai-bridge, auth, trial, persist
│  ├─ Dockerfile, fly.toml
│  └─ .env.example
├─ supabase/                  # schema.sql, policies.sql
├─ tests/                     # vitest 단위 테스트
├─ .env.example
└─ package.json (pnpm-workspace)
```

## 3. 가장 중요한 불변(invariant) — 깨면 안 되는 것들

1. **OPENAI_API_KEY 는 절대 브라우저로 가지 않는다.** 브라우저 ↔ gateway 인증은 ephemeral JWT(HS256, TTL 15분)만 사용. 시크릿은 `REALTIME_GATEWAY_SECRET` 단일 출처.
2. **게스트 트라이얼은 서버가 진실의 원천.** 클라이언트 카운트다운은 표시용이고, 실제 차단은 gateway가 Redis 카운터로 한다 (`5초마다 5초 차감`, 0 이하 → `ws.close(4001, "trial_expired")`).
3. **세션 상태 전이는 순수 함수**(`src/lib/session/state-machine.ts`). UI/네트워크 부수효과는 `effects[]`로 호출자에게 위임. 이 위반 = 회귀 위험.
4. **PII/녹음**: `recording_enabled=false`가 기본. 켜진 경우에만 raw audio가 저장된다. 사용자 동의 토글이 UI에 명시적으로 보여야 한다(`session/[id]/page.tsx`).
5. **RLS는 항상 켜져 있어야 한다** (`supabase/policies.sql` 참조). 서버에서 `service-role` 사용 지점은 명시적으로 한정 (`/api/**`의 service.ts).

## 4. 실행

```bash
pnpm install                 # 워크스페이스(웹 + gateway) 동시 설치
cp .env.example .env.local
cp realtime-gateway/.env.example realtime-gateway/.env

# DB
supabase db reset            # schema.sql + policies.sql 적용
# (선택) supabase gen types typescript --linked > src/lib/supabase/types.gen.ts

pnpm dev                     # 웹 (3000)
pnpm --filter lucid-realtime-gateway dev   # 게이트웨이 (8787)
pnpm test                    # vitest
```

## 5. 우선순위 작업 (Claude Code가 이어서 할 일)

> **작업 착수 전 필독 (인수 규약)**
>
> 1. `0_설계_패키지/01~12` 는 현재 구현 기준 문서로 **우선 적용**한다.
> 2. `13_확장_설계_부록` 은 형(사용자) 별도 승인 없이는 구현하지 말고, TODO/제안으로만 남긴다. 예외는 부록에서 "🔵 승격 확정" 라벨이 붙은 항목뿐이며, 그것들은 아래 표에 이미 포함되어 있다.
> 3. 가장 먼저 아래 표의 **A-1 → A-4** 를 순서대로 해결한 뒤 결과를 요약 보고하고(CP-1), 다음 단계로 넘어간다.
> 4. A-4 완료 후 유료 베타 초대장 발송 **직전**에는 부록의 **C-1(PIPA 최소 요건)** 과 **F-1(사용량 쿼터)** 를 형 최종 확인 후 승격 구현한다(CP-2). 이 두 항목은 법적·재무적 안전장치로서 부록 중 유일하게 **베타 전 필수**이다.

### 구현 순서

| 단계 | 순위 | 작업 | 위치 | 비고 |
|---|---|---|---|---|
| MVP | ★★★ | **[A-1]** utterances 번역 저장 경로 수정 | `realtime-gateway/src/openai-bridge.ts` (`response.audio_transcript.done` 분기) | `seq + 0.5` 는 int 컬럼 저장 불가. `translated_text` UPDATE 또는 별도 테이블로 교체. **가장 먼저**. |
| MVP | ★★★ | **[A-2]** 자료 파싱 워커 | `realtime-gateway/src/parser.ts` (신규) 또는 Edge Cron | `session_assets.parse_status='pending'` → 텍스트 추출(`pdf-parse`, `mammoth`, `pptx2html`). `extracted_text` 를 채우면 biasing 사용. |
| MVP | ★★★ | **[A-3]** 사후 복원 워커 | `realtime-gateway/src/reconstruct.ts` 또는 별도 워커 | `reconstructions.status='pending'` polling → utterances 합쳐 LLM 요약/액션/숫자 추출. |
| MVP | ★★★ | **[A-4]** useInterpretSession 안정화 | `src/hooks/useInterpretSession.ts` | gateway 재연결(지수 백오프, 최대 3회), 토큰 만료 5분 전 재발급, paused 시 mic stream 완전 중단, RTT watchdog. 현재 happy-path만. |
| **베타 발송 전 필수** | ★★★ | **[C-1]** PIPA 최소 요건 | `/legal/privacy`, `/legal/terms`, `/api/account/data`, 리스너 동의 모달 | 개인정보 처리방침/이용약관 정적 페이지, 사용자 데이터 삭제 API, 리스너 모드 상대방 동의 모달. 상세: `0_설계_패키지/13_확장_설계_부록.md §C-1`. |
| **베타 발송 전 필수** | ★★★ | **[F-1]** 사용량 쿼터 | `src/lib/billing/quota.ts` (신규), 세션 종료 훅 | 플랜별 월 사용량 누적 + 80%/100% 경고 + 초과 시 세션 강제 종료. 원가 역산 필수. 상세: `0_설계_패키지/13_확장_설계_부록.md §F-1`. |
| 베타 후 | ★★ | **[A-5]** 관리자 상세 테이블 | `/admin/sessions`, `/admin/users` | TanStack Table + 서버 페이징 + 필터 + 환불 트리거(`/api/admin/refund` 신설). |
| 베타 후 | ★★ | **[A-6]** audit_log | 신규 테이블 + 관리자 API 공통 래퍼 | `audit_log(id, actor_id, action, target_type, target_id, payload, created_at)`. |
| 베타 후 | ★★ | **[A-7]** E2E (Playwright) | `e2e/` | quick-start happy path, trial-expiry flow, signup conversion, admin role-gate. |
| v1.1+ | ★ | i18n / Stripe 멱등 보강 / confidence UX 고도화 / 토스페이먼츠 어댑터 | — | `12_다음_단계_및_리스크.md §B` 백로그 참조. |

### 보고 체크포인트

- **CP-1** — A-1~A-4 완료 후 형님께 요약 보고 → 유료 베타 발송 승인 대기.
- **CP-2** — C-1·F-1 완료 후 형님께 요약 보고 → 베타 초대장 발송 개시.
- **CP-3** — A-5~A-7 완료 후 형님께 요약 보고 → 공개 런칭 승인 대기.

## 6. 자주 헷갈리는 포인트

- **owner_type=guest** 인 세션은 `auth.uid()` 가 없다. RLS 통과는 service-role insert. API에서 권한 검증은 `lucid_guest_id` 쿠키와 `sessions.owner_id` 비교로 한다 (`src/app/api/sessions/[id]/*` 패턴).
- **Edge runtime 한계**: `/api/billing/webhook`, `/api/sessions/*`, `/api/realtime/token` 등 Node 모듈을 쓰는 라우트는 `export const runtime = "nodejs"` 명시. Edge OK는 `/api/ping` 정도.
- **PCM16 16k mono 가 약속된 포맷**. `useMicrophone`의 `float32ToPCM16` 변환 위치가 진실이며, 다른 샘플레이트로 보내면 OpenAI가 잡음으로 인식.
- **Trial 차감 타이밍**: `audioInFlight` 플래그를 사용해 마이크가 꺼져 있을 때(또는 paused) 차감하지 않는다. 페이지 이탈/네트워크 단절은 별도 watchdog 필요(향후 작업).

## 7. 테스트 정책

- 도메인 로직(state-machine, confidence, biasing)은 vitest 로 100% 커버.
- I/O는 통합 테스트(Playwright + 임시 supabase)로. 현재는 미구현.

## 8. 협업/PR 메모

- 형(사용자) ↔ 아우(AI) 관계. 한국어 우선. 문서/주석/UI 모두 한국어 자연스럽게.
- 작업 전에 `0_설계_패키지/` 색인을 먼저 본다. 거기에 결정/가정이 적혀 있다.
- SSOT(.docx) 의 변경 사항이 있을 때마다 설계 패키지의 `02_가정사항_및_결정사항.md` 에 변경 이력을 한 줄 남긴다.

## 9. 알려진 위험 (자세히는 `0_설계_패키지/12_다음_단계_및_리스크.md`)

- OpenAI Realtime API 가용성/비용 변동 → adapter 패턴(`src/lib/realtime/adapter.ts`)으로 추상화. Provider 스왑 비용을 작게.
- iOS Safari 의 `getUserMedia` 16k 제약. AudioWorklet 미지원 환경 폴백 필요.
- 게스트 abuse: 현재 IP 기반 rate-limit 만 적용. v1.1에서 guest_id rotation 탐지 + 디바이스 핑거프린팅 검토.
