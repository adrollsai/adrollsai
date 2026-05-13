import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// We use the Service Role key to securely bypass RLS for administrative tasks
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// --- INVITE / ADD MEMBER OR SUB-ACCOUNT ---
export async function POST(req: Request) {
  try {
    const { adminId, email, password, businessName, fullName, role } = await req.json();

    if (!adminId || !email || !password) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // 1. Search for the user in the auth system
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.listUsers();
    const existingUser = authData?.users.find(u => u.email === email);

    // Determine the correct link column based on role
    // Clients link to Agency via agency_id
    // Agents link to Admin via parent_id or agency_id
    const profileUpdates: any = {
      role: role || 'agent',
      business_name: fullName || businessName,
      selected_page_id: null, 
      ad_account_id: null,
    }

    if (role === 'client') {
        profileUpdates.agency_id = adminId
    } else {
        profileUpdates.parent_id = adminId
        // Also inherit agency_id if the parent has one
        const { data: adminProfile } = await supabaseAdmin.from('profiles').select('agency_id').eq('id', adminId).single()
        if (adminProfile?.agency_id) {
            profileUpdates.agency_id = adminProfile.agency_id
        }
    }

    if (existingUser) {
      // 2A. User EXISTS
      const { error: updateError } = await supabaseAdmin
        .from('profiles')
        .update(profileUpdates)
        .eq('id', existingUser.id);

      if (updateError) throw updateError;

      return NextResponse.json({ success: true, message: 'Existing user successfully updated and linked.' });
    } else {
      // 2B. User DOES NOT EXIST
      const { data: createData, error: createError } = await supabaseAdmin.auth.admin.createUser({
          email: email,
          password: password,
          email_confirm: true,
          user_metadata: { role: role || 'agent' } 
      });

      if (createError) throw createError;

      if (createData?.user?.id) {
          await supabaseAdmin.from('profiles').update(profileUpdates).eq('id', createData.user.id);
      }

      return NextResponse.json({ success: true, message: `${role === 'client' ? 'Sub-account' : 'Member'} created successfully.` });
    }

  } catch (error: any) {
    console.error("Team API Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// --- REMOVE / OFFBOARD MEMBER OR SUB-ACCOUNT ---
export async function DELETE(req: Request) {
  try {
    const { adminId, agentId } = await req.json();

    if (!adminId || !agentId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // 1. Verify authority
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('parent_id, agency_id, role')
      .eq('id', agentId)
      .single();
      
    const isAuthorized = profile?.parent_id === adminId || profile?.agency_id === adminId;

    if (!isAuthorized) {
      return NextResponse.json({ error: 'Unauthorized to remove this account' }, { status: 403 });
    }

    // 2. Comprehensive data unlinking
    try {
        await Promise.all([
            supabaseAdmin.from('properties').update({ user_id: adminId }).eq('user_id', agentId),
            supabaseAdmin.from('assets').update({ user_id: adminId }).eq('user_id', agentId),
            supabaseAdmin.from('posts').update({ user_id: adminId }).eq('user_id', agentId),
            supabaseAdmin.from('leads').update({ user_id: adminId, assigned_to: null }).eq('user_id', agentId),
            supabaseAdmin.from('leads').update({ assigned_to: null }).eq('assigned_to', agentId),
            supabaseAdmin.from('lead_history').update({ user_id: adminId }).eq('user_id', agentId),
            supabaseAdmin.from('push_subscriptions').delete().eq('user_id', agentId),
            supabaseAdmin.from('automations').delete().eq('user_id', agentId),
            supabaseAdmin.from('ad_optimizations').update({ user_id: adminId }).eq('user_id', agentId)
        ]);

        await supabaseAdmin.from('profiles').delete().eq('id', agentId);
    } catch (unlinkError: any) {
        console.error("Cleanup/Unlink Error Detail:", unlinkError);
    }

    // 3. Delete from Auth
    const { error } = await supabaseAdmin.auth.admin.deleteUser(agentId);

    if (error) {
        console.error("Supabase Auth Delete Error:", error);
        throw error;
    }

    return NextResponse.json({ success: true, message: 'Account successfully removed.' });
  } catch (error: any) {
    console.error("Team DELETE Fatal Error:", error);
    return NextResponse.json({ error: error.message || "Failed to remove account" }, { status: 500 });
  }
}