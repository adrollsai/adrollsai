const fs = require('fs');
const dotenv = require('dotenv');
const env = dotenv.parse(fs.readFileSync('.env.local'));
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

async function query(table, params = '', options = {}) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${params}`, {
        headers: {
            'Authorization': `Bearer ${SERVICE_KEY}`,
            'apikey': SERVICE_KEY,
            'Content-Type': 'application/json',
            ...(options.headers || {})
        },
        method: options.method || 'GET',
        body: options.body ? JSON.stringify(options.body) : undefined
    });
    if (options.method === 'POST' || options.method === 'PATCH') {
        const text = await res.text();
        try { return JSON.parse(text); } catch { return text; }
    }
    return res.json();
}

async function main() {
    const userId = "2f62a259-f23b-48ee-a920-c436f36eaa4b"; // Bluesquare
    const profiles = await query('profiles', `?id=eq.${userId}`);
    const profile = profiles[0];
    const token = profile.facebook_token || profile.selected_page_token;

    // Get Active Automations
    const automations = await query('automations', `?user_id=eq.${userId}&is_active=eq.true`);
    const groupRule = automations.find(a => a.title.startsWith('Group-Distribution:'));
    let groupConfig = null;
    if (groupRule) {
        try { groupConfig = JSON.parse(groupRule.description); } catch (e) {}
    }

    console.log("Group Distribution Config:", groupConfig);
    const members = groupConfig?.members || [];
    let lastAssignedId = groupConfig?.last_assigned_user_id || members[0]?.userId;

    function getNextAssignee() {
        if (!members || members.length === 0) return { id: userId, name: 'Admin' };
        const currentIndex = members.findIndex(m => m.userId === lastAssignedId);
        const nextIndex = (currentIndex + 1) % members.length;
        const nextMember = members[nextIndex];
        lastAssignedId = nextMember.userId;
        return { id: nextMember.userId, name: nextMember.name };
    }

    // Active forms
    const activeFormIds = [
        { id: '1602385004210100', name: 'Anmol Avenue - 12-03-2026-50000', defaultCamp: 'Anmol Avenue -12-03-2026' },
        { id: '4257177234535200', name: 'Ananta Aspire -14 July 2026', defaultCamp: 'Ananta Aspire -14 July 2026' },
        { id: '1333781714785412', name: 'Ananta Karwan-31st Jan 2026', defaultCamp: 'Ananta Karwan-31st Jan 2026' }
    ];

    const insertedLeads = [];

    for (const f of activeFormIds) {
        console.log(`\nChecking Meta Form "${f.name}" (${f.id})...`);
        const r = await fetch(`https://graph.facebook.com/v20.0/${f.id}/leads?fields=id,created_time,field_data,campaign_name,ad_name,adset_name&limit=25&access_token=${token}`);
        const data = await r.json();

        if (data.data) {
            for (const fbLead of data.data) {
                // Check if already in DB
                const existing = await query('leads', `?facebook_lead_id=eq.${fbLead.id}`);
                if (existing && existing.length > 0) {
                    continue;
                }

                // Extract fields
                let name = '', phone = '', email = '', city = '';
                const customFields = {};
                let firstName = '', lastName = '';

                fbLead.field_data?.forEach(field => {
                    const fn = (field.name || '').toLowerCase().trim();
                    const val = (field.values?.[0] || '').trim();
                    if (!val) return;

                    if (fn.includes('full_name') || fn.includes('fullname') || fn === 'name' || fn.includes('your_name')) {
                        name = val;
                    } else if (fn.includes('first_name') || fn === 'fname') {
                        firstName = val;
                    } else if (fn.includes('last_name') || fn === 'lname') {
                        lastName = val;
                    } else if (fn.includes('email')) {
                        email = val;
                    } else if (fn.includes('phone') || fn.includes('mobile') || fn.includes('contact')) {
                        phone = val;
                    } else if (fn === 'city') {
                        city = val;
                    } else {
                        customFields[field.name] = val;
                    }
                });

                if (!name && (firstName || lastName)) {
                    name = `${firstName} ${lastName}`.trim();
                }
                if (!name) name = 'Lead from ' + f.name;

                // Determine campaign / ad string
                const campName = fbLead.campaign_name || f.defaultCamp;
                const adName = fbLead.ad_name ? `${campName} / ${fbLead.ad_name}` : campName;

                // Assign lead according to rule
                const assignee = getNextAssignee();

                const leadPayload = {
                    user_id: userId,
                    name: name,
                    phone: phone,
                    email: email || null,
                    status: 'New Lead',
                    pipeline_stage: 'New Lead',
                    source: 'Facebook Ads',
                    ad_name: adName,
                    facebook_lead_id: fbLead.id,
                    facebook_created_at: fbLead.created_time,
                    form_id: f.id,
                    form_name: f.name,
                    custom_fields: JSON.stringify(customFields),
                    assigned_to: assignee.id,
                    created_at: fbLead.created_time,
                    calling_enabled: true,
                    whatsapp_enabled: true,
                    voice_call_status: 'not_called',
                    reminder_24h_sent: false,
                    reminder_4h_sent: false,
                    reminder_1h_sent: false,
                    reminder_15m_sent: false
                };

                const insertRes = await query('leads', '', {
                    method: 'POST',
                    headers: { 'Prefer': 'return=representation' },
                    body: leadPayload
                });

                console.log(`-> Inserted lead [${fbLead.created_time}] "${name}" (${phone}) | Assigned to: ${assignee.name}`);
                insertedLeads.push({
                    name,
                    phone,
                    email,
                    campaign: adName,
                    assigned_to: assignee.name,
                    created_time: fbLead.created_time
                });
            }
        }
    }

    // Update group rule with last assigned member
    if (groupRule && groupConfig) {
        groupConfig.last_assigned_user_id = lastAssignedId;
        const lastMember = members.find(m => m.userId === lastAssignedId);
        if (lastMember) groupConfig.last_assigned_user_name = lastMember.name;
        groupConfig.last_assigned_at = new Date().toISOString();

        await query('automations', `?id=eq.${groupRule.id}`, {
            method: 'PATCH',
            body: { description: JSON.stringify(groupConfig) }
        });
        console.log("\nUpdated group rule last_assigned_user_id:", lastAssignedId);
    }

    console.log(`\n=== SYNC SUMMARY ===`);
    console.log(`Successfully synced and assigned ${insertedLeads.length} leads!`);
}

main().catch(console.error);
