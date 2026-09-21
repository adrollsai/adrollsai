import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
    console.log("Searching for Red Rose City properties/campaigns/leads...");

    // 1. Check properties
    const { data: props } = await supabase
        .from('properties')
        .select('id, title, address, property_type, user_id')
        .ilike('title', '%red rose%');
    console.log("Properties matched:", props?.length, props);

    // 2. Check campaigns
    const { data: campaigns } = await supabase
        .from('campaign_jobs')
        .select('id, name, user_id')
        .ilike('name', '%red rose%');
    console.log("Campaigns matched:", campaigns?.length, campaigns);

    // 3. Search leads directly by query across multiple fields
    // Match by campaign_id, custom_fields, notes, or name
    let leadQuery = supabase
        .from('leads')
        .select('id, name, phone, email, pipeline_stage, status, custom_fields, notes, summary, voice_call_status, voice_call_summary, voice_call_transcript, campaign_id, user_id, created_at')
        .or('notes.ilike.%red rose%,summary.ilike.%red rose%,name.ilike.%red rose%');
        
    const { data: matchedLeads, error: lErr } = await leadQuery;
    if (lErr) console.error("Lead query error:", lErr);
    console.log("Leads directly mentioning Red Rose in notes/summary:", matchedLeads?.length);

    // 4. If properties found, get leads for those property users or properties
    let propertyUserIds = (props || []).map(p => p.user_id).filter(Boolean);
    let allLeadsToCheck: any[] = matchedLeads ? [...matchedLeads] : [];

    if (propertyUserIds.length > 0) {
        const { data: userLeads } = await supabase
            .from('leads')
            .select('id, name, phone, email, pipeline_stage, status, custom_fields, notes, summary, voice_call_status, voice_call_summary, voice_call_transcript, campaign_id, user_id, created_at')
            .in('user_id', propertyUserIds)
            .order('created_at', { ascending: false })
            .limit(100);
        console.log(`Leads under property owner (${propertyUserIds.join(', ')}):`, userLeads?.length);
        if (userLeads) {
            for (const ul of userLeads) {
                if (!allLeadsToCheck.some(l => l.id === ul.id)) {
                    allLeadsToCheck.push(ul);
                }
            }
        }
    }

    // 5. Also search lead custom_fields for "Red Rose"
    const { data: cfLeads } = await supabase
        .from('leads')
        .select('id, name, phone, email, pipeline_stage, status, custom_fields, notes, summary, voice_call_status, voice_call_summary, voice_call_transcript, campaign_id, user_id, created_at')
        .not('voice_call_transcript', 'is', null)
        .order('created_at', { ascending: false })
        .limit(200);

    if (cfLeads) {
        for (const l of cfLeads) {
            const rawStr = JSON.stringify(l).toLowerCase();
            if (rawStr.includes('red rose') || rawStr.includes('redrose')) {
                if (!allLeadsToCheck.some(existing => existing.id === l.id)) {
                    allLeadsToCheck.push(l);
                }
            }
        }
    }

    console.log(`Total candidate leads found for Red Rose City: ${allLeadsToCheck.length}`);

    // Analyze qualification & conversation completeness
    for (const lead of allLeadsToCheck) {
        let transcript = lead.voice_call_transcript;
        if (typeof transcript === 'string') {
            try { transcript = JSON.parse(transcript); } catch(e) {}
        }

        const turnsCount = Array.isArray(transcript) ? transcript.length : 0;
        let cf = lead.custom_fields || {};
        if (typeof cf === 'string') {
            try { cf = JSON.parse(cf); } catch(e) {}
        }

        console.log("\n=========================================");
        console.log(`LEAD ID: ${lead.id}`);
        console.log(`NAME: ${lead.name} | PHONE: ${lead.phone}`);
        console.log(`STAGE: ${lead.pipeline_stage} | STATUS: ${lead.status}`);
        console.log(`VOICE CALL STATUS: ${lead.voice_call_status}`);
        console.log(`TRANSCRIPT TURNS: ${turnsCount}`);
        console.log(`VOICE SUMMARY: ${lead.voice_call_summary}`);
        console.log(`CUSTOM FIELDS:`, JSON.stringify(cf, null, 2));

        if (Array.isArray(transcript) && transcript.length > 0) {
            console.log("--- FULL TRANSCRIPT ---");
            transcript.forEach((t: any) => {
                console.log(`[${t.role || 'speaker'}]: ${t.message || t.text}`);
            });
        }
    }
}

run().catch(console.error);
