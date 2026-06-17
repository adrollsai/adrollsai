import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { sendCAPIEvent } from '@/utils/external-apis'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leadId, newStage, notes } = await request.json()

  try {
    // 1. Check access: Caller must be owner, assigned agent, or staff of the owner
    const { data: checkLead, error: checkError } = await supabase
        .from('leads')
        .select('user_id, assigned_to, pixel_id')
        .eq('id', leadId)
        .single()

    if (checkError || !checkLead) {
        return NextResponse.json({ error: 'Lead not found or access denied' }, { status: 404 })
    }

    const isOwner = checkLead.user_id === user.id;
    const isAssigned = checkLead.assigned_to === user.id;

    // Fetch caller's profile to verify if they are staff under the lead's owner (user_id)
    const { data: callerProfile } = await supabase
        .from('profiles')
        .select('parent_id, agency_id')
        .eq('id', user.id)
        .single();

    const isStaff = callerProfile && (callerProfile.parent_id === checkLead.user_id || callerProfile.agency_id === checkLead.user_id);

    if (!isOwner && !isAssigned && !isStaff) {
        return NextResponse.json({ error: 'Forbidden: Unauthorized lead access' }, { status: 403 })
    }

    // 2. Update DB
    const { data: lead, error } = await supabase
        .from('leads')
        .update({ 
            pipeline_stage: newStage, 
            notes: notes || undefined 
        })
        .eq('id', leadId)
        .select()
        .single()

    if (error) throw error;

    // 2. Trigger CAPI if stage warrants it
    // We use the admin client to bypass any potential RLS restrictions on reading the lead owner's tokens.
    const { createClient: createAdminClient } = await import('@supabase/supabase-js');
    const supabaseAdmin = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('facebook_token, selected_page_token, pixel_id')
        .eq('id', checkLead.user_id)
        .single();

    const accessToken = profile?.facebook_token || profile?.selected_page_token;
    const pixelId = checkLead?.pixel_id || profile?.pixel_id;

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