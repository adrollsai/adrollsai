import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import dns from 'dns/promises';

const VERCEL_API_TOKEN = process.env.VERCEL_API_TOKEN;
const VERCEL_PROJECT_ID = process.env.VERCEL_PROJECT_ID;

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  try {
    const { domain, userId } = await req.json();

    if (!domain || !userId) {
      return NextResponse.json({ error: 'Missing data' }, { status: 400 });
    }

    // 1. Fetch the stored token from Supabase
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('domain_verify_token')
      .eq('id', userId)
      .single();

    if (profileError || !profile?.domain_verify_token) {
      return NextResponse.json({ error: 'Verification token not found. Please restart setup.' }, { status: 404 });
    }

    // 2. Perform DNS Lookup for TXT records[cite: 10]
    try {
      const records = await dns.resolveTxt(domain);
      const flatRecords = records.flat();
      const isVerified = flatRecords.includes(profile.domain_verify_token);

      if (!isVerified) {
        return NextResponse.json({ 
            error: 'Verification failed. We could not find the TXT record. DNS changes can take up to 24 hours to propagate.' 
        }, { status: 403 });
      }
    } catch (dnsErr) {
      return NextResponse.json({ error: 'Domain not found or DNS unreachable.' }, { status: 400 });
    }

    // 3. Ownership confirmed! Now add to Vercel[cite: 10]
    const vercelRes = await fetch(`https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}/domains`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${VERCEL_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: domain }),
    });

    if (!vercelRes.ok) {
      const errorData = await vercelRes.json();
      return NextResponse.json({ error: errorData.error?.message || 'Vercel connection failed' }, { status: vercelRes.status });
    }

    // 4. Update status to 'verified' in Supabase[cite: 10]
    await supabaseAdmin
      .from('profiles')
      .update({ domain_verify_status: 'verified' })
      .eq('id', userId);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}