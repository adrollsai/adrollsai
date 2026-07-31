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
      ads: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          image_url: string | null
          price: number | null
          title: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          price?: number | null
          title?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          price?: number | null
          title?: string | null
        }
        Relationships: []
      }
      agent_ad_campaigns: {
        Row: {
          agent_contribution: number | null
          created_at: string | null
          fb_adset_id: string | null
          fb_campaign_id: string | null
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
          fb_adset_id?: string | null
          fb_campaign_id?: string | null
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
          fb_adset_id?: string | null
          fb_campaign_id?: string | null
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
          {
            foreignKeyName: "agent_ad_campaigns_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      assets: {
        Row: {
          caption: string | null
          created_at: string | null
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
          created_at?: string | null
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
          created_at?: string | null
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
          created_at: string | null
          description: string | null
          icon_name: string | null
          id: string
          is_active: boolean | null
          stats: string | null
          title: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          icon_name?: string | null
          id?: string
          is_active?: boolean | null
          stats?: string | null
          title?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          icon_name?: string | null
          id?: string
          is_active?: boolean | null
          stats?: string | null
          title?: string | null
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
      campaign_analyses: {
        Row: {
          analysis_text: string
          campaign_id: string
          created_at: string
          id: string
          metrics: Json
          recommendations: Json
          user_id: string
        }
        Insert: {
          analysis_text: string
          campaign_id: string
          created_at?: string
          id?: string
          metrics: Json
          recommendations: Json
          user_id: string
        }
        Update: {
          analysis_text?: string
          campaign_id?: string
          created_at?: string
          id?: string
          metrics?: Json
          recommendations?: Json
          user_id?: string
        }
        Relationships: []
      }
      campaign_jobs: {
        Row: {
          campaign_id: string | null
          created_at: string
          id: string
          message: string | null
          payload: Json
          status: string
          target_user_id: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          campaign_id?: string | null
          created_at?: string
          id?: string
          message?: string | null
          payload?: Json
          status?: string
          target_user_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          campaign_id?: string | null
          created_at?: string
          id?: string
          message?: string | null
          payload?: Json
          status?: string
          target_user_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_jobs_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_jobs_user_id_fkey"
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
          created_at: string | null
          end_time: string | null
          id: string
          meta_ad_id: string | null
          meta_adset_id: string | null
          meta_campaign_id: string | null
          name: string | null
          start_time: string | null
          status: string | null
          total_budget: number | null
          user_id: string | null
        }
        Insert: {
          budget_type?: string | null
          created_at?: string | null
          end_time?: string | null
          id?: string
          meta_ad_id?: string | null
          meta_adset_id?: string | null
          meta_campaign_id?: string | null
          name?: string | null
          start_time?: string | null
          status?: string | null
          total_budget?: number | null
          user_id?: string | null
        }
        Update: {
          budget_type?: string | null
          created_at?: string | null
          end_time?: string | null
          id?: string
          meta_ad_id?: string | null
          meta_adset_id?: string | null
          meta_campaign_id?: string | null
          name?: string | null
          start_time?: string | null
          status?: string | null
          total_budget?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_prompts: {
        Row: {
          created_at: string | null
          id: string
          is_used: boolean | null
          organization_id: string | null
          prompt_text: string | null
          property_id: string | null
          used_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_used?: boolean | null
          organization_id?: string | null
          prompt_text?: string | null
          property_id?: string | null
          used_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_used?: boolean | null
          organization_id?: string | null
          prompt_text?: string | null
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
      credit_transactions: {
        Row: {
          amount: number
          category: string
          created_at: string
          description: string
          id: string
          user_id: string
        }
        Insert: {
          amount: number
          category: string
          created_at?: string
          description: string
          id?: string
          user_id: string
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          description?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_holdings: {
        Row: {
          created_at: string | null
          documents: string | null
          fraction_id: string | null
          id: string
          purchase_date: string | null
          purchase_price: number | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          documents?: string | null
          fraction_id?: string | null
          id?: string
          purchase_date?: string | null
          purchase_price?: number | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          documents?: string | null
          fraction_id?: string | null
          id?: string
          purchase_date?: string | null
          purchase_price?: number | null
          user_id?: string | null
        }
        Relationships: [
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
        Relationships: [
          {
            foreignKeyName: "distribution_batches_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
          {
            foreignKeyName: "distribution_items_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      external_agents: {
        Row: {
          address: string | null
          business_name: string | null
          contact_number: string | null
          created_at: string | null
          email: string | null
          id: string
          logo_url: string | null
          user_id: string | null
        }
        Insert: {
          address?: string | null
          business_name?: string | null
          contact_number?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          logo_url?: string | null
          user_id?: string | null
        }
        Update: {
          address?: string | null
          business_name?: string | null
          contact_number?: string | null
          created_at?: string | null
          email?: string | null
          id?: string
          logo_url?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "external_agents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      flagged_questions: {
        Row: {
          answer: string | null
          channel: string
          created_at: string | null
          id: string
          language: string | null
          lead_id: string | null
          question: string
          resolved: boolean | null
          translation: string | null
          user_id: string | null
        }
        Insert: {
          answer?: string | null
          channel: string
          created_at?: string | null
          id?: string
          language?: string | null
          lead_id?: string | null
          question: string
          resolved?: boolean | null
          translation?: string | null
          user_id?: string | null
        }
        Update: {
          answer?: string | null
          channel?: string
          created_at?: string | null
          id?: string
          language?: string | null
          lead_id?: string | null
          question?: string
          resolved?: boolean | null
          translation?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "flagged_questions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "flagged_questions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      fractions: {
        Row: {
          created_at: string | null
          fraction_number: number | null
          id: string
          name: string | null
          property_id: string | null
          status: string | null
        }
        Insert: {
          created_at?: string | null
          fraction_number?: number | null
          id?: string
          name?: string | null
          property_id?: string | null
          status?: string | null
        }
        Update: {
          created_at?: string | null
          fraction_number?: number | null
          id?: string
          name?: string | null
          property_id?: string | null
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
          booking_enabled: boolean | null
          created_at: string | null
          form_id: string | null
          html_content: string | null
          id: string
          pixel_id: string | null
          product_name: string | null
          property_id: string | null
          slug: string | null
          title: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          booking_enabled?: boolean | null
          created_at?: string | null
          form_id?: string | null
          html_content?: string | null
          id?: string
          pixel_id?: string | null
          product_name?: string | null
          property_id?: string | null
          slug?: string | null
          title?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          booking_enabled?: boolean | null
          created_at?: string | null
          form_id?: string | null
          html_content?: string | null
          id?: string
          pixel_id?: string | null
          product_name?: string | null
          property_id?: string | null
          slug?: string | null
          title?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "landing_pages_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
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
          action_type: string | null
          created_at: string | null
          description: string | null
          id: string
          lead_id: string | null
          user_id: string | null
        }
        Insert: {
          action_type?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          lead_id?: string | null
          user_id?: string | null
        }
        Update: {
          action_type?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          lead_id?: string | null
          user_id?: string | null
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
          booked_time: string | null
          booking_reminder_sent: boolean | null
          budget: string | null
          calling_enabled: boolean | null
          campaign_id: string | null
          created_at: string | null
          csv_audience: string | null
          custom_fields: string | null
          email: string | null
          external_id: string | null
          facebook_created_at: string | null
          facebook_lead_id: string | null
          form_id: string | null
          form_name: string | null
          google_calendar_event_id: string | null
          id: string
          meet_link: string | null
          name: string | null
          next_followup: string | null
          notes: string | null
          phone: string | null
          pipeline_stage: string | null
          pixel_id: string | null
          priority_status: string | null
          property_id: string | null
          reminder_15m_sent: boolean | null
          reminder_1h_sent: boolean | null
          reminder_24h_sent: boolean | null
          reminder_4h_sent: boolean | null
          source: string | null
          status: string | null
          summary: string | null
          timeline: string | null
          user_id: string | null
          value: number | null
          voice_call_id: string | null
          voice_call_retry_count: number | null
          voice_call_scheduled_at: string | null
          voice_call_status: string | null
          voice_call_summary: string | null
          voice_call_transcript: Json | null
          voice_campaign_id: string | null
          voice_recording_url: string | null
          whatsapp_enabled: boolean | null
        }
        Insert: {
          ad_name?: string | null
          assigned_to?: string | null
          booked_time?: string | null
          booking_reminder_sent?: boolean | null
          budget?: string | null
          calling_enabled?: boolean | null
          campaign_id?: string | null
          created_at?: string | null
          csv_audience?: string | null
          custom_fields?: string | null
          email?: string | null
          external_id?: string | null
          facebook_created_at?: string | null
          facebook_lead_id?: string | null
          form_id?: string | null
          form_name?: string | null
          google_calendar_event_id?: string | null
          id?: string
          meet_link?: string | null
          name?: string | null
          next_followup?: string | null
          notes?: string | null
          phone?: string | null
          pipeline_stage?: string | null
          pixel_id?: string | null
          priority_status?: string | null
          property_id?: string | null
          reminder_15m_sent?: boolean | null
          reminder_1h_sent?: boolean | null
          reminder_24h_sent?: boolean | null
          reminder_4h_sent?: boolean | null
          source?: string | null
          status?: string | null
          summary?: string | null
          timeline?: string | null
          user_id?: string | null
          value?: number | null
          voice_call_id?: string | null
          voice_call_retry_count?: number | null
          voice_call_scheduled_at?: string | null
          voice_call_status?: string | null
          voice_call_summary?: string | null
          voice_call_transcript?: Json | null
          voice_campaign_id?: string | null
          voice_recording_url?: string | null
          whatsapp_enabled?: boolean | null
        }
        Update: {
          ad_name?: string | null
          assigned_to?: string | null
          booked_time?: string | null
          booking_reminder_sent?: boolean | null
          budget?: string | null
          calling_enabled?: boolean | null
          campaign_id?: string | null
          created_at?: string | null
          csv_audience?: string | null
          custom_fields?: string | null
          email?: string | null
          external_id?: string | null
          facebook_created_at?: string | null
          facebook_lead_id?: string | null
          form_id?: string | null
          form_name?: string | null
          google_calendar_event_id?: string | null
          id?: string
          meet_link?: string | null
          name?: string | null
          next_followup?: string | null
          notes?: string | null
          phone?: string | null
          pipeline_stage?: string | null
          pixel_id?: string | null
          priority_status?: string | null
          property_id?: string | null
          reminder_15m_sent?: boolean | null
          reminder_1h_sent?: boolean | null
          reminder_24h_sent?: boolean | null
          reminder_4h_sent?: boolean | null
          source?: string | null
          status?: string | null
          summary?: string | null
          timeline?: string | null
          user_id?: string | null
          value?: number | null
          voice_call_id?: string | null
          voice_call_retry_count?: number | null
          voice_call_scheduled_at?: string | null
          voice_call_status?: string | null
          voice_call_summary?: string | null
          voice_call_transcript?: Json | null
          voice_campaign_id?: string | null
          voice_recording_url?: string | null
          whatsapp_enabled?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_voice_campaign_id_fkey"
            columns: ["voice_campaign_id"]
            isOneToOne: false
            referencedRelation: "voice_campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      master_creatives: {
        Row: {
          caption_template: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          layout_config: string | null
          property_id: string | null
          type: string | null
          url: string | null
        }
        Insert: {
          caption_template?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          layout_config?: string | null
          property_id?: string | null
          type?: string | null
          url?: string | null
        }
        Update: {
          caption_template?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          layout_config?: string | null
          property_id?: string | null
          type?: string | null
          url?: string | null
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
          created_at: string | null
          id: string
          is_read: boolean | null
          message: string | null
          title: string | null
          type: string | null
          user_id: string | null
        }
        Insert: {
          action_link?: string | null
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          message?: string | null
          title?: string | null
          type?: string | null
          user_id?: string | null
        }
        Update: {
          action_link?: string | null
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          message?: string | null
          title?: string | null
          type?: string | null
          user_id?: string | null
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
          {
            foreignKeyName: "organization_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
          created_at: string | null
          custom_domain: string | null
          id: string
          master_adset_id: string | null
          master_campaign_id: string | null
          master_logo_url: string | null
          name: string | null
          xp_structure: Json | null
        }
        Insert: {
          ad_subsidy_percentage?: number | null
          agent_limit?: number | null
          brand_color?: string | null
          business_model?: string | null
          created_at?: string | null
          custom_domain?: string | null
          id?: string
          master_adset_id?: string | null
          master_campaign_id?: string | null
          master_logo_url?: string | null
          name?: string | null
          xp_structure?: Json | null
        }
        Update: {
          ad_subsidy_percentage?: number | null
          agent_limit?: number | null
          brand_color?: string | null
          business_model?: string | null
          created_at?: string | null
          custom_domain?: string | null
          id?: string
          master_adset_id?: string | null
          master_campaign_id?: string | null
          master_logo_url?: string | null
          name?: string | null
          xp_structure?: Json | null
        }
        Relationships: []
      }
      posts: {
        Row: {
          content: string | null
          created_at: string | null
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
          created_at?: string | null
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
          created_at?: string | null
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
          accepted_terms: boolean | null
          ad_account_id: string | null
          ad_credits: number | null
          address: string | null
          agency_id: string | null
          ai_ad_optimizations_used: number | null
          ai_creatives_used: number | null
          auto_call_new_leads: boolean | null
          avatar_audio_url: string | null
          avatar_description: string | null
          avatar_url: string | null
          badges: string[] | null
          brand_color: string | null
          business_info: string | null
          business_landing_enabled: boolean | null
          business_landing_hero_subtitle: string | null
          business_landing_hero_title: string | null
          business_landing_show_products: boolean | null
          business_name: string | null
          campaign_launches_used: number | null
          character_audio_url: string | null
          character_description: string | null
          character_url: string | null
          contact_number: string | null
          created_at: string | null
          credits: number | null
          currency: string | null
          current_streak: number | null
          custom_domain: string | null
          custom_prompt: string | null
          domain_verify_status: string | null
          domain_verify_token: string | null
          elevenlabs_agent_id: string | null
          elevenlabs_api_key: string | null
          email: string | null
          enable_distribution: boolean | null
          enable_eod_report: boolean | null
          facebook_token: string | null
          facebook_url: string | null
          full_name: string | null
          google_booking_duration: number | null
          google_booking_enabled: boolean | null
          google_booking_hours: Json | null
          google_business_location_id: string | null
          google_business_refresh_token: string | null
          google_business_token: string | null
          google_calendar_id: string | null
          google_refresh_token: string | null
          id: string
          instagram_url: string | null
          last_activity_date: string | null
          last_ai_analysis: Json | null
          level: number | null
          linkedin_id: string | null
          linkedin_name: string | null
          linkedin_token: string | null
          linkedin_url: string | null
          linkedin_urn: string | null
          logo_url: string | null
          mission_statement: string | null
          old_voice_twilio_number: string | null
          onboarding_completed: boolean | null
          organization_id: string | null
          parent_id: string | null
          pixel_id: string | null
          qualifying_enabled: boolean | null
          qualifying_questions: string[] | null
          remarketing_campaigns_used: number | null
          role: string | null
          selected_page_id: string | null
          selected_page_name: string | null
          selected_page_token: string | null
          selected_text_llm: string | null
          seo_articles_used: number | null
          storage_bytes_used: number | null
          subscription_plan: string | null
          subscription_status: string | null
          subscription_valid_until: string | null
          total_xp: number | null
          usage_reset_date: string | null
          voice_name: string | null
          voice_provider: string | null
          voice_twilio_number: string | null
          voice_twilio_sid: string | null
          voice_twilio_token: string | null
          webhook_token_99acres: string | null
          whatsapp_access_token: string | null
          whatsapp_business_account_id: string | null
          whatsapp_buttons: Json | null
          whatsapp_catalogue_button_text: string | null
          whatsapp_connected_at: string | null
          whatsapp_personal_number: string | null
          whatsapp_phone_number: string | null
          whatsapp_phone_number_id: string | null
          whatsapp_waba_id: string | null
          whitelabel_domain: string | null
          whitelabel_verify_status: string | null
          whitelabel_verify_token: string | null
          youtube_refresh_token: string | null
          youtube_token: string | null
          youtube_url: string | null
        }
        Insert: {
          accepted_terms?: boolean | null
          ad_account_id?: string | null
          ad_credits?: number | null
          address?: string | null
          agency_id?: string | null
          ai_ad_optimizations_used?: number | null
          ai_creatives_used?: number | null
          auto_call_new_leads?: boolean | null
          avatar_audio_url?: string | null
          avatar_description?: string | null
          avatar_url?: string | null
          badges?: string[] | null
          brand_color?: string | null
          business_info?: string | null
          business_landing_enabled?: boolean | null
          business_landing_hero_subtitle?: string | null
          business_landing_hero_title?: string | null
          business_landing_show_products?: boolean | null
          business_name?: string | null
          campaign_launches_used?: number | null
          character_audio_url?: string | null
          character_description?: string | null
          character_url?: string | null
          contact_number?: string | null
          created_at?: string | null
          credits?: number | null
          currency?: string | null
          current_streak?: number | null
          custom_domain?: string | null
          custom_prompt?: string | null
          domain_verify_status?: string | null
          domain_verify_token?: string | null
          elevenlabs_agent_id?: string | null
          elevenlabs_api_key?: string | null
          email?: string | null
          enable_distribution?: boolean | null
          enable_eod_report?: boolean | null
          facebook_token?: string | null
          facebook_url?: string | null
          full_name?: string | null
          google_booking_duration?: number | null
          google_booking_enabled?: boolean | null
          google_booking_hours?: Json | null
          google_business_location_id?: string | null
          google_business_refresh_token?: string | null
          google_business_token?: string | null
          google_calendar_id?: string | null
          google_refresh_token?: string | null
          id?: string
          instagram_url?: string | null
          last_activity_date?: string | null
          last_ai_analysis?: Json | null
          level?: number | null
          linkedin_id?: string | null
          linkedin_name?: string | null
          linkedin_token?: string | null
          linkedin_url?: string | null
          linkedin_urn?: string | null
          logo_url?: string | null
          mission_statement?: string | null
          old_voice_twilio_number?: string | null
          onboarding_completed?: boolean | null
          organization_id?: string | null
          parent_id?: string | null
          pixel_id?: string | null
          qualifying_enabled?: boolean | null
          qualifying_questions?: string[] | null
          remarketing_campaigns_used?: number | null
          role?: string | null
          selected_page_id?: string | null
          selected_page_name?: string | null
          selected_page_token?: string | null
          selected_text_llm?: string | null
          seo_articles_used?: number | null
          storage_bytes_used?: number | null
          subscription_plan?: string | null
          subscription_status?: string | null
          subscription_valid_until?: string | null
          total_xp?: number | null
          usage_reset_date?: string | null
          voice_name?: string | null
          voice_provider?: string | null
          voice_twilio_number?: string | null
          voice_twilio_sid?: string | null
          voice_twilio_token?: string | null
          webhook_token_99acres?: string | null
          whatsapp_access_token?: string | null
          whatsapp_business_account_id?: string | null
          whatsapp_buttons?: Json | null
          whatsapp_catalogue_button_text?: string | null
          whatsapp_connected_at?: string | null
          whatsapp_personal_number?: string | null
          whatsapp_phone_number?: string | null
          whatsapp_phone_number_id?: string | null
          whatsapp_waba_id?: string | null
          whitelabel_domain?: string | null
          whitelabel_verify_status?: string | null
          whitelabel_verify_token?: string | null
          youtube_refresh_token?: string | null
          youtube_token?: string | null
          youtube_url?: string | null
        }
        Update: {
          accepted_terms?: boolean | null
          ad_account_id?: string | null
          ad_credits?: number | null
          address?: string | null
          agency_id?: string | null
          ai_ad_optimizations_used?: number | null
          ai_creatives_used?: number | null
          auto_call_new_leads?: boolean | null
          avatar_audio_url?: string | null
          avatar_description?: string | null
          avatar_url?: string | null
          badges?: string[] | null
          brand_color?: string | null
          business_info?: string | null
          business_landing_enabled?: boolean | null
          business_landing_hero_subtitle?: string | null
          business_landing_hero_title?: string | null
          business_landing_show_products?: boolean | null
          business_name?: string | null
          campaign_launches_used?: number | null
          character_audio_url?: string | null
          character_description?: string | null
          character_url?: string | null
          contact_number?: string | null
          created_at?: string | null
          credits?: number | null
          currency?: string | null
          current_streak?: number | null
          custom_domain?: string | null
          custom_prompt?: string | null
          domain_verify_status?: string | null
          domain_verify_token?: string | null
          elevenlabs_agent_id?: string | null
          elevenlabs_api_key?: string | null
          email?: string | null
          enable_distribution?: boolean | null
          enable_eod_report?: boolean | null
          facebook_token?: string | null
          facebook_url?: string | null
          full_name?: string | null
          google_booking_duration?: number | null
          google_booking_enabled?: boolean | null
          google_booking_hours?: Json | null
          google_business_location_id?: string | null
          google_business_refresh_token?: string | null
          google_business_token?: string | null
          google_calendar_id?: string | null
          google_refresh_token?: string | null
          id?: string
          instagram_url?: string | null
          last_activity_date?: string | null
          last_ai_analysis?: Json | null
          level?: number | null
          linkedin_id?: string | null
          linkedin_name?: string | null
          linkedin_token?: string | null
          linkedin_url?: string | null
          linkedin_urn?: string | null
          logo_url?: string | null
          mission_statement?: string | null
          old_voice_twilio_number?: string | null
          onboarding_completed?: boolean | null
          organization_id?: string | null
          parent_id?: string | null
          pixel_id?: string | null
          qualifying_enabled?: boolean | null
          qualifying_questions?: string[] | null
          remarketing_campaigns_used?: number | null
          role?: string | null
          selected_page_id?: string | null
          selected_page_name?: string | null
          selected_page_token?: string | null
          selected_text_llm?: string | null
          seo_articles_used?: number | null
          storage_bytes_used?: number | null
          subscription_plan?: string | null
          subscription_status?: string | null
          subscription_valid_until?: string | null
          total_xp?: number | null
          usage_reset_date?: string | null
          voice_name?: string | null
          voice_provider?: string | null
          voice_twilio_number?: string | null
          voice_twilio_sid?: string | null
          voice_twilio_token?: string | null
          webhook_token_99acres?: string | null
          whatsapp_access_token?: string | null
          whatsapp_business_account_id?: string | null
          whatsapp_buttons?: Json | null
          whatsapp_catalogue_button_text?: string | null
          whatsapp_connected_at?: string | null
          whatsapp_personal_number?: string | null
          whatsapp_phone_number?: string | null
          whatsapp_phone_number_id?: string | null
          whatsapp_waba_id?: string | null
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
        ]
      }
      properties: {
        Row: {
          address: string | null
          auto_generate: boolean | null
          brochure_url: string | null
          configurations: string | null
          created_at: string | null
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
          show_on_landing_page: boolean | null
          status: string | null
          template_adset_id: string | null
          template_campaign_id: string | null
          title: string | null
          user_id: string | null
          youtube_url: string | null
        }
        Insert: {
          address?: string | null
          auto_generate?: boolean | null
          brochure_url?: string | null
          configurations?: string | null
          created_at?: string | null
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
          show_on_landing_page?: boolean | null
          status?: string | null
          template_adset_id?: string | null
          template_campaign_id?: string | null
          title?: string | null
          user_id?: string | null
          youtube_url?: string | null
        }
        Update: {
          address?: string | null
          auto_generate?: boolean | null
          brochure_url?: string | null
          configurations?: string | null
          created_at?: string | null
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
          show_on_landing_page?: boolean | null
          status?: string | null
          template_adset_id?: string | null
          template_campaign_id?: string | null
          title?: string | null
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
          auth: string | null
          catalog_owner_id: string | null
          created_at: string | null
          endpoint: string | null
          id: string
          p256dh: string | null
          user_id: string | null
        }
        Insert: {
          auth?: string | null
          catalog_owner_id?: string | null
          created_at?: string | null
          endpoint?: string | null
          id?: string
          p256dh?: string | null
          user_id?: string | null
        }
        Update: {
          auth?: string | null
          catalog_owner_id?: string | null
          created_at?: string | null
          endpoint?: string | null
          id?: string
          p256dh?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
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
      reference_creatives: {
        Row: {
          category: string
          created_at: string
          id: string
          url: string
          user_id: string | null
        }
        Insert: {
          category: string
          created_at?: string
          id?: string
          url: string
          user_id?: string | null
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          url?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reference_creatives_user_id_fkey"
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
          amount: number | null
          created_at: string | null
          order_id: string | null
          payment_id: string | null
          provider_reference_id: string | null
          status: string | null
          user_id: string | null
        }
        Insert: {
          ad_id?: string | null
          amount?: number | null
          created_at?: string | null
          order_id?: string | null
          payment_id?: string | null
          provider_reference_id?: string | null
          status?: string | null
          user_id?: string | null
        }
        Update: {
          ad_id?: string | null
          amount?: number | null
          created_at?: string | null
          order_id?: string | null
          payment_id?: string | null
          provider_reference_id?: string | null
          status?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      video_tasks: {
        Row: {
          aspect_ratio: string | null
          asset_id: string | null
          audio_url: string | null
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
          video_model: string | null
        }
        Insert: {
          aspect_ratio?: string | null
          asset_id?: string | null
          audio_url?: string | null
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
          video_model?: string | null
        }
        Update: {
          aspect_ratio?: string | null
          asset_id?: string | null
          audio_url?: string | null
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
          video_model?: string | null
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
      voice_campaigns: {
        Row: {
          audience_filter: Json
          created_at: string | null
          custom_prompt: string | null
          id: string
          name: string
          status: string | null
          user_id: string | null
        }
        Insert: {
          audience_filter: Json
          created_at?: string | null
          custom_prompt?: string | null
          id?: string
          name: string
          status?: string | null
          user_id?: string | null
        }
        Update: {
          audience_filter?: Json
          created_at?: string | null
          custom_prompt?: string | null
          id?: string
          name?: string
          status?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "voice_campaigns_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      wallet_transactions: {
        Row: {
          amount: number | null
          created_at: string | null
          description: string | null
          id: string
          provider_reference_id: string | null
          status: string | null
          type: string | null
          user_id: string | null
        }
        Insert: {
          amount?: number | null
          created_at?: string | null
          description?: string | null
          id?: string
          provider_reference_id?: string | null
          status?: string | null
          type?: string | null
          user_id?: string | null
        }
        Update: {
          amount?: number | null
          created_at?: string | null
          description?: string | null
          id?: string
          provider_reference_id?: string | null
          status?: string | null
          type?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wallet_transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      wallets: {
        Row: {
          balance: number | null
          currency: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          balance?: number | null
          currency?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          balance?: number | null
          currency?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wallets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_broadcast_recipients: {
        Row: {
          broadcast_id: string | null
          created_at: string | null
          error_message: string | null
          id: string
          lead_id: string | null
          phone_number: string | null
          sent_at: string | null
          status: string | null
          user_id: string | null
        }
        Insert: {
          broadcast_id?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          lead_id?: string | null
          phone_number?: string | null
          sent_at?: string | null
          status?: string | null
          user_id?: string | null
        }
        Update: {
          broadcast_id?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          lead_id?: string | null
          phone_number?: string | null
          sent_at?: string | null
          status?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_broadcast_recipients_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_broadcast_recipients_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_broadcasts: {
        Row: {
          created_at: string | null
          id: string
          recipient_property_id: string | null
          recipient_stage: string | null
          scheduled_at: string | null
          sent_at: string | null
          status: string | null
          template_name: string | null
          title: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          recipient_property_id?: string | null
          recipient_stage?: string | null
          scheduled_at?: string | null
          sent_at?: string | null
          status?: string | null
          template_name?: string | null
          title?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          recipient_property_id?: string | null
          recipient_stage?: string | null
          scheduled_at?: string | null
          sent_at?: string | null
          status?: string | null
          template_name?: string | null
          title?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_broadcasts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_chats: {
        Row: {
          created_at: string
          current_flow_id: string | null
          current_question_index: number | null
          flow_answers: Json | null
          flow_completed: boolean | null
          id: string
          last_message_text: string | null
          lead_id: string | null
          qualifying_flow_active: boolean | null
          recipient_name: string | null
          recipient_phone: string
          unread_count: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_flow_id?: string | null
          current_question_index?: number | null
          flow_answers?: Json | null
          flow_completed?: boolean | null
          id?: string
          last_message_text?: string | null
          lead_id?: string | null
          qualifying_flow_active?: boolean | null
          recipient_name?: string | null
          recipient_phone: string
          unread_count?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_flow_id?: string | null
          current_question_index?: number | null
          flow_answers?: Json | null
          flow_completed?: boolean | null
          id?: string
          last_message_text?: string | null
          lead_id?: string | null
          qualifying_flow_active?: boolean | null
          recipient_name?: string | null
          recipient_phone?: string
          unread_count?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_chats_current_flow_id_fkey"
            columns: ["current_flow_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_question_flows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_chats_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_chats_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_flows: {
        Row: {
          campaign_name: string | null
          created_at: string | null
          delay_minutes: number | null
          description: string | null
          header_media_url: string | null
          icon_name: string | null
          id: string
          is_active: boolean | null
          property_id: string | null
          template_body: string | null
          template_name: string | null
          title: string | null
          user_id: string | null
          variables_mapping: Json | null
        }
        Insert: {
          campaign_name?: string | null
          created_at?: string | null
          delay_minutes?: number | null
          description?: string | null
          header_media_url?: string | null
          icon_name?: string | null
          id?: string
          is_active?: boolean | null
          property_id?: string | null
          template_body?: string | null
          template_name?: string | null
          title?: string | null
          user_id?: string | null
          variables_mapping?: Json | null
        }
        Update: {
          campaign_name?: string | null
          created_at?: string | null
          delay_minutes?: number | null
          description?: string | null
          header_media_url?: string | null
          icon_name?: string | null
          id?: string
          is_active?: boolean | null
          property_id?: string | null
          template_body?: string | null
          template_name?: string | null
          title?: string | null
          user_id?: string | null
          variables_mapping?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_flows_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_flows_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_messages: {
        Row: {
          chat_id: string
          created_at: string
          direction: string
          id: string
          media_type: string | null
          media_url: string | null
          message_text: string | null
        }
        Insert: {
          chat_id: string
          created_at?: string
          direction: string
          id?: string
          media_type?: string | null
          media_url?: string | null
          message_text?: string | null
        }
        Update: {
          chat_id?: string
          created_at?: string
          direction?: string
          id?: string
          media_type?: string | null
          media_url?: string | null
          message_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_messages_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_chats"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_question_flows: {
        Row: {
          created_at: string
          id: string
          is_active: boolean | null
          linked_campaign_id: string | null
          name: string
          questions: Json
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean | null
          linked_campaign_id?: string | null
          name: string
          questions?: Json
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean | null
          linked_campaign_id?: string | null
          name?: string
          questions?: Json
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_question_flows_user_id_fkey"
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
      migrate_auth_identity: {
        Args: {
          p_created_at: string
          p_id: string
          p_identity_data: Json
          p_last_sign_in_at: string
          p_provider: string
          p_updated_at: string
          p_user_id: string
        }
        Returns: undefined
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
