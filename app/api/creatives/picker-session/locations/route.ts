import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { verifyCreativeSessionToken } from '@/utils/creative-token';

export const dynamic = 'force-dynamic';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token');
    const q = (searchParams.get('q') || '').trim();

    if (!token) {
      return NextResponse.json({ error: 'Session token is required.' }, { status: 400 });
    }

    if (!q || q.length < 2) {
      return NextResponse.json({ data: [] });
    }

    const payload = verifyCreativeSessionToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid or expired session token.' }, { status: 401 });
    }

    const { userId, campaignId } = payload;

    // Get user's facebook token from profile or campaign job
    let facebookToken: string | null = null;

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('facebook_token')
      .eq('id', userId)
      .single();

    if (profile?.facebook_token) {
      facebookToken = profile.facebook_token;
    }

    if (!facebookToken) {
      const { data: userProfile } = await supabaseAdmin
        .from('user_profiles')
        .select('facebook_token')
        .eq('id', userId)
        .single();
      if (userProfile?.facebook_token) {
        facebookToken = userProfile.facebook_token;
      }
    }

    if (!facebookToken && campaignId) {
      const { data: job } = await supabaseAdmin
        .from('campaign_jobs')
        .select('payload')
        .eq('id', campaignId)
        .single();
      if (job?.payload?.facebookToken) {
        facebookToken = job.payload.facebookToken;
      }
    }

    // Fallback: check latest job payload for this user
    if (!facebookToken) {
      const { data: latestJob } = await supabaseAdmin
        .from('campaign_jobs')
        .select('payload')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestJob?.payload?.facebookToken) {
        facebookToken = latestJob.payload.facebookToken;
      }
    }

    if (!facebookToken) {
      return NextResponse.json({ error: 'Meta connection not found for this account.' }, { status: 400 });
    }

    // Call Meta Marketing API for adgeolocation
    const metaRes = await fetch(
      `https://graph.facebook.com/v21.0/search?type=adgeolocation&q=${encodeURIComponent(q)}&location_types=["city","region","zip"]&access_token=${facebookToken}`
    );

    const metaData = await metaRes.json();

    if (!metaRes.ok || metaData.error) {
      console.error('[locations search error]', metaData.error);
      return NextResponse.json({ error: metaData.error?.message || 'Failed to search Meta locations' }, { status: 500 });
    }

    const rawList: any[] = metaData.data || [];

    // Prioritize India matches first, then sort by relevance
    const prioritized = rawList.sort((a, b) => {
      const aIn = a.country_code === 'IN' ? 0 : 1;
      const bIn = b.country_code === 'IN' ? 0 : 1;
      return aIn - bIn;
    });

    const formatted = prioritized.map((item) => ({
      key: item.key,
      name: item.name,
      type: item.type, // 'city', 'region', 'zip'
      region: item.region || '',
      region_id: item.region_id || null,
      country_code: item.country_code || '',
      country_name: item.country_name || item.country_code || '',
      default_radius: item.type === 'city' ? 25 : 0
    }));

    return NextResponse.json({ data: formatted });
  } catch (err: any) {
    console.error('Error in locations search:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
