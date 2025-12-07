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

  if (!userData?.adAccountId || !userData?.facebookToken) {
    return NextResponse.json({ error: "Ad Account or Token missing" }, { status: 400 });
  }

  // Fetch account-level insights (total spend, impressions, etc.)
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/act_${userData.adAccountId}/insights?fields=impressions,clicks,spend,cpc,ctr,cpp&date_preset=last_30d&access_token=${userData.facebookToken}`);
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch insights" }, { status: 500 });
  }
}
