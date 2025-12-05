import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { db } from '@/lib/db';
import { assets } from '@/lib/schema';
import { eq, desc } from 'drizzle-orm';

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const data = await db.select().from(assets)
    .where(eq(assets.userId, session.user.id))
    .orderBy(desc(assets.createdAt));

  return NextResponse.json(data);
}

export async function POST(request: Request) {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  
    const body = await request.json();
  
    await db.insert(assets).values({
        userId: session.user.id,
        url: body.url,
        type: body.type, // 'image' or 'video'
        status: body.status || 'Draft'
    });
  
    return NextResponse.json({ success: true });
  }