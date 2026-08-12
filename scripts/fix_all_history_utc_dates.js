const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function fixAllHistoryDates() {
    console.log('--- RECTIFYING ALL LEAD HISTORY TIMESTAMPS TO IST ---');

    const { data: entries } = await supabaseAdmin
        .from('lead_history')
        .select('id, description')
        .or('description.ilike.%5:30:00 AM%,description.ilike.%1:59:00 PM%,description.ilike.%12:00:00 AM%')
        .limit(1000);

    console.log(`Found ${entries ? entries.length : 0} entries to convert to IST display`);

    if (entries && entries.length > 0) {
        for (const e of entries) {
            let desc = e.description || '';
            let newDesc = desc;

            if (desc.includes('1:59:00 PM')) {
                newDesc = newDesc.replace('1:59:00 PM', '7:29:00 PM');
            }

            // Convert 5:30:00 AM (which was 00:00:00 UTC) to clean date without 5:30 AM artifact
            if (newDesc.includes(', 5:30:00 AM')) {
                newDesc = newDesc.replace(', 5:30:00 AM', '');
            }

            if (newDesc !== desc) {
                console.log(`Updating ${e.id}:\n  OLD: ${desc}\n  NEW: ${newDesc}\n`);
                await supabaseAdmin
                    .from('lead_history')
                    .update({ description: newDesc })
                    .eq('id', e.id);
            }
        }
    }

    console.log('--- ALL LEAD HISTORY TIMESTAMPS RECTIFIED ---');
}

fixAllHistoryDates().catch(console.error);
