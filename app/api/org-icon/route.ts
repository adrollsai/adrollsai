import { createClient } from '@/utils/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const iconType = searchParams.get('type') || 'icon'; 
  const uid = searchParams.get('uid'); 

  const rawHost = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
  const host = rawHost.split(':')[0].toLowerCase(); 
  const isLocal = host === 'localhost';

  const NOBOGENT_LOGO_URL = new URL('/logo.png', request.url).toString();
  const FALLBACK_FAVICON = new URL('/favicon.ico', request.url).toString();

  const SYSTEM_HOSTS = ['nobogent.com', 'www.nobogent.com', 'app.nobogent.com', 'adrolls.in', 'www.adrolls.in', 'app.adrolls.in', 'localhost'];

  try {
    const supabase = await createClient();
    let logoUrl = null;

    if (SYSTEM_HOSTS.includes(host)) {
        logoUrl = NOBOGENT_LOGO_URL;
    } else {
        const { data: profile } = await supabase.from('profiles').select('logo_url').eq('custom_domain', host).single();
        logoUrl = profile?.logo_url || NOBOGENT_LOGO_URL;
    }

    let buffer: Buffer;
    const isAdrollsLogo = logoUrl === NOBOGENT_LOGO_URL || logoUrl.includes('/logo.png');

    if (isAdrollsLogo) {
      const filePath = path.join(process.cwd(), 'public', 'logo.png');
      buffer = fs.readFileSync(filePath);
    } else {
      // Added a User-Agent header so external image hosts don't block the request
      const imageResponse = await fetch(logoUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      if (!imageResponse.ok) {
        throw new Error('Failed to fetch external logo');
      }
      
      const inputBuffer = await imageResponse.arrayBuffer();
      buffer = Buffer.from(inputBuffer);
    }

    const roundedCornersMask = Buffer.from(
        `<svg><rect x="0" y="0" width="512" height="512" rx="80" ry="80" /></svg>`
    );

    let pipeline = sharp(buffer);
    
    // Enforce 96px padding to guarantee that both default and custom logos stay 
    // inside the 40% safe area required for Android maskable splash/launcher icons
    const padding = 96;
    const size = 512 - (padding * 2);
    
    if (iconType === 'favicon') {
        pipeline = pipeline.resize(32, 32, { 
            fit: 'contain', 
            background: { r: 255, g: 255, b: 255, alpha: 0 } 
        });
    } 
    else if (iconType === 'splash') {
        pipeline = pipeline
            .resize(size, size, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
            .extend({ top: padding, bottom: padding, left: padding, right: padding, background: { r: 255, g: 255, b: 255, alpha: 0 } })
            .extend({
                top: 1010, bottom: 1010, left: 329, right: 329,
                background: { r: 255, g: 255, b: 255, alpha: 1 } 
            })
            .flatten({ background: { r: 255, g: 255, b: 255 } }); 
    }
    else {
        pipeline = pipeline
            .resize(size, size, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
            .extend({ top: padding, bottom: padding, left: padding, right: padding, background: { r: 255, g: 255, b: 255, alpha: 0 } })
            // Flattening the standard PWA icon onto a white background is crucial. 
            // Transparent PNGs break Android's "maskable" splash screen requirements.
            .flatten({ background: { r: 255, g: 255, b: 255 } });
    }

    const processedBuffer = await pipeline.png().toBuffer();

    return new NextResponse(new Uint8Array(processedBuffer), {
      headers: {
        'Content-Type': 'image/png',
        // Never cache on localhost so you can see your live changes
        'Cache-Control': isLocal ? 'no-store' : 'public, max-age=31536000, immutable',
      },
    });

  } catch (err) {
    console.error('[ORG ICON] Error:', err);
    try {
      const filePath = path.join(process.cwd(), 'public', 'logo.png');
      const fallbackBuffer = fs.readFileSync(filePath);
      let pipeline = sharp(fallbackBuffer);
      
      const padding = 96;
      const size = 512 - (padding * 2);
      
      if (iconType === 'splash') {
          pipeline = pipeline
              .resize(size, size, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
              .extend({ top: padding, bottom: padding, left: padding, right: padding, background: { r: 255, g: 255, b: 255, alpha: 0 } })
              .extend({
                  top: 1010, bottom: 1010, left: 329, right: 329,
                  background: { r: 255, g: 255, b: 255, alpha: 1 } 
              })
              .flatten({ background: { r: 255, g: 255, b: 255 } });
      } else if (iconType === 'favicon') {
          pipeline = pipeline.resize(32, 32, { 
              fit: 'contain', 
              background: { r: 255, g: 255, b: 255, alpha: 0 } 
          });
      } else {
          pipeline = pipeline
              .resize(size, size, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
              .extend({ top: padding, bottom: padding, left: padding, right: padding, background: { r: 255, g: 255, b: 255, alpha: 0 } })
              .flatten({ background: { r: 255, g: 255, b: 255 } });
      }
      
      const processedBuffer = await pipeline.png().toBuffer();
      return new NextResponse(new Uint8Array(processedBuffer), {
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': isLocal ? 'no-store' : 'public, max-age=31536000, immutable',
        },
      });
    } catch (fsErr) {
      return NextResponse.json({ error: 'Failed to load default logo' }, { status: 500 });
    }
  }
}