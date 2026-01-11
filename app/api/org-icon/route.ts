import { createClient } from '@/utils/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';

// Change runtime to 'nodejs' to support 'sharp' image processing
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const iconType = searchParams.get('type') || 'icon'; // 'icon', 'favicon', or 'splash'

  // Reliable Host Detection
  const rawHost = request.headers.get('x-forwarded-host') || request.headers.get('host') || '';
  const host = rawHost.split(':')[0]; // Remove port if present

  // Fallback Assets
  const FALLBACK_ICON = new URL('/icon-512x512.png', request.url).toString();
  const FALLBACK_FAVICON = new URL('/favicon.ico', request.url).toString();

  // System Hosts (Skip DB lookup)
  const SYSTEM_HOSTS = [
    'adrolls.in', 'www.adrolls.in', 'app.adrolls.in',
    process.env.NEXT_PUBLIC_DEFAULT_HOST || 'adrollsai-builder-app.vercel.app',
    'localhost'
  ];

  // If system host, return redirect immediately
  if (SYSTEM_HOSTS.includes(host)) {
    return NextResponse.redirect(iconType === 'favicon' ? FALLBACK_FAVICON : FALLBACK_ICON);
  }

  try {
    const supabase = await createClient();

    // Fetch Organization Logo
    const { data: org } = await supabase
      .from('organizations')
      .select('master_logo_url')
      .eq('custom_domain', host)
      .single();

    if (!org || !org.master_logo_url) {
      return NextResponse.redirect(iconType === 'favicon' ? FALLBACK_FAVICON : FALLBACK_ICON);
    }

    // Fetch the image from the URL
    const imageResponse = await fetch(org.master_logo_url);
    if (!imageResponse.ok) {
      return NextResponse.redirect(iconType === 'favicon' ? FALLBACK_FAVICON : FALLBACK_ICON);
    }

    const inputBuffer = await imageResponse.arrayBuffer();

    // --- IMAGE PROCESSING WITH SHARP ---
    let pipeline = sharp(Buffer.from(inputBuffer));
    
    if (iconType === 'favicon') {
        // Favicon: 32x32
        pipeline = pipeline.resize(32, 32, { 
            fit: 'contain', 
            background: { r: 255, g: 255, b: 255, alpha: 0 } 
        });
    } 
    else if (iconType === 'splash') {
        // Splash Screen: High Res Portrait (1170x2532)
        pipeline = pipeline
            .resize(1170, 2532, { 
                fit: 'contain', 
                background: { r: 255, g: 255, b: 255, alpha: 1 } // White padding
            })
            .flatten({ background: { r: 255, g: 255, b: 255 } }); // Remove transparency
    }
    else {
        // Standard Icon (PWA): 512x512 Square
        // 1. Resize to fit within 512x512 (adding padding if non-square)
        // 2. Flatten: Replaces transparency with solid WHITE background
        pipeline = pipeline
            .resize(512, 512, { 
                fit: 'contain', 
                background: { r: 255, g: 255, b: 255, alpha: 1 } 
            })
            .flatten({ background: { r: 255, g: 255, b: 255 } });
    }

    const processedBuffer = await pipeline.png().toBuffer();

    // FIX: Cast to 'any' to satisfy TypeScript 'BodyInit' requirement
    return new NextResponse(processedBuffer as any, {
      headers: {
        'Content-Type': 'image/png',
        // CHANGED: Disable caching to ensure logo updates are reflected immediately during demos
        'Cache-Control': 'no-store, must-revalidate',
      },
    });

  } catch (err) {
    console.error('[ORG ICON] Error:', err);
    return NextResponse.redirect(iconType === 'favicon' ? FALLBACK_FAVICON : FALLBACK_ICON);
  }
}