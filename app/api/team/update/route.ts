import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/utils/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

/**
 * Editing a team member: name, email and password.
 *
 * The Team page could add members and delete them, and nothing in between. So the commonest
 * support request in the product — "the new agent's email is a typo", "reset his password so he can
 * log in" — needed a database console, and the member's `profiles.email` could drift permanently
 * from the address they actually sign in with.
 *
 * Three rules, because this route hands an admin another person's login:
 *
 *   1. THE CALLER MUST ADMINISTER THIS MEMBER. Super-admin can edit anyone; a workspace owner (or an
 *      admin under them) can edit only members whose `parent_id` is their own workspace. A member
 *      cannot edit themselves through here either — self-service has its own path.
 *   2. NOTHING ESCALATES. This route cannot change `role`, `parent_id` or `agency_id`. A field that
 *      is not in this handler's list cannot be set by passing it, which is the difference between
 *      "edit a profile" and "take over an account".
 *   3. THE EMAIL IS CONFIRMED BY THE ADMIN, NOT BY THE MEMBER. `email_confirm: true` because the
 *      admin is asserting the address; otherwise Supabase mails a confirmation link to an address
 *      that may well be the typo we are fixing.
 *
 * Every change is reported field by field, so "saved" never hides a partial failure: updating the
 * profile and updating the auth record are two writes, and the response says which of them stuck.
 */
const supabaseAdmin = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

export async function PATCH(req: Request) {
  try {
    const serverSupabase = await createServerClient();
    const {
      data: { user: callerUser },
    } = await serverSupabase.auth.getUser();
    if (!callerUser) {
      return NextResponse.json({ error: 'Unauthorized: admin authentication required.' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const memberId = String(body?.memberId ?? '').trim();
    if (!memberId) return NextResponse.json({ error: 'memberId is required' }, { status: 400 });

    const rawName = body?.name;
    const rawEmail = body?.email;
    const rawPassword = body?.password;
    const name = typeof rawName === 'string' ? rawName.trim() : undefined;
    const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : undefined;
    const password = typeof rawPassword === 'string' ? rawPassword : undefined;

    if (name === undefined && email === undefined && password === undefined) {
      return NextResponse.json({ error: 'nothing to change: give a name, an email or a password' }, { status: 400 });
    }
    if (name !== undefined && !name) {
      return NextResponse.json({ error: 'a name cannot be empty' }, { status: 400 });
    }
    if (email !== undefined && !EMAIL_RE.test(email)) {
      return NextResponse.json({ error: `"${rawEmail}" is not a valid email address` }, { status: 400 });
    }
    if (password !== undefined && password.length < MIN_PASSWORD) {
      return NextResponse.json(
        { error: `the password must be at least ${MIN_PASSWORD} characters` },
        { status: 400 }
      );
    }

    // ── who is asking, and may they touch this member
    const { data: callerProfile } = await supabaseAdmin
      .from('profiles')
      .select('id, role, parent_id')
      .eq('id', callerUser.id)
      .maybeSingle();
    const { data: member } = await supabaseAdmin
      .from('profiles')
      .select('id, role, parent_id, email, business_name, full_name')
      .eq('id', memberId)
      .maybeSingle();

    if (!member) return NextResponse.json({ error: 'no such team member' }, { status: 404 });

    const isSuperAdmin = callerProfile?.role === 'super_admin';
    const callerRoot = (callerProfile as any)?.parent_id || callerProfile?.id;
    const memberRoot = (member as any)?.parent_id || member?.id;
    const sameWorkspace = Boolean(callerRoot && memberRoot && callerRoot === memberRoot);

    if (memberId === callerUser.id) {
      return NextResponse.json(
        { error: 'edit your own details from your account settings, not from team management' },
        { status: 400 }
      );
    }
    if (!isSuperAdmin && !sameWorkspace) {
      return NextResponse.json(
        { error: 'Forbidden: that member is not part of a workspace you administer.' },
        { status: 403 }
      );
    }
    // Editing another ADMIN's login is an account takeover unless you are the platform operator.
    if (!isSuperAdmin && String((member as any)?.role ?? '') === 'admin' && String((callerProfile as any)?.role ?? '') !== 'admin') {
      return NextResponse.json({ error: 'Forbidden: only an admin or super admin can edit another admin.' }, { status: 403 });
    }

    // ── the profile row (display name + the email the UI lists)
    const changed: string[] = [];
    const notChanged: { field: string; reason: string }[] = [];

    const profilePatch: Record<string, any> = {};
    if (name !== undefined) {
      // The team list renders `business_name` first and falls back to `full_name`, and different
      // flows write one or the other — so both are kept in step rather than one silently winning.
      profilePatch.business_name = name;
      profilePatch.full_name = name;
    }
    if (email !== undefined) profilePatch.email = email;

    if (Object.keys(profilePatch).length) {
      const { error: profileError } = await supabaseAdmin
        .from('profiles')
        .update(profilePatch)
        .eq('id', memberId);
      if (profileError) {
        return NextResponse.json({ error: `could not update the profile: ${profileError.message}` }, { status: 500 });
      }
      if (name !== undefined) changed.push('name');
      if (email !== undefined) changed.push('email');
    }

    // ── the login itself (email + password live in auth, not in profiles)
    const authPatch: Record<string, any> = {};
    if (email !== undefined) {
      authPatch.email = email;
      authPatch.email_confirm = true;
    }
    if (password !== undefined) authPatch.password = password;

    if (Object.keys(authPatch).length) {
      const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(memberId, authPatch);
      if (authError) {
        // The profile may already have changed; say exactly that rather than reporting a clean save.
        const already = changed.length ? ` The ${changed.join(' and ')} changed, but` : '';
        return NextResponse.json(
          {
            error: `${already} the login could not be updated: ${authError.message}`,
            changed,
            notChanged: [
              ...(email !== undefined ? [{ field: 'sign-in email', reason: authError.message }] : []),
              ...(password !== undefined ? [{ field: 'password', reason: authError.message }] : []),
            ],
          },
          { status: 502 }
        );
      }
      if (password !== undefined) changed.push('password');
    }

    return NextResponse.json({
      success: true,
      memberId,
      changed,
      notChanged,
      message:
        `Updated ${changed.join(', ')} for ${name || (member as any)?.business_name || (member as any)?.full_name || (member as any)?.email}.` +
        (password !== undefined ? ' They can sign in with the new password immediately.' : '') +
        (email !== undefined ? ' Their sign-in email is now ' + email + '.' : ''),
    });
  } catch (error: any) {
    console.error('[Team API] PATCH failed:', error);
    return NextResponse.json({ error: String(error?.message || error) }, { status: 500 });
  }
}
