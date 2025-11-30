import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

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

  // --- HELPER ---
  const sendToN8N = async (platform: string, url: string | undefined, payload: any) => {
    if (!url) {
      results[platform] = 'skipped_missing_env_var'
      return
    }
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      if (response.ok) {
        results[platform] = 'success'
      } else {
        const text = await response.text()
        console.error(`[Universal Post] ${platform} failed:`, text)
        results[platform] = `Failed: ${text}` 
      }
    } catch (error: any) {
      console.error(`[Universal Post] ${platform} network error:`, error)
      results[platform] = `Error: ${error.message}`
    }
  }

  // --- FACEBOOK ---
  if (platforms.includes('facebook')) {
    if (profile.selected_page_token) {
      promises.push(sendToN8N('facebook', process.env.N8N_SOCIAL_WEBHOOK_URL, {
        accessToken: profile.selected_page_token,
        imageUrl,
        caption
      }))
    } else {
      results.facebook = 'skipped_no_token'
    }
  }

  // --- INSTAGRAM ---
  if (platforms.includes('instagram')) {
    if (profile.selected_page_token && profile.selected_page_id) {
      promises.push(sendToN8N('instagram', process.env.N8N_INSTAGRAM_WEBHOOK_URL, {
        accessToken: profile.selected_page_token,
        pageId: profile.selected_page_id,
        imageUrl,
        caption
      }))
    } else {
      results.instagram = 'skipped_no_token'
    }
  }

  // --- LINKEDIN ---
  if (platforms.includes('linkedin')) {
    if (profile.linkedin_token) {
      promises.push(sendToN8N('linkedin', process.env.N8N_LINKEDIN_WEBHOOK_URL, {
        accessToken: profile.linkedin_token,
        imageUrl,
        caption
      }))
    } else {
      results.linkedin = 'skipped_no_token'
    }
  }

  // --- YOUTUBE (Video ONLY) ---
  if (platforms.includes('youtube')) {
    // CHANGE: Strictly check if type is 'video' before proceeding
    if (type === 'video') {
        if (profile.youtube_token) {
            promises.push(sendToN8N('youtube', process.env.N8N_YOUTUBE_WEBHOOK_URL, {
                accessToken: profile.youtube_token,
                videoUrl: imageUrl, 
                title: title || 'New Listing',
                description: caption,
                privacy: 'public'
            }))
        } else {
            results.youtube = 'skipped_no_token'
        }
    } else {
        // Explicitly record that we skipped it because it wasn't a video
        results.youtube = 'skipped_not_video'
    }
  }

  await Promise.all(promises)

  return NextResponse.json({ 
    success: true, 
    results,
    message: "Universal post processed" 
  })
}