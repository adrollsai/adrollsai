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
    const userId = "2f62a259-f23b-48ee-a920-c436f36eaa4b";
    const leads = await query('leads', `?user_id=eq.${userId}&order=created_at.desc&limit=100`);

    const team = await query('profiles', `?or=(agency_id.eq.${userId},parent_id.eq.${userId})`);
    const nameMap = { [userId]: 'Bluesquare Admin' };
    team.forEach(t => { nameMap[t.id] = t.full_name || t.name || t.email; });

    console.log("=== LATEST 40 LEADS ARRIVED (CHRONOLOGICAL REVERSE) ===");
    leads.slice(0, 40).forEach((l, idx) => {
        const assignedName = nameMap[l.assigned_to_user_id || l.assigned_to] || l.assigned_to || 'UNASSIGNED';
        console.log(`${idx + 1}. [${l.created_at}] "${l.name}" | Camp: "${l.campaign || l.campaign_name || l.ad_name}" | Assigned: ${assignedName} | Source: ${l.source}`);
    });

    // Count distribution in last 3 days (Aug 28 - Aug 31)
    const recentLeads = leads.filter(l => (l.created_at || '').startsWith('2026-08-28') || (l.created_at || '').startsWith('2026-08-29') || (l.created_at || '').startsWith('2026-08-30') || (l.created_at || '').startsWith('2026-08-31') || (l.created_at || '').startsWith('2026-09-01'));
    const distRecent = {};
    recentLeads.forEach(l => {
        const assignedName = nameMap[l.assigned_to_user_id || l.assigned_to] || l.assigned_to || 'UNASSIGNED';
        distRecent[assignedName] = (distRecent[assignedName] || 0) + 1;
    });
    console.log("\n=== RECENT LEADS DISTRIBUTION (Aug 28 - Sept 1) [Total: " + recentLeads.length + "] ===");
    console.log(distRecent);

    // Check Meta sync logs or check Meta campaigns
    const syncLogs = await query('meta_sync_logs', `?user_id=eq.${userId}&order=created_at.desc&limit=10`);
    console.log("\n=== META SYNC LOGS ===");
    console.log(syncLogs);
}

main().catch(console.error);
