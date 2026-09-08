export async function GET() {
  const robotsTxt = `User-agent: *
Allow: /

Sitemap: https://bioqueestatesinternational.com/sitemap.xml
`;
  return new Response(robotsTxt.trim(), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8'
    }
  });
}
