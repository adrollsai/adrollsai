const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function triggerCron() {
    console.log('--- TRIGGERING REMINDERS CRON ROUTE ---');

    const nowUtcString = new Date().toISOString();
    console.log('Current UTC Time:', nowUtcString);

    const { data: leadsToRemind, error } = await supabaseAdmin
        .from('leads')
        .select('id, name, phone, user_id, assigned_to, next_followup')
        .not('next_followup', 'is', null)
        .lte('next_followup', nowUtcString);

    console.log(`Found ${leadsToRemind ? leadsToRemind.length : 0} due lead followups (<= ${nowUtcString}):`, leadsToRemind, error);
}

triggerCron().catch(console.error);
