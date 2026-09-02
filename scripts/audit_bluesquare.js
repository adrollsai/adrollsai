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
    console.log("==================================================");
    console.log("   BLUESQUARE CRM & AD SYNC COMPREHENSIVE AUDIT   ");
    console.log("==================================================");

    // 1. Profile
    const profiles = await query('profiles', '?email=eq.infobluesquareinfra@gmail.com');
    if (!profiles || !profiles[0]) {
        console.error("Profile not found!");
        return;
    }
    const profile = profiles[0];
    const userId = profile.id;
    console.log(`\n1. PROFILE INFO:`);
    console.log(`- ID: ${userId}`);
    console.log(`- Business: ${profile.business_name}`);
    console.log(`- Selected Page ID: ${profile.selected_page_id}`);
    console.log(`- Page Token exists: ${!!(profile.selected_page_token || profile.facebook_token)}`);
    console.log(`- Ad Account ID: ${profile.ad_account_id}`);
    console.log(`- Enable Distribution: ${profile.enable_distribution}`);

    // 2. Team Members
    const team = await query('profiles', `?or=(agency_id.eq.${userId},parent_id.eq.${userId})`);
    console.log(`\n2. TEAM MEMBERS (${team.length}):`);
    team.forEach(m => {
        console.log(`  - [${m.id}] ${m.full_name || m.name || 'Unnamed'} | Email: ${m.email} | Role: ${m.role} | Active: ${m.is_active !== false}`);
    });

    // 3. Automations & Rules
    const automations = await query('automations', `?user_id=eq.${userId}`);
    console.log(`\n3. AUTOMATION & ASSIGNMENT RULES (${automations.length}):`);
    let activeGroupRule = null;
    automations.forEach(a => {
        console.log(`\n  Rule: "${a.title}" (Active: ${a.is_active})`);
        let desc = a.description;
        try {
            desc = JSON.parse(a.description);
        } catch (e) {}
        console.log(`  Details:`, JSON.stringify(desc, null, 2));
        if (a.is_active && a.title.startsWith('Group-Distribution:')) {
            activeGroupRule = desc;
        }
    });

    // 4. Meta Leadgen Forms & Real-time check from Meta Graph API
    const pageToken = profile.selected_page_token || profile.facebook_token;
    const pageId = profile.selected_page_id;

    console.log(`\n4. META GRAPH API FORM & LEAD CHECK:`);
    let metaForms = [];
    if (pageToken && pageId) {
        try {
            const formsRes = await fetch(`https://graph.facebook.com/v20.0/${pageId}/leadgen_forms?fields=id,name,status,leads_count,created_time&limit=100&access_token=${pageToken}`);
            const formsData = await formsRes.json();
            if (formsData.data) {
                metaForms = formsData.data;
                console.log(`Found ${metaForms.length} forms on Meta:`);
                for (const form of metaForms) {
                    console.log(`  - Form: "${form.name}" (ID: ${form.id}, Status: ${form.status}, Leads Count: ${form.leads_count || 'N/A'})`);
                }
            } else {
                console.log("Meta API Response:", formsData);
            }
        } catch (e) {
            console.error("Error fetching Meta forms:", e.message);
        }
    } else {
        console.log("No page token or page ID to query Meta API.");
    }

    // 5. CRM Leads in Database
    console.log(`\n5. RECENT CRM LEADS IN DATABASE:`);
    // Fetch last 150 leads
    const leads = await query('leads', `?user_id=eq.${userId}&order=created_at.desc&limit=150`);
    console.log(`Total recent leads in CRM: ${leads.length}`);

    // Map of user IDs to names
    const userNameMap = { [userId]: profile.full_name || 'Owner (Bluesquare)' };
    team.forEach(m => { userNameMap[m.id] = m.full_name || m.name || m.email; });

    // Group leads by date, campaign, and assignee
    const leadsByDate = {};
    const leadsByCampaign = {};
    const leadsByAssignee = {};
    const unassignedLeads = [];
    const assignmentLog = [];

    leads.forEach(l => {
        const date = (l.created_at || '').slice(0, 10);
        leadsByDate[date] = (leadsByDate[date] || 0) + 1;

        const camp = l.campaign || l.campaign_name || l.ad_name || 'Unknown Campaign';
        leadsByCampaign[camp] = (leadsByCampaign[camp] || 0) + 1;

        const assigneeId = l.assigned_to_user_id || l.assigned_to || 'Unassigned';
        const assigneeName = userNameMap[assigneeId] || assigneeId;
        leadsByAssignee[assigneeName] = (leadsByAssignee[assigneeName] || 0) + 1;

        if (!l.assigned_to && !l.assigned_to_user_id) {
            unassignedLeads.push(l);
        }
    });

    console.log(`\nLeads received per date (last 10 days):`);
    Object.entries(leadsByDate).slice(0, 10).forEach(([d, c]) => console.log(`  ${d}: ${c} leads`));

    console.log(`\nLeads count by Campaign:`);
    Object.entries(leadsByCampaign).forEach(([c, count]) => console.log(`  - ${c}: ${count} leads`));

    console.log(`\nLeads distribution by Assigned Team Member:`);
    Object.entries(leadsByAssignee).forEach(([a, count]) => console.log(`  - ${a}: ${count} leads`));

    console.log(`\nUnassigned Leads count: ${unassignedLeads.length}`);
    if (unassignedLeads.length > 0) {
        console.log("Sample unassigned leads:", unassignedLeads.slice(0, 5).map(l => ({ id: l.id, name: l.name, phone: l.phone, campaign: l.campaign, created_at: l.created_at })));
    }

    // 6. Check detailed assignments vs rule
    console.log(`\n6. VERIFYING ASSIGNMENT RULES ACCURACY:`);
    if (activeGroupRule && activeGroupRule.members) {
        console.log("Active Group Rule Members:", activeGroupRule.members.map(m => `${m.name} (${m.userId}, weight: ${m.weight})`));
        console.log("Rule Targeted Campaigns:", activeGroupRule.campaigns);

        // Check leads from August 2026 onwards
        const augLeads = leads.filter(l => (l.created_at || '').startsWith('2026-08') || (l.created_at || '').startsWith('2026-09'));
        console.log(`\nTotal August-September 2026 leads: ${augLeads.length}`);

        const augDist = {};
        augLeads.forEach(l => {
            const assigneeId = l.assigned_to_user_id || l.assigned_to || 'Unassigned';
            const name = userNameMap[assigneeId] || assigneeId;
            augDist[name] = (augDist[name] || 0) + 1;
        });
        console.log("August-September leads distribution among team:", augDist);
    }

    // 7. Check latest 15 leads from Meta vs CRM
    if (pageToken && metaForms.length > 0) {
        console.log(`\n7. CHECKING LATEST LEADS FROM META FORMS VS CRM:`);
        for (const form of metaForms.slice(0, 5)) {
            try {
                const leadRes = await fetch(`https://graph.facebook.com/v20.0/${form.id}/leads?fields=id,created_time,field_data,ad_id,ad_name,adset_name,campaign_name&limit=10&access_token=${pageToken}`);
                const leadData = await leadRes.json();
                if (leadData.data && leadData.data.length > 0) {
                    console.log(`\nForm "${form.name}" (ID: ${form.id}) - Latest ${leadData.data.length} Meta leads:`);
                    for (const mLead of leadData.data) {
                        const nameField = mLead.field_data?.find(f => f.name.toLowerCase().includes('full_name') || f.name.toLowerCase().includes('name'))?.values?.[0] || 'Unknown';
                        const phoneField = mLead.field_data?.find(f => f.name.toLowerCase().includes('phone'))?.values?.[0] || 'Unknown';
                        
                        // Check if present in CRM
                        const inCrm = leads.find(l => l.facebook_lead_id === mLead.id || l.phone?.includes(phoneField.slice(-10)) || (l.meta_data && JSON.stringify(l.meta_data).includes(mLead.id)));
                        const crmStatus = inCrm ? `SYNCED -> Assigned to: ${userNameMap[inCrm.assigned_to_user_id || inCrm.assigned_to] || inCrm.assigned_to || 'None'}` : `NOT FOUND IN CRM (MISSING)`;
                        console.log(`  - Meta Lead ID ${mLead.id} (${mLead.created_time}) | ${nameField} | ${phoneField} | Camp: ${mLead.campaign_name || 'N/A'} => ${crmStatus}`);
                    }
                }
            } catch (e) {
                console.error(`Error querying leads for form ${form.id}:`, e.message);
            }
        }
    }
}

main().catch(console.error);
