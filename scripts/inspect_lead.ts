import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function inspectLead() {
    const leadId = 'eba904d9-1131-4892-a5aa-15ed18187e71';
    const { data: lead } = await supabaseAdmin
        .from('leads')
        .select('*')
        .eq('id', leadId)
        .single();

    console.log('Lead record:', lead);
}

inspectLead().catch(console.error);
