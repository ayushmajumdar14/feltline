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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      actions: {
        Row: {
          action: string
          actor: string
          amount: number | null
          facing: string
          hand_id: string
          id: string
          seq: number
          street: string
          user_id: string
        }
        Insert: {
          action: string
          actor: string
          amount?: number | null
          facing?: string
          hand_id: string
          id?: string
          seq: number
          street: string
          user_id?: string
        }
        Update: {
          action?: string
          actor?: string
          amount?: number | null
          facing?: string
          hand_id?: string
          id?: string
          seq?: number
          street?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "actions_hand_id_fkey"
            columns: ["hand_id"]
            isOneToOne: false
            referencedRelation: "hands"
            referencedColumns: ["id"]
          },
        ]
      }
      hand_players: {
        Row: {
          hand_id: string
          id: string
          opponent_id: string
          seat: number
          stack: number
          user_id: string
          won: number
        }
        Insert: {
          hand_id: string
          id?: string
          opponent_id: string
          seat: number
          stack?: number
          user_id?: string
          won?: number
        }
        Update: {
          hand_id?: string
          id?: string
          opponent_id?: string
          seat?: number
          stack?: number
          user_id?: string
          won?: number
        }
        Relationships: [
          {
            foreignKeyName: "hand_players_hand_id_fkey"
            columns: ["hand_id"]
            isOneToOne: false
            referencedRelation: "hands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hand_players_opponent_id_fkey"
            columns: ["opponent_id"]
            isOneToOne: false
            referencedRelation: "opponents"
            referencedColumns: ["id"]
          },
        ]
      }
      hands: {
        Row: {
          board: string[]
          hand_number: number
          id: string
          raw: Json
          started_at: string
          table_id: string
          user_id: string
        }
        Insert: {
          board?: string[]
          hand_number: number
          id?: string
          raw?: Json
          started_at?: string
          table_id: string
          user_id?: string
        }
        Update: {
          board?: string[]
          hand_number?: number
          id?: string
          raw?: Json
          started_at?: string
          table_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hands_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
        ]
      }
      opponents: {
        Row: {
          display_name: string
          first_seen: string
          id: string
          is_account: boolean
          last_seen: string
          notes: string
          player_id: string
          user_id: string
        }
        Insert: {
          display_name: string
          first_seen?: string
          id?: string
          is_account?: boolean
          last_seen?: string
          notes?: string
          player_id: string
          user_id?: string
        }
        Update: {
          display_name?: string
          first_seen?: string
          id?: string
          is_account?: boolean
          last_seen?: string
          notes?: string
          player_id?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          bio: string
          created_at: string
          display_name: string | null
          id: string
          pokernow_id: string | null
        }
        Insert: {
          bio?: string
          created_at?: string
          display_name?: string | null
          id: string
          pokernow_id?: string | null
        }
        Update: {
          bio?: string
          created_at?: string
          display_name?: string | null
          id?: string
          pokernow_id?: string | null
        }
        Relationships: []
      }
      settings: {
        Row: {
          autoplay_confirmed_at: string | null
          big_blind: number
          buy_in: number
          default_mode: string
          extension_connected: boolean
          nickname: string
          small_blind: number
          strategy: string
          updated_at: string
          user_id: string
        }
        Insert: {
          autoplay_confirmed_at?: string | null
          big_blind?: number
          buy_in?: number
          default_mode?: string
          extension_connected?: boolean
          nickname?: string
          small_blind?: number
          strategy?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          autoplay_confirmed_at?: string | null
          big_blind?: number
          buy_in?: number
          default_mode?: string
          extension_connected?: boolean
          nickname?: string
          small_blind?: number
          strategy?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      showdowns: {
        Row: {
          cards: string[]
          hand_id: string
          id: string
          opponent_id: string
          user_id: string
        }
        Insert: {
          cards: string[]
          hand_id: string
          id?: string
          opponent_id: string
          user_id?: string
        }
        Update: {
          cards?: string[]
          hand_id?: string
          id?: string
          opponent_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "showdowns_hand_id_fkey"
            columns: ["hand_id"]
            isOneToOne: false
            referencedRelation: "hands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "showdowns_opponent_id_fkey"
            columns: ["opponent_id"]
            isOneToOne: false
            referencedRelation: "opponents"
            referencedColumns: ["id"]
          },
        ]
      }
      suggestions: {
        Row: {
          accepted: string
          actual_action: string | null
          actual_size: number | null
          confidence: number
          created_at: string
          hand_id: string | null
          id: string
          reason: string
          size: number | null
          street: string
          suggested_action: string
          table_id: string
          user_id: string
        }
        Insert: {
          accepted?: string
          actual_action?: string | null
          actual_size?: number | null
          confidence: number
          created_at?: string
          hand_id?: string | null
          id?: string
          reason: string
          size?: number | null
          street: string
          suggested_action: string
          table_id: string
          user_id?: string
        }
        Update: {
          accepted?: string
          actual_action?: string | null
          actual_size?: number | null
          confidence?: number
          created_at?: string
          hand_id?: string | null
          id?: string
          reason?: string
          size?: number | null
          street?: string
          suggested_action?: string
          table_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "suggestions_hand_id_fkey"
            columns: ["hand_id"]
            isOneToOne: false
            referencedRelation: "hands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suggestions_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "tables"
            referencedColumns: ["id"]
          },
        ]
      }
      tables: {
        Row: {
          created_at: string
          game_id: string | null
          id: string
          is_demo: boolean
          last_seen_at: string | null
          nickname: string | null
          pokernow_url: string
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          game_id?: string | null
          id?: string
          is_demo?: boolean
          last_seen_at?: string | null
          nickname?: string | null
          pokernow_url: string
          status?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          game_id?: string | null
          id?: string
          is_demo?: boolean
          last_seen_at?: string | null
          nickname?: string | null
          pokernow_url?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      reset_demo_workspace: { Args: never; Returns: undefined }
      seed_demo_workspace: { Args: { _uid: string }; Returns: undefined }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
