-- 2026-04-23: user_role enum 에 'unlimited' 값 추가.
-- Postgres 는 ALTER TYPE ... ADD VALUE 로 추가된 값을 같은 트랜잭션 안에서 참조할 수 없으므로
-- 이 문장은 별도 마이그레이션(=별도 트랜잭션) 으로 분리한다.
-- 그 뒤에 동일 날짜의 '2026-04-23-unlimited-whitelist.sql' 이 화이트리스트 테이블과 시드를 만든다.

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'unlimited' BEFORE 'admin';
