import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function run() {
    const leadIds = ['d27ba1ff-fd12-4f8b-9af4-b64e6f2362af', '3d1d670e-ef7d-4e93-b26c-0ce6de379e35'];
    
    const { data: leads } = await supabase
        .from('leads')
        .select('id, name, phone, voice_recording_url, voice_call_status, custom_fields')
        .in('id', leadIds);

    console.log('LEADS:');
    console.log(JSON.stringify(leads, null, 2));

    const { data: calls } = await supabase
        .from('call_logs')
        .select('*')
        .in('lead_id', leadIds);

    console.log('\nCALL LOGS FOR THESE LEADS:');
    console.log(JSON.stringify(calls, null, 2));

    // Also check storage bucket 'lead-voice-recordings'
    const { data: files1, error: err1 } = await supabase.storage.from('lead-voice-recordings').list('d27ba1ff-fd12-4f8b-9af4-b64e6f2362af');
    console.log('\nSTORAGE FILES FOR RAVI:', files1, err1);

    const { data: files2, error: err2 } = await supabase.storage.from('lead-voice-recordings').list('3d1d670e-ef7d-4e93-b26c-0ce6de379e35');
    console.log('\nSTORAGE FILES FOR VINITA:', files2, err2);
}

run().catch(console.error);
