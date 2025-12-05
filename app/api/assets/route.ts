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