import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import fs from 'fs';

function logDebug(msg: string, data?: any) {
    try {
        const line = `[${new Date().toISOString()}] [CALLBACK] ${msg} ${data ? JSON.stringify(data) : ''}\n`;
        fs.appendFileSync('C:\\Users\\Nobogent\\.gemini\\antigravity-ide\\brain\\1776ab0d-51d0-41f4-b722-78013401d2cd\\scratch\\fb_flow_debug.log', line);
    } catch(e) {}
}

export async function GET(req: Request) {
    const { searchParams, origin } = new URL(req.url);
    const code = searchParams.get('code');
    const stateParam = searchParams.get('state');
    
    let impersonateId = null;
    let exactRedirectUri: string | null = null;
    if (stateParam) {
        try {
            const decoded = JSON.parse(decodeURIComponent(stateParam));
            impersonateId = decoded.impersonateId || null;
            exactRedirectUri = decoded.redirectUri || null;
        } catch(e) {}
    }

    logDebug('GET callback request received', { code: code ? `${code.substring(0, 10)}...` : null, stateParam, exactRedirectUri, reqUrl: req.url });

    const supabase = await createClient();

    // Standardized dynamic baseUrl resolution matching connect route
    const hostHeader = req.headers.get('host') || '';
    const forwardedHost = req.headers.get('x-forwarded-host') || '';
    const host = (hostHeader && !hostHeader.includes('localhost') && !hostHeader.includes('127.0.0.1'))
        ? hostHeader
        : ((forwardedHost && !forwardedHost.includes('localhost') && !forwardedHost.includes('127.0.0.1')) ? forwardedHost : (hostHeader || forwardedHost || 'app.nobogent.com'));

    const rawProto = req.headers.get('x-forwarded-proto') || 'https';
    const protocol = rawProto.split(',')[0].trim();
    const isLocalhostHttp = host.includes('localhost') && !protocol.startsWith('https');
    const finalProto = isLocalhostHttp ? 'http' : 'https';
    const currentOrigin = `${finalProto}://${host}`;
    
    const baseUrl = (host.includes('nobogent.com') || host.includes('adrolls.in') || host.includes('localhost') || host.includes('vercel.app'))
        ? currentOrigin
        : (process.env.NEXT_PUBLIC_APP_URL || currentOrigin);

    const redirectBackBase = `${baseUrl}/dashboard/profile${impersonateId ? `?impersonate=${impersonateId}` : ''}`;

    const sendResponse = (success: boolean, message: string, redirectUrl: string) => {
        logDebug('GET sendResponse', { success, message, redirectUrl });
        const html = `<!DOCTYPE html>
<html>
<head>
  <title>${success ? 'Facebook Connected' : 'Connection Failed'}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f8fafc; color: #0f172a; }
    .card { background: white; padding: 2.5rem 2rem; border-radius: 20px; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.08); text-align: center; max-width: 340px; width: 90%; }
    .icon { width: 56px; height: 56px; background: ${success ? '#dcfce7' : '#fee2e2'}; color: ${success ? '#16a34a' : '#dc2626'}; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 28px; font-weight: bold; margin: 0 auto 16px; }
    h2 { margin: 0 0 8px; font-size: 20px; font-weight: 700; }
    p { margin: 0; color: #64748b; font-size: 14px; line-height: 1.5; word-break: break-word; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${success ? '✓' : '✕'}</div>
    <h2>${success ? 'Facebook Connected!' : 'Connection Failed'}</h2>
    <p>${message}</p>
  </div>
  <script>
    if (window.opener) {
      try {
        window.opener.postMessage({ type: 'FACEBOOK_CONNECTED', success: ${success}, message: ${JSON.stringify(message)} }, '*');
      } catch (e) {}
      setTimeout(function() {
        window.close();
      }, ${success ? 600 : 2000});
    } else {
      window.location.href = "${redirectUrl}";
    }
  </script>
</body>
</html>`;
        return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    };

    if (!code) {
        return sendResponse(false, 'No code received from Facebook.', `${redirectBackBase}${impersonateId ? '&' : '?'}error=No code received`);
    }

    try {
        // Exchange single-use OAuth code using the exact redirectUri preserved in state
        const targetRedirectUri = exactRedirectUri || `${baseUrl}/api/facebook/callback`;
        logDebug('Exchanging GET code for token', { targetRedirectUri, code: `${code.substring(0, 10)}...` });

        const tokenUrl = `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${process.env.NEXT_PUBLIC_FACEBOOK_APP_ID}&client_secret=${process.env.FACEBOOK_CLIENT_SECRET}&redirect_uri=${encodeURIComponent(targetRedirectUri)}&code=${code}`;
        const tokenRes = await fetch(tokenUrl);
        const tokenData = await tokenRes.json();

        logDebug('GET Meta Graph API token exchange result', { status: tokenRes.status, tokenData });

        if (tokenData && tokenData.access_token) {
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

            return sendResponse(true, 'Facebook account connected successfully.', `${redirectBackBase}${impersonateId ? '&' : '?'}success=Facebook Connected`);
        }
        
        throw new Error(tokenData?.error?.message || "Failed to get token from Facebook");
    } catch (err: any) {
        console.error("[FB CALLBACK] Error:", err.message);
        return sendResponse(false, err.message || 'Failed to connect Facebook account.', `${baseUrl}/dashboard/profile?error=${encodeURIComponent(err.message)}`);
    }
}

export async function POST(req: Request) {
    try {
        const { code, accessToken: rawAccessToken, impersonateId, redirectUri } = await req.json();
        if (!code && !rawAccessToken) {
            return NextResponse.json({ error: 'Missing authorization code or access token' }, { status: 400 });
        }

        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        const appId = process.env.NEXT_PUBLIC_FACEBOOK_APP_ID;
        const clientSecret = process.env.FACEBOOK_CLIENT_SECRET;
        let accessToken: string | null = null;
        let lastError: string | null = null;

        // If rawAccessToken is provided from JS SDK (FB.login), exchange short-lived token for long-lived token (NO REDIRECT_URI REQUIRED!)
        if (rawAccessToken) {
            logDebug('POST received rawAccessToken from JS SDK', { rawAccessToken: `${rawAccessToken.substring(0, 15)}...` });
            try {
                const exchangeUrl = `https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${clientSecret}&fb_exchange_token=${rawAccessToken}`;
                const res = await fetch(exchangeUrl);
                const data = await res.json();
                logDebug('POST fb_exchange_token response', { status: res.status, data });
                if (data.access_token) {
                    accessToken = data.access_token;
                } else {
                    accessToken = rawAccessToken;
                }
            } catch(e: any) {
                accessToken = rawAccessToken;
            }
        }

        // If code is provided, exchange code using candidate URIs
        if (!accessToken && code) {
            const hostHeader = req.headers.get('host') || '';
            const forwardedHost = req.headers.get('x-forwarded-host') || '';
            const host = (hostHeader && !hostHeader.includes('localhost') && !hostHeader.includes('127.0.0.1'))
                ? hostHeader
                : ((forwardedHost && !forwardedHost.includes('localhost') && !forwardedHost.includes('127.0.0.1')) ? forwardedHost : (hostHeader || forwardedHost || 'app.nobogent.com'));

            const rawProto = req.headers.get('x-forwarded-proto') || 'https';
            const protocol = rawProto.split(',')[0].trim();
            const isLocalhostHttp = host.includes('localhost') && !protocol.startsWith('https');
            const finalProto = isLocalhostHttp ? 'http' : 'https';
            const currentOrigin = `${finalProto}://${host}`;
            
            const baseUrl = (host.includes('nobogent.com') || host.includes('adrolls.in') || host.includes('localhost') || host.includes('vercel.app'))
                ? currentOrigin
                : (process.env.NEXT_PUBLIC_APP_URL || currentOrigin);

            // Standard JS SDK redirect URIs for Meta JS SDK code exchange
            const candidates = [
                'https://app.nobogent.com/api/facebook/callback',
                'https://app.nobogent.com/',
                'https://connect.facebook.net/en_US/sdk.js',
                'https://staticxx.facebook.com/platform/page_proxy/v19.0/client_relay.php',
                'https://www.facebook.com/connect/login_success.html',
                redirectUri,
                currentOrigin,
                `${baseUrl}/api/facebook/callback`,
                `${currentOrigin}/`,
                ''
            ].filter((val): val is string => typeof val === 'string' && val !== 'undefined' && val !== 'null');

            const possibleRedirectUris = Array.from(new Set(candidates));
            logDebug('POST callback request received', { code: `${code.substring(0, 10)}...`, host, candidates: possibleRedirectUris });

            for (const uri of possibleRedirectUris) {
                try {
                    const tokenUrl = `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${appId}&client_secret=${clientSecret}&redirect_uri=${encodeURIComponent(uri)}&code=${code}`;
                    const tokenRes = await fetch(tokenUrl);
                    const tokenData = await tokenRes.json();
                    logDebug('POST tried URI candidate', { uri, status: tokenRes.status, tokenData });
                    if (tokenData.access_token) {
                        accessToken = tokenData.access_token;
                        logDebug('POST token exchange SUCCESS', { uri });
                        break;
                    } else if (tokenData.error) {
                        lastError = tokenData.error.message;
                    }
                } catch (err: any) {
                    lastError = err.message;
                    logDebug('POST token exchange error', { uri, err: err.message });
                }
            }
        }

        if (!accessToken) {
            return NextResponse.json({ error: lastError || 'Failed to exchange authorization code with Meta Graph API' }, { status: 400 });
        }

        // Resolve Target (Impersonation check)
        let targetUserId = user.id;
        if (impersonateId) {
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

        // Using service role client to bypass RLS for token save
        const { createClient: createAdminClient } = await import('@supabase/supabase-js');
        const supabaseAdmin = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

        const { error: updateError } = await supabaseAdmin.from('profiles').update({
            facebook_token: accessToken
        }).eq('id', targetUserId);

        if (updateError) throw updateError;

        return NextResponse.json({ success: true, message: 'Facebook account connected successfully!' });
    } catch (err: any) {
        return NextResponse.json({ error: err.message || 'Server error' }, { status: 500 });
    }
}
