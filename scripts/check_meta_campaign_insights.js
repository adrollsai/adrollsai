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
    const profiles = await query('profiles', '?email=eq.infobluesquareinfra@gmail.com');
    const profile = profiles[0];
    const userId = profile.id;
    const token = profile.facebook_token || profile.selected_page_token;
    let adAccountId = profile.ad_account_id || profile.facebook_ad_account_id;

    console.log("=== CHECKING AD ACCOUNT CAMPAIGNS & INSIGHTS ===");
    console.log("Profile Ad Account ID:", adAccountId);

    if (!adAccountId && token) {
        // Fetch ad accounts for user
        const adAccRes = await fetch(`https://graph.facebook.com/v20.0/me/adaccounts?fields=id,name,account_id,balance,currency&access_token=${token}`);
        const adAccData = await adAccRes.json();
        console.log("Found Ad Accounts from Meta API:", adAccData);
        if (adAccData.data && adAccData.data[0]) {
            adAccountId = adAccData.data[0].id;
        }
    }

    if (adAccountId && token) {
        if (!adAccountId.startsWith('act_')) adAccountId = `act_${adAccountId}`;
        console.log(`\nQuerying Meta Campaigns for ${adAccountId}...`);
        
        // Fetch campaigns
        const campRes = await fetch(`https://graph.facebook.com/v20.0/${adAccountId}/campaigns?fields=id,name,status,objective,start_time,stop_time&limit=50&access_token=${token}`);
        const campData = await campRes.json();
        console.log("Meta Campaigns:", campData.data?.map(c => ({ id: c.id, name: c.name, status: c.status, objective: c.objective })));

        // Fetch insights for yesterday and today (2026-08-30 to 2026-09-01)
        console.log("\n--- Checking Campaign Insights (Aug 30, 2026 - Sep 01, 2026) ---");
        const insightsRes = await fetch(`https://graph.facebook.com/v20.0/${adAccountId}/insights?fields=campaign_id,campaign_name,spend,impressions,clicks,actions,cost_per_action_type&time_range={"since":"2026-08-30","until":"2026-09-01"}&level=campaign&access_token=${token}`);
        const insightsData = await insightsRes.json();
        
        if (insightsData.data) {
            insightsData.data.forEach(ins => {
                console.log(`\nCampaign: "${ins.campaign_name}" (ID: ${ins.campaign_id})`);
                console.log(`  Spend: INR ${ins.spend}, Impressions: ${ins.impressions}, Clicks: ${ins.clicks}`);
                console.log(`  Actions / Results:`, ins.actions);
            });
        } else {
            console.log("Insights API Response:", insightsData);
        }

        // Also check insights specifically for Aug 31 and Sep 01
        console.log("\n--- Checking Campaign Insights for Aug 31 specifically ---");
        const ins31 = await fetch(`https://graph.facebook.com/v20.0/${adAccountId}/insights?fields=campaign_id,campaign_name,spend,impressions,clicks,actions&time_range={"since":"2026-08-31","until":"2026-08-31"}&level=campaign&access_token=${token}`);
        const ins31Data = await ins31.json();
        console.log("Aug 31 Insights:", JSON.stringify(ins31Data.data, null, 2));

        console.log("\n--- Checking Campaign Insights for Sep 01 specifically ---");
        const ins01 = await fetch(`https://graph.facebook.com/v20.0/${adAccountId}/insights?fields=campaign_id,campaign_name,spend,impressions,clicks,actions&time_range={"since":"2026-09-01","until":"2026-09-01"}&level=campaign&access_token=${token}`);
        const ins01Data = await ins01.json();
        console.log("Sep 01 Insights:", JSON.stringify(ins01Data.data, null, 2));
    }

    // Check WhatsApp chats or contacts received recently in DB
    console.log("\n=== CHECKING WHATSAPP CHATS / MESSAGES IN DATABASE ===");
    const chats = await query('chats', `?user_id=eq.${userId}&order=updated_at.desc&limit=20`);
    console.log("Recent chats count:", Array.isArray(chats) ? chats.length : chats);
    if (Array.isArray(chats)) {
        chats.slice(0, 10).forEach(c => {
            console.log(`Chat: ${c.phone_number || c.phone || c.id} | Name: ${c.contact_name || c.name} | Updated: ${c.updated_at} | Last Msg: ${c.last_message || c.message}`);
        });
    }

    const messages = await query('whatsapp_messages', `?user_id=eq.${userId}&created_at=gte.2026-08-30T00:00:00Z&order=created_at.desc&limit=20`);
    console.log("\nRecent WhatsApp Messages since Aug 30:", Array.isArray(messages) ? messages.length : messages);
    if (Array.isArray(messages)) {
        messages.forEach(m => console.log(`[${m.created_at}] From: ${m.from} | To: ${m.to} | Text: ${m.message_text || m.body}`));
    }
}

main().catch(console.error);
