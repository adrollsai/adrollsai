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
    let { adminId, email, password, businessName, fullName, role } = await req.json();

    // Strict Sanitization
    email = email?.trim().toLowerCase();

    if (!adminId || !email || !password) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // PROJECT VERIFICATION LOG (Check your terminal)
    console.log(`[TEAM API] Target Project: ${process.env.NEXT_PUBLIC_SUPABASE_URL?.substring(0, 25)}...`);
    console.log(`[TEAM API] Attempting to create: ${email}`);

    // Determine the correct link column based on role
    const profileUpdates: any = {
      role: role || 'agent',
      business_name: fullName || businessName,
      selected_page_id: null, 
      ad_account_id: null,
      email: email // We'll try to store this in profiles for easier lookup next time
    }

    const { data: adminProfile } = await supabaseAdmin.from('profiles').select('agency_id, role').eq('id', adminId).single()
    
    if (role === 'client') {
        profileUpdates.agency_id = adminId
    } else {
        profileUpdates.parent_id = adminId
        if (adminProfile?.role === 'agency') {
            profileUpdates.agency_id = adminId
        } else if (adminProfile?.agency_id) {
            profileUpdates.agency_id = adminProfile.agency_id
        }
    }

    // 1. Helper to find user by email across all pages (Fixes pagination bug)
    const findUserByEmail = async (targetEmail: string) => {
        targetEmail = targetEmail.toLowerCase().trim();
        console.log(`[TEAM API] Searching for existing user: ${targetEmail}`);

        // Fallback A: Check Profiles table first
        const { data: pData } = await supabaseAdmin.from('profiles').select('id').eq('email', targetEmail).single();
        if (pData?.id) {
            console.log(`[TEAM API] Found user ID in Profiles: ${pData.id}`);
            return { id: pData.id };
        }

        // Fallback B: Paginated search through Auth directory
        let page = 1;
        while (true) { 
            const { data: { users }, error } = await supabaseAdmin.auth.admin.listUsers({
                page,
                perPage: 1000
            });
            
            if (error || !users || users.length === 0) break;
            
            // DIAGNOSTIC: Print all emails found to terminal
            console.log(`[TEAM API] Found ${users.length} users in project. Registered Emails:`, users.map(u => u.email));

            const found = users.find(u => u.email?.toLowerCase().trim() === targetEmail);
            if (found) return found;
            if (users.length < 1000) break;
            page++;
        }

        // Fallback C: Invite Hack
        console.log(`[TEAM API] Directory search failed. Trying Invite Hack: ${targetEmail}`);
        const { data: inviteData } = await supabaseAdmin.auth.admin.inviteUserByEmail(targetEmail);
        if (inviteData?.user?.id) return inviteData.user;

        // Fallback D: Magic Link Hack (The most aggressive lookup)
        console.log(`[TEAM API] Invite failed. Trying Magic Link Hack: ${targetEmail}`);
        const { data: linkData } = await supabaseAdmin.auth.admin.generateLink({
            type: 'magiclink',
            email: targetEmail
        });
        if (linkData?.user?.id) {
            console.log(`[TEAM API] Recovered ID via Magic Link: ${linkData.user.id}`);
            return linkData.user;
        }

        return null;
    }

    // 2. Resolve the user (Create or Find)
    let targetUserId: string | null = null;
    let isNewUser = false;

    // Try to create first
    const { data: createData, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: email,
        password: password,
        email_confirm: true,
        user_metadata: { role: role || 'agent' } 
    });

    if (createError) {
        const errMsg = createError.message.toLowerCase();
        if (errMsg.includes('already registered') || errMsg.includes('already been registered') || (createError as any).code === 'email_exists') {
            console.log(`[TEAM API] User exists. Starting recovery search...`);
            const existing = await findUserByEmail(email);
            if (!existing) {
                // LAST RESORT: If Supabase says they exist but we can't find them, 
                // it might be a weird sync issue. We'll try to find them by looking 
                // for ANY profile with that email or just return a descriptive error.
                throw new Error(`Supabase says "${email}" exists, but it's hidden from the directory. Please delete the user from Supabase Auth manually and try again.`);
            }
            targetUserId = existing.id;

            // FORCE PASSWORD UPDATE (So the login they just created actually works)
            console.log(`[TEAM API] Syncing password for existing user: ${targetUserId}`);
            const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(targetUserId as string, {
                password: password,
                email_confirm: true
            });
            if (updateError) console.error("[TEAM API] Warning: Could not sync password:", updateError);
        } else {
            console.error("Supabase CreateUser Fatal Error:", createError);
            return NextResponse.json({ error: `Auth Error: ${createError.message}` }, { status: 400 });
        }
    } else {
        targetUserId = createData.user.id;
        isNewUser = true;
    }

    // 3. Upsert Profile
    if (targetUserId) {
        const { error: profileError } = await supabaseAdmin
            .from('profiles')
            .upsert({ 
                id: targetUserId,
                ...profileUpdates 
            });
        
        if (profileError) {
            console.error("Profile Upsert Error:", profileError);
            throw new Error(`Profile Error: ${profileError.message}`);
        }
    }

    return NextResponse.json({ 
        success: true, 
        message: isNewUser ? 'Account created successfully.' : 'Existing account successfully linked.' 
    });

  } catch (error: any) {
    console.error("Team API Fatal Error:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
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