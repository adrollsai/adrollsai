import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

type RouteProps = {
  params: Promise<{ user_id: string }>
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

export async function GET(request: Request, { params }: RouteProps) {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const resolvedParams = await params
    let identifier = decodeURIComponent(resolvedParams.user_id || '').trim()

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

    // 2. Fetch all active properties
    const { data: properties, error: propErr } = await supabase
      .from('properties')
      .select('*')
      .eq('user_id', profile.id)
      .neq('status', 'Archived')
      .neq('status', 'Sold')
      .order('created_at', { ascending: false })

    const propList = (properties || []).map((p: any) => ({
      ...p,
      region: detectRegion(p.title, p.address, p.price)
    }))

    const domain = profile.custom_domain || 'nobogent.com'
    const basePath = profile.custom_domain ? '' : `/shared/${profile.id}`
    const homeUrl = profile.custom_domain ? '/' : `/shared/${profile.id}/index`
    const catalogUrl = profile.custom_domain ? `https://${domain}/properties` : `https://${domain}/shared/${profile.id}/properties`
    const phoneRaw = (profile.contact_number || '+919888626786').replace(/[^0-9]/g, '')
    const phoneDisplay = profile.contact_number || '+91 98886 26786'
    const bizName = profile.business_name || 'Premium Real Estate'
    const isBioque = domain.includes('bioque') || bizName.toLowerCase().includes('bioque')

    const distinctRegions = Array.from(new Set(propList.map((p: any) => p.region).filter(Boolean))) as string[];

    const metaDescription = profile.mission_statement || 
      (propList.length > 0
        ? `Explore verified real estate opportunities by ${bizName}. Featuring ${propList.slice(0, 3).map((p: any) => p.title).join(', ')} with direct advisory & private site tours.`
        : `Explore verified real estate opportunities by ${bizName}. Direct advisory & private site tours.`);

    const heroTitle = isBioque ? 'Complete Global Real Estate Portfolio' : `${bizName} Real Estate Portfolio`;
    const heroSubtitle = isBioque
      ? 'Showing all verified developments across New Chandigarh, Tri-City, and Dubai. Click any residence to view dedicated product details, galleries, and private visit scheduling.'
      : (profile.mission_statement || `Explore our curated selection of verified properties. Click any property to view complete specifications, floor plans, and schedule a private site visit.`);

    const schemaItemList = propList.map((p: any, idx: number) => ({
      '@type': 'ListItem',
      position: idx + 1,
      item: {
        '@type': 'SingleFamilyResidence',
        name: p.title || 'Exclusive Residence',
        description: p.description || '',
        image: p.image_url || '',
        url: `https://${domain}${basePath}/properties/${p.id}`,
        address: {
          '@type': 'PostalAddress',
          streetAddress: p.address || p.region || 'Prime Location',
          addressLocality: p.region === 'Dubai' ? 'Dubai' : (p.region === 'Tri-City' ? 'Mohali' : 'New Chandigarh'),
          addressCountry: p.region === 'Dubai' ? 'AE' : 'IN'
        },
        offers: {
          '@type': 'Offer',
          priceCurrency: p.price?.includes('AED') ? 'AED' : 'INR',
          price: p.price || 'Price on Request'
        }
      }
    }))

    const schemaLd = {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'RealEstateAgent',
          '@id': `https://${domain}/#organization`,
          name: bizName,
          url: `https://${domain}`,
          telephone: phoneDisplay,
          logo: profile.logo_url || ''
        },
        {
          '@type': 'ItemList',
          name: `${bizName} Verified Portfolio`,
          numberOfItems: propList.length,
          itemListElement: schemaItemList
        }
      ]
    }

    const html = `<!DOCTYPE html>
<html lang="en" class="scroll-smooth">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0">
  <title>Complete Real Estate Portfolio | ${bizName}</title>
  <meta name="title" content="Complete Real Estate Portfolio | ${bizName}">
  <meta name="description" content="${metaDescription.replace(/"/g, '&quot;')}">
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
  <link rel="canonical" href="${catalogUrl}">

  <!-- OpenGraph / Social Sharing -->
  <meta property="og:type" content="website">
  <meta property="og:url" content="${catalogUrl}">
  <meta property="og:title" content="Complete Real Estate Portfolio | ${bizName}">
  <meta property="og:description" content="${metaDescription.replace(/"/g, '&quot;')}">
  ${propList[0]?.image_url ? `<meta property="og:image" content="${propList[0].image_url}">` : ''}

  <!-- Twitter -->
  <meta property="twitter:card" content="summary_large_image">
  <meta property="twitter:url" content="${catalogUrl}">
  <meta property="twitter:title" content="Complete Real Estate Portfolio | ${bizName}">
  <meta property="twitter:description" content="${metaDescription.replace(/"/g, '&quot;')}">
  ${propList[0]?.image_url ? `<meta property="twitter:image" content="${propList[0].image_url}">` : ''}

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
    .springfield-card {
      background: #FFFFFF;
      border: 1px solid #F0ECE1;
      border-radius: 1.25rem;
      transition: all 0.35s ease;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.03);
    }
    .springfield-card:hover {
      transform: translateY(-4px);
      box-shadow: 0 14px 28px -6px rgba(212, 175, 55, 0.15);
      border-color: #D4AF37;
    }
  </style>
</head>
<body class="bg-[#FCFBFA] text-slate-800 selection:bg-amber-200 flex flex-col min-h-screen">

  <!-- TOP BAR -->
  <div class="bg-[#0F172A] border-b border-slate-800 py-2 px-4 sm:px-8 text-xs text-slate-300">
    <div class="max-w-7xl mx-auto flex justify-between items-center">
      <div class="flex items-center space-x-6">
        <span class="flex items-center gap-1.5">
          <span class="text-[#D4AF37]">📍</span> ${profile.address || 'SCO 118-119, Level II, Madhya Marg, Sector 8-C, Chandigarh'}
        </span>
      </div>
      <div class="flex items-center space-x-6">
        <span class="hidden sm:inline font-medium text-slate-300">Official Advisory: <strong class="text-[#D4AF37]">New Chandigarh, Tri-City & Dubai</strong></span>
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
        
        <a href="/" class="flex items-center space-x-2.5 sm:space-x-3 group shrink-0 mr-4 sm:mr-8">
          ${profile.logo_url ? `<img src="${profile.logo_url}" alt="${profile.business_name}" class="h-10 sm:h-12 w-auto object-contain transition-transform duration-300 group-hover:scale-105">` : ''}
          <div class="leading-tight">
            <span class="font-display text-sm sm:text-base font-extrabold tracking-wide text-[#D4AF37] block leading-none">
              ${isBioque ? 'BIOQUE ESTATES' : profile.business_name.toUpperCase()}
            </span>
            <span class="text-[8px] sm:text-[9px] uppercase tracking-[0.2em] text-[#C59E2B] block font-bold mt-1">
              ${isBioque ? 'International Pvt. Ltd.' : 'Real Estate Advisory'}
            </span>
          </div>
        </a>

        <!-- NAV LINKS -->
        <nav class="hidden xl:flex items-center space-x-8 text-xs font-bold uppercase tracking-wider text-slate-600">
          <a href="${homeUrl}" class="hover:text-[#D4AF37] transition-colors">Home</a>
          <a href="${catalogUrl}" class="text-[#D4AF37] transition-colors border-b-2 border-[#D4AF37] pb-1">Portfolio</a>
          <a href="${homeUrl}#about" class="hover:text-[#D4AF37] transition-colors">About Us</a>
          <a href="${homeUrl}#contact" class="hover:text-[#D4AF37] transition-colors">Contact</a>
        </nav>

        <div class="flex items-center space-x-3">
          <a href="https://wa.me/${phoneRaw}?text=Hi%20${encodeURIComponent(bizName)},%20I%20am%20interested%20in%20your%20properties." target="_blank" class="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full border border-emerald-500/40 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 text-xs font-bold transition-all">
            <span>💬</span> WhatsApp
          </a>
        </div>

      </div>
    </div>
  </header>

  <!-- CATALOG HERO BANNER -->
  <div class="bg-[#0F172A] text-white py-12 sm:py-16 border-b border-slate-800">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <span class="text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-[#D4AF37] block mb-1">Curated Inventory</span>
      <h1 class="font-display text-3xl sm:text-4xl lg:text-5xl font-extrabold text-white mb-3">${heroTitle}</h1>
      <p class="text-slate-300 text-xs sm:text-sm max-w-2xl leading-relaxed">
        ${heroSubtitle}
      </p>
    </div>
  </div>

  <!-- CATALOG CONTENT WITH SEARCH & GRID -->
  <main class="flex-grow max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 w-full">
    
    <!-- SEARCH & REGION FILTER BAR -->
    <div class="flex flex-col md:flex-row justify-between items-stretch md:items-center gap-4 mb-10 pb-6 border-b border-slate-200">
      <div class="flex flex-wrap gap-2 items-center" id="catalogFilterTabs">
        ${distinctRegions.length > 1 ? `
          <button onclick="filterCatalog('All')" class="filter-btn active px-4 py-2 rounded-xl bg-[#0F172A] text-[#D4AF37] border border-[#D4AF37]/50 text-xs font-bold cursor-pointer" data-region="All">All (${propList.length})</button>
          ${distinctRegions.map(reg => {
            const count = propList.filter((p: any) => p.region === reg).length;
            const icon = reg === 'Dubai' ? '🇦🇪 ' : (reg === 'New Chandigarh' ? '🌳 ' : '🏙️ ');
            return `<button onclick="filterCatalog('${reg}')" class="filter-btn px-4 py-2 rounded-xl bg-white text-slate-700 border border-slate-200 text-xs font-bold cursor-pointer hover:border-[#D4AF37]" data-region="${reg}">${icon}${reg} (${count})</button>`;
          }).join('')}
        ` : `
          <span class="text-xs font-bold text-slate-600 bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200">
            Showing ${propList.length} Verified Properties
          </span>
        `}
      </div>

      <div class="relative w-full md:w-72">
        <input type="text" id="catalogSearchInput" oninput="applyFilters()" placeholder="Search project or address..." class="w-full pl-9 pr-4 py-2.5 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-[#D4AF37] focus:outline-none bg-white">
        <span class="absolute left-3 top-3 text-slate-400 text-xs">🔍</span>
      </div>
    </div>

    <!-- CARDS GRID -->
    <div id="catalogGrid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8">
      ${propList.map((p: any) => {
        const regionBadge = p.region === 'Dubai' ? '🇦🇪 Dubai Luxury' : (p.region === 'Tri-City' ? '🏙️ Tri-City Flagship' : '🌳 New Chandigarh');
        const img = p.image_url || 'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=1200&q=85';
        const propTitle = p.title || 'Exclusive Residence';
        const propAddr = p.address || 'Premium Corridor';
        const propUrl = `${basePath}/properties/${p.id}`;
        return `
        <article class="property-card springfield-card overflow-hidden flex flex-col group" data-region="${p.region}" data-title="${propTitle.toLowerCase()}" data-address="${propAddr.toLowerCase()}">
          <a href="${propUrl}" class="block relative aspect-[16/10] overflow-hidden bg-slate-100">
            <img src="${img}" alt="${propTitle}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy">
            <div class="absolute top-3 left-3 flex flex-wrap gap-1.5">
              <span class="bg-[#0F172A]/90 backdrop-blur text-[#D4AF37] text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-md border border-[#D4AF37]/30">
                ${regionBadge}
              </span>
              <span class="bg-white/95 text-slate-800 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-md">
                ${p.property_type || 'Residential'}
              </span>
            </div>
            ${p.price ? `
              <div class="absolute bottom-3 left-3">
                <span class="bg-[#0F172A]/90 text-[#D4AF37] font-extrabold text-xs px-3 py-1.5 rounded-md border border-[#D4AF37]/20 shadow-xs">
                  ${p.price}
                </span>
              </div>
            ` : ''}
          </a>

          <div class="p-5 flex-1 flex flex-col justify-between">
            <div>
              <a href="${propUrl}">
                <h2 class="font-display font-extrabold text-slate-900 text-base sm:text-lg mb-1 group-hover:text-[#AA8222] transition-colors line-clamp-1">${propTitle}</h2>
              </a>
              <p class="text-slate-500 text-xs leading-relaxed mb-3 line-clamp-2">${p.description || ''}</p>
              <div class="flex items-center gap-1.5 text-slate-400 text-xs mb-4">
                <span class="text-[#D4AF37]">📍</span>
                <span class="truncate">${propAddr}</span>
              </div>
            </div>

            <div class="pt-3 border-t border-slate-100 flex items-center gap-2">
              <a href="${propUrl}" class="flex-1 btn-gold text-xs py-2 rounded-xl uppercase tracking-wider font-extrabold text-center shadow-xs">
                View Full Product Page
              </a>
              <a href="https://wa.me/${phoneRaw}?text=Hi%20${encodeURIComponent(bizName)},%20I%20am%20interested%20in%20${encodeURIComponent(propTitle)}" target="_blank" class="p-2 rounded-xl border border-emerald-500/40 text-emerald-700 hover:bg-emerald-50 transition-colors" title="Chat on WhatsApp">
                💬
              </a>
            </div>
          </div>
        </article>
        `
      }).join('')}
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
          <a href="/" class="hover:text-[#D4AF37]">Home</a>
          <a href="/properties" class="text-[#D4AF37]">Portfolio</a>
          <a href="tel:${phoneRaw}" class="text-[#D4AF37] font-bold">${phoneDisplay}</a>
        </div>
      </div>
      <p class="text-center text-[10px] text-slate-500 pt-6">
        © ${new Date().getFullYear()} ${profile.business_name}. All rights reserved. RERA & Title Verified Advisory.
      </p>
    </div>
  </footer>

  <script>
    let activeRegion = 'All';

    function filterCatalog(region) {
      activeRegion = region;
      document.querySelectorAll('.filter-btn').forEach(btn => {
        if (btn.dataset.region === region) {
          btn.className = 'filter-btn px-4 py-2 rounded-xl bg-[#0F172A] text-[#D4AF37] border border-[#D4AF37]/50 text-xs font-bold cursor-pointer';
        } else {
          btn.className = 'filter-btn px-4 py-2 rounded-xl bg-white text-slate-700 border border-slate-200 text-xs font-bold cursor-pointer hover:border-[#D4AF37]';
        }
      });
      applyFilters();
    }

    function applyFilters() {
      const q = (document.getElementById('catalogSearchInput')?.value || '').toLowerCase().trim();
      const cards = document.querySelectorAll('.property-card');

      cards.forEach(card => {
        const r = card.dataset.region;
        const t = card.dataset.title || '';
        const a = card.dataset.address || '';

        const matchRegion = (activeRegion === 'All') || (r === activeRegion);
        const matchQuery = !q || t.includes(q) || a.includes(q);

        if (matchRegion && matchQuery) {
          card.style.display = 'flex';
        } else {
          card.style.display = 'none';
        }
      });
    }
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
    console.error('[Properties Catalog Route Error]:', error?.stack || error)
    return new Response(error?.stack || error?.message || 'Internal Server Error', { status: 500 })
  }
}
