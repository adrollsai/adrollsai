import { createClient } from '@/utils/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const iconType = searchParams.get('type') || 'icon'; 
  const uid = searchParams.get('uid'); // Grabs the user ID from layout.tsx

  const rawHost = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
  const host = rawHost.split(':')[0]; 

  const FALLBACK_ICON = new URL('/icon-512x512.png', request.url).toString();
  const FALLBACK_FAVICON = new URL('/favicon.ico', request.url).toString();

  const SYSTEM_HOSTS = [
    'adrolls.in', 'www.adrolls.in', 'app.adrolls.in',
    process.env.NEXT_PUBLIC_DEFAULT_HOST || 'localhost'
  ];

  try {
    const supabase = await createClient();
    let logoUrl = null;

    // 1. Determine which logo to fetch
    if (!SYSTEM_HOSTS.includes(host)) {
        const { data: profile } = await supabase.from('profiles').select('logo_url').eq('custom_domain', host).single();
        logoUrl = profile?.logo_url;
    } else if (uid) {
        // THE FIX: If on AdRolls domain but logged in, get the user's logo!
        const { data: profile } = await supabase.from('profiles').select('logo_url').eq('id', uid).single();
        logoUrl = profile?.logo_url;
    }

    // 2. Fetch the image
    let imageResponse;
    if (logoUrl) {
        imageResponse = await fetch(logoUrl);
    }

    // 3. Fallback Splash Screen processing
    if (!imageResponse || !imageResponse.ok) {
        if (iconType === 'splash') {
            // Fetch the default icon to process it into a perfect splash screen
            imageResponse = await fetch(FALLBACK_ICON);
        } else {
            return NextResponse.redirect(iconType === 'favicon' ? FALLBACK_FAVICON : FALLBACK_ICON);
        }
    }

    if (!imageResponse || !imageResponse.ok) {
        return NextResponse.redirect(iconType === 'favicon' ? FALLBACK_FAVICON : FALLBACK_ICON);
    }

    const inputBuffer = await imageResponse.arrayBuffer();

    // 4. Image Processing with Sharp
    let pipeline = sharp(Buffer.from(inputBuffer));
    
    if (iconType === 'favicon') {
        pipeline = pipeline.resize(32, 32, { 
            fit: 'contain', 
            background: { r: 255, g: 255, b: 255, alpha: 0 } 
        });
    } 
    else if (iconType === 'splash') {
        pipeline = pipeline
            .resize(1170, 2532, { 
                fit: 'contain', 
                background: { r: 255, g: 255, b: 255, alpha: 1 } 
            })
            .flatten({ background: { r: 255, g: 255, b: 255 } }); 
    }
    else {
        pipeline = pipeline
            .resize(512, 512, { 
                fit: 'contain', 
                background: { r: 255, g: 255, b: 255, alpha: 1 } 
            })
            .flatten({ background: { r: 255, g: 255, b: 255 } });
    }

    const processedBuffer = await pipeline.png().toBuffer();

    return new NextResponse(processedBuffer as any, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store, must-revalidate',
      },
    });

  } catch (err) {
    console.error('[ORG ICON] Error:', err);
    return NextResponse.redirect(iconType === 'favicon' ? FALLBACK_FAVICON : FALLBACK_ICON);
  }
}