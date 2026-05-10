import { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: '/dashboard/', // Keep private dashboard out of search results
    },
    sitemap: 'https://app.adrolls.in/sitemap.xml',
  }
}
