/** 초경량 로거. 서버/클라 양쪽에서 사용. Sentry 연동은 보강 필요. */

type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const envLevel = (process.env.LOG_LEVEL ?? "info") as Level;
const threshold = order[envLevel] ?? order.info;

function emit(level: Level, msg: string, extra?: Record<string, unknown>) {
  if (order[level] < threshold) return;
  const line = {
    t: new Date().toISOString(),
    lvl: level,
    msg,
    ...extra,
  };
  // eslint-disable-next-line no-console
  (console[level] ?? console.log)(JSON.stringify(line));
}

export const logger = {
  debug: (msg: string, extra?: Record<string, unknown>) =>
    emit("debug", msg, extra),
  info: (msg: string, extra?: Record<string, unknown>) =>
    emit("info", msg, extra),
  warn: (msg: string, extra?: Record<string, unknown>) =>
    emit("warn", msg, extra),
  error: (msg: string, extra?: Record<string, unknown>) =>
    emit("error", msg, extra),
};
