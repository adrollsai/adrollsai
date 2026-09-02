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
    
    // Team members map
    const team = await query('profiles', `?or=(agency_id.eq.${userId},parent_id.eq.${userId})`);
    const nameMap = { [userId]: 'Bluesquare Admin' };
    team.forEach(t => { nameMap[t.id] = t.full_name || t.name || t.email; });

    // Fetch leads created since Aug 30 2026
    const leads = await query('leads', `?user_id=eq.${userId}&created_at=gte.2026-08-30T00:00:00Z&order=created_at.desc`);
    
    console.log(`Fetched ${leads.length} leads since Aug 30, 2026 UTC`);

    const formattedLeads = leads.map(l => {
        const d = new Date(l.created_at);
        // Format to IST
        const istDateStr = d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });
        const istTimeStr = d.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true });

        const assignedName = nameMap[l.assigned_to_user_id || l.assigned_to] || l.assigned_to || 'Unassigned';

        return {
            id: l.id,
            name: l.name,
            phone: l.phone,
            email: l.email || 'N/A',
            campaign: l.campaign || l.campaign_name || l.ad_name || 'N/A',
            source: l.source,
            assigned_to: assignedName,
            created_at_raw: l.created_at,
            ist_date: istDateStr,
            ist_time: istTimeStr,
            stage: l.stage
        };
    });

    console.log(JSON.stringify(formattedLeads, null, 2));
}

main().catch(console.error);
