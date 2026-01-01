import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

const FB_GRAPH_URL = "https://graph.facebook.com/v19.0";

export async function POST(request: Request) {
    try {
        const { pageId } = await request.json();
        
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        // 1. Get User Token
        const { data: profile } = await supabase.from('profiles').select('facebook_token').eq('id', user.id).single();
        if (!profile?.facebook_token) return NextResponse.json({ error: 'No Token' }, { status: 400 });

        // 2. Get Page Token
        const pageTokenRes = await fetch(`${FB_GRAPH_URL}/${pageId}?fields=access_token&access_token=${profile.facebook_token}`);
        const pageData = await pageTokenRes.json();
        if (pageData.error) return NextResponse.json({ error: pageData.error.message }, { status: 400 });

        const pageAccessToken = pageData.access_token;

        // 3. CHECK SUBSCRIBED APPS
        const checkUrl = `${FB_GRAPH_URL}/${pageId}/subscribed_apps?access_token=${pageAccessToken}`;
        const checkRes = await fetch(checkUrl);
        const checkData = await checkRes.json();

        return NextResponse.json({ 
            status: 'ok', 
            data: checkData.data // This array lists the active subscriptions
        });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}