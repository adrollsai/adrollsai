const fs = require('fs');
const dotenv = require('dotenv');
const env = dotenv.parse(fs.readFileSync('.env.local'));
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

async function query(table, params = '') {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${params}`, {
        headers: {
            'Authorization': `Bearer ${SERVICE_KEY}`,
            'apikey': SERVICE_KEY,
            'Content-Type': 'application/json'
        }
    });
    return res.json();
}

async function main() {
    console.log("=== 1. FETCHING BLUESQUARE PROFILE ===");
    const profiles = await query('profiles', '?email=eq.infobluesquareinfra@gmail.com');
    if (!profiles || profiles.length === 0) {
        console.log("Profile not found");
        return;
    }
    const profile = profiles[0];
    console.log("Profile ID:", profile.id);
    console.log("Business:", profile.business_name);
    console.log("Meta Lead Sync Enabled:", profile.meta_lead_sync_enabled);
    console.log("Meta Ad Account ID:", profile.meta_ad_account_id || profile.facebook_ad_account_id);
    console.log("Facebook Page ID:", profile.facebook_page_id);
    console.log("Facebook Page Name:", profile.facebook_page_name);
    console.log("Lead Routing Rules / Config:", profile.lead_routing_rules || profile.lead_assignment_rules || profile.routing_rules);

    const userId = profile.id;

    console.log("\n=== 2. ASSIGNMENT RULES / AUTOMATIONS ===");
    const automations = await query('automations', `?user_id=eq.${userId}`);
    console.log("Automations count:", Array.isArray(automations) ? automations.length : automations);
    if (Array.isArray(automations)) {
        automations.forEach(a => {
            console.log(`- Title: ${a.title}, Type: ${a.type}, Active: ${a.is_active}, Trigger: ${a.trigger_type}`);
            console.log(`  Config/Actions:`, JSON.stringify(a.actions || a.config || a.meta_data || a.rules || a));
        });
    }

    console.log("\n=== 3. TEAM MEMBERS & SUB ACCOUNTS ===");
    const teamMembers = await query('team_members', `?owner_id=eq.${userId}`);
    console.log("Team members:", teamMembers);
    const subProfiles = await query('profiles', `?parent_account_id=eq.${userId}`);
    console.log("Sub profiles:", subProfiles.map(p => ({ id: p.id, name: p.full_name || p.name, email: p.email, role: p.role })));

    console.log("\n=== 4. CAMPAIGNS IN SYSTEM ===");
    const campaigns = await query('campaigns', `?user_id=eq.${userId}`);
    console.log("Campaigns:", campaigns.map(c => ({ id: c.id, name: c.name, status: c.status, platform: c.platform, created_at: c.created_at })));

    console.log("\n=== 5. RECENT LEADS (LAST 100) ===");
    const leads = await query('leads', `?user_id=eq.${userId}&order=created_at.desc&limit=100`);
    console.log(`Total fetched leads: ${Array.isArray(leads) ? leads.length : 0}`);
    if (Array.isArray(leads)) {
        // Group by campaign
        const byCampaign = {};
        const byAssigned = {};
        const byDate = {};

        leads.forEach(l => {
            const camp = l.campaign || l.campaign_name || l.ad_name || 'No Campaign';
            byCampaign[camp] = (byCampaign[camp] || 0) + 1;

            const assignee = l.assigned_to || l.assigned_to_user_id || 'UNASSIGNED';
            byAssigned[assignee] = (byAssigned[assignee] || 0) + 1;

            const date = (l.created_at || '').slice(0, 10);
            byDate[date] = (byDate[date] || 0) + 1;
        });

        console.log("\nLeads Count by Date (Recent):", byDate);
        console.log("\nLeads Count by Campaign:", byCampaign);
        console.log("\nLeads Count by Assigned To:", byAssigned);

        console.log("\n--- Sample of Last 20 Leads Details ---");
        leads.slice(0, 20).forEach(l => {
            console.log(`[${l.created_at}] ID: ${l.id} | Name: ${l.name} | Phone: ${l.phone} | Campaign: ${l.campaign || l.campaign_name || l.ad_name || 'N/A'} | Source: ${l.source} | Assigned: ${l.assigned_to} (${l.assigned_to_user_id || 'no_uid'}) | Stage: ${l.stage}`);
        });
    }
}

main().catch(console.error);
