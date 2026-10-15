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
    const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '').trim() : '';
    const cronSecret = url.searchParams.get('cronSecret')?.trim() || token || null;
    const expectedSecret = process.env.CRON_SECRET ? process.env.CRON_SECRET.trim() : '';

    if (expectedSecret && cronSecret !== expectedSecret) {
      console.warn('[Auto-Generate Dispatcher] Unauthorized access attempt.');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isForce = url.searchParams.get('force') === 'true';

    // 2. Fetch all properties that have auto_generate enabled
    const { data: properties, error: propError } = await supabaseAdmin
      .from('properties')
      .select('id, title, user_id, configurations')
      .eq('auto_generate', true);

    if (propError) throw propError;

    if (!properties || properties.length === 0) {
      return NextResponse.json({ message: 'No properties scheduled for auto-generation' });
    }

    // Current time in IST (UTC + 5:30)
    const nowUtc = new Date();
    const istOffsetMs = 5.5 * 60 * 60 * 1000;
    const nowIst = new Date(nowUtc.getTime() + istOffsetMs);
    const currentIstHour = nowIst.getUTCHours();
    // Start of today in IST
    const todayStartIst = new Date(Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), nowIst.getUTCDate(), 0, 0, 0) - istOffsetMs).toISOString();

    const propertiesToQueue: typeof properties = [];

    for (const prop of properties) {
      if (isForce) {
        propertiesToQueue.push(prop);
        continue;
      }

      // Check if an asset was already created for this property today
      const { count: existingCount } = await supabaseAdmin
        .from('assets')
        .select('id', { count: 'exact', head: true })
        .eq('property_id', prop.id)
        .gte('created_at', todayStartIst);

      if (existingCount && existingCount > 0) {
        console.log(`[Auto-Generate Dispatcher] Property "${prop.title}" (${prop.id}) already generated an asset today. Skipping.`);
        continue;
      }

      // Check configured time_of_day (Default: "09:00", i.e. 9:00 AM IST)
      let autoGenSettings: any = {};
      if (prop.configurations) {
        if (typeof prop.configurations === 'object') {
          autoGenSettings = prop.configurations.auto_gen_settings || {};
        } else {
          try {
            const parsed = JSON.parse(prop.configurations);
            autoGenSettings = parsed.auto_gen_settings || {};
          } catch (e) {}
        }
      }

      const timeOfDay = autoGenSettings.time_of_day || '09:00';
      const targetHour = parseInt(timeOfDay.split(':')[0], 10) || 9;

      // If current IST hour is at or past target hour, queue it
      if (currentIstHour >= targetHour) {
        propertiesToQueue.push(prop);
      } else {
        console.log(`[Auto-Generate Dispatcher] Property "${prop.title}" scheduled for ${timeOfDay} IST (current hour: ${currentIstHour}). Waiting for schedule.`);
      }
    }

    if (propertiesToQueue.length === 0) {
      return NextResponse.json({ 
        message: 'No properties due for auto-generation at this hour', 
        currentIstHour,
        totalEnabled: properties.length 
      });
    }

    console.log(`[Auto-Generate Dispatcher] Queueing auto-generation for ${propertiesToQueue.length} properties (out of ${properties.length} enabled)...`);

    const qstashToken = process.env.QSTASH_TOKEN;
    if (!qstashToken) {
      console.error('[Auto-Generate Dispatcher] QSTASH_TOKEN environment variable is not configured.');
      return NextResponse.json({ error: 'QStash not configured' }, { status: 500 });
    }

    // Construct the destination worker URL dynamically using public domain
    const forwardedHost = request.headers.get('x-forwarded-host');
    const forwardedProto = request.headers.get('x-forwarded-proto') || 'https';
    let baseUrl = `${url.origin}`;
    if (forwardedHost && !forwardedHost.includes('localhost') && !forwardedHost.includes('local.')) {
      baseUrl = `${forwardedProto}://${forwardedHost}`;
    } else if (process.env.NEXT_PUBLIC_APP_URL && !process.env.NEXT_PUBLIC_APP_URL.includes('localhost') && !process.env.NEXT_PUBLIC_APP_URL.includes('local.')) {
      baseUrl = process.env.NEXT_PUBLIC_APP_URL;
    } else {
      baseUrl = 'https://app.nobogent.com';
    }

    const workerUrl = `${baseUrl.replace(/\/$/, '')}/api/cron/auto-generate/worker`;
    const publishPromises = propertiesToQueue.map(async (prop) => {
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