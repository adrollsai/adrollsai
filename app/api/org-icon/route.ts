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

  // Fixed AdRolls Logo Link
  const ADROLLS_LOGO_URL = "https://i.ibb.co/jvxK1B96/logo.png";
  const FALLBACK_FAVICON = new URL('/favicon.ico', request.url).toString();

  const SYSTEM_HOSTS = [
    'adrolls.in', 'www.adrolls.in', 'app.adrolls.in',
    'localhost'
  ];

  try {
    const supabase = await createClient();
    let logoUrl = null;

    // 1. Determine source URL
    const isSystemHost = SYSTEM_HOSTS.includes(host);

    if (isSystemHost) {
        // Always use the primary logo for AdRolls domains
        logoUrl = ADROLLS_LOGO_URL;
    } else {
        // Fetch custom user logo for external domains
        const { data: profile } = await supabase.from('profiles').select('logo_url').eq('custom_domain', host).single();
        logoUrl = profile?.logo_url || ADROLLS_LOGO_URL;
    }

    // 2. Fetch the image
    const imageResponse = await fetch(logoUrl);
    if (!imageResponse.ok) {
        return NextResponse.redirect(iconType === 'favicon' ? FALLBACK_FAVICON : ADROLLS_LOGO_URL);
    }

    const inputBuffer = await imageResponse.arrayBuffer();
    const buffer = Buffer.from(inputBuffer);

    // 3. Define Shapes (Rounded Corners)
    // We create a mask to apply rounded corners to the square logo
    const roundedCornersMask = Buffer.from(
        `<svg><rect x="0" y="0" width="512" height="512" rx="100" ry="100" /></svg>`
    );

    // 4. Image Processing with Sharp
    let pipeline = sharp(buffer);
    
    if (iconType === 'favicon') {
        pipeline = pipeline.resize(32, 32, { 
            fit: 'contain', 
            background: { r: 255, g: 255, b: 255, alpha: 0 } 
        });
    } 
    else if (iconType === 'splash') {
        // TO FIX THE SPLASH SCREEN FILLING THE SPACE:
        // We resize the logo to be small (e.g., 400px) and then extend it 
        // with a massive transparent border to fill the mobile screen size.
        pipeline = pipeline
            .resize(400, 400, { 
                fit: 'contain', 
                background: { r: 255, g: 255, b: 255, alpha: 0 } 
            })
            .composite([{
                input: roundedCornersMask,
                blend: 'dest-in'
            }])
            // This adds padding to center the icon and prevent it from filling the screen
            .extend({
                top: 1066,
                bottom: 1066,
                left: 385,
                right: 385,
                background: { r: 255, g: 255, b: 255, alpha: 0 }
            });
    }
    else {
        // Standard PWA Icon (512x512)
        pipeline = pipeline
            .resize(512, 512, { 
                fit: 'contain', 
                background: { r: 255, g: 255, b: 255, alpha: 0 } 
            })
            // Apply Rounded Corners
            .composite([{
                input: roundedCornersMask,
                blend: 'dest-in'
            }]);
    }

    const processedBuffer = await pipeline.png().toBuffer();

    return new NextResponse(new Uint8Array(processedBuffer), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=31536000, immutable', // Cache for performance
      },
    });

  } catch (err) {
    console.error('[ORG ICON] Error:', err);
    return NextResponse.redirect(ADROLLS_LOGO_URL);
  }
}