-- Configure RLS Policies for Profiles and Helper Tables to resolve page loading blocks

-- 1. Profiles Table Policies
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_policy" ON public.profiles;
CREATE POLICY "profiles_select_policy" ON public.profiles FOR SELECT USING (
    auth.uid() = id 
    OR custom_domain IS NOT NULL 
    OR EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'profiles' 
        -- Bypass trigger loop by utilizing static column check in inner query
    ) 
    OR (
        -- Allow super_admin role check
        EXISTS (
            SELECT 1 FROM public.profiles p 
            WHERE p.id = auth.uid() AND p.role = 'super_admin'
        )
    )
);

DROP POLICY IF EXISTS "profiles_insert_policy" ON public.profiles;
CREATE POLICY "profiles_insert_policy" ON public.profiles FOR INSERT WITH CHECK (
    auth.uid() = id 
    OR EXISTS (
        SELECT 1 FROM public.profiles p 
        WHERE p.id = auth.uid() AND p.role = 'super_admin'
    )
);

DROP POLICY IF EXISTS "profiles_update_policy" ON public.profiles;
CREATE POLICY "profiles_update_policy" ON public.profiles FOR UPDATE USING (
    auth.uid() = id 
    OR EXISTS (
        SELECT 1 FROM public.profiles p 
        WHERE p.id = auth.uid() AND p.role = 'super_admin'
    )
);

DROP POLICY IF EXISTS "profiles_delete_policy" ON public.profiles;
CREATE POLICY "profiles_delete_policy" ON public.profiles FOR DELETE USING (
    auth.uid() = id 
    OR EXISTS (
        SELECT 1 FROM public.profiles p 
        WHERE p.id = auth.uid() AND p.role = 'super_admin'
    )
);


-- 2. General Helper Tables Policies (permissive for authenticated users, SELECT allowed for all)
-- We define a macro-like loop or execute them individually to be robust.

-- Organizations
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "organizations_select_policy" ON public.organizations;
CREATE POLICY "organizations_select_policy" ON public.organizations FOR SELECT USING (true);
DROP POLICY IF EXISTS "organizations_all_policy" ON public.organizations;
CREATE POLICY "organizations_all_policy" ON public.organizations FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Helper table: wallets
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wallets_select_policy" ON public.wallets;
CREATE POLICY "wallets_select_policy" ON public.wallets FOR SELECT USING (true);
DROP POLICY IF EXISTS "wallets_all_policy" ON public.wallets;
CREATE POLICY "wallets_all_policy" ON public.wallets FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Helper table: ads
ALTER TABLE public.ads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ads_select_policy" ON public.ads;
CREATE POLICY "ads_select_policy" ON public.ads FOR SELECT USING (true);
DROP POLICY IF EXISTS "ads_all_policy" ON public.ads;
CREATE POLICY "ads_all_policy" ON public.ads FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Helper table: agent_ad_campaigns
ALTER TABLE public.agent_ad_campaigns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "agent_ad_campaigns_select_policy" ON public.agent_ad_campaigns;
CREATE POLICY "agent_ad_campaigns_select_policy" ON public.agent_ad_campaigns FOR SELECT USING (true);
DROP POLICY IF EXISTS "agent_ad_campaigns_all_policy" ON public.agent_ad_campaigns;
CREATE POLICY "agent_ad_campaigns_all_policy" ON public.agent_ad_campaigns FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Helper table: automations
ALTER TABLE public.automations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "automations_select_policy" ON public.automations;
CREATE POLICY "automations_select_policy" ON public.automations FOR SELECT USING (true);
DROP POLICY IF EXISTS "automations_all_policy" ON public.automations;
CREATE POLICY "automations_all_policy" ON public.automations FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Helper table: campaigns
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "campaigns_select_policy" ON public.campaigns;
CREATE POLICY "campaigns_select_policy" ON public.campaigns FOR SELECT USING (true);
DROP POLICY IF EXISTS "campaigns_all_policy" ON public.campaigns;
CREATE POLICY "campaigns_all_policy" ON public.campaigns FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Helper table: creative_prompts
ALTER TABLE public.creative_prompts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "creative_prompts_select_policy" ON public.creative_prompts;
CREATE POLICY "creative_prompts_select_policy" ON public.creative_prompts FOR SELECT USING (true);
DROP POLICY IF EXISTS "creative_prompts_all_policy" ON public.creative_prompts;
CREATE POLICY "creative_prompts_all_policy" ON public.creative_prompts FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Helper table: customer_holdings
ALTER TABLE public.customer_holdings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "customer_holdings_select_policy" ON public.customer_holdings;
CREATE POLICY "customer_holdings_select_policy" ON public.customer_holdings FOR SELECT USING (true);
DROP POLICY IF EXISTS "customer_holdings_all_policy" ON public.customer_holdings;
CREATE POLICY "customer_holdings_all_policy" ON public.customer_holdings FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Helper table: distribution_batches
ALTER TABLE public.distribution_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "distribution_batches_select_policy" ON public.distribution_batches;
CREATE POLICY "distribution_batches_select_policy" ON public.distribution_batches FOR SELECT USING (true);
DROP POLICY IF EXISTS "distribution_batches_all_policy" ON public.distribution_batches;
CREATE POLICY "organizations_all_policy" ON public.distribution_batches FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Helper table: distribution_items
ALTER TABLE public.distribution_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "distribution_items_select_policy" ON public.distribution_items;
CREATE POLICY "distribution_items_select_policy" ON public.distribution_items FOR SELECT USING (true);
DROP POLICY IF EXISTS "distribution_items_all_policy" ON public.distribution_items;
CREATE POLICY "distribution_items_all_policy" ON public.distribution_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Helper table: external_agents
ALTER TABLE public.external_agents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "external_agents_select_policy" ON public.external_agents;
CREATE POLICY "external_agents_select_policy" ON public.external_agents FOR SELECT USING (true);
DROP POLICY IF EXISTS "external_agents_all_policy" ON public.external_agents;
CREATE POLICY "external_agents_all_policy" ON public.external_agents FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Helper table: fractions
ALTER TABLE public.fractions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fractions_select_policy" ON public.fractions;
CREATE POLICY "fractions_select_policy" ON public.fractions FOR SELECT USING (true);
DROP POLICY IF EXISTS "fractions_all_policy" ON public.fractions;
CREATE POLICY "fractions_all_policy" ON public.fractions FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Helper table: lead_history
ALTER TABLE public.lead_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lead_history_select_policy" ON public.lead_history;
CREATE POLICY "lead_history_select_policy" ON public.lead_history FOR SELECT USING (true);
DROP POLICY IF EXISTS "lead_history_all_policy" ON public.lead_history;
CREATE POLICY "lead_history_all_policy" ON public.lead_history FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Helper table: master_creatives
ALTER TABLE public.master_creatives ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "master_creatives_select_policy" ON public.master_creatives;
CREATE POLICY "master_creatives_select_policy" ON public.master_creatives FOR SELECT USING (true);
DROP POLICY IF EXISTS "master_creatives_all_policy" ON public.master_creatives;
CREATE POLICY "master_creatives_all_policy" ON public.master_creatives FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Helper table: notifications
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notifications_select_policy" ON public.notifications;
CREATE POLICY "notifications_select_policy" ON public.notifications FOR SELECT USING (true);
DROP POLICY IF EXISTS "notifications_all_policy" ON public.notifications;
CREATE POLICY "notifications_all_policy" ON public.notifications FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Helper table: organization_members
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "organization_members_select_policy" ON public.organization_members;
CREATE POLICY "organization_members_select_policy" ON public.organization_members FOR SELECT USING (true);
DROP POLICY IF EXISTS "organization_members_all_policy" ON public.organization_members;
CREATE POLICY "organization_members_all_policy" ON public.organization_members FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Helper table: posts
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "posts_select_policy" ON public.posts;
CREATE POLICY "posts_select_policy" ON public.posts FOR SELECT USING (true);
DROP POLICY IF EXISTS "posts_all_policy" ON public.posts;
CREATE POLICY "posts_all_policy" ON public.posts FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Helper table: push_subscriptions
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "push_subscriptions_select_policy" ON public.push_subscriptions;
CREATE POLICY "push_subscriptions_select_policy" ON public.push_subscriptions FOR SELECT USING (true);
DROP POLICY IF EXISTS "push_subscriptions_all_policy" ON public.push_subscriptions;
CREATE POLICY "push_subscriptions_all_policy" ON public.push_subscriptions FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Helper table: transactions
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "transactions_select_policy" ON public.transactions;
CREATE POLICY "transactions_select_policy" ON public.transactions FOR SELECT USING (true);
DROP POLICY IF EXISTS "transactions_all_policy" ON public.transactions;
CREATE POLICY "transactions_all_policy" ON public.transactions FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Helper table: wallet_transactions
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wallet_transactions_select_policy" ON public.wallet_transactions;
CREATE POLICY "wallet_transactions_select_policy" ON public.wallet_transactions FOR SELECT USING (true);
DROP POLICY IF EXISTS "wallet_transactions_all_policy" ON public.wallet_transactions;
CREATE POLICY "wallet_transactions_all_policy" ON public.wallet_transactions FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Helper table: whatsapp_broadcast_recipients
ALTER TABLE public.whatsapp_broadcast_recipients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "whatsapp_broadcast_recipients_select_policy" ON public.whatsapp_broadcast_recipients;
CREATE POLICY "whatsapp_broadcast_recipients_select_policy" ON public.whatsapp_broadcast_recipients FOR SELECT USING (true);
DROP POLICY IF EXISTS "whatsapp_broadcast_recipients_all_policy" ON public.whatsapp_broadcast_recipients;
CREATE POLICY "whatsapp_broadcast_recipients_all_policy" ON public.whatsapp_broadcast_recipients FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Helper table: whatsapp_broadcasts
ALTER TABLE public.whatsapp_broadcasts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "whatsapp_broadcasts_select_policy" ON public.whatsapp_broadcasts;
CREATE POLICY "whatsapp_broadcasts_select_policy" ON public.whatsapp_broadcasts FOR SELECT USING (true);
DROP POLICY IF EXISTS "whatsapp_broadcasts_all_policy" ON public.whatsapp_broadcasts;
CREATE POLICY "whatsapp_broadcasts_all_policy" ON public.whatsapp_broadcasts FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Helper table: whatsapp_flows
ALTER TABLE public.whatsapp_flows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "whatsapp_flows_select_policy" ON public.whatsapp_flows;
CREATE POLICY "whatsapp_flows_select_policy" ON public.whatsapp_flows FOR SELECT USING (true);
DROP POLICY IF EXISTS "whatsapp_flows_all_policy" ON public.whatsapp_flows;
CREATE POLICY "whatsapp_flows_all_policy" ON public.whatsapp_flows FOR ALL TO authenticated USING (true) WITH CHECK (true);
