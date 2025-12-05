import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { postToFacebook, postToInstagram, postToLinkedIn } from '@/utils/social-api'

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

  // --- FACEBOOK ---
  if (platforms.includes('facebook')) {
    promises.push((async () => {
      if (!profile.selected_page_token) {
        results.facebook = 'skipped_no_token'
        return
      }
      try {
        await postToFacebook(profile.selected_page_token, imageUrl, caption)
        results.facebook = 'success'
      } catch (error: any) {
        console.error("Facebook Error:", error)
        results.facebook = `Error: ${error.message}`
      }
    })())
  }

  // --- INSTAGRAM ---
  if (platforms.includes('instagram')) {
    promises.push((async () => {
      if (!profile.selected_page_token || !profile.selected_page_id) {
        results.instagram = 'skipped_no_token_or_page_id'
        return
      }
      try {
        await postToInstagram(profile.selected_page_token, profile.selected_page_id, imageUrl, caption)
        results.instagram = 'success'
      } catch (error: any) {
        console.error("Instagram Error:", error)
        results.instagram = `Error: ${error.message}`
      }
    })())
  }

  // --- LINKEDIN ---
  if (platforms.includes('linkedin')) {
    promises.push((async () => {
      if (!profile.linkedin_token) {
        results.linkedin = 'skipped_no_token'
        return
      }
      try {
        await postToLinkedIn(profile.linkedin_token, imageUrl, caption)
        results.linkedin = 'success'
      } catch (error: any) {
        console.error("LinkedIn Error:", error)
        results.linkedin = `Error: ${error.message}`
      }
    })())
  }

  // --- YOUTUBE (Video ONLY) ---
  // Note: We haven't migrated YouTube to local utils yet, so we keep this pointing to n8n 
  // or leave it as a placeholder until the next step.
  if (platforms.includes('youtube')) {
    promises.push((async () => {
        if (type !== 'video') {
            results.youtube = 'skipped_not_video'
            return
        }
        if (!profile.youtube_token) {
            results.youtube = 'skipped_no_token'
            return
        }
        
        // TEMPORARY: Still using n8n for YouTube until we migrate it in the next step
        if (process.env.N8N_YOUTUBE_WEBHOOK_URL) {
            try {
                await fetch(process.env.N8N_YOUTUBE_WEBHOOK_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        accessToken: profile.youtube_token,
                        videoUrl: imageUrl, 
                        title: title || 'New Listing',
                        description: caption,
                        privacy: 'public'
                    })
                })
                results.youtube = 'success (via n8n)'
            } catch (e: any) {
                results.youtube = `n8n Error: ${e.message}`
            }
        } else {
            results.youtube = 'skipped_migration_in_progress'
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