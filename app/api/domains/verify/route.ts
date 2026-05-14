import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const VERCEL_API_TOKEN = process.env.VERCEL_API_TOKEN;
const VERCEL_PROJECT_ID = process.env.VERCEL_PROJECT_ID;

// Use Service Role Key to bypass RLS for admin operations
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  try {
    const { domain, userId, type = 'catalogue' } = await req.json();

    if (!domain || !userId) {
      return NextResponse.json({ error: 'Missing domain or userId' }, { status: 400 });
    }

    // 1. Fetch the exact token from Supabase
    const tokenField = type === 'platform' ? 'whitelabel_verify_token' : 'domain_verify_token';
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select(tokenField)
      .eq('id', userId)
      .single();

    const verifyToken = profile?.[tokenField as keyof typeof profile];

    if (profileError || !verifyToken) {
      return NextResponse.json({ error: 'Verification token not found in database.' }, { status: 404 });
    }

    // 2. Safely extract root domain 
    const cleanRoot = domain.replace(/^(app|www)\./i, '');
    const verifyHost = `adrolls-verify.${cleanRoot}`;
    const tokenToFind = (verifyToken as string).trim();

    // ... (DNS CHECK Logic remains the same) ...
    let isVerified = false;
    
    try {
      const fetchUrl = `https://dns.google/resolve?name=${verifyHost}&type=TXT`;
      const dohRes = await fetch(fetchUrl, {
          cache: 'no-store',
          headers: { 'Accept': 'application/json' }
      });
      const dohData = await dohRes.json();
      const googleResponseString = JSON.stringify(dohData);
      if (googleResponseString.includes(tokenToFind)) {
        isVerified = true;
      }
    } catch (fetchErr) {
      return NextResponse.json({ error: 'Failed to reach Google DNS API.' }, { status: 500 });
    }

    if (!isVerified) {
      return NextResponse.json({ 
          error: `Token not found at ${verifyHost}. Ensure your DNS record matches exactly: ${tokenToFind}` 
      }, { status: 403 });
    }

    // ... (Vercel API Logic remains the same) ...
    const VERCEL_TEAM_ID = process.env.VERCEL_TEAM_ID;
    let vercelApiUrl = `https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}/domains`;
    if (VERCEL_TEAM_ID) vercelApiUrl += `?teamId=${VERCEL_TEAM_ID}`;

    const vercelRes = await fetch(vercelApiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${VERCEL_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: domain }),
    });

    if (!vercelRes.ok) {
      const errorData = await vercelRes.json();
      const errorMessage = errorData.error?.message || '';
      const isAlreadyAdded = errorMessage.toLowerCase().includes('already in use') || 
                             errorMessage.toLowerCase().includes('already been added');
      if (!isAlreadyAdded) {
        return NextResponse.json({ error: `Vercel Error: ${errorMessage}` }, { status: vercelRes.status });
      }
    }

    // 5. Update Supabase Database
    const updates: any = {};
    if (type === 'platform') {
        updates.whitelabel_verify_status = 'verified';
        updates.whitelabel_domain = domain;
    } else {
        updates.domain_verify_status = 'verified';
        updates.custom_domain = domain;
    }

    const { error: updateError } = await supabaseAdmin
      .from('profiles')
      .update(updates)
      .eq('id', userId);

    if (updateError) {
      console.error("[SUPABASE ERROR]:", updateError);
      return NextResponse.json({ 
        error: 'Domain linked successfully, but failed to update user profile in database.' 
      }, { status: 500 });
    }

    console.log(`[VERIFY SUCCESS] Domain ${domain} verified and linked for user ${userId}.`);
    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error("[SYSTEM ERROR]:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}