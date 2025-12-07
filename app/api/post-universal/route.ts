// adrollsai/adrollsai/adrollsai-adrollsai-version3/app/api/post-universal/route.ts

import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { postToFacebook, postToInstagram, postToLinkedIn, postToYouTube } from '@/utils/external-apis' // <--- NEW IMPORT

export async function POST(request: Request) {
  const supabase = await createClient()
  
  // 1. Auth Check
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { imageUrl, caption, title, type, platforms } = body

  // 2. Get User Credentials
  const { data: profile } = await supabase
    .from('profiles')
    .select('selected_page_token, selected_page_id, linkedin_token, youtube_token')
    .eq('id', user.id)
    .single()

  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const results: Record<string, string> = {}
  const promises: Promise<void>[] = []

  // --- HELPER (UPDATED to call direct functions) ---
  const sendToPlatform = async (platform: string, fn: () => Promise<any>) => {
    try {
      await fn()
      results[platform] = 'success'
    } catch (error: any) {
      const errorMessage = error.message || 'Unknown Error'
      console.error(`[Universal Post] ${platform} failed:`, errorMessage)
      // Safely shorten error message for the response
      results[platform] = `Failed: ${errorMessage.substring(0, 100)}...`
    }
  }

  // --- FACEBOOK ---
  if (platforms.includes('facebook')) {
    if (profile.selected_page_token) {
      promises.push(sendToPlatform('facebook', () => postToFacebook(
        profile.selected_page_token!, 
        imageUrl, 
        caption
      )))
    } else {
      results.facebook = 'skipped_no_token'
    }
  }

  // --- INSTAGRAM ---
  if (platforms.includes('instagram')) {
    if (profile.selected_page_token && profile.selected_page_id) {
      promises.push(sendToPlatform('instagram', () => postToInstagram(
        profile.selected_page_token!, 
        profile.selected_page_id!, 
        imageUrl, 
        caption
      )))
    } else {
      results.instagram = 'skipped_no_token_or_page_id' 
    }
  }

  // --- LINKEDIN ---
  if (platforms.includes('linkedin')) {
    if (profile.linkedin_token) {
      promises.push(sendToPlatform('linkedin', () => postToLinkedIn(
        profile.linkedin_token!, 
        imageUrl, 
        caption
      )))
    } else {
      results.linkedin = 'skipped_no_token'
    }
  }

  // --- YOUTUBE (Video ONLY) ---
  if (platforms.includes('youtube') && type === 'video') {
    if (profile.youtube_token) {
        promises.push(sendToPlatform('youtube', () => postToYouTube(
            profile.youtube_token!,
            imageUrl, 
            title || 'New Listing',
            caption,
            'public'
        )))
    } else {
        results.youtube = 'skipped_no_token'
    }
  } else if (platforms.includes('youtube')) {
    // Explicitly record that we skipped it because it wasn't a video
    results.youtube = 'skipped_not_video'
  }

  await Promise.all(promises)

  return NextResponse.json({ 
    success: true, 
    results,
    message: "Universal post processed" 
  })
}