import { createClient } from '@/utils/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const iconType = searchParams.get('type') || 'icon'; 
  const uid = searchParams.get('uid'); 

  const rawHost = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
  const host = rawHost.split(':')[0].toLowerCase(); 

  const ADROLLS_LOGO_URL = "https://i.ibb.co/jvxK1B96/logo.png";
  const FALLBACK_FAVICON = new URL('/favicon.ico', request.url).toString();

  const SYSTEM_HOSTS = [
    'adrolls.in', 'www.adrolls.in', 'app.adrolls.in',
    'localhost'
  ];

  try {
    const supabase = await createClient();
    let logoUrl = null;

    const isSystemHost = SYSTEM_HOSTS.includes(host);

    if (isSystemHost) {
        logoUrl = ADROLLS_LOGO_URL;
    } else {
        const { data: profile } = await supabase.from('profiles').select('logo_url').eq('custom_domain', host).single();
        logoUrl = profile?.logo_url || ADROLLS_LOGO_URL;
    }

    const imageResponse = await fetch(logoUrl);
    if (!imageResponse.ok) {
        return NextResponse.redirect(ADROLLS_LOGO_URL);
    }

    const inputBuffer = await imageResponse.arrayBuffer();
    const buffer = Buffer.from(inputBuffer);

    // Create a Rounded Mask (r=80 for a smooth premium look)
    const roundedCornersMask = Buffer.from(
        `<svg><rect x="0" y="0" width="512" height="512" rx="80" ry="80" /></svg>`
    );

    let pipeline = sharp(buffer);
    
    if (iconType === 'favicon') {
        pipeline = pipeline.resize(32, 32, { 
            fit: 'contain', 
            background: { r: 255, g: 255, b: 255, alpha: 0 } 
        });
    } 
    else if (iconType === 'splash') {
        // 1. First, resize the logo to 512x512 and apply rounded corners
        pipeline = pipeline
            .resize(512, 512, { 
                fit: 'contain', 
                background: { r: 255, g: 255, b: 255, alpha: 0 } 
            })
            .composite([{
                input: roundedCornersMask,
                blend: 'dest-in'
            }])
            // 2. Add white padding to center it and make it look "small"
            // Total height becomes 2532 (iOS standard), logo stays 512 in middle
            .extend({
                top: 1010,
                bottom: 1010,
                left: 329,
                right: 329,
                background: { r: 255, g: 255, b: 255, alpha: 1 } // FORCE WHITE BACKGROUND
            })
            // 3. Flatten ensures no transparency remains for the splash image
            .flatten({ background: { r: 255, g: 255, b: 255 } }); 
    }
    else {
        // Standard PWA Icon (Rounded)
        pipeline = pipeline
            .resize(512, 512, { 
                fit: 'contain', 
                background: { r: 255, g: 255, b: 255, alpha: 0 } 
            })
            .composite([{
                input: roundedCornersMask,
                blend: 'dest-in'
            }]);
    }

    const processedBuffer = await pipeline.png().toBuffer();

    return new NextResponse(new Uint8Array(processedBuffer), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });

  } catch (err) {
    console.error('[ORG ICON] Error:', err);
    return NextResponse.redirect(ADROLLS_LOGO_URL);
  }
}