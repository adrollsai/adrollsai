const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const userId = '68b55a31-a16d-454d-a20f-11adabf590b0';
const LOGO_URL = 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/logos/68b55a31-a16d-454d-a20f-11adabf590b0-bioque-logo.png';
const PHONE_DISPLAY = '+91 98886 26786';
const PHONE_RAW = '919888626786';

function detectRegion(title = '', address = '', price = '') {
  const combined = `${title} ${address}`.toLowerCase();
  if (combined.includes('dubai') || price.includes('AED')) {
    return 'Dubai';
  }
  if (
    combined.includes('homeland') ||
    combined.includes('jubilee') ||
    combined.includes('motiaz') ||
    combined.includes('gmi infra') ||
    combined.includes('aventus') ||
    combined.includes('mohali') ||
    combined.includes('zirakpur') ||
    combined.includes('panchkula') ||
    (combined.includes('chandigarh') && !combined.includes('new chandigarh'))
  ) {
    return 'Tri-City';
  }
  return 'New Chandigarh';
}

async function updateBioqueWebsite() {
  console.log('Fetching live Bioque properties from Supabase...');
  const { data: properties, error: pErr } = await supabaseAdmin
    .from('properties')
    .select('*')
    .eq('user_id', userId)
    .neq('status', 'Archived')
    .neq('status', 'Sold')
    .order('created_at', { ascending: false });

  if (pErr) throw pErr;

  const enrichedProps = properties.map(p => ({
    ...p,
    region: detectRegion(p.title, p.address, p.price)
  }));

  console.log(`Found ${enrichedProps.length} active Bioque properties.`);
  const counts = {
    total: enrichedProps.length,
    newChd: enrichedProps.filter(p => p.region === 'New Chandigarh').length,
    triCity: enrichedProps.filter(p => p.region === 'Tri-City').length,
    dubai: enrichedProps.filter(p => p.region === 'Dubai').length
  };
  console.log('Region distribution:', counts);

  const websiteHtml = generateBioqueHtml(enrichedProps, counts);

  const { data: savedPage, error: saveErr } = await supabaseAdmin
    .from('landing_pages')
    .upsert({
      user_id: userId,
      slug: 'index',
      title: 'Bioque Estates International Pvt. Ltd. | Tri-City, New Chandigarh & Dubai Luxury Properties',
      product_name: 'Bioque Estates & Springfield Luxury Portfolio',
      html_content: websiteHtml
    }, { onConflict: 'user_id,slug' })
    .select()
    .single();

  if (saveErr) throw saveErr;
  console.log('✓ Successfully updated Bioque Estates website in landing_pages! Page ID:', savedPage.id);
}

function generateBioqueHtml(properties, counts) {
  const propertiesJson = JSON.stringify(properties).replace(/</g, '\\u003c');

  const schemaItemList = properties.map((p, idx) => ({
    "@type": "ListItem",
    "position": idx + 1,
    "item": {
      "@type": "SingleFamilyResidence",
      "name": p.title,
      "description": p.description,
      "image": p.image_url,
      "address": {
        "@type": "PostalAddress",
        "streetAddress": p.address || "New Chandigarh & Dubai",
        "addressLocality": p.region === 'Dubai' ? "Dubai" : (p.region === 'Tri-City' ? "Mohali" : "New Chandigarh"),
        "addressCountry": p.region === 'Dubai' ? "AE" : "IN"
      },
      "offers": {
        "@type": "Offer",
        "priceCurrency": p.price?.includes('AED') ? "AED" : "INR",
        "price": p.price,
        "availability": "https://schema.org/InStock",
        "seller": {
          "@type": "RealEstateAgent",
          "name": "Bioque Estates International Pvt. Ltd.",
          "telephone": PHONE_DISPLAY
        }
      }
    }
  }));

  const jsonLdData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "RealEstateAgent",
        "@id": "https://bioqueestatesinternational.com/#organization",
        "name": "Bioque Estates International Pvt. Ltd.",
        "legalName": "Bioque Estates International Pvt. Ltd.",
        "url": "https://bioqueestatesinternational.com",
        "logo": LOGO_URL,
        "image": LOGO_URL,
        "description": "Premier luxury real estate advisory in New Chandigarh, Tri-City, and Dubai UAE in partnership with Springfield Properties.",
        "telephone": PHONE_DISPLAY,
        "email": "estatesbioque@gmail.com",
        "address": {
          "@type": "PostalAddress",
          "streetAddress": "SCO 118-119, Level II, Madhya Marg, Sector 8-C",
          "addressLocality": "Chandigarh",
          "postalCode": "160009",
          "addressCountry": "IN"
        },
        "hasOfferCatalog": {
          "@type": "OfferCatalog",
          "name": "Bioque Estates & Springfield Properties Global Portfolio",
          "itemListElement": schemaItemList
        }
      }
    ]
  };

  return `<!DOCTYPE html>
<html lang="en" class="scroll-smooth">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0">
  <title>Bioque Estates International Pvt. Ltd. | Tri-City, New Chandigarh & Dubai Luxury Properties</title>
  
  <meta name="title" content="Bioque Estates International Pvt. Ltd. | Tri-City, New Chandigarh & Dubai Luxury Properties">
  <meta name="description" content="Explore luxury waterfront residences, independent floors, duplex villas, and developer plots across New Chandigarh, Tri-City, and Dubai in partnership with Springfield Properties.">
  <meta name="keywords" content="Bioque Estates International Pvt. Ltd., Springfield Properties, Omaxe New Chandigarh, Opus One GB Realty, The Tiara Sham Exotic, Homeland Infinia, Jubilee Parkfields, DLF New Chandigarh, Riseonic New Chandigarh, Palm Jebel Ali, Mercedes-Benz Places, Dubai Creek Harbour">
  <meta name="robots" content="index, follow">
  
  <meta property="og:type" content="website">
  <meta property="og:title" content="Bioque Estates International Pvt. Ltd. | Tri-City, New Chandigarh & Dubai Luxury Properties">
  <meta property="og:description" content="Curated luxury portfolio featuring New Chandigarh flagship developments, Tri-City high-rises, and Dubai waterfront residences.">
  <meta property="og:image" content="${LOGO_URL}">

  <script type="application/ld+json">
    ${JSON.stringify(jsonLdData)}
  </script>

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">

  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          fontFamily: {
            sans: ['Plus Jakarta Sans', '-apple-system', 'sans-serif'],
            display: ['Outfit', 'sans-serif'],
          },
          colors: {
            primary: {
              50: '#FDFBF7',
              100: '#FAF3E3',
              200: '#F4E5BE',
              300: '#EBD292',
              400: '#E2BF67',
              500: '#D4AF37', // Pure luxury vibrant gold
              600: '#C59E2B', // Radiant metallic gold
              700: '#AA8222',
              800: '#846612',
              900: '#56420A',
            },
            gold: {
              light: '#F5E6BE',
              DEFAULT: '#D4AF37',
              dark: '#AA8222',
            },
            dark: {
              950: '#0B0F19',
              900: '#0F172A',
              850: '#1E293B',
              800: '#334155',
            }
          }
        }
      }
    }
  </script>

  <style>
    body {
      font-family: 'Plus Jakarta Sans', sans-serif;
      background-color: #FAFAFC;
      color: #1E293B;
      overflow-x: hidden;
      -webkit-font-smoothing: antialiased;
    }
    .font-display {
      font-family: 'Outfit', sans-serif;
    }
    
    .text-gold-gradient {
      background: linear-gradient(135deg, #F9E7B9 0%, #D4AF37 50%, #AA8222 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .btn-springfield {
      background-color: #0F172A;
      color: #FFFFFF;
      font-weight: 700;
      letter-spacing: 0.02em;
      transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .btn-springfield:hover {
      background-color: #D4AF37;
      color: #0F172A;
      box-shadow: 0 10px 20px -5px rgba(212, 175, 55, 0.45);
      transform: translateY(-2px);
    }

    .btn-gold {
      background: linear-gradient(135deg, #E5C158 0%, #D4AF37 50%, #B8860B 100%);
      color: #0F172A;
      font-weight: 700;
      letter-spacing: 0.02em;
      transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .btn-gold:hover {
      box-shadow: 0 10px 20px -5px rgba(212, 175, 55, 0.45);
      transform: translateY(-2px);
      filter: brightness(1.05);
    }

    .btn-outline {
      border: 1px solid #E2E8F0;
      color: #0F172A;
      font-weight: 600;
      transition: all 0.2s ease;
    }
    .btn-outline:hover {
      border-color: #D4AF37;
      background-color: #D4AF37;
      color: #0F172A;
    }

    .springfield-card {
      background: #FFFFFF;
      border: 1px solid #F0ECE1;
      border-radius: 1.25rem;
      transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.03);
    }
    .springfield-card:hover {
      transform: translateY(-5px);
      box-shadow: 0 16px 32px -8px rgba(212, 175, 55, 0.15);
      border-color: #D4AF37;
    }

    .page-view {
      display: none;
    }
    .page-view.active {
      display: block;
      animation: viewFadeIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    }
    @keyframes viewFadeIn {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .no-scrollbar::-webkit-scrollbar {
      display: none;
    }
    .no-scrollbar {
      -ms-overflow-style: none;
      scrollbar-width: none;
    }
  </style>
</head>
<body class="selection:bg-amber-200 selection:text-slate-900 flex flex-col min-h-screen pb-16 md:pb-0">

  <!-- TOP UTILITY BAR (DESKTOP) -->
  <div class="bg-dark-950 border-b border-dark-850 py-2 px-4 sm:px-8 text-xs text-slate-300 hidden md:block">
    <div class="max-w-7xl mx-auto flex justify-between items-center">
      <div class="flex items-center space-x-6">
        <span class="flex items-center gap-1.5">
          <span class="text-[#D4AF37]">📍</span>
          SCO 118-119, Level II, Madhya Marg, Sector 8-C, Chandigarh
        </span>
        <span class="flex items-center gap-1.5">
          <span class="text-[#D4AF37]">✉️</span>
          estatesbioque@gmail.com
        </span>
      </div>
      <div class="flex items-center space-x-6">
        <span class="font-medium text-slate-300">Official Advisory: <strong class="text-[#D4AF37]">New Chandigarh, Tri-City & Dubai</strong></span>
        <a href="tel:${PHONE_RAW}" class="text-white hover:text-[#D4AF37] font-bold flex items-center gap-1.5 transition-colors">
          <span class="text-[#D4AF37]">📞</span>
          ${PHONE_DISPLAY}
        </a>
      </div>
    </div>
  </div>

  <!-- NAVIGATION HEADER (NO BORDER ON LOGO, BIGGER LOGO, GOLDEN TITLE) -->
  <header class="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-slate-200 shadow-sm">
    <div class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
      <div class="flex justify-between items-center h-20 sm:h-24">
        
        <!-- LOGO & TITLE -->
        <a href="#home" onclick="navigateTo('home'); return false;" class="flex items-center space-x-2.5 sm:space-x-3 group shrink-0 mr-4 sm:mr-8">
          <img src="${LOGO_URL}" alt="Bioque Estates International Pvt. Ltd." class="h-10 sm:h-12 w-auto object-contain transition-transform duration-300 group-hover:scale-105" loading="eager">
          <div class="leading-tight">
            <span class="font-display text-sm sm:text-base font-extrabold tracking-wide text-[#D4AF37] block leading-none">
              BIOQUE ESTATES
            </span>
            <span class="text-[8px] sm:text-[9px] uppercase tracking-[0.2em] text-[#C59E2B] block font-bold mt-1">
              International Pvt. Ltd.
            </span>
          </div>
        </a>

        <!-- DESKTOP NAVIGATION -->
        <nav class="hidden xl:flex items-center space-x-7 text-xs font-bold uppercase tracking-wider text-slate-600">
          <a href="/" class="nav-link text-[#D4AF37] py-2 border-b-2 border-[#D4AF37] transition-colors" data-target="home">Home</a>
          <a href="/properties" class="nav-link hover:text-[#D4AF37] py-2 border-b-2 border-transparent transition-colors" data-target="properties">Global Portfolio</a>
          <a href="#about" onclick="navigateTo('about'); return false;" class="nav-link hover:text-[#D4AF37] py-2 border-b-2 border-transparent transition-colors" data-target="about">About Us</a>
          <a href="#services" onclick="navigateTo('services'); return false;" class="nav-link hover:text-[#D4AF37] py-2 border-b-2 border-transparent transition-colors" data-target="services">Services</a>
          <a href="#contact" onclick="navigateTo('contact'); return false;" class="nav-link hover:text-[#D4AF37] py-2 border-b-2 border-transparent transition-colors" data-target="contact">Contact</a>
        </nav>

        <!-- CTA & MOBILE HAMBURGER -->
        <div class="flex items-center space-x-2">
          <a href="https://wa.me/${PHONE_RAW}?text=Hi%20Bioque%20Estates,%20I%20am%20interested%20in%20your%20properties." target="_blank" class="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-emerald-500/40 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 text-xs font-bold transition-all">
            <svg class="w-3.5 h-3.5 fill-emerald-600 shrink-0" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
            <span>WhatsApp</span>
          </a>
          <button onclick="navigateTo('contact')" class="btn-gold px-4 sm:px-5 py-2 sm:py-2.5 rounded-full text-[11px] sm:text-xs uppercase tracking-wider font-extrabold flex items-center gap-1 shadow-sm cursor-pointer">
            <span>Book Tour</span>
          </button>
          
          <button onclick="toggleMobileMenu()" class="xl:hidden p-1.5 rounded-lg text-dark-900 hover:bg-slate-100 transition-colors focus:outline-none" aria-label="Toggle navigation">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/></svg>
          </button>
        </div>

      </div>

      <!-- MOBILE RESPONSIVE DRAWER -->
      <div id="mobile-nav-drawer" class="hidden xl:hidden border-t border-slate-100 py-3 space-y-1 bg-white">
        <a href="#home" onclick="navigateTo('home'); toggleMobileMenu(); return false;" class="block px-3 py-2 rounded-lg text-xs font-bold text-dark-900 hover:bg-slate-50">Home</a>
        <a href="#properties" onclick="navigateTo('properties'); toggleMobileMenu(); return false;" class="block px-3 py-2 rounded-lg text-xs font-bold text-dark-900 hover:bg-slate-50">Global Portfolio (${counts.total})</a>
        <a href="#about" onclick="navigateTo('about'); toggleMobileMenu(); return false;" class="block px-3 py-2 rounded-lg text-xs font-bold text-dark-900 hover:bg-slate-50">About Bioque Estates</a>
        <a href="#services" onclick="navigateTo('services'); toggleMobileMenu(); return false;" class="block px-3 py-2 rounded-lg text-xs font-bold text-dark-900 hover:bg-slate-50">Services</a>
        <a href="#contact" onclick="navigateTo('contact'); toggleMobileMenu(); return false;" class="block px-3 py-2 rounded-lg text-xs font-bold text-dark-900 hover:bg-slate-50">Contact & VIP Visits</a>
      </div>

    </div>
  </header>

  <!-- ==================== 1. PAGE: HOME ==================== -->
  <main id="view-home" class="page-view active flex-grow">
    
    <!-- HERO SECTION -->
    <section class="relative min-h-[60vh] sm:min-h-[75vh] flex items-center justify-center py-14 sm:py-24 overflow-hidden bg-dark-950">
      <div class="absolute inset-0 z-0">
        <img src="https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=2000&q=85" alt="Luxury Global Properties" class="w-full h-full object-cover object-center brightness-[0.55]" loading="eager">
        <div class="absolute inset-0 bg-gradient-to-t from-dark-950 via-dark-950/60 to-dark-950/40"></div>
      </div>

      <div class="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-white">
        
        <div class="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-dark-900/90 border border-[#D4AF37]/50 text-[#D4AF37] text-[10px] sm:text-xs font-bold uppercase tracking-[0.2em] mb-4 backdrop-blur-md">
          <span class="w-2 h-2 rounded-full bg-[#D4AF37] animate-pulse"></span>
          <span>NEW CHANDIGARH • TRI-CITY • DUBAI LUXURY</span>
        </div>

        <h1 class="font-display font-black text-3xl sm:text-5xl lg:text-6xl tracking-tight leading-[1.1] mb-3 text-white">
          Luxury Residences in <span class="text-gold-gradient">New Chandigarh, Tri-City & Dubai</span>
        </h1>

        <p class="text-slate-300 text-xs sm:text-base max-w-2xl mx-auto mb-8 font-normal leading-relaxed">
          Curated collection of Omaxe, flagship New Chandigarh developments, Tri-City high-rises, and exclusive Dubai waterfront residences in partnership with Springfield Properties.
        </p>

        <!-- HERO SEARCH BOX WITH WORKING TOGGLES -->
        <div class="bg-white/95 backdrop-blur-md rounded-2xl sm:rounded-3xl p-3 sm:p-5 shadow-2xl max-w-3xl mx-auto text-left border border-[#D4AF37]/30">
          
          <!-- WORKING FILTER TABS ON HERO -->
          <div class="flex items-center gap-1.5 sm:gap-2 mb-4 overflow-x-auto pb-1 no-scrollbar text-xs font-bold" id="hero-filter-tabs">
            <button onclick="setHomeFilter('All')" class="home-filter-tab active px-3 sm:px-4 py-1.5 rounded-full bg-dark-900 text-[#D4AF37] transition-all shrink-0 cursor-pointer" data-type="All">All (${counts.total})</button>
            <button onclick="setHomeFilter('Dubai')" class="home-filter-tab px-3 sm:px-4 py-1.5 rounded-full text-slate-600 hover:text-dark-900 transition-all shrink-0 cursor-pointer" data-type="Dubai">Dubai (${counts.dubai})</button>
            <button onclick="setHomeFilter('New Chandigarh')" class="home-filter-tab px-3 sm:px-4 py-1.5 rounded-full text-slate-600 hover:text-dark-900 transition-all shrink-0 cursor-pointer" data-type="New Chandigarh">New Chandigarh (${counts.newChd})</button>
            <button onclick="setHomeFilter('Tri-City')" class="home-filter-tab px-3 sm:px-4 py-1.5 rounded-full text-slate-600 hover:text-dark-900 transition-all shrink-0 cursor-pointer" data-type="Tri-City">Tri-City (${counts.triCity})</button>
            <button onclick="setHomeFilter('Villas')" class="home-filter-tab px-3 sm:px-4 py-1.5 rounded-full text-slate-600 hover:text-dark-900 transition-all shrink-0 cursor-pointer" data-type="Villas">Villas</button>
            <button onclick="setHomeFilter('Plots')" class="home-filter-tab px-3 sm:px-4 py-1.5 rounded-full text-slate-600 hover:text-dark-900 transition-all shrink-0 cursor-pointer" data-type="Plots">Plots</button>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-12 gap-2.5 sm:gap-3 items-center">
            <div class="sm:col-span-5">
              <label class="block text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-0.5 ml-1">Search Project or Location</label>
              <input type="text" id="home-search-input" placeholder="e.g. Opus One, Palm Jebel Ali, The Tiara..." class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-dark-900 placeholder-slate-400 focus:outline-none focus:border-[#D4AF37] focus:bg-white transition-all">
            </div>

            <div class="sm:col-span-4">
              <label class="block text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-0.5 ml-1">Category / Region</label>
              <select id="home-budget-select" class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-dark-900 focus:outline-none focus:border-[#D4AF37] focus:bg-white transition-all">
                <option value="All">All Portfolios (${counts.total})</option>
                <option value="New Chandigarh">New Chandigarh (${counts.newChd})</option>
                <option value="Tri-City">Tri-City (${counts.triCity})</option>
                <option value="Dubai">Dubai & UAE Luxury (${counts.dubai})</option>
              </select>
            </div>

            <div class="sm:col-span-3 pt-0.5 sm:pt-3">
              <button onclick="executeHomeSearch()" class="btn-springfield w-full py-2.5 rounded-lg text-xs uppercase tracking-wider font-extrabold flex items-center justify-center gap-1.5 shadow-sm cursor-pointer">
                <svg class="w-3.5 h-3.5 text-[#D4AF37]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
                <span>Search</span>
              </button>
            </div>
          </div>

        </div>

      </div>
    </section>

    <!-- TRUST STRIP -->
    <section class="bg-white border-b border-slate-100 py-6 sm:py-8">
      <div class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-5 text-center">
          <div class="p-2.5 sm:p-3.5 rounded-xl bg-slate-50 border border-slate-100">
            <span class="font-display text-xl sm:text-2xl font-extrabold text-[#D4AF37] block mb-0.5">${counts.total}+</span>
            <span class="text-[10px] sm:text-xs uppercase tracking-wider text-slate-500 font-bold">Curated Projects</span>
          </div>
          <div class="p-2.5 sm:p-3.5 rounded-xl bg-slate-50 border border-slate-100">
            <span class="font-display text-xl sm:text-2xl font-extrabold text-dark-900 block mb-0.5">3 Prime Hubs</span>
            <span class="text-[10px] sm:text-xs uppercase tracking-wider text-slate-500 font-bold">New Chd, Tri-City & Dubai</span>
          </div>
          <div class="p-2.5 sm:p-3.5 rounded-xl bg-slate-50 border border-slate-100">
            <span class="font-display text-xl sm:text-2xl font-extrabold text-[#D4AF37] block mb-0.5">100%</span>
            <span class="text-[10px] sm:text-xs uppercase tracking-wider text-slate-500 font-bold">RERA & Title Verified</span>
          </div>
          <div class="p-2.5 sm:p-3.5 rounded-xl bg-slate-50 border border-slate-100">
            <span class="font-display text-xl sm:text-2xl font-extrabold text-dark-900 block mb-0.5">0%</span>
            <span class="text-[10px] sm:text-xs uppercase tracking-wider text-slate-500 font-bold">Direct Developer Advisory</span>
          </div>
        </div>
      </div>
    </section>

    <!-- FEATURED PROPERTIES SECTION (FILTERED BY TOGGLE BUTTONS) -->
    <section class="py-12 sm:py-16 bg-[#FDFBF7] relative">
      <div class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
        
        <div class="flex flex-col sm:flex-row justify-between items-start sm:items-end mb-8 gap-3 border-b border-[#F0ECE1] pb-6">
          <div>
            <span class="text-[#AA8222] text-[10px] sm:text-xs uppercase tracking-[0.25em] font-bold block mb-1">Curated Inventory</span>
            <h2 class="font-display text-xl sm:text-3xl font-extrabold text-dark-900 tracking-tight">
              Featured Global & Tri-City Portfolio
            </h2>
            <p class="text-xs text-slate-500 mt-1">
              Showing <span id="home-featured-count" class="font-bold text-[#D4AF37]">${properties.length}</span> verified residences. Click any card to view full product details.
            </p>
          </div>
          <a href="/properties" class="btn-outline px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-1 shrink-0 cursor-pointer">
            <span>View Full Catalog (${counts.total})</span>
            <svg class="w-3.5 h-3.5 text-[#D4AF37]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
          </a>
        </div>

        <!-- DYNAMIC GRID -->
        <div id="home-properties-grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6">
          <!-- Injected via JavaScript -->
        </div>

      </div>
    </section>

  </main>

  <!-- ==================== 2. PAGE: PROPERTIES CATALOG ==================== -->
  <main id="view-properties" class="page-view flex-grow">
    <div class="bg-dark-950 text-white py-12 sm:py-16 border-b border-dark-850">
      <div class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
        <span class="text-[10px] sm:text-xs uppercase tracking-[0.2em] font-bold text-[#D4AF37] block mb-1">Global Inventory</span>
        <h1 class="font-display text-2xl sm:text-4xl font-black tracking-tight text-white mb-2">Complete Global Real Estate Portfolio</h1>
        <p class="text-slate-300 text-xs sm:text-sm max-w-2xl leading-relaxed">
          Explore all 36 curated developments across New Chandigarh, Tri-City, and Dubai with direct developer inventory.
        </p>
      </div>
    </div>

    <div class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-8">
      
      <!-- CATALOG FILTER TABS -->
      <div class="flex flex-col lg:flex-row justify-between items-stretch lg:items-center gap-4 mb-8">
        <div class="flex flex-wrap gap-2 items-center" id="catalog-filter-bar">
          <button onclick="setCatalogFilter('All')" class="catalog-filter-btn px-4 py-2 rounded-xl bg-dark-900 text-[#D4AF37] border border-[#D4AF37]/50 text-xs font-bold cursor-pointer" data-type="All">All (${counts.total})</button>
          <button onclick="setCatalogFilter('New Chandigarh')" class="catalog-filter-btn px-4 py-2 rounded-xl bg-white text-slate-700 border border-slate-200 text-xs font-bold cursor-pointer" data-type="New Chandigarh">🌳 New Chandigarh (${counts.newChd})</button>
          <button onclick="setCatalogFilter('Tri-City')" class="catalog-filter-btn px-4 py-2 rounded-xl bg-white text-slate-700 border border-slate-200 text-xs font-bold cursor-pointer" data-type="Tri-City">🏙️ Tri-City (${counts.triCity})</button>
          <button onclick="setCatalogFilter('Dubai')" class="catalog-filter-btn px-4 py-2 rounded-xl bg-white text-slate-700 border border-slate-200 text-xs font-bold cursor-pointer" data-type="Dubai">🇦🇪 Dubai (${counts.dubai})</button>
          <button onclick="setCatalogFilter('Villas')" class="catalog-filter-btn px-4 py-2 rounded-xl bg-white text-slate-700 border border-slate-200 text-xs font-bold cursor-pointer" data-type="Villas">Villas</button>
          <button onclick="setCatalogFilter('Plots')" class="catalog-filter-btn px-4 py-2 rounded-xl bg-white text-slate-700 border border-slate-200 text-xs font-bold cursor-pointer" data-type="Plots">Plots</button>
        </div>

        <div class="w-full lg:w-72">
          <input type="text" id="catalog-search-input" oninput="filterCatalog()" placeholder="Search projects or locations..." class="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-[#D4AF37] focus:outline-none bg-white">
        </div>
      </div>

      <!-- CATALOG GRID -->
      <div id="catalog-properties-grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <!-- Injected via JS -->
      </div>
    </div>
  </main>

  <!-- ==================== 3. PAGE: DEDICATED FULL PRODUCT PAGE ==================== -->
  <main id="view-property-detail" class="page-view flex-grow">
    <div class="bg-white border-b border-slate-200 py-3 px-3 sm:px-8 text-xs text-slate-500">
      <div class="max-w-7xl mx-auto flex items-center space-x-2">
        <a href="#home" onclick="navigateTo('home'); return false;" class="hover:text-dark-900">Home</a>
        <span>/</span>
        <a href="#properties" onclick="navigateTo('properties'); return false;" class="hover:text-dark-900">Portfolio</a>
        <span>/</span>
        <span id="detail-breadcrumb-type" class="text-[#AA8222] font-bold">Region</span>
        <span>/</span>
        <span id="detail-breadcrumb-title" class="text-dark-900 font-bold truncate">Property Overview</span>
      </div>
    </div>

    <div class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-8 sm:py-10">
      
      <div class="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-4 pb-6 border-b border-slate-200">
        <div>
          <div class="flex flex-wrap items-center gap-2 mb-2.5">
            <span id="detail-region-badge" class="px-3 py-1 rounded-full bg-dark-900 text-[#D4AF37] text-xs font-bold uppercase tracking-wider border border-[#D4AF37]/30">
              Region
            </span>
            <span id="detail-type-badge" class="px-3 py-1 rounded-full bg-amber-50 text-[#AA8222] border border-[#D4AF37]/40 text-xs font-bold uppercase tracking-wider">
              Residential
            </span>
            <span class="px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold uppercase tracking-wider">
              Active Portfolio
            </span>
          </div>
          <h1 id="detail-title" class="font-display font-black text-2xl sm:text-4xl text-dark-900 tracking-tight">
            Property Title
          </h1>
          <p id="detail-address" class="text-xs sm:text-sm text-slate-500 mt-1.5 flex items-center gap-1">
            <span class="text-[#D4AF37]">📍</span> Address
          </p>
        </div>

        <div class="flex items-center gap-3">
          <div class="bg-amber-50/60 border border-[#D4AF37]/30 px-5 py-3 rounded-2xl">
            <span class="text-[9px] uppercase font-bold text-slate-500 block">Investment Pricing</span>
            <span id="detail-price-badge" class="font-display font-black text-xl sm:text-2xl text-dark-900">
              ₹ Price
            </span>
          </div>
          <a id="detail-wa-link" href="#" target="_blank" class="px-5 py-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-sm flex items-center gap-2">
            <span>💬</span> WhatsApp
          </a>
        </div>
      </div>

      <!-- GALLERY & SPECS GRID -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-8 mt-8">
        
        <div class="lg:col-span-2 space-y-8">
          
          <!-- IMAGE VIEWER -->
          <div class="space-y-3">
            <div class="relative h-[320px] sm:h-[440px] rounded-2xl overflow-hidden bg-dark-950 shadow-md">
              <img id="detail-main-image" src="" alt="Property" class="w-full h-full object-cover">
              <div class="absolute bottom-3 left-3 bg-dark-950/80 backdrop-blur-md px-3 py-1.5 rounded-lg text-[#D4AF37] text-xs font-bold border border-[#D4AF37]/30">
                Verified Architectural Asset
              </div>
            </div>
            <div id="detail-thumbnails-strip" class="flex gap-2.5 overflow-x-auto pb-1 no-scrollbar">
              <!-- Injected via JS -->
            </div>
          </div>

          <!-- OVERVIEW -->
          <div class="springfield-card p-6 sm:p-8">
            <h3 class="font-display font-extrabold text-xl text-dark-900 mb-4">Architectural Overview</h3>
            <p id="detail-description" class="text-slate-600 text-xs sm:text-sm leading-relaxed whitespace-pre-line"></p>
            
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-6 border-t border-slate-100 text-xs">
              <div class="bg-slate-50 p-3 rounded-xl"><span class="text-slate-400 block text-[9px] uppercase font-bold">Sizes</span><span id="detail-sizes" class="font-bold text-dark-900">-</span></div>
              <div class="bg-slate-50 p-3 rounded-xl"><span class="text-slate-400 block text-[9px] uppercase font-bold">Status</span><span id="detail-status" class="font-bold text-dark-900">-</span></div>
              <div class="bg-slate-50 p-3 rounded-xl"><span class="text-slate-400 block text-[9px] uppercase font-bold">Possession</span><span id="detail-possession" class="font-bold text-dark-900">-</span></div>
              <div class="bg-slate-50 p-3 rounded-xl"><span class="text-slate-400 block text-[9px] uppercase font-bold">Advisory</span><span class="font-bold text-emerald-700">✓ Authorized</span></div>
            </div>
          </div>

          <!-- UNITS & AMENITIES -->
          <div id="detail-units-card" class="springfield-card p-6 sm:p-8">
            <h4 class="font-display font-extrabold text-lg text-dark-900 mb-4">Available Typologies</h4>
            <div id="detail-units-list" class="grid grid-cols-1 sm:grid-cols-2 gap-2.5"></div>
          </div>

          <div id="detail-amenities-card" class="springfield-card p-6 sm:p-8">
            <h4 class="font-display font-extrabold text-lg text-dark-900 mb-4">Enclave Amenities</h4>
            <div id="detail-amenities-list" class="grid grid-cols-1 sm:grid-cols-2 gap-2.5"></div>
          </div>

        </div>

        <!-- RIGHT COL: BOOKING FORM -->
        <div class="space-y-6">
          <div class="springfield-card p-6 sm:p-8 border-2 border-[#D4AF37]/20 sticky top-28 bg-white shadow-xl">
            <span class="text-[10px] font-black text-[#D4AF37] uppercase tracking-widest block mb-1">VIP Consultation</span>
            <h3 class="font-display font-extrabold text-xl text-dark-900 mb-1">Schedule Private Tour</h3>
            <p class="text-xs text-slate-500 mb-6">Arrange an in-person site inspection or online walkthrough with our senior advisory desk.</p>

            <form id="detailSiteVisitForm" onsubmit="handleSiteVisitSubmit(event)" class="space-y-3.5">
              <input type="hidden" id="form-prop-title" value="">
              <div><label class="block text-[10px] font-bold uppercase text-slate-600 mb-1">Your Name</label><input type="text" id="contact-name" required placeholder="e.g. Rajiv Kumar" class="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"></div>
              <div><label class="block text-[10px] font-bold uppercase text-slate-600 mb-1">Phone Number</label><input type="tel" id="contact-phone" required placeholder="e.g. +91 98886 26786" class="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"></div>
              <div><label class="block text-[10px] font-bold uppercase text-slate-600 mb-1">Preferred Time</label><input type="datetime-local" id="contact-datetime" class="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-[#D4AF37] focus:outline-none"></div>
              <button type="submit" id="contact-submit-btn" class="w-full btn-gold py-3.5 rounded-xl text-xs uppercase tracking-wider font-extrabold shadow-md cursor-pointer">Confirm Site Visit</button>
              <div id="contact-feedback" class="hidden text-center text-xs font-bold pt-1"></div>
            </form>
          </div>
        </div>

      </div>
    </div>
  </main>

  <!-- ==================== 4. PAGE: ABOUT ==================== -->
  <main id="view-about" class="page-view flex-grow">
    <div class="bg-dark-950 text-white py-16 border-b border-dark-850">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <span class="text-xs font-bold text-[#D4AF37] uppercase tracking-widest block mb-2">Corporate Profile</span>
        <h1 class="font-display text-3xl sm:text-5xl font-black text-white">About Bioque Estates International Pvt. Ltd.</h1>
      </div>
    </div>
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
        <div class="space-y-6 text-sm text-slate-700 leading-relaxed">
          <h2 class="font-display text-2xl sm:text-3xl font-extrabold text-dark-900">Unmatched Advisory Across Flagship Corridors</h2>
          <p>Headquartered on Madhya Marg in Chandigarh, <strong>Bioque Estates International Pvt. Ltd.</strong> bridges northern India's premier luxury corridor (Omaxe New Chandigarh, DLF, and Tri-City high-rises) with global ultra-luxury waterfront residences in Dubai.</p>
          <p>In exclusive partnership with <strong>Springfield Properties UAE</strong>, our advisory desk provides seamless transaction execution, site inspections, and portfolio management for NRI and high-net-worth investors looking to diversify into tax-free Dubai assets.</p>
        </div>
        <div class="springfield-card p-8 border border-slate-200">
          <img src="${LOGO_URL}" alt="Bioque Estates" class="h-16 w-auto object-contain mb-6">
          <h3 class="text-xl font-bold text-dark-900 mb-1">Corporate Headquarters</h3>
          <p class="text-xs font-bold text-[#AA8222] uppercase tracking-wider mb-4">SCO 118-119, Level II, Madhya Marg, Sector 8-C, Chandigarh</p>
          <p class="text-xs text-slate-600 mb-4">📞 ${PHONE_DISPLAY} | ✉️ estatesbioque@gmail.com</p>
        </div>
      </div>
    </div>
  </main>

  <!-- ==================== 5. PAGE: SERVICES ==================== -->
  <main id="view-services" class="page-view flex-grow">
    <div class="bg-dark-950 text-white py-16 border-b border-dark-850">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <span class="text-xs font-bold text-[#D4AF37] uppercase tracking-widest block mb-2">Our Capabilities</span>
        <h1 class="font-display text-3xl sm:text-5xl font-black text-white">Global Advisory Services</h1>
      </div>
    </div>
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
      <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div class="springfield-card p-8"><h3 class="text-xl font-bold text-dark-900 mb-2">🌳 New Chandigarh Enclaves</h3><p class="text-slate-600 text-xs">Priority access to Omaxe, DLF, Riseonic, and Eco City developments.</p></div>
        <div class="springfield-card p-8"><h3 class="text-xl font-bold text-dark-900 mb-2">🏙️ Tri-City Portfolios</h3><p class="text-slate-600 text-xs">Curated high-rises in Mohali, Zirakpur, and Chandigarh (Homeland, Jubilee, Motiaz).</p></div>
        <div class="springfield-card p-8"><h3 class="text-xl font-bold text-dark-900 mb-2">🇦🇪 Dubai Waterfront</h3><p class="text-slate-600 text-xs">Direct Springfield Properties partnership for Palm Jebel Ali and Golden Visa advisory.</p></div>
      </div>
    </div>
  </main>

  <!-- ==================== 6. PAGE: CONTACT ==================== -->
  <main id="view-contact" class="page-view flex-grow">
    <div class="bg-dark-950 text-white py-16 border-b border-dark-850">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <span class="text-xs font-bold text-[#D4AF37] uppercase tracking-widest block mb-2">Connect</span>
        <h1 class="font-display text-3xl sm:text-5xl font-black text-white">Private Advisory Desk</h1>
      </div>
    </div>
    <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
      <div class="springfield-card p-8 sm:p-10">
        <h3 class="font-display font-extrabold text-2xl text-dark-900 mb-4">Request Consultation</h3>
        <p class="text-xs text-slate-500 mb-6">Call our advisory desk directly at <strong class="text-dark-900">${PHONE_DISPLAY}</strong> or email <strong class="text-[#D4AF37]">estatesbioque@gmail.com</strong>.</p>
        <a href="https://wa.me/${PHONE_RAW}" target="_blank" class="btn-gold py-3.5 px-6 rounded-xl text-xs font-extrabold uppercase tracking-wider inline-flex items-center gap-2">
          <span>💬</span> Chat With Principal Broker on WhatsApp
        </a>
      </div>
    </div>
  </main>

  <!-- FOOTER -->
  <footer class="bg-dark-950 text-slate-400 text-xs border-t border-dark-850 pt-16 pb-12">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="grid grid-cols-1 md:grid-cols-4 gap-10 pb-12 border-b border-dark-850">
        <div>
          <div class="flex items-center space-x-3 mb-4">
            <img src="${LOGO_URL}" alt="Bioque Estates" class="h-12 w-auto object-contain">
            <div><span class="font-display text-base font-bold text-[#D4AF37] block">BIOQUE ESTATES INTERNATIONAL</span><span class="text-[8px] uppercase tracking-widest text-[#C59E2B] block font-bold">Pvt. Ltd.</span></div>
          </div>
          <p class="text-xs text-slate-400 leading-relaxed">Premier luxury real estate advisory spanning New Chandigarh, Tri-City, and Dubai in partnership with Springfield Properties.</p>
        </div>
        <div>
          <h4 class="text-white font-bold uppercase text-xs mb-3">Regions</h4>
          <ul class="space-y-2">
            <li><a href="#properties" onclick="navigateTo('properties'); setCatalogFilter('New Chandigarh');" class="hover:text-[#D4AF37]">New Chandigarh</a></li>
            <li><a href="#properties" onclick="navigateTo('properties'); setCatalogFilter('Tri-City');" class="hover:text-[#D4AF37]">Tri-City</a></li>
            <li><a href="#properties" onclick="navigateTo('properties'); setCatalogFilter('Dubai');" class="hover:text-[#D4AF37]">Dubai & UAE</a></li>
          </ul>
        </div>
        <div>
          <h4 class="text-white font-bold uppercase text-xs mb-3">Headquarters</h4>
          <p class="text-slate-300">SCO 118-119, Level II, Madhya Marg, Sector 8-C, Chandigarh</p>
          <p class="mt-2 text-slate-300">📞 ${PHONE_DISPLAY}</p>
          <p class="text-[#D4AF37]">✉️ estatesbioque@gmail.com</p>
        </div>
        <div>
          <h4 class="text-white font-bold uppercase text-xs mb-3">UAE Partner</h4>
          <p class="text-slate-300">Springfield Properties</p>
          <p class="text-slate-400 text-[11px] mt-1">Dubai Waterfront, UAE</p>
        </div>
      </div>
      <div class="pt-8 text-center text-slate-500 text-[11px]">
        © \${new Date().getFullYear()} Bioque Estates International Pvt. Ltd. All rights reserved.
      </div>
    </div>
  </footer>

  <!-- SCRIPT LOGIC: DYNAMIC WORKING TOGGLES, PRODUCT PAGES, REGION DETECTION -->
  <script>
    const LIVE_PROPERTIES = ${propertiesJson};
    let currentCategoryFilter = 'All';

    function parseConfigs(p) {
      if (!p.configurations) return { units: [], sizes: '', status: '', possession: '', amenities: [] };
      if (typeof p.configurations === 'string') {
        try { return JSON.parse(p.configurations); } catch(e) { return { units: [], sizes: '', status: '', possession: '', amenities: [] }; }
      }
      return p.configurations;
    }

    function toggleMobileMenu() {
      document.getElementById('mobile-nav-drawer')?.classList.toggle('hidden');
    }

    function navigateTo(viewId, extraParam) {
      document.querySelectorAll('.page-view').forEach(el => el.classList.remove('active'));
      const target = document.getElementById('view-' + viewId);
      if (target) {
        target.classList.add('active');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }

      if (viewId === 'property-detail' && extraParam) {
        renderPropertyDetail(extraParam);
        history.pushState(null, '', '#property-' + extraParam);
      } else {
        history.pushState(null, '', '#' + viewId);
      }

      document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('text-[#D4AF37]', 'border-[#D4AF37]');
        link.classList.add('border-transparent');
      });
      const activeNav = document.querySelector(\`.nav-link[data-target="\${viewId}"]\`);
      if (activeNav) {
        activeNav.classList.add('text-[#D4AF37]', 'border-[#D4AF37]');
        activeNav.classList.remove('border-transparent');
      }
    }

    function createPropertyCard(p) {
      const cfg = parseConfigs(p);
      const unitsSnippet = cfg.units && cfg.units.length > 0 ? cfg.units.slice(0, 2).join(' • ') : (cfg.sizes || '');
      const mainImg = p.image_url || 'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=1200&q=85';
      const region = p.region || 'New Chandigarh';
      const regionBadge = region === 'Dubai' ? '🇦🇪 Dubai Luxury' : (region === 'Tri-City' ? '🏙️ Tri-City Flagship' : '🌳 New Chandigarh');

      return \`
        <div class="springfield-card overflow-hidden flex flex-col group cursor-pointer" onclick="window.location.href='/properties/' + '\${p.id}'">
          <div class="relative aspect-[16/10] overflow-hidden bg-slate-100">
            <img src="\${mainImg}" alt="\${p.title}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy">
            <div class="absolute top-2.5 left-2.5 flex flex-wrap gap-1.5">
              <span class="bg-dark-900/95 backdrop-blur text-[#D4AF37] text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-md shadow-xs border border-[#D4AF37]/30">
                \${regionBadge}
              </span>
              <span class="bg-white/95 text-slate-800 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md shadow-xs">
                \${p.property_type || 'Residential'}
              </span>
            </div>
            \${p.price ? \`
              <div class="absolute bottom-2.5 left-2.5">
                <span class="bg-dark-900/95 text-[#D4AF37] font-extrabold text-xs px-2.5 py-1 rounded-md shadow-sm border border-[#D4AF37]/20">
                  \${p.price}
                </span>
              </div>
            \` : ''}
          </div>

          <div class="p-3.5 sm:p-4 flex-1 flex flex-col">
            <a href="/properties/\${p.id}">
              <h3 class="font-display font-extrabold text-dark-900 text-sm sm:text-base mb-1 line-clamp-1 group-hover:text-[#AA8222] transition-colors">\${p.title}</h3>
            </a>
            
            \${unitsSnippet ? \`<div class="text-[11px] font-bold text-[#AA8222] mb-1.5 line-clamp-1">\${unitsSnippet}</div>\` : ''}
            
            <p class="text-slate-500 text-[11px] leading-relaxed mb-3 line-clamp-2 font-normal flex-grow">\${p.description || ''}</p>

            <div class="flex items-center gap-1 text-slate-400 text-[10px] mb-3 truncate">
              <span class="text-[#D4AF37]">📍</span>
              <span class="truncate">\${p.address || ''}</span>
            </div>

            <div class="pt-2.5 border-t border-slate-100 flex items-center gap-2">
              <a href="/properties/\${p.id}" onclick="event.stopPropagation();" class="flex-1 btn-gold text-[10px] py-1.5 rounded-lg uppercase tracking-wider font-extrabold shadow-xs text-center inline-block cursor-pointer">
                View Details
              </a>
              <a href="https://wa.me/${PHONE_RAW}?text=Hi%20Bioque%20Estates,%20I%20am%20interested%20in%20\${encodeURIComponent(p.title)}" target="_blank" onclick="event.stopPropagation();" class="p-1.5 rounded-lg border border-emerald-500/40 text-emerald-700 hover:bg-emerald-50 transition-colors" title="Chat on WhatsApp">
                💬
              </a>
            </div>
          </div>
        </div>
      \`;
    }

    function renderGrids() {
      const homeGrid = document.getElementById('home-properties-grid');
      if (homeGrid) {
        homeGrid.innerHTML = LIVE_PROPERTIES.slice(0, 9).map(createPropertyCard).join('');
      }
      filterCatalog();
    }

    function setHomeFilter(category) {
      document.querySelectorAll('.home-filter-tab').forEach(btn => {
        if (btn.dataset.type === category) {
          btn.classList.add('bg-dark-900', 'text-[#D4AF37]');
          btn.classList.remove('text-slate-600');
        } else {
          btn.classList.remove('bg-dark-900', 'text-[#D4AF37]');
          btn.classList.add('text-slate-600');
        }
      });

      const homeGrid = document.getElementById('home-properties-grid');
      if (homeGrid) {
        let filtered = LIVE_PROPERTIES.filter(p => {
          if (category === 'All') return true;
          if (category === 'Dubai') return p.region === 'Dubai';
          if (category === 'Tri-City') return p.region === 'Tri-City';
          if (category === 'New Chandigarh') return p.region === 'New Chandigarh';
          return (p.property_type || '').toLowerCase().includes(category.toLowerCase());
        });

        homeGrid.innerHTML = filtered.slice(0, 9).map(createPropertyCard).join('');
        const countDisplay = document.getElementById('home-featured-count');
        if (countDisplay) countDisplay.innerText = filtered.length;
      }
    }

    function executeHomeSearch() {
      const searchVal = (document.getElementById('home-search-input')?.value || '').toLowerCase().trim();
      const budgetSelect = document.getElementById('home-budget-select')?.value || 'All';
      
      currentCategoryFilter = budgetSelect;
      navigateTo('properties');
      
      const catalogInput = document.getElementById('catalog-search-input');
      if (catalogInput) catalogInput.value = searchVal;
      setCatalogFilter(budgetSelect);
    }

    function filterCatalog() {
      const catalogGrid = document.getElementById('catalog-properties-grid');
      const searchVal = (document.getElementById('catalog-search-input')?.value || '').toLowerCase().trim();

      if (catalogGrid) {
        let filtered = LIVE_PROPERTIES.filter(p => {
          const matchCategory = 
            currentCategoryFilter === 'All' ? true :
            currentCategoryFilter === 'Dubai' ? p.region === 'Dubai' :
            currentCategoryFilter === 'New Chandigarh' ? p.region === 'New Chandigarh' :
            currentCategoryFilter === 'Tri-City' ? p.region === 'Tri-City' :
            (p.property_type || '').toLowerCase().includes(currentCategoryFilter.toLowerCase());

          const matchSearch = !searchVal || 
            (p.title || '').toLowerCase().includes(searchVal) ||
            (p.description || '').toLowerCase().includes(searchVal) ||
            (p.address || '').toLowerCase().includes(searchVal);

          return matchCategory && matchSearch;
        });

        if (filtered.length === 0) {
          catalogGrid.innerHTML = \`<div class="col-span-3 py-10 text-center text-slate-400 text-xs">No properties match your search criteria.</div>\`;
        } else {
          catalogGrid.innerHTML = filtered.map(createPropertyCard).join('');
        }
      }
    }

    function setCatalogFilter(category) {
      currentCategoryFilter = category;
      document.querySelectorAll('.catalog-filter-btn').forEach(btn => {
        if (btn.dataset.type === category) {
          btn.classList.add('bg-dark-900', 'text-[#D4AF37]', 'border-[#D4AF37]/50');
          btn.classList.remove('bg-white', 'text-slate-700', 'border-slate-200');
        } else {
          btn.classList.remove('bg-dark-900', 'text-[#D4AF37]', 'border-[#D4AF37]/50');
          btn.classList.add('bg-white', 'text-slate-700', 'border-slate-200');
        }
      });
      filterCatalog();
    }

    function renderPropertyDetail(propId) {
      const p = LIVE_PROPERTIES.find(item => item.id === propId) || LIVE_PROPERTIES[0];
      if (!p) return;

      const cfg = parseConfigs(p);
      const region = p.region || 'New Chandigarh';

      document.getElementById('detail-breadcrumb-type').innerText = region;
      document.getElementById('detail-breadcrumb-title').innerText = p.title;
      document.getElementById('detail-title').innerText = p.title;
      document.getElementById('detail-address').innerText = p.address || 'New Chandigarh / Dubai';
      document.getElementById('detail-description').innerText = p.description || '';
      document.getElementById('detail-price-badge').innerText = p.price || 'Price on Request';
      document.getElementById('detail-type-badge').innerText = p.property_type || 'Residential';
      document.getElementById('detail-region-badge').innerText = region === 'Dubai' ? '🇦🇪 Dubai' : (region === 'Tri-City' ? '🏙️ Tri-City' : '🌳 New Chandigarh');
      
      document.getElementById('detail-sizes').innerText = cfg.sizes || 'Custom Layouts';
      document.getElementById('detail-status').innerText = cfg.status || 'Active';
      document.getElementById('detail-possession').innerText = cfg.possession || 'Ready / Handover';

      const img = p.image_url || 'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=1200&q=85';
      document.getElementById('detail-main-image').src = img;

      const allImgs = (p.images && p.images.length > 0) ? p.images : [img];
      document.getElementById('detail-thumbnails-strip').innerHTML = allImgs.map((thumbUrl) => \`
        <button onclick="document.getElementById('detail-main-image').src='\${thumbUrl}'" class="w-16 h-12 rounded-lg overflow-hidden border border-slate-200 hover:border-[#D4AF37] shrink-0 transition-all cursor-pointer">
          <img src="\${thumbUrl}" class="w-full h-full object-cover" loading="lazy">
        </button>
      \`).join('');

      // Units
      const unitsList = document.getElementById('detail-units-list');
      if (cfg.units && cfg.units.length > 0) {
        unitsList.innerHTML = cfg.units.map(u => \`
          <div class="flex items-center gap-2 p-2.5 rounded-lg bg-slate-50 border border-slate-100 text-xs font-bold text-dark-900">
            <span class="text-[#D4AF37]">✦</span> \${u}
          </div>
        \`).join('');
        document.getElementById('detail-units-card').style.display = 'block';
      } else {
        document.getElementById('detail-units-card').style.display = 'none';
      }

      // Amenities
      const amenitiesList = document.getElementById('detail-amenities-list');
      if (cfg.amenities && cfg.amenities.length > 0) {
        amenitiesList.innerHTML = cfg.amenities.map(a => \`
          <div class="flex items-center gap-2 p-2.5 rounded-lg bg-slate-50 border border-slate-100 text-xs font-semibold text-slate-700">
            <span class="text-emerald-600 font-bold">✓</span> \${a}
          </div>
        \`).join('');
        document.getElementById('detail-amenities-card').style.display = 'block';
      } else {
        document.getElementById('detail-amenities-card').style.display = 'none';
      }

      document.getElementById('form-prop-title').value = p.title;
      document.getElementById('detail-wa-link').href = 'https://wa.me/${PHONE_RAW}?text=' + encodeURIComponent('Hi Bioque Estates, I am interested in ' + p.title + ' located at ' + p.address);
    }

    async function handleSiteVisitSubmit(e) {
      e.preventDefault();
      const btn = document.getElementById('contact-submit-btn');
      const feedback = document.getElementById('contact-feedback');
      const name = document.getElementById('contact-name').value.trim();
      const phone = document.getElementById('contact-phone').value.trim();
      const project = document.getElementById('form-prop-title').value;
      const datetime = document.getElementById('contact-datetime').value.trim();

      btn.disabled = true;
      btn.innerText = 'Submitting...';

      try {
        await fetch('/api/shared/landing-page/lead', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: '${userId}',
            name, phone,
            city: 'New Chandigarh',
            slug: 'index',
            custom_question_0: project,
            custom_question_1: datetime,
            custom_fields: { source_page: 'Site Visit Booking Form', project_name: project, scheduled_time: datetime }
          })
        });
        feedback.className = 'text-center text-xs font-bold text-emerald-600 pt-1 block';
        feedback.innerText = '✓ Site visit confirmed! Our senior advisor will call you shortly.';
        e.target.reset();
      } catch(err) {
        feedback.className = 'text-center text-xs font-bold text-emerald-600 pt-1 block';
        feedback.innerText = '✓ Your request has been received.';
      } finally {
        btn.disabled = false;
        btn.innerText = 'Confirm Site Visit';
      }
    }

    async function syncLiveInventory() {
      try {
        const res = await fetch('/api/shared/catalog?identifier=${userId}');
        if (res.ok) {
          const data = await res.json();
          if (data.success && Array.isArray(data.properties) && data.properties.length > 0) {
            LIVE_PROPERTIES.length = 0;
            LIVE_PROPERTIES.push(...data.properties);
            renderGrids();
          }
        }
      } catch (err) {
        console.log('Live sync active');
      }
    }

    window.addEventListener('DOMContentLoaded', () => {
      renderGrids();
      syncLiveInventory();

      const hash = window.location.hash.replace('#', '');
      if (hash.startsWith('property-')) {
        const propId = hash.replace('property-', '');
        navigateTo('property-detail', propId);
      } else if (['home', 'properties', 'about', 'services', 'contact'].includes(hash)) {
        navigateTo(hash);
      }
    });

    window.addEventListener('popstate', () => {
      const hash = window.location.hash.replace('#', '');
      if (hash.startsWith('property-')) {
        const propId = hash.replace('property-', '');
        navigateTo('property-detail', propId);
      } else if (['home', 'properties', 'about', 'services', 'contact'].includes(hash)) {
        navigateTo(hash);
      } else {
        navigateTo('home');
      }
    });
  </script>

</body>
</html>`;
}

updateBioqueWebsite().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
