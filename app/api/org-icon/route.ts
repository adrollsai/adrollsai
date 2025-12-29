import { createClient } from '@/utils/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const iconType = searchParams.get('type') || 'icon'; // 'icon' or 'favicon'

  const host = request.headers.get('host') || '';
  
  // Fallbacks
  const FALLBACK_ICON = new URL('/icon-512x512.png', request.url).toString();
  const FALLBACK_FAVICON = new URL('/favicon.ico', request.url).toString();

  const DEFAULT_HOSTS = [
    'adrolls.in',
    'www.adrolls.in',
    'app.adrolls.in',
    process.env.NEXT_PUBLIC_DEFAULT_HOST || 'adrollsai-builder-app.vercel.app'
  ];

  if (host.includes('localhost') || host.includes('127.0.0.1') || DEFAULT_HOSTS.includes(host)) {
    return NextResponse.redirect(iconType === 'favicon' ? FALLBACK_FAVICON : FALLBACK_ICON);
  }

  try {
    const supabase = await createClient();

    const { data: org, error } = await supabase
      .from('organizations')
      .select('master_logo_url')
      .eq('custom_domain', host)
      .single();

    if (error || !org || !org.master_logo_url) {
      return NextResponse.redirect(iconType === 'favicon' ? FALLBACK_FAVICON : FALLBACK_ICON);
    }

    // Fetch the image from Supabase Storage
    const imageResponse = await fetch(org.master_logo_url);

    if (!imageResponse.ok) {
      return NextResponse.redirect(iconType === 'favicon' ? FALLBACK_FAVICON : FALLBACK_ICON);
    }

    const imageBuffer = await imageResponse.arrayBuffer();
    const contentType = imageResponse.headers.get('content-type') || 'image/png';

    return new NextResponse(imageBuffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600, s-maxage=3600', 
      },
    });

  } catch (err) {
    console.error('[ORG ICON] Error:', err);
    return NextResponse.redirect(iconType === 'favicon' ? FALLBACK_FAVICON : FALLBACK_ICON);
  }
}