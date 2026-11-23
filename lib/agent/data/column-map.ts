/**
 * Which tables and columns the scoped data query may touch. GENERATED from the live schema.
 *
 * Do not hand-edit the column lists: regenerate them (`.work/gen-column-map.mjs` pattern) so the
 * tool can never offer a column the table does not have. That failure has already happened once in
 * this codebase — `nobogent_inventory_search` asked for `location` on a table that calls it
 * `address` and reported the catalogue as empty.
 *
 * `ownerColumn` is the column the scope filter is applied to. It is NOT user-supplied: the tool
 * injects it, which is what makes "only their data" a property of the code rather than of the model's
 * good behaviour.
 */

export interface QueryableTable {
  /** The column that identifies the owning account. */
  ownerColumn: string;
  /** Every column that may be selected, filtered, grouped or aggregated. */
  columns: string[];
  /** Present for completeness only: these are dropped before the map is written. */
  redacted?: string[];
}

export const QUERYABLE_TABLES: Record<string, QueryableTable> = {
  leads: {
    ownerColumn: 'user_id',
    columns: ['ad_name', 'assigned_to', 'autonomous_status', 'booked_time', 'booking_reminder_sent', 'budget', 'calling_enabled', 'campaign_id', 'created_at', 'csv_audience', 'custom_fields', 'dnp_count', 'email', 'external_id', 'facebook_created_at', 'facebook_lead_id', 'form_id', 'form_name', 'google_calendar_event_id', 'id', 'last_activity_at', 'last_agent_thought', 'last_call_at', 'last_call_status', 'last_called_by', 'meet_link', 'name', 'next_action_due_at', 'next_followup', 'notes', 'opted_out', 'phone', 'pipeline_stage', 'pixel_id', 'priority_status', 'processing_lock_until', 'property_id', 'reminder_15m_sent', 'reminder_1h_sent', 'reminder_24h_sent', 'reminder_4h_sent', 'source', 'status', 'summary', 'timeline', 'updated_at', 'user_id', 'value', 'voice_call_id', 'voice_call_retry_count', 'voice_call_scheduled_at', 'voice_call_status', 'voice_call_summary', 'voice_call_transcript', 'voice_campaign_id', 'voice_recording_url', 'whatsapp_enabled', 'whatsapp_window_expires_at'],
  },
  call_logs: {
    ownerColumn: 'user_id',
    columns: ['call_type', 'created_at', 'duration', 'id', 'lead_id', 'notes', 'phone_number', 'recording_url', 'started_at', 'status', 'user_id'],
  },
  campaigns: {
    ownerColumn: 'user_id',
    columns: ['budget_type', 'created_at', 'end_time', 'id', 'meta_ad_id', 'meta_adset_id', 'meta_campaign_id', 'name', 'start_time', 'status', 'total_budget', 'user_id'],
  },
  properties: {
    ownerColumn: 'user_id',
    columns: ['address', 'auto_generate', 'brochure_url', 'configurations', 'created_at', 'description', 'floor_plan_url', 'id', 'image_descriptions', 'image_url', 'images', 'marketing_copy_template', 'master_creatives', 'meta_campaign_id', 'meta_campaign_status', 'organization_id', 'price', 'property_type', 'rera_number', 'show_on_landing_page', 'status', 'template_adset_id', 'template_campaign_id', 'title', 'user_id', 'youtube_url'],
  },
  voice_campaigns: {
    ownerColumn: 'user_id',
    columns: ['audience_filter', 'created_at', 'custom_prompt', 'id', 'name', 'status', 'user_id'],
  },
  whatsapp_broadcasts: {
    ownerColumn: 'user_id',
    columns: ['blocked_count', 'created_at', 'failed_count', 'id', 'last_progress_at', 'pause_reason', 'pending_count', 'recipient_csv_audience', 'recipient_property_id', 'recipient_stage', 'scheduled_at', 'sent_at', 'sent_count', 'status', 'template_name', 'title', 'total_recipients', 'user_id'],
  },
  whatsapp_chats: {
    ownerColumn: 'user_id',
    columns: ['created_at', 'current_flow_id', 'current_question_index', 'flow_answers', 'flow_completed', 'id', 'last_message_text', 'lead_id', 'qualifying_flow_active', 'recipient_name', 'recipient_phone', 'unread_count', 'updated_at', 'user_id'],
  },
  lead_history: {
    ownerColumn: 'user_id',
    columns: ['action_type', 'actor_id', 'created_at', 'description', 'id', 'lead_id', 'user_id'],
  },
  credit_transactions: {
    ownerColumn: 'user_id',
    columns: ['amount', 'category', 'created_at', 'description', 'id', 'ref', 'user_id'],
  },
  harness_runs: {
    ownerColumn: 'user_id',
    columns: ['attempts', 'cancel_requested', 'checkpoint', 'continuations', 'created_at', 'dead_at', 'deadline_at', 'error', 'finished_at', 'goal', 'id', 'last_heartbeat_at', 'lease_expires_at', 'lease_owner', 'max_attempts', 'max_continuations', 'next_attempt_at', 'priority', 'session_id', 'started_at', 'status', 'updated_at', 'user_id'],
    // never returned, to anyone: idempotency_key
    redacted: ['idempotency_key'],
  },
  harness_sessions: {
    ownerColumn: 'user_id',
    columns: ['created_at', 'id', 'status', 'title', 'updated_at', 'user_id', 'workspace_id'],
  },
  business_routines: {
    ownerColumn: 'user_id',
    columns: ['approval_policy', 'cadence', 'channels', 'created_at', 'daily_credit_cap', 'enabled', 'id', 'intent', 'last_run_at', 'name', 'next_run_at', 'run_at_hour', 'timezone', 'tool_groups', 'updated_at', 'user_id', 'version'],
  },
  landing_pages: {
    ownerColumn: 'user_id',
    columns: ['booking_enabled', 'created_at', 'form_id', 'html_content', 'id', 'pixel_id', 'product_name', 'property_id', 'slug', 'title', 'updated_at', 'user_id'],
  },
  assets: {
    ownerColumn: 'user_id',
    columns: ['caption', 'created_at', 'id', 'kie_task_id', 'master_creative_id', 'metadata', 'product_id', 'property_id', 'share_stats', 'status', 'type', 'url', 'user_id'],
  },
  agent_events: {
    ownerColumn: 'user_id',
    columns: ['attempts', 'created_at', 'error_message', 'event_type', 'id', 'lead_id', 'payload', 'scheduled_for', 'status', 'updated_at', 'user_id'],
  },
  campaign_jobs: {
    ownerColumn: 'user_id',
    columns: ['campaign_id', 'created_at', 'id', 'message', 'payload', 'status', 'target_user_id', 'updated_at', 'user_id'],
  },
  profiles: {
    ownerColumn: 'id',
    columns: ['accepted_terms', 'ad_account_id', 'ad_credits', 'address', 'agency_id', 'ai_ad_optimizations_used', 'ai_creatives_used', 'auto_call_new_leads', 'avatar_audio_url', 'avatar_description', 'avatar_url', 'badges', 'brand_color', 'business_info', 'business_landing_enabled', 'business_landing_hero_subtitle', 'business_landing_hero_title', 'business_landing_show_products', 'business_name', 'calling_credits', 'campaign_launches_used', 'character_audio_url', 'character_description', 'character_url', 'client_features', 'contact_digits', 'contact_digits_rev', 'contact_number', 'created_at', 'credits', 'currency', 'current_streak', 'custom_domain', 'custom_prompt', 'domain_verify_status', 'elevenlabs_agent_id', 'email', 'enable_distribution', 'enable_eod_report', 'facebook_url', 'full_name', 'google_booking_duration', 'google_booking_enabled', 'google_booking_hours', 'google_business_location_id', 'google_calendar_id', 'google_place_id', 'google_review_url', 'id', 'industry', 'instagram_url', 'is_disabled', 'last_activity_date', 'last_ai_analysis', 'level', 'linkedin_id', 'linkedin_name', 'linkedin_url', 'linkedin_urn', 'logo_url', 'missed_call_custom_template', 'missed_call_flow_type', 'missed_call_platform', 'missed_call_textback_enabled', 'mission_statement', 'notification_preferences', 'old_voice_twilio_number', 'onboarding_completed', 'organization_id', 'parent_id', 'pixel_id', 'qualifying_enabled', 'qualifying_questions', 'remarketing_campaigns_used', 'role', 'selected_page_id', 'selected_page_name', 'selected_templates', 'selected_text_llm', 'seo_articles_used', 'storage_bytes_used', 'subscription_plan', 'subscription_status', 'subscription_valid_until', 'timezone', 'total_xp', 'usage_reset_date', 'voice_name', 'voice_provider', 'voice_twilio_number', 'voice_twilio_sid', 'whatsapp_business_account_id', 'whatsapp_buttons', 'whatsapp_catalogue_button_text', 'whatsapp_connected_at', 'whatsapp_digits', 'whatsapp_digits_rev', 'whatsapp_personal_number', 'whatsapp_phone_number', 'whatsapp_phone_number_id', 'whatsapp_waba_id', 'whitelabel_domain', 'whitelabel_verify_status', 'youtube_url'],
    // never returned, to anyone: domain_verify_token, elevenlabs_api_key, facebook_token, google_business_refresh_token, google_business_token, google_refresh_token, linkedin_token, selected_page_token, voice_twilio_token, webhook_token_99acres, whatsapp_access_token, whitelabel_verify_token, youtube_refresh_token, youtube_token
    redacted: ['domain_verify_token', 'elevenlabs_api_key', 'facebook_token', 'google_business_refresh_token', 'google_business_token', 'google_refresh_token', 'linkedin_token', 'selected_page_token', 'voice_twilio_token', 'webhook_token_99acres', 'whatsapp_access_token', 'whitelabel_verify_token', 'youtube_refresh_token', 'youtube_token'],
  },
};

export const QUERYABLE_TABLE_NAMES = Object.keys(QUERYABLE_TABLES);

export function queryableTable(name: string): QueryableTable | null {
  return QUERYABLE_TABLES[String(name ?? '').trim()] ?? null;
}

export function isQueryableColumn(table: string, column: string): boolean {
  const spec = queryableTable(table);
  return !!spec && spec.columns.includes(String(column ?? '').trim());
}
