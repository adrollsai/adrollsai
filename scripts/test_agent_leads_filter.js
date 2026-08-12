const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testAgentLeadsFilter() {
    const harmanId = '7ce0408f-b03f-4af8-a32d-852b6c22da2a'; // Harman Bajwa

    // Agent query: assigned_to = harmanId OR (user_id = harmanId AND user_id != ownerId)
    const q1 = supabaseAdmin.from('leads').select('id, name, assigned_to, user_id').eq('assigned_to', harmanId);
    const q2 = supabaseAdmin.from('leads').select('id, name, assigned_to, user_id').eq('user_id', harmanId);

    const [{ data: l1 }, { data: l2 }] = await Promise.all([q1, q2]);

    const map = new Map();
    (l1 || []).forEach(l => map.set(l.id, l));
    (l2 || []).forEach(l => map.set(l.id, l));

    const harmanLeads = Array.from(map.values());
    console.log(`Harman Bajwa lead count: ${harmanLeads.length} leads (assigned_to: ${l1 ? l1.length : 0}, user_id: ${l2 ? l2.length : 0})`);
    console.log('Sample leads for Harman:', harmanLeads.slice(0, 5));
}

testAgentLeadsFilter().catch(console.error);
