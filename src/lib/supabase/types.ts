/**
 * Placeholder for `supabase gen types typescript --linked > types.gen.ts`.
 * 첫 배포 후 덮어쓰기 예정. 지금은 수동 타입과 any[] 로 얇게 정의.
 */

export type Database = {
  public: {
    Tables: Record<string, { Row: Record<string, unknown> }>;
    Functions: Record<string, unknown>;
    Enums: Record<string, unknown>;
  };
};
