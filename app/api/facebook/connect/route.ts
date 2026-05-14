import { NextResponse } from 'next/server';

export async function GET(req: Request) {
    const appId = process.env.NEXT_PUBLIC_FACEBOOK_APP_ID;
    const redirectUri = `${new URL(req.url).origin}/api/facebook/callback`;
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
        'leads_retrieval'
    ].join(',');

    const fbUrl = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}&response_type=code`;

    return NextResponse.redirect(fbUrl);
}
