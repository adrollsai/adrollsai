import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

const FB_GRAPH_URL = "https://graph.facebook.com/v19.0";

export async function POST(request: Request) {
    try {
        const { pageId } = await request.json();
        
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        // 1. Get the User's Token first
        const { data: profile } = await supabase
            .from('profiles')
            .select('facebook_token')
            .eq('id', user.id)
            .single();

        if (!profile?.facebook_token) {
            return NextResponse.json({ error: 'No Facebook Token found' }, { status: 400 });
        }

        // 2. FETCH THE PAGE ACCESS TOKEN (Critical Fix)
        // We cannot use the user's token to subscribe. We need the Page's token.
        const pageTokenRes = await fetch(`${FB_GRAPH_URL}/${pageId}?fields=access_token&access_token=${profile.facebook_token}`);
        const pageData = await pageTokenRes.json();

        if (pageData.error) {
             console.error("Page Token Error:", pageData.error);
             return NextResponse.json({ error: "Could not fetch Page Token: " + pageData.error.message }, { status: 400 });
        }

        const pageAccessToken = pageData.access_token;

        // 3. Subscribe the App using the PAGE TOKEN
        const subscribeUrl = `${FB_GRAPH_URL}/${pageId}/subscribed_apps?subscribed_fields=leadgen&access_token=${pageAccessToken}`;
        
        const res = await fetch(subscribeUrl, { method: 'POST' });
        const data = await res.json();

        if (data.error) {
            console.error("FB Subscription Error:", data.error);
            return NextResponse.json({ error: data.error.message }, { status: 400 });
        }

        return NextResponse.json({ success: true, message: "App subscribed to Page successfully!" });

    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}