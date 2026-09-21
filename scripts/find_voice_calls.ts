import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function run() {
    const userId = 'c3893924-5a57-4da3-b4bc-7c70d8ee7c59';

    // 1. Fetch ALL leads for Red Rose City owner
    const { data: leads, error } = await supabase
        .from('leads')
        .select('id, name, phone, pipeline_stage, status, custom_fields, voice_call_status, voice_call_summary, voice_call_transcript, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

    if (error) {
        console.error("Error fetching leads:", error);
        return;
    }

    console.log(`Total leads in account: ${leads.length}`);

    // Filter leads that have voice call data
    const voiceLeads = leads.filter(l => {
        const hasTranscript = Array.isArray(l.voice_call_transcript) && l.voice_call_transcript.length > 0;
        const hasSummary = !!l.voice_call_summary;
        const callFinished = l.voice_call_status && !['not_called', 'no_answer', 'failed', 'busy'].includes(l.voice_call_status);
        return hasTranscript || hasSummary || callFinished;
    });

    console.log(`Leads with voice call interactions: ${voiceLeads.length}\n`);

    for (const l of voiceLeads) {
        let transcript = l.voice_call_transcript;
        if (typeof transcript === 'string') {
            try { transcript = JSON.parse(transcript); } catch(e) {}
        }
        const turns = Array.isArray(transcript) ? transcript.length : 0;
        const cf = typeof l.custom_fields === 'string' ? JSON.parse(l.custom_fields) : (l.custom_fields || {});

        console.log(`=======================================================`);
        console.log(`NAME: ${l.name} | PHONE: ${l.phone}`);
        console.log(`LEAD ID: ${l.id}`);
        console.log(`STAGE: ${l.pipeline_stage} | STATUS: ${l.status}`);
        console.log(`VOICE CALL STATUS: ${l.voice_call_status}`);
        console.log(`TRANSCRIPT TURNS: ${turns}`);
        console.log(`QUALIFIED FLAGS: is_qualified: ${cf.is_qualified}, is_interested: ${cf.is_interested}, priority: ${cf.lead_priority}`);
        console.log(`SUMMARY: ${l.voice_call_summary || 'N/A'}`);
        
        if (turns > 0) {
            console.log(`\n--- CONVERSATION TRANSCRIPT (${turns} turns) ---`);
            transcript.forEach((t: any, idx: number) => {
                console.log(`[${t.role || 'speaker'}]: ${t.message || t.text}`);
            });
        }
        console.log(`\n`);
    }
}

run().catch(console.error);
