const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    const userId = 'c890a11f-84ce-4592-ab8f-8682927b1a9d'; // Realty Nation
    
    // Get the page token and ID from profiles
    const { data: profile, error } = await supabaseAdmin
        .from('profiles')
        .select('selected_page_token, selected_page_id')
        .eq('id', userId)
        .single();
        
    if (error || !profile || !profile.selected_page_token) {
        console.error("Profile or page token not found:", error);
        return;
    }

    const pageId = profile.selected_page_id;
    const token = profile.selected_page_token;

    console.log(`Fetching lead forms for Page: ${pageId}...`);
    const formsUrl = `https://graph.facebook.com/v19.0/${pageId}/leadgen_forms?fields=id,name,status,created_time,leads_count&access_token=${token}`;
    const formsRes = await fetch(formsUrl);
    const formsData = await formsRes.json();

    if (formsData.error) {
        console.error("Error fetching forms:", formsData.error);
        return;
    }

    const forms = formsData.data || [];
    console.log(`Found ${forms.length} forms on Meta:`);
    forms.forEach(f => {
        console.log(`- Form ID: ${f.id} | Name: ${f.name} | Status: ${f.status} | Created: ${f.created_time} | Leads Count: ${f.leads_count}`);
    });

    // Get all leads from database for this user to check match
    const { data: dbLeads, error: dbErr } = await supabaseAdmin
        .from('leads')
        .select('id, name, email, phone, facebook_lead_id, created_at')
        .eq('user_id', userId);

    if (dbErr) {
        console.error("Error fetching DB leads:", dbErr);
        return;
    }

    const dbLeadIds = new Set(dbLeads.map(l => l.facebook_lead_id).filter(Boolean));
    console.log(`\nFound ${dbLeads.length} leads in CRM, containing ${dbLeadIds.size} Facebook lead IDs.`);

    for (const form of forms) {
        console.log(`\n--------------------------------------------`);
        console.log(`Fetching leads for Form: "${form.name}" (ID: ${form.id})...`);
        
        const leadsUrl = `https://graph.facebook.com/v19.0/${form.id}/leads?fields=id,created_time,field_data&access_token=${token}`;
        const leadsRes = await fetch(leadsUrl);
        const leadsData = await leadsRes.json();

        if (leadsData.error) {
            console.error(`Error fetching leads for form ${form.id}:`, leadsData.error);
            continue;
        }

        const fbLeads = leadsData.data || [];
        console.log(`Found ${fbLeads.length} leads on Meta for this form.`);

        fbLeads.forEach(lead => {
            let name = 'Unknown', phone = '', email = '';
            const customFields = {};
            lead.field_data?.forEach(field => {
                const fieldName = field.name.toLowerCase();
                const fieldValue = field.values ? field.values[0] : '';
                if (fieldName === 'full_name' || fieldName === 'name') name = fieldValue;
                else if (fieldName === 'email') email = fieldValue;
                else if (fieldName === 'phone_number' || fieldName === 'phone' || fieldName === 'mobile_number') phone = fieldValue;
                else {
                    customFields[field.name] = fieldValue;
                }
            });

            const existsInDb = dbLeadIds.has(lead.id);
            console.log(`\n  * Meta Lead ID: ${lead.id}`);
            console.log(`    Created Time: ${lead.created_time}`);
            console.log(`    Name: ${name}`);
            console.log(`    Email: ${email}`);
            console.log(`    Phone: ${phone}`);
            console.log(`    Custom Fields:`, customFields);
            console.log(`    Status in CRM: ${existsInDb ? '✅ FOUND' : '❌ MISSING'}`);
        });
    }
}

run().catch(console.error);
