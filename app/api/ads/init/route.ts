import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { db } from '@/lib/db';
import { user } from '@/lib/schema';
import { eq } from 'drizzle-orm';

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { adAccountId, adAccountName } = body;

  if (!adAccountId) {
    return NextResponse.json({ error: "Ad Account ID is required" }, { status: 400 });
  }

  await db.update(user)
    .set({
        adAccountId: adAccountId,
        adAccountName: adAccountName
    })
    .where(eq(user.id, session.user.id));

  return NextResponse.json({ success: true });
}
