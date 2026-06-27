import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const VERCEL_API_TOKEN = process.env.VERCEL_API_TOKEN || process.env.VERCEL_TOKEN;
const VERCEL_PROJECT_ID = process.env.VERCEL_PROJECT_ID;
const VERCEL_TEAM_ID = process.env.VERCEL_TEAM_ID;

// Use Service Role Key to bypass RLS for administrative domain changes
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// --- INITIALIZE AND LINK DOMAIN (POST) ---
// Directly adds the domain to Vercel and marks it as verified in Supabase
export async function POST(req: Request) {
  try {
    const { domain, userId, type = 'catalogue' } = await req.json();

    if (!domain || !userId) {
      return NextResponse.json({ error: 'Missing domain or userId' }, { status: 400 });
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