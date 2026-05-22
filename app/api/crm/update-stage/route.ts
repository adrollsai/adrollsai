import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { sendCAPIEvent } from '@/utils/external-apis'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leadId, newStage, notes } = await request.json()

  try {
    // 1. Update DB
    const { data: lead, error } = await supabase
        .from('leads')
        .update({ 
            pipeline_stage: newStage, 
            notes: notes || undefined 
        })
        .eq('id', leadId)
        .eq('user_id', user.id)
        .select()
        .single()

    if (error) throw error;

    // 2. Trigger CAPI if stage warrants it
    const { data: profile } = await supabase
        .from('profiles')
        .select('facebook_token, selected_page_token, pixel_id')
        .eq('id', user.id)
        .single()

    const accessToken = profile?.facebook_token || profile?.selected_page_token;
    const pixelId = profile?.pixel_id;

    if (accessToken && pixelId) {
        let eventName = '';
        if (newStage === 'Qualified') eventName = 'Lead';
        if (newStage === 'Appointment booked') eventName = 'Schedule';
        if (newStage === 'Appointment done') eventName = 'Other';
        if (newStage === 'Closed') eventName = 'Purchase';

        if (eventName) {
            // Split name if possible
            const nameParts = (lead.name || '').split(' ');
            const firstName = nameParts[0] || '';
            const lastName = nameParts.slice(1).join(' ') || '';

            // Extract client environment details for rich Event Match Quality (EMQ)
            const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || request.headers.get('x-real-ip') || '127.0.0.1';
            const clientUa = request.headers.get('user-agent') || '';
            const referer = request.headers.get('referer') || '';
            const host = request.headers.get('host') || 'adrolls.in';
            const protocol = host.includes('localhost') || host.includes('ngrok') ? 'http' : 'https';
            const sourceUrl = referer || `${protocol}://${host}/shared/${user.id}`;

            await sendCAPIEvent(
                accessToken, 
                pixelId, 
                eventName, 
                { 
                    email: lead.email, 
                    phone: lead.phone,
                    firstName,
                    lastName,
                    externalId: lead.id
                },
                newStage === 'Closed' ? 50000 : 0, // Assigning a default value for Closed leads
                clientIp,
                clientUa,
                sourceUrl
            );
        }
    }

    return NextResponse.json({ success: true })

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}