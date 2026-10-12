const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const userId = 'b685d287-7d54-4c9c-ae03-a46bb96ebdde';
const LOGO_URL = 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/logos/b685d287-7d54-4c9c-ae03-a46bb96ebdde/1791646375197-b685d287-7d54-4c9c-ae03-a46bb96ebdde-1791646373390.jpg';
const PHONE_DISPLAY = '+91 92113 13633';
const PHONE_RAW = '919211313633';
const OFFICE_ADDRESS = 'D-3/83, Sector 16, Rohini, Delhi 110089';
const EMAIL = 'umangassociates5@gmail.com';

async function buildUmangWebsite() {
  console.log('1. Updating Umang Associates profile preferences and landing page flags...');
  const { error: profErr } = await supabaseAdmin
    .from('profiles')
    .update({ 
      business_landing_enabled: true,
      business_landing_show_products: true,
      business_landing_hero_title: 'Rohini & North West Delhi’s Premier Luxury Builder Floors & Property Advisory',
      business_landing_hero_subtitle: 'Verified 3 BHK independent builder floors, residential plots, and modern homes with clear legal titles and zero hidden brokerage.',
      contact_number: PHONE_DISPLAY,
      address: OFFICE_ADDRESS,
      notification_preferences: {
        fresh_lead: { push: true, email: true, whatsapp: true },
        lead_assigned: { push: true, email: true, whatsapp: false },
        meeting_booked: { push: true, email: true, whatsapp: true },
        expert_escalation: { push: true, email: true, whatsapp: true },
        crm_reminder: { push: true, email: true, whatsapp: false },
        system_update: { push: true, email: true, whatsapp: false }
      }
    })
    .eq('id', userId);

  if (profErr) console.error('Profile update error:', profErr);
  else console.log('✓ Profile updated successfully.');

  console.log('2. Standardizing Umang Residency property listing details...');
  await supabaseAdmin
    .from('properties')
    .update({
      address: 'Deep Vihar, Sector 24, Rohini, Delhi',
      price: '₹90 Lakhs (Negotiable)',
      property_type: 'Independent Luxury Builder Floor',
      status: 'Active',
      show_on_landing_page: true
    })
    .eq('id', '70d34eb4-354a-46e1-9b9a-41d92aa8ccde');

  console.log('3. Fetching all live properties for Umang Associates...');
  const { data: properties, error: propErr } = await supabaseAdmin
    .from('properties')
    .select('*')
    .eq('user_id', userId)
    .neq('status', 'Archived')
    .neq('status', 'Sold')
    .neq('show_on_landing_page', false)
    .order('created_at', { ascending: false });

  if (propErr) throw propErr;
  console.log(`Fetched ${properties.length} live properties with show_on_landing_page enabled.`);

  const html = generateUmangWebsiteHtml(properties);

  console.log('4. Upserting landing page with slug index to Supabase landing_pages table...');
  const { data: savedPage, error: saveErr } = await supabaseAdmin
    .from('landing_pages')
    .upsert({
      user_id: userId,
      slug: 'index',
      title: 'Umang Associates | Luxury Builder Floors in Rohini, Sector 24 & North West Delhi',
      product_name: 'Umang Associates & Umang Infratech Real Estate Portfolio',
      html_content: html
    }, { onConflict: 'user_id,slug' })
    .select()
    .single();

  if (saveErr) throw saveErr;
  console.log('✓ Successfully created and published Umang Associates Website to landing_pages (ID:', savedPage.id, ')');
}

function generateUmangWebsiteHtml(properties) {
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
        "streetAddress": p.address || "Sector 24, Rohini",
        "addressLocality": "Rohini, North West Delhi",
        "addressRegion": "Delhi",
        "postalCode": "110085",
        "addressCountry": "IN"
      },
      "offers": {
        "@type": "Offer",
        "priceCurrency": "INR",
        "price": p.price || "9000000",
        "availability": "https://schema.org/InStock",
        "seller": {
          "@type": "RealEstateAgent",
          "name": "Umang Associates",
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
        "name": "Umang Associates & Umang Infratech",
        "legalName": "Umang Associates",
        "url": "https://umanginfratech.com",
        "logo": LOGO_URL,
        "image": LOGO_URL,
        "description": "Rohini's premier real estate consultancy specializing in luxury independent builder floors, residential apartments, and commercial spaces across Sector 16, Sector 24, Pitampura, and Prashant Vihar. 100% legal verification, clear freehold titles, and pre-approved home loan assistance.",
        "telephone": PHONE_DISPLAY,
        "email": EMAIL,
        "address": {
          "@type": "PostalAddress",
          "streetAddress": "D-3/83, Sector 16, Rohini",
          "addressLocality": "Rohini, North West Delhi",
          "addressRegion": "Delhi",
          "postalCode": "110089",
          "addressCountry": "IN"
        },
        "geo": {
          "@type": "GeoCoordinates",
          "latitude": "28.7241",
          "longitude": "77.1125"
        },
        "areaServed": ["Rohini Sector 16", "Rohini Sector 24", "Deep Vihar", "Pitampura", "Prashant Vihar", "Shalimar Bagh", "North West Delhi"],
        "hasOfferCatalog": {
          "@type": "OfferCatalog",
          "name": "Umang Associates Featured Properties Portfolio",
          "itemListElement": schemaItemList
        }
      },
      {
        "@type": "FAQPage",
        "mainEntity": [
          {
            "@type": "Question",
            "name": "What types of properties does Umang Associates offer in Rohini?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Umang Associates specializes in premium freehold 3 BHK independent builder floors, luxury residential apartments, plots, and commercial properties across Sector 16, Sector 24, Deep Vihar, Pitampura, and Prashant Vihar."
            }
          },
          {
            "@type": "Question",
            "name": "Are all properties legally verified and eligible for bank home loans?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Yes, 100% of our properties feature clear freehold titles, verified legal registry documentation, and are pre-approved for hassle-free home loans with major banks like HDFC, SBI, ICICI, and Axis Bank."
            }
          },
          {
            "@type": "Question",
            "name": "Where is the Umang Associates office located?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Our office is located at D-3/83, Sector 16, Rohini, Delhi 110089. You can call or WhatsApp our property advisors directly at +91 92113 13633."
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
  <title>Umang Associates | Luxury Builder Floors & Real Estate Advisory in Rohini, Delhi</title>
  
  <meta name="title" content="Umang Associates | Luxury Builder Floors & Real Estate Advisory in Rohini, Delhi">
  <meta name="description" content="Discover verified luxury 3 BHK builder floors, freehold apartments, and residential properties in Sector 24, Sector 16 Rohini, Pitampura, and Prashant Vihar. Clear legal titles & 0% hidden brokerage.">
  <meta name="keywords" content="Umang Associates, Umang Infratech, builder floors in Rohini, 3 BHK builder floor in Sector 24 Rohini, Deep Vihar Rohini, flats in Rohini Sector 16, property dealer in Rohini, real estate agent Rohini">
  <meta name="robots" content="index, follow">
  
  <meta property="og:type" content="website">
  <meta property="og:title" content="Umang Associates | Luxury Builder Floors & Real Estate in Rohini">
  <meta property="og:description" content="Explore premium 3 BHK builder floors with lift & parking in Deep Vihar, Sector 24 Rohini. Clear titles & pre-approved loans.">
  <meta property="og:image" content="${LOGO_URL}">

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800;900&family=Playfair+Display:ital,wght@0,600;0,700;0,800;1,600&display=swap" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>

  <script>
    tailwind.config = {
      theme: {
        extend: {
          fontFamily: {
            sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
            serif: ['"Playfair Display"', 'Georgia', 'serif'],
          },
          colors: {
            navy: {
              950: '#060B16',
              900: '#0B132B',
              850: '#111D42',
              800: '#1C2541',
              700: '#3A506B',
            },
            gold: {
              400: '#E6CA9E',
              500: '#D4AF37',
              600: '#B8860B',
            },
            accent: {
              emerald: '#10B981',
              blue: '#2563EB',
            }
          }
        }
      }
    }
  </script>

  <style>
    body {
      background-color: #060B16;
      color: #E2E8F0;
      font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
      overflow-x: hidden;
    }
    .glass-nav {
      background: rgba(6, 11, 22, 0.85);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }
    .glass-card {
      background: rgba(17, 29, 66, 0.6);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.08);
      transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .glass-card:hover {
      border-color: rgba(212, 175, 55, 0.35);
      transform: translateY(-4px);
      box-shadow: 0 20px 40px -15px rgba(0, 0, 0, 0.6), 0 0 30px 0 rgba(212, 175, 55, 0.1);
    }
    .gold-btn {
      background: linear-gradient(135deg, #D4AF37 0%, #B8860B 100%);
      color: #060B16;
      font-weight: 800;
      box-shadow: 0 4px 20px -2px rgba(212, 175, 55, 0.35);
      transition: all 0.25s ease;
    }
    .gold-btn:hover {
      background: linear-gradient(135deg, #E6CA9E 0%, #D4AF37 100%);
      box-shadow: 0 6px 25px 0 rgba(212, 175, 55, 0.5);
      transform: translateY(-2px);
    }
    .hero-glow {
      position: absolute;
      width: 600px;
      height: 600px;
      background: radial-gradient(circle, rgba(37, 99, 235, 0.18) 0%, rgba(212, 175, 55, 0.12) 50%, transparent 70%);
      filter: blur(80px);
      top: -150px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 0;
      pointer-events: none;
    }
  </style>

  <script type="application/ld+json">
    ${JSON.stringify(jsonLdData)}
  </script>
</head>

<body class="selection:bg-gold-500 selection:text-navy-950">

  <!-- TOP ANNOUNCEMENT BANNER -->
  <div class="bg-gradient-to-r from-navy-900 via-gold-600/30 to-navy-900 border-b border-gold-500/20 py-2.5 px-4 text-xs font-semibold text-center text-gold-400 flex items-center justify-center gap-2">
    <span class="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
    <span>⚡ New Launch in Rohini Sector 24: <strong>Umang Residency</strong> 3 BHK Freehold Builder Floors with Lift & Car Parking. Limited Units!</span>
    <a href="#properties" class="underline hover:text-white transition-colors ml-1 font-bold">Explore Listings →</a>
  </div>

  <!-- NAVIGATION BAR -->
  <nav class="sticky top-0 z-50 glass-nav transition-all duration-300">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="flex items-center justify-between h-20">
        
        <!-- LOGO & BRAND -->
        <a href="#" class="flex items-center gap-3.5 group">
          <img src="${LOGO_URL}" alt="Umang Associates Logo" class="h-12 w-12 rounded-xl object-cover border border-gold-500/30 shadow-md group-hover:scale-105 transition-transform" />
          <div class="flex flex-col">
            <span class="font-extrabold text-xl sm:text-2xl tracking-tight text-white group-hover:text-gold-400 transition-colors">
              Umang <span class="text-gold-400">Associates</span>
            </span>
            <span class="text-[10px] font-bold tracking-widest uppercase text-slate-400">Umang Infratech • Rohini Delhi</span>
          </div>
        </a>

        <!-- DESKTOP NAV LINKS -->
        <div class="hidden md:flex items-center gap-7 text-sm font-semibold text-slate-300">
          <a href="#properties" class="hover:text-gold-400 transition-colors">Featured Properties</a>
          <a href="#video-tour" class="hover:text-gold-400 transition-colors">Virtual Tour</a>
          <a href="#advantages" class="hover:text-gold-400 transition-colors">Why Choose Us</a>
          <a href="#neighborhood" class="hover:text-gold-400 transition-colors">Locations</a>
          <a href="#reviews" class="hover:text-gold-400 transition-colors">Client Reviews</a>
          <a href="#faq" class="hover:text-gold-400 transition-colors">FAQ</a>
        </div>

        <!-- CONTACT ACTION BUTTONS -->
        <div class="flex items-center gap-3">
          <a href="tel:${PHONE_RAW}" class="hidden sm:inline-flex items-center gap-2 px-4 py-2 rounded-full border border-slate-700 bg-navy-900/60 text-xs font-bold text-slate-200 hover:border-gold-500/50 hover:text-white transition-all">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#D4AF37" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            ${PHONE_DISPLAY}
          </a>
          <a href="#contact" class="gold-btn px-5 py-2.5 rounded-full text-xs font-extrabold uppercase tracking-wider">
            Schedule Site Visit
          </a>
        </div>

      </div>
    </div>
  </nav>

  <!-- HERO SECTION -->
  <section class="relative pt-16 pb-24 lg:pt-28 lg:pb-32 overflow-hidden">
    <div class="hero-glow"></div>
    
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
      <div class="text-center max-w-3xl mx-auto">
        
        <!-- TRUST BADGE -->
        <div class="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-navy-900/80 border border-gold-500/30 text-gold-400 text-xs font-bold uppercase tracking-wider mb-6 shadow-inner">
          <span class="text-amber-400">★★★★★</span>
          <span>4.8/5 Rating • 500+ Happy Families in Rohini</span>
        </div>

        <!-- MAIN TITLE -->
        <h1 class="text-4xl sm:text-5xl lg:text-6xl font-black text-white tracking-tight leading-[1.15] mb-6">
          Find Your Dream Home in <span class="text-transparent bg-clip-text bg-gradient-to-r from-gold-400 via-amber-200 to-gold-500 font-serif italic">Rohini & North West Delhi</span>
        </h1>

        <!-- SUBTITLE -->
        <p class="text-base sm:text-lg text-slate-300 font-normal leading-relaxed mb-10 max-w-2xl mx-auto">
          Specializing in verified freehold <strong>3 BHK independent builder floors</strong>, luxury residential apartments, and prime investment properties with lift, reserved parking, wide roads, and zero hidden brokerage.
        </p>

        <!-- CTA BUTTONS -->
        <div class="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
          <a href="#properties" class="w-full sm:w-auto gold-btn px-8 py-4 rounded-full text-sm uppercase tracking-wider font-extrabold flex items-center justify-center gap-2">
            <span>Explore Properties</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          </a>
          <a href="https://wa.me/${PHONE_RAW}?text=Hi%20Umang%20Associates%2C%20I%20am%20looking%20for%20a%20property%20in%20Rohini.%20Please%20share%20current%20inventory." target="_blank" class="w-full sm:w-auto px-7 py-4 rounded-full border border-emerald-500/40 bg-emerald-950/20 text-emerald-400 hover:bg-emerald-900/30 text-sm font-bold flex items-center justify-center gap-2.5 transition-all">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
            <span>Instant WhatsApp Chat</span>
          </a>
        </div>

        <!-- STATS BAR -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-4xl mx-auto pt-8 border-t border-slate-800/80">
          <div class="p-4 rounded-2xl bg-navy-900/40 border border-slate-800">
            <div class="text-3xl font-black text-white mb-1">500+</div>
            <div class="text-xs text-slate-400 font-medium">Deals Successfully Closed</div>
          </div>
          <div class="p-4 rounded-2xl bg-navy-900/40 border border-slate-800">
            <div class="text-3xl font-black text-gold-400 mb-1">100%</div>
            <div class="text-xs text-slate-400 font-medium">Freehold Clear Titles</div>
          </div>
          <div class="p-4 rounded-2xl bg-navy-900/40 border border-slate-800">
            <div class="text-3xl font-black text-emerald-400 mb-1">₹0</div>
            <div class="text-xs text-slate-400 font-medium">Hidden Brokerage or Fees</div>
          </div>
          <div class="p-4 rounded-2xl bg-navy-900/40 border border-slate-800">
            <div class="text-3xl font-black text-white mb-1">15+ Yrs</div>
            <div class="text-xs text-slate-400 font-medium">Rohini Market Expertise</div>
          </div>
        </div>

      </div>
    </div>
  </section>

  <!-- FEATURED PROPERTIES SECTION (DYNAMICALLY HYDRATED) -->
  <section id="properties" class="py-20 relative bg-navy-950/60 border-t border-slate-900">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      
      <div class="flex flex-col md:flex-row md:items-end justify-between mb-12 gap-4">
        <div>
          <div class="inline-block text-xs font-bold uppercase tracking-wider text-gold-400 mb-2">Prime Real Estate Portfolio</div>
          <h2 class="text-3xl sm:text-4xl font-black text-white tracking-tight">
            Featured <span class="font-serif italic text-gold-400">Builder Floors & Properties</span>
          </h2>
          <p class="text-sm text-slate-400 mt-2 max-w-xl">
            Handpicked independent residences with modern lifts, two-sided open layouts, parking, and freehold ownership.
          </p>
        </div>
        <div class="flex items-center gap-2 text-xs font-semibold text-slate-400">
          <span class="inline-block w-2.5 h-2.5 rounded-full bg-emerald-400"></span>
          <span>Updated in Real Time from Inventory</span>
        </div>
      </div>

      <!-- PRODUCTS CONTAINER DYNAMICALLY REPLACED BY SERVER OR HYDRATED BY JS -->
      <div id="business-products-container">
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8" id="properties-grid">
          <!-- Dynamic cards inserted here by client script -->
        </div>
      </div>

    </div>
  </section>

  <!-- VIRTUAL TOUR & VIDEO WALKTHROUGH SECTION -->
  <section id="video-tour" class="py-20 relative border-t border-slate-800/80 bg-navy-900/30">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
        
        <div class="lg:col-span-5">
          <div class="inline-block text-xs font-bold uppercase tracking-wider text-gold-400 mb-3">Experience Before You Visit</div>
          <h2 class="text-3xl sm:text-4xl font-black text-white tracking-tight leading-tight mb-5">
            Take a Virtual Video Tour of <span class="font-serif italic text-gold-400">Umang Residency</span>
          </h2>
          <p class="text-sm text-slate-300 leading-relaxed mb-6">
            Explore the high-ceiling drawing room, expansive modular kitchen, spacious 3 bedrooms with natural ventilation, modern lift lobby, and reserved parking layout in Deep Vihar, Sector 24 Rohini.
          </p>

          <div class="space-y-3.5 mb-8 text-xs font-semibold text-slate-300">
            <div class="flex items-center gap-3">
              <span class="flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400">✓</span>
              <span>110 Gaj (~990 Sq Ft) Spacious 3 BHK Layout</span>
            </div>
            <div class="flex items-center gap-3">
              <span class="flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400">✓</span>
              <span>2 Sides Open & East-Facing for Max Daylight</span>
            </div>
            <div class="flex items-center gap-3">
              <span class="flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400">✓</span>
              <span>25 Feet Wide Road Access with Dedicated Parking</span>
            </div>
            <div class="flex items-center gap-3">
              <span class="flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400">✓</span>
              <span>Just 1 km from Rithala Metro Station (Red Line)</span>
            </div>
          </div>

          <a href="#contact" class="gold-btn inline-flex items-center gap-2 px-7 py-3.5 rounded-full text-xs uppercase tracking-wider font-extrabold">
            <span>Book Private In-Person Site Visit</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          </a>
        </div>

        <div class="lg:col-span-7">
          <div class="relative aspect-video rounded-3xl overflow-hidden glass-card border border-gold-500/20 shadow-2xl group">
            <img src="https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/properties/b685d287-7d54-4c9c-ae03-a46bb96ebdde/1791653821564-3bhkapartment-for-sale-sector24-NewDelhi-livingroom.jpg" alt="Umang Residency Living Room Video Preview" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
            <div class="absolute inset-0 bg-navy-950/60 backdrop-blur-[2px] flex flex-col items-center justify-center p-6 text-center">
              <a href="https://www.kapwing.com/videos/6aca79a15e7cc69ebaf09cd0" target="_blank" class="w-20 h-20 rounded-full bg-gold-500/90 text-navy-950 flex items-center justify-center shadow-2xl hover:scale-110 hover:bg-gold-400 transition-all cursor-pointer mb-4">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor" class="translate-x-0.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              </a>
              <h4 class="text-lg font-bold text-white mb-1">Click to Watch Full Property Video Walkthrough</h4>
              <p class="text-xs text-slate-300">Detailed interior view & construction walkthrough</p>
            </div>
          </div>
        </div>

      </div>
    </div>
  </section>

  <!-- WHY CHOOSE UMANG ASSOCIATES -->
  <section id="advantages" class="py-20 relative bg-navy-950 border-t border-slate-900">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      
      <div class="text-center max-w-2xl mx-auto mb-16">
        <div class="inline-block text-xs font-bold uppercase tracking-wider text-gold-400 mb-2">Our Core Value Proposition</div>
        <h2 class="text-3xl sm:text-4xl font-black text-white tracking-tight">
          Why Families Trust <span class="font-serif italic text-gold-400">Umang Associates</span>
        </h2>
        <p class="text-sm text-slate-400 mt-2">
          We bring institutional transparency, rigorous legal vetting, and client-first ethics to North West Delhi real estate.
        </p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
        
        <div class="glass-card p-8 rounded-3xl flex flex-col justify-between">
          <div>
            <div class="w-12 h-12 rounded-2xl bg-gold-500/20 text-gold-400 flex items-center justify-center mb-6 font-bold text-xl">
              ⚖️
            </div>
            <h3 class="text-xl font-bold text-white mb-3">100% Legal & Freehold Titles</h3>
            <p class="text-xs text-slate-300 leading-relaxed">
              Every property is thoroughly vetted for clear chain of ownership, encumbrance certificates, approved building bylaws, and valid NOCs before being offered to our buyers.
            </p>
          </div>
          <div class="mt-6 pt-4 border-t border-slate-800 text-[11px] font-bold text-gold-400 uppercase tracking-wider">
            Zero Legal Risk Guarantee
          </div>
        </div>

        <div class="glass-card p-8 rounded-3xl flex flex-col justify-between">
          <div>
            <div class="w-12 h-12 rounded-2xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center mb-6 font-bold text-xl">
              🏦
            </div>
            <h3 class="text-xl font-bold text-white mb-3">Pre-Approved Bank Loans</h3>
            <p class="text-xs text-slate-300 leading-relaxed">
              Get seamless home loan assistance with leading institutions including HDFC Bank, State Bank of India (SBI), ICICI Bank, and Axis Bank with maximum tenure and lowest interest rates.
            </p>
          </div>
          <div class="mt-6 pt-4 border-t border-slate-800 text-[11px] font-bold text-emerald-400 uppercase tracking-wider">
            Up to 80%–90% Funding Assistance
          </div>
        </div>

        <div class="glass-card p-8 rounded-3xl flex flex-col justify-between">
          <div>
            <div class="w-12 h-12 rounded-2xl bg-blue-500/20 text-blue-400 flex items-center justify-center mb-6 font-bold text-xl">
              🤝
            </div>
            <h3 class="text-xl font-bold text-white mb-3">Zero Hidden Costs & Direct Registry</h3>
            <p class="text-xs text-slate-300 leading-relaxed">
              Complete end-to-end support through token agreement, sub-registrar document drafting, stamp duty guidance, and final registry execution without surprise overheads.
            </p>
          </div>
          <div class="mt-6 pt-4 border-t border-slate-800 text-[11px] font-bold text-blue-400 uppercase tracking-wider">
            Transparent Pricing
          </div>
        </div>

      </div>
    </div>
  </section>

  <!-- LOCALITY & NEIGHBORHOOD HOTSPOTS -->
  <section id="neighborhood" class="py-20 relative bg-navy-900/30 border-t border-slate-850">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      
      <div class="text-center max-w-2xl mx-auto mb-16">
        <div class="inline-block text-xs font-bold uppercase tracking-wider text-gold-400 mb-2">Prime Connectivity & Hubs</div>
        <h2 class="text-3xl sm:text-4xl font-black text-white tracking-tight">
          Strategic Locations in <span class="font-serif italic text-gold-400">North West Delhi</span>
        </h2>
        <p class="text-sm text-slate-400 mt-2">
          Our properties are located in well-developed residential sectors with unmatched connectivity to metro, top schools, and healthcare.
        </p>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        
        <div class="glass-card p-6 rounded-2xl">
          <div class="text-gold-400 text-sm font-black mb-1">🚇 METRO CONNECTIVITY</div>
          <h4 class="text-white font-bold text-base mb-2">Rithala Metro Station</h4>
          <p class="text-xs text-slate-300 leading-relaxed">
            Just 1 to 1.5 km away. Swift Red Line access across Connaught Place, Netaji Subhash Place, and Kashmere Gate.
          </p>
        </div>

        <div class="glass-card p-6 rounded-2xl">
          <div class="text-emerald-400 text-sm font-black mb-1">🏫 PREMIER SCHOOLS</div>
          <h4 class="text-white font-bold text-base mb-2">Top Educational Hubs</h4>
          <p class="text-xs text-slate-300 leading-relaxed">
            Queen Mary's School, Ryan International, and Bal Bharati Public School within a 5 to 10-minute drive.
          </p>
        </div>

        <div class="glass-card p-6 rounded-2xl">
          <div class="text-blue-400 text-sm font-black mb-1">🏥 HEALTHCARE HUBS</div>
          <h4 class="text-white font-bold text-base mb-2">Super-Specialty Care</h4>
          <p class="text-xs text-slate-300 leading-relaxed">
            Maharaja Agrasen Hospital, Rajiv Gandhi Cancer Institute, and Fortis Shalimar Bagh nearby for 24/7 emergencies.
          </p>
        </div>

        <div class="glass-card p-6 rounded-2xl">
          <div class="text-amber-400 text-sm font-black mb-1">🌳 LIFESTYLE & PARKS</div>
          <h4 class="text-white font-bold text-base mb-2">Parks & Spiritual Centres</h4>
          <p class="text-xs text-slate-300 leading-relaxed">
            Swarn Jayanti Park, ISKCON Temple Rohini, Unity One Mall, and City Centre Mall within close proximity.
          </p>
        </div>

      </div>
    </div>
  </section>

  <!-- CLIENT REVIEWS / TESTIMONIALS -->
  <section id="reviews" class="py-20 relative bg-navy-950 border-t border-slate-900">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      
      <div class="text-center max-w-2xl mx-auto mb-16">
        <div class="inline-block text-xs font-bold uppercase tracking-wider text-gold-400 mb-2">Google 4.8★ Rated Agency</div>
        <h2 class="text-3xl sm:text-4xl font-black text-white tracking-tight">
          What Our <span class="font-serif italic text-gold-400">Homebuyers Say</span>
        </h2>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-8">
        
        <div class="glass-card p-7 rounded-3xl flex flex-col justify-between">
          <div>
            <div class="flex items-center gap-1 text-amber-400 text-sm mb-4">★★★★★</div>
            <p class="text-xs text-slate-300 leading-relaxed italic mb-6">
              "We bought a 3 BHK floor in Sector 24 through Umang Associates. Everything from legal verification to SBI home loan sanction was handled smoothly by their team. Highly recommended!"
            </p>
          </div>
          <div class="flex items-center gap-3 pt-4 border-t border-slate-800">
            <div class="w-9 h-9 rounded-full bg-gold-500/20 text-gold-400 font-bold flex items-center justify-center text-xs">RS</div>
            <div>
              <div class="text-xs font-bold text-white">Rajesh Sharma</div>
              <div class="text-[10px] text-slate-400">Owner, Umang Residency Sector 24</div>
            </div>
          </div>
        </div>

        <div class="glass-card p-7 rounded-3xl flex flex-col justify-between">
          <div>
            <div class="flex items-center gap-1 text-amber-400 text-sm mb-4">★★★★★</div>
            <p class="text-xs text-slate-300 leading-relaxed italic mb-6">
              "Finding a trustworthy property dealer in Rohini is difficult, but Umang Associates was honest from day one. Zero hidden charges, proper registry support, and genuine guidance."
            </p>
          </div>
          <div class="flex items-center gap-3 pt-4 border-t border-slate-800">
            <div class="w-9 h-9 rounded-full bg-emerald-500/20 text-emerald-400 font-bold flex items-center justify-center text-xs">AG</div>
            <div>
              <div class="text-xs font-bold text-white">Anil Gupta</div>
              <div class="text-[10px] text-slate-400">Sector 16 Rohini Resident</div>
            </div>
          </div>
        </div>

        <div class="glass-card p-7 rounded-3xl flex flex-col justify-between">
          <div>
            <div class="flex items-center gap-1 text-amber-400 text-sm mb-4">★★★★★</div>
            <p class="text-xs text-slate-300 leading-relaxed italic mb-6">
              "The builder floor in Deep Vihar had lift and reserved parking as promised. The team took us for multiple visits and assisted throughout the registry at Rohini sub-registrar."
            </p>
          </div>
          <div class="flex items-center gap-3 pt-4 border-t border-slate-800">
            <div class="w-9 h-9 rounded-full bg-blue-500/20 text-blue-400 font-bold flex items-center justify-center text-xs">PK</div>
            <div>
              <div class="text-xs font-bold text-white">Pooja Kohli</div>
              <div class="text-[10px] text-slate-400">Homebuyer, Rohini Delhi</div>
            </div>
          </div>
        </div>

      </div>
    </div>
  </section>

  <!-- INTERACTIVE BOOKING / LEAD FORM -->
  <section id="contact" class="py-20 relative bg-gradient-to-b from-navy-900 to-navy-950 border-t border-slate-850">
    <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="glass-card p-8 sm:p-12 rounded-3xl border border-gold-500/30 shadow-2xl relative">
        
        <div class="text-center max-w-xl mx-auto mb-10">
          <div class="inline-block text-xs font-bold uppercase tracking-wider text-gold-400 mb-2">Direct Advisory & Site Visits</div>
          <h2 class="text-3xl sm:text-4xl font-black text-white tracking-tight">
            Schedule a Free <span class="font-serif italic text-gold-400">Site Visit</span>
          </h2>
          <p class="text-xs sm:text-sm text-slate-300 mt-2">
            Leave your contact details and our senior property advisor will get in touch within 15 minutes to arrange a personalized property viewing.
          </p>
        </div>

        <form id="landing-lead-form" class="space-y-5">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label class="block text-xs font-bold uppercase text-slate-300 mb-2">Your Full Name *</label>
              <input type="text" id="lead-name" required placeholder="e.g. Rahul Sharma" class="w-full px-4 py-3 rounded-xl bg-navy-950/80 border border-slate-700 text-white placeholder-slate-500 text-sm focus:border-gold-500 focus:outline-none focus:ring-1 focus:ring-gold-500 transition-colors" />
            </div>
            <div>
              <label class="block text-xs font-bold uppercase text-slate-300 mb-2">WhatsApp / Phone Number *</label>
              <input type="tel" id="lead-phone" required placeholder="e.g. 9876543210" class="w-full px-4 py-3 rounded-xl bg-navy-950/80 border border-slate-700 text-white placeholder-slate-500 text-sm focus:border-gold-500 focus:outline-none focus:ring-1 focus:ring-gold-500 transition-colors" />
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label class="block text-xs font-bold uppercase text-slate-300 mb-2">Email Address (Optional)</label>
              <input type="email" id="lead-email" placeholder="e.g. rahul@example.com" class="w-full px-4 py-3 rounded-xl bg-navy-950/80 border border-slate-700 text-white placeholder-slate-500 text-sm focus:border-gold-500 focus:outline-none focus:ring-1 focus:ring-gold-500 transition-colors" />
            </div>
            <div>
              <label class="block text-xs font-bold uppercase text-slate-300 mb-2">Interested Property / Location</label>
              <select id="lead-property" class="w-full px-4 py-3 rounded-xl bg-navy-950/80 border border-slate-700 text-white text-sm focus:border-gold-500 focus:outline-none focus:ring-1 focus:ring-gold-500 transition-colors">
                <option value="Umang Residency (Sector 24 Rohini)">Umang Residency (Sector 24 Rohini - 3 BHK)</option>
                <option value="Rohini Sector 16 Properties">Rohini Sector 16 Properties</option>
                <option value="Deep Vihar Builder Floors">Deep Vihar Builder Floors</option>
                <option value="General Property Consultation">General Property Consultation</option>
              </select>
            </div>
          </div>

          <div>
            <label class="block text-xs font-bold uppercase text-slate-300 mb-2">Specific Requirements or Preferred Time</label>
            <textarea id="lead-notes" rows="2" placeholder="e.g. Looking for ready-to-move 3 BHK with bank loan, prefer visiting this Sunday morning." class="w-full px-4 py-3 rounded-xl bg-navy-950/80 border border-slate-700 text-white placeholder-slate-500 text-sm focus:border-gold-500 focus:outline-none focus:ring-1 focus:ring-gold-500 transition-colors"></textarea>
          </div>

          <button type="submit" id="submit-btn" class="w-full gold-btn py-4 rounded-xl text-sm font-extrabold uppercase tracking-wider transition-all">
            Submit & Schedule Visit Now
          </button>

          <div id="form-status" class="hidden text-center text-sm font-bold py-3 rounded-xl"></div>
        </form>

        <div class="mt-8 pt-6 border-t border-slate-800 text-center text-xs text-slate-400 flex flex-wrap justify-center gap-6">
          <span>🔒 100% Privacy Protected</span>
          <span>⚡ Sub-15 Minute Call Response</span>
          <span>🏛️ Licensed Delhi Property Advisory</span>
        </div>

      </div>
    </div>
  </section>

  <!-- FAQ SECTION -->
  <section id="faq" class="py-20 relative bg-navy-950 border-t border-slate-900">
    <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
      
      <div class="text-center mb-16">
        <div class="inline-block text-xs font-bold uppercase tracking-wider text-gold-400 mb-2">Frequently Asked Questions</div>
        <h2 class="text-3xl sm:text-4xl font-black text-white tracking-tight">
          Everything You Need to Know
        </h2>
      </div>

      <div class="space-y-4">
        
        <details class="glass-card p-6 rounded-2xl group cursor-pointer">
          <summary class="font-bold text-base text-white flex justify-between items-center list-none">
            <span>What documents are required to buy a builder floor in Rohini?</span>
            <span class="text-gold-400 group-open:rotate-180 transition-transform">▼</span>
          </summary>
          <p class="text-xs text-slate-300 mt-4 leading-relaxed">
            You will need identity proof (Aadhaar Card, PAN Card), passport-size photographs, and proof of address. Our legal department verifies the prior chain of Title Deeds, Freehold Registry, Mutation, Electricity Bill NOC, and ensures clear ownership before agreement signing.
          </p>
        </details>

        <details class="glass-card p-6 rounded-2xl group cursor-pointer">
          <summary class="font-bold text-base text-white flex justify-between items-center list-none">
            <span>Can I get a bank home loan on Umang Residency builder floors?</span>
            <span class="text-gold-400 group-open:rotate-180 transition-transform">▼</span>
          </summary>
          <p class="text-xs text-slate-300 mt-4 leading-relaxed">
            Yes, our builder floors in Sector 24 Deep Vihar have clear freehold titles and are eligible for bank loans from leading lenders like SBI, HDFC Bank, ICICI Bank, and Axis Bank. We assist with end-to-end loan document preparation and sanction.
          </p>
        </details>

        <details class="glass-card p-6 rounded-2xl group cursor-pointer">
          <summary class="font-bold text-base text-white flex justify-between items-center list-none">
            <span>What are the office timings and visit hours?</span>
            <span class="text-gold-400 group-open:rotate-180 transition-transform">▼</span>
          </summary>
          <p class="text-xs text-slate-300 mt-4 leading-relaxed">
            Our office at D-3/83, Sector 16, Rohini is open Monday through Saturday from 10:00 AM to 7:30 PM, and on Sundays by appointment. Site visits can be scheduled 7 days a week as per your convenience.
          </p>
        </details>

        <details class="glass-card p-6 rounded-2xl group cursor-pointer">
          <summary class="font-bold text-base text-white flex justify-between items-center list-none">
            <span>Do you charge any hidden brokerage fees?</span>
            <span class="text-gold-400 group-open:rotate-180 transition-transform">▼</span>
          </summary>
          <p class="text-xs text-slate-300 mt-4 leading-relaxed">
            No. We pride ourselves on transparent advisory. Standard terms are communicated clearly upfront before any token or transaction, with zero surprise commissions or hidden registry overheads.
          </p>
        </details>

      </div>
    </div>
  </section>

  <!-- FOOTER -->
  <footer class="bg-navy-950 border-t border-slate-900 py-16 text-slate-400 text-xs">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      
      <div class="grid grid-cols-1 md:grid-cols-12 gap-10 mb-12">
        
        <div class="md:col-span-5">
          <div class="flex items-center gap-3 mb-4">
            <img src="${LOGO_URL}" alt="Umang Associates Logo" class="h-10 w-10 rounded-xl object-cover border border-gold-500/30" />
            <span class="font-extrabold text-xl text-white">Umang <span class="text-gold-400">Associates</span></span>
          </div>
          <p class="text-xs text-slate-400 leading-relaxed max-w-sm mb-6">
            Leading real estate consultancy and luxury builder floor advisory in Rohini, Pitampura, and North West Delhi. Delivering verified freehold homes and transparent property acquisitions since 2010.
          </p>
          <div class="text-xs text-slate-300 font-semibold">
            📞 Call: <a href="tel:${PHONE_RAW}" class="text-gold-400 hover:underline">${PHONE_DISPLAY}</a> • ✉️ Email: <a href="mailto:${EMAIL}" class="text-gold-400 hover:underline">${EMAIL}</a>
          </div>
        </div>

        <div class="md:col-span-3">
          <h5 class="text-white font-bold text-sm mb-4">Prime Sectors & Areas</h5>
          <ul class="space-y-2 text-xs">
            <li>Sector 24 Rohini (Deep Vihar)</li>
            <li>Sector 16 Rohini</li>
            <li>Pitampura & Netaji Subhash Place</li>
            <li>Prashant Vihar & Shalimar Bagh</li>
            <li>Sector 25 & Sector 28 Rohini</li>
          </ul>
        </div>

        <div class="md:col-span-4">
          <h5 class="text-white font-bold text-sm mb-4">Office Address</h5>
          <p class="text-xs text-slate-300 leading-relaxed mb-4">
            ${OFFICE_ADDRESS}
          </p>
          <div class="p-4 rounded-xl bg-navy-900/60 border border-slate-800 text-slate-300">
            <strong>Visiting Hours:</strong><br />
            Mon - Sat: 10:00 AM - 7:30 PM<br />
            Sunday: By Prior Appointment
          </div>
        </div>

      </div>

      <div class="pt-8 border-t border-slate-900 flex flex-col sm:flex-row items-center justify-between gap-4 text-[11px] text-slate-500">
        <div>
          © 2026 Umang Associates (Umang Infratech). All rights reserved.
        </div>
        <div class="flex items-center gap-4">
          <a href="#" class="hover:text-gold-400">Privacy Policy</a>
          <span>•</span>
          <a href="#" class="hover:text-gold-400">Terms of Service</a>
          <span>•</span>
          <a href="#properties" class="hover:text-gold-400">Live Inventory</a>
        </div>
      </div>

    </div>
  </footer>

  <!-- FLOATING WHATSAPP BUTTON -->
  <a href="https://wa.me/${PHONE_RAW}?text=Hi%20Umang%20Associates%2C%20I%20am%20interested%20in%20your%20properties%20in%20Rohini." target="_blank" class="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-2xl hover:scale-110 hover:bg-emerald-400 transition-all duration-300 border-2 border-white/20" title="Chat on WhatsApp">
    <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
  </a>

  <!-- DYNAMIC LIVE_PROPERTIES CLIENT SCRIPT -->
  <script>
    // Live properties array — injected dynamically by route.ts on every request
    const LIVE_PROPERTIES = ${propertiesJson};

    function renderProperties() {
      const container = document.getElementById('properties-grid');
      if (!container) return;

      // Filter only active properties where show_on_landing_page is true/not false
      const activeProps = (LIVE_PROPERTIES || []).filter(function(p) {
        return p.status !== 'Archived' && p.status !== 'Sold' && p.show_on_landing_page !== false;
      });

      if (activeProps.length === 0) {
        container.innerHTML = '<div class="col-span-full py-12 text-center text-slate-400 font-medium">New properties are being added to our Rohini portfolio. Please check back shortly or call us directly.</div>';
        return;
      }

      var html = '';
      for (var i = 0; i < activeProps.length; i++) {
        var p = activeProps[i];
        var imgUrl = p.image_url || (p.images && p.images[0]) || 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=80';
        var priceDisplay = p.price || 'Price on Request';
        var typeDisplay = p.property_type || 'Luxury Builder Floor';
        var addressDisplay = p.address || 'Sector 24, Rohini, Delhi';
        var desc = p.description || 'Premium residential builder floor with luxury finishes, lift, and dedicated parking.';
        
        // Clean short description
        var cleanDesc = desc.split('\\n')[0].slice(0, 150) + '...';

        html += '<div class="glass-card rounded-3xl overflow-hidden flex flex-col h-full group">' +
          '<div class="relative aspect-[16/10] bg-navy-900 overflow-hidden">' +
            '<img src="' + imgUrl + '" alt="' + p.title + '" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />' +
            '<div class="absolute inset-0 bg-gradient-to-t from-navy-950/90 via-transparent to-transparent"></div>' +
            '<span class="absolute top-4 left-4 bg-navy-950/85 backdrop-blur border border-gold-500/40 text-gold-300 font-bold text-[10px] uppercase tracking-wider px-3 py-1 rounded-full shadow-lg">' + typeDisplay + '</span>' +
            '<span class="absolute bottom-4 left-4 bg-navy-900/90 backdrop-blur border border-white/10 text-white font-extrabold text-xs px-3.5 py-1.5 rounded-full shadow-lg">' + priceDisplay + '</span>' +
          '</div>' +
          '<div class="p-6 flex-1 flex flex-col">' +
            '<h3 class="font-bold text-white text-xl mb-2 tracking-tight">' + p.title + '</h3>' +
            '<div class="text-xs text-gold-400 font-semibold mb-3 flex items-center gap-1.5">' +
              '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>' +
              '<span>' + addressDisplay + '</span>' +
            '</div>' +
            '<p class="text-slate-300 font-normal text-xs mb-6 leading-relaxed flex-grow">' + cleanDesc + '</p>' +
            '<div class="mt-auto pt-4 border-t border-slate-800/80 flex gap-2.5">' +
              '<a href="#contact" class="flex-1 gold-btn text-xs text-center py-3 rounded-full uppercase tracking-wider font-extrabold">' +
                'Schedule Visit' +
              '</a>' +
              '<a href="https://wa.me/${PHONE_RAW}?text=Hi%20Umang%20Associates%2C%20I%20am%20interested%20in%20' + encodeURIComponent(p.title) + '" target="_blank" class="px-4 py-3 rounded-full border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 transition-all flex items-center justify-center" title="Chat on WhatsApp">' +
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>' +
              '</a>' +
            '</div>' +
          '</div>' +
        '</div>';
      }

      container.innerHTML = html;
    }

    // Hydrate properties on initial page load
    document.addEventListener('DOMContentLoaded', renderProperties);

    // LEAD FORM SUBMISSION
    const leadForm = document.getElementById('landing-lead-form');
    if (leadForm) {
      leadForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        const submitBtn = document.getElementById('submit-btn');
        const statusDiv = document.getElementById('form-status');
        
        const name = document.getElementById('lead-name').value.trim();
        const phone = document.getElementById('lead-phone').value.trim();
        const email = document.getElementById('lead-email').value.trim();
        const property = document.getElementById('lead-property').value;
        const notes = document.getElementById('lead-notes').value.trim();

        submitBtn.disabled = true;
        submitBtn.innerText = 'Submitting Details...';
        statusDiv.className = 'hidden';

        try {
          const res = await fetch('/api/shared/landing-page/lead', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: '${userId}',
              name: name,
              phone: phone,
              email: email || undefined,
              source: 'Website Landing Page (umanginfratech.com)',
              notes: 'Interested in: ' + property + (notes ? ' | Remarks: ' + notes : '')
            })
          });

          const data = await res.json();
          if (res.ok) {
            statusDiv.className = 'block bg-emerald-950/80 border border-emerald-500/40 text-emerald-400 text-sm font-bold p-4 rounded-xl';
            statusDiv.innerHTML = '🎉 Thank you, ' + name + '! Your site visit request has been received. Our senior property advisor will call you shortly on ' + phone + '.';
            leadForm.reset();
            submitBtn.innerText = 'Request Submitted Successfully';
          } else {
            throw new Error(data.error || 'Failed to submit request');
          }
        } catch (err) {
          statusDiv.className = 'block bg-rose-950/80 border border-rose-500/40 text-rose-400 text-sm font-bold p-4 rounded-xl';
          statusDiv.innerText = '⚠️ Could not submit: ' + err.message + '. Please call us directly at ${PHONE_DISPLAY}.';
          submitBtn.disabled = false;
          submitBtn.innerText = 'Submit & Schedule Visit Now';
        }
      });
    }
  </script>

</body>
</html>`;
}

buildUmangWebsite()
  .then(() => {
    console.log('✅ Umang Associates website build script completed.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Error building Umang Associates website:', err);
    process.exit(1);
  });
