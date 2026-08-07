import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { sendCAPIEvent } from '@/utils/external-apis'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leadId, newStage, notes } = await request.json()

  try {
    // Initialize admin client to securely bypass RLS for hierarchical checks and updates
    const supabaseAdmin = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // 1. Check access: Caller must be owner, assigned agent, or staff of the owner
    const { data: checkLead, error: checkError } = await supabase
        .from('leads')
        .select('user_id, assigned_to, pixel_id')
        .eq('id', leadId)
        .single()

    if (checkError || !checkLead) {
        return NextResponse.json({ error: 'Lead not found or access denied' }, { status: 404 })
    }

    // Fetch caller's profile and lead owner's profile using admin client to securely verify hierarchy
    const { data: callerProfile } = await supabaseAdmin
        .from('profiles')
        .select('parent_id, agency_id, role')
        .eq('id', user.id)
        .single();

    const { data: ownerProfile } = await supabaseAdmin
        .from('profiles')
        .select('parent_id, agency_id, role')
        .eq('id', checkLead.user_id)
        .single();

    const isOwner = checkLead.user_id === user.id;
    const isAssigned = checkLead.assigned_to === user.id;
    
    let isAuthorized = isOwner || isAssigned;

    if (!isAuthorized && callerProfile) {
        const callerRole = callerProfile.role;
        const callerParentId = callerProfile.parent_id;
        const callerAgencyId = callerProfile.agency_id;

        if (callerRole === 'super_admin') {
            isAuthorized = true;
        } else if (ownerProfile) {
            const ownerParentId = ownerProfile.parent_id;
            const ownerAgencyId = ownerProfile.agency_id;

            // 1. Check if caller is the agency owner/admin of the lead's owner
            const isAgencyOwner = (ownerAgencyId === user.id || ownerParentId === user.id);

            // 2. Check if caller is staff directly under the lead's owner
            const isDirectStaff = (callerParentId === checkLead.user_id || callerAgencyId === checkLead.user_id);

            // 3. Check if caller and lead's owner share the same parent or agency root
            const callerRoot = callerParentId || callerAgencyId || user.id;
            const ownerRoot = ownerParentId || ownerAgencyId || checkLead.user_id;
            const isCoStaff = callerRoot === ownerRoot;

            if (isAgencyOwner || isDirectStaff || isCoStaff) {
                isAuthorized = true;
            }
        }
    }

    if (!isAuthorized) {
        return NextResponse.json({ error: 'Forbidden: Unauthorized lead access' }, { status: 403 })
    }


    const { data: lead, error } = await supabaseAdmin
        .from('leads')
        .update({ 
            status: newStage,
            pipeline_stage: newStage, 
            notes: notes || undefined 
        })
        .eq('id', leadId)
        .select()
        .single()

    if (error) throw error;

    // 2. Trigger CAPI if stage warrants it
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