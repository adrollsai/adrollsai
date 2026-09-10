const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const userId = '93c65dee-87a5-48e3-a2d2-406182a33b37';
const LOGO_URL = 'https://hpssqssdewmkmafxlfud.supabase.co/storage/v1/object/public/public-assets/logos/93c65dee-87a5-48e3-a2d2-406182a33b37/deccan_realtors_93c65dee-87a5-48e3-a2d2-406182a33b37_1787575176651.png';
const PHONE_DISPLAY = '+91 86000 80096';
const PHONE_RAW = '918600080096';

async function updateDeccanWebsite() {
  console.log('Fetching live Deccan Realtors properties from Supabase...');
  const { data: properties, error: pErr } = await supabaseAdmin
    .from('properties')
    .select('*')
    .eq('user_id', userId)
    .neq('status', 'Archived')
    .neq('status', 'Sold')
    .order('created_at', { ascending: false });

  if (pErr) throw pErr;
  console.log(`Found ${properties.length} active Deccan properties.`);

  const html = generateDeccanHtml(properties);

  const { data: savedPage, error: saveErr } = await supabaseAdmin
    .from('landing_pages')
    .upsert({
      user_id: userId,
      slug: 'index',
      title: 'Deccan Realtors | Trusted Real Estate Advisory & Curated Opportunities',
      product_name: 'Deccan Realtors Curated Inventory',
      html_content: html
    }, { onConflict: 'user_id,slug' })
    .select()
    .single();

  if (saveErr) throw saveErr;
  console.log('✓ Successfully updated Deccan Realtors website in landing_pages! Page ID:', savedPage.id);
}

function generateDeccanHtml(properties) {
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
        "streetAddress": p.address || "Nagpur, Maharashtra",
        "addressLocality": "Nagpur",
        "addressCountry": "IN"
      },
      "offers": {
        "@type": "Offer",
        "priceCurrency": "INR",
        "price": p.price || "Price on Request",
        "availability": "https://schema.org/InStock",
        "seller": {
          "@type": "RealEstateAgent",
          "name": "Deccan Realtors",
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
        "@id": "https://deccanrealtors.com/#organization",
        "name": "Deccan Realtors",
        "legalName": "Deccan Realtors Private Limited",
        "url": "https://deccanrealtors.com",
        "logo": LOGO_URL,
        "image": LOGO_URL,
        "description": "Deccan Realtors helps clients make informed real-estate decisions across Nagpur and Dubai through trusted advisory, market intelligence, and due diligence.",
        "telephone": PHONE_DISPLAY,
        "email": "ceo@deccanrealtors.com",
        "address": {
          "@type": "PostalAddress",
          "addressLocality": "Nagpur",
          "addressRegion": "Maharashtra",
          "addressCountry": "IN"
        },
        "hasOfferCatalog": {
          "@type": "OfferCatalog",
          "name": "Deccan Realtors Verified Portfolio",
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
  <title>Deccan Realtors | Trusted Real Estate Advisory & Curated Opportunities</title>
  
  <meta name="title" content="Deccan Realtors | Trusted Real Estate Advisory & Curated Opportunities">
  <meta name="description" content="Deccan Realtors helps clients make informed real-estate decisions across Nagpur and Dubai through trusted advisory, market intelligence, due diligence, and curated opportunities.">
  <meta name="keywords" content="Deccan Realtors, Real Estate Advisory, Luxury Properties, Nagpur Plots, Mauli Upavan, Mauli Crystal, Indian Real Estate, Global Property Investment">
  <meta name="robots" content="index, follow">
  
  <meta property="og:type" content="website">
  <meta property="og:title" content="Deccan Realtors | Navigate Your Next Move">
  <meta property="og:description" content="Trusted real estate advisory, market intelligence, and curated property opportunities across Nagpur and Dubai.">
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
            brand: {
              50: '#F0F4FA',
              100: '#E1E9F5',
              200: '#C3D3EC',
              500: '#1E3A8A',
              800: '#0F1E4A',
              900: '#0A1433',
              950: '#050A1A',
            },
            accent: {
              400: '#E2C275',
              500: '#C1995E',
              600: '#AD8246',
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
    .btn-brand {
      background-color: #0F1E4A;
      color: #FFFFFF;
      font-weight: 700;
      letter-spacing: 0.02em;
      transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .btn-brand:hover {
      background-color: #1E3A8A;
      color: #FFFFFF;
      box-shadow: 0 10px 20px -5px rgba(15, 30, 74, 0.4);
      transform: translateY(-2px);
    }
    .btn-gold {
      background: linear-gradient(135deg, #D4AF37 0%, #C1995E 100%);
      color: #0F1E4A;
      font-weight: 700;
      transition: all 0.25s ease;
    }
    .btn-gold:hover {
      opacity: 0.95;
      transform: translateY(-2px);
      box-shadow: 0 10px 20px -5px rgba(193, 153, 94, 0.4);
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
      box-shadow: 0 15px 30px -8px rgba(15, 30, 74, 0.08);
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
  </style>
</head>
<body class="selection:bg-amber-200 selection:text-slate-900 flex flex-col min-h-screen">

  <!-- TOP BAR -->
  <div class="bg-brand-950 border-b border-brand-800/80 py-2 px-4 sm:px-8 text-xs text-slate-400">
    <div class="max-w-7xl mx-auto flex justify-between items-center">
      <div class="flex items-center space-x-6">
        <span class="flex items-center gap-1.5">
          <span class="text-accent-400">📍</span>
          Nagpur & Dubai Real Estate Advisory
        </span>
        <span class="hidden md:flex items-center gap-1.5">
          <span class="text-accent-400">✉️</span>
          ceo@deccanrealtors.com
        </span>
      </div>
      <div class="flex items-center space-x-6">
        <span class="hidden sm:inline font-medium text-slate-300">RERA Verified Opportunities</span>
        <a href="tel:${PHONE_RAW}" class="text-white hover:text-accent-400 font-bold flex items-center gap-1.5 transition-colors">
          <span class="text-accent-400">📞</span>
          ${PHONE_DISPLAY}
        </a>
      </div>
    </div>
  </div>

  <!-- NAVIGATION HEADER -->
  <header class="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-slate-200 shadow-sm">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="flex justify-between items-center h-20">
        
        <!-- LOGO -->
        <a href="#home" onclick="navigateTo('home'); return false;" class="flex items-center space-x-3 group">
          <img src="${LOGO_URL}" alt="Deccan Realtors" class="h-12 w-auto object-contain rounded-xl" />
          <div>
            <span class="font-display text-xl font-extrabold tracking-tight text-brand-900 block leading-tight">DECCAN REALTORS</span>
            <span class="text-[9px] uppercase tracking-[0.25em] text-accent-600 block font-black mt-0.5">Real Estate Advisory</span>
          </div>
        </a>

        <!-- DESKTOP NAV -->
        <nav class="hidden lg:flex items-center space-x-8 text-xs font-bold uppercase tracking-wider text-slate-600">
          <a href="#home" onclick="navigateTo('home'); return false;" class="nav-link text-brand-900 font-black border-b-2 border-brand-900 py-2 transition-colors" id="nav-home">Home</a>
          <a href="#properties" onclick="navigateTo('properties'); return false;" class="nav-link hover:text-brand-900 py-2 transition-colors" id="nav-properties">Inventory Portfolio</a>
          <a href="#services" onclick="navigateTo('services'); return false;" class="nav-link hover:text-brand-900 py-2 transition-colors" id="nav-services">Services</a>
          <a href="#about" onclick="navigateTo('about'); return false;" class="nav-link hover:text-brand-900 py-2 transition-colors" id="nav-about">About Us</a>
          <a href="#calculator" onclick="navigateTo('calculator'); return false;" class="nav-link hover:text-brand-900 py-2 transition-colors" id="nav-calculator">EMI Calculator</a>
          <a href="#contact" onclick="navigateTo('contact'); return false;" class="nav-link hover:text-brand-900 py-2 transition-colors" id="nav-contact">Contact</a>
        </nav>

        <!-- CTA BUTTONS -->
        <div class="hidden sm:flex items-center space-x-4">
          <a href="https://wa.me/${PHONE_RAW}?text=Hi%20Deccan%20Realtors,%20I%20would%20like%20to%20inquire%20about%20your%20property%20opportunities" target="_blank" class="flex items-center gap-2 px-4 py-2.5 rounded-full border border-emerald-500/40 text-emerald-700 bg-emerald-50/50 hover:bg-emerald-100/60 transition-colors text-xs font-bold">
            <span>💬</span> WhatsApp
          </a>
          <button onclick="navigateTo('contact')" class="btn-brand px-5 py-2.5 rounded-full text-xs uppercase tracking-wider cursor-pointer">
            Consult Advisor
          </button>
        </div>

        <!-- MOBILE MENU BUTTON -->
        <button id="mobileMenuBtn" class="lg:hidden p-2 text-slate-600 hover:text-brand-900 focus:outline-none" aria-label="Toggle Menu">
          <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16m-7 6h7" />
          </svg>
        </button>

      </div>
    </div>

    <!-- MOBILE MENU -->
    <div id="mobileMenu" class="hidden lg:hidden border-t border-slate-200 bg-white px-4 pt-3 pb-6 space-y-3">
      <a href="#home" onclick="navigateTo('home'); toggleMobileMenu(); return false;" class="block py-2 text-sm font-bold text-slate-700 hover:text-brand-900">Home</a>
      <a href="#properties" onclick="navigateTo('properties'); toggleMobileMenu(); return false;" class="block py-2 text-sm font-bold text-slate-700 hover:text-brand-900">Inventory Portfolio</a>
      <a href="#services" onclick="navigateTo('services'); toggleMobileMenu(); return false;" class="block py-2 text-sm font-bold text-slate-700 hover:text-brand-900">Services</a>
      <a href="#about" onclick="navigateTo('about'); toggleMobileMenu(); return false;" class="block py-2 text-sm font-bold text-slate-700 hover:text-brand-900">About Us</a>
      <a href="#calculator" onclick="navigateTo('calculator'); toggleMobileMenu(); return false;" class="block py-2 text-sm font-bold text-slate-700 hover:text-brand-900">EMI Calculator</a>
      <a href="#contact" onclick="navigateTo('contact'); toggleMobileMenu(); return false;" class="block py-2 text-sm font-bold text-slate-700 hover:text-brand-900">Contact</a>
      <div class="pt-4 flex flex-col gap-2">
        <a href="https://wa.me/${PHONE_RAW}?text=Hi%20Deccan%20Realtors,%20I%20would%20like%20to%20inquire" class="btn-brand text-center py-2.5 rounded-xl text-xs font-bold">
          WhatsApp Direct
        </a>
      </div>
    </div>
  </header>

  <!-- ==================== 1. PAGE: HOME ==================== -->
  <div id="page-home" class="page-view active flex-grow">
    
    <!-- HERO SECTION -->
    <section class="relative bg-brand-950 text-white overflow-hidden py-24 lg:py-32 border-b border-brand-800">
      <div class="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-900/30 via-brand-950 to-brand-950"></div>
      <div class="absolute inset-0 opacity-10 bg-[radial-gradient(#ffffff_1px,transparent_1px)] [background-size:24px_24px]"></div>

      <div class="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        
        <div class="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/10 border border-white/15 text-accent-400 text-xs font-bold uppercase tracking-widest mb-6 backdrop-blur-md">
          <span>⭐</span> RERA Certified & Legally Vetted Opportunities
        </div>

        <h1 class="text-4xl sm:text-6xl lg:text-7xl font-black font-display tracking-tight text-white max-w-4xl mx-auto leading-[1.1]">
          Navigate Your Next <span class="bg-gradient-to-r from-accent-400 via-amber-200 to-accent-500 bg-clip-text text-transparent">Real Estate Move</span> With Confidence
        </h1>

        <p class="mt-6 text-base sm:text-xl text-slate-300 max-w-3xl mx-auto leading-relaxed font-normal">
          Deccan Realtors helps individuals, families, and institutions make informed real estate decisions across Nagpur and Dubai through verified market intelligence and complete due diligence.
        </p>

        <div class="mt-10 flex flex-wrap justify-center gap-4">
          <button onclick="navigateTo('properties')" class="btn-gold px-8 py-4 rounded-full text-xs uppercase tracking-wider font-extrabold shadow-lg cursor-pointer">
            Explore Curated Portfolio
          </button>
          <button onclick="navigateTo('contact')" class="px-8 py-4 rounded-full bg-white/10 hover:bg-white/20 text-white text-xs uppercase tracking-wider font-bold border border-white/20 backdrop-blur-md transition-all cursor-pointer">
            Book Private Advisory
          </button>
        </div>

        <!-- KEY METRICS CARDS -->
        <div class="mt-16 grid grid-cols-2 md:grid-cols-4 gap-4 max-w-5xl mx-auto text-left">
          <div class="bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-md">
            <div class="text-2xl sm:text-3xl font-black text-white font-display">Nagpur & Dubai</div>
            <div class="text-xs text-slate-400 uppercase font-semibold tracking-wider mt-1">High-Growth Corridors</div>
          </div>
          <div class="bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-md">
            <div class="text-2xl sm:text-3xl font-black text-accent-400 font-display">100%</div>
            <div class="text-xs text-slate-400 uppercase font-semibold tracking-wider mt-1">Legal Due Diligence</div>
          </div>
          <div class="bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-md">
            <div class="text-2xl sm:text-3xl font-black text-white font-display">Zero Bias</div>
            <div class="text-xs text-slate-400 uppercase font-semibold tracking-wider mt-1">Client-First Advisory</div>
          </div>
          <div class="bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-md">
            <div class="text-2xl sm:text-3xl font-black text-accent-400 font-display">End-to-End</div>
            <div class="text-xs text-slate-400 uppercase font-semibold tracking-wider mt-1">Registry Support</div>
          </div>
        </div>

      </div>
    </section>

    <!-- FEATURED PROPERTIES SECTION -->
    <section class="py-20 bg-white">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        <div class="flex flex-col md:flex-row md:items-end justify-between mb-12 gap-4 border-b border-slate-100 pb-8">
          <div>
            <span class="text-xs font-bold text-accent-500 uppercase tracking-widest block mb-2">Curated Listings</span>
            <h2 class="text-3xl sm:text-4xl font-extrabold text-brand-900 font-display">Featured Real Estate Portfolio</h2>
            <p class="text-xs sm:text-sm text-slate-500 mt-1">Click any property below to view its full product details, layout specs, and schedule a site visit.</p>
          </div>
          <button onclick="navigateTo('properties')" class="text-xs font-bold uppercase tracking-wider text-brand-900 hover:text-accent-500 flex items-center gap-1 cursor-pointer">
            View All Properties →
          </button>
        </div>

        <div id="home-properties-grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          <!-- Live Cards Injected Here -->
        </div>

      </div>
    </section>

    <!-- CORE SERVICES TEASER -->
    <section class="py-20 bg-slate-50 border-t border-b border-slate-200/60">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        <div class="text-center max-w-3xl mx-auto mb-16">
          <span class="text-xs font-bold text-accent-500 uppercase tracking-widest block mb-2">Comprehensive Advisory</span>
          <h2 class="text-3xl sm:text-4xl font-extrabold text-brand-900 font-display">Why Discerning Buyers Choose Deccan Realtors</h2>
          <p class="text-slate-500 text-sm sm:text-base mt-3 leading-relaxed">
            We provide institutional-grade property intelligence, vetting every development for title clarity, structural strength, and capital appreciation potential.
          </p>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div class="springfield-card p-8">
            <div class="w-12 h-12 rounded-2xl bg-brand-50 text-brand-900 flex items-center justify-center mb-6 font-bold text-xl">
              🏢
            </div>
            <h3 class="text-xl font-bold text-brand-900 mb-3">Residential Plots & Layouts</h3>
            <p class="text-slate-600 text-sm leading-relaxed">
              Curated access to approved gated townships and residential plots along Wardha Road and growth corridors with verified demarcation and legal clarity.
            </p>
          </div>

          <div class="springfield-card p-8">
            <div class="w-12 h-12 rounded-2xl bg-brand-50 text-brand-900 flex items-center justify-center mb-6 font-bold text-xl">
              ⚖️
            </div>
            <h3 class="text-xl font-bold text-brand-900 mb-3">Exhaustive Legal Due Diligence</h3>
            <p class="text-slate-600 text-sm leading-relaxed">
              Complete 30-year title search, RERA compliance audit, developer track record evaluation, and transparent documentation before any recommendation.
            </p>
          </div>

          <div class="springfield-card p-8">
            <div class="w-12 h-12 rounded-2xl bg-brand-50 text-brand-900 flex items-center justify-center mb-6 font-bold text-xl">
              🤝
            </div>
            <h3 class="text-xl font-bold text-brand-900 mb-3">End-to-End Handover Support</h3>
            <p class="text-slate-600 text-sm leading-relaxed">
              Seamless transaction management from initial site inspection and loan coordination to sub-registrar registry, mutation, and possession walkthroughs.
            </p>
          </div>
        </div>

      </div>
    </section>

  </div>

  <!-- ==================== 2. PAGE: PROPERTIES CATALOG ==================== -->
  <div id="page-properties" class="page-view flex-grow">
    <div class="bg-brand-950 text-white py-16 px-4 sm:px-6 lg:px-8 border-b border-brand-800">
      <div class="max-w-7xl mx-auto">
        <span class="text-xs font-bold text-accent-400 uppercase tracking-widest block mb-2">Curated Inventory</span>
        <h1 class="text-3xl sm:text-5xl font-black font-display tracking-tight">Verified Property Portfolio</h1>
        <p class="text-slate-300 text-sm sm:text-base mt-2 max-w-2xl">
          Every opportunity featured below has passed 100% legal title verification, RERA compliance audit, and micro-market growth evaluation.
        </p>
      </div>
    </div>

    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      
      <!-- SEARCH & FILTER BAR -->
      <div class="flex flex-col md:flex-row justify-between items-center gap-4 mb-10">
        <div class="flex flex-wrap gap-2 w-full md:w-auto">
          <button onclick="filterProperties('All')" class="filter-tab px-5 py-2.5 rounded-xl bg-brand-900 text-white text-xs font-bold cursor-pointer" data-type="All">
            All Properties (<span id="totalPropertiesCount">0</span>)
          </button>
          <button onclick="filterProperties('Residential Plots')" class="filter-tab px-5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold cursor-pointer" data-type="Residential Plots">
            Residential Plots
          </button>
          <button onclick="filterProperties('Commercial')" class="filter-tab px-5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold cursor-pointer" data-type="Commercial">
            Commercial
          </button>
        </div>

        <div class="w-full md:w-72">
          <input 
            type="text" 
            id="propSearchInput" 
            oninput="handleSearchProperties()" 
            placeholder="Search projects or locations..." 
            class="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-brand-900 focus:outline-none"
          />
        </div>
      </div>

      <!-- PROPERTIES GRID -->
      <div id="catalog-properties-grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        <!-- Live Cards Injected Here -->
      </div>

    </div>
  </div>

  <!-- ==================== 3. PAGE: DEDICATED FULL PRODUCT PAGE ==================== -->
  <div id="page-property-detail" class="page-view flex-grow">
    <div class="bg-white border-b border-slate-200 py-3 px-4 sm:px-8 text-xs text-slate-500">
      <div class="max-w-7xl mx-auto flex items-center space-x-2">
        <a href="#home" onclick="navigateTo('home'); return false;" class="hover:text-brand-900">Home</a>
        <span>/</span>
        <a href="#properties" onclick="navigateTo('properties'); return false;" class="hover:text-brand-900">Portfolio</a>
        <span>/</span>
        <span id="detail-breadcrumb-title" class="text-brand-900 font-bold truncate">Property Overview</span>
      </div>
    </div>

    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      
      <!-- TOP HEADER -->
      <div class="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-6 pb-8 border-b border-slate-200">
        <div>
          <div class="flex flex-wrap items-center gap-2 mb-3">
            <span id="detail-badge-type" class="px-3.5 py-1 rounded-full bg-brand-900 text-white text-xs font-bold uppercase tracking-wider">
              Residential Plot
            </span>
            <span class="px-3.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold uppercase tracking-wider">
              Active Listing
            </span>
            <span class="px-3.5 py-1 rounded-full bg-accent-50 text-accent-700 border border-accent-200 text-xs font-bold uppercase tracking-wider">
              ✓ Legal Due Diligence Completed
            </span>
          </div>
          <h1 id="detail-title" class="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-brand-900 font-display tracking-tight">
            Property Title
          </h1>
          <p id="detail-address" class="text-sm sm:text-base text-slate-500 mt-2 flex items-center gap-1.5 font-medium">
            <span>📍</span> Address goes here
          </p>
        </div>

        <div class="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div class="bg-slate-50 border border-slate-200/80 px-6 py-3.5 rounded-2xl">
            <span class="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Investment / Price</span>
            <span id="detail-price" class="text-2xl sm:text-3xl font-black text-brand-900 font-display">
              Price on Request
            </span>
          </div>
          <a id="detail-wa-btn" href="#" target="_blank" class="flex items-center gap-2 px-6 py-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-md transition-all">
            <span>💬</span> Chat on WhatsApp
          </a>
        </div>
      </div>

      <!-- MAIN DETAIL CONTENT -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-10 mt-10">
        
        <div class="lg:col-span-2 space-y-10">
          
          <!-- IMAGE VIEWER -->
          <div class="space-y-4">
            <div id="detailGalleryContainer" class="relative h-[320px] sm:h-[440px] md:h-[500px] rounded-3xl overflow-hidden bg-slate-950 shadow-xl border border-slate-800 flex items-center justify-center select-none group">
              <img id="detail-main-img" src="" alt="Property" class="max-w-full max-h-full w-auto h-auto object-contain transition-opacity duration-300 pointer-events-none" />
              <div class="absolute bottom-4 left-4 bg-brand-950/85 backdrop-blur-md px-3.5 py-1.5 rounded-xl text-white text-xs font-bold border border-slate-800 shadow-md flex items-center gap-1.5 pointer-events-none">
                <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                <span>100% Verified Site Photos</span>
              </div>
              <div id="detail-slide-counter" class="absolute top-4 right-4 bg-slate-950/85 backdrop-blur-md px-3 py-1 rounded-xl text-white text-xs font-extrabold border border-slate-800 shadow-md hidden">
                1 / 1
              </div>
              <button id="detail-prev-btn" onclick="prevDetailSlide()" type="button" aria-label="Previous Image" class="hidden absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-slate-900/80 hover:bg-brand-900 border border-slate-700/80 text-white flex items-center justify-center backdrop-blur-md shadow-xl transition-all active:scale-90 cursor-pointer z-10 hover:scale-105">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 19l-7-7 7-7" /></svg>
              </button>
              <button id="detail-next-btn" onclick="nextDetailSlide()" type="button" aria-label="Next Image" class="hidden absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-slate-900/80 hover:bg-brand-900 border border-slate-700/80 text-white flex items-center justify-center backdrop-blur-md shadow-xl transition-all active:scale-90 cursor-pointer z-10 hover:scale-105">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7" /></svg>
              </button>
            </div>
            <div id="detail-thumbnails" class="flex gap-2.5 overflow-x-auto pb-2 scrollbar-thin">
              <!-- Thumbnails Injected Here -->
            </div>
          </div>

          <!-- OVERVIEW -->
          <div class="springfield-card p-8 sm:p-10 border border-slate-200/80">
            <h2 class="text-2xl font-extrabold text-brand-900 font-display mb-6">
              Property Overview & Due Diligence
            </h2>
            <div id="detail-description" class="prose max-w-none text-slate-700 leading-relaxed text-sm sm:text-base space-y-4">
              <!-- Description Injected Here -->
            </div>

            <!-- KEY SPECS -->
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-8 pt-8 border-t border-slate-100">
              <div class="bg-slate-50 p-4 rounded-xl">
                <span class="text-[10px] uppercase font-bold text-slate-400 block">Property Type</span>
                <span id="detail-spec-type" class="font-bold text-brand-900 text-sm">Plots</span>
              </div>
              <div class="bg-slate-50 p-4 rounded-xl">
                <span class="text-[10px] uppercase font-bold text-slate-400 block">Status</span>
                <span class="font-bold text-brand-900 text-sm">Ready for Registry</span>
              </div>
              <div class="bg-slate-50 p-4 rounded-xl">
                <span class="text-[10px] uppercase font-bold text-slate-400 block">Advisory Desk</span>
                <span class="font-bold text-brand-900 text-sm">Deccan Realtors</span>
              </div>
              <div class="bg-slate-50 p-4 rounded-xl">
                <span class="text-[10px] uppercase font-bold text-slate-400 block">Verification</span>
                <span class="font-bold text-emerald-600 text-sm">✓ Title Cleared</span>
              </div>
            </div>
          </div>

          <!-- AMENITIES -->
          <div class="springfield-card p-8 sm:p-10 border border-slate-200/80">
            <h3 class="text-xl font-bold text-brand-900 font-display mb-6">
              Key Infrastructure & Connectivity Advantages
            </h3>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-semibold text-slate-700">
              <div class="flex items-center gap-3 p-3.5 bg-slate-50 rounded-xl border border-slate-100">
                <span class="text-accent-500 text-base">✓</span>
                <span>Prime Highway & Outer Ring Road Connectivity</span>
              </div>
              <div class="flex items-center gap-3 p-3.5 bg-slate-50 rounded-xl border border-slate-100">
                <span class="text-accent-500 text-base">✓</span>
                <span>Clean Title Search & Legal Verification Completed</span>
              </div>
              <div class="flex items-center gap-3 p-3.5 bg-slate-50 rounded-xl border border-slate-100">
                <span class="text-accent-500 text-base">✓</span>
                <span>Demarcated Plots with Wide Internal Roads</span>
              </div>
              <div class="flex items-center gap-3 p-3.5 bg-slate-50 rounded-xl border border-slate-100">
                <span class="text-accent-500 text-base">✓</span>
                <span>Underground Water & Electricity Infrastructure</span>
              </div>
            </div>
          </div>

        </div>

        <!-- RIGHT COL: VISIT FORM -->
        <div class="space-y-6">
          <div class="springfield-card p-8 border-2 border-brand-900/10 sticky top-28 bg-white shadow-xl">
            <div class="mb-6">
              <span class="text-[10px] font-black text-accent-500 uppercase tracking-widest block mb-1">Direct Advisory</span>
              <h3 class="text-2xl font-extrabold text-brand-900 font-display">Schedule a Site Visit</h3>
              <p class="text-slate-500 text-xs mt-1 leading-relaxed">
                Book a private on-site inspection or request legal documentation pack for this property.
              </p>
            </div>

            <form id="productSiteVisitForm" class="space-y-4">
              <input type="hidden" id="visitPropId" name="property_id" value="" />
              <input type="hidden" id="visitPropTitle" name="property_title" value="" />

              <div>
                <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Your Full Name</label>
                <input type="text" name="name" required placeholder="e.g. Saif Khan" class="w-full px-4 py-3 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-brand-900 focus:outline-none" />
              </div>

              <div>
                <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Phone Number</label>
                <input type="tel" name="phone" required placeholder="e.g. +91 98765 43210" class="w-full px-4 py-3 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-brand-900 focus:outline-none" />
              </div>

              <div>
                <label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Preferred Visit Date & Time</label>
                <input type="datetime-local" name="preferred_time" class="w-full px-4 py-3 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-brand-900 focus:outline-none" />
              </div>

              <button type="submit" id="submitVisitBtn" class="w-full btn-brand py-4 rounded-xl text-xs uppercase tracking-wider font-bold shadow-md cursor-pointer">
                Confirm Site Visit Request
              </button>
              <div id="visitStatusMsg" class="hidden text-center text-xs font-bold mt-2"></div>
            </form>

            <div class="mt-6 pt-6 border-t border-slate-100 text-center">
              <a id="detail-wa-btn-secondary" href="#" target="_blank" class="w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors text-xs font-bold border border-emerald-200">
                <span>💬</span> Chat With Senior Broker on WhatsApp
              </a>
            </div>
          </div>
        </div>

      </div>

    </div>
  </div>

  <!-- ==================== 4. PAGE: SERVICES ==================== -->
  <div id="page-services" class="page-view flex-grow">
    <div class="bg-brand-950 text-white py-16 px-4 sm:px-6 lg:px-8 border-b border-brand-800">
      <div class="max-w-7xl mx-auto">
        <span class="text-xs font-bold text-accent-400 uppercase tracking-widest block mb-2">Our Capabilities</span>
        <h1 class="text-3xl sm:text-5xl font-black font-display tracking-tight">Institutional-Grade Advisory Services</h1>
        <p class="text-slate-300 text-sm sm:text-base mt-2 max-w-2xl">
          End-to-end guidance designed to protect your capital and maximize long-term asset value.
        </p>
      </div>
    </div>
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
      <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div class="springfield-card p-8">
          <div class="w-12 h-12 rounded-2xl bg-brand-50 text-brand-900 flex items-center justify-center mb-6 font-bold text-xl">🔍</div>
          <h3 class="text-xl font-bold text-brand-900 mb-3">Legal Due Diligence</h3>
          <p class="text-slate-600 text-sm leading-relaxed">Full 30-year title searches, revenue record verification, 7/12 extract audits, and RERA compliance validation.</p>
        </div>
        <div class="springfield-card p-8">
          <div class="w-12 h-12 rounded-2xl bg-brand-50 text-brand-900 flex items-center justify-center mb-6 font-bold text-xl">🏘️</div>
          <h3 class="text-xl font-bold text-brand-900 mb-3">Residential Plots & Townships</h3>
          <p class="text-slate-600 text-sm leading-relaxed">Curated access to approved gated layouts and residential plots along Wardha Road and growth corridors.</p>
        </div>
        <div class="springfield-card p-8">
          <div class="w-12 h-12 rounded-2xl bg-brand-50 text-brand-900 flex items-center justify-center mb-6 font-bold text-xl">📜</div>
          <h3 class="text-xl font-bold text-brand-900 mb-3">Registry & Conveyance</h3>
          <p class="text-slate-600 text-sm leading-relaxed">Seamless support through sub-registrar registration, stamp duty optimization, and municipal mutation.</p>
        </div>
      </div>
    </div>
  </div>

  <!-- ==================== 5. PAGE: ABOUT US ==================== -->
  <div id="page-about" class="page-view flex-grow">
    <div class="bg-brand-950 text-white py-16 px-4 sm:px-6 lg:px-8 border-b border-brand-800">
      <div class="max-w-7xl mx-auto">
        <span class="text-xs font-bold text-accent-400 uppercase tracking-widest block mb-2">Our Story & Ethos</span>
        <h1 class="text-3xl sm:text-5xl font-black font-display tracking-tight">About Deccan Realtors</h1>
        <p class="text-slate-300 text-sm sm:text-base mt-2 max-w-2xl">
          Building generational wealth through research-backed advisory, zero sales bias, and verified real estate opportunities.
        </p>
      </div>
    </div>
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
        <div class="space-y-6 text-slate-700 leading-relaxed text-sm sm:text-base">
          <h2 class="text-2xl sm:text-3xl font-extrabold text-brand-900 font-display">Pioneering Informed Real Estate Decisions</h2>
          <p>Deccan Realtors was founded on a simple premise: real estate decisions are among the most significant financial commitments an individual or institution ever makes. They should never be driven by aggressive salesmanship, but by verified market intelligence and legal transparency.</p>
          <div class="border-l-4 border-accent-500 pl-4 py-2 italic text-slate-800 font-medium">
            "Deccan Realtors help people make informed real-estate decisions: across Nagpur and Dubai through trusted advisory, market intelligence, due diligence, and carefully curated property opportunities."
          </div>
        </div>
        <div class="springfield-card p-8 border border-slate-200">
          <img src="${LOGO_URL}" alt="Deccan Realtors" class="w-24 h-24 rounded-2xl object-contain mb-6 border border-slate-100" />
          <h3 class="text-xl font-bold text-brand-900 mb-1">Ahmed Saif Ali Khan</h3>
          <p class="text-xs font-bold text-accent-500 uppercase tracking-wider mb-4">CEO, Deccan Realtors</p>
          <p class="text-slate-600 text-xs leading-relaxed mb-6">"Our objective is to deliver unmatched peace of mind. Every property featured in our portfolio undergoes rigorous legal scrutiny."</p>
          <div class="pt-4 border-t border-slate-100 flex items-center justify-between text-xs font-semibold text-slate-500">
            <span>Official Email:</span>
            <span class="text-brand-900 font-bold">ceo@deccanrealtors.com</span>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- ==================== 6. PAGE: EMI CALCULATOR ==================== -->
  <div id="page-calculator" class="page-view flex-grow">
    <div class="bg-brand-950 text-white py-16 px-4 sm:px-6 lg:px-8 border-b border-brand-800">
      <div class="max-w-7xl mx-auto">
        <span class="text-xs font-bold text-accent-400 uppercase tracking-widest block mb-2">Financial Planning</span>
        <h1 class="text-3xl sm:text-5xl font-black font-display tracking-tight">Home Loan & Investment Calculator</h1>
      </div>
    </div>
    <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
      <div class="springfield-card p-8 sm:p-12">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
          <div class="space-y-6">
            <div>
              <div class="flex justify-between text-xs font-bold text-slate-700 uppercase mb-2">
                <span>Loan Amount (₹)</span>
                <span id="loanAmountDisplay" class="text-brand-900 font-black text-sm">₹ 75,00,000</span>
              </div>
              <input type="range" id="loanAmount" min="1000000" max="100000000" step="500000" value="7500000" oninput="calculateEmi()" class="w-full accent-brand-900 cursor-pointer" />
            </div>
            <div>
              <div class="flex justify-between text-xs font-bold text-slate-700 uppercase mb-2">
                <span>Interest Rate (% p.a.)</span>
                <span id="interestRateDisplay" class="text-brand-900 font-black text-sm">8.5%</span>
              </div>
              <input type="range" id="interestRate" min="6.5" max="15.0" step="0.1" value="8.5" oninput="calculateEmi()" class="w-full accent-brand-900 cursor-pointer" />
            </div>
            <div>
              <div class="flex justify-between text-xs font-bold text-slate-700 uppercase mb-2">
                <span>Tenure (Years)</span>
                <span id="tenureDisplay" class="text-brand-900 font-black text-sm">20 Years</span>
              </div>
              <input type="range" id="tenure" min="1" max="30" step="1" value="20" oninput="calculateEmi()" class="w-full accent-brand-900 cursor-pointer" />
            </div>
          </div>
          <div class="bg-brand-950 text-white rounded-3xl p-8 text-center flex flex-col justify-between">
            <div>
              <span class="text-xs uppercase tracking-widest text-accent-400 font-bold block mb-2">Estimated Monthly Outlay</span>
              <div id="emiResult" class="text-3xl sm:text-4xl font-black font-display text-white">₹ 65,082</div>
              <p class="text-slate-400 text-xs mt-1">Per Month</p>
            </div>
            <div class="mt-8 pt-8 border-t border-brand-800 space-y-3 text-xs text-left">
              <div class="flex justify-between"><span class="text-slate-400">Principal Amount:</span><span id="principalDisplay" class="font-bold text-white">₹ 75,00,000</span></div>
              <div class="flex justify-between"><span class="text-slate-400">Total Interest:</span><span id="interestDisplay" class="font-bold text-accent-400">₹ 81,19,680</span></div>
              <div class="flex justify-between pt-2 border-t border-brand-900 font-bold text-sm"><span class="text-white">Total Amount:</span><span id="totalDisplay" class="text-accent-400">₹ 1,56,19,680</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- ==================== 7. PAGE: CONTACT ==================== -->
  <div id="page-contact" class="page-view flex-grow">
    <div class="bg-brand-950 text-white py-16 px-4 sm:px-6 lg:px-8 border-b border-brand-800">
      <div class="max-w-7xl mx-auto">
        <span class="text-xs font-bold text-accent-400 uppercase tracking-widest block mb-2">Connect With Advisory</span>
        <h1 class="text-3xl sm:text-5xl font-black font-display tracking-tight">Private Consultation Desk</h1>
      </div>
    </div>
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-12">
        <div class="springfield-card p-8 sm:p-10 border border-slate-200">
          <h2 class="text-2xl font-extrabold text-brand-900 font-display mb-2">Request Consultation</h2>
          <form id="deccanContactForm" class="space-y-4">
            <div><label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Full Name</label><input type="text" name="name" required placeholder="e.g. Rahul Sharma" class="w-full px-4 py-3 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-brand-900 focus:outline-none" /></div>
            <div><label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Phone Number</label><input type="tel" name="phone" required placeholder="e.g. +91 98765 43210" class="w-full px-4 py-3 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-brand-900 focus:outline-none" /></div>
            <div><label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Email Address</label><input type="email" name="email" placeholder="e.g. rsharma@domain.com" class="w-full px-4 py-3 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-brand-900 focus:outline-none" /></div>
            <div><label class="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">Requirements / Interest</label><textarea name="message" rows="3" placeholder="Tell us what you are looking for..." class="w-full px-4 py-3 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-brand-900 focus:outline-none"></textarea></div>
            <button type="submit" id="deccanSubmitBtn" class="w-full btn-brand py-4 rounded-xl text-xs uppercase tracking-wider font-bold shadow-md cursor-pointer">Submit Advisory Request</button>
            <div id="contactFormStatus" class="hidden text-center text-xs font-bold mt-2"></div>
          </form>
        </div>
        <div class="space-y-6">
          <div class="springfield-card p-8">
            <h3 class="text-xl font-bold text-brand-900 font-display mb-4">Advisory Headquarters</h3>
            <p class="text-slate-600 text-xs sm:text-sm leading-relaxed mb-4">📍 Wardha Road & Outer Ring Road Corridor, Nagpur, Maharashtra</p>
            <p class="text-slate-600 text-xs sm:text-sm leading-relaxed mb-2">📞 <a href="tel:${PHONE_RAW}" class="font-bold text-brand-900">${PHONE_DISPLAY}</a></p>
            <p class="text-slate-600 text-xs sm:text-sm leading-relaxed">✉️ <a href="mailto:ceo@deccanrealtors.com" class="font-bold text-brand-900">ceo@deccanrealtors.com</a></p>
          </div>
          <div class="springfield-card p-8 bg-brand-950 text-white border border-brand-900">
            <h3 class="text-lg font-bold text-accent-400 font-display mb-2">Immediate WhatsApp Desk</h3>
            <p class="text-slate-300 text-xs leading-relaxed mb-6">For urgent site visit scheduling, connect directly on WhatsApp.</p>
            <a href="https://wa.me/${PHONE_RAW}?text=Hi%20Deccan%20Realtors,%20I%20would%20like%20to%20connect%20with%20an%20advisor" target="_blank" class="w-full inline-flex items-center justify-center gap-2 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs uppercase tracking-wider">
              <span>💬</span> Open WhatsApp Chat
            </a>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- FOOTER -->
  <footer class="bg-brand-950 text-slate-400 text-xs border-t border-brand-900 pt-16 pb-12">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="grid grid-cols-1 md:grid-cols-4 gap-10 pb-12 border-b border-brand-900">
        <div class="space-y-4">
          <div class="flex items-center space-x-3">
            <img src="${LOGO_URL}" alt="Deccan Realtors" class="h-10 w-auto object-contain rounded-xl" />
            <div><span class="font-display text-lg font-bold text-white block">DECCAN REALTORS</span><span class="text-[8px] uppercase tracking-widest text-accent-400 block font-bold">Advisory Desk</span></div>
          </div>
          <p class="text-slate-400 leading-relaxed text-xs">Helping individuals, families, and institutions make informed real-estate decisions across Nagpur and Dubai through rigorous due diligence.</p>
        </div>
        <div>
          <h4 class="text-white font-bold uppercase tracking-wider text-xs mb-4">Navigation</h4>
          <ul class="space-y-2">
            <li><a href="#home" onclick="navigateTo('home'); return false;" class="hover:text-accent-400">Home</a></li>
            <li><a href="#properties" onclick="navigateTo('properties'); return false;" class="hover:text-accent-400">Inventory Portfolio</a></li>
            <li><a href="#services" onclick="navigateTo('services'); return false;" class="hover:text-accent-400">Services</a></li>
            <li><a href="#about" onclick="navigateTo('about'); return false;" class="hover:text-accent-400">About Us</a></li>
          </ul>
        </div>
        <div>
          <h4 class="text-white font-bold uppercase tracking-wider text-xs mb-4">Advisory Practice</h4>
          <ul class="space-y-2">
            <li>Residential Plots & Layouts</li>
            <li>Commercial Assets</li>
            <li>Title Due Diligence</li>
            <li>Registry Support</li>
          </ul>
        </div>
        <div>
          <h4 class="text-white font-bold uppercase tracking-wider text-xs mb-4">Advisory Desk</h4>
          <p class="text-slate-200 font-bold mb-1">Ahmed Saif Ali Khan</p>
          <p class="text-accent-400 mb-2">CEO, Deccan Realtors</p>
          <p class="mb-1">📞 ${PHONE_DISPLAY}</p>
          <p class="mb-1">✉️ ceo@deccanrealtors.com</p>
        </div>
      </div>
      <div class="pt-8 flex flex-col sm:flex-row justify-between items-center text-slate-500 text-[11px] gap-4">
        <div>© \${new Date().getFullYear()} Deccan Realtors. All rights reserved.</div>
      </div>
    </div>
  </footer>

  <!-- CLIENT-SIDE SCRIPT: NAVIGATION, LIVE SYNC, CLICKABLE PRODUCT PAGES -->
  <script>
    const USER_ID = '${userId}';
    const LIVE_PROPERTIES = ${propertiesJson};
    let activeFilterType = 'All';

    function navigateTo(pageId, extraParam) {
      document.querySelectorAll('.page-view').forEach(p => p.classList.remove('active'));
      const target = document.getElementById('page-' + pageId);
      if (target) {
        target.classList.add('active');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }

      document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('text-brand-900', 'font-black', 'border-b-2', 'border-brand-900');
        link.classList.add('hover:text-brand-900');
      });
      const activeLink = document.getElementById('nav-' + pageId);
      if (activeLink) {
        activeLink.classList.add('text-brand-900', 'font-black', 'border-b-2', 'border-brand-900');
      }

      if (pageId === 'property-detail' && extraParam) {
        renderPropertyDetail(extraParam);
        history.pushState(null, '', '#property-' + extraParam);
      } else {
        history.pushState(null, '', '#' + pageId);
      }
    }

    function toggleMobileMenu() {
      document.getElementById('mobileMenu')?.classList.toggle('hidden');
    }
    document.getElementById('mobileMenuBtn')?.addEventListener('click', toggleMobileMenu);

    function createPropertyCard(p) {
      const img = p.image_url || (p.images && p.images[0]) || '${LOGO_URL}';
      const waLink = 'https://wa.me/${PHONE_RAW}?text=' + encodeURIComponent('Hi Deccan Realtors, I am interested in ' + p.title);
      
      return \`
        <div class="springfield-card overflow-hidden flex flex-col group cursor-pointer" onclick="window.location.href='/properties/' + '\${p.id}'">
          <div class="relative h-64 overflow-hidden bg-slate-100">
            <img src="\${img}" alt="\${p.title}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
            <div class="absolute top-3 left-3">
              <span class="px-3 py-1 rounded-full bg-brand-900/90 backdrop-blur-md text-white text-[10px] font-bold uppercase tracking-wider">
                \${p.property_type || 'Curated Asset'}
              </span>
            </div>
            <div class="absolute bottom-3 left-3 right-3">
              <span class="text-base font-black text-brand-900 bg-white/95 backdrop-blur-md px-3.5 py-1 rounded-xl shadow-sm font-display">
                \${p.price || 'Price on Request'}
              </span>
            </div>
          </div>

          <div class="p-6 flex-1 flex flex-col justify-between">
            <div>
              <a href="/properties/\${p.id}">
                <h3 class="text-lg font-bold text-brand-900 mb-1.5 line-clamp-1 group-hover:text-accent-600 transition-colors font-display">
                  \${p.title}
                </h3>
              </a>
              <p class="text-xs text-slate-500 font-medium mb-3 flex items-center gap-1">
                📍 <span class="truncate">\${p.address || 'Nagpur Corridor'}</span>
              </p>
              <p class="text-slate-600 text-xs line-clamp-2 leading-relaxed mb-4">
                \${p.description || 'Verified luxury property curated by Deccan Realtors.'}
              </p>
            </div>

            <div class="pt-4 border-t border-slate-100 flex items-center justify-between gap-3">
              <a href="/properties/\${p.id}" onclick="event.stopPropagation();" class="flex-1 text-center py-2.5 rounded-xl bg-brand-900 text-white hover:bg-brand-800 font-bold text-xs uppercase tracking-wider transition-all inline-block cursor-pointer">
                View Full Product Page →
              </a>
              <a href="\${waLink}" target="_blank" onclick="event.stopPropagation();" class="p-2.5 rounded-xl bg-emerald-50 text-emerald-600 hover:bg-emerald-600 hover:text-white transition-all shrink-0" title="Chat on WhatsApp">
                💬
              </a>
            </div>
          </div>
        </div>
      \`;
    }

    let detailActiveImages = [];
    let detailActiveSlideIdx = 0;

    function updateDetailSlide(idx) {
      if (!detailActiveImages || detailActiveImages.length === 0) return;
      if (idx < 0) idx = detailActiveImages.length - 1;
      if (idx >= detailActiveImages.length) idx = 0;
      detailActiveSlideIdx = idx;

      const mainImg = document.getElementById('detail-main-img');
      if (mainImg) {
        mainImg.style.opacity = '0.5';
        mainImg.src = detailActiveImages[idx];
        setTimeout(() => {
          mainImg.style.opacity = '1';
        }, 50);
      }

      const counter = document.getElementById('detail-slide-counter');
      if (counter) {
        counter.innerText = \`\${detailActiveSlideIdx + 1} / \${detailActiveImages.length}\`;
      }

      document.querySelectorAll('.detail-thumb-btn').forEach((btn, i) => {
        if (i === detailActiveSlideIdx) {
          btn.className = 'detail-thumb-btn w-20 sm:w-24 h-16 sm:h-20 rounded-xl overflow-hidden border-2 transition-all shrink-0 bg-slate-950 cursor-pointer p-0.5 border-amber-400 ring-2 ring-amber-400/30 opacity-100 scale-[1.02]';
          btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        } else {
          btn.className = 'detail-thumb-btn w-20 sm:w-24 h-16 sm:h-20 rounded-xl overflow-hidden border-2 transition-all shrink-0 bg-slate-950 cursor-pointer p-0.5 border-slate-800 opacity-60 hover:opacity-100';
        }
      });
    }

    function prevDetailSlide() {
      updateDetailSlide(detailActiveSlideIdx - 1);
    }

    function nextDetailSlide() {
      updateDetailSlide(detailActiveSlideIdx + 1);
    }

    function renderPropertyDetail(propId) {
      const p = LIVE_PROPERTIES.find(item => item.id === propId) || LIVE_PROPERTIES[0];
      if (!p) return;

      document.getElementById('detail-breadcrumb-title').innerText = p.title;
      document.getElementById('detail-title').innerText = p.title;
      document.getElementById('detail-address').innerText = '📍 ' + (p.address || 'Nagpur, Maharashtra');
      document.getElementById('detail-price').innerText = p.price || 'Price on Request';
      document.getElementById('detail-badge-type').innerText = p.property_type || 'Curated Asset';
      document.getElementById('detail-spec-type').innerText = p.property_type || 'Plots';
      document.getElementById('detail-description').innerText = p.description || (p.title + ' is a verified property opportunity curated by Deccan Realtors.');

      detailActiveImages = (p.images && p.images.length > 0) ? p.images : [p.image_url || '${LOGO_URL}'];
      detailActiveSlideIdx = 0;

      const mainImg = document.getElementById('detail-main-img');
      if (mainImg) {
        mainImg.src = detailActiveImages[0];
        mainImg.style.opacity = '1';
      }

      const counter = document.getElementById('detail-slide-counter');
      const prevBtn = document.getElementById('detail-prev-btn');
      const nextBtn = document.getElementById('detail-next-btn');

      if (detailActiveImages.length > 1) {
        if (counter) {
          counter.innerText = \`1 / \${detailActiveImages.length}\`;
          counter.classList.remove('hidden');
        }
        if (prevBtn) prevBtn.classList.remove('hidden');
        if (nextBtn) nextBtn.classList.remove('hidden');
      } else {
        if (counter) counter.classList.add('hidden');
        if (prevBtn) prevBtn.classList.add('hidden');
        if (nextBtn) nextBtn.classList.add('hidden');
      }

      const thumbContainer = document.getElementById('detail-thumbnails');
      if (thumbContainer) {
        if (detailActiveImages.length > 1) {
          thumbContainer.innerHTML = detailActiveImages.map((img, idx) => \`
            <button onclick="updateDetailSlide(\${idx})" class="detail-thumb-btn w-20 sm:w-24 h-16 sm:h-20 rounded-xl overflow-hidden border-2 transition-all shrink-0 bg-slate-950 cursor-pointer p-0.5 \${idx === 0 ? 'border-amber-400 ring-2 ring-amber-400/30 opacity-100 scale-[1.02]' : 'border-slate-800 opacity-60 hover:opacity-100'}">
              <img src="\${img}" class="w-full h-full object-contain" />
            </button>
          \`).join('');
          thumbContainer.classList.remove('hidden');
        } else {
          thumbContainer.innerHTML = '';
          thumbContainer.classList.add('hidden');
        }
      }

      const waMsg = encodeURIComponent('Hi Deccan Realtors, I am interested in ' + p.title + ' located at ' + p.address + '. Please share pricing and details.');
      const waUrl = 'https://wa.me/${PHONE_RAW}?text=' + waMsg;
      document.getElementById('detail-wa-btn').href = waUrl;
      document.getElementById('detail-wa-btn-secondary').href = waUrl;

      document.getElementById('visitPropId').value = p.id;
      document.getElementById('visitPropTitle').value = p.title;
    }

    function renderPropertyGrids() {
      const homeGrid = document.getElementById('home-properties-grid');
      const catalogGrid = document.getElementById('catalog-properties-grid');
      const totalCount = document.getElementById('totalPropertiesCount');

      if (totalCount) totalCount.innerText = LIVE_PROPERTIES.length;

      if (LIVE_PROPERTIES && LIVE_PROPERTIES.length > 0) {
        if (homeGrid) homeGrid.innerHTML = LIVE_PROPERTIES.slice(0, 6).map(createPropertyCard).join('');
        if (catalogGrid) catalogGrid.innerHTML = LIVE_PROPERTIES.map(createPropertyCard).join('');
      }
    }

    async function syncDynamicCatalog() {
      try {
        const res = await fetch('/api/shared/catalog?identifier=' + USER_ID);
        if (res.ok) {
          const data = await res.json();
          if (data.properties && data.properties.length > 0) {
            LIVE_PROPERTIES.length = 0;
            LIVE_PROPERTIES.push(...data.properties);
            renderPropertyGrids();
          }
        }
      } catch (err) {
        console.log('Live catalog active');
      }
    }

    function filterProperties(type) {
      activeFilterType = type;
      document.querySelectorAll('.filter-tab').forEach(tab => {
        if (tab.getAttribute('data-type') === type) {
          tab.className = 'filter-tab px-5 py-2.5 rounded-xl bg-brand-900 text-white text-xs font-bold cursor-pointer';
        } else {
          tab.className = 'filter-tab px-5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold cursor-pointer';
        }
      });

      const catalogGrid = document.getElementById('catalog-properties-grid');
      const filtered = type === 'All' ? LIVE_PROPERTIES : LIVE_PROPERTIES.filter(p => (p.property_type || '').toLowerCase().includes(type.toLowerCase()));
      if (catalogGrid) {
        catalogGrid.innerHTML = filtered.map(createPropertyCard).join('');
      }
    }

    function handleSearchProperties() {
      const q = (document.getElementById('propSearchInput')?.value || '').toLowerCase();
      const filtered = LIVE_PROPERTIES.filter(p => 
        (p.title || '').toLowerCase().includes(q) || 
        (p.address || '').toLowerCase().includes(q) ||
        (p.description || '').toLowerCase().includes(q)
      );
      const catalogGrid = document.getElementById('catalog-properties-grid');
      if (catalogGrid) {
        catalogGrid.innerHTML = filtered.map(createPropertyCard).join('');
      }
    }

    function calculateEmi() {
      const p = parseFloat(document.getElementById('loanAmount').value);
      const r = parseFloat(document.getElementById('interestRate').value) / 12 / 100;
      const n = parseFloat(document.getElementById('tenure').value) * 12;

      document.getElementById('loanAmountDisplay').innerText = '₹ ' + p.toLocaleString('en-IN');
      document.getElementById('interestRateDisplay').innerText = document.getElementById('interestRate').value + '%';
      document.getElementById('tenureDisplay').innerText = document.getElementById('tenure').value + ' Years';

      const emi = (p * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
      const totalPayable = emi * n;
      const totalInterest = totalPayable - p;

      document.getElementById('emiResult').innerText = '₹ ' + Math.round(emi).toLocaleString('en-IN');
      document.getElementById('principalDisplay').innerText = '₹ ' + p.toLocaleString('en-IN');
      document.getElementById('interestDisplay').innerText = '₹ ' + Math.round(totalInterest).toLocaleString('en-IN');
      document.getElementById('totalDisplay').innerText = '₹ ' + Math.round(totalPayable).toLocaleString('en-IN');
    }

    // Site Visit Form Handler
    document.getElementById('productSiteVisitForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const btn = document.getElementById('submitVisitBtn');
      const statusDiv = document.getElementById('visitStatusMsg');
      btn.disabled = true;
      btn.innerText = 'Submitting Request...';

      const formData = new FormData(form);
      const payload = {
        user_id: USER_ID,
        name: formData.get('name'),
        phone: formData.get('phone'),
        city: 'Nagpur',
        custom_question_0: formData.get('property_title'),
        custom_question_1: formData.get('preferred_time'),
        custom_fields: {
          property_id: formData.get('property_id'),
          property_name: formData.get('property_title'),
          source: 'Product Detail Page'
        }
      };

      try {
        await fetch('/api/shared/landing-page/lead', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        statusDiv.className = 'text-center text-xs font-bold text-emerald-600 mt-2 block';
        statusDiv.innerText = '✓ Site visit request submitted! Our senior advisor will call you shortly.';
        form.reset();
      } catch (err) {
        statusDiv.className = 'text-center text-xs font-bold text-emerald-600 mt-2 block';
        statusDiv.innerText = '✓ Request received. Our advisor will connect via WhatsApp/Phone.';
      } finally {
        btn.disabled = false;
        btn.innerText = 'Confirm Site Visit Request';
      }
    });

    // Contact Form Handler
    document.getElementById('deccanContactForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const btn = document.getElementById('deccanSubmitBtn');
      const statusDiv = document.getElementById('contactFormStatus');
      btn.disabled = true;
      btn.innerText = 'Submitting Request...';

      const formData = new FormData(form);
      const payload = {
        user_id: USER_ID,
        name: formData.get('name'),
        phone: formData.get('phone'),
        email: formData.get('email'),
        message: formData.get('message'),
        source: 'Consultation Form'
      };

      try {
        const res = await fetch('/api/shared/inquiry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        statusDiv.className = 'text-center text-xs font-bold text-emerald-600 mt-2 block';
        statusDiv.innerText = '✓ Thank you! Our senior advisor will connect with you shortly.';
        form.reset();
      } catch (err) {
        statusDiv.className = 'text-center text-xs font-bold text-emerald-600 mt-2 block';
        statusDiv.innerText = '✓ Inquiry received. Our desk will contact you.';
      } finally {
        btn.disabled = false;
        btn.innerText = 'Submit Advisory Request';
      }
    });

    window.addEventListener('DOMContentLoaded', () => {
      renderPropertyGrids();
      syncDynamicCatalog();
      calculateEmi();

      const detailGallery = document.getElementById('detailGalleryContainer');
      let touchStartX = 0;
      let touchEndX = 0;
      detailGallery?.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
      }, { passive: true });
      detailGallery?.addEventListener('touchend', (e) => {
        touchEndX = e.changedTouches[0].screenX;
        const diffX = touchStartX - touchEndX;
        if (Math.abs(diffX) > 40) {
          if (diffX > 0) nextDetailSlide();
          else prevDetailSlide();
        }
      }, { passive: true });

      const hash = window.location.hash.replace('#', '');
      if (hash.startsWith('property-')) {
        const propId = hash.replace('property-', '');
        navigateTo('property-detail', propId);
      } else if (['home', 'properties', 'services', 'about', 'calculator', 'contact'].includes(hash)) {
        navigateTo(hash);
      }
    });

    window.addEventListener('popstate', () => {
      const hash = window.location.hash.replace('#', '');
      if (hash.startsWith('property-')) {
        const propId = hash.replace('property-', '');
        navigateTo('property-detail', propId);
      } else if (['home', 'properties', 'services', 'about', 'calculator', 'contact'].includes(hash)) {
        navigateTo(hash);
      } else {
        navigateTo('home');
      }
    });
  </script>

</body>
</html>`;
}

updateDeccanWebsite().catch(err => {
  console.error('Fatal error updating Deccan website:', err);
  process.exit(1);
});
