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
        const userId = 'd838c956-1761-4bce-9d91-32f3abecc222';
        
        console.log('Finding all leads with scheduled calling columns...');
        const { data: leads, error } = await supabaseAdmin
            .from('leads')
            .select('id, name, phone, voice_call_status, voice_call_scheduled_at, next_followup')
            .eq('user_id', userId)
            .or('voice_call_scheduled_at.not.is.null,voice_call_status.eq.scheduled_retry,voice_call_status.eq.scheduled_callback');

        if (error) {
            console.error('Error:', error);
            return;
        }

        console.log(`Found ${leads?.length || 0} scheduled leads:`);
        if (leads) {
            leads.forEach(l => {
                console.log(JSON.stringify(l));
            });
        }
    } catch (e) {
        console.error(e);
    }
}

run();
