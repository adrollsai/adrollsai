import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase Admin
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const FB_GRAPH_URL = 'https://graph.facebook.com/v19.0';

/**
 * META WARMUP CRON
 * Purpose: 
 * 1. Generate legitimate API volume (GET requests) to reach the 1,500 call threshold for Advanced Access.
 * 2. Keep the local dashboard data in sync with Meta (Campaign status, Lead Form counts).
 * 3. Maintain a high success rate (>85%) required by Meta.
 */
export async function GET(request: Request) {
    const authHeader = request.headers.get('authorization');
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        // 1. Fetch only the authorized developer profile to avoid 403 errors from others
        const developerUserId = 'bc63c065-9bcc-4793-bedc-f0960406425b';
        
        const { data: profiles, error: profileError } = await supabaseAdmin
            .from('profiles')
            .select('id, facebook_token, facebook_page_id, ad_account_id')
            .eq('id', developerUserId)
            .not('facebook_token', 'is', null);

        if (profileError || !profiles || profiles.length === 0) {
            return NextResponse.json({ message: 'No accounts to warm up' });
        }

        const stats = {
            totalProfiles: profiles.length,
            callsMade: 0,
            success: 0,
            failed: 0
        };

        // 2. Process each profile (Parallelized for efficiency)
        await Promise.all(profiles.map(async (profile) => {
            const token = profile.facebook_token;
            
            try {
                // TASK A: Fetch Page Info (1 Call)
                if (profile.facebook_page_id) {
                    const pageRes = await fetch(`${FB_GRAPH_URL}/${profile.facebook_page_id}?fields=name,fan_count,is_published&access_token=${token}`);
                    if (pageRes.ok) stats.success++; else stats.failed++;
                    stats.callsMade++;
                }

                // TASK B: Fetch Lead Forms List (1 Call)
                if (profile.facebook_page_id) {
                    const formsRes = await fetch(`${FB_GRAPH_URL}/${profile.facebook_page_id}/leadgen_forms?limit=10&access_token=${token}`);
                    if (formsRes.ok) stats.success++; else stats.failed++;
                    stats.callsMade++;
                }

                // TASK C: Fetch Active Campaigns (1 Call)
                if (profile.ad_account_id) {
                    const adAccount = profile.ad_account_id.startsWith('act_') ? profile.ad_account_id : `act_${profile.ad_account_id}`;
                    const campRes = await fetch(`${FB_GRAPH_URL}/${adAccount}/campaigns?fields=name,status,objective&limit=5&access_token=${token}`);
                    if (campRes.ok) stats.success++; else stats.failed++;
                    stats.callsMade++;
                }

            } catch (e) {
                stats.failed++;
                console.error(`Warmup failed for profile ${profile.id}:`, e);
            }
        }));

        return NextResponse.json({
            message: 'Meta Warmup Cycle Complete',
            stats
        });

    } catch (err: any) {
        return NextResponse.json({ error: 'Warmup Fatal Error', details: err.message }, { status: 500 });
    }
}
