import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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

    // 1. Fetch the token
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('domain_verify_token')
      .eq('id', userId)
      .single();

    if (profileError || !profile?.domain_verify_token) {
      return NextResponse.json({ error: 'Verification token not found.' }, { status: 404 });
    }

    // 2. Safely extract root domain 
    // This safely strips "app." or "www." without breaking .co.in domains
    const cleanRoot = domain.replace(/^(app|www)\./i, '');
    const verifyHost = `adrolls-verify.${cleanRoot}`;
    const tokenToFind = profile.domain_verify_token.trim();

    // 3. DNS-over-HTTPS (DoH) via Google
    let isVerified = false;
    let googleResponseString = ""; // Store for debugging
    
    try {
      const fetchUrl = `https://dns.google/resolve?name=${verifyHost}&type=TXT`;
      console.log(`[DNS CHECK] Fetching URL: ${fetchUrl}`);

      const dohRes = await fetch(fetchUrl, {
          cache: 'no-store',
          headers: { 'Accept': 'application/json' }
      });
      
      const dohData = await dohRes.json();
      
      // THE NUCLEAR OPTION: Convert the entire payload to a string
      // This bypasses all quotation, escaping, and formatting quirks from Google
      googleResponseString = JSON.stringify(dohData);
      console.log(`[DNS CHECK] Google Response Payload:`, googleResponseString);
      console.log(`[DNS CHECK] Looking for exact token:`, tokenToFind);

      if (googleResponseString.includes(tokenToFind)) {
        isVerified = true;
      }
    } catch (fetchErr) {
      console.error("[DNS CHECK] Fetch Error:", fetchErr);
      return NextResponse.json({ error: 'Failed to reach Google DNS API.' }, { status: 500 });
    }

    if (!isVerified) {
      // If it fails, check your local terminal! The console.log will show you exactly what it saw.
      return NextResponse.json({ 
          error: `Token not found at ${verifyHost}. Check terminal logs.` 
      }, { status: 403 });
    }

    console.log(`[DNS CHECK] SUCCESS! Token found. Adding to Vercel...`);

    // 4. Ownership confirmed! Add to Vercel
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
      return NextResponse.json({ 
          error: `Vercel Error: ${errorData.error?.message || 'Failed to link'}` 
      }, { status: vercelRes.status });
    }

    // 5. Update status
    await supabaseAdmin
      .from('profiles')
      .update({ domain_verify_status: 'verified' })
      .eq('id', userId);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("[DNS CHECK] System Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}