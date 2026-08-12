const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

async function testSaveFollowup() {
    console.log('--- TESTING CRM FOLLOWUP SAVE API ---');
    const res = await fetch('http://localhost:3000/api/crm/followup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            leadId: 'df173adb-951c-49d3-b8d4-c771f4867f77', // Navjot singh
            remarks: 'Test followup save verification',
            userId: '2f62a259-f23b-48ee-a920-c436f36eaa4b' // Bhavdeep
        })
    });

    const data = await res.json();
    console.log('Response from /api/crm/followup:', data);
}

testSaveFollowup().catch(console.error);
