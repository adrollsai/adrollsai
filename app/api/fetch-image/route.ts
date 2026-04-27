// app/api/fetch-image/route.ts
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const imageUrl = searchParams.get('url');

  if (!imageUrl) {
    return new NextResponse('Missing URL', { status: 400 });
  }

  try {
    // Fetch the image on the server side (bypasses browser CORS)
    const response = await fetch(imageUrl);
    
    if (!response.ok) throw new Error('Failed to fetch image from source');
    
    const blob = await response.blob();
    
    return new NextResponse(blob, {
      headers: {
        'Content-Type': response.headers.get('Content-Type') || 'image/jpeg',
        // Explicitly allow your frontend to read this
        'Access-Control-Allow-Origin': '*', 
        'Cache-Control': 'public, max-age=31536000, immutable'
      },
    });
  } catch (error) {
    console.error('Image proxy error:', error);
    return new NextResponse('Error fetching image', { status: 500 });
  }
}