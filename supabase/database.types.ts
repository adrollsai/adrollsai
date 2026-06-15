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
      ads: {
        Row: {
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          price: number
          title: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          price: number
          title: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          price?: number
          title?: string
        }
        Relationships: []
      }
      agent_ad_campaigns: {
        Row: {
          agent_contribution: number | null
          created_at: string | null
          fb_adset_id: string
          fb_campaign_id: string
          id: string
          org_id: string | null
          status: string | null
          subsidy_amount: number | null
          total_budget: number | null
          user_id: string | null
        }
        Insert: {
          agent_contribution?: number | null
          created_at?: string | null
          fb_adset_id: string
          fb_campaign_id: string
          id?: string
          org_id?: string | null
          status?: string | null
          subsidy_amount?: number | null
          total_budget?: number | null
          user_id?: string | null
        }
        Update: {
          agent_contribution?: number | null
          created_at?: string | null
          fb_adset_id?: string
          fb_campaign_id?: string
          id?: string
          org_id?: string | null
          status?: string | null
          subsidy_amount?: number | null
          total_budget?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_ad_campaigns_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      assets: {
        Row: {
          caption: string | null
          created_at: string
          id: string
          kie_task_id: string | null
          master_creative_id: string | null
          metadata: Json | null
          property_id: string | null
          share_stats: Json | null
          status: string | null
          type: string | null
          url: string | null
          user_id: string | null
        }
        Insert: {
          caption?: string | null
          created_at?: string
          id?: string
          kie_task_id?: string | null
          master_creative_id?: string | null
          metadata?: Json | null
          property_id?: string | null
          share_stats?: Json | null
          status?: string | null
          type?: string | null
          url?: string | null
          user_id?: string | null
        }
        Update: {
          caption?: string | null
          created_at?: string
          id?: string
          kie_task_id?: string | null
          master_creative_id?: string | null
          metadata?: Json | null
          property_id?: string | null
          share_stats?: Json | null
          status?: string | null
          type?: string | null
          url?: string | null
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
      campaigns: {
        Row: {
          budget_type: string | null
          created_at: string
          end_time: string | null
          id: string
          meta_ad_id: string | null
          meta_adset_id: string | null
          meta_campaign_id: string
          name: string
          start_time: string | null
          status: string | null
          total_budget: number | null
          user_id: string
        }
        Insert: {
          budget_type?: string | null
          created_at?: string
          end_time?: string | null
          id?: string
          meta_ad_id?: string | null
          meta_adset_id?: string | null
          meta_campaign_id: string
          name: string
          start_time?: string | null
          status?: string | null
          total_budget?: number | null
          user_id: string
        }
        Update: {
          budget_type?: string | null
          created_at?: string
          end_time?: string | null
          id?: string
          meta_ad_id?: string | null
          meta_adset_id?: string | null
          meta_campaign_id?: string
          name?: string
          start_time?: string | null
          status?: string | null
          total_budget?: number | null
          user_id?: string
        }
        Relationships: []
      }
      creative_prompts: {
        Row: {
          created_at: string | null
          id: string
          is_used: boolean | null
          organization_id: string
          prompt_text: string
          property_id: string | null
          used_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_used?: boolean | null
          organization_id: string
          prompt_text: string
          property_id?: string | null
          used_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_used?: boolean | null
          organization_id?: string
          prompt_text?: string
          property_id?: string | null
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "creative_prompts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_prompts_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_holdings: {
        Row: {
          created_at: string | null
          documents: Json | null
          fraction_id: string
          id: string
          purchase_date: string | null
          purchase_price: number
          user_id: string
        }
        Insert: {
          created_at?: string | null
          documents?: Json | null
          fraction_id: string
          id?: string
          purchase_date?: string | null
          purchase_price: number
          user_id: string
        }
        Update: {
          created_at?: string | null
          documents?: Json | null
          fraction_id?: string
          id?: string
          purchase_date?: string | null
          purchase_price?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_holdings_fraction_id_fkey"
            columns: ["fraction_id"]
            isOneToOne: true
            referencedRelation: "fractions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_holdings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      distribution_batches: {
        Row: {
          completed_count: number | null
          created_at: string | null
          id: string
          master_image_url: string | null
          status: string | null
          total_count: number | null
          user_id: string | null
        }
        Insert: {
          completed_count?: number | null
          created_at?: string | null
          id?: string
          master_image_url?: string | null
          status?: string | null
          total_count?: number | null
          user_id?: string | null
        }
        Update: {
          completed_count?: number | null
          created_at?: string | null
          id?: string
          master_image_url?: string | null
          status?: string | null
          total_count?: number | null
          user_id?: string | null
        }
        Relationships: []
      }
      distribution_items: {
        Row: {
          agent_data: Json | null
          batch_id: string | null
          created_at: string | null
          email_sent: boolean | null
          error_message: string | null
          id: string
          result_url: string | null
          status: string | null
          user_id: string | null
        }
        Insert: {
          agent_data?: Json | null
          batch_id?: string | null
          created_at?: string | null
          email_sent?: boolean | null
          error_message?: string | null
          id?: string
          result_url?: string | null
          status?: string | null
          user_id?: string | null
        }
        Update: {
          agent_data?: Json | null
          batch_id?: string | null
          created_at?: string | null
          email_sent?: boolean | null
          error_message?: string | null
          id?: string
          result_url?: string | null
          status?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "distribution_items_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "distribution_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      external_agents: {
        Row: {
          address: string | null
          business_name: string
          contact_number: string
          created_at: string
          email: string | null
          id: string
          logo_url: string | null
          user_id: string | null
        }
        Insert: {
          address?: string | null
          business_name: string
          contact_number: string
          created_at?: string
          email?: string | null
          id?: string
          logo_url?: string | null
          user_id?: string | null
        }
        Update: {
          address?: string | null
          business_name?: string
          contact_number?: string
          created_at?: string
          email?: string | null
          id?: string
          logo_url?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      fractions: {
        Row: {
          created_at: string | null
          fraction_number: number
          id: string
          name: string
          property_id: string
          status: string | null
        }
        Insert: {
          created_at?: string | null
          fraction_number: number
          id?: string
          name: string
          property_id: string
          status?: string | null
        }
        Update: {
          created_at?: string | null
          fraction_number?: number
          id?: string
          name?: string
          property_id?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fractions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      landing_pages: {
        Row: {
          created_at: string
          form_id: string | null
          html_content: string
          id: string
          product_name: string
          slug: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          form_id?: string | null
          html_content: string
          id?: string
          product_name: string
          slug: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          form_id?: string | null
          html_content?: string
          id?: string
          product_name?: string
          slug?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "landing_pages_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "qualification_forms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "landing_pages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_history: {
        Row: {
          action_type: string
          created_at: string | null
          description: string
          id: string
          lead_id: string
          user_id: string
        }
        Insert: {
          action_type: string
          created_at?: string | null
          description: string
          id?: string
          lead_id: string
          user_id: string
        }
        Update: {
          action_type?: string
          created_at?: string | null
          description?: string
          id?: string
          lead_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_history_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_history_user_id_fkey"
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
          assigned_to: string | null
          budget: string | null
          created_at: string
          custom_fields: Json | null
          email: string | null
          external_id: string | null
          facebook_created_at: string | null
          facebook_lead_id: string | null
          form_id: string | null
          form_name: string | null
          id: string
          name: string
          next_followup: string | null
          notes: string | null
          phone: string | null
          pipeline_stage: string | null
          priority_status: string | null
          source: string | null
          status: string | null
          summary: string | null
          timeline: string | null
          user_id: string | null
          value: number | null
        }
        Insert: {
          ad_name?: string | null
          assigned_to?: string | null
          budget?: string | null
          created_at?: string
          custom_fields?: Json | null
          email?: string | null
          external_id?: string | null
          facebook_created_at?: string | null
          facebook_lead_id?: string | null
          form_id?: string | null
          form_name?: string | null
          id?: string
          name: string
          next_followup?: string | null
          notes?: string | null
          phone?: string | null
          pipeline_stage?: string | null
          priority_status?: string | null
          source?: string | null
          status?: string | null
          summary?: string | null
          timeline?: string | null
          user_id?: string | null
          value?: number | null
        }
        Update: {
          ad_name?: string | null
          assigned_to?: string | null
          budget?: string | null
          created_at?: string
          custom_fields?: Json | null
          email?: string | null
          external_id?: string | null
          facebook_created_at?: string | null
          facebook_lead_id?: string | null
          form_id?: string | null
          form_name?: string | null
          id?: string
          name?: string
          next_followup?: string | null
          notes?: string | null
          phone?: string | null
          pipeline_stage?: string | null
          priority_status?: string | null
          source?: string | null
          status?: string | null
          summary?: string | null
          timeline?: string | null
          user_id?: string | null
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
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
          layout_config: Json | null
          property_id: string
          type: string | null
          url: string
        }
        Insert: {
          caption_template?: string | null
          created_at?: string
          id?: string
          is_active?: boolean | null
          layout_config?: Json | null
          property_id: string
          type?: string | null
          url: string
        }
        Update: {
          caption_template?: string | null
          created_at?: string
          id?: string
          is_active?: boolean | null
          layout_config?: Json | null
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
      notifications: {
        Row: {
          action_link: string | null
          created_at: string
          id: string
          is_read: boolean | null
          message: string
          title: string
          type: string | null
          user_id: string
        }
        Insert: {
          action_link?: string | null
          created_at?: string
          id?: string
          is_read?: boolean | null
          message: string
          title: string
          type?: string | null
          user_id: string
        }
        Update: {
          action_link?: string | null
          created_at?: string
          id?: string
          is_read?: boolean | null
          message?: string
          title?: string
          type?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
          ad_subsidy_percentage: number | null
          agent_limit: number | null
          brand_color: string | null
          business_model: string | null
          created_at: string
          custom_domain: string | null
          id: string
          master_adset_id: string | null
          master_campaign_id: string | null
          master_logo_url: string | null
          name: string
          xp_structure: Json | null
        }
        Insert: {
          ad_subsidy_percentage?: number | null
          agent_limit?: number | null
          brand_color?: string | null
          business_model?: string | null
          created_at?: string
          custom_domain?: string | null
          id?: string
          master_adset_id?: string | null
          master_campaign_id?: string | null
          master_logo_url?: string | null
          name: string
          xp_structure?: Json | null
        }
        Update: {
          ad_subsidy_percentage?: number | null
          agent_limit?: number | null
          brand_color?: string | null
          business_model?: string | null
          created_at?: string
          custom_domain?: string | null
          id?: string
          master_adset_id?: string | null
          master_campaign_id?: string | null
          master_logo_url?: string | null
          name?: string
          xp_structure?: Json | null
        }
        Relationships: []
      }
      posts: {
        Row: {
          content: string | null
          created_at: string
          excerpt: string | null
          file_path: string | null
          id: string
          image_url: string | null
          link_url: string | null
          media_type: string | null
          media_url: string | null
          status: string | null
          tags: string[] | null
          title: string | null
          user_id: string | null
          youtube_url: string | null
        }
        Insert: {
          content?: string | null
          created_at?: string
          excerpt?: string | null
          file_path?: string | null
          id?: string
          image_url?: string | null
          link_url?: string | null
          media_type?: string | null
          media_url?: string | null
          status?: string | null
          tags?: string[] | null
          title?: string | null
          user_id?: string | null
          youtube_url?: string | null
        }
        Update: {
          content?: string | null
          created_at?: string
          excerpt?: string | null
          file_path?: string | null
          id?: string
          image_url?: string | null
          link_url?: string | null
          media_type?: string | null
          media_url?: string | null
          status?: string | null
          tags?: string[] | null
          title?: string | null
          user_id?: string | null
          youtube_url?: string | null
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
          ad_credits: number | null
          address: string | null
          agency_id: string | null
          ai_ad_optimizations_used: number | null
          ai_creatives_used: number | null
          badges: string[] | null
          brand_color: string | null
          business_info: string | null
          business_name: string | null
          campaign_launches_used: number | null
          character_audio_url: string | null
          character_description: string | null
          character_url: string | null
          contact_number: string | null
          created_at: string
          currency: string | null
          current_streak: number | null
          custom_domain: string | null
          custom_prompt: string | null
          domain_verify_status: string | null
          domain_verify_token: string | null
          email: string | null
          enable_distribution: boolean | null
          facebook_token: string | null
          facebook_url: string | null
          google_business_location_id: string | null
          google_business_refresh_token: string | null
          google_business_token: string | null
          id: string
          industry: string | null
          instagram_url: string | null
          last_activity_date: string | null
          level: number | null
          linkedin_id: string | null
          linkedin_name: string | null
          linkedin_token: string | null
          linkedin_url: string | null
          linkedin_urn: string | null
          logo_url: string | null
          mission_statement: string | null
          onboarding_completed: boolean | null
          organization_id: string | null
          parent_id: string | null
          pixel_id: string | null
          remarketing_campaigns_used: number | null
          role: string | null
          selected_page_id: string | null
          selected_page_name: string | null
          selected_page_token: string | null
          seo_articles_used: number | null
          storage_bytes_used: number | null
          subscription_plan: string | null
          subscription_status: string | null
          subscription_valid_until: string | null
          total_xp: number | null
          usage_reset_date: string | null
          whatsapp_access_token: string | null
          whatsapp_business_account_id: string | null
          whatsapp_phone_number_id: string | null
          whitelabel_domain: string | null
          whitelabel_verify_status: string | null
          whitelabel_verify_token: string | null
          youtube_refresh_token: string | null
          youtube_token: string | null
          youtube_url: string | null
        }
        Insert: {
          ad_account_id?: string | null
          ad_credits?: number | null
          address?: string | null
          agency_id?: string | null
          ai_ad_optimizations_used?: number | null
          ai_creatives_used?: number | null
          badges?: string[] | null
          brand_color?: string | null
          business_info?: string | null
          business_name?: string | null
          campaign_launches_used?: number | null
          character_audio_url?: string | null
          character_description?: string | null
          character_url?: string | null
          contact_number?: string | null
          created_at?: string
          currency?: string | null
          current_streak?: number | null
          custom_domain?: string | null
          custom_prompt?: string | null
          domain_verify_status?: string | null
          domain_verify_token?: string | null
          email?: string | null
          enable_distribution?: boolean | null
          facebook_token?: string | null
          facebook_url?: string | null
          google_business_location_id?: string | null
          google_business_refresh_token?: string | null
          google_business_token?: string | null
          id: string
          industry?: string | null
          instagram_url?: string | null
          last_activity_date?: string | null
          level?: number | null
          linkedin_id?: string | null
          linkedin_name?: string | null
          linkedin_token?: string | null
          linkedin_url?: string | null
          linkedin_urn?: string | null
          logo_url?: string | null
          mission_statement?: string | null
          onboarding_completed?: boolean | null
          organization_id?: string | null
          parent_id?: string | null
          pixel_id?: string | null
          remarketing_campaigns_used?: number | null
          role?: string | null
          selected_page_id?: string | null
          selected_page_name?: string | null
          selected_page_token?: string | null
          seo_articles_used?: number | null
          storage_bytes_used?: number | null
          subscription_plan?: string | null
          subscription_status?: string | null
          subscription_valid_until?: string | null
          total_xp?: number | null
          usage_reset_date?: string | null
          whatsapp_access_token?: string | null
          whatsapp_business_account_id?: string | null
          whatsapp_phone_number_id?: string | null
          whitelabel_domain?: string | null
          whitelabel_verify_status?: string | null
          whitelabel_verify_token?: string | null
          youtube_refresh_token?: string | null
          youtube_token?: string | null
          youtube_url?: string | null
        }
        Update: {
          ad_account_id?: string | null
          ad_credits?: number | null
          address?: string | null
          agency_id?: string | null
          ai_ad_optimizations_used?: number | null
          ai_creatives_used?: number | null
          badges?: string[] | null
          brand_color?: string | null
          business_info?: string | null
          business_name?: string | null
          campaign_launches_used?: number | null
          character_audio_url?: string | null
          character_description?: string | null
          character_url?: string | null
          contact_number?: string | null
          created_at?: string
          currency?: string | null
          current_streak?: number | null
          custom_domain?: string | null
          custom_prompt?: string | null
          domain_verify_status?: string | null
          domain_verify_token?: string | null
          email?: string | null
          enable_distribution?: boolean | null
          facebook_token?: string | null
          facebook_url?: string | null
          google_business_location_id?: string | null
          google_business_refresh_token?: string | null
          google_business_token?: string | null
          id?: string
          industry?: string | null
          instagram_url?: string | null
          last_activity_date?: string | null
          level?: number | null
          linkedin_id?: string | null
          linkedin_name?: string | null
          linkedin_token?: string | null
          linkedin_url?: string | null
          linkedin_urn?: string | null
          logo_url?: string | null
          mission_statement?: string | null
          onboarding_completed?: boolean | null
          organization_id?: string | null
          parent_id?: string | null
          pixel_id?: string | null
          remarketing_campaigns_used?: number | null
          role?: string | null
          selected_page_id?: string | null
          selected_page_name?: string | null
          selected_page_token?: string | null
          seo_articles_used?: number | null
          storage_bytes_used?: number | null
          subscription_plan?: string | null
          subscription_status?: string | null
          subscription_valid_until?: string | null
          total_xp?: number | null
          usage_reset_date?: string | null
          whatsapp_access_token?: string | null
          whatsapp_business_account_id?: string | null
          whatsapp_phone_number_id?: string | null
          whitelabel_domain?: string | null
          whitelabel_verify_status?: string | null
          whitelabel_verify_token?: string | null
          youtube_refresh_token?: string | null
          youtube_token?: string | null
          youtube_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_agency_id_fkey"
            columns: ["agency_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      properties: {
        Row: {
          address: string
          auto_generate: boolean | null
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
          meta_campaign_id: string | null
          meta_campaign_status: string | null
          organization_id: string | null
          price: string | null
          property_type: string | null
          rera_number: string | null
          status: string | null
          template_adset_id: string | null
          template_campaign_id: string | null
          title: string
          user_id: string | null
          youtube_url: string | null
        }
        Insert: {
          address: string
          auto_generate?: boolean | null
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
          meta_campaign_id?: string | null
          meta_campaign_status?: string | null
          organization_id?: string | null
          price?: string | null
          property_type?: string | null
          rera_number?: string | null
          status?: string | null
          template_adset_id?: string | null
          template_campaign_id?: string | null
          title: string
          user_id?: string | null
          youtube_url?: string | null
        }
        Update: {
          address?: string
          auto_generate?: boolean | null
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
          meta_campaign_id?: string | null
          meta_campaign_status?: string | null
          organization_id?: string | null
          price?: string | null
          property_type?: string | null
          rera_number?: string | null
          status?: string | null
          template_adset_id?: string | null
          template_campaign_id?: string | null
          title?: string
          user_id?: string | null
          youtube_url?: string | null
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
      push_subscriptions: {
        Row: {
          auth: string
          catalog_owner_id: string | null
          created_at: string | null
          endpoint: string
          id: string
          p256dh: string
          user_id: string | null
        }
        Insert: {
          auth: string
          catalog_owner_id?: string | null
          created_at?: string | null
          endpoint: string
          id?: string
          p256dh: string
          user_id?: string | null
        }
        Update: {
          auth?: string
          catalog_owner_id?: string | null
          created_at?: string | null
          endpoint?: string
          id?: string
          p256dh?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_catalog_owner_id_fkey"
            columns: ["catalog_owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      qualification_forms: {
        Row: {
          created_at: string
          custom_questions: Json
          fields: Json
          id: string
          name: string
          user_id: string
        }
        Insert: {
          created_at?: string
          custom_questions?: Json
          fields?: Json
          id?: string
          name: string
          user_id: string
        }
        Update: {
          created_at?: string
          custom_questions?: Json
          fields?: Json
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qualification_forms_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          ad_id: string | null
          amount: number
          created_at: string
          order_id: string
          payment_id: string | null
          provider_reference_id: string | null
          status: string
          user_id: string
        }
        Insert: {
          ad_id?: string | null
          amount: number
          created_at?: string
          order_id: string
          payment_id?: string | null
          provider_reference_id?: string | null
          status?: string
          user_id: string
        }
        Update: {
          ad_id?: string | null
          amount?: number
          created_at?: string
          order_id?: string
          payment_id?: string | null
          provider_reference_id?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_ad_id_fkey"
            columns: ["ad_id"]
            isOneToOne: false
            referencedRelation: "ads"
            referencedColumns: ["id"]
          },
        ]
      }
      video_tasks: {
        Row: {
          aspect_ratio: string | null
          asset_id: string | null
          created_at: string | null
          current_index: number | null
          final_caption: string | null
          id: string
          last_error: string | null
          last_successful_task_id: string | null
          last_task_id: string | null
          prompts: Json
          property_id: string | null
          retry_count: number | null
          status: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          aspect_ratio?: string | null
          asset_id?: string | null
          created_at?: string | null
          current_index?: number | null
          final_caption?: string | null
          id?: string
          last_error?: string | null
          last_successful_task_id?: string | null
          last_task_id?: string | null
          prompts: Json
          property_id?: string | null
          retry_count?: number | null
          status?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          aspect_ratio?: string | null
          asset_id?: string | null
          created_at?: string | null
          current_index?: number | null
          final_caption?: string | null
          id?: string
          last_error?: string | null
          last_successful_task_id?: string | null
          last_task_id?: string | null
          prompts?: Json
          property_id?: string | null
          retry_count?: number | null
          status?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "video_tasks_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "video_tasks_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      wallet_transactions: {
        Row: {
          amount: number
          created_at: string | null
          description: string | null
          id: string
          provider_reference_id: string | null
          status: string | null
          type: string | null
          user_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string | null
          description?: string | null
          id?: string
          provider_reference_id?: string | null
          status?: string | null
          type?: string | null
          user_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string | null
          description?: string | null
          id?: string
          provider_reference_id?: string | null
          status?: string | null
          type?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      wallets: {
        Row: {
          balance: number | null
          currency: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          balance?: number | null
          currency?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          balance?: number | null
          currency?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      property_co_owners: {
        Row: {
          fraction_number: number | null
          owner_image: string | null
          owner_name: string | null
          property_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fractions_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      get_my_org_id: { Args: never; Returns: string }
      get_property_fractions_admin: {
        Args: { target_property_id: string }
        Returns: {
          doc_count: number
          fraction_id: string
          fraction_number: number
          owner_email: string
          owner_name: string
          status: string
        }[]
      }
      get_public_org_info: {
        Args: { org_id: string }
        Returns: {
          logo_url: string
          name: string
        }[]
      }
      increment_batch_counter: { Args: { row_id: string }; Returns: undefined }
      increment_share_stat: {
        Args: { asset_id: string; platform: string }
        Returns: undefined
      }
      is_admin: { Args: never; Returns: boolean }
      is_admin_or_agent: { Args: never; Returns: boolean }
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
