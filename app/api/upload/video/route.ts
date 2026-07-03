import { NextResponse } from 'next/server';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { r2, R2_BUCKET, R2_PUBLIC_URL } from '@/utils/r2';
import { createClient } from '@/utils/supabase/server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import ffmpegPath from 'ffmpeg-static';

const execPromise = promisify(exec);

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const formData = await request.formData();
    const file = formData.get('file') as File;
    const folder = formData.get('folder') as string || 'videos';
    const impersonateId = formData.get('impersonateId') as string | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const { data: currentProfile } = await supabase.from('profiles').select('role, agency_id, parent_id').eq('id', user.id).single();
    let targetUserId = (['admin', 'agent'].includes(currentProfile?.role || '') && (currentProfile?.agency_id || currentProfile?.parent_id)) 
      ? (currentProfile.agency_id || currentProfile.parent_id) 
      : user.id;

    if (impersonateId) {
      if (['super_admin', 'agency', 'admin', 'agent'].includes(currentProfile?.role || '')) {
        if (currentProfile?.role !== 'super_admin') {
          const { data: subAccount } = await supabase
            .from('profiles')
            .select('id')
            .eq('id', impersonateId)
            .eq('agency_id', currentProfile?.agency_id || user.id)
            .single();

          if (subAccount) {
            targetUserId = impersonateId;
          }
        } else {
          targetUserId = impersonateId;
        }
      }
    }

    const cleanName = file.name.replace(/[^a-zA-Z0-9.-]/g, '');
    const tempDir = os.tmpdir();
    const inputPath = path.join(tempDir, `raw-${Date.now()}-${cleanName}`);
    const outputPath = path.join(tempDir, `comp-${Date.now()}-${cleanName}`);

    let inputCreated = false;
    let outputCreated = false;

    try {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      fs.writeFileSync(inputPath, buffer);
      inputCreated = true;

      // Run FFmpeg to compress the video
      // libx264, crf 28 (very high compression, visual difference is practically unnoticeable), preset superfast
      const ffmpeg = ffmpegPath || 'ffmpeg';
      const command = `"${ffmpeg}" -y -i "${inputPath}" -filter:v fps=30 -vsync cfr -c:v libx264 -pix_fmt yuv420p -crf 28 -preset superfast -c:a aac -b:a 128k "${outputPath}"`;
      
      console.log(`[VideoUpload API] Executing video compression command: ${command}`);
      await execPromise(command);
      outputCreated = true;

      const compressedBuffer = fs.readFileSync(outputPath);
      console.log(`[VideoUpload API] Video compressed successfully. Original size: ${(buffer.length / (1024 * 1024)).toFixed(2)} MB, Compressed size: ${(compressedBuffer.length / (1024 * 1024)).toFixed(2)} MB`);

      const key = `${folder}/${targetUserId}/${Date.now()}-${cleanName}`;

      const uploadParams = {
        Bucket: R2_BUCKET,
        Key: key,
        Body: compressedBuffer,
        ContentType: file.type || 'video/mp4'
      };

      await r2.send(new PutObjectCommand(uploadParams));
      const publicUrl = `${R2_PUBLIC_URL}/adrolls-storage/${key}`;

      return NextResponse.json({ success: true, publicUrl });
    } catch (transcodeErr: any) {
      console.error("[VideoUpload API] Error in video compression / upload stream:", transcodeErr);
      return NextResponse.json({ error: transcodeErr.message }, { status: 500 });
    } finally {
      // Clean up temp files
      if (inputCreated && fs.existsSync(inputPath)) {
        try {
          fs.unlinkSync(inputPath);
        } catch (e) {}
      }
      if (outputCreated && fs.existsSync(outputPath)) {
        try {
          fs.unlinkSync(outputPath);
        } catch (e) {}
      }
    }
  } catch (error: any) {
    console.error("[VideoUpload API] Handler Error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
