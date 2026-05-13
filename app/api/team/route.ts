import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// We use the Service Role key to securely bypass RLS for administrative tasks
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// --- INVITE / ADD AGENT ---
export async function POST(req: Request) {
  try {
    const { adminId, email, password, businessName, fullName, role } = await req.json();

    if (!adminId || !email || !password) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // 1. Search for the user in the auth system
    // Using admin API to safely check if the user exists without exposing data
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.listUsers();
    const existingUser = authData?.users.find(u => u.email === email);

    if (existingUser) {
      // 2A. User EXISTS (e.g., They left another company)
      // We just update their profile to link them to the NEW Admin
      const { error: updateError } = await supabaseAdmin
        .from('profiles')
        .update({
          parent_id: adminId,
          role: role || 'agent',
          // Optionally reset their selected meta pages so they don't bring old data
          selected_page_id: null, 
          ad_account_id: null,
          business_name: fullName || businessName 
        })
        .eq('id', existingUser.id);

      if (updateError) throw updateError;

      return NextResponse.json({ success: true, message: 'Existing user successfully added to your team.' });
    } else {
      // 2B. User DOES NOT EXIST
      // Create user directly with email and password
      const { data: createData, error: createError } = await supabaseAdmin.auth.admin.createUser({
          email: email,
          password: password,
          email_confirm: true,
          user_metadata: { role: role || 'agent', parent_id: adminId } 
      });

      if (createError) throw createError;

      // Ensure their profile is correctly linked immediately
      if (createData?.user?.id) {
          await supabaseAdmin.from('profiles').update({
              parent_id: adminId,
              role: role || 'agent',
              business_name: fullName || businessName
          }).eq('id', createData.user.id);
      }

      return NextResponse.json({ success: true, message: 'Agent account created successfully.' });
    }

  } catch (error: any) {
    console.error("Team API Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// --- REMOVE / OFFBOARD AGENT ---
export async function DELETE(req: Request) {
  try {
    const { adminId, agentId } = await req.json();

    if (!adminId || !agentId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // 1. First, fetch to ensure safety
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('parent_id')
      .eq('id', agentId)
      .single();
      
    if (profile?.parent_id !== adminId) {
      return NextResponse.json({ error: 'Unauthorized to remove this agent' }, { status: 403 });
    }

    // 2. Comprehensive data unlinking to avoid foreign key constraint violations.
    // We re-assign ownership to the Admin and clear agent-specific assignments/subscriptions.
    try {
        await Promise.all([
            // Transfer ownership of core assets to the admin
            supabaseAdmin.from('properties').update({ user_id: adminId }).eq('user_id', agentId),
            supabaseAdmin.from('assets').update({ user_id: adminId }).eq('user_id', agentId),
            supabaseAdmin.from('posts').update({ user_id: adminId }).eq('user_id', agentId),
            
            // Re-assign leads: ownership goes to admin, assignment is cleared
            supabaseAdmin.from('leads').update({ user_id: adminId, assigned_to: null }).eq('user_id', agentId),
            supabaseAdmin.from('leads').update({ assigned_to: null }).eq('assigned_to', agentId),
            
            // Re-assign history logs to admin to preserve the record
            supabaseAdmin.from('lead_history').update({ user_id: adminId }).eq('user_id', agentId),
            
            // Remove push subscriptions so they don't get notifications anymore
            supabaseAdmin.from('push_subscriptions').delete().eq('user_id', agentId),

            // Remove automations linked to the agent
            supabaseAdmin.from('automations').delete().eq('user_id', agentId),

            // Re-assign ad optimizations
            supabaseAdmin.from('ad_optimizations').update({ user_id: adminId }).eq('user_id', agentId)
        ]);

        // Manually delete the profile first to ensure no internal FKs block the Auth deletion
        await supabaseAdmin.from('profiles').delete().eq('id', agentId);
    } catch (unlinkError: any) {
        console.error("Cleanup/Unlink Error Detail:", unlinkError);
    }

    // 3. Completely delete the user from Auth
    const { error } = await supabaseAdmin.auth.admin.deleteUser(agentId);

    if (error) {
        console.error("Supabase Auth Delete Error:", error);
        throw error;
    }

    return NextResponse.json({ success: true, message: 'Agent account successfully removed.' });
  } catch (error: any) {
    console.error("Team DELETE Fatal Error:", error);
    return NextResponse.json({ error: error.message || "Failed to remove agent" }, { status: 500 });
  }
}