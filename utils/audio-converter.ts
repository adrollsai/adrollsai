import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Ensures an audio buffer is in clean, valid MP3 audio format.
 * If the buffer contains WAV/PCM data (or starts with 'RIFF'),
 * it transcodes the audio to standard MP3 format using FFmpeg.
 */
export async function ensureMp3AudioBuffer(rawBuffer: Buffer): Promise<Buffer> {
    if (!rawBuffer || rawBuffer.length === 0) {
        return rawBuffer;
    }

    // Check if buffer starts with WAV RIFF header ('RIFF')
    const isWav = rawBuffer.length > 12 && rawBuffer.toString('utf8', 0, 4) === 'RIFF';
    
    if (!isWav) {
        return rawBuffer;
    }

    console.log('[Audio Converter] WAV audio buffer detected. Transcoding to standard MP3 via FFmpeg...');

    const tempDir = path.join(os.tmpdir(), `audioconv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);
    try {
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
        
        const inputWav = path.join(tempDir, 'input.wav');
        const outputMp3 = path.join(tempDir, 'output.mp3');

        fs.writeFileSync(inputWav, rawBuffer);

        const ffmpegBinary = path.join(
            process.cwd(),
            'node_modules',
            'ffmpeg-static',
            os.platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
        );
        const ffmpegExec = fs.existsSync(ffmpegBinary) ? ffmpegBinary : 'ffmpeg';

        const cmd = `"${ffmpegExec}" -nostdin -y -i "${inputWav}" -c:a libmp3lame -q:a 2 -ar 48000 -ac 2 "${outputMp3}"`;

        await new Promise<void>((resolve, reject) => {
            exec(cmd, { maxBuffer: 1024 * 1024 * 20 }, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        const mp3Buffer = fs.readFileSync(outputMp3);
        console.log(`[Audio Converter] Transcoding complete. WAV size: ${rawBuffer.length} bytes -> MP3 size: ${mp3Buffer.length} bytes`);
        return mp3Buffer;
    } catch (e: any) {
        console.error('[Audio Converter] Transcoding warning (returning raw buffer fallback):', e.message);
        return rawBuffer;
    } finally {
        try { if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) {}
    }
}
