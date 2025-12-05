import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { db } from '@/lib/db';
import { account } from '@/lib/schema';
import { eq, and } from 'drizzle-orm';

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // 1. Get the Facebook User Token from the 'account' table
  const [fbAccount] = await db.select()
    .from(account)
    .where(and(
        eq(account.userId, session.user.id),
        eq(account.providerId, "facebook")
    ))
    .limit(1);

  if (!fbAccount || !fbAccount.accessToken) {
    return NextResponse.json({ error: "Facebook not connected" }, { status: 400 });
  }

  try {
    // 2. Fetch Pages from Meta Graph API
    const res = await fetch(`https://graph.facebook.com/v19.0/me/accounts?access_token=${fbAccount.accessToken}`);
    const data = await res.json();

    if (data.error) throw new Error(data.error.message);

    return NextResponse.json({ pages: data.data || [] });
  } catch (error: any) {
    console.error("FB API Error:", error.message);
    return NextResponse.json({ error: "Failed to fetch pages" }, { status: 500 });
  }
}