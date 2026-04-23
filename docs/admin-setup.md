# 관리자 계정 생성 및 운영 가이드

---

## §1. 최초 관리자(superadmin) 계정 만들기

### 방법 A (권장 — 형의 이메일로 일반 가입 → 승격)

현재 운영 시나리오. 신규 온보딩 가이드도 직접 검증할 수 있어서 추천.

1. 브라우저 시크릿 창에서 `https://veritasonus.com/signup` 접속.
2. 형 이메일(예: `mahaneim@gmail.com`) + 비밀번호 + 표시 이름(선택) 입력 → 가입.
3. 메일 확인 링크 클릭 → `/onboarding` 도달.
4. 온보딩은 **건너뛰어도 됨** (어차피 superadmin 은 이후 게이트 면제). 완료하면 `/onboarding/next` 까지 확인.
5. **Supabase Dashboard → SQL Editor** 에서 아래 실행:

```sql
-- superadmin 권한 부여 (최고 권한, 모든 admin 기능 사용 가능)
UPDATE public.users
SET role = 'superadmin'
WHERE email = 'mahaneim@gmail.com';  -- 형 이메일로 교체

-- 온보딩 게이트 우회를 위해 preferences 행도 완료 상태로 강제 세팅(선택)
UPDATE public.user_preferences
SET onboarding_completed_at = coalesce(onboarding_completed_at, now())
WHERE user_id = (SELECT id FROM public.users WHERE email = 'mahaneim@gmail.com');

-- 확인
SELECT u.id, u.email, u.role, p.onboarding_completed_at
FROM public.users u
LEFT JOIN public.user_preferences p ON p.user_id = u.id
WHERE u.role IN ('admin', 'superadmin');
```

6. 같은 브라우저에서 `/admin` 접속 → 관리자 화면이 뜨면 성공.

### 방법 B: Supabase Dashboard 직접 생성 (자동 메일 미발송)

1. **Supabase Dashboard → Authentication → Users** → "Add user" 클릭
2. 이메일 / 비밀번호 입력 후 생성(메일 인증 스킵됨)
3. 생성된 user의 UUID 복사
4. **SQL Editor** 에서 아래 실행:

```sql
-- superadmin 권한 부여 + 온보딩 완료 플래그
UPDATE public.users
SET role = 'superadmin'
WHERE id = '<위에서 복사한 UUID>';

UPDATE public.user_preferences
SET onboarding_completed_at = coalesce(onboarding_completed_at, now())
WHERE user_id = '<위 UUID>';

-- 확인
SELECT id, email, role FROM public.users WHERE role IN ('admin', 'superadmin');
```

### 방법 B: 서비스 역할 API (자동화 스크립트)

```bash
# Supabase Management API 사용
curl -X POST "https://<ref>.supabase.co/auth/v1/admin/users" \
  -H "apikey: <SERVICE_ROLE_KEY>" \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "강력한비밀번호!",
    "email_confirm": true,
    "user_metadata": {"locale": "ko"}
  }'
# → 반환된 id를 사용해 UPDATE public.users SET role='superadmin' ...
```

---

## §2. 추가 관리자(admin) 계정 만들기

일반 회원가입 후 관리자 계정 승격:

```sql
-- 일반 관리자 (admin): 사용자 조회, 시간 부여, 감사 로그 조회
UPDATE public.users
SET role = 'admin'
WHERE email = 'manager@example.com';
```

---

## §3. 관리자 권한 차이

| 기능 | member | admin | superadmin |
|---|---|---|---|
| 서비스 사용 | ✅ | ✅ (무제한) | ✅ (무제한) |
| `/admin/*` 접근 | ❌ | ✅ | ✅ |
| 사용자 목록 조회 | ❌ | ✅ | ✅ |
| 사용자에게 시간 부여 | ❌ | ✅ | ✅ |
| 역할 변경 | ❌ | ❌ | ✅ (예정) |
| 환불 처리 | ❌ | ✅ (예정) | ✅ (예정) |

---

## §4. 관리자 대시보드 사용법

### 4-1. 사용자 목록 (`/admin/users`)

- 이메일 검색, 역할 필터, 페이지네이션 지원
- 각 사용자의 이번 달 사용량, 지갑 잔액(free/purchased/granted) 표시

### 4-2. 시간 부여 (Grant)

1. `/admin/users` 에서 대상 사용자 선택 → "시간 부여" 버튼
2. 부여할 초(seconds) 입력 + 사유(reason) 입력
3. 확인 → `granted_seconds` 지갑에 적립 (만료 없음)
4. 감사 로그(`audit_log`)에 자동 기록

**API 직접 호출:**
```bash
curl -X POST https://veritasonus.com/api/admin/credit/grant \
  -H "Cookie: <관리자 세션 쿠키>" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "<대상 UUID>",
    "grant_seconds": 3600,
    "reason": "베타 테스터 보상"
  }'
```

### 4-3. 감사 로그 확인

Supabase Dashboard → Table Editor → `audit_log` 테이블:

```sql
-- 최근 100건 감사 로그
SELECT
  al.created_at,
  actor.email AS actor_email,
  al.action,
  al.target_type,
  al.target_id,
  al.payload
FROM audit_log al
LEFT JOIN auth.users actor ON actor.id = al.actor_id
ORDER BY al.created_at DESC
LIMIT 100;
```

---

## §5. 베타 초대 흐름

현재 초대 코드 게이트는 `INVITE_GATE_ENABLED` 환경변수로 제어됨.
베타 기간 중 열린 가입을 원하면:

```bash
# Vercel 환경변수에서
INVITE_GATE_ENABLED=false
```

초대 코드 기반 제한 가입을 원하면:
```bash
INVITE_GATE_ENABLED=true
```
초대 코드 관리: Supabase `invite_codes` 테이블에서 직접 INSERT.

---

## §6. 베타 테스터 온보딩 이메일 내용 (초안)

```
제목: [Veritasonus 베타] 초대장이 도착했습니다 🎙️

안녕하세요,

Veritasonus 비공개 베타에 초대합니다.

▶ 접속 URL: https://veritasonus.com
▶ 무료 체험: 회원가입 없이 /trial 에서 1분 맛보기 가능
▶ 월 10분 무료: 회원가입 후 매월 10분 무료 통역 제공

사용 방법:
1. https://veritasonus.com/signup 에서 가입
2. [빠른 시작] → 마이크 권한 허용 → 언어 선택 → 시작

피드백은 support@veritasonus.com 으로 보내주세요.

감사합니다.
Veritasonus 팀 드림
```

---

## §7. 지갑 잔액 직접 확인 (SQL)

```sql
-- 특정 사용자 지갑 확인
SELECT
  u.email,
  w.free_seconds_remaining,
  w.purchased_seconds,
  w.granted_seconds,
  w.last_reset_yyyymm,
  (w.free_seconds_remaining + w.purchased_seconds + w.granted_seconds) AS total_remaining
FROM user_wallet w
JOIN auth.users u ON u.id = w.user_id
WHERE u.email = 'tester@example.com';
```

---

## §8. 관리자 권한 확인 절차 (실제 테스트)

관리자 권한이 실제로 먹는지 확인하는 순서. superadmin 승격 직후 1회 실행 권장.

### 8-1. `/admin` 접근

1. superadmin 계정으로 로그인.
2. 브라우저에서 `https://veritasonus.com/admin` 접속.
3. 페이지가 404 나 로그인 리다이렉트 없이 열리면 OK.
4. 일반 회원 계정으로 로그인 후 같은 URL 접속 시 → 차단되어야 함.

### 8-2. 사용자 목록 조회 (/admin/users)

1. `/admin/users` 접속 → TanStack Table 렌더링 확인.
2. 페이지네이션, 역할 필터 동작 확인.
3. SQL 레벨 이중 확인:
   ```sql
   -- 관리자 권한으로 users 전체 열 조회 가능한지 (RLS 통과 확인)
   -- Supabase Dashboard 는 service-role 이므로 늘 통과. 앱 레벨에서의 확인이 핵심.
   SELECT count(*) FROM public.users;
   ```

### 8-3. 시간 부여(Grant) 가능 여부

1. `/admin/users` 에서 아무 사용자나 선택 → "시간 부여" 버튼 클릭.
2. 1800 초(30분) + 사유 "권한 확인 테스트" 입력 → 적용.
3. 해당 사용자 행의 granted_seconds 가 1800 증가했는지 확인.
4. audit_log 에 기록되었는지:
   ```sql
   SELECT created_at, action, target_type, target_id, payload
   FROM public.audit_log
   WHERE action LIKE '%grant%'
   ORDER BY created_at DESC
   LIMIT 5;
   ```

### 8-4. 온보딩 게이트 면제 확인

1. superadmin 계정으로 로그인된 상태에서 `/start/quick` 직접 접속.
2. `/onboarding` 으로 튕기지 않고 바로 `/start/quick` 이 열리면 OK.
   (미들웨어에서 role 검사하여 admin/superadmin 은 게이트 스킵.)
3. 반대로 일반 회원이면서 온보딩 미완료인 계정은 `/onboarding?reason=required` 로 리다이렉트되어야 함.

---

## §9. 온보딩 상태 직접 조작 (테스트/지원 용도)

### 특정 사용자의 온보딩 상태 확인

```sql
SELECT
  u.email,
  u.display_name,
  p.primary_purpose,
  p.default_source_lang,
  p.default_target_lang,
  p.preferred_mode,
  p.onboarding_completed_at
FROM public.users u
LEFT JOIN public.user_preferences p ON p.user_id = u.id
WHERE u.email = 'target@example.com';
```

### 온보딩 강제 완료 (건너뛰기 시뮬레이션)

```sql
UPDATE public.user_preferences
SET onboarding_completed_at = now()
WHERE user_id = (SELECT id FROM public.users WHERE email = 'target@example.com');
```

### 온보딩 강제 리셋 (다시 보여주고 싶을 때)

```sql
UPDATE public.user_preferences
SET onboarding_completed_at = NULL
WHERE user_id = (SELECT id FROM public.users WHERE email = 'target@example.com');
```

---

## §10. 긴급 차단 (Abuse 대응)

```sql
-- 사용자 역할을 blocked 또는 제거 (현재 role 컬럼으로 처리)
UPDATE public.users SET role = 'guest' WHERE email = 'abuser@example.com';
-- → /start/* 진입 시 지갑 잔액 없으면 자연 차단됨

-- 지갑 초기화 (극단적 경우)
UPDATE user_wallet SET free_seconds_remaining = 0, purchased_seconds = 0, granted_seconds = 0
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'abuser@example.com');
```
