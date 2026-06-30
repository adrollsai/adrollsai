-- Create missing base tables that were skipped due to incomplete base schema migration

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

-- Create wallets table
CREATE TABLE IF NOT EXISTS public.wallets (
    user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
    balance numeric,
    currency text,
    updated_at timestamptz
);

ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;

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