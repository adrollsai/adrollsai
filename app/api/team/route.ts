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
    const { adminId, email, businessName } = await req.json();

    if (!adminId || !email) {
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
          role: 'agent',
          // Optionally reset their selected meta pages so they don't bring old data
          selected_page_id: null, 
          ad_account_id: null 
        })
        .eq('id', existingUser.id);

      if (updateError) throw updateError;

      return NextResponse.json({ success: true, message: 'Existing user successfully added to your team.' });
    } else {
      // 2B. User DOES NOT EXIST
      // Send them an official Supabase invite link. 
      // (This automatically creates their auth account and fires your profile trigger)
      const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
          data: { role: 'agent', parent_id: adminId } // Passes metadata to your DB triggers if you have them
      });

      if (inviteError) throw inviteError;

      // Ensure their profile is correctly linked immediately
      if (inviteData?.user?.id) {
          await supabaseAdmin.from('profiles').update({
              parent_id: adminId,
              role: 'agent'
          }).eq('id', inviteData.user.id);
      }

      return NextResponse.json({ success: true, message: 'Invitation email sent to new user.' });
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

    // 1. Securely unlink the agent. We verify the adminId matches to prevent unauthorized removals.
    const { error } = await supabaseAdmin
      .from('profiles')
      .update({
        parent_id: null,
        role: 'unassigned' // They can still log in, but will have a blank/empty dashboard
      })
      .match({ id: agentId, parent_id: adminId }); // match() ensures safety

    if (error) throw error;

    return NextResponse.json({ success: true, message: 'Agent removed and access revoked.' });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}