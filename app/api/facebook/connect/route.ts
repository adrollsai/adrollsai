import { NextResponse } from 'next/server';
import fs from 'fs';

function logDebug(msg: string, data?: any) {
    try {
        const line = `[${new Date().toISOString()}] [CONNECT] ${msg} ${data ? JSON.stringify(data) : ''}\n`;
        fs.appendFileSync('C:\\Users\\Nobogent\\.gemini\\antigravity-ide\\brain\\1776ab0d-51d0-41f4-b722-78013401d2cd\\scratch\\fb_flow_debug.log', line);
    } catch(e) {}
}

export async function GET(req: Request) {
    const appId = process.env.NEXT_PUBLIC_FACEBOOK_APP_ID;
    
    // Resolve dynamic baseUrl from host headers prioritizing public domain over internal proxies
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

    const redirectUri = `${baseUrl}/api/facebook/callback`;
    logDebug('GET connect route executed', { hostHeader, forwardedHost, baseUrl, redirectUri, reqUrl: req.url });
    const scopes = [
        'public_profile',
        'pages_show_list',
        'pages_manage_posts',
        'pages_read_engagement',
        'instagram_basic',
        'instagram_content_publish',
        'business_management',
        'ads_management',
        'pages_manage_ads',
        'pages_read_user_content',
        'leads_retrieval',
        'pages_manage_metadata'
    ].join(',');

    const { searchParams } = new URL(req.url);
    const impersonateId = searchParams.get('impersonate');
    
    // Pass impersonateId AND exact redirectUri in state so callback knows which profile to update and has identical redirect_uri
    const stateObj = { impersonateId: impersonateId || null, redirectUri };
    const state = encodeURIComponent(JSON.stringify(stateObj));

    const userAgent = req.headers.get('user-agent') || '';
    const isMobile = /Mobile|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);

    // On mobile browsers and PWAs, use m.facebook.com with display=touch and omit 'reauthenticate'
    // 'reauthenticate' on mobile causes Meta to send Android Native Credentials Intents, which launches the installed Facebook native app instead of showing the in-browser OAuth prompt.
    const domain = isMobile ? 'https://m.facebook.com' : 'https://www.facebook.com';
    const displayMode = isMobile ? 'touch' : 'popup';
    const authType = isMobile ? 'rerequest' : 'reauthenticate,rerequest';

    const fbUrl = `${domain}/v19.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}&response_type=code&auth_type=${authType}&display=${displayMode}${state ? `&state=${state}` : ''}#weblink`;

    // CRITICAL FIX FOR MOBILE & PWAs:
    // Returning an HTTP 302 Found response causes Android OS to intercept the Location header and open the installed Facebook native app (which stalls on web redirect URIs).
    // Serving an HTTP 200 OK HTML page with client-side JavaScript location replacement ensures Chrome/PWA handles the OAuth navigation directly inside the browser tab, NEVER opening the native app.
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Connecting Facebook...</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      background: #0f172a;
      color: white;
      text-align: center;
      padding: 20px;
    }
    .spinner {
      width: 44px;
      height: 44px;
      border: 4px solid rgba(255, 255, 255, 0.1);
      border-left-color: #1877f2;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-bottom: 20px;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    h2 { font-size: 18px; margin: 0 0 6px; font-weight: 700; }
    p { font-size: 13px; color: #94a3b8; margin: 0 0 20px; max-width: 280px; line-height: 1.4; }
    .btn {
      background: #1877f2;
      color: white;
      text-decoration: none;
      padding: 10px 20px;
      border-radius: 10px;
      font-weight: 600;
      font-size: 14px;
      display: inline-block;
    }
  </style>
</head>
<body>
  <div class="spinner"></div>
  <h2>Connecting Facebook...</h2>
  <p>Opening secure Meta authorization prompt...</p>
  <a id="manualBtn" class="btn" href="${fbUrl}">Click here if not redirected</a>

  <script>
    window.location.replace("${fbUrl}");
  </script>
</body>
</html>`;

    return new NextResponse(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
    });
}
