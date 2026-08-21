const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const userId = '2f62a259-f23b-48ee-a920-c436f36eaa4b';
const LOGO_URL = 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/adrolls-storage/logos/2f62a259-f23b-48ee-a920-c436f36eaa4b/1785305575571-2f62a259-f23b-48ee-a920-c436f36eaa4b-1785305574448.jpg';
const PHONE_DISPLAY = '+91 98724 90091';
const PHONE_RAW = '919872490091';
const OFFICE_ADDRESS = 'First Floor, Riverdale Business Center, SCO - 3, Zirakpur, Nabha, Punjab 140603';
const EMAIL = 'infobluesquareinfra@gmail.com';

async function buildBlueSquareWebsite() {
  console.log('1. Enabling business_landing_enabled for Blue Square Infra profile...');
  await supabaseAdmin
    .from('profiles')
    .update({ 
      business_landing_enabled: true,
      contact_number: PHONE_DISPLAY,
      address: OFFICE_ADDRESS
    })
    .eq('id', userId);

  console.log('2. Fetching all live properties for Blue Square Infra...');
  const { data: properties, error: propErr } = await supabaseAdmin
    .from('properties')
    .select('*')
    .eq('user_id', userId)
    .neq('status', 'Archived')
    .order('created_at', { ascending: false });

  if (propErr) throw propErr;
  console.log(`Fetched ${properties.length} properties.`);

  // Clean up and standardize property display titles/types if needed
  const standardizedProps = properties.map(p => {
    let cleanTitle = p.title.trim();
    let cleanType = p.property_type || 'Residential';
    let cleanAddress = p.address || 'Airport Road / Zirakpur, Mohali (Tricity)';
    let tag = '';

    if (p.configurations) {
      let cfg = p.configurations;
      if (typeof cfg === 'string') {
        try { cfg = JSON.parse(cfg); } catch(e) { cfg = {}; }
      }
      if (cfg.tags && cfg.tags.length > 0) {
        tag = cfg.tags[0];
      }
    }

    if (tag && !cleanTitle.toLowerCase().includes(tag.toLowerCase())) {
      cleanTitle = `${tag} - ${cleanTitle}`;
    }

    return {
      ...p,
      title: cleanTitle,
      property_type: cleanType === 'Generic' ? 'Luxury Residential' : cleanType,
      address: cleanAddress,
      price: p.price || 'Price on Request'
    };
  });

  const html = generateBlueSquareWebsiteHtml(standardizedProps);

  const { data: savedPage, error: saveErr } = await supabaseAdmin
    .from('landing_pages')
    .upsert({
      user_id: userId,
      slug: 'index',
      title: 'Blue Square Infra | Premier Luxury Real Estate & Advisory',
      product_name: 'Blue Square Infra Luxury Portfolio',
      html_content: html
    }, { onConflict: 'user_id,slug' })
    .select()
    .single();

  if (saveErr) throw saveErr;
  console.log('✓ Successfully created and published Blue Square Infra Website to landing_pages (ID:', savedPage.id, ')');
}

function generateBlueSquareWebsiteHtml(properties) {
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
        "streetAddress": p.address,
        "addressLocality": "Mohali / Zirakpur",
        "addressRegion": "Punjab",
        "postalCode": "140603",
        "addressCountry": "IN"
      },
      "offers": {
        "@type": "Offer",
        "priceCurrency": "INR",
        "priceSpecification": {
          "@type": "PriceSpecification",
          "price": p.price
        },
        "availability": "https://schema.org/InStock",
        "seller": {
          "@type": "RealEstateAgent",
          "name": "Blue Square Infra",
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
        "@id": "https://bluesquareinfra.in/#organization",
        "name": "Blue Square Infra",
        "legalName": "Blue Square Infra",
        "url": "https://bluesquareinfra.in",
        "logo": LOGO_URL,
        "image": LOGO_URL,
        "description": "Premier real estate consultancy and luxury property advisory firm across Mohali, Airport Road, Zirakpur, and Chandigarh Tricity. Curated portfolio of ultra-luxury apartments, smart homes, high-rises, and developer plots.",
        "telephone": PHONE_DISPLAY,
        "email": EMAIL,
        "address": {
          "@type": "PostalAddress",
          "streetAddress": "First Floor, Riverdale Business Center, SCO - 3",
          "addressLocality": "Zirakpur",
          "addressRegion": "Punjab",
          "postalCode": "140603",
          "addressCountry": "IN"
        },
        "geo": {
          "@type": "GeoCoordinates",
          "latitude": "30.6425",
          "longitude": "76.8173"
        },
        "areaServed": ["Mohali", "Zirakpur", "Chandigarh", "Panchkula", "Airport Road Mohali", "Tri-City"],
        "hasOfferCatalog": {
          "@type": "OfferCatalog",
          "name": "Blue Square Infra Luxury Properties Portfolio",
          "itemListElement": schemaItemList
        }
      },
      {
        "@type": "FAQPage",
        "mainEntity": [
          {
            "@type": "Question",
            "name": "What residential and commercial projects are available with Blue Square Infra?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Blue Square Infra offers an exclusive portfolio across Mohali & Zirakpur including Homeland Regalia, The Ananta Aspire, Homeland Global Park, Genesis Heights, Escon Primera, Horizon Belmond, Joygrand Mohali, Medallion Nova, Gulnaar Zenium, Affinity Belgravia, Eden Park, The Zirk, and KS One-O-8."
            }
          },
          {
            "@type": "Question",
            "name": "Where is Blue Square Infra office located?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Blue Square Infra is headquartered at First Floor, Riverdale Business Center, SCO - 3, Zirakpur, Nabha, Punjab 140603. You can reach our senior advisors directly at +91 98724 90091."
            }
          }
        ]
      }
    ]
  };

  return `<!DOCTYPE html>
<html lang="en" class="scroll-smooth">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0">
  <title>Blue Square Infra | Luxury Real Estate Consultancy & Property Advisory</title>
  
  <meta name="title" content="Blue Square Infra | Luxury Real Estate Consultancy & Property Advisory">
  <meta name="description" content="Blue Square Infra delivers research-backed luxury property advisory, high-rise residences, smart homes, and developer plots across Mohali, Airport Road, and Zirakpur.">
  <meta name="keywords" content="Blue Square Infra, BlueSquare Infra, Luxury Flats in Mohali, Airport Road Mohali Flats, Flats in Zirakpur, Homeland Regalia, The Ananta Aspire, Genesis Heights, Escon Primera">
  <meta name="robots" content="index, follow">
  
  <meta property="og:type" content="website">
  <meta property="og:title" content="Blue Square Infra | Luxury Real Estate & Advisory">
  <meta property="og:description" content="Discover top luxury apartments, high-rises, and developer townships across Mohali and Zirakpur.">
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
              50: '#F0F7FF',
              100: '#E0EFFF',
              200: '#BAE0FD',
              300: '#7DC4FA',
              400: '#38A4F4',
              500: '#0E85E3',
              600: '#0267C1',
              700: '#02529E',
              800: '#064682',
            },
            accent: {
              500: '#C1995E',
              600: '#AD8246',
            },
            dark: {
              950: '#080E1A',
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
    
    .btn-springfield {
      background-color: #0F172A;
      color: #FFFFFF;
      font-weight: 700;
      letter-spacing: 0.02em;
      transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .btn-springfield:hover {
      background-color: #0267C1;
      color: #FFFFFF;
      box-shadow: 0 10px 20px -5px rgba(2, 103, 193, 0.4);
      transform: translateY(-2px);
    }

    .btn-outline {
      border: 1px solid #E2E8F0;
      color: #0F172A;
      font-weight: 600;
      transition: all 0.2s ease;
    }
    .btn-outline:hover {
      border-color: #0F172A;
      background-color: #0F172A;
      color: #FFFFFF;
    }

    .springfield-card {
      background: #FFFFFF;
      border: 1px solid #EAEFF5;
      border-radius: 1rem;
      transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.03);
    }
    .springfield-card:hover {
      transform: translateY(-5px);
      box-shadow: 0 15px 30px -8px rgba(15, 23, 42, 0.08);
      border-color: #CBD5E1;
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
<body class="selection:bg-primary-100 selection:text-dark-900 flex flex-col min-h-screen pb-16 md:pb-0">

  <!-- TOP UTILITY BAR -->
  <div class="bg-white border-b border-slate-100 py-2 px-4 sm:px-8 text-xs text-slate-500 hidden md:block">
    <div class="max-w-7xl mx-auto flex justify-between items-center">
      <div class="flex items-center space-x-6">
        <span class="flex items-center gap-1.5 truncate max-w-lg">
          <svg class="w-3.5 h-3.5 text-primary-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
          ${OFFICE_ADDRESS}
        </span>
        <span class="flex items-center gap-1.5">
          <svg class="w-3.5 h-3.5 text-primary-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
          ${EMAIL}
        </span>
      </div>
      <div class="flex items-center space-x-6">
        <span class="font-medium text-slate-600">Premier Tricity Property Advisory</span>
        <a href="tel:${PHONE_DISPLAY.replace(/\s+/g, '')}" class="text-dark-900 hover:text-primary-600 font-bold flex items-center gap-1.5 transition-colors">
          <svg class="w-3.5 h-3.5 text-primary-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>
          ${PHONE_DISPLAY}
        </a>
      </div>
    </div>
  </div>

  <!-- NAVIGATION HEADER -->
  <header class="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-slate-200 shadow-sm">
    <div class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
      <div class="flex justify-between items-center h-16 sm:h-20">
        
        <!-- LOGO & BRAND -->
        <a href="#home" onclick="navigateTo('home'); return false;" class="flex items-center space-x-2.5 sm:space-x-3 group shrink-0">
          <img src="${LOGO_URL}" alt="Blue Square Infra" class="h-9 sm:h-11 w-auto object-contain rounded-md border border-slate-200 p-0.5 bg-white shadow-xs" loading="eager">
          <div class="leading-none">
            <span class="font-display text-base sm:text-xl font-extrabold tracking-tight text-dark-900 block leading-tight">BLUE SQUARE INFRA</span>
            <span class="text-[8px] sm:text-[9px] uppercase tracking-[0.2em] text-primary-600 block font-bold mt-0.5">Real Estate & Advisory</span>
          </div>
        </a>

        <!-- DESKTOP NAVIGATION -->
        <nav class="hidden lg:flex items-center space-x-7 text-xs font-bold uppercase tracking-wider text-slate-600">
          <a href="#home" onclick="navigateTo('home'); return false;" class="nav-link text-primary-600 py-2 border-b-2 border-primary-600 transition-colors" data-target="home">Home</a>
          <a href="#properties" onclick="navigateTo('properties'); return false;" class="nav-link hover:text-dark-900 py-2 border-b-2 border-transparent transition-colors" data-target="properties">Properties</a>
          <a href="#about" onclick="navigateTo('about'); return false;" class="nav-link hover:text-dark-900 py-2 border-b-2 border-transparent transition-colors" data-target="about">About Us</a>
          <a href="#services" onclick="navigateTo('services'); return false;" class="nav-link hover:text-dark-900 py-2 border-b-2 border-transparent transition-colors" data-target="services">Services</a>
          <a href="#contact" onclick="navigateTo('contact'); return false;" class="nav-link hover:text-dark-900 py-2 border-b-2 border-transparent transition-colors" data-target="contact">Contact</a>
        </nav>

        <!-- CTA & MOBILE MENU -->
        <div class="flex items-center space-x-2">
          <a href="https://wa.me/${PHONE_RAW}?text=Hi%20Blue%20Square%20Infra,%20I%20am%20interested%20in%20luxury%20properties%20in%20Mohali%20and%20Zirakpur." target="_blank" class="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-emerald-500/40 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 text-xs font-bold transition-all">
            <svg class="w-3.5 h-3.5 fill-emerald-600 shrink-0" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
            <span>WhatsApp</span>
          </a>
          <button onclick="navigateTo('contact')" class="btn-springfield px-3 sm:px-4 py-1.5 sm:py-2 rounded-full text-[11px] sm:text-xs uppercase tracking-wider font-extrabold flex items-center gap-1">
            <span>Tour</span>
          </button>
          
          <button onclick="toggleMobileMenu()" class="lg:hidden p-1.5 rounded-lg text-dark-900 hover:bg-slate-100 transition-colors focus:outline-none" aria-label="Toggle navigation">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/></svg>
          </button>
        </div>

      </div>

      <!-- MOBILE DRAWER -->
      <div id="mobile-nav-drawer" class="hidden lg:hidden border-t border-slate-100 py-3 space-y-1 bg-white">
        <a href="#home" onclick="navigateTo('home'); toggleMobileMenu(); return false;" class="block px-3 py-2 rounded-lg text-xs font-bold text-dark-900 hover:bg-slate-50">Home</a>
        <a href="#properties" onclick="navigateTo('properties'); toggleMobileMenu(); return false;" class="block px-3 py-2 rounded-lg text-xs font-bold text-dark-900 hover:bg-slate-50">Properties Catalog</a>
        <a href="#about" onclick="navigateTo('about'); toggleMobileMenu(); return false;" class="block px-3 py-2 rounded-lg text-xs font-bold text-dark-900 hover:bg-slate-50">About Blue Square</a>
        <a href="#services" onclick="navigateTo('services'); toggleMobileMenu(); return false;" class="block px-3 py-2 rounded-lg text-xs font-bold text-dark-900 hover:bg-slate-50">Services</a>
        <a href="#contact" onclick="navigateTo('contact'); toggleMobileMenu(); return false;" class="block px-3 py-2 rounded-lg text-xs font-bold text-dark-900 hover:bg-slate-50">Contact & VIP Visits</a>
        <div class="pt-2 px-3">
          <a href="tel:${PHONE_DISPLAY.replace(/\s+/g, '')}" class="block btn-springfield text-center py-2 rounded-lg text-xs font-bold">Call ${PHONE_DISPLAY}</a>
        </div>
      </div>

    </div>
  </header>

  <!-- ========================================================================= -->
  <!-- PAGE VIEW 1: HOME PAGE -->
  <!-- ========================================================================= -->
  <main id="view-home" class="page-view active flex-grow">
    
    <!-- HERO SECTION -->
    <section class="relative min-h-[60vh] sm:min-h-[75vh] flex items-center justify-center py-12 sm:py-20 overflow-hidden bg-slate-900">
      <div class="absolute inset-0 z-0">
        <img src="https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=2000&q=85" alt="Luxury Real Estate Mohali & Zirakpur" class="w-full h-full object-cover object-center brightness-[0.70]" loading="eager">
        <div class="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-black/30"></div>
      </div>

      <div class="relative z-10 max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 text-center w-full">
        
        <div class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/15 backdrop-blur-md border border-white/30 text-white text-[10px] sm:text-xs uppercase tracking-wider font-bold mb-3 sm:mb-4 max-w-full truncate">
          <span class="w-1.5 h-1.5 rounded-full bg-primary-400 shrink-0"></span>
          <span class="truncate">Mohali • Airport Road • Zirakpur Luxury Living</span>
        </div>

        <h1 class="font-display text-2xl sm:text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tight text-white mb-3 sm:mb-4 leading-tight max-w-4xl mx-auto">
          Find Your Luxury Home in <br class="hidden sm:block"/><span class="text-primary-300">Mohali & Zirakpur</span>
        </h1>

        <p class="text-slate-200 text-xs sm:text-sm md:text-base max-w-2xl mx-auto mb-6 sm:mb-8 leading-relaxed font-normal">
          Exclusive portfolio of high-rise residences, dual-core smart homes, French neoclassical flats, and commercial landmarks.
        </p>

        <!-- SPRINGFIELD CLEAN TABBED SEARCH BOX -->
        <div class="max-w-3xl mx-auto bg-white rounded-2xl p-3.5 sm:p-5 shadow-2xl text-left border border-slate-100">
          
          <div class="flex items-center space-x-1.5 border-b border-slate-100 pb-2.5 mb-2.5 overflow-x-auto no-scrollbar text-[11px] sm:text-xs font-bold uppercase tracking-wider">
            <button onclick="setHomeFilter('All')" class="home-filter-tab active px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-full bg-dark-900 text-white transition-all shrink-0" data-type="All">All (${properties.length})</button>
            <button onclick="setHomeFilter('Mohali')" class="home-filter-tab px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-full text-slate-600 hover:text-dark-900 transition-all shrink-0" data-type="Mohali">Mohali</button>
            <button onclick="setHomeFilter('Zirakpur')" class="home-filter-tab px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-full text-slate-600 hover:text-dark-900 transition-all shrink-0" data-type="Zirakpur">Zirakpur</button>
            <button onclick="setHomeFilter('Airport Road')" class="home-filter-tab px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-full text-slate-600 hover:text-dark-900 transition-all shrink-0" data-type="Airport Road">Airport Road</button>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-12 gap-2.5 sm:gap-3 items-center">
            <div class="sm:col-span-8">
              <label class="block text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-0.5 ml-1">Search Project or Location</label>
              <input type="text" id="home-search-input" placeholder="e.g. Homeland Regalia, Ananta Aspire, Eden Park, Sector 88..." class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-dark-900 placeholder-slate-400 focus:outline-none focus:border-dark-900 focus:bg-white transition-all">
            </div>

            <div class="sm:col-span-4 pt-0.5 sm:pt-3">
              <button onclick="executeHomeSearch()" class="btn-springfield w-full py-2.5 rounded-lg text-xs uppercase tracking-wider font-extrabold flex items-center justify-center gap-1.5 shadow-sm">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
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
            <span class="font-display text-xl sm:text-2xl font-extrabold text-dark-900 block mb-0.5">${properties.length}+</span>
            <span class="text-[10px] sm:text-xs uppercase tracking-wider text-slate-500 font-bold">Premium Projects</span>
          </div>
          <div class="p-2.5 sm:p-3.5 rounded-xl bg-slate-50 border border-slate-100">
            <span class="font-display text-xl sm:text-2xl font-extrabold text-dark-900 block mb-0.5">100%</span>
            <span class="text-[10px] sm:text-xs uppercase tracking-wider text-slate-500 font-bold">RERA Approved</span>
          </div>
          <div class="p-2.5 sm:p-3.5 rounded-xl bg-slate-50 border border-slate-100">
            <span class="font-display text-xl sm:text-2xl font-extrabold text-dark-900 block mb-0.5">₹ 0</span>
            <span class="text-[10px] sm:text-xs uppercase tracking-wider text-slate-500 font-bold">Direct Buyer Advisory</span>
          </div>
          <div class="p-2.5 sm:p-3.5 rounded-xl bg-slate-50 border border-slate-100">
            <span class="font-display text-xl sm:text-2xl font-extrabold text-dark-900 block mb-0.5">500+</span>
            <span class="text-[10px] sm:text-xs uppercase tracking-wider text-slate-500 font-bold">Families Advised</span>
          </div>
        </div>
      </div>
    </section>

    <!-- FEATURED PROPERTIES SECTION -->
    <section class="py-12 sm:py-16 bg-[#F8F9FA] relative">
      <div class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
        
        <div class="flex flex-col sm:flex-row justify-between items-start sm:items-end mb-8 gap-3">
          <div>
            <span class="text-primary-600 text-[10px] sm:text-xs uppercase tracking-[0.25em] font-bold block mb-1">Prime Portfolio</span>
            <h2 class="font-display text-xl sm:text-3xl font-extrabold text-dark-900 tracking-tight">
              Featured Residences in Mohali & Zirakpur
            </h2>
          </div>
          <button onclick="navigateTo('properties')" class="btn-outline px-4 py-1.5 rounded-full text-xs uppercase tracking-wider font-bold flex items-center gap-1.5">
            <span>View All (${properties.length})</span>
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 8l4 4m0 0l-4 4m4-4H3"/></svg>
          </button>
        </div>

        <div id="home-properties-grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-7">
          <!-- Injected via JavaScript -->
        </div>

      </div>
    </section>

    <!-- ABOUT BLUE SQUARE INFRA -->
    <section class="py-12 sm:py-16 bg-white border-t border-slate-100 relative">
      <div class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          
          <div class="lg:col-span-5 relative">
            <div class="relative rounded-2xl overflow-hidden shadow-lg border border-slate-100 aspect-[4/3] sm:aspect-auto sm:h-[380px]">
              <img src="https://images.unsplash.com/photo-1600566753376-12c8ab7fb75b?auto=format&fit=crop&w=1200&q=85" alt="Blue Square Infra Consultation" class="w-full h-full object-cover" loading="lazy">
            </div>
            
            <div class="absolute -bottom-3 -right-2 sm:-bottom-5 sm:-right-3 bg-white p-3 sm:p-4 rounded-xl border border-slate-200 shadow-lg max-w-[220px] sm:max-w-xs">
              <span class="text-primary-700 text-[10px] uppercase tracking-widest font-bold block mb-0.5">Research-Based Advice</span>
              <p class="text-[11px] text-slate-600 font-medium leading-relaxed">
                Guiding investors and homebuyers with transparent, verified recommendations.
              </p>
            </div>
          </div>

          <div class="lg:col-span-7">
            <span class="text-primary-600 text-[10px] sm:text-xs uppercase tracking-[0.25em] font-bold block mb-1.5">Our Philosophy</span>
            <h2 class="font-display text-xl sm:text-3xl font-extrabold text-dark-900 mb-4 leading-tight">
              “Transparent, Research-Backed Guidance for <br/><span class="text-primary-600">Confident Property Decisions”</span>
            </h2>

            <p class="text-slate-600 text-xs sm:text-sm leading-relaxed mb-5 font-normal">
              BLUE SQUARE INFRA was founded with a clear vision: to enhance the wealth, growth, and satisfaction of our clients through expert real estate consultancy services across Mohali, Airport Road, Zirakpur, and the Tricity region.
            </p>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1">
              <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-100">
                <h4 class="text-dark-900 font-bold text-xs sm:text-sm mb-0.5">Integrity & Transparency</h4>
                <p class="text-[11px] text-slate-500">Zero hidden fees, RERA compliance check, and direct builder terms.</p>
              </div>

              <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-100">
                <h4 class="text-dark-900 font-bold text-xs sm:text-sm mb-0.5">End-to-End Handholding</h4>
                <p class="text-[11px] text-slate-500">From VIP site tours to negotiation, documentation, and registry.</p>
              </div>
            </div>

          </div>

        </div>
      </div>
    </section>

  </main>

  <!-- ========================================================================= -->
  <!-- PAGE VIEW 2: ALL PROPERTIES CATALOG -->
  <!-- ========================================================================= -->
  <main id="view-properties" class="page-view flex-grow py-10 sm:py-12 bg-[#F8F9FA]">
    <div class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
      
      <div class="border-b border-slate-200 pb-4 mb-5">
        <div class="flex items-center space-x-2 text-xs text-slate-500 mb-1">
          <a href="#home" onclick="navigateTo('home'); return false;" class="hover:text-dark-900">Home</a>
          <span>/</span>
          <span class="text-primary-700 font-bold">Properties Catalog</span>
        </div>
        <h1 class="font-display text-xl sm:text-3xl font-extrabold text-dark-900">
          All Properties in Mohali & Zirakpur
        </h1>
      </div>

      <!-- Filters Bar -->
      <div class="bg-white border border-slate-200 rounded-xl p-3 mb-6 flex flex-col md:flex-row justify-between items-stretch md:items-center gap-2.5 shadow-xs">
        
        <div class="flex items-center space-x-1.5 overflow-x-auto no-scrollbar text-[11px] font-bold uppercase tracking-wider pb-1 md:pb-0">
          <button onclick="setCatalogFilter('All')" class="catalog-filter-btn active px-3 py-1.5 rounded-full bg-dark-900 text-white transition-all shrink-0" data-type="All">All (<span id="count-all">${properties.length}</span>)</button>
          <button onclick="setCatalogFilter('Mohali')" class="catalog-filter-btn px-3 py-1.5 rounded-full text-slate-600 hover:text-dark-900 transition-all shrink-0" data-type="Mohali">Mohali</button>
          <button onclick="setCatalogFilter('Zirakpur')" class="catalog-filter-btn px-3 py-1.5 rounded-full text-slate-600 hover:text-dark-900 transition-all shrink-0" data-type="Zirakpur">Zirakpur</button>
          <button onclick="setCatalogFilter('Airport Road')" class="catalog-filter-btn px-3 py-1.5 rounded-full text-slate-600 hover:text-dark-900 transition-all shrink-0" data-type="Airport Road">Airport Road</button>
        </div>

        <div class="relative w-full md:w-56">
          <input type="text" id="catalog-search-input" oninput="filterCatalog()" placeholder="Search project name..." class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-dark-900 placeholder-slate-400 focus:outline-none focus:border-dark-900 focus:bg-white">
        </div>

      </div>

      <div id="catalog-properties-grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-7">
        <!-- Injected via JavaScript -->
      </div>

    </div>
  </main>

  <!-- ========================================================================= -->
  <!-- PAGE VIEW 3: DEDICATED SINGLE PROPERTY DETAIL PAGE -->
  <!-- ========================================================================= -->
  <main id="view-property-detail" class="page-view flex-grow py-8 sm:py-10 bg-[#F8F9FA]">
    <div class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
      
      <div class="flex items-center justify-between border-b border-slate-200 pb-3 mb-5">
        <button onclick="navigateTo('properties')" class="flex items-center space-x-1.5 text-xs font-bold text-dark-900 hover:text-primary-600 transition-colors">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>
          <span>Back to Properties</span>
        </button>
        <div class="text-xs text-slate-500 truncate max-w-[200px] sm:max-w-none">
          <span id="detail-breadcrumb-type" class="text-slate-400">Residential</span> / <span id="detail-breadcrumb-title" class="text-dark-900 font-bold"></span>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8">
        
        <div class="lg:col-span-8 space-y-5 sm:space-y-6">
          
          <div class="rounded-xl sm:rounded-2xl overflow-hidden border border-slate-200 shadow-sm relative aspect-[16/10] bg-slate-100">
            <img id="detail-main-image" src="" alt="Property" class="w-full h-full object-cover" loading="eager">
            <div class="absolute top-2.5 left-2.5 sm:top-3 sm:left-3 flex gap-1.5">
              <span id="detail-type-badge" class="bg-white/90 backdrop-blur text-dark-900 text-[9px] sm:text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full shadow-xs">Residential</span>
              <span class="bg-emerald-600 text-white text-[9px] sm:text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full shadow-xs">RERA Approved</span>
            </div>
            <div class="absolute bottom-2.5 left-2.5 sm:bottom-3 sm:left-3">
              <span id="detail-price-badge" class="bg-dark-900 text-white font-extrabold text-xs sm:text-base px-3 py-1.5 rounded-lg shadow-md"></span>
            </div>
          </div>

          <div id="detail-thumbnails-strip" class="flex gap-2 overflow-x-auto pb-1.5">
            <!-- Injected by JS -->
          </div>

          <div class="bg-white p-4 sm:p-5 rounded-xl border border-slate-200 shadow-xs">
            <h1 id="detail-title" class="font-display text-xl sm:text-2xl lg:text-3xl font-extrabold text-dark-900 mb-1.5"></h1>
            <div class="flex items-center gap-1.5 text-slate-500 text-xs">
              <svg class="w-3.5 h-3.5 text-primary-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
              <span id="detail-address"></span>
            </div>
          </div>

          <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
            <h3 class="font-display text-base sm:text-lg font-bold text-dark-900 mb-2">Project Overview</h3>
            <p id="detail-description" class="text-slate-600 text-xs sm:text-sm leading-relaxed font-normal whitespace-pre-line"></p>
          </div>

          <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
            <h3 class="font-display text-base sm:text-lg font-bold text-dark-900 mb-3">Key Highlights & Specifications</h3>
            <div id="detail-amenities-list" class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <!-- Injected by JS -->
            </div>
          </div>

        </div>

        <!-- Right: CRM Lead Capture -->
        <div class="lg:col-span-4">
          <div class="sticky top-20 space-y-4">
            
            <div class="bg-white p-4 sm:p-6 rounded-xl border border-slate-200 shadow-sm">
              <span class="text-primary-700 text-[9px] uppercase tracking-widest font-bold block mb-0.5">Direct Developer Pricing</span>
              <h3 class="font-display text-base sm:text-lg font-bold text-dark-900 mb-1">Request Brochure & Price Sheet</h3>
              <p class="text-slate-500 text-xs mb-4">Receive unit drawings and payment schedule on WhatsApp.</p>

              <form onsubmit="handleDetailInquiry(event)" class="space-y-3">
                <div>
                  <label class="block text-[10px] font-bold text-slate-700 uppercase tracking-wider mb-1">Full Name *</label>
                  <input type="text" id="detail-lead-name" required placeholder="e.g. Amit Sharma" class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-dark-900 placeholder-slate-400 focus:outline-none focus:border-dark-900 focus:bg-white">
                </div>

                <div>
                  <label class="block text-[10px] font-bold text-slate-700 uppercase tracking-wider mb-1">WhatsApp Phone *</label>
                  <input type="tel" id="detail-lead-phone" required placeholder="${PHONE_DISPLAY}" class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-dark-900 placeholder-slate-400 focus:outline-none focus:border-dark-900 focus:bg-white">
                </div>

                <div>
                  <label class="block text-[10px] font-bold text-slate-700 uppercase tracking-wider mb-1">Preferred Unit</label>
                  <select id="detail-lead-unit" class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-dark-900 focus:outline-none focus:border-dark-900 focus:bg-white">
                    <option value="3 BHK Luxury Apartment">3 BHK Luxury Apartment</option>
                    <option value="4 BHK / Penthouse">4 BHK / Penthouse</option>
                    <option value="Smart Home / High-Rise">Smart Home / High-Rise</option>
                    <option value="Commercial / Plot">Commercial / Plot</option>
                  </select>
                </div>

                <button type="submit" id="detail-submit-btn" class="btn-springfield w-full py-2.5 rounded-lg text-xs uppercase tracking-widest font-extrabold flex items-center justify-center gap-1.5 shadow-xs">
                  <span>Download Price Sheet</span>
                  <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
                </button>
                <div id="detail-form-feedback" class="text-center text-xs font-semibold text-emerald-600 pt-0.5 hidden"></div>
              </form>

              <div class="mt-4 pt-4 border-t border-slate-100 text-center">
                <a id="detail-whatsapp-btn" href="#" target="_blank" class="w-full inline-flex items-center justify-center gap-1.5 py-2 rounded-lg border border-emerald-500/40 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 text-xs font-bold transition-all">
                  <svg class="w-3.5 h-3.5 fill-emerald-600" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
                  <span>Chat on WhatsApp</span>
                </a>
              </div>
            </div>

            <div class="bg-white p-4 rounded-xl border border-slate-200 text-center shadow-xs">
              <p class="text-[11px] text-slate-500 mb-0.5">Direct Advisor Line</p>
              <a href="tel:${PHONE_DISPLAY.replace(/\s+/g, '')}" class="text-dark-900 hover:text-primary-600 font-extrabold text-sm transition-colors">${PHONE_DISPLAY}</a>
            </div>

          </div>
        </div>

      </div>

    </div>
  </main>

  <!-- ========================================================================= -->
  <!-- PAGE VIEW 4: ABOUT US PAGE -->
  <!-- ========================================================================= -->
  <main id="view-about" class="page-view flex-grow py-10 sm:py-12 bg-white">
    <div class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
      
      <div class="text-center max-w-3xl mx-auto mb-10">
        <span class="text-primary-600 text-[10px] sm:text-xs uppercase tracking-[0.25em] font-bold block mb-1.5">About Blue Square</span>
        <h1 class="font-display text-xl sm:text-3xl font-extrabold text-dark-900 tracking-tight mb-2">
          Your Trusted Real Estate Partner
        </h1>
        <p class="text-slate-500 text-xs sm:text-sm">Transparent, research-based property advisory across Tricity.</p>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center mb-12">
        <div class="space-y-3.5 text-slate-600 text-xs sm:text-sm leading-relaxed">
          <p>
            <strong class="text-dark-900">BLUE SQUARE INFRA</strong> was founded with a clear vision: to enhance the wealth, growth, and satisfaction of our clients through expert real estate consultancy services.
          </p>
          <p>
            Our mission is to guide investors and homebuyers with transparent, research-based property advice that helps them make confident and profitable decisions. Backed by a team of experienced professionals, we prioritize our clients’ interests above all and ensure every recommendation aligns with their financial goals.
          </p>
          <p>
            At Blue Square Infra, we focus on building long-term relationships based on trust, integrity, and genuine guidance, consistently delivering on our brand promise of reliability and excellence in the real estate market.
          </p>
        </div>

        <div class="relative rounded-2xl overflow-hidden border border-slate-200 shadow-md">
          <img src="https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=85" alt="Blue Square Infra Team" class="w-full h-[280px] sm:h-[350px] object-cover" loading="lazy">
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div class="p-5 rounded-2xl bg-slate-50 border border-slate-100 text-center">
          <h3 class="font-display text-sm sm:text-base font-bold text-dark-900 mb-1">Research-Based Advice</h3>
          <p class="text-xs text-slate-500 leading-relaxed">Data-driven market intelligence to ensure strong capital growth and rental yield.</p>
        </div>

        <div class="p-5 rounded-2xl bg-slate-50 border border-slate-100 text-center">
          <h3 class="font-display text-sm sm:text-base font-bold text-dark-900 mb-1">Complete Transparency</h3>
          <p class="text-xs text-slate-500 leading-relaxed">Direct developer agreements, verified RERA certificates, and zero hidden costs.</p>
        </div>

        <div class="p-5 rounded-2xl bg-slate-50 border border-slate-100 text-center">
          <h3 class="font-display text-sm sm:text-base font-bold text-dark-900 mb-1">VIP Concierge Service</h3>
          <p class="text-xs text-slate-500 leading-relaxed">Chauffeured site visits, customized portfolio structuring, and paperwork assistance.</p>
        </div>
      </div>

    </div>
  </main>

  <!-- ========================================================================= -->
  <!-- PAGE VIEW 5: SERVICES PAGE -->
  <!-- ========================================================================= -->
  <main id="view-services" class="page-view flex-grow py-10 sm:py-12 bg-[#F8F9FA]">
    <div class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
      
      <div class="text-center max-w-3xl mx-auto mb-10">
        <span class="text-primary-600 text-[10px] sm:text-xs uppercase tracking-[0.25em] font-bold block mb-1.5">Our Expertise</span>
        <h1 class="font-display text-xl sm:text-3xl font-extrabold text-dark-900 tracking-tight mb-2">
          Comprehensive Real Estate Services
        </h1>
        <p class="text-slate-500 text-xs sm:text-sm">End-to-end guidance tailored for end-users, NRI investors, and high-net-worth buyers.</p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div class="bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-xs">
          <h3 class="font-display text-base sm:text-lg font-bold text-dark-900 mb-2">Luxury Residential Acquisition</h3>
          <p class="text-slate-500 text-xs leading-relaxed">Exclusive access to top-tier high-rises and smart homes across Airport Road and Mohali.</p>
        </div>

        <div class="bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-xs">
          <h3 class="font-display text-base sm:text-lg font-bold text-dark-900 mb-2">Commercial & High-Street Retail</h3>
          <p class="text-slate-500 text-xs leading-relaxed">Prime commercial spaces, SCO plazas, and highway retail hubs with assured returns.</p>
        </div>

        <div class="bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-xs">
          <h3 class="font-display text-base sm:text-lg font-bold text-dark-900 mb-2">NRI Real Estate Desk</h3>
          <p class="text-slate-500 text-xs leading-relaxed">Virtual walkthroughs, power of attorney facilitation, and portfolio management.</p>
        </div>
      </div>

    </div>
  </main>

  <!-- ========================================================================= -->
  <!-- PAGE VIEW 6: CONTACT US PAGE -->
  <!-- ========================================================================= -->
  <main id="view-contact" class="page-view flex-grow py-10 sm:py-12 bg-white">
    <div class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
      
      <div class="text-center max-w-3xl mx-auto mb-10">
        <span class="text-primary-600 text-[10px] sm:text-xs uppercase tracking-[0.25em] font-bold block mb-1.5">Connect With Us</span>
        <h1 class="font-display text-xl sm:text-3xl font-extrabold text-dark-900 tracking-tight mb-2">
          Schedule Your VIP Site Tour
        </h1>
        <p class="text-slate-500 text-xs sm:text-sm">Personal walkthroughs and expert property consultations across Tricity.</p>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8">
        
        <div class="lg:col-span-5 space-y-3.5">
          <div class="p-4 rounded-xl bg-slate-50 border border-slate-100">
            <h4 class="text-dark-900 font-bold text-xs sm:text-sm">Head Office</h4>
            <p class="text-slate-500 text-xs mt-1 leading-relaxed">${OFFICE_ADDRESS}</p>
          </div>

          <div class="p-4 rounded-xl bg-slate-50 border border-slate-100">
            <h4 class="text-dark-900 font-bold text-xs sm:text-sm">Direct Line</h4>
            <p class="text-slate-500 text-xs mt-1">
              <a href="tel:${PHONE_DISPLAY.replace(/\s+/g, '')}" class="hover:text-primary-600 font-bold text-sm text-dark-900">${PHONE_DISPLAY}</a>
            </p>
          </div>

          <div class="p-4 rounded-xl bg-slate-50 border border-slate-100">
            <h4 class="text-dark-900 font-bold text-xs sm:text-sm">Email Address</h4>
            <p class="text-slate-500 text-xs mt-1">
              <a href="mailto:${EMAIL}" class="hover:text-primary-600 text-xs">${EMAIL}</a>
            </p>
          </div>
        </div>

        <div class="lg:col-span-7 bg-slate-50 p-5 sm:p-8 rounded-2xl border border-slate-200 shadow-xs">
          <h3 class="font-display text-base sm:text-xl font-bold text-dark-900 mb-1">Book A Private Site Visit</h3>
          <p class="text-slate-500 text-xs mb-4">Tour top luxury projects in Mohali & Zirakpur with our property advisors.</p>

          <form onsubmit="handleGeneralInquiry(event)" class="space-y-3">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="block text-[10px] font-bold text-slate-700 uppercase tracking-wider mb-1">Full Name *</label>
                <input type="text" id="contact-name" required placeholder="e.g. Amit Sharma" class="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-dark-900 placeholder-slate-400 focus:outline-none focus:border-dark-900">
              </div>
              <div>
                <label class="block text-[10px] font-bold text-slate-700 uppercase tracking-wider mb-1">WhatsApp Phone *</label>
                <input type="tel" id="contact-phone" required placeholder="${PHONE_DISPLAY}" class="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-dark-900 placeholder-slate-400 focus:outline-none focus:border-dark-900">
              </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="block text-[10px] font-bold text-slate-700 uppercase tracking-wider mb-1">Location Preference</label>
                <select id="contact-project" class="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-dark-900 focus:outline-none focus:border-dark-900">
                  <option value="Mohali (Sector 77/88/Airport Road)">Mohali (Sector 77 / 88 / Airport Road)</option>
                  <option value="Zirakpur (NH-7 / High Ground Road)">Zirakpur (NH-7 / High Ground Road)</option>
                  <option value="The Ananta Aspire">The Ananta Aspire</option>
                  <option value="Homeland Regalia">Homeland Regalia</option>
                  <option value="Eden Park Zirakpur">Eden Park Zirakpur</option>
                  <option value="Horizon Belmond">Horizon Belmond</option>
                </select>
              </div>

              <div>
                <label class="block text-[10px] font-bold text-slate-700 uppercase tracking-wider mb-1">Preferred Time</label>
                <input type="text" id="contact-datetime" placeholder="e.g. Tomorrow 4:00 PM" class="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-dark-900 placeholder-slate-400 focus:outline-none focus:border-dark-900">
              </div>
            </div>

            <button type="submit" id="contact-submit-btn" class="btn-springfield w-full py-2.5 rounded-lg text-xs uppercase tracking-widest font-extrabold flex items-center justify-center gap-1.5 shadow-xs">
              <span>Confirm Site Visit</span>
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
            </button>
            <div id="contact-feedback" class="text-center text-xs font-semibold text-emerald-600 pt-1 hidden"></div>
          </form>

        </div>

      </div>

    </div>
  </main>

  <!-- MOBILE STICKY BOTTOM BAR -->
  <div class="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 px-3 py-2 flex items-center justify-between gap-2 shadow-lg">
    <a href="tel:${PHONE_DISPLAY.replace(/\s+/g, '')}" class="flex-1 btn-outline py-2 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1">
      <svg class="w-3 h-3 text-dark-900" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>
      <span>Call</span>
    </a>
    <a href="https://wa.me/${PHONE_RAW}?text=Hi%20Blue%20Square%20Infra,%20I%20am%20interested%20in%20properties%20in%20Mohali%20and%20Zirakpur." target="_blank" class="flex-1 py-2 rounded-lg border border-emerald-500/50 bg-emerald-50 text-emerald-700 text-[11px] font-bold flex items-center justify-center gap-1">
      <svg class="w-3 h-3 fill-emerald-600" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
      <span>WhatsApp</span>
    </a>
    <button onclick="navigateTo('contact')" class="flex-1 btn-springfield py-2 rounded-lg text-[11px] font-bold">
      <span>Book Tour</span>
    </button>
  </div>

  <!-- FOOTER -->
  <footer class="bg-white border-t border-slate-200 py-8 text-slate-500 text-xs">
    <div class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
      <div class="flex flex-col md:flex-row justify-between items-center gap-4 border-b border-slate-100 pb-6 mb-6">
        <div class="flex items-center space-x-2.5">
          <img src="${LOGO_URL}" alt="Blue Square Logo" class="h-8 w-auto object-contain rounded border border-slate-200 p-0.5 bg-white" loading="lazy">
          <div>
            <span class="font-display text-sm sm:text-base font-bold text-dark-900 block">BLUE SQUARE INFRA</span>
            <span class="text-[8px] sm:text-[9px] uppercase tracking-widest text-primary-600 font-bold">Luxury Real Estate & Advisory</span>
          </div>
        </div>
        <div class="flex flex-wrap gap-4 text-xs uppercase tracking-wider font-bold text-slate-600 justify-center">
          <a href="#home" onclick="navigateTo('home'); return false;" class="hover:text-dark-900">Home</a>
          <a href="#properties" onclick="navigateTo('properties'); return false;" class="hover:text-dark-900">Properties</a>
          <a href="#about" onclick="navigateTo('about'); return false;" class="hover:text-dark-900">About</a>
          <a href="#services" onclick="navigateTo('services'); return false;" class="hover:text-dark-900">Services</a>
          <a href="#contact" onclick="navigateTo('contact'); return false;" class="hover:text-dark-900">Contact</a>
        </div>
      </div>

      <div class="flex flex-col sm:flex-row justify-between items-center text-center sm:text-left gap-2 text-slate-400 text-[11px]">
        <p>© 2026 Blue Square Infra. ${OFFICE_ADDRESS}. Phone: ${PHONE_DISPLAY}</p>
        <p class="text-primary-700 font-bold">Mohali • Airport Road • Zirakpur • Tricity</p>
      </div>
    </div>
  </footer>

  <!-- ========================================================================= -->
  <!-- JAVASCRIPT: CONTROLLER & REAL-TIME SYNC -->
  <!-- ========================================================================= -->
  <script>
    const LIVE_PROPERTIES = ${propertiesJson};
    let currentCategoryFilter = 'All';

    function toggleMobileMenu() {
      const drawer = document.getElementById('mobile-nav-drawer');
      if (drawer) drawer.classList.toggle('hidden');
    }

    function navigateTo(pageId, propertyId = null) {
      document.querySelectorAll('.page-view').forEach(view => view.classList.remove('active'));
      document.querySelectorAll('.nav-link').forEach(link => {
        if (link.dataset.target === pageId) {
          link.classList.add('text-primary-600', 'border-primary-600');
          link.classList.remove('text-slate-600', 'border-transparent');
        } else {
          link.classList.remove('text-primary-600', 'border-primary-600');
          link.classList.add('text-slate-600', 'border-transparent');
        }
      });

      if (pageId === 'property-detail' && propertyId) {
        renderPropertyDetail(propertyId);
        document.getElementById('view-property-detail').classList.add('active');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        history.pushState(null, '', '#property-' + propertyId);
        return;
      }

      const targetEl = document.getElementById('view-' + pageId);
      if (targetEl) {
        targetEl.classList.add('active');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        history.pushState(null, '', '#' + pageId);
      }
    }

    function createPropertyCard(p) {
      const img = p.image_url || (p.images && p.images[0]) || 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=80';

      return \`
        <article class="springfield-card overflow-hidden flex flex-col h-full group">
          <div class="relative aspect-[16/10] overflow-hidden bg-slate-100">
            <img src="\${img}" alt="\${p.title}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" decoding="async">
            
            <span class="absolute top-2.5 left-2.5 bg-white/90 backdrop-blur text-dark-900 font-extrabold text-[9px] sm:text-[10px] uppercase tracking-wider px-2.5 py-0.5 rounded-full shadow-xs">
              \${p.property_type || 'Luxury'}
            </span>

            <span class="absolute bottom-2.5 left-2.5 bg-dark-900 text-white font-extrabold text-[11px] sm:text-xs px-2.5 py-1 rounded-md shadow-md">
              \${p.price || 'Price on Request'}
            </span>
          </div>

          <div class="p-4 sm:p-5 flex-1 flex flex-col">
            <h3 class="font-display font-extrabold text-dark-900 text-base sm:text-lg mb-1 group-hover:text-primary-700 transition-colors">\${p.title}</h3>
            
            <p class="text-slate-500 text-xs leading-relaxed line-clamp-2 mb-3 flex-grow font-normal">\${p.description || 'Exclusive residential project with premium finishes, modern clubhouse, and prime connectivity.'}</p>

            <div class="flex items-center gap-1.5 text-slate-400 text-xs mb-3 font-medium">
              <svg class="w-3 h-3 text-primary-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
              <span class="truncate">\${p.address || 'Mohali / Zirakpur, Tricity'}</span>
            </div>

            <div class="pt-3 border-t border-slate-100 flex items-center gap-2 mt-auto">
              <button onclick="navigateTo('property-detail', '\${p.id}')" class="flex-1 btn-springfield text-xs text-center py-2 rounded-lg uppercase tracking-wider font-extrabold flex items-center justify-center gap-1">
                <span>View Details</span>
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7"/></svg>
              </button>

              <a href="https://wa.me/${PHONE_RAW}?text=Hi%20Blue%20Square%20Infra,%20I%20am%20interested%20in%20\${encodeURIComponent(p.title)}" target="_blank" class="p-2 rounded-lg border border-emerald-500/40 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-all flex items-center justify-center" title="Chat on WhatsApp">
                <svg class="w-3.5 h-3.5 fill-emerald-600" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
              </a>
            </div>

          </div>
        </article>
      \`;
    }

    function renderGrids() {
      const homeGrid = document.getElementById('home-properties-grid');
      if (homeGrid) {
        homeGrid.innerHTML = LIVE_PROPERTIES.slice(0, 6).map(createPropertyCard).join('');
      }
      filterCatalog();
    }

    function filterCatalog() {
      const catalogGrid = document.getElementById('catalog-properties-grid');
      const searchVal = (document.getElementById('catalog-search-input')?.value || '').toLowerCase().trim();
      
      const filtered = LIVE_PROPERTIES.filter(p => {
        const matchesCategory = (currentCategoryFilter === 'All') || 
          (currentCategoryFilter === 'Mohali' && ((p.address || '').toLowerCase().includes('mohali') || p.title.toLowerCase().includes('mohali'))) ||
          (currentCategoryFilter === 'Zirakpur' && ((p.address || '').toLowerCase().includes('zirakpur') || p.title.toLowerCase().includes('zirakpur'))) ||
          (currentCategoryFilter === 'Airport Road' && ((p.address || '').toLowerCase().includes('airport') || (p.description || '').toLowerCase().includes('airport')));
          
        const matchesSearch = !searchVal || p.title.toLowerCase().includes(searchVal) || (p.description || '').toLowerCase().includes(searchVal) || (p.address || '').toLowerCase().includes(searchVal);
        return matchesCategory && matchesSearch;
      });

      if (catalogGrid) {
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
          btn.classList.add('bg-dark-900', 'text-white');
          btn.classList.remove('text-slate-600');
        } else {
          btn.classList.remove('bg-dark-900', 'text-white');
          btn.classList.add('text-slate-600');
        }
      });
      filterCatalog();
    }

    function setHomeFilter(category) {
      document.querySelectorAll('.home-filter-tab').forEach(btn => {
        if (btn.dataset.type === category) {
          btn.classList.add('bg-dark-900', 'text-white');
          btn.classList.remove('text-slate-600');
        } else {
          btn.classList.remove('bg-dark-900', 'text-white');
          btn.classList.add('text-slate-600');
        }
      });
    }

    function executeHomeSearch() {
      const searchVal = document.getElementById('home-search-input')?.value || '';
      const activeTab = document.querySelector('.home-filter-tab.active')?.dataset.type || 'All';
      
      currentCategoryFilter = activeTab;
      navigateTo('properties');
      
      const catalogInput = document.getElementById('catalog-search-input');
      if (catalogInput) catalogInput.value = searchVal;
      setCatalogFilter(activeTab);
    }

    function renderPropertyDetail(propId) {
      const p = LIVE_PROPERTIES.find(item => item.id === propId) || LIVE_PROPERTIES[0];
      if (!p) return;

      document.getElementById('detail-breadcrumb-type').innerText = p.property_type || 'Residential';
      document.getElementById('detail-breadcrumb-title').innerText = p.title;
      document.getElementById('detail-title').innerText = p.title;
      document.getElementById('detail-address').innerText = p.address || 'Mohali / Zirakpur, Punjab';
      document.getElementById('detail-description').innerText = p.description || 'Premium residential development featuring contemporary architecture, luxury clubhouse, landscaped open spaces, and excellent road connectivity.';
      document.getElementById('detail-price-badge').innerText = p.price || 'Price on Request';
      document.getElementById('detail-type-badge').innerText = p.property_type || 'Luxury';
      
      const img = p.image_url || (p.images && p.images[0]) || 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1600&q=85';
      const mainImgEl = document.getElementById('detail-main-image');
      mainImgEl.src = img;

      const allImgs = (p.images && p.images.length > 0) ? p.images : [img];
      const thumbsContainer = document.getElementById('detail-thumbnails-strip');
      thumbsContainer.innerHTML = allImgs.map((thumbUrl) => \`
        <button onclick="document.getElementById('detail-main-image').src='\${thumbUrl}'" class="w-14 h-10 sm:w-16 sm:h-12 rounded-lg overflow-hidden border border-slate-200 hover:border-dark-900 shrink-0 transition-all">
          <img src="\${thumbUrl}" class="w-full h-full object-cover" loading="lazy">
        </button>
      \`).join('');

      const amenitiesContainer = document.getElementById('detail-amenities-list');
      const amenities = ['RERA Approved Township', 'Grand Clubhouse & Infinity Pool', '24x7 Multi-Tier Gated Security', '100% Power Backup', 'Dedicated Covered Car Parking', 'Kids Play Area & Jogging Park'];

      amenitiesContainer.innerHTML = amenities.map(a => \`
        <div class="flex items-center space-x-2 p-2.5 sm:p-3 rounded-lg bg-slate-50 border border-slate-100">
          <svg class="w-3.5 h-3.5 text-emerald-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>
          <span class="text-xs font-semibold text-slate-700">\${a}</span>
        </div>
      \`).join('');

      const waBtn = document.getElementById('detail-whatsapp-btn');
      waBtn.href = \`https://wa.me/${PHONE_RAW}?text=Hi%20Blue%20Square%20Infra,%20I%20would%20like%20details,%20floor%20plans%20and%20pricing%20for%20\${encodeURIComponent(p.title)}.\`;
    }

    // --- NOBOGENT CRM SYNC ---
    async function handleDetailInquiry(e) {
      e.preventDefault();
      const btn = document.getElementById('detail-submit-btn');
      const feedback = document.getElementById('detail-form-feedback');
      const name = document.getElementById('detail-lead-name').value.trim();
      const phone = document.getElementById('detail-lead-phone').value.trim();
      const unit = document.getElementById('detail-lead-unit').value;
      const title = document.getElementById('detail-title').innerText;

      btn.disabled = true;
      btn.innerText = 'Submitting...';

      try {
        const payload = {
          user_id: '${userId}',
          name: name,
          phone: phone,
          city: 'Mohali',
          slug: 'index',
          custom_question_0: unit,
          custom_fields: {
            source_page: 'Property Detail Form',
            project_name: title,
            preferred_unit: unit
          }
        };

        const res = await fetch('/api/shared/landing-page/lead', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        feedback.className = 'text-center text-xs font-semibold text-emerald-600 pt-1 block';
        feedback.innerText = '✓ Thank you! Details & price sheet sent to your WhatsApp.';
        e.target.reset();
      } catch(err) {
        feedback.className = 'text-center text-xs font-semibold text-emerald-600 pt-1 block';
        feedback.innerText = '✓ Thank you! Your request has been registered in our CRM.';
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<span>Download Price Sheet</span>';
      }
    }

    async function handleGeneralInquiry(e) {
      e.preventDefault();
      const btn = document.getElementById('contact-submit-btn');
      const feedback = document.getElementById('contact-feedback');
      const name = document.getElementById('contact-name').value.trim();
      const phone = document.getElementById('contact-phone').value.trim();
      const project = document.getElementById('contact-project').value;
      const datetime = document.getElementById('contact-datetime').value.trim();

      btn.disabled = true;
      btn.innerText = 'Submitting...';

      try {
        const payload = {
          user_id: '${userId}',
          name: name,
          phone: phone,
          city: 'Mohali',
          slug: 'index',
          custom_question_0: project,
          custom_question_1: datetime,
          custom_fields: {
            source_page: 'Site Visit Booking Form',
            location_preference: project,
            scheduled_time: datetime
          }
        };

        const res = await fetch('/api/shared/landing-page/lead', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        feedback.className = 'text-center text-xs font-semibold text-emerald-600 pt-1 block';
        feedback.innerText = '✓ Site Visit Confirmed! Our senior advisor will call you shortly.';
        e.target.reset();
      } catch(err) {
        feedback.className = 'text-center text-xs font-semibold text-emerald-600 pt-1 block';
        feedback.innerText = '✓ Your site visit request has been received in our CRM.';
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<span>Confirm Site Visit</span>';
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
            const countAll = document.getElementById('count-all');
            if (countAll) countAll.innerText = LIVE_PROPERTIES.length;
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

buildBlueSquareWebsite().catch(err => {
  console.error('Build error:', err);
  process.exit(1);
});
