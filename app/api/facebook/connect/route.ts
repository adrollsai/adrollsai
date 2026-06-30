import { NextResponse } from 'next/server';

export async function GET(req: Request) {
    const appId = process.env.NEXT_PUBLIC_FACEBOOK_APP_ID;
    
    // Resolve dynamic baseUrl from host headers to avoid misconfigured NEXT_PUBLIC_APP_URL (e.g. ngrok override in production)
    const host = req.headers.get('host') || 'app.nobogent.com';
    const protocol = req.headers.get('x-forwarded-proto') || 'https';
    const currentOrigin = `${protocol}://${host}`;
    
    const baseUrl = (host.includes('nobogent.com') || host.includes('adrolls.in') || host.includes('localhost') || host.includes('vercel.app'))
        ? currentOrigin
        : (process.env.NEXT_PUBLIC_APP_URL || currentOrigin);

    const redirectUri = `${baseUrl}/api/facebook/callback`;
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
    
    // Pass impersonateId in state so callback knows which profile to update
    const state = impersonateId ? encodeURIComponent(JSON.stringify({ impersonateId })) : '';

    const fbUrl = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}&response_type=code&auth_type=reauthenticate,rerequest${state ? `&state=${state}` : ''}`;

    return NextResponse.redirect(fbUrl);
}
