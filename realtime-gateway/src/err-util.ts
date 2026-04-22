/**
 * Supabase PostgrestError 처럼 toString 이 `[object Object]` 로 떨어지는 객체를
 * 사람이 읽을 수 있는 메시지로 변환.
 */
export function errToStr(e: unknown): string {
  if (e == null) return "null";
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  if (typeof e === "object") {
    const o = e as Record<string, unknown>;
    const msg = typeof o.message === "string" ? o.message : null;
    const code = typeof o.code === "string" ? o.code : null;
    const details = typeof o.details === "string" ? o.details : null;
    const hint = typeof o.hint === "string" ? o.hint : null;
    const parts: string[] = [];
    if (code) parts.push(`code=${code}`);
    if (msg) parts.push(msg);
    if (details) parts.push(`details=${details}`);
    if (hint) parts.push(`hint=${hint}`);
    if (parts.length > 0) return parts.join(" | ");
    try {
      return JSON.stringify(e);
    } catch {
      return "unserializable_error_object";
    }
  }
  return String(e);
}
