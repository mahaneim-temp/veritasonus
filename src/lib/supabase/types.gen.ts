// Supabase Database 타입 — `supabase/schema.sql` 에서 수동 작성.
// `supabase gen types typescript --linked` 를 사용할 수 있게 되면 그 결과로 교체.
// 컬럼 변경 시 이 파일과 `supabase/schema.sql` 을 같은 커밋에서 동기화.

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
      users: {
        Row: {
          id: string;
          email: string;
          role: Database["public"]["Enums"]["user_role"];
          locale: string;
          display_name: string | null;
          stripe_customer_id: string | null;
          billing_status: string | null;
          created_at: string;
          marketing_opt_in: boolean;
          marketing_opt_in_at: string | null;
          marketing_opt_out_at: string | null;
        };
        Insert: {
          id: string;
          email: string;
          role?: Database["public"]["Enums"]["user_role"];
          locale?: string;
          display_name?: string | null;
          stripe_customer_id?: string | null;
          billing_status?: string | null;
          created_at?: string;
          marketing_opt_in?: boolean;
          marketing_opt_in_at?: string | null;
          marketing_opt_out_at?: string | null;
        };
        Update: {
          id?: string;
          email?: string;
          role?: Database["public"]["Enums"]["user_role"];
          locale?: string;
          display_name?: string | null;
          stripe_customer_id?: string | null;
          billing_status?: string | null;
          created_at?: string;
          marketing_opt_in?: boolean;
          marketing_opt_in_at?: string | null;
          marketing_opt_out_at?: string | null;
        };
        Relationships: [];
      };
      guest_sessions: {
        Row: {
          id: string;
          invite_code: string | null;
          ip_hash: string;
          user_agent: string | null;
          started_at: string;
          expires_at: string;
          consumed_seconds: number;
          mode: string;
        };
        Insert: {
          id?: string;
          invite_code?: string | null;
          ip_hash: string;
          user_agent?: string | null;
          started_at?: string;
          expires_at: string;
          consumed_seconds?: number;
          mode?: string;
        };
        Update: {
          id?: string;
          invite_code?: string | null;
          ip_hash?: string;
          user_agent?: string | null;
          started_at?: string;
          expires_at?: string;
          consumed_seconds?: number;
          mode?: string;
        };
        Relationships: [];
      };
      sessions: {
        Row: {
          id: string;
          owner_type: Database["public"]["Enums"]["owner_type"];
          owner_id: string;
          mode: Database["public"]["Enums"]["session_mode"];
          state: Database["public"]["Enums"]["session_state"];
          source_lang: string;
          target_lang: string;
          quality_mode: Database["public"]["Enums"]["quality_mode"];
          topic_guess: string | null;
          audience: string | null;
          context_note: string | null;
          recording_enabled: boolean;
          started_at: string | null;
          ended_at: string | null;
          speech_active_seconds: number;
          created_at: string;
          metadata: Json;
        };
        Insert: {
          id?: string;
          owner_type: Database["public"]["Enums"]["owner_type"];
          owner_id: string;
          mode: Database["public"]["Enums"]["session_mode"];
          state?: Database["public"]["Enums"]["session_state"];
          source_lang: string;
          target_lang: string;
          quality_mode?: Database["public"]["Enums"]["quality_mode"];
          topic_guess?: string | null;
          audience?: string | null;
          context_note?: string | null;
          recording_enabled?: boolean;
          started_at?: string | null;
          ended_at?: string | null;
          speech_active_seconds?: number;
          created_at?: string;
          metadata?: Json;
        };
        Update: {
          id?: string;
          owner_type?: Database["public"]["Enums"]["owner_type"];
          owner_id?: string;
          mode?: Database["public"]["Enums"]["session_mode"];
          state?: Database["public"]["Enums"]["session_state"];
          source_lang?: string;
          target_lang?: string;
          quality_mode?: Database["public"]["Enums"]["quality_mode"];
          topic_guess?: string | null;
          audience?: string | null;
          context_note?: string | null;
          recording_enabled?: boolean;
          started_at?: string | null;
          ended_at?: string | null;
          speech_active_seconds?: number;
          created_at?: string;
          metadata?: Json;
        };
        Relationships: [];
      };
      session_assets: {
        Row: {
          id: string;
          session_id: string;
          asset_type: Database["public"]["Enums"]["asset_type"];
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
          asset_type: Database["public"]["Enums"]["asset_type"];
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
          id?: string;
          session_id?: string;
          asset_type?: Database["public"]["Enums"]["asset_type"];
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
          confidence_level: Database["public"]["Enums"]["confidence_level"];
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
          confidence_level?: Database["public"]["Enums"]["confidence_level"];
          confidence_score?: number | null;
          requires_review?: boolean;
          flags?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          session_id?: string;
          seq?: number;
          speaker_label?: string | null;
          started_at_ms?: number | null;
          ended_at_ms?: number | null;
          source_text?: string;
          corrected_text?: string | null;
          translated_text?: string | null;
          confidence_level?: Database["public"]["Enums"]["confidence_level"];
          confidence_score?: number | null;
          requires_review?: boolean;
          flags?: Json;
          created_at?: string;
        };
        Relationships: [];
      };
      reconstructions: {
        Row: {
          id: string;
          session_id: string;
          status: Database["public"]["Enums"]["recon_status"];
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
          status?: Database["public"]["Enums"]["recon_status"];
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
          id?: string;
          session_id?: string;
          status?: Database["public"]["Enums"]["recon_status"];
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
        Relationships: [];
      };
      billing_events: {
        Row: {
          id: string;
          user_id: string | null;
          session_id: string | null;
          event: Database["public"]["Enums"]["billing_event"] | null;
          event_type: string | null;
          payload: Json | null;
          plan: string | null;
          usage_seconds: number | null;
          amount_cents: number | null;
          currency: string;
          provider: string;
          provider_event_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          session_id?: string | null;
          event?: Database["public"]["Enums"]["billing_event"] | null;
          event_type?: string | null;
          payload?: Json | null;
          plan?: string | null;
          usage_seconds?: number | null;
          amount_cents?: number | null;
          currency?: string;
          provider?: string;
          provider_event_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          session_id?: string | null;
          event?: Database["public"]["Enums"]["billing_event"] | null;
          event_type?: string | null;
          payload?: Json | null;
          plan?: string | null;
          usage_seconds?: number | null;
          amount_cents?: number | null;
          currency?: string;
          provider?: string;
          provider_event_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      quality_events: {
        Row: {
          id: string;
          session_id: string | null;
          event_type: string;
          payload: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          session_id?: string | null;
          event_type: string;
          payload?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          session_id?: string | null;
          event_type?: string;
          payload?: Json;
          created_at?: string;
        };
        Relationships: [];
      };
      consent_logs: {
        Row: {
          id: string;
          actor_type: string;
          actor_id: string;
          session_id: string | null;
          kind: string;
          version: string | null;
          ip_hash: string | null;
          user_agent: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          actor_type: string;
          actor_id: string;
          session_id?: string | null;
          kind: string;
          version?: string | null;
          ip_hash?: string | null;
          user_agent?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          actor_type?: string;
          actor_id?: string;
          session_id?: string | null;
          kind?: string;
          version?: string | null;
          ip_hash?: string | null;
          user_agent?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      usage_monthly: {
        Row: {
          user_id: string;
          yyyymm: string;
          seconds_used: number;
          last_warned_at: string | null;
        };
        Insert: {
          user_id: string;
          yyyymm: string;
          seconds_used?: number;
          last_warned_at?: string | null;
        };
        Update: {
          seconds_used?: number;
          last_warned_at?: string | null;
        };
        Relationships: [];
      };
      audit_log: {
        Row: {
          id: string;
          actor_id: string | null;
          action: string;
          target_type: string;
          target_id: string | null;
          payload: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          actor_id?: string | null;
          action: string;
          target_type: string;
          target_id?: string | null;
          payload?: Json;
          created_at?: string;
        };
        Update: {
          id?: string;
          actor_id?: string | null;
          action?: string;
          target_type?: string;
          target_id?: string | null;
          payload?: Json;
          created_at?: string;
        };
        Relationships: [];
      };
      user_wallet: {
        Row: {
          user_id: string;
          free_seconds_remaining: number;
          free_reset_yyyymm: string;
          purchased_seconds: number;
          granted_seconds: number;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          free_seconds_remaining?: number;
          free_reset_yyyymm?: string;
          purchased_seconds?: number;
          granted_seconds?: number;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          free_seconds_remaining?: number;
          free_reset_yyyymm?: string;
          purchased_seconds?: number;
          granted_seconds?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      user_preferences: {
        Row: {
          user_id: string;
          primary_purpose: string[];
          domain_tags: string[];
          default_source_lang: string | null;
          default_target_lang: string | null;
          preferred_mode: Database["public"]["Enums"]["session_mode"] | null;
          default_quality_mode: Database["public"]["Enums"]["quality_mode"];
          wants_term_registration: boolean;
          onboarding_completed_at: string | null;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          primary_purpose?: string[];
          domain_tags?: string[];
          default_source_lang?: string | null;
          default_target_lang?: string | null;
          preferred_mode?: Database["public"]["Enums"]["session_mode"] | null;
          default_quality_mode?: Database["public"]["Enums"]["quality_mode"];
          wants_term_registration?: boolean;
          onboarding_completed_at?: string | null;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          primary_purpose?: string[];
          domain_tags?: string[];
          default_source_lang?: string | null;
          default_target_lang?: string | null;
          preferred_mode?: Database["public"]["Enums"]["session_mode"] | null;
          default_quality_mode?: Database["public"]["Enums"]["quality_mode"];
          wants_term_registration?: boolean;
          onboarding_completed_at?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      user_terms: {
        Row: {
          id: string;
          user_id: string;
          source_text: string;
          target_text: string;
          lang_pair: string;
          domain_tag: string | null;
          note: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          source_text: string;
          target_text: string;
          lang_pair: string;
          domain_tag?: string | null;
          note?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          source_text?: string;
          target_text?: string;
          lang_pair?: string;
          domain_tag?: string | null;
          note?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      credit_packs_ledger: {
        Row: {
          id: string;
          user_id: string;
          pack_id: string;
          base_seconds: number;
          bonus_seconds: number;
          carried_free_seconds: number;
          price_krw: number;
          payment_provider: string;
          provider_event_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          pack_id: string;
          base_seconds: number;
          bonus_seconds: number;
          carried_free_seconds?: number;
          price_krw: number;
          payment_provider?: string;
          provider_event_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          pack_id?: string;
          base_seconds?: number;
          bonus_seconds?: number;
          carried_free_seconds?: number;
          price_krw?: number;
          payment_provider?: string;
          provider_event_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {};
    Functions: {
      is_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
    };
    Enums: {
      user_role: "guest" | "member" | "paid" | "unlimited" | "admin" | "superadmin";
      session_mode:
        | "interactive_interpretation"
        | "listener_live"
        | "listener_live_recorded"
        | "assist_interpretation"
        | "conversation_learning";
      quality_mode: "standard" | "premium" | "auto";
      confidence_level: "high" | "medium" | "low";
      asset_type:
        | "script"
        | "slides"
        | "glossary"
        | "sermon_note"
        | "speaker_profile";
      recon_status: "pending" | "running" | "done" | "failed";
      session_state:
        | "idle"
        | "preflight"
        | "prepared"
        | "live"
        | "paused"
        | "ended"
        | "post_reconstructing"
        | "completed";
      owner_type: "member" | "guest";
      billing_event:
        | "subscription_created"
        | "subscription_renewed"
        | "subscription_canceled"
        | "one_time_payment"
        | "refund"
        | "usage_meter";
    };
    CompositeTypes: {};
  };
}
