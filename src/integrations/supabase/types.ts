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
      accounts: {
        Row: {
          ban_reason: string | null
          banned: boolean
          banned_at: string | null
          created_at: string
          email: string
          email_lower: string
          id: string
          last_login_at: string | null
          last_login_ip: string | null
          nick: string
          nick_lower: string
          password: string
          registration_ip: string | null
          role: Database["public"]["Enums"]["account_role"]
          updated_at: string
        }
        Insert: {
          ban_reason?: string | null
          banned?: boolean
          banned_at?: string | null
          created_at?: string
          email: string
          email_lower: string
          id?: string
          last_login_at?: string | null
          last_login_ip?: string | null
          nick: string
          nick_lower: string
          password: string
          registration_ip?: string | null
          role?: Database["public"]["Enums"]["account_role"]
          updated_at?: string
        }
        Update: {
          ban_reason?: string | null
          banned?: boolean
          banned_at?: string | null
          created_at?: string
          email?: string
          email_lower?: string
          id?: string
          last_login_at?: string | null
          last_login_ip?: string | null
          nick?: string
          nick_lower?: string
          password?: string
          registration_ip?: string | null
          role?: Database["public"]["Enums"]["account_role"]
          updated_at?: string
        }
        Relationships: []
      }
      login_logs: {
        Row: {
          account_id: string | null
          created_at: string
          failure_reason: string | null
          id: number
          ip: string | null
          nick_attempted: string | null
          success: boolean
          user_agent: string | null
        }
        Insert: {
          account_id?: string | null
          created_at?: string
          failure_reason?: string | null
          id?: number
          ip?: string | null
          nick_attempted?: string | null
          success: boolean
          user_agent?: string | null
        }
        Update: {
          account_id?: string | null
          created_at?: string
          failure_reason?: string | null
          id?: number
          ip?: string | null
          nick_attempted?: string | null
          success?: boolean
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "login_logs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      registration_attempts: {
        Row: {
          created_at: string
          id: number
          ip: string
        }
        Insert: {
          created_at?: string
          id?: number
          ip: string
        }
        Update: {
          created_at?: string
          id?: number
          ip?: string
        }
        Relationships: []
      }
      sessions: {
        Row: {
          account_id: string
          created_at: string
          expires_at: string
          id: string
          ip: string | null
          token: string
          user_agent: string | null
        }
        Insert: {
          account_id: string
          created_at?: string
          expires_at: string
          id?: string
          ip?: string | null
          token: string
          user_agent?: string | null
        }
        Update: {
          account_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          ip?: string | null
          token?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sessions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          created_at: string
          discord_email: string | null
          first_ip: string | null
          id: number
          last_ip: string | null
          name: string
          name_lower: string | null
          password: string | null
          premium: boolean | null
          raw: Json | null
        }
        Insert: {
          created_at?: string
          discord_email?: string | null
          first_ip?: string | null
          id?: number
          last_ip?: string | null
          name: string
          name_lower?: string | null
          password?: string | null
          premium?: boolean | null
          raw?: Json | null
        }
        Update: {
          created_at?: string
          discord_email?: string | null
          first_ip?: string | null
          id?: number
          last_ip?: string | null
          name?: string
          name_lower?: string | null
          password?: string | null
          premium?: boolean | null
          raw?: Json | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      account_role: "user" | "admin"
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
      account_role: ["user", "admin"],
    },
  },
} as const
