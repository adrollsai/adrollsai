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

    // Fetch the image/video on the server side (bypasses browser CORS)
    let response = await fetch(targetUrl);

    // Fallback attempt if original URL failed
    if (!response.ok && targetUrl !== imageUrl) {
        response = await fetch(imageUrl);
    }
    
    if (!response.ok) throw new Error('Failed to fetch image from source');
    
    const mimeType = response.headers.get('Content-Type') || 'application/octet-stream';
    
    const headers: Record<string, string> = {
      'Content-Type': mimeType,
      'Access-Control-Allow-Origin': '*',
      'Content-Length': response.headers.get('Content-Length') || '',
      'Cache-Control': 'public, max-age=31536000, immutable'
    };

    if (triggerDownload) {
      // Direct browser download attachment header
      headers['Content-Disposition'] = `attachment; filename="${customName}"`;
    }

    // Return the response body stream directly (prevents buffering in memory)
    return new NextResponse(response.body, {
      headers,
    });
  } catch (error) {
    console.error('Image proxy error:', error);
    return new NextResponse('Error fetching image', { status: 500 });
  }
}