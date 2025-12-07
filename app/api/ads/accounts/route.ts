import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { db } from '@/lib/db';
import { user } from '@/lib/schema';
import { eq } from 'drizzle-orm';

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [userData] = await db.select().from(user).where(eq(user.id, session.user.id)).limit(1);

  if (!userData?.facebookToken) {
    return NextResponse.json({ error: "No Facebook Token Found" }, { status: 400 });
  }

  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/me/adaccounts?fields=name,account_id,currency,account_status&access_token=${userData.facebookToken}`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch ad accounts" }, { status: 500 });
  }
}
