import fs from 'node:fs'
import path from 'node:path'

/**
 * Template-backed, server-rendered website builder.
 *
 * Uses the real `public/real-estate-template/index.html` (the 16-page
 * Everline Realty template) rather than inventing markup, and bakes the tenant's
 * data into the HTML at build time. That matters for two reasons:
 *
 *  1. SEO. The template hydrates listings client-side from /api/public/website-data,
 *     so a crawler saw almost no content. Everything here is in the HTML: real
 *     <h1>/<h2>, real listing text, real links, canonical, Open Graph and
 *     JSON-LD structured data.
 *  2. Branding. `window.SITE` is overridden before app.js runs, so the header,
 *     footer, phone numbers and CTAs are the tenant's without touching the JS.
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
  whitelabel_domain?: string | null
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
  property_type?: string | null
  configurations?: string | null
}

const TEMPLATE_REL = path.join('public', 'real-estate-template', 'index.html')

let templateCache: string | null = null

export function loadTemplate(): string {
  if (templateCache) return templateCache
  const abs = path.join(process.cwd(), TEMPLATE_REL)
  templateCache = fs.readFileSync(abs, 'utf8')
  return templateCache
}

const esc = (v: unknown): string =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

/** JSON safe to inline inside a <script> block. */
const jsonForHtml = (v: unknown): string =>
  JSON.stringify(v)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')

function digits(phone?: string | null): string {
  const d = String(phone || '').replace(/\D/g, '')
  if (!d) return ''
  return d.length === 10 ? `91${d}` : d
}

/** Platform origin, used only for canonical/og URLs. Empty when unknown. */
function platformOrigin(): string {
  const explicit = (process.env.NEXT_PUBLIC_APP_URL || '').trim()
  if (explicit) return explicit.replace(/\/$/, '')
  const root = (process.env.NEXT_PUBLIC_ROOT_DOMAIN || '').trim()
  if (root) return `https://${root.replace(/^https?:\/\//, '').replace(/\/$/, '')}`
  return ''
}

export function siteBaseUrl(profile: SiteProfile): string {
  const host = (profile.custom_domain || profile.whitelabel_domain || '')
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
  if (host) return `https://${host}`
  const rel = `/shared/${profile.id}/index`
  const origin = platformOrigin()
  return origin ? `${origin}${rel}` : rel
}

/**
 * Template assets live in `public/` and are served on ANY host — platform domain
 * or tenant custom domain — so they are referenced by a relative path and the
 * template's own <base href> resolves them.
 *
 * An earlier version rewrote this to an absolute NEXT_PUBLIC_APP_URL, which meant
 * every custom-domain site rendered completely unstyled whenever that env var was
 * missing or wrong. Rendering must not depend on configuration.
 */
const ASSET_PATH = '/real-estate-template/'

function propertyImage(p: SiteProperty): string | null {
  if (p.image_url) return p.image_url
  if (Array.isArray(p.images) && p.images.length) return p.images[0]
  return null
}

function activeProperties(properties: SiteProperty[]): SiteProperty[] {
  return properties.filter((p) => !p.status || !['Archived', 'Sold'].includes(p.status))
}

export interface BuildSiteOptions {
  /** Override the canonical/base URL (e.g. for preview builds). */
  baseUrl?: string
}

export function buildSiteHtml(
  profile: SiteProfile,
  properties: SiteProperty[],
  opts: BuildSiteOptions = {}
): string {
  let html = loadTemplate()

  const brandName = (profile.business_name || 'Our Business').trim()

  // Scrub the template's demo identity out of the static markup BEFORE injecting
  // anything of ours. app.js renders header/footer from window.SITE, but the raw
  // HTML still carries "Everline Realty" in text nodes, alt text and attributes —
  // which a crawler reads.
  html = html
    .replace(/Everline Realty/g, brandName)
    .replace(/Everline/g, brandName)
    .replace(/everlinerealty\.com/g, '')

  const tagline = (profile.mission_statement || 'Verified listings. Honest advice. Site visits that actually happen.').trim()
  const description = (profile.business_info || tagline).replace(/\s+/g, ' ').trim().slice(0, 158)
  const phone = (profile.contact_number || profile.whatsapp_phone_number || '').trim()
  const wa = digits(profile.whatsapp_phone_number || profile.contact_number)
  const email = (profile.email || '').trim()
  const address = (profile.address || '').trim()
  const city = address.split(',').slice(-1)[0]?.trim() || ''
  const canonical = (opts.baseUrl || siteBaseUrl(profile)).replace(/\/$/, '')
  // Absolute origin for social images (crawlers need absolute URLs); falls back
  // to a relative path rather than inventing a domain we cannot verify.
  const originMatch = canonical.match(/^https?:\/\/[^/]+/i)
  const origin = originMatch ? originMatch[0] : ''
  const absAsset = `${origin}${ASSET_PATH}`
  const assets = ASSET_PATH
  const logo = profile.logo_url || `${absAsset}assets/img/logo-mark.svg`
  const ogImage = activeProperties(properties).map(propertyImage).find(Boolean) || `${absAsset}assets/img/og-cover.svg`

  const props = activeProperties(properties)
  const propertyBase = canonical.includes('/shared/')
    ? canonical.replace(/\/index$/, '')
    : canonical

  /* ---------------- head: title, description, canonical, social ------- */
  html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${esc(brandName)}${city ? ` — ${esc(city)}` : ''} | Property Listings &amp; Site Visits</title>`)
  html = html.replace(
    /<meta name="description" content="[^"]*">/i,
    `<meta name="description" content="${esc(description)}">`
  )
  html = html.replace(/<link rel="canonical" href="[^"]*">/i, `<link rel="canonical" href="${esc(canonical)}">`)

  const socialTags = `
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(brandName)}">
<meta property="og:title" content="${esc(brandName)}${city ? ` — ${esc(city)}` : ''}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(ogImage)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(brandName)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(ogImage)}">
${profile.brand_color ? `<meta name="theme-color" content="${esc(profile.brand_color)}">` : ''}
<link rel="icon" href="${esc(logo)}">
`

  // Replace the template's demo social block (og:type .. theme-color run)
  html = html.replace(
    /<meta property="og:type"[\s\S]*?<link rel="icon"[^>]*>/i,
    socialTags.trim()
  )

  /* ---------------- JSON-LD structured data --------------------------- */
  const listingSchema = props.slice(0, 20).map((p) => ({
    '@type': 'Product',
    name: p.title || 'Listing',
    description: (p.description || '').replace(/\s+/g, ' ').slice(0, 300) || undefined,
    image: propertyImage(p) || undefined,
    url: `${propertyBase}/properties/${p.id}`,
    ...(p.price
      ? {
          offers: {
            '@type': 'Offer',
            price: String(p.price).replace(/[^\d.]/g, '') || undefined,
            priceCurrency: 'INR',
            availability: 'https://schema.org/InStock',
            url: `${propertyBase}/properties/${p.id}`,
          },
        }
      : {}),
  }))

  const orgSchema = {
    '@context': 'https://schema.org',
    '@type': 'RealEstateAgent',
    name: brandName,
    description: profile.business_info || tagline,
    url: canonical,
    image: ogImage,
    logo,
    ...(phone ? { telephone: phone } : {}),
    ...(email ? { email } : {}),
    ...(address
      ? {
          address: {
            '@type': 'PostalAddress',
            streetAddress: address,
            ...(city ? { addressLocality: city } : {}),
            addressCountry: 'IN',
          },
        }
      : {}),
    ...(props.length ? { makesOffer: listingSchema } : {}),
  }

  html = html.replace(
    /<script type="application\/ld\+json">[\s\S]*?<\/script>/gi,
    (block) =>
      /"@type"\s*:\s*"RealEstateAgent"/i.test(block)
        ? `<script type="application/ld+json">${jsonForHtml(orgSchema)}</script>`
        : block
  )

  /* ---------------- window.SITE override, BEFORE app.js --------------- */
  const siteOverride = `
<script>
(function () {
  var base = window.SITE || {};
  window.SITE = Object.assign({}, base, {
    brand: Object.assign({}, base.brand, ${jsonForHtml({
      name: brandName,
      suffix: '',
      tagline,
      mark: logo,
      license: '',
      founded: undefined,
    })}),
    contact: Object.assign({}, base.contact, ${jsonForHtml({
      phone,
      phoneDisplay: phone,
      sms: phone,
      whatsapp: wa,
      email,
      emailSales: email,
      address: { line1: address, line2: '', street: address, mapsQuery: address },
      responsePromise: 'We reply to every enquiry within 1 business hour.',
    })})
  });
})();
</script>
`

  // Inject immediately before app.js so the renderer picks up tenant branding.
  // Locate by string index — a regex missed tags with extra attributes and
  // silently fell back to appending after app.js, which made the override a no-op.
  const appJsIdx = html.indexOf('assets/js/app.js')
  if (appJsIdx > -1) {
    const tagStart = html.lastIndexOf('<script', appJsIdx)
    if (tagStart > -1) {
      html = html.slice(0, tagStart) + siteOverride + '\n' + html.slice(tagStart)
    } else {
      html = html.replace(/<\/body>/i, `${siteOverride}\n</body>`)
    }
  } else {
    html = html.replace(/<\/body>/i, `${siteOverride}\n</body>`)
  }

  /* ---------------- server-rendered crawlable content ----------------- */
  const cards = props
    .slice(0, 24)
    .map((p) => {
      const img = propertyImage(p)
      const href = `${propertyBase}/properties/${p.id}`
      return `<article class="seo-card">
  <a href="${esc(href)}">
    ${img ? `<img src="${esc(img)}" alt="${esc(p.title || 'Property')}${city ? ` in ${esc(city)}` : ''}" loading="lazy" width="480" height="360">` : ''}
    <h3>${esc(p.title || 'Listing')}</h3>
  </a>
  ${p.price ? `<p class="seo-price">${esc(p.price)}</p>` : ''}
  ${p.address ? `<p class="seo-muted">${esc(p.address)}</p>` : ''}
  ${p.description ? `<p>${esc(String(p.description).replace(/\s+/g, ' ').slice(0, 240))}</p>` : ''}
</article>`
    })
    .join('\n')

  const serverContent = `
<section id="nobogent-server-content" aria-labelledby="nobogent-h1" style="max-width:1180px;margin:0 auto;padding:48px 20px;">
  <h1 id="nobogent-h1" style="font-size:34px;line-height:1.15;margin:0 0 10px;">${esc(brandName)}${city ? ` — Property Listings in ${esc(city)}` : ''}</h1>
  <p style="margin:0 0 18px;max-width:62ch;">${esc(tagline)}</p>
  ${address ? `<address style="font-style:normal;margin:0 0 6px;">${esc(address)}</address>` : ''}
  ${phone ? `<p style="margin:0 0 6px;">Call or WhatsApp: <a href="tel:${esc(phone)}">${esc(phone)}</a></p>` : ''}
  ${wa ? `<p style="margin:0 0 22px;"><a href="https://wa.me/${esc(wa)}" rel="noopener">Chat with us on WhatsApp</a></p>` : ''}
  ${props.length ? `<h2 style="font-size:24px;margin:26px 0 14px;">Current listings (${props.length})</h2>
  <div class="seo-grid">${cards}</div>` : ''}
</section>
<style>
  .seo-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:20px}
  .seo-card{border:1px solid rgba(0,0,0,.12);border-radius:14px;padding:14px;background:#fff}
  .seo-card img{width:100%;height:auto;border-radius:10px;display:block;margin-bottom:10px}
  .seo-card h3{font-size:16px;margin:0 0 6px}
  .seo-card a{text-decoration:none;color:inherit}
  .seo-price{font-weight:700;margin:0 0 6px}
  .seo-muted{opacity:.75;font-size:13px;margin:0 0 6px}
</style>
`

  if (/<main[^>]*>/i.test(html)) {
    html = html.replace(/(<main[^>]*>)/i, `$1\n${serverContent}`)
  } else {
    html = html.replace(/<body[^>]*>/i, (m) => `${m}\n${serverContent}`)
  }

  return html
}

/**
 * Build (or refresh) one tenant's site row.
 * Fast and idempotent: safe to call from a job worker, never long-running.
 */
export async function ensureTenantSite(
  supabaseAdmin: any,
  userId: string,
  opts: { force?: boolean } = {}
): Promise<{ created: boolean; skipped?: string; bytes?: number }> {
  const { data: profile, error: pErr } = await supabaseAdmin
    .from('profiles')
    .select('id, business_name, business_info, logo_url, brand_color, contact_number, whatsapp_phone_number, address, email, mission_statement, custom_domain, whitelabel_domain')
    .eq('id', userId)
    .single()

  if (pErr || !profile) return { created: false, skipped: 'profile_not_found' }
  if (!String(profile.business_name || '').trim()) return { created: false, skipped: 'no_business_name' }

  // Never clobber a page the tenant generated or edited themselves.
  const { data: existing } = await supabaseAdmin
    .from('landing_pages')
    .select('id, html_content')
    .eq('user_id', userId)
    .eq('slug', 'index')
    .maybeSingle()

  if (existing && !opts.force) {
    const live = String(existing.html_content || '')
    // A stuck spinner placeholder from the old LLM path is safe to replace.
    if (live.includes('nobogent-server-content') || live.includes('http-equiv="refresh"') || live.length < 500) {
      // fall through and rebuild
    } else {
      return { created: false, skipped: 'already_exists' }
    }
  }

  const { data: props } = await supabaseAdmin
    .from('properties')
    .select('id, title, address, price, description, image_url, images, status, property_type, configurations')
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
  return { created: true, bytes: html.length }
}
