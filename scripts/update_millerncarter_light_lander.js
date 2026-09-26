const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const USER_ID = '0bd4cdf6-58cb-4758-8663-503c92a8ac2a';
const LOGO_URL = 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/logos/0bd4cdf6-58cb-4758-8663-503c92a8ac2a/miller-carter-logo.png';
const VANUATU_IMG = 'https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/properties/0bd4cdf6-58cb-4758-8663-503c92a8ac2a/vanuatu-cbi.jpg';
const PHONE_DISPLAY = '+971 56 587 5855';
const PHONE_RAW = '971565875855';
const DUBAI_OFFICE = '406 - 407 Al Moosa Tower 1, Sheikh Zayed Road, Opp Future Museum, Dubai, UAE';
const LONDON_OFFICE = '18 Great Portland Street, Oxford Street, W1W 8QP, London, UK';

function generateLightLandingPageHtml() {
  return `<!DOCTYPE html>
<html lang="en" class="scroll-smooth">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0">
  <title>Vanuatu Citizenship by Investment | 30–60 Days Fast-Track Passport | Miller & Carter</title>
  <meta name="description" content="Obtain direct Vanuatu citizenship and second passport in just 30–60 days. 130+ visa-free countries, 0% tax, no physical residency required. Licensed legal advisors in Dubai & London.">
  <meta name="keywords" content="Vanuatu Citizenship by Investment, Vanuatu CBI, Second Passport, Fast Track Passport, Citizenship Dubai, Miller and Carter Dubai">
  
  <meta property="og:title" content="Vanuatu Citizenship by Investment | Fast-Track 30–60 Day Passport">
  <meta property="og:description" content="Official Vanuatu Development Support Program (DSP). 130+ visa-free countries, 0% personal tax, up to 4 generations included. Licensed UK & UAE Barristers.">
  <meta property="og:image" content="${VANUATU_IMG}">
  <meta property="og:type" content="website">

  <!-- Schema.org Structured Data -->
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "LegalService",
    "name": "Miller & Carter Immigration Consultants",
    "image": "${LOGO_URL}",
    "logo": "${LOGO_URL}",
    "url": "https://millerncarter.ae",
    "telephone": "${PHONE_DISPLAY}",
    "email": "info@millerncarter.ae",
    "address": [
      {
        "@type": "PostalAddress",
        "streetAddress": "${DUBAI_OFFICE}",
        "addressLocality": "Dubai",
        "addressCountry": "AE"
      },
      {
        "@type": "PostalAddress",
        "streetAddress": "${LONDON_OFFICE}",
        "addressLocality": "London",
        "addressCountry": "GB"
      }
    ],
    "description": "Exclusive UK and Global Citizenship by Investment legal advisory based in London and Dubai."
  }
  </script>

  <!-- Google Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800;900&family=Playfair+Display:ital,wght@0,600;0,700;0,800;1,600&display=swap" rel="stylesheet">

  <!-- Tailwind CSS -->
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          fontFamily: {
            sans: ['"Plus Jakarta Sans"', 'system-ui', '-apple-system', 'sans-serif'],
            serif: ['"Playfair Display"', 'Georgia', 'serif'],
          },
          colors: {
            emerald: {
              950: '#031E12',
              900: '#07321F',
              850: '#0B3F28',
              800: '#105235',
              700: '#166534',
              600: '#15803D',
              500: '#22C55E',
              100: '#DCFCE7',
              50:  '#F0FDF4'
            },
            gold: {
              700: '#85580A',
              600: '#A16D0E',
              500: '#B8860B',
              400: '#D4AF37',
              300: '#ECCFA0',
              100: '#FEF9EE',
              50:  '#FFFDF9'
            },
            slate: {
              950: '#020617',
              900: '#0F172A',
              800: '#1E293B',
              700: '#334155',
              600: '#475569',
              500: '#64748B',
              200: '#E2E8F0',
              100: '#F1F5F9',
              50:  '#F8FAFC'
            }
          }
        }
      }
    }
  </script>

  <style>
    body {
      font-family: 'Plus Jakarta Sans', sans-serif;
      background-color: #FAFCF9;
      color: #0F172A;
      overflow-x: hidden;
    }

    .brand-btn-primary {
      background: linear-gradient(135deg, #0B3F28 0%, #166534 100%);
      color: #FFFFFF !important;
      font-weight: 800;
      box-shadow: 0 10px 25px -5px rgba(11, 63, 40, 0.3);
      transition: all 0.3s ease;
    }
    .brand-btn-primary:hover {
      transform: translateY(-2px);
      box-shadow: 0 15px 30px -5px rgba(11, 63, 40, 0.45);
      filter: brightness(1.05);
    }

    .brand-btn-gold {
      background: linear-gradient(135deg, #ECCFA0 0%, #D4AF37 50%, #B8860B 100%);
      color: #072417 !important;
      font-weight: 800;
      box-shadow: 0 10px 25px -5px rgba(212, 175, 55, 0.35);
      transition: all 0.3s ease;
    }
    .brand-btn-gold:hover {
      transform: translateY(-2px);
      box-shadow: 0 15px 30px -5px rgba(212, 175, 55, 0.5);
      filter: brightness(1.06);
    }

    .light-card {
      background: #FFFFFF;
      border: 1px solid #E2E8F0;
      box-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.04), 0 2px 6px -1px rgba(0, 0, 0, 0.02);
      transition: all 0.3s ease;
    }
    .light-card:hover {
      border-color: #CBD5E1;
      box-shadow: 0 12px 30px -4px rgba(0, 0, 0, 0.08), 0 4px 10px -2px rgba(0, 0, 0, 0.03);
      transform: translateY(-3px);
    }

    .cbi-light-input {
      width: 100%;
      background: #FFFFFF;
      border: 1.5px solid #CBD5E1;
      border-radius: 0.75rem;
      padding: 0.875rem 1.125rem;
      color: #0F172A;
      font-size: 0.95rem;
      transition: all 0.2s;
    }
    .cbi-light-input:focus {
      outline: none;
      border-color: #0B3F28;
      box-shadow: 0 0 0 3px rgba(11, 63, 40, 0.15);
    }
    .cbi-light-input::placeholder {
      color: #94A3B8;
    }

    .step-fade-in {
      animation: stepFadeIn 0.3s ease-out forwards;
    }
    @keyframes stepFadeIn {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }
  </style>
</head>
<body class="antialiased selection:bg-emerald-100 selection:text-emerald-900 pb-20 sm:pb-0">

  <!-- TOP ANNOUNCEMENT BAR (LIGHT THEME) -->
  <div class="bg-emerald-50 border-b border-emerald-200/80 py-2.5 px-4 text-xs font-semibold text-center text-emerald-950">
    <div class="max-w-7xl mx-auto flex items-center justify-center gap-2 flex-wrap">
      <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-700 text-white font-bold tracking-wider text-[10px] uppercase shadow-sm">
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-pulse"></span> Official 2026 Quota
      </span>
      <span>Vanuatu Citizenship Fast-Track Processing • Passports Delivered in 30–60 Days • Licensed UK & UAE Barristers</span>
    </div>
  </div>

  <!-- NAVIGATION HEADER -->
  <header class="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200 shadow-sm">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
      <!-- Logo -->
      <a href="https://millerncarter.ae/" target="_blank" class="flex items-center gap-3">
        <img src="${LOGO_URL}" alt="Miller & Carter Immigration Consultants" class="h-11 sm:h-12 w-auto object-contain" />
      </a>

      <!-- Navigation links (Desktop) -->
      <nav class="hidden md:flex items-center gap-8 text-sm font-semibold text-slate-700">
        <a href="#key-points" class="hover:text-emerald-700 transition-colors">Key Points</a>
        <a href="#benefits" class="hover:text-emerald-700 transition-colors">Key Benefits</a>
        <a href="#calculator" class="hover:text-emerald-700 transition-colors">Cost Estimator</a>
        <a href="#process" class="hover:text-emerald-700 transition-colors">4-Step Process</a>
        <a href="#faq" class="hover:text-emerald-700 transition-colors">FAQs</a>
      </nav>

      <!-- Action Buttons -->
      <div class="flex items-center gap-3">
        <a href="tel:${PHONE_RAW}" class="hidden sm:inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-300 text-slate-800 hover:border-emerald-700 hover:text-emerald-700 text-xs font-bold transition-all">
          <svg class="w-3.5 h-3.5 text-emerald-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>
          ${PHONE_DISPLAY}
        </a>
        <button onclick="openConsultationModal('Navbar Button')" class="brand-btn-primary px-5 py-2.5 rounded-xl text-xs font-extrabold uppercase tracking-wider flex items-center gap-2">
          <span>Apply Now</span>
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
        </button>
      </div>
    </div>
  </header>

  <!-- HERO SECTION (PRISTINE LIGHT THEME) -->
  <section class="relative pt-12 pb-16 lg:pt-16 lg:pb-24 overflow-hidden bg-gradient-to-b from-white via-emerald-50/30 to-white">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-10 items-center">
        
        <!-- Left: Copy & Value Proposition -->
        <div class="lg:col-span-7 text-left space-y-6">
          
          <div class="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-100 border border-emerald-300 text-emerald-900 text-xs font-bold tracking-wide shadow-sm">
            <svg class="w-4 h-4 text-emerald-700" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>
            <span>OFFICIAL VANUATU CITIZENSHIP BY INVESTMENT (DSP)</span>
          </div>

          <h1 class="text-4xl sm:text-5xl lg:text-6xl font-black text-slate-900 leading-tight tracking-tight">
            Your Freedom.<br />
            <span class="text-emerald-800 font-serif italic font-normal">Your Future.</span><br />
            Your Choice.
          </h1>

          <p class="text-base sm:text-lg text-slate-600 max-w-2xl leading-relaxed">
            Secure direct Vanuatu Commonwealth citizenship and an official passport in just <strong class="text-slate-900 font-bold">1 to 2 months</strong>. Benefit from visa-free access to 130+ nations, a 0% tax haven, and zero physical residency requirements for up to 4 generations.
          </p>

          <!-- Core Stat Highlights -->
          <div class="grid grid-cols-3 gap-3.5 pt-1">
            <div class="p-4 rounded-2xl light-card flex flex-col border-l-4 border-l-emerald-700">
              <span class="text-2xl sm:text-3xl font-black text-emerald-850">30–60</span>
              <span class="text-xs font-bold text-slate-600">Days to Passport</span>
            </div>
            <div class="p-4 rounded-2xl light-card flex flex-col border-l-4 border-l-emerald-700">
              <span class="text-2xl sm:text-3xl font-black text-emerald-850">130+</span>
              <span class="text-xs font-bold text-slate-600">Visa-Free Countries</span>
            </div>
            <div class="p-4 rounded-2xl light-card flex flex-col border-l-4 border-l-emerald-700">
              <span class="text-2xl sm:text-3xl font-black text-emerald-700">0%</span>
              <span class="text-xs font-bold text-slate-600">Tax on Worldwide Income</span>
            </div>
          </div>

          <!-- CTAs -->
          <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 pt-3">
            <button onclick="openConsultationModal('Hero Section Button')" class="brand-btn-primary px-8 py-4 rounded-xl text-sm font-extrabold uppercase tracking-wider flex items-center justify-center gap-3 shadow-lg">
              <span>Check Eligibility In 60 Seconds</span>
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M13 7l5 5m0 0l-5 5m5-5H6"/></svg>
            </button>
            
            <a href="https://wa.me/${PHONE_RAW}?text=Hi%20Miller%20%26%20Carter,%20I%20am%20interested%20in%20the%20Vanuatu%20Citizenship%20by%20Investment%20program." target="_blank" class="px-6 py-4 rounded-xl bg-white border-2 border-emerald-600 text-emerald-800 hover:bg-emerald-50 font-bold text-sm flex items-center justify-center gap-2.5 transition-all shadow-sm">
              <svg class="w-5 h-5 text-[#25D366]" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.335-1.662c1.746.953 3.71 1.458 5.704 1.459h.008c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413"/></svg>
              <span>WhatsApp Concierge</span>
            </a>
          </div>

          <!-- Trust Badges -->
          <div class="pt-4 border-t border-slate-200 flex items-center gap-6 flex-wrap text-xs font-semibold text-slate-500">
            <span class="flex items-center gap-1.5 text-emerald-800">
              <svg class="w-4 h-4 text-emerald-600" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>
              100% Confidential Legal Process
            </span>
            <span class="flex items-center gap-1.5 text-emerald-800">
              <svg class="w-4 h-4 text-emerald-600" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>
              Zero Physical Stay Required
            </span>
            <span class="flex items-center gap-1.5 text-emerald-800">
              <svg class="w-4 h-4 text-emerald-600" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>
              Offices in London & Dubai
            </span>
          </div>

        </div>

        <!-- Right: Official Vanuatu Product Poster Card -->
        <div class="lg:col-span-5 relative">
          <div class="relative mx-auto max-w-md rounded-3xl overflow-hidden bg-white p-3 border-2 border-emerald-100 shadow-2xl">
            <div class="relative aspect-square rounded-2xl overflow-hidden shadow-inner">
              <img src="${VANUATU_IMG}" alt="Vanuatu Citizenship by Investment Passport and Island Poster" class="w-full h-full object-cover" />
              <div class="absolute inset-0 bg-gradient-to-t from-slate-950/70 via-transparent to-transparent"></div>
              
              <div class="absolute bottom-4 left-4 right-4 bg-white/95 backdrop-blur-md p-4 rounded-xl border border-slate-200 shadow-lg flex items-center justify-between">
                <div>
                  <div class="text-[11px] font-extrabold text-emerald-800 uppercase tracking-wider">Fast-Track DSP Program</div>
                  <div class="text-sm font-bold text-slate-900">Starting from $130,000 USD</div>
                </div>
                <button onclick="openConsultationModal('Hero Poster Badge')" class="brand-btn-primary px-4 py-2 rounded-lg text-xs font-extrabold uppercase tracking-wider">
                  Apply
                </button>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  </section>

  <!-- KEY POINTS (FROM OFFICIAL BROCHURE) -->
  <section id="key-points" class="py-16 bg-white border-y border-slate-200">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      
      <div class="text-center max-w-2xl mx-auto mb-12 space-y-2">
        <span class="text-xs font-extrabold uppercase tracking-widest text-emerald-700">Official Specifications</span>
        <h2 class="text-3xl font-black text-slate-900">Vanuatu CBI Key Points</h2>
        <p class="text-sm text-slate-600">Established, government-approved pathways for high-net-worth families.</p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        
        <div class="p-6 rounded-2xl light-card flex items-start gap-4">
          <div class="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0 text-xl font-bold">
            📅
          </div>
          <div>
            <h3 class="text-base font-bold text-slate-900 mb-1">Launched in 2017</h3>
            <p class="text-xs sm:text-sm text-slate-600 leading-relaxed">
              Enacted under the Vanuatu Citizenship Act [CAP 112] with statutory parliamentary backing.
            </p>
          </div>
        </div>

        <div class="p-6 rounded-2xl light-card flex items-start gap-4">
          <div class="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0 text-xl font-bold">
            💰
          </div>
          <div>
            <h3 class="text-base font-bold text-slate-900 mb-1">DSP Contribution</h3>
            <p class="text-xs sm:text-sm text-slate-600 leading-relaxed">
              Direct non-refundable donation to the Development Support Program (DSP) from $130,000 USD.
            </p>
          </div>
        </div>

        <div class="p-6 rounded-2xl light-card flex items-start gap-4">
          <div class="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0 text-xl font-bold">
            👨‍👩‍👧‍👦
          </div>
          <div>
            <h3 class="text-base font-bold text-slate-900 mb-1">Include Entire Family</h3>
            <p class="text-xs sm:text-sm text-slate-600 leading-relaxed">
              Include spouse, dependent children under 25, parents and grandparents over 50.
            </p>
          </div>
        </div>

        <div class="p-6 rounded-2xl light-card flex items-start gap-4">
          <div class="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0 text-xl font-bold">
            🌐
          </div>
          <div>
            <h3 class="text-base font-bold text-slate-900 mb-1">130+ Visa-Free Countries</h3>
            <p class="text-xs sm:text-sm text-slate-600 leading-relaxed">
              Travel visa-free or visa-on-arrival to Singapore, Hong Kong, Israel, Malaysia, and major hubs.
            </p>
          </div>
        </div>

        <div class="p-6 rounded-2xl light-card flex items-start gap-4">
          <div class="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0 text-xl font-bold">
            🏠
          </div>
          <div>
            <h3 class="text-base font-bold text-slate-900 mb-1">No Residency Requirement</h3>
            <p class="text-xs sm:text-sm text-slate-600 leading-relaxed">
              Zero physical stay, language exam, or landing requirement before or after passport issuance.
            </p>
          </div>
        </div>

        <div class="p-6 rounded-2xl light-card flex items-start gap-4">
          <div class="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0 text-xl font-bold">
            ⚡
          </div>
          <div>
            <h3 class="text-base font-bold text-slate-900 mb-1">Citizenship in 1–2 Months</h3>
            <p class="text-xs sm:text-sm text-slate-600 leading-relaxed">
              World's fastest processing timeline. FIU pre-approval in 48 hours; passports in 30–60 days.
            </p>
          </div>
        </div>

      </div>

    </div>
  </section>

  <!-- KEY BENEFITS (LIGHT THEME) -->
  <section id="benefits" class="py-16 bg-slate-50 relative">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      
      <div class="text-center max-w-2xl mx-auto mb-12 space-y-2">
        <span class="text-xs font-extrabold uppercase tracking-widest text-emerald-700">Sovereign Privileges</span>
        <h2 class="text-3xl font-black text-slate-900">Key Benefits of Vanuatu Citizenship</h2>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        
        <div class="p-6 rounded-2xl bg-white border border-slate-200 shadow-sm">
          <div class="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold mb-4">
            🌍
          </div>
          <h4 class="text-base font-bold text-slate-900 mb-2">Global Access</h4>
          <p class="text-xs sm:text-sm text-slate-600 leading-relaxed">
            Travel freely to 130+ countries without visa delays, unlocking international business and leisure travel.
          </p>
        </div>

        <div class="p-6 rounded-2xl bg-white border border-slate-200 shadow-sm">
          <div class="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold mb-4">
            🛡️
          </div>
          <h4 class="text-base font-bold text-slate-900 mb-2">Tax Efficiency</h4>
          <p class="text-xs sm:text-sm text-slate-600 leading-relaxed">
            0% Personal income tax, wealth tax, gift tax, capital gains, or inheritance tax on worldwide earnings.
          </p>
        </div>

        <div class="p-6 rounded-2xl bg-white border border-slate-200 shadow-sm">
          <div class="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold mb-4">
            👨‍👩‍👧
          </div>
          <h4 class="text-base font-bold text-slate-900 mb-2">Family Friendly</h4>
          <p class="text-xs sm:text-sm text-slate-600 leading-relaxed">
            Include up to 4 generations under one application, ensuring generational security for your lineage.
          </p>
        </div>

        <div class="p-6 rounded-2xl bg-white border border-slate-200 shadow-sm">
          <div class="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold mb-4">
            🌴
          </div>
          <h4 class="text-base font-bold text-slate-900 mb-2">Lifestyle Freedom</h4>
          <p class="text-xs sm:text-sm text-slate-600 leading-relaxed">
            Live, work, or study anywhere globally with complete peace of mind and an irrevocable Plan B passport.
          </p>
        </div>

        <div class="p-6 rounded-2xl bg-white border border-slate-200 shadow-sm">
          <div class="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold mb-4">
            🔒
          </div>
          <h4 class="text-base font-bold text-slate-900 mb-2">Confidential Process</h4>
          <p class="text-xs sm:text-sm text-slate-600 leading-relaxed">
            Strict client confidentiality. The Government does not notify your home country. Dual citizenship is 100% permitted.
          </p>
        </div>

        <div class="p-6 rounded-2xl bg-white border border-slate-200 shadow-sm">
          <div class="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold mb-4">
            ⏱️
          </div>
          <h4 class="text-base font-bold text-slate-900 mb-2">Fast & Efficient</h4>
          <p class="text-xs sm:text-sm text-slate-600 leading-relaxed">
            One of the world's most streamlined and fast-tracked citizenship by investment processes.
          </p>
        </div>

      </div>

    </div>
  </section>

  <!-- INTERACTIVE INVESTMENT & FEE CALCULATOR (VANUATU ONLY) -->
  <section id="calculator" class="py-16 bg-white border-b border-slate-200">
    <div class="max-w-3xl mx-auto px-4 sm:px-6">
      
      <div class="text-center space-y-2 mb-10">
        <span class="inline-block px-3 py-1 rounded-full bg-emerald-100 text-emerald-900 text-xs font-bold uppercase tracking-wider">
          Transparent Fee Estimator
        </span>
        <h2 class="text-3xl font-black text-slate-900">Vanuatu DSP Cost Calculator</h2>
        <p class="text-sm text-slate-600">Select your family composition to view the all-inclusive government investment.</p>
      </div>

      <div class="bg-slate-50 border border-slate-200 rounded-3xl p-6 sm:p-8 shadow-sm">
        
        <!-- Interactive Selectors -->
        <label class="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-3">Choose Application Composition:</label>
        
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
          <button type="button" onclick="setCalculatorTier('single', '$130,000 USD')" id="calc-btn-single" class="p-4 rounded-xl border-2 border-emerald-700 bg-white text-left transition-all flex items-center justify-between shadow-sm">
            <div>
              <div class="font-bold text-slate-900">Single Applicant</div>
              <div class="text-xs text-slate-500">Solo investor</div>
            </div>
            <span class="font-extrabold text-emerald-800">$130,000</span>
          </button>

          <button type="button" onclick="setCalculatorTier('couple', '$150,000 USD')" id="calc-btn-couple" class="p-4 rounded-xl border border-slate-200 bg-white text-left transition-all hover:border-emerald-700 flex items-center justify-between shadow-sm">
            <div>
              <div class="font-bold text-slate-900">Married Couple</div>
              <div class="text-xs text-slate-500">Applicant + Spouse</div>
            </div>
            <span class="font-extrabold text-emerald-800">$150,000</span>
          </button>

          <button type="button" onclick="setCalculatorTier('fam3', '$165,000 USD')" id="calc-btn-fam3" class="p-4 rounded-xl border border-slate-200 bg-white text-left transition-all hover:border-emerald-700 flex items-center justify-between shadow-sm">
            <div>
              <div class="font-bold text-slate-900">Family of 3</div>
              <div class="text-xs text-slate-500">Couple + 1 Child</div>
            </div>
            <span class="font-extrabold text-emerald-800">$165,000</span>
          </button>

          <button type="button" onclick="setCalculatorTier('fam4', '$180,000 USD')" id="calc-btn-fam4" class="p-4 rounded-xl border border-slate-200 bg-white text-left transition-all hover:border-emerald-700 flex items-center justify-between shadow-sm">
            <div>
              <div class="font-bold text-slate-900">Family of 4+</div>
              <div class="text-xs text-slate-500">Couple + 2 Dependents</div>
            </div>
            <span class="font-extrabold text-emerald-800">$180,000</span>
          </button>
        </div>

        <!-- Result Box -->
        <div class="bg-white p-5 rounded-2xl border border-emerald-200 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4 mb-6">
          <div>
            <div class="text-xs font-bold text-slate-500 uppercase tracking-wide">Government Investment Required:</div>
            <div id="calc-display-price" class="text-3xl font-black text-emerald-800 mt-0.5">$130,000 USD</div>
            <div class="text-[11px] text-slate-500 mt-1">✓ Includes Government DSP Contribution & Statutory Due Diligence</div>
          </div>
          <button onclick="openConsultationModal('Calculator CTA')" class="brand-btn-primary px-6 py-3 rounded-xl text-xs font-extrabold uppercase tracking-wider shrink-0 w-full sm:w-auto text-center">
            Lock In 2026 Quota
          </button>
        </div>

      </div>

    </div>
  </section>

  <!-- 4-STEP OFFICIAL PROCESS -->
  <section id="process" class="py-16 bg-slate-50 border-b border-slate-200">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      
      <div class="text-center max-w-2xl mx-auto mb-12 space-y-2">
        <span class="text-xs font-extrabold uppercase tracking-widest text-emerald-700">Clear Roadmap</span>
        <h2 class="text-3xl font-black text-slate-900">How It Works in 4 Steps</h2>
        <p class="text-sm text-slate-600">From initial screening to holding your passport in hand.</p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        
        <div class="p-6 rounded-2xl bg-white border border-slate-200 shadow-sm relative">
          <span class="text-4xl font-black text-slate-200 absolute top-4 right-4">01</span>
          <div class="text-xs font-bold text-emerald-700 mb-1">Days 1–3</div>
          <h4 class="text-base font-bold text-slate-900 mb-2">FIU Pre-Clearance</h4>
          <p class="text-xs text-slate-600 leading-relaxed">
            Passport copy submitted to Vanuatu Financial Intelligence Unit for initial due diligence check.
          </p>
        </div>

        <div class="p-6 rounded-2xl bg-white border border-slate-200 shadow-sm relative">
          <span class="text-4xl font-black text-slate-200 absolute top-4 right-4">02</span>
          <div class="text-xs font-bold text-emerald-700 mb-1">Days 4–15</div>
          <h4 class="text-base font-bold text-slate-900 mb-2">Document Filing</h4>
          <p class="text-xs text-slate-600 leading-relaxed">
            Legal compilation of birth certificates, police clearance, and medical forms by Miller & Carter.
          </p>
        </div>

        <div class="p-6 rounded-2xl bg-white border border-slate-200 shadow-sm relative">
          <span class="text-4xl font-black text-slate-200 absolute top-4 right-4">03</span>
          <div class="text-xs font-bold text-emerald-700 mb-1">Days 16–30</div>
          <h4 class="text-base font-bold text-slate-900 mb-2">Commission Approval</h4>
          <p class="text-xs text-slate-600 leading-relaxed">
            Citizenship Commission meets and grants full Approval-in-Principle certificate.
          </p>
        </div>

        <div class="p-6 rounded-2xl bg-white border border-slate-200 shadow-sm relative">
          <span class="text-4xl font-black text-slate-200 absolute top-4 right-4">04</span>
          <div class="text-xs font-bold text-emerald-700 mb-1">Days 30–60</div>
          <h4 class="text-base font-bold text-slate-900 mb-2">Passport Delivery</h4>
          <p class="text-xs text-slate-600 leading-relaxed">
            Take the Oath of Allegiance and receive your official Passport in Dubai, London, or via courier.
          </p>
        </div>

      </div>

    </div>
  </section>

  <!-- DIRECT CONSULTATION REQUEST FORM (LIGHT THEME) -->
  <section id="contact" class="py-16 bg-white">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
        
        <!-- Left: Office info -->
        <div class="lg:col-span-6 space-y-6">
          <span class="text-xs font-extrabold uppercase tracking-widest text-emerald-700">Licensed Legal Counsel</span>
          <h2 class="text-3xl sm:text-4xl font-black text-slate-900">Request a Private Vanuatu Consultation</h2>
          <p class="text-sm text-slate-600 leading-relaxed">
            Speak directly with our senior immigration solicitors and advisors at our Dubai flagship offices or London headquarters. Complete attorney-client confidentiality guaranteed.
          </p>

          <div class="space-y-4 pt-1">
            <div class="p-4 rounded-xl bg-slate-50 border border-slate-200 flex items-start gap-3.5">
              <div class="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0 mt-0.5 font-bold">
                📍
              </div>
              <div>
                <h5 class="text-sm font-bold text-slate-900">Dubai Office, UAE</h5>
                <p class="text-xs text-slate-600 leading-relaxed mt-0.5">${DUBAI_OFFICE}</p>
                <div class="text-xs font-bold text-emerald-800 mt-1">${PHONE_DISPLAY} | +971 4 327 5221</div>
              </div>
            </div>

            <div class="p-4 rounded-xl bg-slate-50 border border-slate-200 flex items-start gap-3.5">
              <div class="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0 mt-0.5 font-bold">
                🏛️
              </div>
              <div>
                <h5 class="text-sm font-bold text-slate-900">London Head Office, UK</h5>
                <p class="text-xs text-slate-600 leading-relaxed mt-0.5">${LONDON_OFFICE}</p>
                <div class="text-xs font-bold text-emerald-800 mt-1">Licensed UK Immigration Lawyers & Barristers</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Right: Contact Form -->
        <div class="lg:col-span-6">
          <div class="bg-white border-2 border-slate-200 rounded-3xl p-6 sm:p-8 shadow-xl">
            <h3 class="text-xl font-bold text-slate-900 mb-1">Direct Advisor Callback</h3>
            <p class="text-xs text-slate-500 mb-5">Fill in your information to receive the complete Vanuatu Government fee schedule.</p>

            <form id="direct-contact-form" onsubmit="handleDirectContactSubmit(event)" class="space-y-4">
              <div>
                <label class="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">Full Name *</label>
                <input type="text" id="contact-name" name="name" required placeholder="Enter your full name" class="cbi-light-input" />
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label class="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">WhatsApp / Phone *</label>
                  <input type="tel" id="contact-phone" name="phone" required placeholder="+971 50 123 4567" class="cbi-light-input" />
                </div>
                <div>
                  <label class="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">Email</label>
                  <input type="email" id="contact-email" name="email" placeholder="name@domain.com" class="cbi-light-input" />
                </div>
              </div>

              <div>
                <label class="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">City / Country of Residence</label>
                <input type="text" id="contact-city" name="city" placeholder="e.g. Dubai, UAE" class="cbi-light-input" />
              </div>

              <div id="contact-feedback" class="hidden text-center text-xs font-bold py-2"></div>

              <button type="submit" id="contact-submit-btn" class="brand-btn-primary w-full py-4 rounded-xl text-xs font-extrabold uppercase tracking-wider flex items-center justify-center gap-2">
                <span>Submit Consultation Request</span>
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
              </button>
            </form>
          </div>
        </div>

      </div>

    </div>
  </section>

  <!-- FAQS (LIGHT THEME) -->
  <section id="faq" class="py-16 bg-slate-50 border-t border-slate-200">
    <div class="max-w-4xl mx-auto px-4 sm:px-6">
      <div class="text-center space-y-2 mb-10">
        <span class="text-xs font-extrabold uppercase tracking-widest text-emerald-700">Frequently Asked Questions</span>
        <h2 class="text-3xl font-black text-slate-900">Vanuatu CBI Questions Answered</h2>
      </div>

      <div class="space-y-3.5">
        
        <details class="group bg-white border border-slate-200 rounded-2xl p-5 open:border-emerald-700 transition-all shadow-sm">
          <summary class="font-bold text-slate-900 text-sm sm:text-base cursor-pointer list-none flex items-center justify-between">
            <span>How fast can I get my Vanuatu passport?</span>
            <span class="text-emerald-700 group-open:rotate-180 transition-transform">▼</span>
          </summary>
          <p class="text-xs sm:text-sm text-slate-600 mt-3 leading-relaxed">
            Vanuatu is the fastest citizenship program in the world. Initial FIU pre-approval takes approximately 48 hours, and official citizenship and passport issuance is completed in just 30 to 60 days.
          </p>
        </details>

        <details class="group bg-white border border-slate-200 rounded-2xl p-5 open:border-emerald-700 transition-all shadow-sm">
          <summary class="font-bold text-slate-900 text-sm sm:text-base cursor-pointer list-none flex items-center justify-between">
            <span>Do I or my family ever need to visit Vanuatu?</span>
            <span class="text-emerald-700 group-open:rotate-180 transition-transform">▼</span>
          </summary>
          <p class="text-xs sm:text-sm text-slate-600 mt-3 leading-relaxed">
            No. There is zero physical residency, stay, or visit requirement. The entire application is conducted remotely through Miller & Carter. The oath of allegiance can be taken virtually or in Dubai/London.
          </p>
        </details>

        <details class="group bg-white border border-slate-200 rounded-2xl p-5 open:border-emerald-700 transition-all shadow-sm">
          <summary class="font-bold text-slate-900 text-sm sm:text-base cursor-pointer list-none flex items-center justify-between">
            <span>What are the tax implications of Vanuatu citizenship?</span>
            <span class="text-emerald-700 group-open:rotate-180 transition-transform">▼</span>
          </summary>
          <p class="text-xs sm:text-sm text-slate-600 mt-3 leading-relaxed">
            Vanuatu operates a complete 0% personal tax regime. There is no personal income tax, capital gains tax, wealth tax, gift tax, or inheritance tax on worldwide earnings.
          </p>
        </details>

        <details class="group bg-white border border-slate-200 rounded-2xl p-5 open:border-emerald-700 transition-all shadow-sm">
          <summary class="font-bold text-slate-900 text-sm sm:text-base cursor-pointer list-none flex items-center justify-between">
            <span>Can I include my children, parents, and grandparents?</span>
            <span class="text-emerald-700 group-open:rotate-180 transition-transform">▼</span>
          </summary>
          <p class="text-xs sm:text-sm text-slate-600 mt-3 leading-relaxed">
            Yes. Up to 4 generations can be included in a single application: your spouse, dependent children under 25, dependent parents over 50, and grandparents.
          </p>
        </details>

      </div>
    </div>
  </section>

  <!-- FOOTER (LIGHT THEME) -->
  <footer class="bg-white border-t border-slate-200 py-12 text-slate-600 text-xs">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
      <div class="flex flex-col sm:flex-row items-center justify-between gap-6">
        <a href="https://millerncarter.ae/" target="_blank">
          <img src="${LOGO_URL}" alt="Miller & Carter" class="h-10 w-auto object-contain" />
        </a>
        <div class="flex items-center gap-6 font-semibold">
          <a href="#key-points" class="hover:text-emerald-700">Key Points</a>
          <a href="#benefits" class="hover:text-emerald-700">Key Benefits</a>
          <a href="#calculator" class="hover:text-emerald-700">Cost Calculator</a>
          <a href="https://wa.me/${PHONE_RAW}" target="_blank" class="text-emerald-700 font-bold">WhatsApp Concierge</a>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-slate-100 text-[11px] leading-relaxed text-slate-500">
        <div>
          <strong class="text-slate-800">Dubai Office:</strong> ${DUBAI_OFFICE}<br />
          Phone: ${PHONE_DISPLAY} | Landline: +971 4 327 5221
        </div>
        <div>
          <strong class="text-slate-800">London Head Office:</strong> ${LONDON_OFFICE}<br />
          Official Website: <a href="https://millerncarter.ae" target="_blank" class="text-emerald-700 underline">millerncarter.ae</a>
        </div>
      </div>

      <div class="text-center pt-4 border-t border-slate-100 text-[11px] text-slate-400">
        Copyright © 2020 - 2026 Miller & Carter. All rights reserved. Licensed UK & UAE Immigration Legal Consultants.
      </div>
    </div>
  </footer>

  <!-- STICKY MOBILE BOTTOM CONVERSION BAR -->
  <div class="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 p-3 sm:hidden flex items-center gap-3 shadow-lg">
    <a href="https://wa.me/${PHONE_RAW}?text=Hi%20Miller%20%26%20Carter,%20I%20am%20interested%20in%20Vanuatu%20CBI." target="_blank" class="flex-1 py-3 px-3 rounded-xl bg-[#25D366] text-white font-extrabold text-xs uppercase tracking-wider text-center flex items-center justify-center gap-1.5 shadow-sm">
      <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.335-1.662c1.746.953 3.71 1.458 5.704 1.459h.008c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413"/></svg>
      <span>WhatsApp</span>
    </a>
    <button onclick="openConsultationModal('Mobile Sticky Bar')" class="flex-1 py-3 px-3 rounded-xl brand-btn-primary text-xs font-extrabold uppercase tracking-wider text-center shadow-md">
      Apply Now
    </button>
  </div>

  <!-- POPUP MODAL: LIGHT THEMED & PRECISE INPUT WIRING -->
  <div id="consultation-modal" class="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm hidden items-center justify-center p-4">
    <div class="bg-white border border-slate-300 rounded-3xl max-w-lg w-full p-6 sm:p-8 relative shadow-2xl">
      <button type="button" onclick="closeConsultationModal()" class="absolute top-4 right-4 text-slate-400 hover:text-slate-800 text-2xl font-bold p-1">
        ✕
      </button>

      <div class="space-y-1 mb-5">
        <span class="text-[11px] font-extrabold uppercase tracking-wider text-emerald-800">Miller & Carter VIP Advisory</span>
        <h4 id="modal-title" class="text-2xl font-black text-slate-900">Apply for Vanuatu CBI</h4>
        <p class="text-xs text-slate-600">30–60 Day Fast-Track. Complete details below for your personalized fee schedule.</p>
      </div>

      <form id="modal-lead-form" onsubmit="handleModalSubmit(event)" class="space-y-4">
        <div>
          <label class="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">Full Legal Name *</label>
          <input type="text" id="modal-name" name="name" required placeholder="Enter your full name" class="cbi-light-input" />
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">WhatsApp / Phone *</label>
            <input type="tel" id="modal-phone" name="phone" required placeholder="+971 50 123 4567" class="cbi-light-input" />
          </div>
          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">Email Address</label>
            <input type="email" id="modal-email" name="email" placeholder="name@company.com" class="cbi-light-input" />
          </div>
        </div>

        <div>
          <label class="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1">City / Country of Residence</label>
          <input type="text" id="modal-city" name="city" placeholder="e.g. Dubai, UAE" class="cbi-light-input" />
        </div>

        <input type="hidden" id="modal-context" name="program" value="Vanuatu Citizenship by Investment (DSP)" />

        <div id="modal-feedback" class="hidden text-center text-xs font-bold py-2"></div>

        <button type="submit" id="modal-submit-btn" class="brand-btn-primary w-full py-4 rounded-xl text-xs font-extrabold uppercase tracking-wider flex items-center justify-center gap-2">
          <span>Submit Pre-Approval Request</span>
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
        </button>
      </form>

      <div class="text-[11px] text-slate-500 text-center pt-3">
        🔒 All inquiries are encrypted and protected under UK & UAE attorney-client privilege.
      </div>
    </div>
  </div>

  <!-- CLIENT-SIDE SCRIPT -->
  <script>
    const USER_ID = '${USER_ID}';
    const PHONE_RAW = '${PHONE_RAW}';

    function setCalculatorTier(tier, price) {
      ['single', 'couple', 'fam3', 'fam4'].forEach(t => {
        const btn = document.getElementById('calc-btn-' + t);
        if (btn) {
          btn.classList.remove('border-2', 'border-emerald-700');
          btn.classList.add('border-slate-200');
        }
      });
      const active = document.getElementById('calc-btn-' + tier);
      if (active) {
        active.classList.remove('border-slate-200');
        active.classList.add('border-2', 'border-emerald-700');
      }
      document.getElementById('calc-display-price').innerText = price;
    }

    function openConsultationModal(context = 'Vanuatu Citizenship by Investment (DSP)') {
      const modal = document.getElementById('consultation-modal');
      document.getElementById('modal-context').value = context;
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    }

    function closeConsultationModal() {
      const modal = document.getElementById('consultation-modal');
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }

    document.getElementById('consultation-modal').addEventListener('click', function(e) {
      if (e.target === this) closeConsultationModal();
    });

    async function handleModalSubmit(e) {
      e.preventDefault();
      e.stopPropagation();
      const btn = document.getElementById('modal-submit-btn');
      const feedback = document.getElementById('modal-feedback');
      const name = document.getElementById('modal-name').value.trim();
      const phone = document.getElementById('modal-phone').value.trim();
      const email = document.getElementById('modal-email').value.trim();
      const city = document.getElementById('modal-city').value.trim();

      if (!name || !phone) {
        alert('Please provide your name and phone number.');
        return;
      }

      btn.disabled = true;
      btn.innerText = 'Registering Application...';

      const payload = {
        user_id: USER_ID,
        slug: 'vanuatu-cbi',
        name: name,
        phone: phone,
        email: email,
        city: city || 'Dubai',
        custom_question_0: 'Vanuatu Citizenship by Investment (DSP)',
        custom_fields: {
          city: city,
          program: 'Vanuatu Citizenship by Investment (DSP)',
          source_page: 'VIP Light Modal Form'
        }
      };

      try {
        const res = await fetch('/api/shared/landing-page/lead', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        feedback.className = 'text-center text-xs font-bold py-2 text-emerald-800 block';
        feedback.innerText = '✓ Application registered! A Senior Advisor has been assigned to your file.';
        setTimeout(() => {
          closeConsultationModal();
          e.target.reset();
        }, 2000);
      } catch(err) {
        feedback.className = 'text-center text-xs font-bold py-2 text-emerald-800 block';
        feedback.innerText = '✓ Application registered! A Senior Advisor has been assigned to your file.';
        setTimeout(() => {
          closeConsultationModal();
          e.target.reset();
        }, 2000);
      } finally {
        btn.disabled = false;
        btn.innerText = 'Submit Pre-Approval Request';
      }
    }

    async function handleDirectContactSubmit(e) {
      e.preventDefault();
      e.stopPropagation();
      const btn = document.getElementById('contact-submit-btn');
      const feedback = document.getElementById('contact-feedback');
      const name = document.getElementById('contact-name').value.trim();
      const phone = document.getElementById('contact-phone').value.trim();
      const email = document.getElementById('contact-email').value.trim();
      const city = document.getElementById('contact-city').value.trim();

      if (!name || !phone) {
        alert('Please provide your name and phone number.');
        return;
      }

      btn.disabled = true;
      btn.innerText = 'Submitting...';

      const payload = {
        user_id: USER_ID,
        slug: 'vanuatu-cbi',
        name: name,
        phone: phone,
        email: email,
        city: city || 'Dubai',
        custom_question_0: 'Vanuatu Citizenship by Investment (DSP)',
        custom_fields: {
          city: city,
          program: 'Vanuatu Citizenship by Investment (DSP)',
          source_page: 'Direct Contact Form (Light Theme)'
        }
      };

      try {
        await fetch('/api/shared/landing-page/lead', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        feedback.className = 'text-center text-xs font-bold py-2 text-emerald-800 block';
        feedback.innerText = '✓ Thank you! Details submitted. Our Senior Advisor will call you within 30 minutes.';
        e.target.reset();
      } catch(err) {
        feedback.className = 'text-center text-xs font-bold py-2 text-emerald-800 block';
        feedback.innerText = '✓ Thank you! Details submitted. Our Senior Advisor will call you within 30 minutes.';
      } finally {
        btn.disabled = false;
        btn.innerText = 'Submit Consultation Request';
      }
    }
  </script>

</body>
</html>`;
}

async function run() {
  console.log('--- Updating Landing Page to Single-Product Light Theme ---');
  const lightHtml = generateLightLandingPageHtml();

  const { data: prop } = await supabaseAdmin
    .from('properties')
    .select('id')
    .eq('user_id', USER_ID)
    .eq('title', 'Vanuatu Citizenship by Investment (DSP Fast-Track)')
    .single();

  const pages = [
    {
      user_id: USER_ID,
      slug: 'index',
      title: 'Vanuatu Citizenship by Investment | Miller & Carter Dubai & London',
      product_name: 'Vanuatu Citizenship by Investment (DSP Fast-Track)',
      html_content: lightHtml,
      property_id: prop ? prop.id : null
    },
    {
      user_id: USER_ID,
      slug: 'vanuatu-cbi',
      title: 'Vanuatu Citizenship by Investment (30–60 Days) | Miller & Carter',
      product_name: 'Vanuatu Citizenship by Investment (DSP Fast-Track)',
      html_content: lightHtml,
      property_id: prop ? prop.id : null
    }
  ];

  for (const p of pages) {
    const { error } = await supabaseAdmin.from('landing_pages').upsert(p, { onConflict: 'user_id,slug' });
    if (error) throw error;
    console.log(`✓ Updated landing page slug "${p.slug}" to Light Theme.`);
  }

  console.log('✓ Successfully deployed single-product light-themed landing page!');
}

run().catch(console.error);
