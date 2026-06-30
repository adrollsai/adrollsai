import { MetadataRoute } from 'next'
import { headers } from 'next/headers'

export default async function robots(): Promise<MetadataRoute.Robots> {
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
