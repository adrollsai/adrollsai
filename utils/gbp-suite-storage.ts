import { createClient } from '@supabase/supabase-js'

const getSupabaseAdmin = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    throw new Error('Supabase URL or Key is missing')
  }
  return createClient(url, key)
}

export interface GBPPost {
  id: string
  user_id: string
  post_type: 'update' | 'offer' | 'event'
  summary: string
  call_to_action_type?: string
  call_to_action_url?: string
  media_url?: string
  offer_coupon_code?: string
  offer_terms?: string
  event_title?: string
  event_start_time?: string
  event_end_time?: string
  status: 'draft' | 'scheduled' | 'published' | 'failed'
  scheduled_at?: string
  published_at?: string
  google_post_id?: string
  created_at?: string
  updated_at?: string
}

export interface ReviewFeedback {
  id: string
  user_id: string
  rating: number
  customer_name?: string
  customer_phone?: string
  customer_email?: string
  feedback: string
  source?: string
  status?: 'new' | 'in_progress' | 'resolved'
  resolution_notes?: string
  created_at?: string
}

export interface GBPOptimizationData {
  business_name: string
  place_id?: string
  address?: string
  phone?: string
  website?: string
  primary_category?: string
  secondary_categories?: string[]
  description?: string
  rating?: number
  reviews_count?: number
  photos_count?: number
  google_review_url?: string
  opening_hours?: string[]
  health_score?: number
  score_grade?: string
  shortcomings?: Array<{
    id: string
    category: 'nap' | 'categories' | 'description' | 'media' | 'reviews' | 'posts' | 'hours' | 'qa'
    title: string
    status: 'pass' | 'warning' | 'fail'
    impact: 'high' | 'medium' | 'low'
    current_state: string
    recommendation: string
    action_type: 'ai_fix' | 'manual_step'
  }>
  ai_optimizations?: {
    optimized_description?: string
    recommended_primary_category?: string
    recommended_secondary_categories?: string[]
    high_intent_keywords?: string[]
    suggested_posts?: Array<{
      type: 'update' | 'offer' | 'event'
      title: string
      content: string
      cta_type: string
      cta_url?: string
    }>
    qa_pairs?: Array<{
      question: string
      answer: string
    }>
    review_request_templates?: {
      whatsapp: string
      sms: string
    }
    manual_action_steps?: Array<{
      step_number: number
      title: string
      description: string
      why_it_matters: string
    }>
    generated_at?: string
  }
}

// Memory cache fallback for fast response
const postMemoryCache = new Map<string, GBPPost[]>()
const feedbackMemoryCache = new Map<string, ReviewFeedback[]>()

// Fetch all GBP posts for a user
export async function getGBPPosts(userId: string): Promise<GBPPost[]> {
  const supabase = getSupabaseAdmin()

  // 1. Try first-class gbp_posts table
  try {
    const { data, error } = await supabase
      .from('gbp_posts')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })

    if (!error && data) {
      postMemoryCache.set(userId, data as GBPPost[])
      return data as GBPPost[]
    }
  } catch (err) {
    // Continue to fallback
  }

  // 2. Resilient fallback to landing_pages storage adapter
  try {
    const { data: lp } = await supabase
      .from('landing_pages')
      .select('html_content')
      .eq('product_name', 'gbp_posts_store')
      .eq('slug', `posts_${userId}`)
      .maybeSingle()

    if (lp && lp.html_content) {
      const parsed = JSON.parse(lp.html_content) as GBPPost[]
      postMemoryCache.set(userId, parsed)
      return parsed
    }
  } catch {}

  return postMemoryCache.get(userId) || []
}

// Save or create a GBP post
export async function saveGBPPost(post: Omit<GBPPost, 'id'> & { id?: string }): Promise<GBPPost> {
  const supabase = getSupabaseAdmin()
  const payload: GBPPost = {
    ...post,
    id: post.id || crypto.randomUUID(),
    created_at: post.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString()
  }

  // 1. Try first-class table
  try {
    const { data, error } = await supabase
      .from('gbp_posts')
      .upsert(payload)
      .select()
      .single()

    if (!error && data) {
      const existing = postMemoryCache.get(payload.user_id) || []
      const updated = [data as GBPPost, ...existing.filter(p => p.id !== data.id)]
      postMemoryCache.set(payload.user_id, updated)
      return data as GBPPost
    }
  } catch {}

  // 2. Fallback to landing_pages adapter
  try {
    const existing = postMemoryCache.get(payload.user_id) || []
    const updated = [payload, ...existing.filter(p => p.id !== payload.id)]
    postMemoryCache.set(payload.user_id, updated)

    const { data: lp } = await supabase
      .from('landing_pages')
      .select('id')
      .eq('product_name', 'gbp_posts_store')
      .eq('slug', `posts_${payload.user_id}`)
      .maybeSingle()

    if (lp) {
      await supabase
        .from('landing_pages')
        .update({
          html_content: JSON.stringify(updated),
          updated_at: new Date().toISOString()
        })
        .eq('id', lp.id)
    } else {
      await supabase
        .from('landing_pages')
        .insert({
          slug: `posts_${payload.user_id}`,
          title: `GBP Posts Store for ${payload.user_id}`,
          product_name: 'gbp_posts_store',
          user_id: payload.user_id,
          html_content: JSON.stringify(updated),
          updated_at: new Date().toISOString()
        })
    }
  } catch (fallbackErr) {
    console.warn('[GBP Storage] Fallback post save error:', fallbackErr)
  }

  return payload
}

// Delete a GBP post
export async function deleteGBPPost(postId: string, userId: string): Promise<boolean> {
  const supabase = getSupabaseAdmin()

  try {
    await supabase.from('gbp_posts').delete().eq('id', postId).eq('user_id', userId)
  } catch {}

  try {
    const existing = postMemoryCache.get(userId) || []
    const updated = existing.filter(p => p.id !== postId)
    postMemoryCache.set(userId, updated)

    await supabase
      .from('landing_pages')
      .update({ html_content: JSON.stringify(updated) })
      .eq('product_name', 'gbp_posts_store')
      .eq('slug', `posts_${userId}`)
  } catch {}

  return true
}

// Save private review feedback (<4 stars)
export async function saveReviewFeedback(feedback: Omit<ReviewFeedback, 'id'> & { id?: string }): Promise<ReviewFeedback> {
  const supabase = getSupabaseAdmin()
  const payload: ReviewFeedback = {
    ...feedback,
    id: feedback.id || crypto.randomUUID(),
    created_at: new Date().toISOString()
  }

  // 1. Try first-class review_feedbacks table
  try {
    const { data, error } = await supabase
      .from('review_feedbacks')
      .insert(payload)
      .select()
      .single()

    if (!error && data) {
      const existing = feedbackMemoryCache.get(payload.user_id) || []
      feedbackMemoryCache.set(payload.user_id, [data as ReviewFeedback, ...existing])
      return data as ReviewFeedback
    }
  } catch {}

  // 2. Fallback to landing_pages store
  try {
    const existing = feedbackMemoryCache.get(payload.user_id) || []
    const updated = [payload, ...existing]
    feedbackMemoryCache.set(payload.user_id, updated)

    const { data: lp } = await supabase
      .from('landing_pages')
      .select('id')
      .eq('product_name', 'review_feedbacks_store')
      .eq('slug', `feedbacks_${payload.user_id}`)
      .maybeSingle()

    if (lp) {
      await supabase
        .from('landing_pages')
        .update({
          html_content: JSON.stringify(updated),
          updated_at: new Date().toISOString()
        })
        .eq('id', lp.id)
    } else {
      await supabase
        .from('landing_pages')
        .insert({
          slug: `feedbacks_${payload.user_id}`,
          title: `Review Feedbacks Store for ${payload.user_id}`,
          product_name: 'review_feedbacks_store',
          user_id: payload.user_id,
          html_content: JSON.stringify(updated),
          updated_at: new Date().toISOString()
        })
    }
  } catch (err) {
    console.warn('[Review Storage] Fallback feedback save error:', err)
  }

  return payload
}

// Get review feedbacks for a user
export async function getReviewFeedbacks(userId: string): Promise<ReviewFeedback[]> {
  const supabase = getSupabaseAdmin()

  try {
    const { data, error } = await supabase
      .from('review_feedbacks')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })

    if (!error && data) {
      feedbackMemoryCache.set(userId, data as ReviewFeedback[])
      return data as ReviewFeedback[]
    }
  } catch {}

  try {
    const { data: lp } = await supabase
      .from('landing_pages')
      .select('html_content')
      .eq('product_name', 'review_feedbacks_store')
      .eq('slug', `feedbacks_${userId}`)
      .maybeSingle()

    if (lp && lp.html_content) {
      const parsed = JSON.parse(lp.html_content) as ReviewFeedback[]
      feedbackMemoryCache.set(userId, parsed)
      return parsed
    }
  } catch {}

  return feedbackMemoryCache.get(userId) || []
}

// Get or Save GBP Optimization Suite Profile Data (saved in profile's business_info or landing_pages)
export async function getGBPOptimizationData(userId: string): Promise<GBPOptimizationData | null> {
  const supabase = getSupabaseAdmin()

  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('business_name, address, contact_number, business_info, google_business_location_id, google_place_id, google_review_url, custom_domain')
      .eq('id', userId)
      .single()

    if (profile) {
      let bi: any = {}
      if (profile.business_info) {
        try {
          bi = typeof profile.business_info === 'string' ? JSON.parse(profile.business_info) : profile.business_info
        } catch {}
      }

      if (bi?.gbp_suite_data) {
        return bi.gbp_suite_data as GBPOptimizationData
      }
    }
  } catch {}

  // Fallback to landing_pages
  try {
    const { data: lp } = await supabase
      .from('landing_pages')
      .select('html_content')
      .eq('product_name', 'gbp_suite_profile')
      .eq('slug', `gbp_suite_${userId}`)
      .maybeSingle()

    if (lp && lp.html_content) {
      return JSON.parse(lp.html_content) as GBPOptimizationData
    }
  } catch {}

  return null
}

export const getGBPOptimizationProfile = getGBPOptimizationData

export async function saveGBPOptimizationData(userId: string, data: GBPOptimizationData): Promise<void> {
  const supabase = getSupabaseAdmin()

  // 1. Save into profiles.business_info
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('business_info')
      .eq('id', userId)
      .single()

    let bi: any = {}
    if (profile?.business_info) {
      try {
        bi = typeof profile.business_info === 'string' ? JSON.parse(profile.business_info) : profile.business_info
      } catch {}
    }

    bi.gbp_suite_data = data
    if (data.place_id) bi.google_place_id = data.place_id
    if (data.google_review_url) bi.google_review_url = data.google_review_url

    await supabase
      .from('profiles')
      .update({
        business_info: JSON.stringify(bi)
      })
      .eq('id', userId)
  } catch (err) {
    console.warn('[GBP Suite] Error updating business_info:', err)
  }

  // 2. Also save into landing_pages backup
  try {
    const { data: lp } = await supabase
      .from('landing_pages')
      .select('id')
      .eq('product_name', 'gbp_suite_profile')
      .eq('slug', `gbp_suite_${userId}`)
      .maybeSingle()

    if (lp) {
      await supabase
        .from('landing_pages')
        .update({
          html_content: JSON.stringify(data),
          updated_at: new Date().toISOString()
        })
        .eq('id', lp.id)
    } else {
      await supabase
        .from('landing_pages')
        .insert({
          slug: `gbp_suite_${userId}`,
          title: `GBP Suite Profile for ${userId}`,
          product_name: 'gbp_suite_profile',
          user_id: userId,
          html_content: JSON.stringify(data),
          updated_at: new Date().toISOString()
        })
    }
  } catch {}
}
