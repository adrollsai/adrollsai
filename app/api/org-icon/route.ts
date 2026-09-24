import { createClient } from '@/utils/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// In-memory cache to serve repeated splash & icon requests with 0ms latency
const splashMemoryCache = new Map<string, Buffer>();

async function getFallbackLogoBuffer(requestUrl: string): Promise<Buffer> {
  // 1. Try local filesystem
  try {
    const filePath = path.join(process.cwd(), 'public', 'logo.png');
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath);
    }
  } catch (fsErr) {
    console.warn('[ORG ICON] Filesystem read error for logo.png:', fsErr);
  }

  // 2. Try HTTP fetch from origin
  try {
    const originUrl = new URL('/logo.png', requestUrl).toString();
    const res = await fetch(originUrl);
    if (res.ok) {
      const arrayBuffer = await res.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }
  } catch (netErr) {
    console.warn('[ORG ICON] Network fetch error for logo.png:', netErr);
  }

  // 3. Ultra-minimal fallback SVG if logo is unavailable
  return Buffer.from(
    `<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
      <rect width="512" height="512" rx="100" fill="#0F172A"/>
      <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" fill="#FFFFFF" font-family="sans-serif" font-weight="900" font-size="160">N</text>
    </svg>`
  );
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const iconType = searchParams.get('type') || 'icon'; 
  const uid = searchParams.get('uid'); 
  const v = searchParams.get('v') || 'v1';

  const rawHost = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
  const host = rawHost.split(':')[0].toLowerCase(); 
  const isLocal = host === 'localhost';

  const NOBOGENT_LOGO_URL = new URL('/logo.png', request.url).toString();
  const SYSTEM_HOSTS = ['nobogent.com', 'www.nobogent.com', 'app.nobogent.com', 'adrolls.in', 'www.adrolls.in', 'app.adrolls.in', 'localhost'];

  try {
    // Check in-memory splash cache first
    if (iconType === 'splash') {
      const targetW = Math.max(320, Math.min(3000, parseInt(searchParams.get('w') || '1170')));
      const targetH = Math.max(480, Math.min(3000, parseInt(searchParams.get('h') || '2532')));
      const cacheKey = `splash_${host}_${v}_${uid || 'anon'}_${targetW}x${targetH}`;

      if (splashMemoryCache.has(cacheKey)) {
        const cached = splashMemoryCache.get(cacheKey)!;
        return new NextResponse(new Uint8Array(cached), {
          headers: {
            'Content-Type': 'image/png',
            'Content-Length': String(cached.length),
            'Cache-Control': isLocal ? 'no-store' : 'public, max-age=31536000, immutable',
          },
        });
      }
    }

    const supabase = await createClient();
    let logoUrl: string | null = null;

    if (SYSTEM_HOSTS.includes(host)) {
        if (uid) {
          const { data: userProfile } = await supabase.from('profiles').select('business_name, logo_url, role, agency_id').eq('id', uid).maybeSingle();
          if (userProfile?.role === 'client' && userProfile.agency_id) {
            const { data: agencyProfile } = await supabase.from('profiles').select('logo_url').eq('id', userProfile.agency_id).maybeSingle();
            logoUrl = agencyProfile?.logo_url || userProfile?.logo_url || NOBOGENT_LOGO_URL;
          } else {
            logoUrl = userProfile?.logo_url || NOBOGENT_LOGO_URL;
          }
        } else {
          logoUrl = NOBOGENT_LOGO_URL;
        }
    } else {
        const cleanHost = host.replace(/^www\./, '');
        const { data: profile } = await supabase
          .from('profiles')
          .select('logo_url')
          .or(`custom_domain.eq.${host},whitelabel_domain.eq.${host},custom_domain.eq.${cleanHost},whitelabel_domain.eq.${cleanHost}`)
          .maybeSingle();
        logoUrl = profile?.logo_url || null;

        if (!logoUrl && uid) {
          const { data: userProfile } = await supabase.from('profiles').select('logo_url').eq('id', uid).maybeSingle();
          logoUrl = userProfile?.logo_url || null;
        }

        if (!logoUrl) {
          logoUrl = NOBOGENT_LOGO_URL;
        }
    }

    let buffer: Buffer;
    const isAdrollsLogo = !logoUrl || logoUrl === NOBOGENT_LOGO_URL || logoUrl.includes('/logo.png');

    if (isAdrollsLogo) {
      buffer = await getFallbackLogoBuffer(request.url);
    } else {
      const imageResponse = await fetch(logoUrl!, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      if (!imageResponse.ok) {
        buffer = await getFallbackLogoBuffer(request.url);
      } else {
        const inputBuffer = await imageResponse.arrayBuffer();
        buffer = Buffer.from(inputBuffer);
      }
    }

    let pipeline = sharp(buffer);
    const padding = 96;
    const size = 512 - (padding * 2);
    
    if (iconType === 'favicon') {
        pipeline = pipeline.resize(32, 32, { 
            fit: 'contain', 
            background: { r: 255, g: 255, b: 255, alpha: 0 } 
        });
    } 
    else if (iconType === 'splash') {
        const targetW = Math.max(320, Math.min(3000, parseInt(searchParams.get('w') || '1170')));
        const targetH = Math.max(480, Math.min(3000, parseInt(searchParams.get('h') || '2532')));
        const logoSize = Math.round(Math.min(targetW, targetH) * 0.28);

        const logoBuffer = await pipeline
            .resize(logoSize, logoSize, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
            .png()
            .toBuffer();

        const splashBuffer = await sharp({
            create: {
                width: targetW,
                height: targetH,
                channels: 4,
                background: { r: 255, g: 255, b: 255, alpha: 1 }
            }
        })
        .composite([{ input: logoBuffer, gravity: 'center' }])
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .png()
        .toBuffer();

        const cacheKey = `splash_${host}_${v}_${uid || 'anon'}_${targetW}x${targetH}`;
        splashMemoryCache.set(cacheKey, splashBuffer);

        return new NextResponse(new Uint8Array(splashBuffer), {
            headers: {
                'Content-Type': 'image/png',
                'Content-Length': String(splashBuffer.length),
                'Cache-Control': isLocal ? 'no-store' : 'public, max-age=31536000, immutable',
            },
        });
    }
    else {
        pipeline = pipeline
            .resize(size, size, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
            .extend({ top: padding, bottom: padding, left: padding, right: padding, background: { r: 255, g: 255, b: 255, alpha: 0 } })
            .flatten({ background: { r: 255, g: 255, b: 255 } });
    }

    const processedBuffer = await pipeline.png().toBuffer();

    return new NextResponse(new Uint8Array(processedBuffer), {
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': String(processedBuffer.length),
        'Cache-Control': isLocal ? 'no-store' : 'public, max-age=31536000, immutable',
      },
    });

  } catch (err: any) {
    console.error('[ORG ICON] Main pipeline error, falling back:', err?.message);
    try {
      const fallbackBuffer = await getFallbackLogoBuffer(request.url);
      let pipeline = sharp(fallbackBuffer);
      
      const padding = 96;
      const size = 512 - (padding * 2);
      
      if (iconType === 'splash') {
          const targetW = Math.max(320, Math.min(3000, parseInt(searchParams.get('w') || '1170')));
          const targetH = Math.max(480, Math.min(3000, parseInt(searchParams.get('h') || '2532')));
          const logoSize = Math.round(Math.min(targetW, targetH) * 0.28);

          const logoBuffer = await pipeline
              .resize(logoSize, logoSize, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
              .png()
              .toBuffer();

          const splashBuffer = await sharp({
              create: {
                  width: targetW,
                  height: targetH,
                  channels: 4,
                  background: { r: 255, g: 255, b: 255, alpha: 1 }
              }
          })
          .composite([{ input: logoBuffer, gravity: 'center' }])
          .flatten({ background: { r: 255, g: 255, b: 255 } })
          .png()
          .toBuffer();

          return new NextResponse(new Uint8Array(splashBuffer), {
              headers: {
                  'Content-Type': 'image/png',
                  'Content-Length': String(splashBuffer.length),
                  'Cache-Control': isLocal ? 'no-store' : 'public, max-age=31536000, immutable',
              },
          });
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
          'Content-Length': String(processedBuffer.length),
          'Cache-Control': isLocal ? 'no-store' : 'public, max-age=31536000, immutable',
        },
      });
    } catch (fsErr: any) {
      console.error('[ORG ICON] Ultimate fallback failed:', fsErr?.message);
      return new NextResponse('Error generating icon', { status: 500 });
    }
  }
}