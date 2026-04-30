import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const VERCEL_API_TOKEN = process.env.VERCEL_API_TOKEN;
const VERCEL_PROJECT_ID = process.env.VERCEL_PROJECT_ID;

// Use Service Role Key to bypass RLS for administrative domain changes
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// --- INITIALIZE DOMAIN LINKING (POST) ---
// This now generates a token for the user to add to their DNS
export async function POST(req: Request) {
  try {
    const { domain, userId } = await req.json();

    if (!domain || !userId) {
      return NextResponse.json({ error: 'Missing domain or userId' }, { status: 400 });
    }

    // 1. Clean the domain string
    const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim().toLowerCase();

    // 2. Check if domain is already claimed by someone else in YOUR database
    const { data: existingOwner } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('custom_domain', cleanDomain)
      .single();

    if (existingOwner && existingOwner.id !== userId) {
      return NextResponse.json({ error: 'This domain is already registered to another account.' }, { status: 403 });
    }

    // 3. Generate a unique verification token
    const verifyToken = `adrolls-verify=${Math.random().toString(36).substring(2, 15)}`;

    // 4. Update the user profile in Supabase with 'pending' status[cite: 10]
    // We save the token so the user can see it in their dashboard
    const { error: dbError } = await supabaseAdmin
      .from('profiles')
      .update({ 
        custom_domain: cleanDomain,
        domain_verify_token: verifyToken,
        domain_verify_status: 'pending' 
      })
      .eq('id', userId);

    if (dbError) throw dbError;

    // We return the token immediately so the UI can prompt the user to add it to DNS
    return NextResponse.json({ 
      success: true, 
      message: 'Domain initialization successful. Please add the TXT record.',
      verifyToken 
    });
  } catch (error: any) {
    console.error('Domain POST Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// --- UNLINK DOMAIN (DELETE) ---
// Removes the domain from both Vercel and your database[cite: 10]
export async function DELETE(req: Request) {
  try {
    const { domain, userId } = await req.json();

    if (!domain || !userId) {
      return NextResponse.json({ error: 'Missing domain or userId' }, { status: 400 });
    }

    // 1. Remove domain from Vercel Project[cite: 10]
    const vercelResponse = await fetch(
      `https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}/domains/${domain}`,
      {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${VERCEL_API_TOKEN}`,
        },
      }
    );

    // 2. Remove domain and verification data from Supabase profile[cite: 10]
    const { error: dbError } = await supabaseAdmin
      .from('profiles')
      .update({ 
        custom_domain: null,
        domain_verify_token: null,
        domain_verify_status: null
      })
      .eq('id', userId);

    if (dbError) throw dbError;

    return NextResponse.json({ success: true, message: 'Domain unlinked successfully' });
  } catch (error: any) {
    console.error('Domain DELETE Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}