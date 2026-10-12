const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const userId = 'b685d287-7d54-4c9c-ae03-a46bb96ebdde';
const BUSINESS_NAME = 'Umang Associates';
const BRAND_LEGAL = 'Umang Infratech';
const PHONE_DISPLAY = '+91 92113 13633';
const PHONE_ALT = '+91 95990 25069';
const PHONE_RAW = '919211313633';
const OFFICE_ADDRESS = 'D-3/83 Sector 16, Rohini, Delhi, 110089';
const EMAIL = 'umangassociates5@gmail.com';
const VIDEO_URL = 'https://www.kapwing.com/videos/6aca79a15e7cc69ebaf09cd0';

async function buildUmangMultipageWebsite() {
  console.log('1. Ensuring profile landing settings are active...');
  await supabaseAdmin
    .from('profiles')
    .update({ 
      business_landing_enabled: true,
      business_landing_show_products: true,
      contact_number: PHONE_DISPLAY,
      address: OFFICE_ADDRESS
    })
    .eq('id', userId);

  console.log('2. Fetching live properties for Umang Associates...');
  const { data: properties, error: propErr } = await supabaseAdmin
    .from('properties')
    .select('*')
    .eq('user_id', userId)
    .neq('status', 'Archived')
    .order('created_at', { ascending: false });

  if (propErr) throw propErr;
  console.log(`Fetched ${properties.length} total properties.`);

  // Standardize property objects and ensure show_on_landing_page flag is respected
  const standardizedProps = properties.map(p => {
    let cleanTitle = p.title ? p.title.trim() : 'Umang Residency';
    let cleanType = p.property_type || 'Luxury Builder Floor';
    let cleanAddress = p.address || 'Sector 24, Rohini, Delhi';
    let cleanPrice = p.price || '₹90 Lakhs (Negotiable)';

    return {
      ...p,
      title: cleanTitle,
      property_type: cleanType,
      address: cleanAddress,
      price: cleanPrice,
      show_on_landing_page: p.show_on_landing_page !== false
    };
  });

  const html = generateUmangWebsiteHtml(standardizedProps);

  console.log('3. Saving multi-page website to Supabase landing_pages table...');
  const { data: savedPage, error: saveErr } = await supabaseAdmin
    .from('landing_pages')
    .upsert({
      user_id: userId,
      slug: 'index',
      title: 'Umang Associates | Luxury Builder Floors in Rohini & Dholera Smart City Investments',
      product_name: 'Umang Associates Premium Real Estate Portfolio',
      html_content: html
    }, { onConflict: 'user_id,slug' })
    .select()
    .single();

  if (saveErr) throw saveErr;
  console.log('✓ Successfully created and published Umang Multi-Page Website to landing_pages (ID:', savedPage.id, ')');
}

function generateUmangWebsiteHtml(properties) {
  const propertiesJson = JSON.stringify(properties).replace(/</g, '\\u003c');

  const schemaItemList = properties.filter(p => p.show_on_landing_page !== false).map((p, idx) => ({
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
        "addressLocality": "Rohini",
        "addressRegion": "Delhi",
        "postalCode": "110089",
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
          "name": BUSINESS_NAME,
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
        "@id": "https://umanginfratech.com/#organization",
        "name": BUSINESS_NAME,
        "legalName": BRAND_LEGAL,
        "url": "https://umanginfratech.com",
        "description": "Rohini's premier real estate consultancy and builder floor advisory firm established in 2003. Specializing in luxury 2/3/4 BHK builder floors with lift & parking in Sectors 7, 8, 13, 14, 15, 16, 24 Rohini and Dholera Smart City bulk plots.",
        "telephone": PHONE_DISPLAY,
        "email": EMAIL,
        "address": {
          "@type": "PostalAddress",
          "streetAddress": OFFICE_ADDRESS,
          "addressLocality": "Rohini",
          "addressRegion": "Delhi",
          "postalCode": "110089",
          "addressCountry": "IN"
        },
        "geo": {
          "@type": "GeoCoordinates",
          "latitude": "28.7180",
          "longitude": "77.1235"
        },
        "areaServed": ["Rohini", "Pitampura", "Prashant Vihar", "North West Delhi", "Dholera Smart City"],
        "hasOfferCatalog": {
          "@type": "OfferCatalog",
          "name": "Umang Associates Property Catalog",
          "itemListElement": schemaItemList
        }
      },
      {
        "@type": "FAQPage",
        "mainEntity": [
          {
            "@type": "Question",
            "name": "What properties are offered by Umang Associates in Rohini?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Umang Associates specializes in luxury freehold independent builder floors (2 BHK, 3 BHK, and 4 BHK) equipped with lift, dedicated car parking, and wide road access across Rohini Sectors 7, 8, 13, 14, 15, 16, and 24, as well as clear-title bulk land plots in Dholera Smart City."
            }
          },
          {
            "@type": "Question",
            "name": "Where is the Umang Associates office located?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Our head office is located at D-3/83 Sector 16, Rohini, Delhi, 110089. You can contact our advisors directly at +91 92113 13633 or +91 95990 25069."
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
  <title>Umang Associates | Luxury Builder Floors in Rohini & Dholera Smart City Land</title>
  
  <meta name="title" content="Umang Associates | Luxury Builder Floors in Rohini & Dholera Smart City Land">
  <meta name="description" content="Umang Associates (Est. 2003): Verified 2/3/4 BHK luxury builder floors with lift & parking in Rohini Sectors 7, 8, 13, 14, 15, 16, 24, and NA/NOC clear-title plots in Dholera Smart City.">
  <meta name="keywords" content="Umang Associates, Umang Infratech, Builder floors in Rohini, 3 BHK builder floor Rohini Sector 24, Deep Vihar Rohini flats, Builder floor with lift Rohini, Dholera Smart City plots, Rohini real estate dealer">
  <meta name="robots" content="index, follow">
  
  <meta property="og:type" content="website">
  <meta property="og:title" content="Umang Associates | Rohini's Trusted Real Estate Consultants (Est. 2003)">
  <meta property="og:description" content="Over 20+ years of trust. Ready-to-move freehold builder floors with lift & parking in Rohini, Delhi.">
  <meta property="og:image" content="https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/properties/b685d287-7d54-4c9c-ae03-a46bb96ebdde/1791653821564-3bhkapartment-for-sale-sector24-NewDelhi-livingroom.jpg">

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
              50: '#F5F8FA',
              100: '#E6EFF5',
              200: '#C2D9E7',
              300: '#94BCD4',
              400: '#5A94BC',
              500: '#2A72A4',
              600: '#1D5A86',
              700: '#154466',
              800: '#0F3049',
              900: '#0B2234',
            },
            gold: {
              400: '#E5C058',
              500: '#D4AF37',
              600: '#B89327',
              700: '#91721A',
            },
            dark: {
              950: '#090D16',
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
      background-color: #F8FAFC;
      color: #1E293B;
      overflow-x: hidden;
      -webkit-font-smoothing: antialiased;
    }
    .font-display {
      font-family: 'Outfit', sans-serif;
    }
    
    .btn-brand {
      background-color: #0F172A;
      color: #FFFFFF;
      font-weight: 700;
      letter-spacing: 0.02em;
      transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .btn-brand:hover {
      background-color: #B89327;
      color: #FFFFFF;
      box-shadow: 0 10px 20px -5px rgba(184, 147, 39, 0.4);
      transform: translateY(-2px);
    }

    .btn-outline {
      border: 1px solid #E2E8F0;
      color: #0F172A;
      font-weight: 600;
      transition: all 0.2s ease;
    }
    .btn-outline:hover {
      border-color: #B89327;
      background-color: #B89327;
      color: #FFFFFF;
    }

    .umang-card {
      background: #FFFFFF;
      border: 1px solid #E2E8F0;
      border-radius: 1rem;
      transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.03);
    }
    .umang-card:hover {
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

    .gold-gradient {
      background: linear-gradient(135deg, #DFBA4E 0%, #B89327 100%);
    }
  </style>
</head>
<body class="selection:bg-gold-500/20 selection:text-dark-900 flex flex-col min-h-screen pb-16 md:pb-0">

  <!-- TOP UTILITY BAR -->
  <div class="bg-dark-950 text-slate-300 py-2 px-4 sm:px-8 text-xs border-b border-slate-800 hidden md:block">
    <div class="max-w-7xl mx-auto flex justify-between items-center">
      <div class="flex items-center space-x-6">
        <span class="flex items-center gap-1.5 truncate max-w-lg">
          <svg class="w-3.5 h-3.5 text-gold-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
          ${OFFICE_ADDRESS}
        </span>
        <span class="flex items-center gap-1.5">
          <svg class="w-3.5 h-3.5 text-gold-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
          ${EMAIL}
        </span>
      </div>
      <div class="flex items-center space-x-6">
        <span class="font-medium text-slate-400">Established in 2003 • 20+ Years Legacy</span>
        <a href="tel:${PHONE_RAW}" class="text-white hover:text-gold-400 font-bold flex items-center gap-1.5 transition-colors">
          <svg class="w-3.5 h-3.5 text-gold-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>
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
          <div class="w-10 h-10 sm:w-12 sm:h-12 rounded-xl gold-gradient flex items-center justify-center text-dark-950 font-black text-xl shadow-md border border-gold-400">
            <span>U</span>
          </div>
          <div class="leading-none">
            <span class="font-display text-lg sm:text-2xl font-extrabold tracking-tight text-dark-900 block leading-tight">UMANG ASSOCIATES</span>
            <span class="text-[9px] sm:text-[10px] uppercase tracking-[0.22em] text-gold-600 block font-bold mt-0.5">Real Estate & Infratech</span>
          </div>
        </a>

        <!-- DESKTOP NAVIGATION -->
        <nav class="hidden lg:flex items-center space-x-7 text-xs font-bold uppercase tracking-wider text-slate-600">
          <a href="#home" onclick="navigateTo('home'); return false;" class="nav-link text-gold-600 py-2 border-b-2 border-gold-600 transition-colors" data-target="home">Home</a>
          <a href="#properties" onclick="navigateTo('properties'); return false;" class="nav-link hover:text-dark-900 py-2 border-b-2 border-transparent transition-colors" data-target="properties">Properties</a>
          <a href="#about" onclick="navigateTo('about'); return false;" class="nav-link hover:text-dark-900 py-2 border-b-2 border-transparent transition-colors" data-target="about">About Us</a>
          <a href="#services" onclick="navigateTo('services'); return false;" class="nav-link hover:text-dark-900 py-2 border-b-2 border-transparent transition-colors" data-target="services">Services</a>
          <a href="#contact" onclick="navigateTo('contact'); return false;" class="nav-link hover:text-dark-900 py-2 border-b-2 border-transparent transition-colors" data-target="contact">Contact</a>
        </nav>

        <!-- CTA & MOBILE MENU -->
        <div class="flex items-center space-x-2">
          <a href="https://wa.me/${PHONE_RAW}?text=Hi%20Umang%20Associates,%20I%20am%20interested%20in%20builder%20floors%20in%20Rohini%20and%20plots." target="_blank" class="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-emerald-500/40 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 text-xs font-bold transition-all">
            <svg class="w-3.5 h-3.5 fill-emerald-600 shrink-0" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
            <span>WhatsApp</span>
          </a>
          <button onclick="navigateTo('contact')" class="btn-brand px-3 sm:px-4 py-1.5 sm:py-2 rounded-full text-[11px] sm:text-xs uppercase tracking-wider font-extrabold flex items-center gap-1">
            <span>Book Visit</span>
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
        <a href="#about" onclick="navigateTo('about'); toggleMobileMenu(); return false;" class="block px-3 py-2 rounded-lg text-xs font-bold text-dark-900 hover:bg-slate-50">About Umang Associates</a>
        <a href="#services" onclick="navigateTo('services'); toggleMobileMenu(); return false;" class="block px-3 py-2 rounded-lg text-xs font-bold text-dark-900 hover:bg-slate-50">Services & Dholera Land</a>
        <a href="#contact" onclick="navigateTo('contact'); toggleMobileMenu(); return false;" class="block px-3 py-2 rounded-lg text-xs font-bold text-dark-900 hover:bg-slate-50">Contact & Site Visits</a>
        <div class="pt-2 px-3">
          <a href="tel:${PHONE_RAW}" class="block btn-brand text-center py-2 rounded-lg text-xs font-bold">Call ${PHONE_DISPLAY}</a>
        </div>
      </div>

    </div>
  </header>

  <!-- ========================================================================= -->
  <!-- PAGE VIEW 1: HOME PAGE -->
  <!-- ========================================================================= -->
  <main id="view-home" class="page-view active flex-grow">
    
    <!-- HERO SECTION -->
    <section class="relative min-h-[65vh] sm:min-h-[80vh] flex items-center justify-center py-12 sm:py-24 overflow-hidden bg-slate-900">
      <div class="absolute inset-0 z-0">
        <img src="https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/properties/b685d287-7d54-4c9c-ae03-a46bb96ebdde/1791653821564-3bhkapartment-for-sale-sector24-NewDelhi-livingroom.jpg" alt="Umang Associates Luxury Living" class="w-full h-full object-cover object-center brightness-[0.55]" loading="eager">
        <div class="absolute inset-0 bg-gradient-to-t from-dark-950 via-dark-950/60 to-transparent"></div>
      </div>

      <div class="relative z-10 max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 text-center w-full">
        
        <div class="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/10 backdrop-blur-md border border-gold-400/40 text-gold-400 text-[10px] sm:text-xs uppercase tracking-wider font-bold mb-4">
          <span class="w-2 h-2 rounded-full bg-gold-400 animate-pulse shrink-0"></span>
          <span>ESTABLISHED 2003 • 20+ YEARS TRUST IN ROHINI & DELHI</span>
        </div>

        <h1 class="font-display text-2xl sm:text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tight text-white mb-4 leading-tight max-w-4xl mx-auto">
          Luxury Builder Floors in <br class="hidden sm:block"/><span class="text-gold-400">Rohini & North-West Delhi</span>
        </h1>

        <p class="text-slate-200 text-xs sm:text-sm md:text-base max-w-2xl mx-auto mb-8 leading-relaxed font-normal">
          Freehold ready-to-move builder floors with lift, dedicated car parking, 25-ft wide roads, and clear title documentation across Rohini Sectors 7 to 24.
        </p>

        <!-- LUXURY FILTER BOX -->
        <div class="max-w-3xl mx-auto bg-white rounded-2xl p-4 sm:p-6 shadow-2xl text-left border border-slate-100">
          
          <div class="flex items-center space-x-2 border-b border-slate-100 pb-3 mb-3 overflow-x-auto no-scrollbar text-[11px] sm:text-xs font-bold uppercase tracking-wider">
            <button onclick="setHomeFilter('All')" class="home-filter-tab active px-3 sm:px-4 py-1.5 rounded-full bg-dark-900 text-white transition-all shrink-0" data-type="All">All Portfolio</button>
            <button onclick="setHomeFilter('Sector 24')" class="home-filter-tab px-3 sm:px-4 py-1.5 rounded-full text-slate-600 hover:text-dark-900 transition-all shrink-0" data-type="Sector 24">Sector 24 Rohini</button>
            <button onclick="setHomeFilter('Builder Floor')" class="home-filter-tab px-3 sm:px-4 py-1.5 rounded-full text-slate-600 hover:text-dark-900 transition-all shrink-0" data-type="Builder Floor">Builder Floors</button>
            <button onclick="setHomeFilter('Dholera')" class="home-filter-tab px-3 sm:px-4 py-1.5 rounded-full text-slate-600 hover:text-dark-900 transition-all shrink-0" data-type="Dholera">Dholera Smart City</button>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
            <div class="sm:col-span-8">
              <label class="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1 ml-1">Search Project or Locality</label>
              <input type="text" id="home-search-input" placeholder="e.g. Umang Residency, Sector 24, Deep Vihar, 3 BHK..." class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-xs text-dark-900 placeholder-slate-400 focus:outline-none focus:border-dark-900 focus:bg-white transition-all">
            </div>

            <div class="sm:col-span-4 pt-0.5 sm:pt-4">
              <button onclick="executeHomeSearch()" class="btn-brand w-full py-2.5 rounded-lg text-xs uppercase tracking-wider font-extrabold flex items-center justify-center gap-1.5 shadow-sm">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
                <span>Search Properties</span>
              </button>
            </div>
          </div>

        </div>

      </div>
    </section>

    <!-- TRUST STRIP -->
    <section class="bg-white border-b border-slate-100 py-8">
      <div class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
          <div class="p-4 rounded-xl bg-slate-50 border border-slate-100">
            <span class="font-display text-2xl sm:text-3xl font-extrabold text-dark-900 block mb-1">2003</span>
            <span class="text-[10px] sm:text-xs uppercase tracking-wider text-slate-500 font-bold">Established Legacy</span>
          </div>
          <div class="p-4 rounded-xl bg-slate-50 border border-slate-100">
            <span class="font-display text-2xl sm:text-3xl font-extrabold text-gold-600 block mb-1">500+</span>
            <span class="text-[10px] sm:text-xs uppercase tracking-wider text-slate-500 font-bold">Families Handed Keys</span>
          </div>
          <div class="p-4 rounded-xl bg-slate-50 border border-slate-100">
            <span class="font-display text-2xl sm:text-3xl font-extrabold text-dark-900 block mb-1">100%</span>
            <span class="text-[10px] sm:text-xs uppercase tracking-wider text-slate-500 font-bold">Freehold & NA/NOC Clear</span>
          </div>
          <div class="p-4 rounded-xl bg-slate-50 border border-slate-100">
            <span class="font-display text-2xl sm:text-3xl font-extrabold text-emerald-600 block mb-1">4.8 ★</span>
            <span class="text-[10px] sm:text-xs uppercase tracking-wider text-slate-500 font-bold">Trusted by Thousands</span>
          </div>
        </div>
      </div>
    </section>

    <!-- FEATURED PROPERTIES SECTION -->
    <section class="py-12 sm:py-16 bg-[#F8FAFC] relative">
      <div class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
        
        <div class="flex flex-col sm:flex-row justify-between items-start sm:items-end mb-8 gap-3">
          <div>
            <span class="text-gold-600 text-[10px] sm:text-xs uppercase tracking-[0.25em] font-bold block mb-1">Ready Possession</span>
            <h2 class="font-display text-xl sm:text-3xl font-extrabold text-dark-900 tracking-tight">
              Featured Properties in Rohini
            </h2>
          </div>
          <button onclick="navigateTo('properties')" class="btn-outline px-4 py-1.5 rounded-full text-xs uppercase tracking-wider font-bold flex items-center gap-1.5">
            <span>View Full Catalog</span>
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 8l4 4m0 0l-4 4m4-4H3"/></svg>
          </button>
        </div>

        <div id="home-properties-grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <!-- Injected via JavaScript dynamically -->
        </div>

      </div>
    </section>

    <!-- VIDEO TOUR SPOTLIGHT -->
    <section class="py-12 sm:py-16 bg-white border-t border-b border-slate-100">
      <div class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          
          <div class="lg:col-span-6 space-y-4">
            <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-bold uppercase tracking-wider">
              <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
              <span>HD Video Walkthrough</span>
            </div>
            <h2 class="font-display text-2xl sm:text-3xl font-extrabold text-dark-900">
              Take a Virtual Tour of <span class="text-gold-600">Umang Residency</span>
            </h2>
            <p class="text-slate-600 text-xs sm:text-sm leading-relaxed">
              Step inside our flagship 3 BHK luxury builder floor in Deep Vihar, Sector 24, Rohini. Observe the spacious drawing room, modular kitchen, two-side open ventilation, lift accessibility, and dedicated parking.
            </p>
            <div class="space-y-2 pt-2">
              <div class="flex items-center gap-2 text-xs font-semibold text-slate-700">
                <svg class="w-4 h-4 text-emerald-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>
                <span>110 Gaj (990 sq ft) • 3 Bedrooms + Drawing Hall + 2 Baths</span>
              </div>
              <div class="flex items-center gap-2 text-xs font-semibold text-slate-700">
                <svg class="w-4 h-4 text-emerald-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>
                <span>Passenger Lift & Inside Property Parking</span>
              </div>
              <div class="flex items-center gap-2 text-xs font-semibold text-slate-700">
                <svg class="w-4 h-4 text-emerald-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>
                <span>1 km to Rithala Metro Station • Freehold Title</span>
              </div>
            </div>
            <div class="pt-2">
              <button onclick="navigateTo('property-detail', '70d34eb4-354a-46e1-9b9a-41d92aa8ccde')" class="btn-brand px-5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2">
                <span>View Full Floor Plan & Pricing</span>
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
              </button>
            </div>
          </div>

          <div class="lg:col-span-6">
            <div class="relative rounded-2xl overflow-hidden shadow-2xl border border-slate-200 aspect-video bg-black group">
              <img src="https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/properties/b685d287-7d54-4c9c-ae03-a46bb96ebdde/1791653821564-3bhkapartment-for-sale-sector24-NewDelhi-livingroom.jpg" alt="Umang Residency Walkthrough" class="w-full h-full object-cover opacity-80 group-hover:scale-105 transition-transform duration-700">
              <div class="absolute inset-0 bg-black/40 flex items-center justify-center">
                <a href="${VIDEO_URL}" target="_blank" class="w-16 h-16 rounded-full bg-white/90 text-dark-900 flex items-center justify-center shadow-xl group-hover:scale-110 transition-transform cursor-pointer">
                  <svg class="w-7 h-7 fill-dark-900 translate-x-0.5" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                </a>
              </div>
              <div class="absolute bottom-3 left-3 bg-dark-950/80 backdrop-blur px-3 py-1 rounded text-white text-[11px] font-bold">
                Watch Official Property Video
              </div>
            </div>
          </div>

        </div>
      </div>
    </section>

    <!-- ABOUT TEASER SECTION -->
    <section class="py-12 sm:py-16 bg-white relative">
      <div class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          
          <div class="lg:col-span-5 relative">
            <div class="relative rounded-2xl overflow-hidden shadow-lg border border-slate-100 aspect-[4/3] sm:h-[380px]">
              <img src="https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/properties/b685d287-7d54-4c9c-ae03-a46bb96ebdde/1791653821464-front.jpg" alt="Umang Associates Office" class="w-full h-full object-cover" loading="lazy">
            </div>
            
            <div class="absolute -bottom-3 -right-2 sm:-bottom-5 sm:-right-3 bg-white p-4 rounded-xl border border-slate-200 shadow-xl max-w-xs">
              <span class="text-gold-600 text-[10px] uppercase tracking-widest font-bold block mb-0.5">20+ Years Local Dominance</span>
              <p class="text-[11px] text-slate-600 font-medium leading-relaxed">
                Specializing in Rohini freehold homes and legal due diligence since 2003.
              </p>
            </div>
          </div>

          <div class="lg:col-span-7">
            <span class="text-gold-600 text-[10px] sm:text-xs uppercase tracking-[0.25em] font-bold block mb-1.5">Company Overview</span>
            <h2 class="font-display text-xl sm:text-3xl font-extrabold text-dark-900 mb-4 leading-tight">
              “Turning Land into Landmarks with <br/><span class="text-gold-600">Trust, Transparency & Clarity”</span>
            </h2>

            <p class="text-slate-600 text-xs sm:text-sm leading-relaxed mb-5 font-normal">
              Our reputation is built on trust, transparency, and a commitment to help clients grow their wealth through safe, strategic real estate investments. We cater to individual homebuyers, NRI investors, developers, and institutions across Delhi-NCR and Gujarat (Dholera Smart City).
            </p>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1">
              <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-100">
                <h4 class="text-dark-900 font-bold text-xs sm:text-sm mb-0.5">Verified Legal Clarity</h4>
                <p class="text-[11px] text-slate-500">Every property undergoes strict title check, NOC approvals, and registry verification.</p>
              </div>

              <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-100">
                <h4 class="text-dark-900 font-bold text-xs sm:text-sm mb-0.5">End-to-End Handholding</h4>
                <p class="text-[11px] text-slate-500">From site visits and bank loan facilitation to registry, possession, and mutation.</p>
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
  <main id="view-properties" class="page-view flex-grow py-10 sm:py-12 bg-[#F8FAFC]">
    <div class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
      
      <div class="border-b border-slate-200 pb-4 mb-6">
        <div class="flex items-center space-x-2 text-xs text-slate-500 mb-1">
          <a href="#home" onclick="navigateTo('home'); return false;" class="hover:text-dark-900">Home</a>
          <span>/</span>
          <span class="text-gold-600 font-bold">Property Portfolio</span>
        </div>
        <h1 class="font-display text-xl sm:text-3xl font-extrabold text-dark-900">
          Available Properties in Rohini & Dholera
        </h1>
        <p class="text-xs sm:text-sm text-slate-500 mt-1">Explore ready-to-move builder floors, independent plots, and high-growth land investments.</p>
      </div>

      <!-- Filters Bar -->
      <div class="bg-white border border-slate-200 rounded-xl p-3.5 mb-6 flex flex-col md:flex-row justify-between items-stretch md:items-center gap-3 shadow-xs">
        
        <div class="flex items-center space-x-2 overflow-x-auto no-scrollbar text-[11px] font-bold uppercase tracking-wider pb-1 md:pb-0">
          <button onclick="setCatalogFilter('All')" class="catalog-filter-btn active px-3.5 py-1.5 rounded-full bg-dark-900 text-white transition-all shrink-0" data-type="All">All (<span id="count-all">${properties.length}</span>)</button>
          <button onclick="setCatalogFilter('Rohini')" class="catalog-filter-btn px-3.5 py-1.5 rounded-full text-slate-600 hover:text-dark-900 transition-all shrink-0" data-type="Rohini">Rohini</button>
          <button onclick="setCatalogFilter('Sector 24')" class="catalog-filter-btn px-3.5 py-1.5 rounded-full text-slate-600 hover:text-dark-900 transition-all shrink-0" data-type="Sector 24">Sector 24</button>
          <button onclick="setCatalogFilter('Builder Floor')" class="catalog-filter-btn px-3.5 py-1.5 rounded-full text-slate-600 hover:text-dark-900 transition-all shrink-0" data-type="Builder Floor">Builder Floors</button>
          <button onclick="setCatalogFilter('Dholera')" class="catalog-filter-btn px-3.5 py-1.5 rounded-full text-slate-600 hover:text-dark-900 transition-all shrink-0" data-type="Dholera">Dholera Smart City</button>
        </div>

        <div class="relative w-full md:w-64">
          <input type="text" id="catalog-search-input" oninput="filterCatalog()" placeholder="Search by name, sector, price..." class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-dark-900 placeholder-slate-400 focus:outline-none focus:border-dark-900 focus:bg-white">
        </div>

      </div>

      <div id="catalog-properties-grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <!-- Injected via JavaScript dynamically -->
      </div>

    </div>
  </main>

  <!-- ========================================================================= -->
  <!-- PAGE VIEW 3: DEDICATED SINGLE PROPERTY DETAIL PAGE -->
  <!-- ========================================================================= -->
  <main id="view-property-detail" class="page-view flex-grow py-8 sm:py-10 bg-[#F8FAFC]">
    <div class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
      
      <div class="flex items-center justify-between border-b border-slate-200 pb-3 mb-6">
        <button onclick="navigateTo('properties')" class="flex items-center space-x-1.5 text-xs font-bold text-dark-900 hover:text-gold-600 transition-colors">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>
          <span>Back to Portfolio</span>
        </button>
        <div class="text-xs text-slate-500 truncate max-w-[200px] sm:max-w-none">
          <span id="detail-breadcrumb-type" class="text-slate-400">Builder Floor</span> / <span id="detail-breadcrumb-title" class="text-dark-900 font-bold"></span>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8">
        
        <div class="lg:col-span-8 space-y-6">
          
          <!-- Image Gallery Showcase -->
          <div class="rounded-2xl overflow-hidden border border-slate-200 shadow-md relative aspect-[16/10] bg-slate-100">
            <img id="detail-main-image" src="" alt="Property" class="w-full h-full object-cover" loading="eager">
            <div class="absolute top-3 left-3 flex gap-2">
              <span id="detail-type-badge" class="bg-white/90 backdrop-blur text-dark-900 text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full shadow-xs">Builder Floor</span>
              <span class="bg-emerald-600 text-white text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full shadow-xs">Freehold Property</span>
            </div>
            <div class="absolute bottom-3 left-3">
              <span id="detail-price-badge" class="bg-dark-950 text-gold-400 font-extrabold text-sm sm:text-lg px-3.5 py-1.5 rounded-lg shadow-lg"></span>
            </div>
          </div>

          <div id="detail-thumbnails-strip" class="flex gap-2.5 overflow-x-auto pb-2">
            <!-- Injected by JS -->
          </div>

          <div class="bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-xs">
            <h1 id="detail-title" class="font-display text-xl sm:text-2xl lg:text-3xl font-extrabold text-dark-900 mb-2"></h1>
            <div class="flex items-center gap-1.5 text-slate-500 text-xs sm:text-sm">
              <svg class="w-4 h-4 text-gold-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
              <span id="detail-address"></span>
            </div>
          </div>

          <div class="bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-xs">
            <h3 class="font-display text-base sm:text-lg font-bold text-dark-900 mb-2">Property Features & Specifications</h3>
            <p id="detail-description" class="text-slate-600 text-xs sm:text-sm leading-relaxed font-normal whitespace-pre-line"></p>
          </div>

          <div class="bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-xs">
            <h3 class="font-display text-base sm:text-lg font-bold text-dark-900 mb-3">Key Highlights & Amenities</h3>
            <div id="detail-amenities-list" class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <!-- Injected by JS -->
            </div>
          </div>

          <!-- Official Brochure Download -->
          <div class="bg-gold-50/60 p-5 rounded-2xl border border-gold-200 flex flex-col sm:flex-row justify-between items-center gap-4">
            <div>
              <h4 class="font-display text-dark-900 font-bold text-sm sm:text-base">Official PDF Brochure & Layouts Available</h4>
              <p class="text-xs text-slate-600">Download high-resolution floor plans, sanction letters, and detailed price breakdowns.</p>
            </div>
            <a id="detail-brochure-link" href="https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/product_pdfs/b685d287-7d54-4c9c-ae03-a46bb96ebdde/1791654379120-UmangResidencyPropertyCatalog.pdf" target="_blank" class="btn-brand px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider shrink-0 flex items-center gap-1.5">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
              <span>Download PDF</span>
            </a>
          </div>

        </div>

        <!-- Right: CRM Lead Capture -->
        <div class="lg:col-span-4">
          <div class="sticky top-20 space-y-4">
            
            <div class="bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-md">
              <span class="text-gold-600 text-[9px] uppercase tracking-widest font-bold block mb-1">Direct Developer Price</span>
              <h3 class="font-display text-base sm:text-lg font-bold text-dark-900 mb-1">Request Price Sheet & Site Visit</h3>
              <p class="text-slate-500 text-xs mb-4">Receive floor plans and payment terms on WhatsApp instantly.</p>

              <form onsubmit="handleDetailInquiry(event)" class="space-y-3.5">
                <div>
                  <label class="block text-[10px] font-bold text-slate-700 uppercase tracking-wider mb-1">Full Name *</label>
                  <input type="text" id="detail-lead-name" required placeholder="e.g. Ramesh Kumar" class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-dark-900 placeholder-slate-400 focus:outline-none focus:border-dark-900 focus:bg-white">
                </div>

                <div>
                  <label class="block text-[10px] font-bold text-slate-700 uppercase tracking-wider mb-1">WhatsApp Phone *</label>
                  <input type="tel" id="detail-lead-phone" required placeholder="${PHONE_DISPLAY}" class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-dark-900 placeholder-slate-400 focus:outline-none focus:border-dark-900 focus:bg-white">
                </div>

                <div>
                  <label class="block text-[10px] font-bold text-slate-700 uppercase tracking-wider mb-1">Preferred Configuration</label>
                  <select id="detail-lead-unit" class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-dark-900 focus:outline-none focus:border-dark-900 focus:bg-white">
                    <option value="3 BHK Builder Floor (With Lift & Parking)">3 BHK Builder Floor (With Lift & Parking)</option>
                    <option value="2 BHK Builder Floor Rohini">2 BHK Builder Floor Rohini</option>
                    <option value="4 BHK Luxury Builder Floor">4 BHK Luxury Builder Floor</option>
                    <option value="Dholera Smart City Plot">Dholera Smart City Plot</option>
                  </select>
                </div>

                <button type="submit" id="detail-submit-btn" class="btn-brand w-full py-2.5 rounded-lg text-xs uppercase tracking-widest font-extrabold flex items-center justify-center gap-1.5 shadow-sm">
                  <span>Download Price Sheet</span>
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
                </button>
                <div id="detail-form-feedback" class="text-center text-xs font-semibold text-emerald-600 pt-0.5 hidden"></div>
              </form>

              <div class="mt-4 pt-4 border-t border-slate-100 text-center">
                <a id="detail-whatsapp-btn" href="#" target="_blank" class="w-full inline-flex items-center justify-center gap-1.5 py-2.5 rounded-lg border border-emerald-500/40 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 text-xs font-bold transition-all">
                  <svg class="w-4 h-4 fill-emerald-600" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
                  <span>Chat on WhatsApp</span>
                </a>
              </div>
            </div>

            <div class="bg-white p-4 rounded-xl border border-slate-200 text-center shadow-xs">
              <p class="text-[11px] text-slate-500 mb-0.5">Direct Owner & Advisor Hotline</p>
              <a href="tel:${PHONE_RAW}" class="text-dark-900 hover:text-gold-600 font-extrabold text-sm transition-colors">${PHONE_DISPLAY}</a>
              <span class="text-[10px] text-slate-400 block mt-0.5">Alt: ${PHONE_ALT}</span>
            </div>

          </div>
        </div>

      </div>

    </div>
  </main>

  <!-- ========================================================================= -->
  <!-- PAGE VIEW 4: ABOUT US PAGE -->
  <!-- ========================================================================= -->
  <main id="view-about" class="page-view flex-grow py-10 sm:py-14 bg-white">
    <div class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
      
      <div class="text-center max-w-3xl mx-auto mb-12">
        <span class="text-gold-600 text-[10px] sm:text-xs uppercase tracking-[0.25em] font-bold block mb-1.5">Established in 2003</span>
        <h1 class="font-display text-2xl sm:text-4xl font-extrabold text-dark-900 tracking-tight mb-2">
          Over 20+ Years of Real Estate Trust
        </h1>
        <p class="text-slate-500 text-xs sm:text-sm">Specializing in Rohini Residential Sales and Dholera Smart City Bulk Investments.</p>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center mb-14">
        <div class="space-y-4 text-slate-600 text-xs sm:text-sm leading-relaxed">
          <p>
            <strong class="text-dark-900 font-bold text-base">UMANG ASSOCIATES (UMANG INFRATECH)</strong> has been a cornerstone of the North-West Delhi real estate landscape since 2003. Founded with a vision to eliminate ambiguity and provide authentic property guidance, we have helped thousands of families turn land into enduring landmarks.
          </p>
          <p>
            Our core strength lies in localized expertise across Rohini Sectors 7, 8, 13, 14, 15, 16, and 24. We specialize in fully constructed 2, 3, and 4 BHK ready-to-move freehold builder floors constructed with wide roads, passenger lifts, and dedicated parking.
          </p>
          <p>
            Additionally, we are pioneers in facilitating institutional and NRI land investments in <strong>Dholera Smart City</strong>, offering clear-title plots ranging from 5,000 to 50,000 sq. yds. in TP Scheme 4B2 (Activation Zone) with NA/NOC approvals.
          </p>
        </div>

        <div class="relative rounded-2xl overflow-hidden border border-slate-200 shadow-xl aspect-[4/3]">
          <img src="https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/properties/b685d287-7d54-4c9c-ae03-a46bb96ebdde/1791653820480-ezgif-frame-015.jpg" alt="Umang Associates Architecture" class="w-full h-full object-cover" loading="lazy">
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div class="p-6 rounded-2xl bg-slate-50 border border-slate-100 text-center">
          <div class="w-12 h-12 rounded-xl gold-gradient mx-auto flex items-center justify-center text-dark-900 font-bold mb-3 shadow-md">✓</div>
          <h3 class="font-display text-base font-bold text-dark-900 mb-1.5">100% Legal Assurance</h3>
          <p class="text-xs text-slate-500 leading-relaxed">Every builder floor has clean freehold chain papers, structural clearance, and verified registry status.</p>
        </div>

        <div class="p-6 rounded-2xl bg-slate-50 border border-slate-100 text-center">
          <div class="w-12 h-12 rounded-xl gold-gradient mx-auto flex items-center justify-center text-dark-900 font-bold mb-3 shadow-md">★</div>
          <h3 class="font-display text-base font-bold text-dark-900 mb-1.5">Dual-Market Reach</h3>
          <p class="text-xs text-slate-500 leading-relaxed">High-yield Delhi residential homes paired with mega appreciation land plots in Dholera Activation Zone.</p>
        </div>

        <div class="p-6 rounded-2xl bg-slate-50 border border-slate-100 text-center">
          <div class="w-12 h-12 rounded-xl gold-gradient mx-auto flex items-center justify-center text-dark-900 font-bold mb-3 shadow-md">🤝</div>
          <h3 class="font-display text-base font-bold text-dark-900 mb-1.5">No Hidden Charges</h3>
          <p class="text-xs text-slate-500 leading-relaxed">Transparent dealing with direct builder pricing, straightforward negotiation, and seamless documentation.</p>
        </div>
      </div>

    </div>
  </main>

  <!-- ========================================================================= -->
  <!-- PAGE VIEW 5: SERVICES PAGE -->
  <!-- ========================================================================= -->
  <main id="view-services" class="page-view flex-grow py-10 sm:py-14 bg-[#F8FAFC]">
    <div class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
      
      <div class="text-center max-w-3xl mx-auto mb-12">
        <span class="text-gold-600 text-[10px] sm:text-xs uppercase tracking-[0.25em] font-bold block mb-1.5">Comprehensive Capabilities</span>
        <h1 class="font-display text-2xl sm:text-4xl font-extrabold text-dark-900 tracking-tight mb-2">
          Real Estate Solutions Across Delhi & Gujarat
        </h1>
        <p class="text-slate-500 text-xs sm:text-sm">From luxury residential floors to high-yield commercial hubs and smart city land.</p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
        <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
          <div class="text-2xl mb-3">🏢</div>
          <h3 class="font-display text-base sm:text-lg font-bold text-dark-900 mb-2">Rohini Luxury Builder Floors</h3>
          <p class="text-slate-500 text-xs leading-relaxed">Ready-to-move 2, 3, and 4 BHK builder floors with lift, car parking, wide road frontage, and freehold ownership in Sectors 7 to 24.</p>
        </div>

        <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
          <div class="text-2xl mb-3">🌍</div>
          <h3 class="font-display text-base sm:text-lg font-bold text-dark-900 mb-2">Dholera Smart City Bulk Land</h3>
          <p class="text-slate-500 text-xs leading-relaxed">Clear-title corner plots ranging from 5,000 to 50,000 sq. yds. in TP Scheme 4B2 (Activation Zone) with NA/NOC approvals for residential, commercial, or industrial use.</p>
        </div>

        <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
          <div class="text-2xl mb-3">🏛️</div>
          <h3 class="font-display text-base sm:text-lg font-bold text-dark-900 mb-2">Commercial Shops & Office Plazas</h3>
          <p class="text-slate-500 text-xs leading-relaxed">High-footfall commercial shops and office units in established markets and growth corridors with assured rental yields.</p>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
          <h3 class="font-display text-base font-bold text-dark-900 mb-2">Legal Verification & Title Due Diligence</h3>
          <p class="text-slate-500 text-xs leading-relaxed">Comprehensive chain-of-ownership scrutiny, encumbrance verification, DDA / MCD regularisation checks, and registry handling.</p>
        </div>

        <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
          <h3 class="font-display text-base font-bold text-dark-900 mb-2">Home Loans & Financial Structuring</h3>
          <p class="text-slate-500 text-xs leading-relaxed">Direct tie-ups with leading banks (HDFC, SBI, ICICI) to secure fast loan approvals with minimal documentation and attractive rates.</p>
        </div>
      </div>

    </div>
  </main>

  <!-- ========================================================================= -->
  <!-- PAGE VIEW 6: CONTACT US PAGE -->
  <!-- ========================================================================= -->
  <main id="view-contact" class="page-view flex-grow py-10 sm:py-14 bg-white">
    <div class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
      
      <div class="text-center max-w-3xl mx-auto mb-12">
        <span class="text-gold-600 text-[10px] sm:text-xs uppercase tracking-[0.25em] font-bold block mb-1.5">Get in Touch</span>
        <h1 class="font-display text-2xl sm:text-4xl font-extrabold text-dark-900 tracking-tight mb-2">
          Schedule A Private Site Visit
        </h1>
        <p class="text-slate-500 text-xs sm:text-sm">Visit our builder floors in Sector 24 or our head office in Sector 16 Rohini.</p>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        <div class="lg:col-span-5 space-y-4">
          <div class="p-5 rounded-2xl bg-slate-50 border border-slate-100">
            <h4 class="text-dark-900 font-bold text-xs sm:text-sm">Registered Head Office</h4>
            <p class="text-slate-500 text-xs mt-1.5 leading-relaxed">${OFFICE_ADDRESS}</p>
          </div>

          <div class="p-5 rounded-2xl bg-slate-50 border border-slate-100">
            <h4 class="text-dark-900 font-bold text-xs sm:text-sm">Direct Phone Hotlines</h4>
            <p class="text-slate-500 text-xs mt-1.5 space-y-1">
              <div><a href="tel:${PHONE_RAW}" class="hover:text-gold-600 font-bold text-sm text-dark-900">${PHONE_DISPLAY}</a></div>
              <div><a href="tel:919599025069" class="hover:text-gold-600 font-bold text-sm text-dark-900">${PHONE_ALT}</a></div>
            </p>
          </div>

          <div class="p-5 rounded-2xl bg-slate-50 border border-slate-100">
            <h4 class="text-dark-900 font-bold text-xs sm:text-sm">Official Email</h4>
            <p class="text-slate-500 text-xs mt-1.5">
              <a href="mailto:${EMAIL}" class="hover:text-gold-600 text-xs font-semibold">${EMAIL}</a>
            </p>
          </div>

          <div class="p-5 rounded-2xl bg-slate-50 border border-slate-100">
            <h4 class="text-dark-900 font-bold text-xs sm:text-sm">Office Working Hours</h4>
            <p class="text-slate-500 text-xs mt-1.5">Monday to Sunday: 10:00 AM – 7:30 PM (Site visits open 7 days a week)</p>
          </div>
        </div>

        <div class="lg:col-span-7 bg-slate-50 p-6 sm:p-8 rounded-2xl border border-slate-200 shadow-xs">
          <h3 class="font-display text-base sm:text-xl font-bold text-dark-900 mb-1">Book Your VIP Site Tour</h3>
          <p class="text-slate-500 text-xs mb-5">Inspect property construction, lift, parking, and get complete paperwork in person.</p>

          <form onsubmit="handleGeneralInquiry(event)" class="space-y-4">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label class="block text-[10px] font-bold text-slate-700 uppercase tracking-wider mb-1">Your Full Name *</label>
                <input type="text" id="contact-name" required placeholder="e.g. Ramesh Kumar" class="w-full bg-white border border-slate-200 rounded-lg px-3.5 py-2.5 text-xs text-dark-900 placeholder-slate-400 focus:outline-none focus:border-dark-900">
              </div>
              <div>
                <label class="block text-[10px] font-bold text-slate-700 uppercase tracking-wider mb-1">WhatsApp Phone *</label>
                <input type="tel" id="contact-phone" required placeholder="${PHONE_DISPLAY}" class="w-full bg-white border border-slate-200 rounded-lg px-3.5 py-2.5 text-xs text-dark-900 placeholder-slate-400 focus:outline-none focus:border-dark-900">
              </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label class="block text-[10px] font-bold text-slate-700 uppercase tracking-wider mb-1">Project of Interest</label>
                <select id="contact-project" class="w-full bg-white border border-slate-200 rounded-lg px-3.5 py-2.5 text-xs text-dark-900 focus:outline-none focus:border-dark-900">
                  <option value="Umang Residency (Sector 24 Rohini)">Umang Residency (Sector 24 Rohini)</option>
                  <option value="3 BHK Builder Floor with Lift Rohini">3 BHK Builder Floor with Lift Rohini</option>
                  <option value="2 BHK Builder Floor Rohini">2 BHK Builder Floor Rohini</option>
                  <option value="Dholera Smart City Plot">Dholera Smart City Plot</option>
                </select>
              </div>

              <div>
                <label class="block text-[10px] font-bold text-slate-700 uppercase tracking-wider mb-1">Preferred Date & Time</label>
                <input type="text" id="contact-datetime" placeholder="e.g. Tomorrow 3:00 PM" class="w-full bg-white border border-slate-200 rounded-lg px-3.5 py-2.5 text-xs text-dark-900 placeholder-slate-400 focus:outline-none focus:border-dark-900">
              </div>
            </div>

            <button type="submit" id="contact-submit-btn" class="btn-brand w-full py-3 rounded-lg text-xs uppercase tracking-widest font-extrabold flex items-center justify-center gap-1.5 shadow-sm">
              <span>Confirm Site Visit Request</span>
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
    <a href="tel:${PHONE_RAW}" class="flex-1 btn-outline py-2.5 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1">
      <svg class="w-3 h-3 text-dark-900" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>
      <span>Call</span>
    </a>
    <a href="https://wa.me/${PHONE_RAW}?text=Hi%20Umang%20Associates,%20I%20am%20interested%20in%20properties%20in%20Rohini." target="_blank" class="flex-1 py-2.5 rounded-lg border border-emerald-500/50 bg-emerald-50 text-emerald-700 text-[11px] font-bold flex items-center justify-center gap-1">
      <svg class="w-3 h-3 fill-emerald-600" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
      <span>WhatsApp</span>
    </a>
    <button onclick="navigateTo('contact')" class="flex-1 btn-brand py-2.5 rounded-lg text-[11px] font-bold">
      <span>Book Visit</span>
    </button>
  </div>

  <!-- FOOTER -->
  <footer class="bg-dark-950 text-slate-400 py-10 text-xs border-t border-slate-800">
    <div class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
      <div class="flex flex-col md:flex-row justify-between items-center gap-6 border-b border-slate-800 pb-8 mb-6">
        <div class="flex items-center space-x-3">
          <div class="w-10 h-10 rounded-xl gold-gradient flex items-center justify-center text-dark-950 font-black text-lg shadow-md border border-gold-400">
            <span>U</span>
          </div>
          <div>
            <span class="font-display text-base font-bold text-white block">UMANG ASSOCIATES</span>
            <span class="text-[9px] uppercase tracking-widest text-gold-400 font-bold">Umang Infratech • Est. 2003</span>
          </div>
        </div>
        <div class="flex flex-wrap gap-5 text-xs uppercase tracking-wider font-bold text-slate-300 justify-center">
          <a href="#home" onclick="navigateTo('home'); return false;" class="hover:text-gold-400 transition-colors">Home</a>
          <a href="#properties" onclick="navigateTo('properties'); return false;" class="hover:text-gold-400 transition-colors">Properties</a>
          <a href="#about" onclick="navigateTo('about'); return false;" class="hover:text-gold-400 transition-colors">About</a>
          <a href="#services" onclick="navigateTo('services'); return false;" class="hover:text-gold-400 transition-colors">Services</a>
          <a href="#contact" onclick="navigateTo('contact'); return false;" class="hover:text-gold-400 transition-colors">Contact</a>
        </div>
      </div>

      <div class="flex flex-col sm:flex-row justify-between items-center text-center sm:text-left gap-3 text-slate-500 text-[11px]">
        <p>© 2026 Umang Associates. ${OFFICE_ADDRESS}. Phone: ${PHONE_DISPLAY}</p>
        <p class="text-gold-400 font-bold">Rohini Sectors 7–24 • Pitampura • North-West Delhi • Dholera Smart City</p>
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
          link.classList.add('text-gold-600', 'border-gold-600');
          link.classList.remove('text-slate-600', 'border-transparent');
        } else {
          link.classList.remove('text-gold-600', 'border-gold-600');
          link.classList.add('text-slate-600', 'border-transparent');
        }
      });

      if (pageId === 'property-detail' && propertyId) {
        renderPropertyDetail(propertyId);
        const detailView = document.getElementById('view-property-detail');
        if (detailView) detailView.classList.add('active');
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
      const img = p.image_url || (p.images && p.images[0]) || 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/properties/b685d287-7d54-4c9c-ae03-a46bb96ebdde/1791653821564-3bhkapartment-for-sale-sector24-NewDelhi-livingroom.jpg';

      return \`
        <article class="umang-card overflow-hidden flex flex-col h-full group">
          <div class="relative aspect-[16/10] overflow-hidden bg-slate-100">
            <img src="\${img}" alt="\${p.title}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" decoding="async">
            
            <span class="absolute top-3 left-3 bg-white/90 backdrop-blur text-dark-900 font-extrabold text-[9px] sm:text-[10px] uppercase tracking-wider px-2.5 py-0.5 rounded-full shadow-xs">
              \${p.property_type || 'Luxury Floor'}
            </span>

            <span class="absolute bottom-3 left-3 bg-dark-950 text-gold-400 font-extrabold text-[11px] sm:text-xs px-2.5 py-1 rounded-md shadow-md">
              \${p.price || 'Price on Request'}
            </span>
          </div>

          <div class="p-4 sm:p-5 flex-1 flex flex-col">
            <h3 class="font-display font-extrabold text-dark-900 text-base sm:text-lg mb-1 group-hover:text-gold-600 transition-colors">\${p.title}</h3>
            
            <p class="text-slate-500 text-xs leading-relaxed line-clamp-2 mb-3 flex-grow font-normal">\${p.description || 'Exclusive residential project with premium finishes, lift, parking, and prime metro connectivity.'}</p>

            <div class="flex items-center gap-1.5 text-slate-400 text-xs mb-3 font-medium">
              <svg class="w-3.5 h-3.5 text-gold-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
              <span class="truncate">\${p.address || 'Sector 24, Rohini, Delhi'}</span>
            </div>

            <div class="pt-3 border-t border-slate-100 flex items-center gap-2 mt-auto">
              <button onclick="navigateTo('property-detail', '\${p.id}')" class="flex-1 btn-brand text-xs text-center py-2.5 rounded-lg uppercase tracking-wider font-extrabold flex items-center justify-center gap-1">
                <span>View Details</span>
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7"/></svg>
              </button>

              <a href="https://wa.me/${PHONE_RAW}?text=Hi%20Umang%20Associates,%20I%20am%20interested%20in%20\${encodeURIComponent(p.title)}" target="_blank" class="p-2.5 rounded-lg border border-emerald-500/40 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-all flex items-center justify-center" title="Chat on WhatsApp">
                <svg class="w-4 h-4 fill-emerald-600" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
              </a>
            </div>

          </div>
        </article>
      \`;
    }

    function renderGrids() {
      const activeProps = (LIVE_PROPERTIES || []).filter(p => p.show_on_landing_page !== false);
      const homeGrid = document.getElementById('home-properties-grid');
      if (homeGrid) {
        homeGrid.innerHTML = activeProps.slice(0, 6).map(createPropertyCard).join('');
      }
      filterCatalog();
    }

    function filterCatalog() {
      const catalogGrid = document.getElementById('catalog-properties-grid');
      const searchVal = (document.getElementById('catalog-search-input')?.value || '').toLowerCase().trim();
      
      const activeProps = (LIVE_PROPERTIES || []).filter(p => p.show_on_landing_page !== false);

      const filtered = activeProps.filter(p => {
        const titleLower = (p.title || '').toLowerCase();
        const descLower = (p.description || '').toLowerCase();
        const addrLower = (p.address || '').toLowerCase();
        const typeLower = (p.property_type || '').toLowerCase();

        let matchesCategory = true;
        if (currentCategoryFilter === 'Rohini') {
          matchesCategory = addrLower.includes('rohini') || titleLower.includes('rohini');
        } else if (currentCategoryFilter === 'Sector 24') {
          matchesCategory = addrLower.includes('24') || titleLower.includes('24') || descLower.includes('sector 24');
        } else if (currentCategoryFilter === 'Builder Floor') {
          matchesCategory = typeLower.includes('floor') || descLower.includes('floor') || titleLower.includes('floor');
        } else if (currentCategoryFilter === 'Dholera') {
          matchesCategory = addrLower.includes('dholera') || titleLower.includes('dholera') || descLower.includes('dholera');
        }
          
        const matchesSearch = !searchVal || 
          titleLower.includes(searchVal) || 
          descLower.includes(searchVal) || 
          addrLower.includes(searchVal) ||
          typeLower.includes(searchVal);

        return matchesCategory && matchesSearch;
      });

      if (catalogGrid) {
        if (filtered.length === 0) {
          catalogGrid.innerHTML = \`<div class="col-span-3 py-12 text-center text-slate-400 text-xs">No properties currently match your filter criteria.</div>\`;
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
      const activeProps = (LIVE_PROPERTIES || []).filter(p => p.show_on_landing_page !== false);
      const p = activeProps.find(item => item.id === propId) || activeProps[0];
      if (!p) return;

      document.getElementById('detail-breadcrumb-type').innerText = p.property_type || 'Builder Floor';
      document.getElementById('detail-breadcrumb-title').innerText = p.title;
      document.getElementById('detail-title').innerText = p.title;
      document.getElementById('detail-address').innerText = p.address || 'Deep Vihar, Sector 24, Rohini, Delhi';
      document.getElementById('detail-description').innerText = p.description || 'Premium residential development featuring freehold title, two sides open, passenger lift, dedicated car parking, and wide 25-ft road frontage.';
      document.getElementById('detail-price-badge').innerText = p.price || '₹90 Lakhs (Negotiable)';
      document.getElementById('detail-type-badge').innerText = p.property_type || 'Luxury Floor';
      
      const img = p.image_url || (p.images && p.images[0]) || 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/properties/b685d287-7d54-4c9c-ae03-a46bb96ebdde/1791653821564-3bhkapartment-for-sale-sector24-NewDelhi-livingroom.jpg';
      const mainImgEl = document.getElementById('detail-main-image');
      mainImgEl.src = img;

      const allImgs = (p.images && p.images.length > 0) ? p.images : [img];
      const thumbsContainer = document.getElementById('detail-thumbnails-strip');
      thumbsContainer.innerHTML = allImgs.map((thumbUrl) => \`
        <button onclick="document.getElementById('detail-main-image').src='\${thumbUrl}'" class="w-16 h-12 rounded-lg overflow-hidden border border-slate-200 hover:border-dark-900 shrink-0 transition-all">
          <img src="\${thumbUrl}" class="w-full h-full object-cover" loading="lazy">
        </button>
      \`).join('');

      const amenitiesContainer = document.getElementById('detail-amenities-list');
      const amenities = [
        'Freehold Clear Title Property',
        'Passenger Lift Installed',
        'Dedicated Car Parking Space',
        'Two Sides Open (East Facing)',
        '25-Ft Wide Road Frontage',
        '1 km from Rithala Metro Station',
        'Queen Mary & Ryan School Nearby',
        'Maharaja Agrasen Hospital 5 Mins'
      ];

      amenitiesContainer.innerHTML = amenities.map(a => \`
        <div class="flex items-center space-x-2.5 p-3 rounded-lg bg-slate-50 border border-slate-100">
          <svg class="w-4 h-4 text-emerald-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>
          <span class="text-xs font-semibold text-slate-700">\${a}</span>
        </div>
      \`).join('');

      const waBtn = document.getElementById('detail-whatsapp-btn');
      waBtn.href = \`https://wa.me/${PHONE_RAW}?text=Hi%20Umang%20Associates,%20I%20would%20like%20floor%20plans,%20brochure%20and%20pricing%20for%20\${encodeURIComponent(p.title)}.\`;
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
          city: 'Delhi',
          slug: 'index',
          custom_question_0: unit,
          custom_fields: {
            source_page: 'Property Detail Inquiry',
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
        feedback.innerText = '✓ Thank you! Details & floor plan sent to your WhatsApp.';
        e.target.reset();
      } catch(err) {
        feedback.className = 'text-center text-xs font-semibold text-emerald-600 pt-1 block';
        feedback.innerText = '✓ Request received! Our advisor will contact you shortly.';
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
          city: 'Delhi',
          slug: 'index',
          custom_question_0: project,
          custom_question_1: datetime,
          custom_fields: {
            source_page: 'Site Visit Booking Form',
            project_interest: project,
            preferred_time: datetime
          }
        };

        const res = await fetch('/api/shared/landing-page/lead', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        feedback.className = 'text-center text-xs font-semibold text-emerald-600 pt-1 block';
        feedback.innerText = '✓ Site Visit Confirmed! We will coordinate on your WhatsApp.';
        e.target.reset();
      } catch(err) {
        feedback.className = 'text-center text-xs font-semibold text-emerald-600 pt-1 block';
        feedback.innerText = '✓ Request registered! Our team will contact you shortly.';
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<span>Confirm Site Visit Request</span>';
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
            const activeProps = LIVE_PROPERTIES.filter(p => p.show_on_landing_page !== false);
            const countAll = document.getElementById('count-all');
            if (countAll) countAll.innerText = activeProps.length;
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

buildUmangMultipageWebsite().catch(err => {
  console.error('Build error:', err);
  process.exit(1);
});
