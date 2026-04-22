# lucid-realtime-gateway

브라우저 ↔ OpenAI Realtime 브릿지.

## 책임
- ephemeral JWT(HS256) 검증으로 브라우저 인증.
- OpenAI Realtime WS 연결 유지 및 PCM16 오디오 양방향 중계.
- 게스트 트라이얼(Redis 카운터) 강제: 0초가 되면 즉시 종료.
- 발화 단위로 Supabase `utterances` 에 persist.

## 로컬 실행
```bash
cp .env.example .env
# 값 채우기
npm install
npm run dev
```

## 배포 (fly.io)
```bash
fly launch --no-deploy   # 최초 1회 (이름/리전 확인)
fly secrets set \
  OPENAI_API_KEY=... REALTIME_GATEWAY_SECRET=... \
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=...
fly deploy
```

웹 앱(`NEXT_PUBLIC_REALTIME_GATEWAY_URL`)에 배포된 wss URL을 등록.
