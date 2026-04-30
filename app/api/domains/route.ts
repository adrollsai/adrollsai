import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const VERCEL_API_TOKEN = process.env.VERCEL_API_TOKEN;
const VERCEL_PROJECT_ID = process.env.VERCEL_PROJECT_ID;

// Use Service Role Key to bypass RLS for administrative domain changes
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// --- CONNECT DOMAIN (POST) ---
export async function POST(req: Request) {
  try {
    const { domain, userId } = await req.json();

    if (!domain || !userId) {
      return NextResponse.json({ error: 'Missing domain or userId' }, { status: 400 });
    }

    // 1. Add domain to Vercel Project
    const vercelResponse = await fetch(
      `https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}/domains`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${VERCEL_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: domain }),
      }
    );

    const vercelData = await vercelResponse.json();

    if (!vercelResponse.ok) {
      return NextResponse.json(
        { error: vercelData.error?.message || 'Vercel connection failed' },
        { status: vercelResponse.status }
      );
    }

    // 2. Update the user profile in Supabase
    const { error: dbError } = await supabaseAdmin
      .from('profiles')
      .update({ custom_domain: domain })
      .eq('id', userId);

    if (dbError) throw dbError;

    return NextResponse.json({ success: true, message: 'Domain connected successfully' });
  } catch (error: any) {
    console.error('Domain POST Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// --- UNLINK DOMAIN (DELETE) ---
export async function DELETE(req: Request) {
  try {
    const { domain, userId } = await req.json();

    if (!domain || !userId) {
      return NextResponse.json({ error: 'Missing domain or userId' }, { status: 400 });
    }

    // 1. Remove domain from Vercel Project
    const vercelResponse = await fetch(
      `https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}/domains/${domain}`,
      {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${VERCEL_API_TOKEN}`,
        },
      }
    );

    // We do not throw an error if Vercel fails (e.g., domain already deleted manually)
    // to ensure the local database can still be cleaned up.

    // 2. Remove domain from Supabase profile
    const { error: dbError } = await supabaseAdmin
      .from('profiles')
      .update({ custom_domain: null })
      .eq('id', userId);

    if (dbError) throw dbError;

    return NextResponse.json({ success: true, message: 'Domain unlinked successfully' });
  } catch (error: any) {
    console.error('Domain DELETE Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}