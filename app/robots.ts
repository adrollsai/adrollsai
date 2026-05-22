import { MetadataRoute } from 'next'
import { headers } from 'next/headers'

export default async function robots(): Promise<MetadataRoute.Robots> {
  const headersList = await headers()
  const rawHost = headersList.get('x-forwarded-host') || headersList.get('host') || 'adrolls.in'
  const host = rawHost.split(':')[0]

  const mainDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'adrolls.in'
  const isPlatform = host.includes(mainDomain) || 
                     host.includes('localhost') || 
                     host.includes('vercel.app') || 
                     host.includes('ngrok-free.dev')

  const protocol = host.includes('localhost') || host.includes('ngrok') ? 'http' : 'https'
  const sitemapUrl = `${protocol}://${host}/sitemap.xml`

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: isPlatform ? '/dashboard/' : ['/login', '/dashboard/'],
    },
    sitemap: sitemapUrl,
  }
}
