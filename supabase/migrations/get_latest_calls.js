const fs = require('fs');
const path = require('path');

const envPath = 'C:\\Users\\Adrolls\\Desktop\\nobogent-app\\nobogent\\.env.local';
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const firstEq = trimmed.indexOf('=');
    if (firstEq === -1) return;
    const key = trimmed.substring(0, firstEq).trim();
    let val = trimmed.substring(firstEq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.substring(1, val.length - 1);
    }
    env[key] = val;
});

const projectNodeModules = 'C:\\Users\\Adrolls\\Desktop\\nobogent-app\\nobogent\\node_modules';
const { createClient } = require(path.join(projectNodeModules, '@supabase', 'supabase-js'));
const supabaseAdmin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    try {
        const campaignId = '97fcb320-6113-4d00-a626-e8a3cf8ef974';
        
        console.log(`Checking spoken calls for campaign: ${campaignId}`);
        const { data: leads, error } = await supabaseAdmin
            .from('leads')
            .select('id, name, phone, voice_call_status, voice_call_summary, voice_call_transcript, created_at')
            .eq('voice_campaign_id', campaignId);
        
        if (error) {
            console.error('Database query error:', error);
            return;
        }

        console.log(`Total campaign leads fetched: ${leads?.length || 0}`);
        if (leads) {
            const statusCounts = {};
            leads.forEach(l => {
                const status = l.voice_call_status || 'null';
                statusCounts[status] = (statusCounts[status] || 0) + 1;
            });
            console.log('Status breakdown:', JSON.stringify(statusCounts));

            // Log details of those that are NOT null / not_called
            const called = leads.filter(l => l.voice_call_status !== null && l.voice_call_status !== 'not_called');
            console.log(`\nDialed leads details (${called.length}):`);
            called.forEach(l => {
                console.log(`- Lead: ${l.name} (${l.phone}) | Status: ${l.voice_call_status}`);
                console.log(`  Summary: ${l.voice_call_summary || 'No summary yet'}`);
                console.log('---');
            });
        }
    } catch (e) {
        console.error(e);
    }
}

run();
