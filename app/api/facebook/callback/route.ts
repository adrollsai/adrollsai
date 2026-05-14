import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

export async function GET(req: Request) {
    const { searchParams, origin } = new URL(req.url);
    const code = searchParams.get('code');
    const supabase = await createClient();

    // Support for ngrok/forwarded hosts
    const forwardedHost = req.headers.get('x-forwarded-host');
    const forwardedProto = req.headers.get('x-forwarded-proto') || 'https';
    const baseUrl = forwardedHost ? `${forwardedProto}://${forwardedHost}` : origin;

    if (!code) return NextResponse.redirect(`${baseUrl}/dashboard/profile?error=No code received`);

    try {
        // 1. Exchange code for Token
        const tokenRes = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?client_id=${process.env.NEXT_PUBLIC_FACEBOOK_APP_ID}&client_secret=${process.env.FACEBOOK_CLIENT_SECRET}&redirect_uri=${encodeURIComponent(`${baseUrl}/api/facebook/callback`)}&code=${code}`);
        const tokenData = await tokenRes.json();

        if (tokenData.access_token) {
            // 2. Get Current User
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error("Not authenticated");

            // 3. Save Token to Profile (Bypassing Auth Link)
            const { error: updateError } = await supabase.from('profiles').update({
                facebook_token: tokenData.access_token
            }).eq('id', user.id);

            if (updateError) throw updateError;

            return NextResponse.redirect(`${baseUrl}/dashboard/profile?success=Facebook Connected`);
        }
        
        throw new Error(tokenData.error?.message || "Failed to get token from Facebook");
    } catch (err: any) {
        console.error("[FB CALLBACK] Error:", err.message);
        return NextResponse.redirect(`${baseUrl}/dashboard/profile?error=${encodeURIComponent(err.message)}`);
    }
}
