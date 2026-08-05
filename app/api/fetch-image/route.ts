// app/api/fetch-image/route.ts
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const imageUrl = searchParams.get('url');
  const triggerDownload = searchParams.get('download') === 'true';
  const customName = searchParams.get('name') || 'asset';

  if (!imageUrl) {
    return new NextResponse('Missing URL', { status: 400 });
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

    const headers: Record<string, string> = {
      'Content-Type': mimeType,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Accept-Ranges': response.headers.get('Accept-Ranges') || 'bytes',
      'Cache-Control': 'public, max-age=31536000, immutable'
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