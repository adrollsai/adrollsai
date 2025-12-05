import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { postToLinkedIn } from '@/utils/social-api';
import { db } from '@/lib/db';
import { account } from '@/lib/schema';
import { eq, and } from 'drizzle-orm';

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { imageUrl, caption } = body;

  // 1. Get LinkedIn Token from 'account' table
  const [linkedInAccount] = await db.select()
    .from(account)
    .where(and(
        eq(account.userId, session.user.id),
        eq(account.providerId, "linkedin")
    ))
    .limit(1);

  if (!linkedInAccount?.accessToken) {
    return NextResponse.json({ error: 'No LinkedIn account linked.' }, { status: 400 });
  }

  // 2. Post
  try {
    const result = await postToLinkedIn(linkedInAccount.accessToken, imageUrl, caption);
    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: error.message || 'Posting failed' }, { status: 500 });
  }
}