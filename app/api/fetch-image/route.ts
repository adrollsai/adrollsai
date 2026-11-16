// app/api/fetch-image/route.ts
import { NextResponse } from 'next/server';

/**
 * Image/video proxy for `<img src>` and download links.
 *
 * It has to stay callable without a session (public shared pages render through
 * it), so it must not be a general-purpose URL fetcher. It previously fetched
 * *any* URL a caller supplied — an open read-SSRF proxy that could be pointed at
 * internal hosts or cloud metadata and unmetered bandwidth.
 *
 * Only hosts this product actually stores or serves media from are allowed.
 */
const ALLOWED_HOST_SUFFIXES = [
  '.r2.dev',
  '.supabase.co',
  '.adrolls.in',
  'adrolls.in',
  '.nobogent.com',
  'nobogent.com',
  '.googleusercontent.com',
  '.fbcdn.net',
  '.licdn.com',
]

function isAllowedMediaUrl(raw: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false

  const host = parsed.hostname.toLowerCase()
  // Never allow loopback / link-local / private-range targets.
  if (
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host.endsWith('.local') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    return false
  }

  return ALLOWED_HOST_SUFFIXES.some(suffix =>
    suffix.startsWith('.') ? host.endsWith(suffix) : host === suffix
  )
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const imageUrl = searchParams.get('url');
  const triggerDownload = searchParams.get('download') === 'true';
  const customName = searchParams.get('name') || 'asset';

  if (!imageUrl) {
    return new NextResponse('Missing URL', { status: 400 });
  }

  if (!isAllowedMediaUrl(imageUrl)) {
    return new NextResponse('URL host is not allowed', { status: 400 });
  }

  try {
    // Generate both URL forms (with adrolls-storage and without adrolls-storage)
    let urlWithAdrolls = imageUrl;
    let urlWithoutAdrolls = imageUrl;

    if (imageUrl.includes('.r2.dev/')) {
      if (imageUrl.includes('/adrolls-storage/')) {
        urlWithoutAdrolls = imageUrl.replace('/adrolls-storage/', '/');
      } else {
        urlWithAdrolls = imageUrl.replace('.r2.dev/', '.r2.dev/adrolls-storage/');
      }
    }

    // Direct redirect for R2 video streams to Cloudflare edge CDN (prevents Vercel serverless buffering bottlenecks)
    if (imageUrl.includes('.r2.dev/') && imageUrl.match(/\.(mp4|webm)(\?|$)/i) && !triggerDownload) {
      const redirectRes = NextResponse.redirect(urlWithoutAdrolls, 307);
      redirectRes.headers.set('Access-Control-Allow-Origin', '*');
      redirectRes.headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
      redirectRes.headers.set('Access-Control-Allow-Headers', '*');
      redirectRes.headers.set('Access-Control-Expose-Headers', '*');
      return redirectRes;
    }

    const candidateUrls = Array.from(new Set([imageUrl, urlWithoutAdrolls, urlWithAdrolls]));

    const range = request.headers.get('range');
    const fetchHeaders: Record<string, string> = {};
    if (range) {
      fetchHeaders['range'] = range;
    }

    let response: Response | null = null;

    for (const urlCandidate of candidateUrls) {
      try {
        const res = await fetch(urlCandidate, { headers: fetchHeaders });
        if (res.ok || res.status === 206) {
          response = res;
          break;
        }
      } catch (err) {}
    }

    if (!response || (!response.ok && response.status !== 206)) {
      console.error(`[fetch-image] All candidate URLs failed for: ${imageUrl}`);
      return new NextResponse('Error fetching media', { status: 404 });
    }

    let mimeType = response.headers.get('Content-Type');
    const lowerUrl = imageUrl.toLowerCase();
    
    if (!mimeType || mimeType === 'application/octet-stream' || mimeType === 'binary/octet-stream' || mimeType === 'text/plain') {
      if (lowerUrl.match(/\.mp4(\?|$)/i)) {
        mimeType = 'video/mp4';
      } else if (lowerUrl.match(/\.webm(\?|$)/i)) {
        mimeType = 'video/webm';
      } else if (lowerUrl.match(/\.png(\?|$)/i)) {
        mimeType = 'image/png';
      } else if (lowerUrl.match(/\.(jpg|jpeg)(\?|$)/i)) {
        mimeType = 'image/jpeg';
      } else if (lowerUrl.match(/\.webp(\?|$)/i)) {
        mimeType = 'image/webp';
      } else {
        mimeType = 'video/mp4';
      }
    }

    const isVideo = mimeType ? mimeType.startsWith('video/') : false;
    const headers: Record<string, string> = {
      'Content-Type': mimeType || 'video/mp4',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Accept-Ranges': response.headers.get('Accept-Ranges') || 'bytes',
      'Cache-Control': isVideo ? 'no-cache, no-store, must-revalidate' : 'public, max-age=31536000, immutable'
    };

    if (response.headers.get('Content-Length')) {
      headers['Content-Length'] = response.headers.get('Content-Length')!;
    }

    if (response.headers.get('Content-Range')) {
      headers['Content-Range'] = response.headers.get('Content-Range')!;
    }

    if (triggerDownload) {
      headers['Content-Disposition'] = `attachment; filename="${customName}"`;
    }

    return new NextResponse(response.body, {
      status: response.status,
      headers,
    });
  } catch (error) {
    console.error('Image proxy error:', error);
    return new NextResponse('Error fetching image', { status: 500 });
  }
}