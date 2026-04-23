# 관리자 계정 생성 및 운영 가이드

---

## §1. 최초 관리자(superadmin) 계정 만들기

### 방법 A: Supabase Dashboard (권장 — 최초 1회)

1. **Supabase Dashboard → Authentication → Users** → "Add user" 클릭
2. 이메일 / 비밀번호 입력 후 생성
3. 생성된 user의 UUID 복사
4. **SQL Editor** 에서 아래 실행:

```sql
-- superadmin 권한 부여 (최고 권한, 모든 admin 기능 사용 가능)
UPDATE public.users
SET role = 'superadmin'
WHERE id = '<위에서 복사한 UUID>';

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

## §8. 긴급 차단 (Abuse 대응)

```sql
-- 사용자 역할을 blocked 또는 제거 (현재 role 컬럼으로 처리)
UPDATE public.users SET role = 'guest' WHERE email = 'abuser@example.com';
-- → /start/* 진입 시 지갑 잔액 없으면 자연 차단됨

-- 지갑 초기화 (극단적 경우)
UPDATE user_wallet SET free_seconds_remaining = 0, purchased_seconds = 0, granted_seconds = 0
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'abuser@example.com');
```
