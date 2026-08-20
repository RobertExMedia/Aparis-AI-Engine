// SOURCE: synced from aparis-ai-hub/src/integrations/supabase/types.ts
// Conversations/messages match hub migration 20260730101432_….

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      agents: {
        Row: {
          archived_at: string | null
          avatar_url: string | null
          created_at: string
          created_by: string | null
          description: string | null
          fallback_message: string
          greeting: string
          id: string
          language: string
          max_tokens: number
          name: string
          public_id: string
          published_at: string | null
          settings: Json
          status: Database["public"]["Enums"]["agent_status"]
          system_prompt: string
          temperature: number
          tone: Database["public"]["Enums"]["agent_tone"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          archived_at?: string | null
          avatar_url?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          fallback_message?: string
          greeting?: string
          id?: string
          language?: string
          max_tokens?: number
          name: string
          public_id?: string
          published_at?: string | null
          settings?: Json
          status?: Database["public"]["Enums"]["agent_status"]
          system_prompt?: string
          temperature?: number
          tone?: Database["public"]["Enums"]["agent_tone"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          archived_at?: string | null
          avatar_url?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          fallback_message?: string
          greeting?: string
          id?: string
          language?: string
          max_tokens?: number
          name?: string
          public_id?: string
          published_at?: string | null
          settings?: Json
          status?: Database["public"]["Enums"]["agent_status"]
          system_prompt?: string
          temperature?: number
          tone?: Database["public"]["Enums"]["agent_tone"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "agents_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          code: string
          created_at: string
          currency: string
          description: string | null
          features: Json
          is_public: boolean
          limits: Json
          name: string
          price_monthly: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          currency?: string
          description?: string | null
          features?: Json
          is_public?: boolean
          limits?: Json
          name: string
          price_monthly?: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          currency?: string
          description?: string | null
          features?: Json
          is_public?: boolean
          limits?: Json
          name?: string
          price_monthly?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          company_name: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          intended_use: string | null
          onboarding_completed: boolean
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          company_name?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          intended_use?: string | null
          onboarding_completed?: boolean
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          company_name?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          intended_use?: string | null
          onboarding_completed?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string
          current_period_start: string
          id: string
          plan_code: string
          provider: string
          provider_customer_id: string | null
          provider_subscription_id: string | null
          status: Database["public"]["Enums"]["subscription_status"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string
          current_period_start?: string
          id?: string
          plan_code: string
          provider?: string
          provider_customer_id?: string | null
          provider_subscription_id?: string | null
          status?: Database["public"]["Enums"]["subscription_status"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string
          current_period_start?: string
          id?: string
          plan_code?: string
          provider?: string
          provider_customer_id?: string | null
          provider_subscription_id?: string | null
          status?: Database["public"]["Enums"]["subscription_status"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_plan_code_fkey"
            columns: ["plan_code"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "subscriptions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      workspace_invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["workspace_role"]
          status: Database["public"]["Enums"]["invitation_status"]
          token: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["workspace_role"]
          status?: Database["public"]["Enums"]["invitation_status"]
          token?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["workspace_role"]
          status?: Database["public"]["Enums"]["invitation_status"]
          token?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_invitations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["workspace_role"]
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["workspace_role"]
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["workspace_role"]
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          agent_id: string
          channel: string
          created_at: string
          id: string
          last_message_at: string
          started_by: string | null
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          agent_id: string
          channel?: string
          created_at?: string
          id?: string
          last_message_at?: string
          started_by?: string | null
          title?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          agent_id?: string
          channel?: string
          created_at?: string
          id?: string
          last_message_at?: string
          started_by?: string | null
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          is_error: boolean
          role: Database["public"]["Enums"]["message_role"]
          token_count: number | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          content?: string
          conversation_id: string
          created_at?: string
          id?: string
          is_error?: boolean
          role: Database["public"]["Enums"]["message_role"]
          token_count?: number | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          is_error?: boolean
          role?: Database["public"]["Enums"]["message_role"]
          token_count?: number | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_messages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          logo_url: string | null
          name: string
          owner_id: string
          plan_code: string
          settings: Json
          slug: string
          status: Database["public"]["Enums"]["workspace_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          logo_url?: string | null
          name: string
          owner_id: string
          plan_code?: string
          settings?: Json
          slug: string
          status?: Database["public"]["Enums"]["workspace_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          owner_id?: string
          plan_code?: string
          settings?: Json
          slug?: string
          status?: Database["public"]["Enums"]["workspace_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspaces_plan_code_fkey"
            columns: ["plan_code"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["code"]
          },
        ]
      }
      agent_domains: {
        Row: {
          id: string
          workspace_id: string
          agent_id: string
          domain: string
          status: string
          verified_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          agent_id: string
          domain: string
          status?: string
          verified_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          agent_id?: string
          domain?: string
          status?: string
          verified_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      widget_keys: {
        Row: {
          id: string
          workspace_id: string
          agent_id: string
          name: string
          key_hash: string
          key_prefix: string
          is_active: boolean
          last_used_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          agent_id: string
          name?: string
          key_hash: string
          key_prefix: string
          is_active?: boolean
          last_used_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          agent_id?: string
          name?: string
          key_hash?: string
          key_prefix?: string
          is_active?: boolean
          last_used_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      workspace_credits: {
        Row: {
          workspace_id: string
          monthly_credits: number | null
          used_credits: number
          remaining_credits: number | null
          reset_date: string
          created_at: string
          updated_at: string
        }
        Insert: {
          workspace_id: string
          monthly_credits?: number | null
          used_credits?: number
          remaining_credits?: number | null
          reset_date: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          workspace_id?: string
          monthly_credits?: number | null
          used_credits?: number
          remaining_credits?: number | null
          reset_date?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_credits_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_events: {
        Row: {
          id: string
          workspace_id: string
          user_id: string | null
          agent_id: string | null
          conversation_id: string | null
          request_id: string | null
          endpoint: string
          model: string | null
          prompt_tokens: number
          completion_tokens: number
          total_tokens: number
          credits_charged: number
          status: string
          metadata: Json
          created_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          user_id?: string | null
          agent_id?: string | null
          conversation_id?: string | null
          request_id?: string | null
          endpoint?: string
          model?: string | null
          prompt_tokens?: number
          completion_tokens?: number
          total_tokens?: number
          credits_charged?: number
          status?: string
          metadata?: Json
          created_at?: string
        }
        Update: {
          id?: string
          workspace_id?: string
          user_id?: string | null
          agent_id?: string | null
          conversation_id?: string | null
          request_id?: string | null
          endpoint?: string
          model?: string | null
          prompt_tokens?: number
          completion_tokens?: number
          total_tokens?: number
          credits_charged?: number
          status?: string
          metadata?: Json
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_workspace: {
        Args: { _name: string; _slug?: string }
        Returns: {
          created_at: string
          deleted_at: string | null
          id: string
          logo_url: string | null
          name: string
          owner_id: string
          plan_code: string
          settings: Json
          slug: string
          status: Database["public"]["Enums"]["workspace_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "workspaces"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_workspace_credits: {
        Args: { _workspace_id: string }
        Returns: Json
      }
      consume_workspace_credits: {
        Args: {
          _workspace_id: string
          _credits: number
          _prompt_tokens?: number
          _completion_tokens?: number
          _endpoint?: string
          _request_id?: string
          _agent_id?: string
          _conversation_id?: string
          _model?: string
          _status?: string
          _metadata?: Json
        }
        Returns: Json
      }
      match_knowledge_chunks: {
        Args: {
          query_embedding: string
          match_workspace_id: string
          match_agent_id: string
          match_count?: number
          match_threshold?: number
        }
        Returns: {
          id: string
          knowledge_source_id: string
          knowledge_file_id: string | null
          content: string
          metadata: Json
          source_page: number | null
          similarity: number
          source_name: string
          file_name: string | null
          source_url: string | null
          priority: number
          required: boolean
          token_count: number | null
        }[]
      }
      current_user_can_edit_workspace: {
        Args: { _workspace_id: string }
        Returns: boolean
      }
      current_user_is_super_admin: { Args: never; Returns: boolean }
      current_user_is_workspace_admin: {
        Args: { _workspace_id: string }
        Returns: boolean
      }
      current_user_is_workspace_member: {
        Args: { _workspace_id: string }
        Returns: boolean
      }
      current_user_is_workspace_owner: {
        Args: { _workspace_id: string }
        Returns: boolean
      }
      current_user_workspace_role: {
        Args: { _workspace_id: string }
        Returns: Database["public"]["Enums"]["workspace_role"]
      }
      generate_agent_public_id: { Args: never; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      agent_status: "draft" | "published" | "archived"
      agent_tone:
        | "professional"
        | "friendly"
        | "concise"
        | "enthusiastic"
        | "empathetic"
        | "technical"
      app_role: "super_admin"
      invitation_status: "pending" | "accepted" | "expired" | "revoked"
      message_role: "user" | "assistant" | "system"
      subscription_status: "trialing" | "active" | "past_due" | "cancelled"
      workspace_role: "owner" | "admin" | "editor" | "viewer"
      workspace_status: "trial" | "active" | "suspended" | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      agent_status: ["draft", "published", "archived"],
      agent_tone: [
        "professional",
        "friendly",
        "concise",
        "enthusiastic",
        "empathetic",
        "technical",
      ],
      app_role: ["super_admin"],
      invitation_status: ["pending", "accepted", "expired", "revoked"],
      message_role: ["user", "assistant", "system"],
      subscription_status: ["trialing", "active", "past_due", "cancelled"],
      workspace_role: ["owner", "admin", "editor", "viewer"],
      workspace_status: ["trial", "active", "suspended", "cancelled"],
    },
  },
} as const
