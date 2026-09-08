import { MetadataRoute } from 'next'
import { headers } from 'next/headers'
import { createClient } from '@supabase/supabase-js'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const headersList = await headers()
  const rawHost = headersList.get('x-forwarded-host') || headersList.get('host') || 'nobogent.com'
  const host = rawHost.split(':')[0]

  const mainDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'nobogent.com'
  const isPlatform = host.includes(mainDomain) || 
                     host.includes('nobogent.com') || 
                     host.includes('adrolls.in') || 
                     host.includes('localhost') || 
                     host.includes('vercel.app') || 
                     host.includes('ngrok-free.dev')

  const protocol = host.includes('localhost') || host.includes('ngrok') ? 'http' : 'https'
  const baseUrl = `${protocol}://${host}`

  if (!isPlatform) {
    try {
      // 1. Initialize Supabase Admin client to securely fetch client profiles and items
      const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
      )

      // 2. Resolve target profile associated with this custom domain
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('custom_domain', host)
        .maybeSingle()

      if (profile) {
        // 3. Fetch active properties, landing pages, and published posts
        const [{ data: properties }, { data: landingPages }, { data: posts }] = await Promise.all([
          supabaseAdmin
            .from('properties')
            .select('id, updated_at')
            .eq('user_id', profile.id)
            .neq('status', 'Archived')
            .neq('status', 'Sold'),
          supabaseAdmin
            .from('landing_pages')
            .select('slug, updated_at')
            .eq('user_id', profile.id),
          supabaseAdmin
            .from('posts')
            .select('id, updated_at')
            .eq('user_id', profile.id)
            .eq('status', 'published')
        ])

        const urls: MetadataRoute.Sitemap = [
          {
            url: baseUrl,
            lastModified: new Date(),
            changeFrequency: 'daily',
            priority: 1.0,
          },
          {
            url: `${baseUrl}/properties`,
            lastModified: new Date(),
            changeFrequency: 'daily',
            priority: 0.9,
          }
        ]

        if (landingPages) {
          landingPages.forEach(lp => {
            if (lp.slug && lp.slug !== 'index') {
              urls.push({
                url: `${baseUrl}/${lp.slug}`,
                lastModified: lp.updated_at ? new Date(lp.updated_at) : new Date(),
                changeFrequency: 'weekly',
                priority: 0.85,
              })
            }
          })
        }

        if (properties) {
          properties.forEach(p => {
            urls.push({
              url: `${baseUrl}/properties/${p.id}`,
              lastModified: p.updated_at ? new Date(p.updated_at) : new Date(),
              changeFrequency: 'weekly',
              priority: 0.8,
            })
          })
        }

        if (posts) {
          posts.forEach(p => {
            urls.push({
              url: `${baseUrl}?post=${p.id}`,
              lastModified: p.updated_at ? new Date(p.updated_at) : new Date(),
              changeFrequency: 'weekly',
              priority: 0.7,
            })
          })
        }

        return urls
      }
    } catch (e) {
      console.error("[Sitemap API] Failed to build custom domain sitemap:", e)
    }

    // Tenant fallback
    return [
      {
        url: baseUrl,
        lastModified: new Date(),
        changeFrequency: 'daily',
        priority: 1.0,
      }
    ]
  }

  // Primary platform domain - index standard platform routes + shared catalogues
  const platformUrls: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1.0,
    },
    {
      url: `${baseUrl}/login`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${baseUrl}/privacy-policy`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.3,
    },
    {
      url: `${baseUrl}/terms-and-conditions`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.3,
    },
    {
      url: `${baseUrl}/refund-policy`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.3,
    },
  ]

  // Add shared catalogue pages for all active business profiles
  try {
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data: activeProfiles } = await supabaseAdmin
      .from('profiles')
      .select('id, updated_at, business_name')
      .not('business_name', 'is', null)
      .neq('business_name', '')
      .in('role', ['super_admin', 'agency', 'admin', 'client'])

    if (activeProfiles && activeProfiles.length > 0) {
      for (const profile of activeProfiles) {
        platformUrls.push({
          url: `${baseUrl}/shared/${profile.id}`,
          lastModified: profile.updated_at ? new Date(profile.updated_at) : new Date(),
          changeFrequency: 'weekly',
          priority: 0.6,
        })
        platformUrls.push({
          url: `${baseUrl}/shared/${profile.id}/properties`,
          lastModified: profile.updated_at ? new Date(profile.updated_at) : new Date(),
          changeFrequency: 'weekly',
          priority: 0.6,
        })
      }

      // Also add active properties for platform domain
      const { data: allActiveProperties } = await supabaseAdmin
        .from('properties')
        .select('id, user_id, updated_at')
        .neq('status', 'Archived')
        .neq('status', 'Sold')
        .limit(200)

      if (allActiveProperties) {
        allActiveProperties.forEach(p => {
          platformUrls.push({
            url: `${baseUrl}/shared/${p.user_id}/properties/${p.id}`,
            lastModified: p.updated_at ? new Date(p.updated_at) : new Date(),
            changeFrequency: 'weekly',
            priority: 0.5,
          })
        })
      }
    }
  } catch (e) {
    console.error('[Sitemap] Error fetching shared catalogue profiles:', e)
  }

  return platformUrls
}
