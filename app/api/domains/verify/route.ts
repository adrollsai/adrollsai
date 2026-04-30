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
    const { domain, userId } = await req.json();

    if (!domain || !userId) {
      return NextResponse.json({ error: 'Missing domain or userId' }, { status: 400 });
    }

    // 1. Fetch the exact token from Supabase
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('domain_verify_token')
      .eq('id', userId)
      .single();

    if (profileError || !profile?.domain_verify_token) {
      return NextResponse.json({ error: 'Verification token not found in database.' }, { status: 404 });
    }

    // 2. Safely extract root domain 
    // This safely strips "app." or "www." without breaking subdomains
    const cleanRoot = domain.replace(/^(app|www)\./i, '');
    const verifyHost = `adrolls-verify.${cleanRoot}`;
    const tokenToFind = profile.domain_verify_token.trim();

    // 3. DNS-over-HTTPS (DoH) via Google
    // Bypasses Vercel's serverless UDP port 53 blocking
    let isVerified = false;
    
    try {
      const fetchUrl = `https://dns.google/resolve?name=${verifyHost}&type=TXT`;
      console.log(`[DNS CHECK] Fetching URL: ${fetchUrl}`);

      const dohRes = await fetch(fetchUrl, {
          cache: 'no-store',
          headers: { 'Accept': 'application/json' }
      });
      
      const dohData = await dohRes.json();
      
      // Convert the entire payload to a string to bypass all quotation and formatting quirks
      const googleResponseString = JSON.stringify(dohData);

      if (googleResponseString.includes(tokenToFind)) {
        isVerified = true;
      }
    } catch (fetchErr) {
      console.error("[DNS CHECK] Fetch Error:", fetchErr);
      return NextResponse.json({ error: 'Failed to reach Google DNS API.' }, { status: 500 });
    }

    if (!isVerified) {
      return NextResponse.json({ 
          error: `Token not found at ${verifyHost}. Ensure your DNS record matches exactly: ${tokenToFind}` 
      }, { status: 403 });
    }

    console.log(`[DNS CHECK] SUCCESS! Token found. Adding to Vercel...`);

    // 4. Ownership confirmed! Add to Vercel
    const VERCEL_TEAM_ID = process.env.VERCEL_TEAM_ID;
    let vercelApiUrl = `https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}/domains`;
    
    // Support for Vercel Team accounts
    if (VERCEL_TEAM_ID) {
      vercelApiUrl += `?teamId=${VERCEL_TEAM_ID}`;
    }

    const vercelRes = await fetch(vercelApiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${VERCEL_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: domain }),
    });

    // Handle Vercel Responses & Race Conditions
    if (!vercelRes.ok) {
      const errorData = await vercelRes.json();
      const errorMessage = errorData.error?.message || '';

      // If Vercel says it's already added, we treat it as a success!
      const isAlreadyAdded = errorMessage.toLowerCase().includes('already in use') || 
                             errorMessage.toLowerCase().includes('already been added');

      if (!isAlreadyAdded) {
        console.error("[VERCEL API ERROR]:", errorData);
        return NextResponse.json({ 
            error: `Vercel Error: ${errorMessage || 'Failed to link domain'}` 
        }, { status: vercelRes.status });
      } else {
        console.log('[VERCEL] Domain already exists in Vercel. Proceeding to update database.');
      }
    }

    // 5. Update Supabase Database
    const { error: updateError } = await supabaseAdmin
      .from('profiles')
      .update({ 
        domain_verify_status: 'verified',
        custom_domain: domain // Explicitly save the verified domain string
      })
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