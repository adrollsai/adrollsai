import { createClient } from '@supabase/supabase-js';

const STAGING_URL = 'https://fwstdaxumtwjcdlbudwx.supabase.co';
const STAGING_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3c3RkYXh1bXR3amNkbGJ1ZHd4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NjU2NTMxMywiZXhwIjoyMTAyMTQxMzEzfQ.t8veyWOdoiIluW_Zm33Xp4khBuWyBSDQht8Vsf4cwig';

const supabaseStaging = createClient(STAGING_URL, STAGING_SERVICE_KEY);

async function main() {
    console.log('🔍 Checking Staging Supabase DB...');
    try {
        const { count: totalLeads, error: lErr } = await supabaseStaging
            .from('leads')
            .select('*', { count: 'exact', head: true });

        console.log('Staging Total Leads:', totalLeads);

        const { data: profiles, error: pErr } = await supabaseStaging
            .from('profiles')
            .select('id, email, business_name');

        console.log('Staging Profiles:', profiles);

        if (profiles) {
            for (const p of profiles) {
                const { count } = await supabaseStaging
                    .from('leads')
                    .select('*', { count: 'exact', head: true })
                    .eq('user_id', p.id);
                console.log(`  ${p.business_name || p.email} (${p.id}) -> Leads: ${count}`);
            }
        }
    } catch (e) {
        console.error('Staging connection error:', e);
    }
}

main().catch(console.error);
