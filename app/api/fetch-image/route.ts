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
    let targetUrl = imageUrl;
    if (targetUrl.includes('.r2.dev/') && !targetUrl.includes('/adrolls-storage/')) {
        targetUrl = targetUrl.replace('.r2.dev/', '.r2.dev/adrolls-storage/');
    }

    const range = request.headers.get('range');
    const fetchHeaders: Record<string, string> = {};
    if (range) {
      fetchHeaders['range'] = range;
    }

    // Fetch the image/video on the server side (bypasses browser CORS while preserving Range requests)
    let response = await fetch(targetUrl, { headers: fetchHeaders });

    // Fallback attempt if original URL failed
    if (!response.ok && targetUrl !== imageUrl) {
      response = await fetch(imageUrl, { headers: fetchHeaders });
    }
    
    if (!response.ok && response.status !== 206) {
      throw new Error(`Failed to fetch media from source: ${response.status}`);
    }
    
    const mimeType = response.headers.get('Content-Type') || 'application/octet-stream';
    
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
      // Direct browser download attachment header
      headers['Content-Disposition'] = `attachment; filename="${customName}"`;
    }

    // Return response with original status (206 for Range/Partial Content or 200)
    return new NextResponse(response.body, {
      status: response.status,
      headers,
    });
  } catch (error) {
    console.error('Image proxy error:', error);
    return new NextResponse('Error fetching image', { status: 500 });
  }
}