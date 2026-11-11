/**
 * Deterministic business website builder.
 *
 * The manual generator (`/api/landing-page/generate`) uses an LLM inside the
 * request and routinely exceeds its 60s budget, which left tenants on a
 * self-refreshing placeholder forever. This builder needs no model: it renders a
 * clean, mobile-first page from data the tenant already has, so it can run
 * unattended in a cron and never time out.
 *
 * Tenants who want the fully art-directed version can still press "Generate" in
 * Dashboard → Pages; this exists so that "your website is ready" is true.
 */

export interface SiteProfile {
  id: string
  business_name?: string | null
  business_info?: string | null
  logo_url?: string | null
  brand_color?: string | null
  contact_number?: string | null
  whatsapp_phone_number?: string | null
  address?: string | null
  email?: string | null
  mission_statement?: string | null
  custom_domain?: string | null
}

export interface SiteProperty {
  id: string
  title?: string | null
  address?: string | null
  price?: string | null
  description?: string | null
  image_url?: string | null
  images?: string[] | null
  status?: string | null
  configurations?: string | null
  youtube_url?: string | null
}

const esc = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

function waLink(phone: string | null | undefined, text: string): string {
  const digits = String(phone || '').replace(/\D/g, '')
  if (!digits) return ''
  const intl = digits.length === 10 ? `91${digits}` : digits
  return `https://wa.me/${intl}?text=${encodeURIComponent(text)}`
}

function propertyImage(p: SiteProperty): string | null {
  if (p.image_url) return p.image_url
  if (Array.isArray(p.images) && p.images.length) return p.images[0]
  return null
}

export function buildSiteHtml(profile: SiteProfile, properties: SiteProperty[]): string {
  const brand = (profile.brand_color || '#C9A227').trim() || '#C9A227'
  const biz = esc(profile.business_name || 'Our Business')
  const tagline = esc(profile.mission_statement || 'Verified listings, honest advice, and site visits that actually happen.')
  const about = esc(profile.business_info || '')
  const phone = (profile.whatsapp_phone_number || profile.contact_number || '').trim()
  const address = esc(profile.address || '')
  const email = esc(profile.email || '')
  const logo = profile.logo_url ? esc(profile.logo_url) : ''

  const cards = properties
    .filter((p) => !p.status || !['Archived', 'Sold'].includes(p.status))
    .map((p) => {
      const img = propertyImage(p)
      const enquiry = waLink(phone, `Hi, I'm interested in ${p.title || 'a listing'} on your website.`)
      return `
      <article class="card">
        ${img ? `<img src="${esc(img)}" alt="${esc(p.title)}" loading="lazy" />` : `<div class="noimg"></div>`}
        <div class="card-body">
          <h3>${esc(p.title || 'Listing')}</h3>
          ${p.price ? `<p class="price">${esc(p.price)}</p>` : ''}
          ${p.address ? `<p class="muted">${esc(p.address)}</p>` : ''}
          ${p.description ? `<p class="desc">${esc(String(p.description).slice(0, 220))}</p>` : ''}
          ${enquiry ? `<a class="cta sm" href="${enquiry}" target="_blank" rel="noopener">Enquire on WhatsApp</a>` : ''}
        </div>
      </article>`
    })
    .join('')

  const heroWa = waLink(phone, `Hi ${profile.business_name || ''}, I'd like to know more about your listings.`)

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${biz}</title>
<meta name="description" content="${tagline}" />
<style>
  :root { --brand: ${brand}; --ink:#0d1117; --muted:#6b7280; --line:#e8e8ec; }
  *{box-sizing:border-box}
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;color:var(--ink);background:#fff;line-height:1.55}
  .wrap{max-width:1080px;margin:0 auto;padding:0 18px}
  header{border-bottom:1px solid var(--line)}
  .bar{display:flex;align-items:center;gap:12px;padding:16px 0}
  .bar img{height:40px;width:auto;border-radius:8px}
  .bar h1{font-size:18px;margin:0;letter-spacing:-.2px}
  .hero{padding:44px 0 34px}
  .hero h2{font-size:32px;line-height:1.2;margin:0 0 10px;letter-spacing:-.6px}
  .hero p{color:var(--muted);margin:0 0 20px;max-width:56ch}
  .cta{display:inline-block;background:var(--brand);color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600;font-size:15px}
  .cta.sm{padding:9px 16px;font-size:13px;margin-top:12px}
  grid-l{display:block}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:20px;padding:10px 0 48px}
  .card{border:1px solid var(--line);border-radius:16px;overflow:hidden;background:#fff;display:flex;flex-direction:column}
  .card img,.noimg{width:100%;aspect-ratio:4/3;object-fit:cover;display:block;background:#f3f4f6}
  .card-body{padding:16px}
  .card h3{font-size:16px;margin:0 0 6px}
  .price{font-weight:700;color:var(--brand);margin:0 0 6px}
  .muted{color:var(--muted);font-size:13px;margin:0 0 6px}
  .desc{color:#374151;font-size:13px;margin:0}
  .about{padding:28px 0;border-top:1px solid var(--line)}
  footer{padding:26px 0 44px;border-top:1px solid var(--line);color:var(--muted);font-size:13px}
  footer a{color:var(--brand)}
  @media(min-width:768px){ .hero h2{font-size:44px} }
</style>
</head>
<body>
<header><div class="wrap bar">
  ${logo ? `<img src="${logo}" alt="${biz}" />` : ''}
  <h1>${biz}</h1>
</div></header>

<section class="wrap hero">
  <h2>${tagline}</h2>
  ${heroWa ? `<a class="cta" href="${heroWa}" target="_blank" rel="noopener">Chat with us on WhatsApp</a>` : ''}
</section>

<main class="wrap">
  ${cards ? `<div class="grid">${cards}</div>` : `<p class="muted">Listings are being added.</p>`}
  ${about ? `<section class="about"><h2 style="font-size:20px;margin:0 0 8px">About ${biz}</h2><p style="margin:0;color:#374151">${about}</p></section>` : ''}
</main>

<footer><div class="wrap">
  ${address ? `<p style="margin:0 0 6px">${address}</p>` : ''}
  ${phone ? `<p style="margin:0 0 6px">Phone / WhatsApp: <a href="tel:${esc(phone)}">${esc(phone)}</a></p>` : ''}
  ${email ? `<p style="margin:0 0 6px"><a href="mailto:${email}">${email}</a></p>` : ''}
  <p style="margin:12px 0 0;opacity:.7">&copy; ${new Date().getFullYear()} ${biz}. All rights reserved.</p>
</div></footer>
</body>
</html>`
}

/**
 * Build (or refresh) a tenant's site row. Returns the slug on success.
 * Skips when the tenant has no business name yet — an empty shell is worse
 * than nothing, because it would then never regenerate.
 */
export async function ensureTenantSite(
  supabaseAdmin: any,
  userId: string,
  opts: { force?: boolean } = {}
): Promise<{ created: boolean; skipped?: string }> {
  const { data: profile, error: pErr } = await supabaseAdmin
    .from('profiles')
    .select('id, business_name, business_info, logo_url, brand_color, contact_number, whatsapp_phone_number, address, email, mission_statement, custom_domain')
    .eq('id', userId)
    .single()

  if (pErr || !profile) return { created: false, skipped: 'profile_not_found' }
  if (!profile.business_name || !String(profile.business_name).trim()) {
    return { created: false, skipped: 'no_business_name' }
  }

  // Never clobber a page the tenant generated or edited themselves.
  const { data: existing } = await supabaseAdmin
    .from('landing_pages')
    .select('id, html_content')
    .eq('user_id', userId)
    .eq('slug', 'index')
    .maybeSingle()

  if (existing && !opts.force) {
    return { created: false, skipped: 'already_exists' }
  }

  const { data: props } = await supabaseAdmin
    .from('properties')
    .select('id, title, address, price, description, image_url, images, status, configurations, youtube_url')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(24)

  const html = buildSiteHtml(profile as SiteProfile, (props || []) as SiteProperty[])

  const { error: upErr } = await supabaseAdmin
    .from('landing_pages')
    .upsert(
      {
        user_id: userId,
        slug: 'index',
        title: profile.business_name,
        product_name: profile.business_name,
        html_content: html,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,slug' }
    )

  if (upErr) return { created: false, skipped: `upsert_failed:${upErr.message}` }
  return { created: true }
}
