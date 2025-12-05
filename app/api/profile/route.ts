import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { db } from '@/lib/db';
import { user, account } from '@/lib/schema';
import { eq, and } from 'drizzle-orm';

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // FIX 1: Remove .get() and use destructuring [userData] to get the first item
  const [userData] = await db.select().from(user).where(eq(user.id, session.user.id)).limit(1);
  
  // 2. Get Linked Accounts
  const accounts = await db.select().from(account).where(eq(account.userId, session.user.id));
  const providers = accounts.map(a => a.providerId);

  // FIX 2: Handle if userData is empty safely
  return NextResponse.json({ ...(userData || {}), providers });
}

export async function PUT(request: Request) {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  
    const body = await request.json();
  
    // Create update object
    const updateData: any = {
      businessName: body.businessName,
      missionStatement: body.mission,
      brandColor: body.color,
      contactNumber: body.contact,
      logoUrl: body.logoUrl,
    };
  
    // Only update page info if provided (so we don't overwrite with null if just saving bio)
    if (body.selectedPageId) {
        updateData.selectedPageId = body.selectedPageId;
        updateData.selectedPageName = body.selectedPageName;
        updateData.selectedPageToken = body.selectedPageToken;
    }
  
    await db.update(user).set(updateData).where(eq(user.id, session.user.id));
  
    return NextResponse.json({ success: true });
  }