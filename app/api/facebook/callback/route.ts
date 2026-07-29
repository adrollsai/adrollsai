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

    const sendResponse = (success: boolean, message: string, redirectUrl: string) => {
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

            return sendResponse(true, 'Facebook account connected successfully.', `${redirectBackBase}${impersonateId ? '&' : '?'}success=Facebook Connected`);
        }
        
        throw new Error(tokenData.error?.message || "Failed to get token from Facebook");
    } catch (err: any) {
        console.error("[FB CALLBACK] Error:", err.message);
        return sendResponse(false, err.message || 'Failed to connect Facebook account.', `${baseUrl}/dashboard/profile?error=${encodeURIComponent(err.message)}`);
    }
}
