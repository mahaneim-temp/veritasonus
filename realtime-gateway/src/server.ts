/**
 * lucid-realtime-gateway: server entry.
 *
 * Fastify HTTP + WebSocket(ws) 두 트래픽을 한 프로세스에서 처리.
 *   - GET  /health     → liveness/readiness
 *   - WS   /v1/stream  → 브라우저 ↔ OpenAI Realtime 브릿지
 *
 * 디자인 원칙:
 *   - OpenAI 키는 절대 브라우저로 노출하지 않는다.
 *   - 브라우저 ↔ gateway 인증은 ephemeral JWT (HS256) 만 사용.
 *   - 게스트 트라이얼은 Redis 카운터로 서버가 강제한다.
 *   - 발화 단위로 Supabase utterances 에 즉시 persist.
 */

import "./env.js";
import Fastify from "fastify";
import { WebSocketServer } from "ws";
import { logger } from "./logger.js";
import { handleConnection } from "./openai-bridge.js";

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "0.0.0.0";

const app = Fastify({
  logger: false,
  trustProxy: true,
});

app.get("/health", async () => ({ ok: true, t: Date.now() }));

const wss = new WebSocketServer({ noServer: true });

const server = app.server;
server.on("upgrade", (req, socket, head) => {
  const { url } = req;
  if (!url || !url.startsWith("/v1/stream")) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

wss.on("connection", (ws, req) => {
  handleConnection(ws, req).catch((e) => {
    logger.error({ err: String(e) }, "connection_handler_error");
    try {
      ws.close(1011, "internal error");
    } catch {
      // ignore
    }
  });
});

app
  .listen({ port: PORT, host: HOST })
  .then(() => logger.info({ port: PORT }, "gateway_listening"))
  .catch((e) => {
    logger.error({ err: String(e) }, "listen_failed");
    process.exit(1);
  });

const shutdown = (signal: string) => {
  logger.info({ signal }, "shutdown");
  wss.clients.forEach((c) => {
    try {
      c.close(1001, "server shutdown");
    } catch {
      // ignore
    }
  });
  app.close().finally(() => process.exit(0));
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
