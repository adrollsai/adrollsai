import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Force dynamic execution to bypass Vercel static build cache
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: Request) {
  try {
    // 1. Security check to ensure only authorized triggers hit this dispatcher
    const authHeader = request.headers.get('authorization');
    const url = new URL(request.url);
    const cronSecret = url.searchParams.get('cronSecret') || (authHeader ? authHeader.replace('Bearer ', '') : null);

    if (process.env.CRON_SECRET && cronSecret !== process.env.CRON_SECRET) {
      console.warn('[Auto-Generate Dispatcher] Unauthorized access attempt.');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Fetch all properties that have auto_generate enabled
    const { data: properties, error: propError } = await supabaseAdmin
      .from('properties')
      .select('id')
      .eq('auto_generate', true);

    if (propError) throw propError;

    if (!properties || properties.length === 0) {
      return NextResponse.json({ message: 'No properties scheduled for auto-generation' });
    }

    console.log(`[Auto-Generate Dispatcher] Queueing auto-generation for ${properties.length} properties...`);

    const qstashToken = process.env.QSTASH_TOKEN;
    if (!qstashToken) {
      console.error('[Auto-Generate Dispatcher] QSTASH_TOKEN environment variable is not configured.');
      return NextResponse.json({ error: 'QStash not configured' }, { status: 500 });
    }

    // Construct the destination worker URL dynamically
    const workerUrl = `${url.origin}/api/cron/auto-generate/worker`;
    const publishPromises = properties.map(async (prop) => {
      const qstashPublishUrl = `https://qstash.upstash.io/v2/publish/${workerUrl}`;
      
      const res = await fetch(qstashPublishUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${qstashToken}`,
          'Content-Type': 'application/json',
          // Forward the cron secret authorization to the worker endpoint via QStash
          'Upstash-Forward-Authorization': `Bearer ${process.env.CRON_SECRET || ''}`
        },
        body: JSON.stringify({ id: prop.id })
      });

      if (!res.ok) {
        const errText = await res.text();
        console.error(`[Auto-Generate Dispatcher] Failed to queue property ${prop.id}:`, errText);
      }
    });

    await Promise.all(publishPromises);
    console.log(`[Auto-Generate Dispatcher] Successfully queued ${properties.length} tasks in QStash.`);

    return NextResponse.json({ success: true, queuedCount: properties.length });
  } catch (err: any) {
    console.error('[Auto-Generate Dispatcher] Error:', err);
    return NextResponse.json({ error: 'Internal server error', details: err.message }, { status: 500 });
  }
}