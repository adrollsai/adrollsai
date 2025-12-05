import { NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

export async function POST(request: Request) {
  try {
    const data = await request.formData();
    const file: File | null = data.get('file') as unknown as File;

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Create unique filename
    const uniqueName = `${Date.now()}-${file.name.replace(/\s/g, '-')}`;
    
    // Save to public/uploads folder
    const uploadDir = join(process.cwd(), 'public', 'uploads');
    
    // Ensure folder exists
    await mkdir(uploadDir, { recursive: true });
    
    const filePath = join(uploadDir, uniqueName);
    await writeFile(filePath, buffer);
    
    // Return the URL that the browser can see
    // (Next.js automatically serves files in 'public' at the root path)
    const publicUrl = `/uploads/${uniqueName}`;
    
    return NextResponse.json({ url: publicUrl });

  } catch (error) {
    console.error("Upload Error:", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}