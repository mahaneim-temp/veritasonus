/**
 * 초 단위 숫자를 `M:SS` 로 포맷. NaN/undefined/Infinity 같은 비정상 값이 들어와도
 * "NaN:NaN" 같은 깨진 출력 대신 `0:00` 반환.
 */
export function formatDurationSec(totalSec: unknown): string {
  const n =
    typeof totalSec === "number" && Number.isFinite(totalSec)
      ? Math.max(0, Math.floor(totalSec))
      : 0;
  const m = Math.floor(n / 60);
  const r = n % 60;
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
