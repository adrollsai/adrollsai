import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { r2, R2_BUCKET, R2_PUBLIC_URL } from '@/utils/r2';
import { verifyCreativeSessionToken } from '@/utils/creative-token';

export const dynamic = 'force-dynamic';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const token = formData.get('token') as string;
    const file = formData.get('file') as File;

    if (!token) {
      return NextResponse.json({ error: 'Session token required.' }, { status: 400 });
    }

    if (!file) {
      return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
    }

    const payload = verifyCreativeSessionToken(token);
    if (!payload) {
      return NextResponse.json({ error: 'Session expired or invalid.' }, { status: 401 });
    }

    const { userId } = payload;
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const isVideo = file.type.startsWith('video/') || file.name.endsWith('.mp4');
    const ext = file.name.split('.').pop() || (isVideo ? 'mp4' : 'jpg');
    const cleanFileName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    const r2Key = `inventory/${userId}/${cleanFileName}`;

    await r2.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: r2Key,
        Body: buffer,
        ContentType: file.type || (isVideo ? 'video/mp4' : 'image/jpeg')
      })
    );

    const publicUrl = `${R2_PUBLIC_URL.replace(/\/$/, '')}/${r2Key}`;

    // Register into assets table
    const { data: asset, error: assetErr } = await supabaseAdmin
      .from('assets')
      .insert({
        user_id: userId,
        url: publicUrl,
        type: isVideo ? 'video' : 'image',
        status: 'Ready',
        caption: file.name.replace(/\.[^/.]+$/, '')
      })
      .select()
      .single();

    if (assetErr) {
      console.warn('Failed to insert into assets table:', assetErr);
    }

    return NextResponse.json({
      success: true,
      asset: {
        id: asset?.id || Date.now().toString(),
        url: publicUrl,
        title: file.name,
        type: isVideo ? 'video' : 'image',
        aspect_ratio: '1:1',
        is_ai_generated: false,
        created_at: new Date().toISOString()
      }
    });
  } catch (error: any) {
    console.error('❌ [upload-direct POST] Error:', error);
    return NextResponse.json({ error: error.message || 'Upload failed' }, { status: 500 });
  }
}
