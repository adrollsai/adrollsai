import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { leadId, updates } = await request.json()

    // 1. Check access: Caller must be owner, assigned agent, or staff of the owner
    const { data: checkLead, error: checkError } = await supabase
        .from('leads')
        .select('user_id, assigned_to')
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

    // 2. Update DB using admin client to bypass RLS policies
    const { createClient: createAdminClient } = await import('@supabase/supabase-js');
    const supabaseAdmin = createAdminClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: lead, error } = await supabaseAdmin
        .from('leads')
        .update(updates)
        .eq('id', leadId)
        .select()
        .single()

    if (error) throw error;

    return NextResponse.json({ success: true, lead })

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
