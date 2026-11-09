import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const VERCEL_API_TOKEN = process.env.VERCEL_API_TOKEN || process.env.VERCEL_TOKEN;
const VERCEL_PROJECT_ID = process.env.VERCEL_PROJECT_ID;
const VERCEL_TEAM_ID = process.env.VERCEL_TEAM_ID;
const SUPABASE_MANAGEMENT_TOKEN = process.env.SUPABASE_MANAGEMENT_TOKEN || process.env.SUPABASE_ACCESS_TOKEN;

// Helper to keep Supabase Auth uri_allow_list in sync with whitelabel domains
async function syncSupabaseAuthRedirect(domain: string, action: 'add' | 'remove') {
  if (!SUPABASE_MANAGEMENT_TOKEN) {
    console.warn('[Domain Sync] SUPABASE_MANAGEMENT_TOKEN not configured; skipping auth redirect sync.');
    return;
  }

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
    if (!projectRef) return;

    const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/config/auth`, {
      headers: {
        Authorization: `Bearer ${SUPABASE_MANAGEMENT_TOKEN}`,
      },
    });

    if (!res.ok) {
      console.warn('[Domain Sync] Failed to fetch current auth config:', await res.text());
      return;
    }

    const config = await res.json();
    const currentList: string[] = (config.uri_allow_list || '')
      .split(',')
      .map((u: string) => u.trim())
      .filter(Boolean);

    const patterns = [`https://${domain}/**`, `https://*.${domain}/**`];

    let updatedList: string[];
    if (action === 'add') {
      const set = new Set([...currentList, ...patterns]);
      updatedList = Array.from(set);
    } else {
      updatedList = currentList.filter(u => !patterns.includes(u));
    }

    const patchRes = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/config/auth`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${SUPABASE_MANAGEMENT_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        uri_allow_list: updatedList.join(','),
      }),
    });

    if (!patchRes.ok) {
      console.warn('[Domain Sync] Failed to update uri_allow_list:', await patchRes.text());
    } else {
      console.log(`[Domain Sync] Successfully ${action === 'add' ? 'added' : 'removed'} ${domain} in Supabase uri_allow_list`);
    }
  } catch (err) {
    console.error('[Domain Sync] Error syncing domain with Supabase Auth:', err);
  }
}

// Use Service Role Key to bypass RLS for administrative domain changes
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Authorise a domain change.
 *
 * This route writes with the service role, so without this check any caller
 * could attach an arbitrary domain to any account by posting a userId. A
 * signed-in user may only change their OWN domain, or the domain of a
 * sub-account inside their own agency.
 */
async function authorizeDomainChange(
  callerRequest: Request,
  targetUserId: string
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  let callerId: string | null = null;

  // Bearer token first (server-to-server / mobile), then the session cookie.
  const authHeader = callerRequest.headers.get('authorization') || '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) {
      const { data } = await supabaseAdmin.auth.getUser(token);
      callerId = data?.user?.id || null;
    }
  }
  if (!callerId) {
    try {
      const { createClient: createServerClient } = await import('@/utils/supabase/server');
      const session = await createServerClient();
      const { data } = await session.auth.getUser();
      callerId = data?.user?.id || null;
    } catch {
      callerId = null;
    }
  }

  if (!callerId) return { ok: false, status: 401, error: 'Authentication required.' };
  if (callerId === targetUserId) return { ok: true };

  const { data: caller } = await supabaseAdmin
    .from('profiles')
    .select('id, role, email, agency_id')
    .eq('id', callerId)
    .maybeSingle();

  const isSuperAdmin =
    caller?.role === 'super_admin' || caller?.email === 'rchopra489@gmail.com';
  if (isSuperAdmin) return { ok: true };

  if (caller?.agency_id) {
    const { data: sub } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('id', targetUserId)
      .eq('agency_id', caller.agency_id)
      .maybeSingle();
    if (sub?.id) return { ok: true };
  }

  return { ok: false, status: 403, error: 'You can only manage domains for your own account.' };
}

// --- INITIALIZE AND LINK DOMAIN (POST) ---
// Directly adds the domain to Vercel and marks it as verified in Supabase
export async function POST(req: Request) {
  try {
    const { domain, userId, type = 'catalogue' } = await req.json();

    if (!domain || !userId) {
      return NextResponse.json({ error: 'Missing domain or userId' }, { status: 400 });
    }

    const auth = await authorizeDomainChange(req, userId);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    // 1. Clean the domain string
    const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim().toLowerCase();

    // 2. Check if domain is already claimed by someone else in YOUR database (check both columns)
    const { data: existingOwner } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .or(`custom_domain.eq.${cleanDomain},whitelabel_domain.eq.${cleanDomain}`)
      .single();

    if (existingOwner && existingOwner.id !== userId) {
      return NextResponse.json({ error: 'This domain is already registered to another account.' }, { status: 403 });
    }

    // 3. Add domain directly to Vercel Project
    let vercelApiUrl = `https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}/domains`;
    if (VERCEL_TEAM_ID) {
      vercelApiUrl += `?teamId=${VERCEL_TEAM_ID}`;
    }

    const vercelRes = await fetch(vercelApiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${VERCEL_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: cleanDomain }),
    });

    if (!vercelRes.ok) {
      const errorData = await vercelRes.json();
      const errorMessage = errorData.error?.message || '';
      const isAlreadyAdded = errorMessage.toLowerCase().includes('already in use') || 
                             errorMessage.toLowerCase().includes('already been added') ||
                             errorMessage.toLowerCase().includes('already_use') ||
                             errorMessage.toLowerCase().includes('already_added');
      if (!isAlreadyAdded) {
        return NextResponse.json({ error: `Vercel Error: ${errorMessage}` }, { status: vercelRes.status });
      }
    }

    // 4. Update the user profile in Supabase as immediately verified
    const updates: any = {};
    if (type === 'platform') {
      updates.whitelabel_domain = cleanDomain;
      updates.whitelabel_verify_token = null;
      updates.whitelabel_verify_status = 'verified';
      await syncSupabaseAuthRedirect(cleanDomain, 'add');
    } else {
      updates.custom_domain = cleanDomain;
      updates.domain_verify_token = null;
      updates.domain_verify_status = 'verified';
    }

    const { error: dbError } = await supabaseAdmin
      .from('profiles')
      .update(updates)
      .eq('id', userId);

    if (dbError) throw dbError;

    return NextResponse.json({ 
      success: true, 
      message: 'Domain linked successfully.'
    });
  } catch (error: any) {
    console.error('Domain POST Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// --- UNLINK DOMAIN (DELETE) ---
// Removes the domain from both Vercel and your database
export async function DELETE(req: Request) {
  try {
    const { domain, userId, type = 'catalogue' } = await req.json();

    if (!domain || !userId) {
      return NextResponse.json({ error: 'Missing domain or userId' }, { status: 400 });
    }

    const auth = await authorizeDomainChange(req, userId);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    // 1. Remove domain from Vercel Project
    let vercelApiUrl = `https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}/domains/${domain}`;
    if (VERCEL_TEAM_ID) {
      vercelApiUrl += `?teamId=${VERCEL_TEAM_ID}`;
    }

    const vercelResponse = await fetch(vercelApiUrl, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${VERCEL_API_TOKEN}`,
      },
    });

    if (!vercelResponse.ok) {
      const errorData = await vercelResponse.json();
      console.warn('Vercel Delete Warning:', errorData.error?.message);
    }

    // 2. Remove domain and verification data from Supabase profile
    const updates: any = {};
    if (type === 'platform') {
      updates.whitelabel_domain = null;
      updates.whitelabel_verify_token = null;
      updates.whitelabel_verify_status = null;
      const cleanDelDomain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim().toLowerCase();
      await syncSupabaseAuthRedirect(cleanDelDomain, 'remove');
    } else {
      updates.custom_domain = null;
      updates.domain_verify_token = null;
      updates.domain_verify_status = null;
    }

    const { error: dbError } = await supabaseAdmin
      .from('profiles')
      .update(updates)
      .eq('id', userId);

    if (dbError) throw dbError;

    return NextResponse.json({ success: true, message: 'Domain unlinked successfully' });
  } catch (error: any) {
    console.error('Domain DELETE Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}