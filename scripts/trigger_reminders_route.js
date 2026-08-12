const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

async function testRemindersEndpoint() {
    console.log('--- CALLING CRON REMINDERS ENDPOINT WITH SECRET ---');
    const secret = process.env.CRON_SECRET || '';
    const res = await fetch(`http://localhost:3000/api/cron/reminders?cronSecret=${secret}`);
    const data = await res.json();
    console.log('Response from /api/cron/reminders:', data);
}

testRemindersEndpoint().catch(console.error);
