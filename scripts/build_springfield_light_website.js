const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const userId = '68b55a31-a16d-454d-a20f-11adabf590b0';
const LOGO_URL = 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/logos/68b55a31-a16d-454d-a20f-11adabf590b0-bioque-logo.png';

async function buildAndSaveWebsite() {
  console.log('Fetching live properties for Bioque Estates...');
  const { data: properties, error: propErr } = await supabaseAdmin
    .from('properties')
    .select('*')
    .eq('user_id', userId)
    .neq('status', 'Archived')
    .order('created_at', { ascending: false });

  if (propErr) throw propErr;
  console.log(`Fetched ${properties.length} live properties from database.`);

  const html = generateLightSpringfieldWebsiteHtml(properties);

  const { data: savedPage, error: saveErr } = await supabaseAdmin
    .from('landing_pages')
    .upsert({
      user_id: userId,
      slug: 'index',
      title: 'Bioque Estates International | Luxury Real Estate & Advisory',
      product_name: 'Bioque Estates Luxury Portfolio',
      html_content: html
    }, { onConflict: 'user_id,slug' })
    .select()
    .single();

  if (saveErr) throw saveErr;
  console.log('Successfully saved Springfield Light Luxury Website to landing_pages (ID:', savedPage.id, ')');
}

function generateLightSpringfieldWebsiteHtml(properties) {
  const propertiesJson = JSON.stringify(properties).replace(/</g, '\\u003c');

  return `<!DOCTYPE html>
<html lang="en" class="scroll-smooth">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bioque Estates International | Luxury Real Estate & Advisory</title>
  <meta name="description" content="Bioque Estates International is a premier luxury real estate advisory firm delivering high-end residences, independent floors, luxury villas, and developer plots across New Chandigarh, Chandigarh, Gurugram, and Noida.">

  <!-- Google Fonts: Plus Jakarta Sans & Outfit & Playfair -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=Playfair+Display:ital,wght@0,600;0,700;0,800;1,600&display=swap" rel="stylesheet">

  <!-- Tailwind CSS -->
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          fontFamily: {
            sans: ['Plus Jakarta Sans', 'sans-serif'],
            display: ['Outfit', 'sans-serif'],
            serif: ['Playfair Display', 'serif'],
          },
          colors: {
            primary: {
              50: '#FBF8F3',
              100: '#F5EFE4',
              200: '#EBDDC7',
              300: '#DEC6A3',
              400: '#D1AF7F',
              500: '#C1995E',
              600: '#AD8246',
              700: '#8C6634',
              800: '#6E4E27',
              900: '#4D361B',
            },
            dark: {
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
    }
    .font-display {
      font-family: 'Outfit', sans-serif;
    }
    .font-serif-luxury {
      font-family: 'Playfair Display', serif;
    }
    
    /* Springfield Button Styles */
    .btn-springfield {
      background-color: #0F172A;
      color: #FFFFFF;
      font-weight: 700;
      letter-spacing: 0.04em;
      transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .btn-springfield:hover {
      background-color: #AD8246;
      color: #FFFFFF;
      box-shadow: 0 10px 20px -5px rgba(173, 130, 70, 0.4);
      transform: translateY(-2px);
    }

    .btn-gold {
      background: linear-gradient(135deg, #C1995E 0%, #AD8246 100%);
      color: #FFFFFF;
      font-weight: 700;
      transition: all 0.25s ease;
    }
    .btn-gold:hover {
      filter: brightness(1.08);
      box-shadow: 0 10px 20px -5px rgba(173, 130, 70, 0.4);
      transform: translateY(-2px);
    }

    .btn-outline {
      border: 1.5px solid #E2E8F0;
      color: #0F172A;
      font-weight: 600;
      transition: all 0.2s ease;
    }
    .btn-outline:hover {
      border-color: #0F172A;
      background-color: #0F172A;
      color: #FFFFFF;
    }

    /* Springfield Property Card */
    .springfield-card {
      background: #FFFFFF;
      border: 1px solid #EAEFF5;
      border-radius: 1.25rem;
      transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.02);
    }
    .springfield-card:hover {
      transform: translateY(-6px);
      box-shadow: 0 20px 35px -10px rgba(15, 23, 42, 0.08);
      border-color: #CBD5E1;
    }

    /* Page View Controller */
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
<body class="selection:bg-primary-200 selection:text-dark-900 flex flex-col min-h-screen">

  <!-- TOP UTILITY BAR (SPRINGFIELD STYLE) -->
  <div class="bg-white border-b border-slate-100 py-2.5 px-4 sm:px-8 text-xs text-slate-500 hidden md:block">
    <div class="max-w-7xl mx-auto flex justify-between items-center">
      <div class="flex items-center space-x-6">
        <span class="flex items-center gap-2">
          <svg class="w-3.5 h-3.5 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
          SCO 118-119, Level II, Madhya Marg, Sector 8-C, Chandigarh
        </span>
        <span class="flex items-center gap-2">
          <svg class="w-3.5 h-3.5 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
          estatesbioque@gmail.com
        </span>
      </div>
      <div class="flex items-center space-x-6">
        <span class="font-medium text-slate-700">Official Omaxe New Chandigarh Advisory</span>
        <a href="tel:+919988772999" class="text-dark-900 hover:text-primary-600 font-bold flex items-center gap-1.5 transition-colors">
          <svg class="w-3.5 h-3.5 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>
          +91 99887 72999
        </a>
      </div>
    </div>
  </div>

  <!-- NAVIGATION HEADER -->
  <header class="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-slate-200/80 shadow-sm">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="flex justify-between items-center h-20 sm:h-24">
        
        <!-- LOGO -->
        <a href="#home" onclick="navigateTo('home'); return false;" class="flex items-center space-x-3.5 group">
          <img src="${LOGO_URL}" alt="Bioque Estates" class="h-12 sm:h-14 w-auto object-contain rounded-lg border border-slate-200 p-1 bg-white shadow-sm">
          <div>
            <span class="font-display text-xl sm:text-2xl font-extrabold tracking-tight text-dark-900 block leading-tight">BIOQUE ESTATES</span>
            <span class="text-[10px] uppercase tracking-[0.22em] text-primary-600 block font-bold">International Real Estate</span>
          </div>
        </a>

        <!-- MULTI-PAGE NAVIGATION -->
        <nav class="hidden lg:flex items-center space-x-8 text-xs font-bold uppercase tracking-wider text-slate-600">
          <a href="#home" onclick="navigateTo('home'); return false;" class="nav-link text-primary-600 py-2 border-b-2 border-primary-600" data-target="home">Home</a>
          <a href="#properties" onclick="navigateTo('properties'); return false;" class="nav-link hover:text-dark-900 py-2 border-b-2 border-transparent" data-target="properties">Properties</a>
          <a href="#about" onclick="navigateTo('about'); return false;" class="nav-link hover:text-dark-900 py-2 border-b-2 border-transparent" data-target="about">About Us</a>
          <a href="#services" onclick="navigateTo('services'); return false;" class="nav-link hover:text-dark-900 py-2 border-b-2 border-transparent" data-target="services">Services</a>
          <a href="#contact" onclick="navigateTo('contact'); return false;" class="nav-link hover:text-dark-900 py-2 border-b-2 border-transparent" data-target="contact">Contact</a>
        </nav>

        <!-- CTA BUTTONS -->
        <div class="flex items-center space-x-3">
          <a href="https://wa.me/919988772999?text=Hi%20Bioque%20Estates,%20I%20am%20interested%20in%20Omaxe%20New%20Chandigarh%20properties." target="_blank" class="hidden sm:inline-flex items-center gap-2 px-4 py-2.5 rounded-full border border-emerald-500/50 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 text-xs font-bold transition-all">
            <svg class="w-4 h-4 fill-emerald-600" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
            <span>WhatsApp</span>
          </a>
          <button onclick="navigateTo('contact')" class="btn-springfield px-5 py-2.5 sm:px-6 sm:py-3 rounded-full text-xs uppercase tracking-wider font-extrabold flex items-center gap-2">
            <span>Schedule Tour</span>
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
          </button>
        </div>

      </div>
    </div>
  </header>

  <!-- ========================================================================= -->
  <!-- PAGE VIEW 1: HOME PAGE (SPRINGFIELD STYLE CLEAN LIGHT) -->
  <!-- ========================================================================= -->
  <main id="view-home" class="page-view active flex-grow">
    
    <!-- HERO SECTION -->
    <section class="relative min-h-[82vh] flex items-center justify-center py-20 sm:py-28 overflow-hidden bg-slate-900">
      <!-- Architectural Hero Image with Clean Contrast Overlay -->
      <div class="absolute inset-0 z-0">
        <img src="https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=2000&q=90" alt="Luxury Architecture" class="w-full h-full object-cover object-center brightness-[0.75]">
        <div class="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/30"></div>
      </div>

      <div class="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        
        <!-- Luxury Tag -->
        <div class="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/15 backdrop-blur-md border border-white/30 text-white text-xs uppercase tracking-[0.2em] font-bold mb-6">
          <span class="w-2 h-2 rounded-full bg-primary-400"></span>
          <span>New Chandigarh • Official Omaxe Portfolio</span>
        </div>

        <!-- Headline -->
        <h1 class="font-display text-3xl sm:text-5xl md:text-7xl font-extrabold tracking-tight text-white mb-6 leading-tight max-w-5xl mx-auto">
          Find Your Luxury Home in <br/><span class="text-primary-300">New Chandigarh</span>
        </h1>

        <!-- Subtitle -->
        <p class="text-slate-200 text-sm sm:text-lg max-w-3xl mx-auto mb-10 leading-relaxed font-normal">
          Exclusive collection of waterfront apartments, designer independent floors, luxury duplex villas, and developer plots by Bioque Estates International.
        </p>

        <!-- SPRINGFIELD CLEAN TABBED SEARCH BOX (WHITE CARD) -->
        <div class="max-w-4xl mx-auto bg-white rounded-3xl p-5 sm:p-7 shadow-2xl text-left border border-slate-100">
          
          <!-- Category Tabs -->
          <div class="flex items-center space-x-2 border-b border-slate-100 pb-4 mb-4 overflow-x-auto text-xs font-bold uppercase tracking-wider">
            <button onclick="setHomeFilter('All')" class="home-filter-tab active px-4 py-2 rounded-full bg-dark-900 text-white transition-all" data-type="All">All Properties</button>
            <button onclick="setHomeFilter('Residential')" class="home-filter-tab px-4 py-2 rounded-full text-slate-600 hover:text-dark-900 transition-all" data-type="Residential">Apartments</button>
            <button onclick="setHomeFilter('Villas')" class="home-filter-tab px-4 py-2 rounded-full text-slate-600 hover:text-dark-900 transition-all" data-type="Villas">Villas</button>
            <button onclick="setHomeFilter('Independent Floors')" class="home-filter-tab px-4 py-2 rounded-full text-slate-600 hover:text-dark-900 transition-all" data-type="Independent Floors">Independent Floors</button>
            <button onclick="setHomeFilter('Plots')" class="home-filter-tab px-4 py-2 rounded-full text-slate-600 hover:text-dark-900 transition-all" data-type="Plots">Plots & Land</button>
          </div>

          <!-- Search Inputs Grid -->
          <div class="grid grid-cols-1 sm:grid-cols-12 gap-3 sm:gap-4 items-center">
            <div class="sm:col-span-5">
              <label class="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1 ml-1">Search Project</label>
              <input type="text" id="home-search-input" placeholder="e.g. The Lake, Mulberry Villas, Ambrosia..." class="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-dark-900 placeholder-slate-400 focus:outline-none focus:border-dark-900 focus:bg-white transition-all">
            </div>

            <div class="sm:col-span-4">
              <label class="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1 ml-1">Budget Range</label>
              <select id="home-budget-select" class="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-dark-900 focus:outline-none focus:border-dark-900 focus:bg-white transition-all">
                <option value="All">All Budgets</option>
                <option value="Under 70L">Under ₹ 70 Lac</option>
                <option value="70L-1.5Cr">₹ 70 Lac - ₹ 1.50 Cr</option>
                <option value="Above 1.5Cr">₹ 1.50 Cr & Above</option>
              </select>
            </div>

            <div class="sm:col-span-3 pt-2 sm:pt-5">
              <button onclick="executeHomeSearch()" class="btn-springfield w-full py-3.5 rounded-xl text-xs uppercase tracking-wider font-extrabold flex items-center justify-center gap-2 shadow-md">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
                <span>Search</span>
              </button>
            </div>
          </div>

        </div>

      </div>
    </section>

    <!-- TRUST STRIP (LIGHT CLEAN BACKGROUND) -->
    <section class="bg-white border-b border-slate-100 py-10">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
          <div class="p-4 rounded-2xl bg-slate-50 border border-slate-100">
            <span class="font-display text-3xl font-extrabold text-dark-900 block mb-1">10+</span>
            <span class="text-xs uppercase tracking-wider text-slate-500 font-bold">Years Experience</span>
          </div>
          <div class="p-4 rounded-2xl bg-slate-50 border border-slate-100">
            <span class="font-display text-3xl font-extrabold text-dark-900 block mb-1">13+</span>
            <span class="text-xs uppercase tracking-wider text-slate-500 font-bold">Omaxe Projects</span>
          </div>
          <div class="p-4 rounded-2xl bg-slate-50 border border-slate-100">
            <span class="font-display text-3xl font-extrabold text-dark-900 block mb-1">100%</span>
            <span class="text-xs uppercase tracking-wider text-slate-500 font-bold">Verified Titles</span>
          </div>
          <div class="p-4 rounded-2xl bg-slate-50 border border-slate-100">
            <span class="font-display text-3xl font-extrabold text-dark-900 block mb-1">0%</span>
            <span class="text-xs uppercase tracking-wider text-slate-500 font-bold">Brokerage on New Units</span>
          </div>
        </div>
      </div>
    </section>

    <!-- FEATURED PROPERTIES SECTION -->
    <section class="py-20 bg-[#F8F9FA] relative">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        <div class="flex flex-col md:flex-row justify-between items-start md:items-end mb-12 gap-6">
          <div>
            <span class="text-primary-600 text-xs uppercase tracking-[0.25em] font-bold block mb-2">Prime Real Estate</span>
            <h2 class="font-display text-3xl sm:text-4xl lg:text-5xl font-extrabold text-dark-900 tracking-tight">
              Featured Properties in New Chandigarh
            </h2>
          </div>
          <button onclick="navigateTo('properties')" class="btn-outline px-6 py-2.5 rounded-full text-xs uppercase tracking-wider font-bold flex items-center gap-2">
            <span>View All Properties</span>
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 8l4 4m0 0l-4 4m4-4H3"/></svg>
          </button>
        </div>

        <!-- DYNAMIC PROPERTY CARDS -->
        <div id="home-properties-grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          <!-- Injected via JavaScript -->
        </div>

      </div>
    </section>

    <!-- WHY CHOOSE BIOQUE ESTATES (LIGHT SPRINGFIELD STYLE) -->
    <section class="py-20 bg-white border-t border-slate-100 relative">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          
          <div class="lg:col-span-5 relative">
            <div class="relative rounded-3xl overflow-hidden shadow-xl border border-slate-100">
              <img src="https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=85" alt="Bioque Estates Luxury Properties" class="w-full h-[480px] object-cover">
            </div>
            
            <div class="absolute -bottom-6 -right-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-xl max-w-xs">
              <span class="text-primary-700 text-xs uppercase tracking-widest font-bold block mb-1">Direct Advisory</span>
              <p class="text-xs text-slate-600 font-medium leading-relaxed">
                Expert consultation from property selection to agreement & possession.
              </p>
            </div>
          </div>

          <div class="lg:col-span-7">
            <span class="text-primary-600 text-xs uppercase tracking-[0.25em] font-bold block mb-2">Our Foundation</span>
            <h2 class="font-display text-3xl sm:text-4xl lg:text-5xl font-extrabold text-dark-900 mb-6 leading-tight">
              “We Are The Leading Real Estate Company, <br/><span class="text-primary-600">We Are BIOQUE ESTATES”</span>
            </h2>

            <p class="text-slate-600 text-sm sm:text-base leading-relaxed mb-6">
              BIOQUE ESTATES is a rapidly growing Real Estate development and advisory firm. Established to offer credibility, transparency, and top-tier quality to customers across Tri-City, Gurugram, and Noida.
            </p>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div class="p-5 rounded-2xl bg-slate-50 border border-slate-100">
                <div class="w-8 h-8 rounded-xl bg-primary-100 text-primary-700 flex items-center justify-center mb-3">
                  <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>
                </div>
                <h4 class="text-dark-900 font-bold text-sm mb-1">Credibility & Trust</h4>
                <p class="text-xs text-slate-500">100% verified legal paperwork and direct developer agreements.</p>
              </div>

              <div class="p-5 rounded-2xl bg-slate-50 border border-slate-100">
                <div class="w-8 h-8 rounded-xl bg-primary-100 text-primary-700 flex items-center justify-center mb-3">
                  <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clip-rule="evenodd"/></svg>
                </div>
                <h4 class="text-dark-900 font-bold text-sm mb-1">Complete Transparency</h4>
                <p class="text-xs text-slate-500">Zero hidden costs, exact developer payment schedules, and clear terms.</p>
              </div>
            </div>

          </div>

        </div>
      </div>
    </section>

  </main>

  <!-- ========================================================================= -->
  <!-- PAGE VIEW 2: ALL PROPERTIES CATALOG (LIGHT SPRINGFIELD STYLE) -->
  <!-- ========================================================================= -->
  <main id="view-properties" class="page-view flex-grow py-14 bg-[#F8F9FA]">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      
      <!-- Catalog Header -->
      <div class="border-b border-slate-200 pb-6 mb-8">
        <div class="flex items-center space-x-2 text-xs text-slate-500 mb-2">
          <a href="#home" onclick="navigateTo('home'); return false;" class="hover:text-dark-900">Home</a>
          <span>/</span>
          <span class="text-primary-700 font-bold">Properties Catalog</span>
        </div>
        <h1 class="font-display text-3xl sm:text-4xl font-extrabold text-dark-900">
          All Properties in New Chandigarh
        </h1>
        <p class="text-slate-500 text-sm mt-1">Explore live listings, pricing, and configurations directly synced with our database.</p>
      </div>

      <!-- Filters & Sorting Bar -->
      <div class="bg-white border border-slate-200 rounded-2xl p-4 mb-10 flex flex-col md:flex-row justify-between items-stretch md:items-center gap-4 shadow-sm">
        
        <!-- Category Filter Buttons -->
        <div class="flex items-center space-x-2 overflow-x-auto text-xs font-bold uppercase tracking-wider">
          <button onclick="setCatalogFilter('All')" class="catalog-filter-btn active px-4 py-2 rounded-full bg-dark-900 text-white transition-all" data-type="All">All (<span id="count-all">10</span>)</button>
          <button onclick="setCatalogFilter('Residential')" class="catalog-filter-btn px-4 py-2 rounded-full text-slate-600 hover:text-dark-900 transition-all" data-type="Residential">Apartments</button>
          <button onclick="setCatalogFilter('Villas')" class="catalog-filter-btn px-4 py-2 rounded-full text-slate-600 hover:text-dark-900 transition-all" data-type="Villas">Villas</button>
          <button onclick="setCatalogFilter('Independent Floors')" class="catalog-filter-btn px-4 py-2 rounded-full text-slate-600 hover:text-dark-900 transition-all" data-type="Independent Floors">Independent Floors</button>
          <button onclick="setCatalogFilter('Plots')" class="catalog-filter-btn px-4 py-2 rounded-full text-slate-600 hover:text-dark-900 transition-all" data-type="Plots">Plots</button>
        </div>

        <!-- Search input -->
        <div class="relative w-full md:w-72">
          <input type="text" id="catalog-search-input" oninput="filterCatalog()" placeholder="Search project name..." class="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs text-dark-900 placeholder-slate-400 focus:outline-none focus:border-dark-900 focus:bg-white">
        </div>

      </div>

      <!-- Properties Grid -->
      <div id="catalog-properties-grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        <!-- Injected via JavaScript -->
      </div>

    </div>
  </main>

  <!-- ========================================================================= -->
  <!-- PAGE VIEW 3: DEDICATED SINGLE PROPERTY DETAIL PAGE (MULTI-PAGE) -->
  <!-- ========================================================================= -->
  <main id="view-property-detail" class="page-view flex-grow py-12 bg-[#F8F9FA]">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      
      <!-- Back Navigation & Breadcrumbs -->
      <div class="flex items-center justify-between border-b border-slate-200 pb-4 mb-6">
        <button onclick="navigateTo('properties')" class="flex items-center space-x-2 text-xs font-bold text-dark-900 hover:text-primary-600 transition-colors">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>
          <span>Back to All Properties</span>
        </button>
        <div class="text-xs text-slate-500">
          <span id="detail-breadcrumb-type" class="text-slate-400">Residential</span> / <span id="detail-breadcrumb-title" class="text-dark-900 font-bold">The Lake by Omaxe</span>
        </div>
      </div>

      <!-- MAIN PROPERTY PRESENTATION -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-10">
        
        <!-- Left: Image Gallery & Project Specifications -->
        <div class="lg:col-span-8 space-y-8">
          
          <!-- Main Hero Image Showcase -->
          <div class="rounded-3xl overflow-hidden border border-slate-200 shadow-md relative aspect-[16/10] bg-slate-100">
            <img id="detail-main-image" src="" alt="Property" class="w-full h-full object-cover">
            <div class="absolute top-4 left-4 flex gap-2">
              <span id="detail-type-badge" class="bg-white/90 backdrop-blur text-dark-900 text-xs font-bold uppercase tracking-wider px-3.5 py-1.5 rounded-full shadow-sm">Residential</span>
              <span id="detail-status-badge" class="bg-emerald-600 text-white text-xs font-bold uppercase tracking-wider px-3.5 py-1.5 rounded-full shadow-sm">Ready to Move</span>
            </div>
            <div class="absolute bottom-4 left-4">
              <span id="detail-price-badge" class="bg-dark-900 text-white font-extrabold text-base sm:text-xl px-4 py-2 rounded-xl shadow-lg"></span>
            </div>
          </div>

          <!-- Thumbnail Selector Strip -->
          <div id="detail-thumbnails-strip" class="flex gap-3 overflow-x-auto pb-2">
            <!-- Injected by JS -->
          </div>

          <!-- Project Title & Address -->
          <div class="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
            <h1 id="detail-title" class="font-display text-2xl sm:text-4xl font-extrabold text-dark-900 mb-2"></h1>
            <div class="flex items-center gap-2 text-slate-500 text-sm">
              <svg class="w-4 h-4 text-primary-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
              <span id="detail-address"></span>
            </div>
          </div>

          <!-- Project Overview & Description -->
          <div class="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm">
            <h3 class="font-display text-xl font-bold text-dark-900 mb-4">Project Overview</h3>
            <p id="detail-description" class="text-slate-600 text-sm leading-relaxed font-normal whitespace-pre-line"></p>
          </div>

          <!-- Available Unit Configurations & Sizes -->
          <div class="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm">
            <h3 class="font-display text-xl font-bold text-dark-900 mb-5">Unit Configurations & Sizes</h3>
            <div id="detail-units-list" class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <!-- Injected by JS -->
            </div>
          </div>

          <!-- Amenities Grid -->
          <div class="bg-white p-8 rounded-2xl border border-slate-200 shadow-sm">
            <h3 class="font-display text-xl font-bold text-dark-900 mb-5">Features & Amenities</h3>
            <div id="detail-amenities-list" class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <!-- Injected by JS -->
            </div>
          </div>

        </div>

        <!-- Right: VIP Inquiry Box & Advisor Contact (Sticky) -->
        <div class="lg:col-span-4">
          <div class="sticky top-28 space-y-6">
            
            <div class="bg-white p-6 sm:p-8 rounded-2xl border border-slate-200 shadow-md">
              <span class="text-primary-700 text-[10px] uppercase tracking-widest font-bold block mb-1">Direct Developer Pricing</span>
              <h3 class="font-display text-xl font-bold text-dark-900 mb-2">Request Floor Plans & Price Sheet</h3>
              <p class="text-slate-500 text-xs mb-6">Receive full brochure, unit layout drawings, and payment schedule on WhatsApp.</p>

              <form onsubmit="handleDetailInquiry(event)" class="space-y-4">
                <div>
                  <label class="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">Your Full Name *</label>
                  <input type="text" id="detail-lead-name" required placeholder="e.g. Rajiv Kumar" class="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs text-dark-900 placeholder-slate-400 focus:outline-none focus:border-dark-900 focus:bg-white">
                </div>

                <div>
                  <label class="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">WhatsApp Phone Number *</label>
                  <input type="tel" id="detail-lead-phone" required placeholder="+91 98765 43210" class="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs text-dark-900 placeholder-slate-400 focus:outline-none focus:border-dark-900 focus:bg-white">
                </div>

                <div>
                  <label class="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">Preferred Unit Size</label>
                  <select id="detail-lead-unit" class="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs text-dark-900 focus:outline-none focus:border-dark-900 focus:bg-white">
                    <option value="2 BHK / 3 BHK">2 BHK / 3 BHK</option>
                    <option value="4 BHK / Luxury Floor">4 BHK / Luxury Floor</option>
                    <option value="Villa / Penthouse">Villa / Penthouse</option>
                    <option value="Plot">Plot (150-500 Sq.Yds)</option>
                  </select>
                </div>

                <button type="submit" id="detail-submit-btn" class="btn-springfield w-full py-3.5 rounded-xl text-xs uppercase tracking-widest font-extrabold flex items-center justify-center gap-2 shadow-sm">
                  <span>Download Price Sheet</span>
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
                </button>
                <div id="detail-form-feedback" class="text-center text-xs font-semibold text-emerald-600 pt-1 hidden"></div>
              </form>

              <!-- Direct WhatsApp Button -->
              <div class="mt-6 pt-6 border-t border-slate-100 text-center">
                <a id="detail-whatsapp-btn" href="#" target="_blank" class="w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl border border-emerald-500/50 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 text-xs font-bold transition-all">
                  <svg class="w-4 h-4 fill-emerald-600" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
                  <span>Chat on WhatsApp</span>
                </a>
              </div>
            </div>

            <!-- Direct Call Assistance -->
            <div class="bg-white p-6 rounded-2xl border border-slate-200 text-center shadow-sm">
              <p class="text-xs text-slate-500 mb-1">Direct Advisor Line</p>
              <a href="tel:+919988772999" class="text-dark-900 hover:text-primary-600 font-extrabold text-base transition-colors">+91 99887 72999</a>
            </div>

          </div>
        </div>

      </div>

    </div>
  </main>

  <!-- ========================================================================= -->
  <!-- PAGE VIEW 4: ABOUT US PAGE (LIGHT SPRINGFIELD STYLE) -->
  <!-- ========================================================================= -->
  <main id="view-about" class="page-view flex-grow py-16 bg-white">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      
      <div class="text-center max-w-3xl mx-auto mb-16">
        <span class="text-primary-600 text-xs uppercase tracking-[0.25em] font-bold block mb-2">About Bioque Estates</span>
        <h1 class="font-display text-3xl sm:text-5xl font-extrabold text-dark-900 tracking-tight mb-4">
          Redefining Real Estate Excellence
        </h1>
        <p class="text-slate-500 text-sm leading-relaxed">Built on uncompromising credibility, transparency, and top-tier service across Tri-City, Gurugram, and Noida.</p>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center mb-20">
        <div class="space-y-5 text-slate-600 text-sm sm:text-base leading-relaxed">
          <p>
            <strong class="text-dark-900">BIOQUE ESTATES</strong> is a rapidly growing Real Estate development and consultancy firm of the new generation. The company was established with the motive to offer credibility, transparency, and unmatched quality to clients all around Tri-City and beyond.
          </p>
          <p>
            We have grown with the idea of becoming leading developers and trusted advisors. Bioque Estates is deliberately focused on delivering the highest standards of quality in all its activities. That is why today, we stand tall on the foundation of our core values—delivering quality real estate spaces, ensuring genuine customer satisfaction, and redefining lifestyle standards.
          </p>
          <p>
            As a full-spectrum real estate company, we cater to all requirements under one single roof: property purchase and sales, relocation assistance, developer plot investments, documentation, title search, market advisory, and home financing.
          </p>
        </div>

        <div class="relative rounded-3xl overflow-hidden border border-slate-200 shadow-xl">
          <img src="https://images.unsplash.com/photo-1600566753376-12c8ab7fb75b?auto=format&fit=crop&w=1200&q=85" alt="Bioque Estates Advisory" class="w-full h-[420px] object-cover">
        </div>
      </div>

      <!-- Core Pillars Grid -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div class="p-8 rounded-3xl bg-slate-50 border border-slate-100 text-center">
          <div class="w-12 h-12 rounded-2xl bg-primary-100 text-primary-700 flex items-center justify-center mx-auto mb-4">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>
          </div>
          <h3 class="font-display text-lg font-bold text-dark-900 mb-2">Unwavering Credibility</h3>
          <p class="text-xs text-slate-500 leading-relaxed">Verified documentation, crystal-clear ownership titles, and direct developer affiliations.</p>
        </div>

        <div class="p-8 rounded-3xl bg-slate-50 border border-slate-100 text-center">
          <div class="w-12 h-12 rounded-2xl bg-primary-100 text-primary-700 flex items-center justify-center mx-auto mb-4">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
          </div>
          <h3 class="font-display text-lg font-bold text-dark-900 mb-2">Absolute Transparency</h3>
          <p class="text-xs text-slate-500 leading-relaxed">No hidden brokerage fees, fair market valuations, and direct developer pricing.</p>
        </div>

        <div class="p-8 rounded-3xl bg-slate-50 border border-slate-100 text-center">
          <div class="w-12 h-12 rounded-2xl bg-primary-100 text-primary-700 flex items-center justify-center mx-auto mb-4">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
          </div>
          <h3 class="font-display text-lg font-bold text-dark-900 mb-2">End-to-End Advisory</h3>
          <p class="text-xs text-slate-500 leading-relaxed">From private property tours to home loans, registration, and keys handover.</p>
        </div>
      </div>

    </div>
  </main>

  <!-- ========================================================================= -->
  <!-- PAGE VIEW 5: SERVICES PAGE (LIGHT SPRINGFIELD STYLE) -->
  <!-- ========================================================================= -->
  <main id="view-services" class="page-view flex-grow py-16 bg-[#F8F9FA]">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      
      <div class="text-center max-w-3xl mx-auto mb-16">
        <span class="text-primary-600 text-xs uppercase tracking-[0.25em] font-bold block mb-2">Our Capabilities</span>
        <h1 class="font-display text-3xl sm:text-5xl font-extrabold text-dark-900 tracking-tight mb-4">
          Bespoke Real Estate Services
        </h1>
        <p class="text-slate-500 text-sm">Comprehensive advisory tailored for high-net-worth families, end-users, and NRI investors.</p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        
        <div class="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm flex flex-col">
          <div class="w-12 h-12 rounded-2xl bg-primary-100 text-primary-700 flex items-center justify-center mb-6">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>
          </div>
          <h3 class="font-display text-xl font-bold text-dark-900 mb-3">Residential Property Sales</h3>
          <p class="text-slate-500 text-xs leading-relaxed flex-grow">Exclusive inventory access to premier Omaxe waterfront apartments, designer independent floors, and luxury duplex villas.</p>
        </div>

        <div class="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm flex flex-col">
          <div class="w-12 h-12 rounded-2xl bg-primary-100 text-primary-700 flex items-center justify-center mb-6">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
          </div>
          <h3 class="font-display text-xl font-bold text-dark-900 mb-3">Developer Plots & Land Advisory</h3>
          <p class="text-slate-500 text-xs leading-relaxed flex-grow">Prime residential plots from 150 to 500 Sq.Yds with immediate registry status and exponential capital growth potential.</p>
        </div>

        <div class="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm flex flex-col">
          <div class="w-12 h-12 rounded-2xl bg-primary-100 text-primary-700 flex items-center justify-center mb-6">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          </div>
          <h3 class="font-display text-xl font-bold text-dark-900 mb-3">NRI Property Portfolio Desk</h3>
          <p class="text-slate-500 text-xs leading-relaxed flex-grow">Dedicated concierge for non-resident Indians: virtual 3D site visits, POA management, repatriation advisory, and rental leasing.</p>
        </div>

      </div>

    </div>
  </main>

  <!-- ========================================================================= -->
  <!-- PAGE VIEW 6: CONTACT US PAGE (LIGHT SPRINGFIELD STYLE) -->
  <!-- ========================================================================= -->
  <main id="view-contact" class="page-view flex-grow py-16 bg-white">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      
      <div class="text-center max-w-3xl mx-auto mb-16">
        <span class="text-primary-600 text-xs uppercase tracking-[0.25em] font-bold block mb-2">Connect With Us</span>
        <h1 class="font-display text-3xl sm:text-5xl font-extrabold text-dark-900 tracking-tight mb-4">
          Plan Your Private VIP Site Visit
        </h1>
        <p class="text-slate-500 text-sm">Our luxury property consultants are at your service for private tours and customized portfolio reviews.</p>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-12 gap-12">
        
        <!-- Contact Info Cards -->
        <div class="lg:col-span-5 space-y-6">
          
          <div class="p-6 rounded-2xl bg-slate-50 border border-slate-100">
            <div class="flex items-start space-x-4">
              <div class="w-10 h-10 rounded-xl bg-primary-100 text-primary-700 flex items-center justify-center shrink-0">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
              </div>
              <div>
                <h4 class="text-dark-900 font-bold text-sm">Head Office Location</h4>
                <p class="text-slate-500 text-xs mt-1 leading-relaxed">SCO 118-119, Level II, Madhya Marg, Sector 8-C, Chandigarh - 160009</p>
              </div>
            </div>
          </div>

          <div class="p-6 rounded-2xl bg-slate-50 border border-slate-100">
            <div class="flex items-start space-x-4">
              <div class="w-10 h-10 rounded-xl bg-primary-100 text-primary-700 flex items-center justify-center shrink-0">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>
              </div>
              <div>
                <h4 class="text-dark-900 font-bold text-sm">Direct Advisor Line</h4>
                <p class="text-slate-500 text-xs mt-1">
                  <a href="tel:+919988772999" class="hover:text-primary-600 transition-colors font-bold text-sm text-dark-900">+91 99887 72999</a>
                </p>
              </div>
            </div>
          </div>

          <div class="p-6 rounded-2xl bg-slate-50 border border-slate-100">
            <div class="flex items-start space-x-4">
              <div class="w-10 h-10 rounded-xl bg-primary-100 text-primary-700 flex items-center justify-center shrink-0">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
              </div>
              <div>
                <h4 class="text-dark-900 font-bold text-sm">Email Address</h4>
                <p class="text-slate-500 text-xs mt-1">
                  <a href="mailto:estatesbioque@gmail.com" class="hover:text-primary-600 transition-colors">estatesbioque@gmail.com</a>
                </p>
              </div>
            </div>
          </div>

        </div>

        <!-- Contact & Booking Form -->
        <div class="lg:col-span-7 bg-slate-50 p-8 sm:p-10 rounded-3xl border border-slate-200 shadow-sm">
          <h3 class="font-display text-2xl font-bold text-dark-900 mb-2">Schedule A Private Site Tour</h3>
          <p class="text-slate-500 text-xs mb-6">Experience New Chandigarh projects firsthand with personal walkthroughs.</p>

          <form onsubmit="handleGeneralInquiry(event)" class="space-y-4">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label class="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">Full Name *</label>
                <input type="text" id="contact-name" required placeholder="e.g. Rajiv Kumar" class="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs text-dark-900 placeholder-slate-400 focus:outline-none focus:border-dark-900">
              </div>
              <div>
                <label class="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">WhatsApp Phone *</label>
                <input type="tel" id="contact-phone" required placeholder="+91 98765 43210" class="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs text-dark-900 placeholder-slate-400 focus:outline-none focus:border-dark-900">
              </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label class="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">Property of Interest</label>
                <select id="contact-project" class="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs text-dark-900 focus:outline-none focus:border-dark-900">
                  <option value="The Lake by Omaxe">The Lake by Omaxe</option>
                  <option value="Omaxe Mulberry Villas">Omaxe Mulberry Villas</option>
                  <option value="Celestia Royal Premier">Celestia Royal Premier</option>
                  <option value="Omaxe Cassia">Omaxe Cassia</option>
                  <option value="Omaxe Residential Plots">Omaxe Residential Plots</option>
                  <option value="The Resort New Chandigarh">The Resort New Chandigarh</option>
                  <option value="Omaxe Silver Birch">Omaxe Silver Birch</option>
                  <option value="Omaxe Ambrosia">Omaxe Ambrosia</option>
                </select>
              </div>

              <div>
                <label class="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">Preferred Date / Time</label>
                <input type="text" id="contact-datetime" placeholder="e.g. Tomorrow at 3:00 PM" class="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs text-dark-900 placeholder-slate-400 focus:outline-none focus:border-dark-900">
              </div>
            </div>

            <div>
              <label class="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1">Special Requirements (Optional)</label>
              <textarea id="contact-message" rows="3" placeholder="Tell us about preferred facing, floor preference, or immediate possession requirement..." class="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs text-dark-900 placeholder-slate-400 focus:outline-none focus:border-dark-900"></textarea>
            </div>

            <button type="submit" id="contact-submit-btn" class="btn-springfield w-full py-3.5 rounded-xl text-xs uppercase tracking-widest font-extrabold flex items-center justify-center gap-2 shadow-md">
              <span>Confirm Site Visit Request</span>
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
            </button>
            <div id="contact-feedback" class="text-center text-xs font-semibold text-emerald-600 pt-1 hidden"></div>
          </form>

        </div>

      </div>

    </div>
  </main>

  <!-- FOOTER -->
  <footer class="bg-white border-t border-slate-200 py-12 text-slate-500 text-xs">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="flex flex-col md:flex-row justify-between items-center gap-6 border-b border-slate-100 pb-8 mb-8">
        <div class="flex items-center space-x-3.5">
          <img src="${LOGO_URL}" alt="Bioque Logo" class="h-10 w-auto object-contain rounded border border-slate-200 p-0.5 bg-white">
          <div>
            <span class="font-display text-lg font-bold text-dark-900 block">BIOQUE ESTATES INTERNATIONAL</span>
            <span class="text-[9px] uppercase tracking-widest text-primary-600 font-bold">Exclusive Luxury Real Estate Advisory</span>
          </div>
        </div>
        <div class="flex flex-wrap gap-6 text-xs uppercase tracking-wider font-bold text-slate-600">
          <a href="#home" onclick="navigateTo('home'); return false;" class="hover:text-dark-900">Home</a>
          <a href="#properties" onclick="navigateTo('properties'); return false;" class="hover:text-dark-900">Properties</a>
          <a href="#about" onclick="navigateTo('about'); return false;" class="hover:text-dark-900">About</a>
          <a href="#services" onclick="navigateTo('services'); return false;" class="hover:text-dark-900">Services</a>
          <a href="#contact" onclick="navigateTo('contact'); return false;" class="hover:text-dark-900">Contact</a>
        </div>
      </div>

      <div class="flex flex-col sm:flex-row justify-between items-center text-center sm:text-left gap-4 text-slate-400">
        <p>© 2026 Bioque Estates International. All rights reserved. Registered Office: SCO 118-119, Level II, Madhya Marg, Sector 8-C, Chandigarh.</p>
        <p class="text-primary-700 font-bold">New Chandigarh • Chandigarh • Gurugram • Noida</p>
      </div>
    </div>
  </footer>

  <!-- ========================================================================= -->
  <!-- JAVASCRIPT: MULTI-PAGE ROUTING & DYNAMIC PROPERTY LOGIC -->
  <!-- ========================================================================= -->
  <script>
    const LIVE_PROPERTIES = ${propertiesJson};
    let currentCategoryFilter = 'All';

    // Helper: Parse configurations safely
    function parseConfigs(p) {
      if (!p.configurations) return { units: [], sizes: '', amenities: [] };
      let c = p.configurations;
      if (typeof c === 'string') {
        try { c = JSON.parse(c); } catch(e) { c = {}; }
      }
      return {
        units: Array.isArray(c.units) ? c.units : (c.units ? [c.units] : []),
        sizes: c.sizes || '',
        amenities: Array.isArray(c.amenities) ? c.amenities : []
      };
    }

    // --- 1. MULTI-PAGE NAVIGATION CONTROLLER ---
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

    // --- 2. RENDER PROPERTY CARDS (SPRINGFIELD CLEAN LIGHT CARDS) ---
    function createPropertyCard(p) {
      const cfg = parseConfigs(p);
      const unitsDisplay = cfg.units.length > 0 ? cfg.units.slice(0, 2).join(' • ') : (cfg.sizes || 'Multiple Layouts');
      const img = p.image_url || 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=80';

      return \`
        <div class="springfield-card overflow-hidden flex flex-col h-full group">
          
          <!-- Image Banner -->
          <div class="relative aspect-[16/10] overflow-hidden bg-slate-100">
            <img src="\${img}" alt="\${p.title}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500">
            
            <span class="absolute top-3 left-3 bg-white/90 backdrop-blur text-dark-900 font-extrabold text-[10px] uppercase tracking-wider px-3 py-1 rounded-full shadow-sm">
              \${p.property_type || 'Residential'}
            </span>

            <span class="absolute bottom-3 left-3 bg-dark-900 text-white font-extrabold text-xs px-3.5 py-1.5 rounded-xl shadow-md">
              \${p.price || 'Price on Request'}
            </span>
          </div>

          <!-- Content -->
          <div class="p-6 flex-1 flex flex-col">
            <h3 class="font-display font-extrabold text-dark-900 text-xl mb-1 group-hover:text-primary-700 transition-colors">\${p.title}</h3>
            
            <div class="text-xs text-primary-700 font-bold mb-3 tracking-wide">\${unitsDisplay}</div>
            
            <p class="text-slate-500 text-xs leading-relaxed line-clamp-2 mb-4 flex-grow font-normal">\${p.description || ''}</p>

            <div class="flex items-center gap-1.5 text-slate-400 text-xs mb-5 font-medium">
              <svg class="w-3.5 h-3.5 text-primary-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
              <span class="truncate">\${p.address || 'Omaxe New Chandigarh'}</span>
            </div>

            <!-- Action Buttons -->
            <div class="pt-4 border-t border-slate-100 flex items-center gap-2 mt-auto">
              <button onclick="navigateTo('property-detail', '\${p.id}')" class="flex-1 btn-springfield text-xs text-center py-2.5 rounded-xl uppercase tracking-wider font-extrabold flex items-center justify-center gap-1.5">
                <span>View Details</span>
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7"/></svg>
              </button>

              <a href="https://wa.me/919988772999?text=Hi%20Bioque%20Estates,%20I%20am%20interested%20in%20\${encodeURIComponent(p.title)}" target="_blank" class="p-2.5 rounded-xl border border-emerald-500/40 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-all flex items-center justify-center" title="Chat on WhatsApp">
                <svg class="w-4 h-4 fill-emerald-600" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
              </a>
            </div>

          </div>

        </div>
      \`;
    }

    function renderGrids() {
      // Home Grid
      const homeGrid = document.getElementById('home-properties-grid');
      if (homeGrid) {
        homeGrid.innerHTML = LIVE_PROPERTIES.slice(0, 6).map(createPropertyCard).join('');
      }
      // Catalog Grid
      filterCatalog();
    }

    function filterCatalog() {
      const catalogGrid = document.getElementById('catalog-properties-grid');
      const searchVal = (document.getElementById('catalog-search-input')?.value || '').toLowerCase().trim();
      
      const filtered = LIVE_PROPERTIES.filter(p => {
        const matchesCategory = (currentCategoryFilter === 'All') || (p.property_type === currentCategoryFilter);
        const matchesSearch = !searchVal || p.title.toLowerCase().includes(searchVal) || (p.description || '').toLowerCase().includes(searchVal);
        return matchesCategory && matchesSearch;
      });

      if (catalogGrid) {
        if (filtered.length === 0) {
          catalogGrid.innerHTML = \`<div class="col-span-3 py-12 text-center text-slate-400 font-medium">No properties match your search criteria.</div>\`;
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

    // --- 3. DEDICATED SINGLE PROPERTY DETAIL PAGE ---
    function renderPropertyDetail(propId) {
      const p = LIVE_PROPERTIES.find(item => item.id === propId) || LIVE_PROPERTIES[0];
      if (!p) return;

      const cfg = parseConfigs(p);

      document.getElementById('detail-breadcrumb-type').innerText = p.property_type || 'Residential';
      document.getElementById('detail-breadcrumb-title').innerText = p.title;
      document.getElementById('detail-title').innerText = p.title;
      document.getElementById('detail-address').innerText = p.address || 'Omaxe New Chandigarh, Punjab';
      document.getElementById('detail-description').innerText = p.description || '';
      document.getElementById('detail-price-badge').innerText = p.price || 'Price on Request';
      document.getElementById('detail-type-badge').innerText = p.property_type || 'Residential';
      
      const img = p.image_url || 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1600&q=85';
      const mainImgEl = document.getElementById('detail-main-image');
      mainImgEl.src = img;

      // Thumbnails
      const allImgs = (p.images && p.images.length > 0) ? p.images : [img];
      const thumbsContainer = document.getElementById('detail-thumbnails-strip');
      thumbsContainer.innerHTML = allImgs.map((thumbUrl) => \`
        <button onclick="document.getElementById('detail-main-image').src='\${thumbUrl}'" class="w-20 h-14 rounded-xl overflow-hidden border border-slate-200 hover:border-dark-900 shrink-0 transition-all">
          <img src="\${thumbUrl}" class="w-full h-full object-cover">
        </button>
      \`).join('');

      // Unit Configurations
      const unitsContainer = document.getElementById('detail-units-list');
      const units = cfg.units.length > 0 ? cfg.units : (cfg.sizes ? [cfg.sizes] : ['Custom Layouts Available']);
      
      unitsContainer.innerHTML = units.map(u => \`
        <div class="flex items-center space-x-3 p-3.5 rounded-xl bg-slate-50 border border-slate-100">
          <div class="w-2.5 h-2.5 rounded-full bg-primary-600 shrink-0"></div>
          <span class="text-xs font-bold text-dark-900">\${u}</span>
        </div>
      \`).join('');

      // Amenities List
      const amenitiesContainer = document.getElementById('detail-amenities-list');
      const amenities = cfg.amenities.length > 0 ? cfg.amenities : ['Grand Clubhouse Access', 'Resort Swimming Pool', '24x7 High-Tech Security', '100% Power Backup', 'Dedicated Covered Parking'];

      amenitiesContainer.innerHTML = amenities.map(a => \`
        <div class="flex items-center space-x-3 p-3.5 rounded-xl bg-slate-50 border border-slate-100">
          <svg class="w-4 h-4 text-emerald-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>
          <span class="text-xs font-semibold text-slate-700">\${a}</span>
        </div>
      \`).join('');

      // WhatsApp Button
      const waBtn = document.getElementById('detail-whatsapp-btn');
      waBtn.href = \`https://wa.me/919988772999?text=Hi%20Bioque%20Estates,%20I%20would%20like%20details,%20floor%20plans%20and%20pricing%20for%20\${encodeURIComponent(p.title)}.\`;
    }

    // --- 4. FORM HANDLERS ---
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
        await fetch('/api/shared/landing-page/lead', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: '${userId}',
            name: name,
            phone: phone,
            city: 'Tri-City / New Chandigarh',
            product_name: title,
            notes: 'Requested brochure & pricing for unit type: ' + unit
          })
        });
        feedback.className = 'text-center text-xs font-semibold text-emerald-600 pt-1 block';
        feedback.innerText = 'Thank you! Brochure details & pricing sent to your WhatsApp number.';
        e.target.reset();
      } catch(err) {
        feedback.className = 'text-center text-xs font-semibold text-emerald-600 pt-1 block';
        feedback.innerText = 'Thank you! Your request has been registered.';
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
      const message = document.getElementById('contact-message').value.trim();

      btn.disabled = true;
      btn.innerText = 'Submitting...';

      try {
        await fetch('/api/shared/landing-page/lead', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: '${userId}',
            name: name,
            phone: phone,
            city: 'Tri-City / New Chandigarh',
            product_name: project,
            notes: 'Site Visit Schedule: ' + datetime + ' | Message: ' + message
          })
        });
        feedback.className = 'text-center text-xs font-semibold text-emerald-600 pt-1 block';
        feedback.innerText = 'Thank you! Your site visit request is confirmed. Our advisor will call you.';
        e.target.reset();
      } catch(err) {
        feedback.className = 'text-center text-xs font-semibold text-emerald-600 pt-1 block';
        feedback.innerText = 'Thank you! Your site visit request has been received.';
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<span>Confirm Site Visit Request</span>';
      }
    }

    // --- 5. INITIALIZATION & HASH ROUTER ---
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
        console.log('Live sync fallback used');
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

buildAndSaveWebsite().catch(err => {
  console.error('Build website error:', err);
  process.exit(1);
});
