import { MetadataRoute } from 'next'
import { headers } from 'next/headers'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const headersList = await headers()
  const rawHost = headersList.get('x-forwarded-host') || headersList.get('host') || 'adrolls.in'
  const host = rawHost.split(':')[0]

  const mainDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'adrolls.in'
  const isPlatform = host.includes(mainDomain) || 
                     host.includes('localhost') || 
                     host.includes('vercel.app') || 
                     host.includes('ngrok-free.dev')

  const protocol = host.includes('localhost') || host.includes('ngrok') ? 'http' : 'https'
  const baseUrl = `${protocol}://${host}`

  if (!isPlatform) {
    // Custom tenant domain - index catalog home only
    return [
      {
        url: baseUrl,
        lastModified: new Date(),
        changeFrequency: 'daily',
        priority: 1.0,
      }
    ]
  }

  // Primary platform domain - index standard platform routes
  return [
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
}
