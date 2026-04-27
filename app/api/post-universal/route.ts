// adrollsai/adrollsai/adrollsai-adrollsai-bsi/app/api/post-universal/route.ts

import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { postToFacebook, postToInstagram } from '@/utils/external-apis'

export async function POST(request: Request) {
  const supabase = await createClient()
  
  // 1. Auth Check
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { imageUrl, caption, type, platforms } = body

  // 2. Get User Credentials
  const { data: profile } = await supabase
    .from('profiles')
    .select('selected_page_token, selected_page_id')
    .eq('id', user.id)
    .single()

  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const results: Record<string, string> = {}
  const promises: Promise<void>[] = []

  // --- HELPER ---
  const sendToPlatform = async (platform: string, fn: () => Promise<any>) => {
    try {
      await fn()
      results[platform] = 'success'
    } catch (error: any) {
      const errorMessage = error.message || 'Unknown Error'
      console.error(`[Universal Post] ${platform} failed:`, errorMessage)
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

  await Promise.all(promises)

  return NextResponse.json({ 
    success: true, 
    results,
    message: "Universal post processed" 
  })
}