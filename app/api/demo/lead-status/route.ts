import { NextResponse } from 'next/server';
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js';

const supabaseAdmin = createSupabaseAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
);

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const leadId = searchParams.get('leadId');

        if (!leadId) {
            return NextResponse.json({ error: 'Lead ID is required.' }, { status: 400 });
        }

        const { data: lead, error } = await supabaseAdmin
            .from('leads')
            .select('id, name, phone, voice_call_status, voice_call_summary, voice_call_transcript, voice_recording_url, pipeline_stage, status, notes, updated_at')
            .eq('id', leadId)
            .single();

        if (error || !lead) {
            return NextResponse.json({ error: 'Lead not found.' }, { status: 404 });
        }

        const summaryLower = (lead.voice_call_summary || '').toLowerCase();
        const stageLower = (lead.pipeline_stage || lead.status || '').toLowerCase();
        
        const isAppointmentBooked = 
            stageLower.includes('appointment') || 
            stageLower.includes('site visit') || 
            summaryLower.includes('appointment') || 
            summaryLower.includes('site visit') ||
            summaryLower.includes('booked') ||
            summaryLower.includes('scheduled');

        return NextResponse.json({
            success: true,
            status: lead.voice_call_status || 'calling',
            summary: lead.voice_call_summary || null,
            transcript: lead.voice_call_transcript || [],
            recordingUrl: lead.voice_recording_url || null,
            pipelineStage: lead.pipeline_stage || 'New Lead',
            isAppointmentBooked
        });

    } catch (err: any) {
        return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
    }
}
