import path from 'path';
import fs from 'fs';
import os from 'os';

let cachedFfmpegPath: string | null = null;

/**
 * Returns a validated and executable FFmpeg binary path.
 * Handles Windows (.exe), Linux permissions (chmod 755 on Vercel/Cloud),
 * and falls back safely to system PATH 'ffmpeg'.
 */
export function getFfmpegPath(): string {
    if (cachedFfmpegPath && (cachedFfmpegPath === 'ffmpeg' || fs.existsSync(cachedFfmpegPath))) {
        return cachedFfmpegPath;
    }

    // 1. Try dynamic require of ffmpeg-static
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const ffmpegStatic = require('ffmpeg-static');
        if (typeof ffmpegStatic === 'string' && fs.existsSync(ffmpegStatic)) {
            if (os.platform() !== 'win32') {
                try { fs.chmodSync(ffmpegStatic, '755'); } catch (_) {}
            }
            cachedFfmpegPath = ffmpegStatic;
            return ffmpegStatic;
        }
    } catch (_) {}

    // 2. Try explicit paths in node_modules
    const candidates = [
        path.join(process.cwd(), 'node_modules', 'ffmpeg-static', os.platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'),
        path.join(process.cwd(), '.next', 'server', 'node_modules', 'ffmpeg-static', os.platform() === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'),
    ];

    for (const bin of candidates) {
        if (fs.existsSync(bin)) {
            if (os.platform() !== 'win32') {
                try { fs.chmodSync(bin, '755'); } catch (_) {}
            }
            cachedFfmpegPath = bin;
            return bin;
        }
    }

    // 3. Fallback to system-level ffmpeg
    cachedFfmpegPath = 'ffmpeg';
    return 'ffmpeg';
}
