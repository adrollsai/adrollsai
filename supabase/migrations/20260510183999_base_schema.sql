-- Base Remote Schema generated from OpenAPI definitions

-- Create organizations table
CREATE TABLE IF NOT EXISTS public.organizations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz,
    name text,
    brand_color text,
    master_logo_url text,
    custom_domain text,
    ad_subsidy_percentage integer,
    master_adset_id text,
    master_campaign_id text,
    xp_structure jsonb,
    agent_limit integer,
    business_model text
);

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- Create profiles table
CREATE TABLE IF NOT EXISTS public.profiles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz,
    email text,
    business_name text,
    contact_number text,
    organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
    role text,
    logo_url text,
    brand_color text,
    mission_statement text,
    facebook_token text,
    facebook_url text,
    instagram_url text,
    linkedin_token text,
    linkedin_url text,
    linkedin_urn text,
    youtube_token text,
    youtube_refresh_token text,
    youtube_url text,
    google_business_token text,
    google_business_refresh_token text,
    google_business_location_id text,
    ad_account_id text,
    pixel_id text,
    selected_page_id text,
    selected_page_name text,
    selected_page_token text,
    current_streak integer,
    last_activity_date timestamptz,
    total_xp integer,
    level integer,
    badges text[],
    whatsapp_business_account_id text,
    whatsapp_phone_number_id text,
    whatsapp_access_token text,
    ad_credits integer,
    custom_domain text,
    parent_id uuid,
    enable_distribution boolean,
    subscription_plan text,
    subscription_status text,
    subscription_valid_until timestamptz,
    domain_verify_token text,
    domain_verify_status text,
    address text,
    ai_creatives_used integer,
    campaign_launches_used integer,
    ai_ad_optimizations_used integer,
    remarketing_campaigns_used integer,
    seo_articles_used integer,
    storage_bytes_used bigint,
    usage_reset_date timestamptz,
    custom_prompt text,
    agency_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    linkedin_id text,
    linkedin_name text,
    whitelabel_domain text,
    whitelabel_verify_token text,
    whitelabel_verify_status text,
    currency text,
    character_url text,
    character_description text,
    business_info text,
    character_audio_url text,
    onboarding_completed boolean,
    google_refresh_token text,
    google_booking_enabled boolean,
    google_booking_duration integer,
    google_booking_hours jsonb,
    google_calendar_id text,
    webhook_token_99acres text,
    whatsapp_waba_id text,
    whatsapp_phone_number text,
    whatsapp_connected_at timestamptz,
    avatar_url text,
    avatar_description text,
    avatar_audio_url text
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Create wallets table
CREATE TABLE IF NOT EXISTS public.wallets (
    user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
    balance numeric,
    currency text,
    updated_at timestamptz
);

ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;

-- Create properties table
CREATE TABLE IF NOT EXISTS public.properties (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz,
    user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
    organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
    title text,
    address text,
    price text,
    description text,
    property_type text,
    status text,
    image_url text,
    images text[],
    master_creatives text[],
    marketing_copy_template text,
    rera_number text,
    brochure_url text,
    floor_plan_url text,
    configurations text,
    meta_campaign_id text,
    meta_campaign_status text,
    template_campaign_id text,
    template_adset_id text,
    auto_generate boolean,
    youtube_url text
);

ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;

-- Create leads table
CREATE TABLE IF NOT EXISTS public.leads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz,
    user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
    name text,
    email text,
    phone text,
    notes text,
    status text,
    pipeline_stage text,
    source text,
    ad_name text,
    facebook_lead_id text,
    external_id text,
    summary text,
    value numeric,
    next_followup timestamptz,
    assigned_to uuid,
    budget text,
    timeline text,
    priority_status text,
    facebook_created_at timestamptz,
    form_id text,
    form_name text,
    custom_fields text,
    booked_time timestamptz,
    pixel_id text,
    property_id uuid REFERENCES public.properties(id) ON DELETE SET NULL,
    meet_link text,
    booking_reminder_sent boolean,
    campaign_id text
);

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

-- Create master_creatives table
CREATE TABLE IF NOT EXISTS public.master_creatives (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz,
    property_id uuid REFERENCES public.properties(id) ON DELETE SET NULL,
    url text,
    type text,
    caption_template text,
    is_active boolean,
    layout_config text
);

ALTER TABLE public.master_creatives ENABLE ROW LEVEL SECURITY;

-- Create assets table
CREATE TABLE IF NOT EXISTS public.assets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz,
    user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
    url text,
    type text,
    status text,
    property_id uuid REFERENCES public.properties(id) ON DELETE SET NULL,
    master_creative_id uuid REFERENCES public.master_creatives(id) ON DELETE SET NULL,
    share_stats jsonb,
    caption text,
    kie_task_id text,
    metadata jsonb
);

ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;

-- Create campaigns table
CREATE TABLE IF NOT EXISTS public.campaigns (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
    meta_campaign_id text,
    meta_adset_id text,
    meta_ad_id text,
    name text,
    status text,
    budget_type text,
    total_budget integer,
    start_time timestamptz,
    end_time timestamptz,
    created_at timestamptz
);

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

-- Create ads table
CREATE TABLE IF NOT EXISTS public.ads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz,
    title text,
    description text,
    price integer,
    image_url text
);

ALTER TABLE public.ads ENABLE ROW LEVEL SECURITY;

-- Create external_agents table
CREATE TABLE IF NOT EXISTS public.external_agents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz,
    business_name text,
    contact_number text,
    email text,
    logo_url text,
    address text,
    user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE
);

ALTER TABLE public.external_agents ENABLE ROW LEVEL SECURITY;

-- Create transactions table
CREATE TABLE IF NOT EXISTS public.transactions (
    order_id text,
    user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
    ad_id uuid,
    amount integer,
    status text,
    provider_reference_id text,
    created_at timestamptz,
    payment_id text
);

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- Create posts table
CREATE TABLE IF NOT EXISTS public.posts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz,
    user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
    title text,
    content text,
    excerpt text,
    image_url text,
    status text,
    tags text[],
    media_type text,
    media_url text,
    file_path text,
    link_url text,
    youtube_url text
);

ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;

-- Create distribution_batches table
CREATE TABLE IF NOT EXISTS public.distribution_batches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz,
    user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
    master_image_url text,
    total_count integer,
    completed_count integer,
    status text
);

ALTER TABLE public.distribution_batches ENABLE ROW LEVEL SECURITY;

-- Create whatsapp_broadcast_recipients table
CREATE TABLE IF NOT EXISTS public.whatsapp_broadcast_recipients (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    broadcast_id uuid,
    lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,
    user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
    phone_number text,
    status text,
    sent_at timestamptz,
    error_message text,
    created_at timestamptz
);

ALTER TABLE public.whatsapp_broadcast_recipients ENABLE ROW LEVEL SECURITY;

-- Create whatsapp_flows table
CREATE TABLE IF NOT EXISTS public.whatsapp_flows (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
    title text,
    description text,
    icon_name text,
    is_active boolean,
    template_name text,
    template_body text,
    delay_minutes integer,
    created_at timestamptz,
    property_id uuid REFERENCES public.properties(id) ON DELETE SET NULL,
    campaign_name text,
    variables_mapping jsonb,
    header_media_url text
);

ALTER TABLE public.whatsapp_flows ENABLE ROW LEVEL SECURITY;

-- Create agent_ad_campaigns table
CREATE TABLE IF NOT EXISTS public.agent_ad_campaigns (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
    org_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
    fb_adset_id text,
    fb_campaign_id text,
    status text,
    total_budget numeric,
    agent_contribution numeric,
    subsidy_amount numeric,
    created_at timestamptz
);

ALTER TABLE public.agent_ad_campaigns ENABLE ROW LEVEL SECURITY;

-- Create lead_history table
CREATE TABLE IF NOT EXISTS public.lead_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,
    user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
    action_type text,
    description text,
    created_at timestamptz
);

ALTER TABLE public.lead_history ENABLE ROW LEVEL SECURITY;

-- Create whatsapp_broadcasts table
CREATE TABLE IF NOT EXISTS public.whatsapp_broadcasts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
    title text,
    template_name text,
    recipient_stage text,
    recipient_property_id uuid,
    scheduled_at timestamptz,
    sent_at timestamptz,
    status text,
    created_at timestamptz
);

ALTER TABLE public.whatsapp_broadcasts ENABLE ROW LEVEL SECURITY;

-- Create automations table
CREATE TABLE IF NOT EXISTS public.automations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz,
    user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
    title text,
    description text,
    icon_name text,
    is_active boolean,
    stats text
);

ALTER TABLE public.automations ENABLE ROW LEVEL SECURITY;

-- Create organization_members table
CREATE TABLE IF NOT EXISTS public.organization_members (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
    role text,
    created_at timestamptz
);

ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

-- Create fractions table
CREATE TABLE IF NOT EXISTS public.fractions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id uuid REFERENCES public.properties(id) ON DELETE SET NULL,
    fraction_number integer,
    name text,
    status text,
    created_at timestamptz
);

ALTER TABLE public.fractions ENABLE ROW LEVEL SECURITY;

-- Create wallet_transactions table
CREATE TABLE IF NOT EXISTS public.wallet_transactions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
    amount numeric,
    type text,
    status text,
    provider_reference_id text,
    description text,
    created_at timestamptz
);

ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;

-- Create distribution_items table
CREATE TABLE IF NOT EXISTS public.distribution_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz,
    batch_id uuid REFERENCES public.distribution_batches(id) ON DELETE CASCADE,
    user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
    agent_data jsonb,
    status text,
    result_url text,
    email_sent boolean,
    error_message text
);

ALTER TABLE public.distribution_items ENABLE ROW LEVEL SECURITY;

-- Create notifications table
CREATE TABLE IF NOT EXISTS public.notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
    title text,
    message text,
    type text,
    action_link text,
    is_read boolean,
    created_at timestamptz
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Create landing_pages table
CREATE TABLE IF NOT EXISTS public.landing_pages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
    slug text,
    title text,
    product_name text,
    html_content text,
    form_id uuid,
    created_at timestamptz,
    updated_at timestamptz,
    booking_enabled boolean,
    pixel_id text,
    property_id uuid REFERENCES public.properties(id) ON DELETE SET NULL
);

ALTER TABLE public.landing_pages ENABLE ROW LEVEL SECURITY;

-- Create push_subscriptions table
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
    endpoint text,
    p256dh text,
    auth text,
    created_at timestamptz,
    catalog_owner_id uuid
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Create property_co_owners table
CREATE TABLE IF NOT EXISTS public.property_co_owners (
    property_id uuid REFERENCES public.properties(id) ON DELETE SET NULL,
    owner_name text,
    owner_image text,
    fraction_number integer
);

ALTER TABLE public.property_co_owners ENABLE ROW LEVEL SECURITY;

-- Create creative_prompts table
CREATE TABLE IF NOT EXISTS public.creative_prompts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
    prompt_text text,
    is_used boolean,
    created_at timestamptz,
    used_at timestamptz,
    property_id uuid REFERENCES public.properties(id) ON DELETE SET NULL
);

ALTER TABLE public.creative_prompts ENABLE ROW LEVEL SECURITY;

-- Create customer_holdings table
CREATE TABLE IF NOT EXISTS public.customer_holdings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
    fraction_id uuid,
    purchase_price numeric,
    purchase_date timestamptz,
    documents text,
    created_at timestamptz
);

ALTER TABLE public.customer_holdings ENABLE ROW LEVEL SECURITY;

