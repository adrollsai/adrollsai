import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    let identifier = searchParams.get('identifier') || ''

    if (!identifier) {
      return NextResponse.json({ error: 'Missing identifier' }, { status: 400 })
    }

    // Decode URL and normalize potential space-separated UUIDs
    identifier = decodeURIComponent(identifier).trim()
    if (identifier.includes(' ') && identifier.replace(/\s+/g, '-').length === 36) {
      identifier = identifier.replace(/\s+/g, '-')
    }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    let profileQuery = supabaseAdmin
      .from('profiles')
      .select(`
        id,
        business_name,
        contact_number,
        logo_url,
        brand_color,
        mission_statement,
        facebook_url,
        instagram_url,
        linkedin_url,
        youtube_url,
        address,
        pixel_id,
        currency,
        custom_domain,
        business_landing_enabled,
        business_landing_hero_title,
        business_landing_hero_subtitle,
        business_landing_show_products
      `)

    if (identifier.includes('.')) {
      profileQuery = profileQuery.eq('custom_domain', identifier)
    } else {
      profileQuery = profileQuery.eq('id', identifier)
    }

    const { data: profile, error: profileErr } = await profileQuery.maybeSingle()

    if (profileErr) {
      console.error('[Shared Catalog API] Profile query error:', profileErr)
      return NextResponse.json({ error: 'Failed to query profile' }, { status: 500 })
    }

    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    // Fetch active properties
    const { data: properties, error: propErr } = await supabaseAdmin
      .from('properties')
      .select('*')
      .eq('user_id', profile.id)
      .neq('status', 'Archived')
      .neq('status', 'Sold')
      .order('created_at', { ascending: false })

    if (propErr) {
      console.error('[Shared Catalog API] Properties query error:', propErr)
    }

    // Check business landing index page
    let hasBusinessLanding = false
    if (profile.business_landing_enabled) {
      const { data: bizPage } = await supabaseAdmin
        .from('landing_pages')
        .select('id')
        .eq('user_id', profile.id)
        .eq('slug', 'index')
        .maybeSingle()
      hasBusinessLanding = !!bizPage
    }

    // Fetch published posts if any
    const { data: posts } = await supabaseAdmin
      .from('posts')
      .select('*')
      .eq('user_id', profile.id)
      .eq('status', 'published')
      .order('created_at', { ascending: false })

    return NextResponse.json({
      success: true,
      profile,
      properties: properties || [],
      hasBusinessLanding,
      posts: posts || []
    })

  } catch (err: any) {
    console.error('[Shared Catalog API] Server error:', err)
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 })
  }
}
