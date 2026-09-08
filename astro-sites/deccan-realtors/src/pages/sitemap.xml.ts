import { getDeccanProperties } from '../lib/supabase';

export async function GET() {
  const properties = await getDeccanProperties();
  const baseUrl = 'https://deccanrealtors.com';

  const staticPages = [
    '',
    '/properties',
    '/about',
    '/services',
    '/calculator',
    '/contact'
  ];

  const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${staticPages.map(page => `
    <url>
      <loc>${baseUrl}${page}</loc>
      <lastmod>${new Date().toISOString()}</lastmod>
      <changefreq>${page === '' ? 'daily' : 'weekly'}</changefreq>
      <priority>${page === '' ? '1.0' : '0.8'}</priority>
    </url>
  `).join('')}
  ${properties.map(p => `
    <url>
      <loc>${baseUrl}/properties/${p.id}</loc>
      <lastmod>${p.created_at ? new Date(p.created_at).toISOString() : new Date().toISOString()}</lastmod>
      <changefreq>daily</changefreq>
      <priority>0.9</priority>
    </url>
  `).join('')}
</urlset>`;

  return new Response(sitemapXml.trim(), {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8'
    }
  });
}
