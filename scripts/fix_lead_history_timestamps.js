const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function fixHistoryTimestamps() {
    console.log('--- INSPECTING AND RECTIFYING LEAD HISTORY TIMESTAMPS ---');

    const { data: historyEntries, error } = await supabaseAdmin
        .from('lead_history')
        .select('id, lead_id, description, created_at')
        .ilike('description', '%1:59%')
        .limit(100);

    console.log(`Found ${historyEntries ? historyEntries.length : 0} entries with UTC 1:59 timestamp`);

    // Let's also check all DNP / Next Action history entries created today
    const { data: todayEntries } = await supabaseAdmin
        .from('lead_history')
        .select('id, lead_id, description, created_at')
        .ilike('description', '%Next Action%')
        .order('created_at', { ascending: false })
        .limit(50);

    console.log('Sample Next Action history entries:', todayEntries);

    if (todayEntries && todayEntries.length > 0) {
        for (const entry of todayEntries) {
            let desc = entry.description || '';
            
            // Convert UTC timestamp strings in text like "8/11/2026, 1:59:00 PM" to "8/11/2026, 7:29:00 PM"
            // If description contains "1:59:00 PM", replace with "7:29:00 PM"
            if (desc.includes('1:59:00 PM')) {
                const fixedDesc = desc.replace('1:59:00 PM', '7:29:00 PM');
                console.log(`Fixing entry ${entry.id}: "${desc}" -> "${fixedDesc}"`);
                await supabaseAdmin
                    .from('lead_history')
                    .update({ description: fixedDesc })
                    .eq('id', entry.id);
            }
        }
    }
}

fixHistoryTimestamps().catch(console.error);
