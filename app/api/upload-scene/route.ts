import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';

export async function POST(request: Request) {
    try {
        console.log("[Upload API] Received upload request...");
        const arrayBuffer = await request.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        const tempDir = path.join(os.tmpdir(), 'fixed_retrieve_4e7742e2-870b-44ec-bf31-e417de4cb174');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        
        const destPath = path.join(tempDir, 'scene_1_orig.mp4');
        fs.writeFileSync(destPath, buffer);
        console.log(`[Upload API] Saved Scene 2 to ${destPath}. Size: ${buffer.length} bytes`);
        
        return NextResponse.json({ success: true, size: buffer.length });
    } catch (error: any) {
        console.error("[Upload API] Error saving uploaded scene:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
