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
          master_creative_id: string | null
          property_id: string | null
          share_stats: Json | null
          status: string | null
          type: string | null
          url: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          master_creative_id?: string | null
          property_id?: string | null
          share_stats?: Json | null
          status?: string | null
          type?: string | null
          url: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          master_creative_id?: string | null
          property_id?: string | null
          share_stats?: Json | null
          status?: string | null
          type?: string | null
          url?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assets_master_creative_id_fkey"
            columns: ["master_creative_id"]
            isOneToOne: false
            referencedRelation: "master_creatives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
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
          user_id: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          icon_name?: string | null
          id?: string
          is_active?: boolean | null
          stats?: string | null
          title: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          icon_name?: string | null
          id?: string
          is_active?: boolean | null
          stats?: string | null
          title?: string
          user_id?: string | null
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
      leads: {
        Row: {
          ad_name: string | null
          created_at: string
          email: string | null
          external_id: string | null
          facebook_lead_id: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          pipeline_stage: string | null
          source: string | null
          status: string | null
          summary: string | null
          user_id: string | null
          value: number | null
        }
        Insert: {
          ad_name?: string | null
          created_at?: string
          email?: string | null
          external_id?: string | null
          facebook_lead_id?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          pipeline_stage?: string | null
          source?: string | null
          status?: string | null
          summary?: string | null
          user_id?: string | null
          value?: number | null
        }
        Update: {
          ad_name?: string | null
          created_at?: string
          email?: string | null
          external_id?: string | null
          facebook_lead_id?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          pipeline_stage?: string | null
          source?: string | null
          status?: string | null
          summary?: string | null
          user_id?: string | null
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      master_creatives: {
        Row: {
          caption_template: string | null
          created_at: string
          id: string
          is_active: boolean | null
          property_id: string
          type: string | null
          url: string
        }
        Insert: {
          caption_template?: string | null
          created_at?: string
          id?: string
          is_active?: boolean | null
          property_id: string
          type?: string | null
          url: string
        }
        Update: {
          caption_template?: string | null
          created_at?: string
          id?: string
          is_active?: boolean | null
          property_id?: string
          type?: string | null
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "master_creatives_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string | null
          id: string
          organization_id: string | null
          role: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          organization_id?: string | null
          role?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          organization_id?: string | null
          role?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          brand_color: string | null
          created_at: string
          custom_domain: string | null
          id: string
          master_logo_url: string | null
          name: string
        }
        Insert: {
          brand_color?: string | null
          created_at?: string
          custom_domain?: string | null
          id?: string
          master_logo_url?: string | null
          name: string
        }
        Update: {
          brand_color?: string | null
          created_at?: string
          custom_domain?: string | null
          id?: string
          master_logo_url?: string | null
          name?: string
        }
        Relationships: []
      }
      posts: {
        Row: {
          content: string | null
          created_at: string
          excerpt: string | null
          id: string
          image_url: string | null
          status: string | null
          tags: string[] | null
          title: string | null
          user_id: string | null
        }
        Insert: {
          content?: string | null
          created_at?: string
          excerpt?: string | null
          id?: string
          image_url?: string | null
          status?: string | null
          tags?: string[] | null
          title?: string | null
          user_id?: string | null
        }
        Update: {
          content?: string | null
          created_at?: string
          excerpt?: string | null
          id?: string
          image_url?: string | null
          status?: string | null
          tags?: string[] | null
          title?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "posts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          ad_account_id: string | null
          badges: string[] | null
          brand_color: string | null
          business_name: string | null
          contact_number: string | null
          created_at: string
          current_streak: number | null
          email: string | null
          facebook_token: string | null
          facebook_url: string | null
          google_business_location_id: string | null
          google_business_refresh_token: string | null
          google_business_token: string | null
          id: string
          instagram_url: string | null
          last_activity_date: string | null
          level: number | null
          linkedin_token: string | null
          linkedin_url: string | null
          linkedin_urn: string | null
          logo_url: string | null
          mission_statement: string | null
          organization_id: string | null
          pixel_id: string | null
          role: string | null
          selected_page_id: string | null
          selected_page_name: string | null
          selected_page_token: string | null
          total_xp: number | null
          youtube_refresh_token: string | null
          youtube_token: string | null
          youtube_url: string | null
        }
        Insert: {
          ad_account_id?: string | null
          badges?: string[] | null
          brand_color?: string | null
          business_name?: string | null
          contact_number?: string | null
          created_at?: string
          current_streak?: number | null
          email?: string | null
          facebook_token?: string | null
          facebook_url?: string | null
          google_business_location_id?: string | null
          google_business_refresh_token?: string | null
          google_business_token?: string | null
          id: string
          instagram_url?: string | null
          last_activity_date?: string | null
          level?: number | null
          linkedin_token?: string | null
          linkedin_url?: string | null
          linkedin_urn?: string | null
          logo_url?: string | null
          mission_statement?: string | null
          organization_id?: string | null
          pixel_id?: string | null
          role?: string | null
          selected_page_id?: string | null
          selected_page_name?: string | null
          selected_page_token?: string | null
          total_xp?: number | null
          youtube_refresh_token?: string | null
          youtube_token?: string | null
          youtube_url?: string | null
        }
        Update: {
          ad_account_id?: string | null
          badges?: string[] | null
          brand_color?: string | null
          business_name?: string | null
          contact_number?: string | null
          created_at?: string
          current_streak?: number | null
          email?: string | null
          facebook_token?: string | null
          facebook_url?: string | null
          google_business_location_id?: string | null
          google_business_refresh_token?: string | null
          google_business_token?: string | null
          id?: string
          instagram_url?: string | null
          last_activity_date?: string | null
          level?: number | null
          linkedin_token?: string | null
          linkedin_url?: string | null
          linkedin_urn?: string | null
          logo_url?: string | null
          mission_statement?: string | null
          organization_id?: string | null
          pixel_id?: string | null
          role?: string | null
          selected_page_id?: string | null
          selected_page_name?: string | null
          selected_page_token?: string | null
          total_xp?: number | null
          youtube_refresh_token?: string | null
          youtube_token?: string | null
          youtube_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      properties: {
        Row: {
          address: string
          brochure_url: string | null
          configurations: Json | null
          created_at: string
          description: string | null
          floor_plan_url: string | null
          id: string
          image_url: string | null
          images: string[] | null
          marketing_copy_template: string | null
          master_creatives: string[] | null
          organization_id: string | null
          price: string | null
          property_type: string | null
          rera_number: string | null
          status: string | null
          title: string
          user_id: string | null
        }
        Insert: {
          address: string
          brochure_url?: string | null
          configurations?: Json | null
          created_at?: string
          description?: string | null
          floor_plan_url?: string | null
          id?: string
          image_url?: string | null
          images?: string[] | null
          marketing_copy_template?: string | null
          master_creatives?: string[] | null
          organization_id?: string | null
          price?: string | null
          property_type?: string | null
          rera_number?: string | null
          status?: string | null
          title: string
          user_id?: string | null
        }
        Update: {
          address?: string
          brochure_url?: string | null
          configurations?: Json | null
          created_at?: string
          description?: string | null
          floor_plan_url?: string | null
          id?: string
          image_url?: string | null
          images?: string[] | null
          marketing_copy_template?: string | null
          master_creatives?: string[] | null
          organization_id?: string | null
          price?: string | null
          property_type?: string | null
          rera_number?: string | null
          status?: string | null
          title?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "properties_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
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
      get_my_org_id: { Args: never; Returns: string }
      get_public_org_info: {
        Args: { org_id: string }
        Returns: {
          logo_url: string
          name: string
        }[]
      }
      increment_share_stat: {
        Args: { asset_id: string; platform: string }
        Returns: undefined
      }
      is_admin: { Args: never; Returns: boolean }
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
