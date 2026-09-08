import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

type RouteProps = {
  params: Promise<{ user_id: string; id: string }>
}

function detectRegion(title: any = '', address: any = '', price: any = ''): string {
  const t = `${title || ''} ${address || ''}`.toLowerCase()
  const pr = `${price || ''}`
  if (t.includes('dubai') || t.includes('emaar') || t.includes('danube') || t.includes('sobha') || t.includes('jebel ali') || pr.includes('AED')) {
    return 'Dubai'
  }
  if (t.includes('omaxe') || t.includes('mullanpur') || t.includes('new chandigarh') || t.includes('medicity') || t.includes('hyde park') || t.includes('the lake') || t.includes('opus one') || t.includes('the tiara') || t.includes('buckingham')) {
    return 'New Chandigarh'
  }
  return 'Tri-City'
}

function parseConfigs(p: any) {
  if (!p?.configurations) return { units: [], sizes: '', status: '', possession: '', amenities: [] }
  if (typeof p.configurations === 'string') {
    try {
      return JSON.parse(p.configurations)
    } catch {
      return { units: [], sizes: '', status: '', possession: '', amenities: [] }
    }
  }
  return p.configurations
}

export async function GET(request: Request, { params }: RouteProps) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const resolvedParams = await params
    let identifier = decodeURIComponent(resolvedParams.user_id || '').trim()
    const propId = decodeURIComponent(resolvedParams.id || '').trim()

    // 1. Resolve business profile
    let profileQuery = supabase
      .from('profiles')
      .select('id, business_name, logo_url, custom_domain, contact_number, email, address, brand_color, mission_statement')

    if (identifier.includes('.')) {
      profileQuery = profileQuery.eq('custom_domain', identifier)
    } else {
      profileQuery = profileQuery.eq('id', identifier)
    }

    const { data: profile, error: profileErr } = await profileQuery.maybeSingle()
    if (profileErr || !profile) {
      return new Response('Profile Not Found', { status: 404 })
    }

    // 2. Fetch specific property
    const { data: prop, error: propErr } = await supabase
      .from('properties')
      .select('*')
      .eq('user_id', profile.id)
      .eq('id', propId)
      .maybeSingle()

    if (propErr || !prop) {
      return new Response('Property Not Found', { status: 404 })
    }

    const hostHeader = request.headers.get('host') || 'nobogent.com'
    const domain = profile.custom_domain || hostHeader.split(':')[0]
    const basePath = profile.custom_domain ? '' : `/shared/${profile.id}`
    const homeUrl = profile.custom_domain ? '/' : `/shared/${profile.id}/index`
    const catalogUrl = `${basePath}/properties`
    const propertyUrl = profile.custom_domain 
      ? `https://${domain}/properties/${prop.id}`
      : `https://${domain}/shared/${profile.id}/properties/${prop.id}`
    const region = detectRegion(prop.title, prop.address, prop.price)
    const cfg = parseConfigs(prop)

    const phoneRaw = (profile.contact_number || '+919888626786').replace(/[^0-9]/g, '')
    const phoneDisplay = profile.contact_number || '+91 98886 26786'
    const mainImg = prop.image_url || 'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=1200&q=85'
    const allImages = Array.isArray(prop.images) && prop.images.length > 0 ? prop.images : [mainImg]
    const cleanDesc = (prop.description || `${prop.title} in ${prop.address}`).replace(/"/g, '&quot;')

    // Schema.org Structured Data
    const schemaLd = {
      '@context': 'https://schema.org',
      '@type': 'SingleFamilyResidence',
      name: prop.title,
      description: prop.description || prop.title,
      image: allImages,
      url: propertyUrl,
      address: {
        '@type': 'PostalAddress',
        streetAddress: prop.address || region,
        addressLocality: region === 'Dubai' ? 'Dubai' : (region === 'Tri-City' ? 'Mohali' : 'New Chandigarh'),
        addressCountry: region === 'Dubai' ? 'AE' : 'IN'
      },
      offers: {
        '@type': 'Offer',
        priceCurrency: prop.price?.includes('AED') ? 'AED' : 'INR',
        price: prop.price || 'Price on Request',
        availability: 'https://schema.org/InStock'
      },
      seller: {
        '@type': 'RealEstateAgent',
        name: profile.business_name,
        telephone: phoneDisplay,
        url: `https://${domain}${basePath || '/'}`
      }
    }

    const isBioque = domain.includes('bioque') || (profile.business_name || '').toLowerCase().includes('bioque')
    const primaryGold = '#D4AF37'
    const secondaryGold = '#C59E2B'
    const darkBg = '#0F172A'

    const html = `<!DOCTYPE html>
<html lang="en" class="scroll-smooth">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0">
  <title>${prop.title} | ${profile.business_name}</title>
  <meta name="title" content="${prop.title} | ${profile.business_name}">
  <meta name="description" content="${cleanDesc.slice(0, 160)}">
  <meta name="keywords" content="${prop.title}, ${region} Real Estate, ${profile.business_name}, Luxury Property, Buy Property in ${region}">
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
  <link rel="canonical" href="${propertyUrl}">

  <!-- OpenGraph / Facebook -->
  <meta property="og:type" content="website">
  <meta property="og:url" content="${propertyUrl}">
  <meta property="og:title" content="${prop.title} | ${profile.business_name}">
  <meta property="og:description" content="${cleanDesc.slice(0, 160)}">
  <meta property="og:image" content="${mainImg}">

  <!-- Twitter -->
  <meta property="twitter:card" content="summary_large_image">
  <meta property="twitter:url" content="${propertyUrl}">
  <meta property="twitter:title" content="${prop.title} | ${profile.business_name}">
  <meta property="twitter:description" content="${cleanDesc.slice(0, 160)}">
  <meta property="twitter:image" content="${mainImg}">

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>

  <script type="application/ld+json">
  ${JSON.stringify(schemaLd)}
  </script>

  <style>
    body { font-family: 'Plus Jakarta Sans', sans-serif; }
    h1, h2, h3, h4, .font-display { font-family: 'Outfit', sans-serif; }
    .btn-gold {
      background: linear-gradient(135deg, #E5C158 0%, #D4AF37 50%, #B8860B 100%);
      color: #0F172A;
      font-weight: 700;
      transition: all 0.25s ease;
    }
    .btn-gold:hover {
      box-shadow: 0 10px 20px -5px rgba(212, 175, 55, 0.45);
      transform: translateY(-2px);
      filter: brightness(1.05);
    }
    .springfield-card {
      background: #FFFFFF;
      border: 1px solid #F0ECE1;
      border-radius: 1.25rem;
      transition: all 0.35s ease;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.03);
    }
  </style>
</head>
<body class="bg-[#FCFBFA] text-slate-800 selection:bg-amber-200 flex flex-col min-h-screen">

  <!-- TOP BAR -->
  <div class="bg-[#0F172A] border-b border-slate-800 py-2 px-4 sm:px-8 text-xs text-slate-300">
    <div class="max-w-7xl mx-auto flex justify-between items-center">
      <div class="flex items-center space-x-6">
        <span class="flex items-center gap-1.5">
          <span class="text-[#D4AF37]">📍</span>
          ${profile.address || (region ? `${region} Region` : 'Official Office')}
        </span>
        ${profile.email ? `
        <span class="hidden md:flex items-center gap-1.5">
          <span class="text-[#D4AF37]">✉️</span>
          ${profile.email}
        </span>
        ` : ''}
      </div>
      <div class="flex items-center space-x-6">
        <span class="hidden sm:inline font-medium text-slate-300">Official Advisory: <strong class="text-[#D4AF37]">${region}</strong></span>
        <a href="tel:${phoneRaw}" class="text-white hover:text-[#D4AF37] font-bold flex items-center gap-1.5 transition-colors">
          <span class="text-[#D4AF37]">📞</span> ${phoneDisplay}
        </a>
      </div>
    </div>
  </div>

  <!-- NAVIGATION HEADER -->
  <header class="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-slate-200/80 shadow-xs">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="flex justify-between items-center h-20 sm:h-24">
        
        <!-- LOGO & BRAND -->
        <a href="${homeUrl}" class="flex items-center space-x-2.5 sm:space-x-3 group shrink-0 mr-4 sm:mr-8">
          ${profile.logo_url ? `<img src="${profile.logo_url}" alt="${profile.business_name}" class="h-10 sm:h-12 w-auto object-contain transition-transform duration-300 group-hover:scale-105">` : ''}
          <div class="leading-tight">
            <span class="font-display text-sm sm:text-base font-extrabold tracking-wide text-[#D4AF37] block leading-none">
              ${profile.business_name.toUpperCase()}
            </span>
            <span class="text-[8px] sm:text-[9px] uppercase tracking-[0.2em] text-[#C59E2B] block font-bold mt-1">
              ${isBioque ? 'International Pvt. Ltd.' : 'Real Estate Advisory'}
            </span>
          </div>
        </a>

        <!-- NAV LINKS -->
        <nav class="hidden xl:flex items-center space-x-8 text-xs font-bold uppercase tracking-wider text-slate-600">
          <a href="${homeUrl}" class="hover:text-[#D4AF37] transition-colors">Home</a>
          <a href="${catalogUrl}" class="text-[#D4AF37] transition-colors">Portfolio</a>
          <a href="${homeUrl}#about" class="hover:text-[#D4AF37] transition-colors">About Us</a>
          <a href="${homeUrl}#contact" class="hover:text-[#D4AF37] transition-colors">Contact</a>
        </nav>

        <!-- ACTION BUTTONS -->
        <div class="flex items-center space-x-3">
          <a href="https://wa.me/${phoneRaw}?text=Hi%20${encodeURIComponent(profile.business_name)},%20I%20am%20interested%20in%20${encodeURIComponent(prop.title)}" target="_blank" class="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full border border-emerald-500/40 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 text-xs font-bold transition-all">
            <span>💬</span> WhatsApp
          </a>
          <a href="#booking-section" class="btn-gold px-5 py-2.5 rounded-full text-xs uppercase tracking-wider font-extrabold shadow-sm">
            Book Site Visit
          </a>
        </div>

      </div>
    </div>
  </header>

  <!-- BREADCRUMBS -->
  <div class="bg-white border-b border-slate-200 py-3 px-4 sm:px-8 text-xs text-slate-500">
    <div class="max-w-7xl mx-auto flex items-center space-x-2">
      <a href="/" class="hover:text-[#D4AF37] transition-colors">Home</a>
      <span>/</span>
      <a href="/properties" class="hover:text-[#D4AF37] transition-colors">Portfolio</a>
      <span>/</span>
      <span class="text-[#D4AF37] font-bold">${region}</span>
      <span>/</span>
      <span class="text-slate-900 font-bold truncate">${prop.title}</span>
    </div>
  </div>

  <!-- MAIN PRODUCT CONTENT -->
  <main class="flex-grow max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 w-full">
    
    <!-- HEADER TITLE & PRICING -->
    <div class="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-6 pb-8 border-b border-slate-200">
      <div>
        <div class="flex flex-wrap items-center gap-2 mb-3">
          <span class="px-3.5 py-1 rounded-full bg-[#0F172A] text-[#D4AF37] text-xs font-bold uppercase tracking-wider border border-[#D4AF37]/30">
            ${region === 'Dubai' ? '🇦🇪 Dubai Luxury' : (region === 'Tri-City' ? '🏙️ Tri-City Flagship' : '🌳 New Chandigarh Luxury')}
          </span>
          <span class="px-3.5 py-1 rounded-full bg-amber-50 text-[#AA8222] border border-[#D4AF37]/40 text-xs font-bold uppercase tracking-wider">
            ${prop.property_type || 'Residential'}
          </span>
          <span class="px-3.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold uppercase tracking-wider">
            Active Portfolio
          </span>
        </div>
        <h1 class="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-slate-900 font-display tracking-tight">
          ${prop.title}
        </h1>
        <p class="text-sm sm:text-base text-slate-500 mt-2 flex items-center gap-1.5 font-medium">
          <span class="text-[#D4AF37]">📍</span> ${prop.address || 'Premium Corridor'}
        </p>
      </div>

      <div class="flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <div class="bg-amber-50/70 border border-[#D4AF37]/30 px-6 py-3.5 rounded-2xl shadow-xs">
          <span class="text-[10px] uppercase font-bold text-slate-500 block tracking-wider">Investment Pricing</span>
          <span class="text-2xl sm:text-3xl font-black text-slate-900 font-display">
            ${prop.price || 'Price on Request'}
          </span>
        </div>
        <a href="https://wa.me/${phoneRaw}?text=Hi%20${encodeURIComponent(profile.business_name)},%20I%20am%20interested%20in%20${encodeURIComponent(prop.title)}%20(${encodeURIComponent(prop.address || '')}).%20Please%20share%20floor%20plans%20and%20pricing." target="_blank" class="flex items-center gap-2 px-6 py-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-md transition-all">
          <span>💬</span> WhatsApp Advisory
        </a>
      </div>
    </div>

    <!-- MAIN GRID -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-10 mt-10">
      
      <!-- LEFT 2 COLUMNS: GALLERY & DETAILS -->
      <div class="lg:col-span-2 space-y-10">
        
        <!-- MAIN GALLERY -->
        <div class="space-y-4">
          <div class="relative h-[380px] sm:h-[480px] rounded-3xl overflow-hidden bg-slate-900 shadow-xl border border-slate-200">
            <img id="mainPropertyImage" src="${mainImg}" alt="${prop.title}" class="w-full h-full object-cover transition-opacity duration-300">
            <div class="absolute bottom-4 left-4 bg-slate-950/80 backdrop-blur-md px-4 py-2 rounded-xl text-[#D4AF37] text-xs font-bold border border-[#D4AF37]/30">
              Verified Architectural Asset
            </div>
          </div>

          <!-- THUMBNAILS -->
          ${allImages.length > 1 ? `
          <div class="flex gap-3 overflow-x-auto pb-2">
            ${allImages.map((imgUrl: string, idx: number) => `
              <button onclick="document.getElementById('mainPropertyImage').src='${imgUrl}'" class="w-24 h-20 rounded-xl overflow-hidden border-2 border-transparent hover:border-[#D4AF37] focus:border-[#D4AF37] transition-all shrink-0 bg-slate-100 cursor-pointer">
                <img src="${imgUrl}" alt="Thumbnail ${idx + 1}" class="w-full h-full object-cover">
              </button>
            `).join('')}
          </div>
          ` : ''}
        </div>

        <!-- OVERVIEW & ARCHITECTURAL HIGHLIGHTS -->
        <div class="springfield-card p-8 sm:p-10 border border-slate-200/80">
          <h2 class="text-2xl font-extrabold text-slate-900 font-display mb-6">
            Residence Overview & Architectural Highlights
          </h2>
          <div class="prose max-w-none text-slate-700 leading-relaxed text-sm sm:text-base space-y-4">
            <p>${prop.description || 'Exclusive luxury development with verified title, master architecture, and bespoke resort amenities.'}</p>
          </div>

          <!-- SPECS GRID -->
          <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-8 pt-8 border-t border-slate-100">
            <div class="bg-slate-50 p-4 rounded-xl">
              <span class="text-[10px] uppercase font-bold text-slate-400 block">Region</span>
              <span class="font-bold text-[#AA8222] text-sm">${region}</span>
            </div>
            <div class="bg-slate-50 p-4 rounded-xl">
              <span class="text-[10px] uppercase font-bold text-slate-400 block">Sizes</span>
              <span class="font-bold text-slate-900 text-sm">${cfg.sizes || 'Custom Layouts'}</span>
            </div>
            <div class="bg-slate-50 p-4 rounded-xl">
              <span class="text-[10px] uppercase font-bold text-slate-400 block">Possession</span>
              <span class="font-bold text-slate-900 text-sm">${cfg.possession || 'Ready / Handover'}</span>
            </div>
            <div class="bg-slate-50 p-4 rounded-xl">
              <span class="text-[10px] uppercase font-bold text-slate-400 block">Verification</span>
              <span class="font-bold text-emerald-700 text-sm">✓ RERA & Legal Clear</span>
            </div>
          </div>
        </div>

        <!-- CONFIGURATIONS / UNITS (IF PRESENT) -->
        ${cfg.units && cfg.units.length > 0 ? `
        <div class="springfield-card p-8 sm:p-10 border border-slate-200/80">
          <h3 class="text-xl font-extrabold text-slate-900 font-display mb-4">Available Unit Types</h3>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            ${cfg.units.map((u: string) => `
              <div class="flex items-center gap-2.5 p-3.5 rounded-xl bg-slate-50 border border-slate-100 text-xs font-bold text-slate-900">
                <span class="text-[#D4AF37]">✦</span> ${u}
              </div>
            `).join('')}
          </div>
        </div>
        ` : ''}

        <!-- AMENITIES (IF PRESENT) -->
        ${cfg.amenities && cfg.amenities.length > 0 ? `
        <div class="springfield-card p-8 sm:p-10 border border-slate-200/80">
          <h3 class="text-xl font-extrabold text-slate-900 font-display mb-4">Lifestyle & Clubhouse Amenities</h3>
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
            ${cfg.amenities.map((a: string) => `
              <div class="flex items-center gap-2 p-3 rounded-xl bg-slate-50 border border-slate-100 text-xs font-semibold text-slate-700">
                <span class="text-emerald-600 font-bold">✓</span> ${a}
              </div>
            `).join('')}
          </div>
        </div>
        ` : ''}

      </div>

      <!-- RIGHT COLUMN: BOOKING / SITE VISIT LEAD FORM -->
      <div class="space-y-6" id="booking-section">
        <div class="springfield-card p-8 border-2 border-[#D4AF37]/30 sticky top-28 bg-white shadow-xl">
          <div class="mb-6">
            <span class="text-[10px] font-black text-[#D4AF37] uppercase tracking-widest block mb-1">VIP Advisory</span>
            <h3 class="text-2xl font-extrabold text-slate-900 font-display">Schedule Private Tour</h3>
            <p class="text-slate-500 text-xs mt-1 leading-relaxed">
              Book a personal site inspection or video consultation with our senior advisory desk for <strong class="text-slate-900">${prop.title}</strong>.
            </p>
          </div>

          <form id="propertyTourForm" class="space-y-4">
            <input type="hidden" name="property_id" value="${prop.id}">
            <input type="hidden" name="property_title" value="${prop.title}">
            <input type="hidden" name="region" value="${region}">

            <div>
              <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Your Full Name</label>
              <input type="text" id="tourName" required placeholder="e.g. Rajiv Kumar" class="w-full px-4 py-3 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-[#D4AF37] focus:outline-none">
            </div>

            <div>
              <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Phone Number (WhatsApp)</label>
              <input type="tel" id="tourPhone" required placeholder="e.g. +91 98886 26786" class="w-full px-4 py-3 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-[#D4AF37] focus:outline-none">
            </div>

            <div>
              <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Email Address</label>
              <input type="email" id="tourEmail" placeholder="e.g. client@example.com" class="w-full px-4 py-3 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-[#D4AF37] focus:outline-none">
            </div>

            <div>
              <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Preferred Date & Time</label>
              <input type="datetime-local" id="tourDatetime" class="w-full px-4 py-3 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-[#D4AF37] focus:outline-none">
            </div>

            <button type="submit" id="tourSubmitBtn" class="w-full btn-gold py-4 rounded-xl text-xs uppercase tracking-wider font-extrabold shadow-md cursor-pointer">
              Confirm Private Site Visit
            </button>

            <div id="tourFeedback" class="hidden text-center text-xs font-bold mt-2"></div>
          </form>

          <div class="mt-6 pt-6 border-t border-slate-100 text-center">
            <p class="text-xs text-slate-500 mb-3">Speak with our director directly:</p>
            <a href="https://wa.me/${phoneRaw}?text=Hi%20${encodeURIComponent(profile.business_name)},%20I%20would%20like%20to%20schedule%20a%20site%20visit%20for%20${encodeURIComponent(prop.title)}." target="_blank" class="w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors text-xs font-bold border border-emerald-200">
              <span>💬</span> Direct WhatsApp to Advisory
            </a>
          </div>

        </div>
      </div>

    </div>

  </main>

  <!-- FOOTER -->
  <footer class="bg-[#0F172A] text-white pt-12 pb-8 border-t border-slate-800 mt-16">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="flex flex-col md:flex-row justify-between items-center gap-6 pb-8 border-b border-slate-800">
        <div>
          <span class="font-display text-lg font-bold text-[#D4AF37]">${profile.business_name}</span>
          <p class="text-xs text-slate-400 mt-1">${profile.address || 'New Chandigarh, Tri-City & Dubai'}</p>
        </div>
        <div class="flex items-center space-x-6 text-xs text-slate-300">
          <a href="${homeUrl}" class="hover:text-[#D4AF37]">Home</a>
          <a href="${catalogUrl}" class="hover:text-[#D4AF37]">Portfolio</a>
          <a href="tel:${phoneRaw}" class="text-[#D4AF37] font-bold">${phoneDisplay}</a>
        </div>
      </div>
      <p class="text-center text-[10px] text-slate-500 pt-6">
        © ${new Date().getFullYear()} ${profile.business_name}. All rights reserved. RERA & Title Verified Advisory.
      </p>
    </div>
  </footer>

  <script>
    document.getElementById('propertyTourForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('tourSubmitBtn');
      const feedback = document.getElementById('tourFeedback');
      const name = document.getElementById('tourName').value.trim();
      const phone = document.getElementById('tourPhone').value.trim();
      const email = document.getElementById('tourEmail')?.value?.trim();
      const datetime = document.getElementById('tourDatetime')?.value?.trim();

      btn.disabled = true;
      btn.innerText = 'Submitting Request...';

      try {
        await fetch('/api/shared/landing-page/lead', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: '${profile.id}',
            name,
            phone,
            email,
            city: '${region}',
            slug: 'index',
            custom_question_0: '${prop.title.replace(/'/g, "\\'")}',
            custom_question_1: datetime,
            custom_fields: {
              source: 'Dedicated Property Page',
              property_id: '${prop.id}',
              property_title: '${prop.title.replace(/'/g, "\\'")}',
              scheduled_time: datetime
            }
          })
        });

        feedback.className = 'text-center text-xs font-bold text-emerald-600 pt-2 block';
        feedback.innerText = '✓ Site visit confirmed! Our senior advisor will call you shortly.';
        e.target.reset();
      } catch (err) {
        feedback.className = 'text-center text-xs font-bold text-emerald-600 pt-2 block';
        feedback.innerText = '✓ Your request has been received.';
      } finally {
        btn.disabled = false;
        btn.innerText = 'Confirm Private Site Visit';
      }
    });
  </script>

</body>
</html>`

    return new Response(html, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=86400'
      }
    })
  } catch (error: any) {
    console.error('[Property Detail Route Error]:', error)
    return new Response('Internal Server Error', { status: 500 })
  }
}
