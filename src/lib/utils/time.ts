export function formatDurationSec(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

export function hashIp(ip: string, salt: string): Promise<string> {
  // 브라우저와 서버 모두에서 사용 가능한 Web Crypto SHA-256
  const data = new TextEncoder().encode(`${salt}:${ip}`);
  return crypto.subtle.digest("SHA-256", data).then((buf) => {
    const arr = Array.from(new Uint8Array(buf));
    return arr.map((b) => b.toString(16).padStart(2, "0")).join("");
  });
}
