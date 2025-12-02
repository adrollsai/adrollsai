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
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      assets: {
        Row: {
          created_at: string
          id: string
          status: string | null
          type: string | null
          url: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          status?: string | null
          type?: string | null
          url?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          status?: string | null
          type?: string | null
          url?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      automations: {
        Row: {
          created_at: string
          description: string | null
          icon_name: string | null
          id: string
          is_active: boolean | null
          stats: string | null
          title: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          icon_name?: string | null
          id?: string
          is_active?: boolean | null
          stats?: string | null
          title: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          icon_name?: string | null
          id?: string
          is_active?: boolean | null
          stats?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "automations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_drafts: {
        Row: {
          caption: string | null
          created_at: string
          id: string
          image_url: string
          status: string | null
          user_id: string
        }
        Insert: {
          caption?: string | null
          created_at?: string
          id?: string
          image_url: string
          status?: string | null
          user_id: string
        }
        Update: {
          caption?: string | null
          created_at?: string
          id?: string
          image_url?: string
          status?: string | null
          user_id?: string
        }
        Relationships: []
      }
      deal_requirements: {
        Row: {
          budget_range: string | null
          created_at: string
          description: string | null
          id: string
          location: string
          property_type: string
          status: string
          title: string
          urgency: string | null
          user_id: string
        }
        Insert: {
          budget_range?: string | null
          created_at?: string
          description?: string | null
          id?: string
          location: string
          property_type: string
          status?: string
          title: string
          urgency?: string | null
          user_id: string
        }
        Update: {
          budget_range?: string | null
          created_at?: string
          description?: string | null
          id?: string
          location?: string
          property_type?: string
          status?: string
          title?: string
          urgency?: string | null
          user_id?: string
        }
        Relationships: []
      }
      external_listings: {
        Row: {
          confidence_score: number | null
          contact_info: Json | null
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          is_claimed: boolean | null
          location: string | null
          price: string | null
          property_type: string | null
          requirement_id: string | null
          source_platform: string
          source_url: string
          title: string
        }
        Insert: {
          confidence_score?: number | null
          contact_info?: Json | null
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_claimed?: boolean | null
          location?: string | null
          price?: string | null
          property_type?: string | null
          requirement_id?: string | null
          source_platform: string
          source_url: string
          title: string
        }
        Update: {
          confidence_score?: number | null
          contact_info?: Json | null
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_claimed?: boolean | null
          location?: string | null
          price?: string | null
          property_type?: string | null
          requirement_id?: string | null
          source_platform?: string
          source_url?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "external_listings_requirement_id_fkey"
            columns: ["requirement_id"]
            isOneToOne: false
            referencedRelation: "deal_requirements"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          content: string | null
          created_at: string | null
          excerpt: string | null
          id: string
          image_url: string | null
          status: string | null
          tags: string[] | null
          title: string
          user_id: string
        }
        Insert: {
          content?: string | null
          created_at?: string | null
          excerpt?: string | null
          id?: string
          image_url?: string | null
          status?: string | null
          tags?: string[] | null
          title: string
          user_id: string
        }
        Update: {
          content?: string | null
          created_at?: string | null
          excerpt?: string | null
          id?: string
          image_url?: string | null
          status?: string | null
          tags?: string[] | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          brand_color: string | null
          business_name: string | null
          contact_number: string | null
          created_at: string
          email: string | null
          facebook_token: string | null
          facebook_url: string | null
          google_business_location_id: string | null
          google_business_refresh_token: string | null
          google_business_token: string | null
          id: string
          instagram_url: string | null
          linkedin_token: string | null
          linkedin_url: string | null
          linkedin_urn: string | null
          logo_url: string | null
          mission_statement: string | null
          selected_page_id: string | null
          selected_page_name: string | null
          selected_page_token: string | null
          youtube_refresh_token: string | null
          youtube_token: string | null
          youtube_url: string | null
        }
        Insert: {
          brand_color?: string | null
          business_name?: string | null
          contact_number?: string | null
          created_at?: string
          email?: string | null
          facebook_token?: string | null
          facebook_url?: string | null
          google_business_location_id?: string | null
          google_business_refresh_token?: string | null
          google_business_token?: string | null
          id: string
          instagram_url?: string | null
          linkedin_token?: string | null
          linkedin_url?: string | null
          linkedin_urn?: string | null
          logo_url?: string | null
          mission_statement?: string | null
          selected_page_id?: string | null
          selected_page_name?: string | null
          selected_page_token?: string | null
          youtube_refresh_token?: string | null
          youtube_token?: string | null
          youtube_url?: string | null
        }
        Update: {
          brand_color?: string | null
          business_name?: string | null
          contact_number?: string | null
          created_at?: string
          email?: string | null
          facebook_token?: string | null
          facebook_url?: string | null
          google_business_location_id?: string | null
          google_business_refresh_token?: string | null
          google_business_token?: string | null
          id?: string
          instagram_url?: string | null
          linkedin_token?: string | null
          linkedin_url?: string | null
          linkedin_urn?: string | null
          logo_url?: string | null
          mission_statement?: string | null
          selected_page_id?: string | null
          selected_page_name?: string | null
          selected_page_token?: string | null
          youtube_refresh_token?: string | null
          youtube_token?: string | null
          youtube_url?: string | null
        }
        Relationships: []
      }
      properties: {
        Row: {
          address: string
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          images: string[] | null
          price: string | null
          property_type: string | null
          status: string | null
          title: string | null
          user_id: string
        }
        Insert: {
          address: string
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          images?: string[] | null
          price?: string | null
          property_type?: string | null
          status?: string | null
          title?: string | null
          user_id: string
        }
        Update: {
          address?: string
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          images?: string[] | null
          price?: string | null
          property_type?: string | null
          status?: string | null
          title?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "properties_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_agent_properties: {
        Args: { agent_id: string }
        Returns: {
          address: string
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          images: string[] | null
          price: string | null
          property_type: string | null
          status: string | null
          title: string | null
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "properties"
          isOneToOne: false
          isSetofReturn: true
        }
      }
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
    Enums: {},
  },
} as const
