import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

const FB_MARKETING_URL = "https://graph.facebook.com/v19.0";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const campaignId = searchParams.get('campaignId');

    if (!campaignId) {
      return NextResponse.json({ error: 'Campaign ID required' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Get Token
    const { data: profile } = await supabase
        .from('profiles')
        .select('facebook_token')
        .eq('id', user.id)
        .single();

    if (!profile?.facebook_token) return NextResponse.json({ error: 'No FB Token' }, { status: 400 });

    // Fetch Ad Sets for this Campaign from Facebook
    const fbRes = await fetch(
      `${FB_MARKETING_URL}/${campaignId}/adsets?fields=id,name,status,daily_budget,lifetime_budget,targeting&limit=50&access_token=${profile.facebook_token}`
    );
    const fbData = await fbRes.json();

    if (fbData.error) throw new Error(fbData.error.message);

    return NextResponse.json({ adsets: fbData.data || [] });

  } catch (error: any) {
    console.error("Fetch AdSets Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}