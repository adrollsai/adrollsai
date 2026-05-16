import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

export async function GET(req: Request) {
    const { searchParams, origin } = new URL(req.url);
    const code = searchParams.get('code');
    const stateParam = searchParams.get('state');
    
    let impersonateId = null;
    if (stateParam) {
        try {
            const decoded = JSON.parse(decodeURIComponent(stateParam));
            impersonateId = decoded.impersonateId;
        } catch(e) {}
    }

    const supabase = await createClient();

    // Support for ngrok/forwarded hosts
    const forwardedHost = req.headers.get('x-forwarded-host');
    const forwardedProto = req.headers.get('x-forwarded-proto') || 'https';
    const baseUrl = forwardedHost ? `${forwardedProto}://${forwardedHost}` : origin;

    const redirectBackBase = `${baseUrl}/dashboard/profile${impersonateId ? `?impersonate=${impersonateId}` : ''}`;

    if (!code) return NextResponse.redirect(`${redirectBackBase}${impersonateId ? '&' : '?'}error=No code received`);

    try {
        // 1. Exchange code for Token
        const tokenRes = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?client_id=${process.env.NEXT_PUBLIC_FACEBOOK_APP_ID}&client_secret=${process.env.FACEBOOK_CLIENT_SECRET}&redirect_uri=${encodeURIComponent(`${baseUrl}/api/facebook/callback`)}&code=${code}`);
        const tokenData = await tokenRes.json();

        if (tokenData.access_token) {
            // 2. Get Current User
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error("Not authenticated");

            // 3. Resolve Target (Impersonation check)
            let targetUserId = user.id;
            if (impersonateId) {
                // Verify Agency/Admin permission for this target
                const { data: ownProfile } = await supabase.from('profiles').select('role, agency_id').eq('id', user.id).single();
                if (['super_admin', 'agency', 'admin'].includes(ownProfile?.role || '')) {
                    if (ownProfile?.role !== 'super_admin') {
                        const { data: subAccount } = await supabase.from('profiles').select('id').eq('id', impersonateId).eq('agency_id', ownProfile?.agency_id || user.id).single();
                        if (subAccount) targetUserId = impersonateId;
                    } else {
                        targetUserId = impersonateId;
                    }
                }
            }

            // 4. Save Token to Profile
            const { error: updateError } = await supabase.from('profiles').update({
                facebook_token: tokenData.access_token
            }).eq('id', targetUserId);

            if (updateError) throw updateError;

            return NextResponse.redirect(`${redirectBackBase}${impersonateId ? '&' : '?'}success=Facebook Connected`);
        }
        
        throw new Error(tokenData.error?.message || "Failed to get token from Facebook");
    } catch (err: any) {
        console.error("[FB CALLBACK] Error:", err.message);
        return NextResponse.redirect(`${baseUrl}/dashboard/profile?error=${encodeURIComponent(err.message)}`);
    }
}
