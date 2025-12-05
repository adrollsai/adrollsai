import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth' // Use Better-Auth
import { headers } from 'next/headers'
import { db } from '@/lib/db'
import { user, account } from '@/lib/schema'
import { eq, and } from 'drizzle-orm'
import { postToFacebook, postToInstagram, postToLinkedIn } from '@/utils/social-api'

export async function POST(request: Request) {
  // 1. Auth Check (Better-Auth)
  const session = await auth.api.getSession({
      headers: await headers()
  });
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { imageUrl, caption, title, type, platforms } = body

  // 2. Get User Data (Page Tokens, etc.)
  const [userData] = await db.select().from(user).where(eq(user.id, session.user.id)).limit(1);
  
  // 3. Get Social Accounts (Access Tokens)
  const accounts = await db.select().from(account).where(eq(account.userId, session.user.id));
  const getAccessToken = (provider: string) => accounts.find(a => a.providerId === provider)?.accessToken;

  const results: Record<string, string> = {}
  const promises: Promise<void>[] = []

  // --- FACEBOOK ---
  if (platforms.includes('facebook')) {
    promises.push((async () => {
      // Use the SELECTED PAGE token stored in user profile
      if (!userData?.selectedPageToken) {
        results.facebook = 'skipped_no_page_selected'
        return
      }
      try {
        await postToFacebook(userData.selectedPageToken, imageUrl, caption)
        results.facebook = 'success'
      } catch (error: any) {
        results.facebook = `Error: ${error.message}`
      }
    })())
  }

  // --- INSTAGRAM ---
  if (platforms.includes('instagram')) {
    promises.push((async () => {
      // Use Page Token + Page ID to find Insta account
      if (!userData?.selectedPageToken || !userData?.selectedPageId) {
        results.instagram = 'skipped_no_page_selected'
        return
      }
      try {
        await postToInstagram(userData.selectedPageToken, userData.selectedPageId, imageUrl, caption)
        results.instagram = 'success'
      } catch (error: any) {
        results.instagram = `Error: ${error.message}`
      }
    })())
  }

  // --- LINKEDIN ---
  if (platforms.includes('linkedin')) {
    promises.push((async () => {
      const token = getAccessToken('linkedin')
      if (!token) {
        results.linkedin = 'skipped_not_connected'
        return
      }
      try {
        await postToLinkedIn(token, imageUrl, caption)
        results.linkedin = 'success'
      } catch (error: any) {
        results.linkedin = `Error: ${error.message}`
      }
    })())
  }

  await Promise.all(promises)

  return NextResponse.json({ 
    success: true, 
    results,
    message: "Universal post processed" 
  })
}