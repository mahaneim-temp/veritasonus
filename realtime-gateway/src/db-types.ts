// Gateway 가 사용하는 최소 Database 타입 — `supabase/schema.sql` 의 서브셋.
// 웹앱의 `src/lib/supabase/types.gen.ts` 와 컬럼 정의가 일치해야 한다.
// 스키마 변경 시 두 파일을 같은 커밋에서 동기화.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      sessions: {
        Row: {
          id: string;
          owner_type: "member" | "guest";
          owner_id: string;
          mode:
            | "interactive_interpretation"
            | "listener_live"
            | "listener_live_recorded"
            | "assist_interpretation"
            | "conversation_learning";
          state:
            | "idle"
            | "preflight"
            | "prepared"
            | "live"
            | "paused"
            | "ended"
            | "post_reconstructing"
            | "completed";
          source_lang: string;
          target_lang: string;
          quality_mode: "standard" | "premium" | "auto";
          topic_guess: string | null;
          audience: string | null;
          context_note: string | null;
          recording_enabled: boolean;
          started_at: string | null;
          ended_at: string | null;
          created_at: string;
          metadata: Json;
        };
        Insert: {
          id?: string;
          owner_type: "member" | "guest";
          owner_id: string;
          mode: Database["public"]["Tables"]["sessions"]["Row"]["mode"];
          state?: Database["public"]["Tables"]["sessions"]["Row"]["state"];
          source_lang: string;
          target_lang: string;
          quality_mode?: Database["public"]["Tables"]["sessions"]["Row"]["quality_mode"];
          topic_guess?: string | null;
          audience?: string | null;
          context_note?: string | null;
          recording_enabled?: boolean;
          started_at?: string | null;
          ended_at?: string | null;
          created_at?: string;
          metadata?: Json;
        };
        Update: {
          state?: Database["public"]["Tables"]["sessions"]["Row"]["state"];
          started_at?: string | null;
          ended_at?: string | null;
        };
        Relationships: [];
      };
      utterances: {
        Row: {
          id: string;
          session_id: string;
          seq: number;
          speaker_label: string | null;
          started_at_ms: number | null;
          ended_at_ms: number | null;
          source_text: string;
          corrected_text: string | null;
          translated_text: string | null;
          confidence_level: "high" | "medium" | "low";
          confidence_score: number | null;
          requires_review: boolean;
          flags: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          seq: number;
          speaker_label?: string | null;
          started_at_ms?: number | null;
          ended_at_ms?: number | null;
          source_text: string;
          corrected_text?: string | null;
          translated_text?: string | null;
          confidence_level?: "high" | "medium" | "low";
          confidence_score?: number | null;
          requires_review?: boolean;
          flags?: Json;
          created_at?: string;
        };
        Update: {
          speaker_label?: string | null;
          started_at_ms?: number | null;
          ended_at_ms?: number | null;
          source_text?: string;
          corrected_text?: string | null;
          translated_text?: string | null;
          confidence_level?: "high" | "medium" | "low";
          confidence_score?: number | null;
          requires_review?: boolean;
          flags?: Json;
        };
        Relationships: [];
      };
      session_assets: {
        Row: {
          id: string;
          session_id: string;
          asset_type:
            | "script"
            | "slides"
            | "glossary"
            | "sermon_note"
            | "speaker_profile";
          file_name: string | null;
          file_path: string | null;
          mime_type: string | null;
          size_bytes: number | null;
          extracted_text: string | null;
          parse_status: string;
          parse_error: string | null;
          parsed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          asset_type: Database["public"]["Tables"]["session_assets"]["Row"]["asset_type"];
          file_name?: string | null;
          file_path?: string | null;
          mime_type?: string | null;
          size_bytes?: number | null;
          extracted_text?: string | null;
          parse_status?: string;
          parse_error?: string | null;
          parsed_at?: string | null;
          created_at?: string;
        };
        Update: {
          extracted_text?: string | null;
          parse_status?: string;
          parse_error?: string | null;
          parsed_at?: string | null;
        };
        Relationships: [];
      };
      reconstructions: {
        Row: {
          id: string;
          session_id: string;
          status: "pending" | "running" | "done" | "failed";
          include_recording: boolean;
          reconstructed_text: string | null;
          summary: string | null;
          key_decisions: Json | null;
          action_items: Json | null;
          important_numbers: Json | null;
          requested_at: string;
          completed_at: string | null;
          error_message: string | null;
          retry_count: number;
        };
        Insert: {
          id?: string;
          session_id: string;
          status?: "pending" | "running" | "done" | "failed";
          include_recording?: boolean;
          reconstructed_text?: string | null;
          summary?: string | null;
          key_decisions?: Json | null;
          action_items?: Json | null;
          important_numbers?: Json | null;
          requested_at?: string;
          completed_at?: string | null;
          error_message?: string | null;
          retry_count?: number;
        };
        Update: {
          status?: "pending" | "running" | "done" | "failed";
          reconstructed_text?: string | null;
          summary?: string | null;
          key_decisions?: Json | null;
          action_items?: Json | null;
          important_numbers?: Json | null;
          completed_at?: string | null;
          error_message?: string | null;
          retry_count?: number;
        };
        Relationships: [];
      };
    };
    Views: {};
    Functions: {};
    Enums: {};
    CompositeTypes: {};
  };
}
