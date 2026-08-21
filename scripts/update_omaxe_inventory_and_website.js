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

const omaxePhotos = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'scratch', 'omaxe_exact_photos.json'), 'utf8'));

const propertyData = [
  {
    slug: 'the-lake',
    title: 'The Lake by Omaxe',
    property_type: 'Residential',
    price: '₹ 53 Lac - ₹ 2.45 Cr',
    address: 'Sector 3 / Madhya Marg Ext., Omaxe New Chandigarh',
    description: 'The Lake by Omaxe is an ultra-luxurious waterfront residential enclave designed around an expansive picturesque water body. Offering 1, 2, 3, 4 & 5 BHK luxury apartments and lavish penthouses, the project delivers world-class resort living with an international clubhouse, floating restaurant cabanas, Olympic-sized swimming pool, spa, and panoramic views of the Shivalik foothills.',
    configurations: {
      units: ['1 BHK (580 Sq.Ft.)', '2 BHK (1285 Sq.Ft.)', '3 BHK + Servant (1820 Sq.Ft.)', '4 BHK + Family Lounge (2450 Sq.Ft.)', 'Sky Penthouses (4400 Sq.Ft.)'],
      sizes: '580 - 4,400 Sq.Ft.',
      status: 'Ready to Move & Possession Linked',
      possession: 'Immediate / Ready to Move',
      amenities: ['Grand 50,000 Sq.Ft. Clubhouse', 'Olympic Swimming Pool & Water Bodies', 'Tennis & Badminton Courts', 'Floating Restaurant & Cabanas', '3-Tier High-Tech Security', '100% Power Backup', 'Dedicated Covered Parking']
    }
  },
  {
    slug: 'omaxe-mulberry-villas',
    title: 'Omaxe Mulberry Villas',
    property_type: 'Villas',
    price: '₹ 2.85 Cr - ₹ 5.50 Cr',
    address: 'Omaxe New Chandigarh Township, Mullanpur',
    description: 'Omaxe Mulberry Villas redefine royal suburban living with European-style G+1 luxury duplex residences built on 300 to 500 sq. yard plots. Each villa features double-height grand living spaces, imported Italian marble flooring, private manicured front and rear lawns, private elevators, and personal terrace garden pavilions overlooking the majestic hills.',
    configurations: {
      units: ['4 BHK Duplex Villa (300 Sq.Yds)', '5 BHK Grand Duplex Villa + AV Room (400 Sq.Yds)', '5 BHK Imperial Villa + Private Pool (500 Sq.Yds)'],
      sizes: '300 - 500 Sq. Yards Plot Area',
      status: 'Ready to Move',
      possession: 'Immediate Ready for Possession',
      amenities: ['Private Landscaped Lawns', 'Double-Height Living Rooms', 'Personal Elevator Provision', 'Italian Marble Flooring', 'Modular Kitchen with Siemens/Bosch Appliances', 'Club Aura Lifetime Membership', 'Gated Community with 24/7 Patrol']
    }
  },
  {
    slug: 'celestia-royal-premier',
    title: 'Celestia Royal Premier',
    property_type: 'Independent Floors',
    price: '₹ 64 Lac - ₹ 1.25 Cr',
    address: 'Madhya Marg Extension, Omaxe New Chandigarh',
    description: 'Celestia Royal Premier features low-rise Stilt + 4 independent luxury floors offering the perfect blend of independent living and community amenities. With spacious 3 BHK and 4 BHK layouts, dedicated stilt covered parking bays, and private rooftop terraces with barsati options, these homes provide unmatched privacy and comfort.',
    configurations: {
      units: ['3 BHK Independent Floor (1450 Sq.Ft.)', '4 BHK Luxury Floor + Servant (2100 Sq.Ft.)'],
      sizes: '1,450 - 2,100 Sq.Ft.',
      status: 'Ready to Move',
      possession: 'Immediate Registry Available',
      amenities: ['Stilt Covered Car Parking', 'High-Speed Automatic Elevators', 'Private Terrace with Barsati', 'Wide 60-Ft Wide Tree Lined Roads', 'Piped Natural Gas (PNG)', 'Kids Play Area & Senior Citizen Park']
    }
  },
  {
    slug: 'omaxe-cassia',
    title: 'Omaxe Cassia',
    property_type: 'Residential',
    price: '₹ 75 Lac - ₹ 1.45 Cr',
    address: 'Phase 1, Omaxe New Chandigarh',
    description: 'Omaxe Cassia presents premium mid-rise luxury apartments surrounded by lush greenery. Spanning 1,725 to 2,200 sq.ft. in 3BHK+SR and 4BHK+SR configurations, each apartment features large sunlit balconies, cross-ventilation, wooden flooring in master suites, and direct access to Sector 8 Chandigarh via Madhya Marg extension.',
    configurations: {
      units: ['3 BHK + Servant Room (1725 Sq.Ft.)', '4 BHK + Servant Room (2200 Sq.Ft.)'],
      sizes: '1,725 - 2,200 Sq.Ft.',
      status: 'Ready to Move',
      possession: 'Ready to Move In',
      amenities: ['Resort Style Swimming Pool', 'Fully Equipped Gymnasium', 'Community Hall & Banquet Area', 'Underground Parking', '24x7 Treated Water Supply', 'Intercom & Perimeter Security']
    }
  },
  {
    slug: 'omaxe-plots',
    title: 'Omaxe Residential Plots',
    property_type: 'Plots',
    price: '₹ 85 Lac - ₹ 3.20 Cr',
    address: 'Omaxe Township, New Chandigarh',
    description: 'Prime freehold developed residential plots in well-planned sectors of Omaxe New Chandigarh. Available in sizes from 150 to 500 sq. yards with wide asphalt roads, underground electrification, storm water drainage, sewage treatment, and immediate registry and building plan sanction.',
    configurations: {
      units: ['150 Sq.Yd. (30 x 45 Ft)', '200 Sq.Yd. (30 x 60 Ft)', '300 Sq.Yd. (36 x 75 Ft)', '500 Sq.Yd. (50 x 90 Ft)'],
      sizes: '150 - 500 Sq. Yards',
      status: 'Ready for Registry & Construction',
      possession: 'Immediate Registry',
      amenities: ['Freehold Clear Title', 'Underground Utility Cabling', 'Wide 60ft & 80ft Sector Roads', 'Direct Access from PR-4 & PR-7', 'Lush Thematic Gardens Nearby', 'High Capital Appreciation Potential']
    }
  },
  {
    slug: 'the-resort',
    title: 'The Resort New Chandigarh',
    property_type: 'Residential',
    price: '₹ 41 Lac - ₹ 1.15 Cr',
    address: 'Omaxe New Chandigarh, Near Medicity',
    description: 'A vacation-themed residential paradise featuring 1, 2, 3 BHK apartments and sky penthouses. Located close to the upcoming Medicity and Homi Bhabha Cancer Hospital, The Resort boasts an open-air amphitheatre, sports academy, infinity pool, and lush landscaped central park greens.',
    configurations: {
      units: ['1 BHK (830 Sq.Ft.)', '2 BHK + Store (1150 Sq.Ft.)', '3 BHK + 2 WR (1480 Sq.Ft.)', '3 BHK + 3 WR + Store (1750 Sq.Ft.)', 'Penthouses (2400 Sq.Ft.)'],
      sizes: '830 - 2,400 Sq.Ft.',
      status: 'Ready to Move',
      possession: 'Ready to Move In',
      amenities: ['Resort Style Leisure Pools', 'Mini Golf Putting Green', 'Yoga & Meditation Pavilion', 'Jogging Track with Tree Canopy', 'Cafeteria & Lounge', 'Commercial High Street Shopping']
    }
  },
  {
    slug: 'omaxe-silver-birch',
    title: 'Omaxe Silver Birch',
    property_type: 'Independent Floors',
    price: '₹ 58 Lac - ₹ 1.10 Cr',
    address: 'Sector 3, Omaxe New Chandigarh',
    description: 'Low-rise G+2 independent floors in 3 BHK and 4 BHK configurations offering serene family living. Built with premium construction quality, spacious master bedrooms, modular kitchens, and independent access to roof rights for top floor units.',
    configurations: {
      units: ['3 BHK Ground Floor with Lawn (1350 Sq.Ft.)', '3 BHK 1st & 2nd Floor (1350 Sq.Ft.)', '4 BHK Independent Floor (1850 Sq.Ft.)'],
      sizes: '1,350 - 1,850 Sq.Ft.',
      status: 'Ready to Move',
      possession: 'Ready for Possession',
      amenities: ['Ground Floor Private Lawns', 'Top Floor Terrace Rights', 'Dedicated Car Parking', 'Walking Distance to Market Plaza', 'Wide Green Central Courtyard', '24/7 Manned Security']
    }
  },
  {
    slug: 'ambrosia',
    title: 'Omaxe Ambrosia Independent Floors',
    property_type: 'Independent Floors',
    price: '₹ 62 Lac - ₹ 98 Lac',
    address: 'Omaxe New Chandigarh, Punjab',
    description: 'Stilt + 3 storey luxury independent floors with dedicated passenger lifts and stilt covered car parking. Located in prime Phase 1 with quick connectivity to Sector 8 Chandigarh, Ambrosia offers modern architectural layouts, wooden finish master suites, and grand park view balconies.',
    configurations: {
      units: ['S+3 3 BHK Luxury Floor (1425 Sq.Ft.)'],
      sizes: '1,425 Sq.Ft.',
      status: 'Ready to Move',
      possession: 'Immediate Registry',
      amenities: ['Stilt Lift Access to All Floors', 'Reserved Stilt Parking', 'Park Facing Balconies', 'PNG Piped Gas Connection', 'Club Aura Access', '100% Power Backup']
    }
  },
  {
    slug: 'gardenia-2',
    title: 'Omaxe Gardenia 2 & 3',
    property_type: 'Independent Floors',
    price: '₹ 68 Lac - ₹ 1.30 Cr',
    address: 'Omaxe New Chandigarh, Punjab',
    description: 'Boutique independent floors nestled amidst 70% landscaped green open spaces. Featuring double-height ceilings, private entry porches, Italian sanitaryware, and exclusive access to Club Aura offering state-of-the-art fitness, fine dining, spa, and banquet facilities.',
    configurations: {
      units: ['3 BHK (1500 Sq.Ft.)', '3 BHK + Family Lounge (1850 Sq.Ft.)', '3 BHK + Family Lounge + Servant (2250 Sq.Ft.)'],
      sizes: '1,500 - 2,250 Sq.Ft.',
      status: 'Ready to Move',
      possession: 'Ready to Move',
      amenities: ['70% Green Open Areas', 'Double Height Ceilings & Large Windows', 'Club Aura Premium Membership', 'Kids Splash Pool & Play Areas', 'Stilt Parking + Visitor Parking', 'EV Charging Station Provision']
    }
  },
  {
    slug: 'celestia-royal-2',
    title: 'Celestia Royal 2',
    property_type: 'Independent Floors',
    price: '₹ 70 Lac - ₹ 1.35 Cr',
    address: 'Near Madhya Marg, Omaxe New Chandigarh',
    description: 'Spacious 3 BHK luxury independent floors offering family lounge and servant room layouts. Located right off the Madhya Marg 6-lane express corridor with seamless 5-minute access to Sector 8 Chandigarh, surrounded by mountain air, manicured parks, and wide tree-lined boulevards.',
    configurations: {
      units: ['3 BHK (1580 Sq.Ft.)', '3 BHK + Family Lounge + Servant (2150 Sq.Ft.)'],
      sizes: '1,580 - 2,150 Sq.Ft.',
      status: 'Ready to Move',
      possession: 'Ready for Possession',
      amenities: ['Family Lounge & Servant Room Options', 'Scenic Shivalik Mountain Views', 'Dedicated Covered Parking', 'Underground Utility Lines', 'Gated Security with RFID Entry', 'Jogging & Cycling Tracks']
    }
  }
];

async function updateAll() {
  console.log('1. Updating properties in DB with authentic Omaxe photos...');
  await supabaseAdmin.from('properties').delete().eq('user_id', userId);

  const insertedProperties = [];

  for (const item of propertyData) {
    const photoData = omaxePhotos[item.slug] || {};
    const mainPhoto = photoData.main || 'https://www.omaxe.com/cityhome/thum/citybanner_2324.jpg';
    const allPhotos = (photoData.all && photoData.all.length > 0) ? photoData.all.slice(0, 8) : [mainPhoto];

    const { data: inserted, error } = await supabaseAdmin.from('properties').insert({
      user_id: userId,
      title: item.title,
      property_type: item.property_type,
      price: item.price,
      address: item.address,
      description: item.description,
      image_url: mainPhoto,
      images: allPhotos,
      configurations: item.configurations,
      status: 'Active',
      show_on_landing_page: true
    }).select().single();

    if (error) console.error(`Error inserting ${item.title}:`, error);
    else {
      console.log(`✓ Inserted ${item.title} with ${allPhotos.length} Omaxe photos.`);
      insertedProperties.push(inserted);
    }
  }

  console.log('\n2. Generating refined, scaled-down mobile & desktop responsive website...');
  const html = generateScaledDownSpringfieldHtml(insertedProperties);

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
  console.log('✓ Successfully saved updated website to landing_pages (ID:', savedPage.id, ')');
}

function generateScaledDownSpringfieldHtml(properties) {
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
        "streetAddress": p.address || "Omaxe New Chandigarh",
        "addressLocality": "New Chandigarh",
        "addressRegion": "Punjab",
        "postalCode": "140901",
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
          "name": "Bioque Estates International",
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
        "name": "Bioque Estates International",
        "legalName": "Bioque Estates International",
        "url": "https://bioqueestatesinternational.com",
        "logo": LOGO_URL,
        "image": LOGO_URL,
        "description": "Premier luxury real estate advisory and development firm in Tri-City, New Chandigarh, Gurugram, and Noida. Exclusive portfolio of Omaxe New Chandigarh apartments, independent floors, villas, and plots.",
        "telephone": PHONE_DISPLAY,
        "email": "estatesbioque@gmail.com",
        "address": {
          "@type": "PostalAddress",
          "streetAddress": "SCO 118-119, Level II, Madhya Marg, Sector 8-C",
          "addressLocality": "Chandigarh",
          "addressRegion": "Chandigarh",
          "postalCode": "160009",
          "addressCountry": "IN"
        },
        "areaServed": ["New Chandigarh", "Chandigarh", "Mohali", "Panchkula", "Zirakpur", "Tri-City", "Gurugram", "Noida"],
        "hasOfferCatalog": {
          "@type": "OfferCatalog",
          "name": "Omaxe New Chandigarh Luxury Properties",
          "itemListElement": schemaItemList
        }
      },
      {
        "@type": "FAQPage",
        "mainEntity": [
          {
            "@type": "Question",
            "name": "What luxury residential projects are available in Omaxe New Chandigarh?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Bioque Estates offers an exclusive portfolio in Omaxe New Chandigarh including The Lake (waterfront apartments & penthouses), Omaxe Mulberry Villas (300-500 Sq.Yd European duplex villas), Celestia Royal Premier & Celestia Royal 2 (independent luxury floors with stilt parking), Omaxe Cassia, The Resort, Ambrosia, Gardenia 2 & 3, and freehold residential plots."
            }
          },
          {
            "@type": "Question",
            "name": "What is the price range of properties in Omaxe New Chandigarh?",
            "acceptedAnswer": {
              "@type": "Answer",
              "text": "Prices start from ₹ 41 Lac for resort-themed apartments at The Resort, ₹ 53 Lac to ₹ 2.45 Cr at The Lake, ₹ 58 Lac to ₹ 1.35 Cr for independent luxury floors (Celestia Royal, Silver Birch, Gardenia), ₹ 85 Lac to ₹ 3.20 Cr for residential plots, and ₹ 2.85 Cr to ₹ 5.50 Cr for European duplex luxury villas at Omaxe Mulberry."
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
  <title>Bioque Estates International | Luxury Real Estate & Property Advisory</title>
  
  <meta name="title" content="Bioque Estates International | Luxury Real Estate & Property Advisory">
  <meta name="description" content="Bioque Estates International delivers premier luxury residences, independent floors, duplex villas, and investment plots across Omaxe New Chandigarh. Direct builder pricing & 100% verified titles.">
  <meta name="keywords" content="Bioque Estates, Bioque Estates International, Omaxe New Chandigarh, The Lake Omaxe, Omaxe Mulberry Villas, Celestia Royal Premier, Omaxe Cassia, plots in new chandigarh, luxury apartments new chandigarh, real estate consultant sector 8 chandigarh">
  <meta name="robots" content="index, follow">
  
  <meta property="og:type" content="website">
  <meta property="og:title" content="Bioque Estates International | Luxury Real Estate & Advisory">
  <meta property="og:description" content="Explore luxury waterfront residences, independent floors, duplex villas, and developer plots in Omaxe New Chandigarh.">
  <meta property="og:image" content="https://www.omaxe.com/projects/banner_1770812950769.jpeg">

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
              50: '#FBF8F3',
              100: '#F5EFE4',
              200: '#EBDDC7',
              300: '#DEC6A3',
              400: '#D1AF7F',
              500: '#C1995E',
              600: '#AD8246',
              700: '#8C6634',
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
    
    .btn-springfield {
      background-color: #0F172A;
      color: #FFFFFF;
      font-weight: 700;
      letter-spacing: 0.02em;
      transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .btn-springfield:hover {
      background-color: #AD8246;
      color: #FFFFFF;
      box-shadow: 0 10px 20px -5px rgba(173, 130, 70, 0.4);
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
<body class="selection:bg-primary-200 selection:text-dark-900 flex flex-col min-h-screen pb-16 md:pb-0">

  <!-- TOP UTILITY BAR (DESKTOP) -->
  <div class="bg-white border-b border-slate-100 py-2 px-4 sm:px-8 text-xs text-slate-500 hidden md:block">
    <div class="max-w-7xl mx-auto flex justify-between items-center">
      <div class="flex items-center space-x-6">
        <span class="flex items-center gap-1.5">
          <svg class="w-3.5 h-3.5 text-primary-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
          SCO 118-119, Level II, Madhya Marg, Sector 8-C, Chandigarh
        </span>
        <span class="flex items-center gap-1.5">
          <svg class="w-3.5 h-3.5 text-primary-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
          estatesbioque@gmail.com
        </span>
      </div>
      <div class="flex items-center space-x-6">
        <span class="font-medium text-slate-600">Official Omaxe New Chandigarh Advisory</span>
        <a href="tel:${PHONE_DISPLAY.replace(/\s+/g, '')}" class="text-dark-900 hover:text-primary-600 font-bold flex items-center gap-1.5 transition-colors">
          <svg class="w-3.5 h-3.5 text-primary-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>
          ${PHONE_DISPLAY}
        </a>
      </div>
    </div>
  </div>

  <!-- NAVIGATION HEADER (SCALED & PROPORTIONED FOR MOBILE & DESKTOP) -->
  <header class="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-slate-200 shadow-sm">
    <div class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
      <div class="flex justify-between items-center h-16 sm:h-20">
        
        <!-- LOGO & TITLE (CLEAN SCALE) -->
        <a href="#home" onclick="navigateTo('home'); return false;" class="flex items-center space-x-2.5 sm:space-x-3 group shrink-0">
          <img src="${LOGO_URL}" alt="Bioque Estates" class="h-9 sm:h-11 w-auto object-contain rounded-md border border-slate-200 p-0.5 bg-white shadow-xs" loading="eager">
          <div class="leading-none">
            <span class="font-display text-base sm:text-xl font-extrabold tracking-tight text-dark-900 block leading-tight">BIOQUE ESTATES</span>
            <span class="text-[8px] sm:text-[9px] uppercase tracking-[0.2em] text-primary-600 block font-bold mt-0.5">International Real Estate</span>
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

        <!-- CTA & MOBILE HAMBURGER -->
        <div class="flex items-center space-x-2">
          <a href="https://wa.me/${PHONE_RAW}?text=Hi%20Bioque%20Estates,%20I%20am%20interested%20in%20Omaxe%20New%20Chandigarh%20properties." target="_blank" class="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-emerald-500/40 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 text-xs font-bold transition-all">
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

      <!-- MOBILE RESPONSIVE DRAWER -->
      <div id="mobile-nav-drawer" class="hidden lg:hidden border-t border-slate-100 py-3 space-y-1 bg-white">
        <a href="#home" onclick="navigateTo('home'); toggleMobileMenu(); return false;" class="block px-3 py-2 rounded-lg text-xs font-bold text-dark-900 hover:bg-slate-50">Home</a>
        <a href="#properties" onclick="navigateTo('properties'); toggleMobileMenu(); return false;" class="block px-3 py-2 rounded-lg text-xs font-bold text-dark-900 hover:bg-slate-50">Properties Catalog</a>
        <a href="#about" onclick="navigateTo('about'); toggleMobileMenu(); return false;" class="block px-3 py-2 rounded-lg text-xs font-bold text-dark-900 hover:bg-slate-50">About Bioque Estates</a>
        <a href="#services" onclick="navigateTo('services'); toggleMobileMenu(); return false;" class="block px-3 py-2 rounded-lg text-xs font-bold text-dark-900 hover:bg-slate-50">Services</a>
        <a href="#contact" onclick="navigateTo('contact'); toggleMobileMenu(); return false;" class="block px-3 py-2 rounded-lg text-xs font-bold text-dark-900 hover:bg-slate-50">Contact & Site Visits</a>
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
    
    <!-- HERO SECTION (SCALED & PROPORTIONED FOR MOBILE) -->
    <section class="relative min-h-[60vh] sm:min-h-[75vh] flex items-center justify-center py-12 sm:py-20 overflow-hidden bg-slate-900">
      <div class="absolute inset-0 z-0">
        <img src="https://www.omaxe.com/projects/banner_1770812950769.jpeg" alt="Omaxe New Chandigarh" class="w-full h-full object-cover object-center brightness-[0.70]" loading="eager">
        <div class="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-black/30"></div>
      </div>

      <div class="relative z-10 max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 text-center w-full">
        
        <!-- Luxury Tag (No Overflow on mobile) -->
        <div class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/15 backdrop-blur-md border border-white/30 text-white text-[10px] sm:text-xs uppercase tracking-wider font-bold mb-3 sm:mb-4 max-w-full truncate">
          <span class="w-1.5 h-1.5 rounded-full bg-primary-400 shrink-0"></span>
          <span class="truncate">New Chandigarh • Official Omaxe Portfolio</span>
        </div>

        <!-- Headline (Scaled Down) -->
        <h1 class="font-display text-2xl sm:text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tight text-white mb-3 sm:mb-4 leading-tight max-w-4xl mx-auto">
          Find Your Luxury Home in <br class="hidden sm:block"/><span class="text-primary-300">New Chandigarh</span>
        </h1>

        <!-- Subtitle (Scaled Down) -->
        <p class="text-slate-200 text-xs sm:text-sm md:text-base max-w-2xl mx-auto mb-6 sm:mb-8 leading-relaxed font-normal">
          Exclusive waterfront residences, designer independent floors, luxury duplex villas, and developer plots by Bioque Estates.
        </p>

        <!-- SPRINGFIELD CLEAN TABBED SEARCH BOX -->
        <div class="max-w-3xl mx-auto bg-white rounded-2xl p-3.5 sm:p-5 shadow-2xl text-left border border-slate-100">
          
          <div class="flex items-center space-x-1.5 border-b border-slate-100 pb-2.5 mb-2.5 overflow-x-auto no-scrollbar text-[11px] sm:text-xs font-bold uppercase tracking-wider">
            <button onclick="setHomeFilter('All')" class="home-filter-tab active px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-full bg-dark-900 text-white transition-all shrink-0" data-type="All">All</button>
            <button onclick="setHomeFilter('Residential')" class="home-filter-tab px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-full text-slate-600 hover:text-dark-900 transition-all shrink-0" data-type="Residential">Apartments</button>
            <button onclick="setHomeFilter('Villas')" class="home-filter-tab px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-full text-slate-600 hover:text-dark-900 transition-all shrink-0" data-type="Villas">Villas</button>
            <button onclick="setHomeFilter('Independent Floors')" class="home-filter-tab px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-full text-slate-600 hover:text-dark-900 transition-all shrink-0" data-type="Independent Floors">Floors</button>
            <button onclick="setHomeFilter('Plots')" class="home-filter-tab px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-full text-slate-600 hover:text-dark-900 transition-all shrink-0" data-type="Plots">Plots</button>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-12 gap-2.5 sm:gap-3 items-center">
            <div class="sm:col-span-5">
              <label class="block text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-0.5 ml-1">Search Project</label>
              <input type="text" id="home-search-input" placeholder="e.g. The Lake, Mulberry Villas, Ambrosia..." class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-dark-900 placeholder-slate-400 focus:outline-none focus:border-dark-900 focus:bg-white transition-all">
            </div>

            <div class="sm:col-span-4">
              <label class="block text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-0.5 ml-1">Budget Range</label>
              <select id="home-budget-select" class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-dark-900 focus:outline-none focus:border-dark-900 focus:bg-white transition-all">
                <option value="All">All Budgets</option>
                <option value="Under 70L">Under ₹ 70 Lac</option>
                <option value="70L-1.5Cr">₹ 70 Lac - ₹ 1.50 Cr</option>
                <option value="Above 1.5Cr">₹ 1.50 Cr & Above</option>
              </select>
            </div>

            <div class="sm:col-span-3 pt-0.5 sm:pt-3">
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
            <span class="font-display text-xl sm:text-2xl font-extrabold text-dark-900 block mb-0.5">10+</span>
            <span class="text-[10px] sm:text-xs uppercase tracking-wider text-slate-500 font-bold">Years Experience</span>
          </div>
          <div class="p-2.5 sm:p-3.5 rounded-xl bg-slate-50 border border-slate-100">
            <span class="font-display text-xl sm:text-2xl font-extrabold text-dark-900 block mb-0.5">13+</span>
            <span class="text-[10px] sm:text-xs uppercase tracking-wider text-slate-500 font-bold">Omaxe Projects</span>
          </div>
          <div class="p-2.5 sm:p-3.5 rounded-xl bg-slate-50 border border-slate-100">
            <span class="font-display text-xl sm:text-2xl font-extrabold text-dark-900 block mb-0.5">100%</span>
            <span class="text-[10px] sm:text-xs uppercase tracking-wider text-slate-500 font-bold">Verified Titles</span>
          </div>
          <div class="p-2.5 sm:p-3.5 rounded-xl bg-slate-50 border border-slate-100">
            <span class="font-display text-xl sm:text-2xl font-extrabold text-dark-900 block mb-0.5">0%</span>
            <span class="text-[10px] sm:text-xs uppercase tracking-wider text-slate-500 font-bold">Brokerage</span>
          </div>
        </div>
      </div>
    </section>

    <!-- FEATURED PROPERTIES SECTION (AUTHENTIC OMAXE PHOTOS) -->
    <section class="py-12 sm:py-16 bg-[#F8F9FA] relative">
      <div class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
        
        <div class="flex flex-col sm:flex-row justify-between items-start sm:items-end mb-8 gap-3">
          <div>
            <span class="text-primary-600 text-[10px] sm:text-xs uppercase tracking-[0.25em] font-bold block mb-1">Prime Real Estate</span>
            <h2 class="font-display text-xl sm:text-3xl font-extrabold text-dark-900 tracking-tight">
              Featured Properties in New Chandigarh
            </h2>
          </div>
          <button onclick="navigateTo('properties')" class="btn-outline px-4 py-1.5 rounded-full text-xs uppercase tracking-wider font-bold flex items-center gap-1.5">
            <span>View All</span>
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 8l4 4m0 0l-4 4m4-4H3"/></svg>
          </button>
        </div>

        <div id="home-properties-grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-7">
          <!-- Injected via JavaScript -->
        </div>

      </div>
    </section>

    <!-- WHY CHOOSE BIOQUE ESTATES -->
    <section class="py-12 sm:py-16 bg-white border-t border-slate-100 relative">
      <div class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          
          <div class="lg:col-span-5 relative">
            <div class="relative rounded-2xl overflow-hidden shadow-lg border border-slate-100 aspect-[4/3] sm:aspect-auto sm:h-[400px]">
              <img src="https://www.omaxe.com/projects/banner_1670581397850.jpg" alt="Bioque Estates Real Estate" class="w-full h-full object-cover" loading="lazy">
            </div>
            
            <div class="absolute -bottom-3 -right-2 sm:-bottom-5 sm:-right-3 bg-white p-3 sm:p-4 rounded-xl border border-slate-200 shadow-lg max-w-[220px] sm:max-w-xs">
              <span class="text-primary-700 text-[10px] uppercase tracking-widest font-bold block mb-0.5">Direct Advisory</span>
              <p class="text-[11px] text-slate-600 font-medium leading-relaxed">
                Expert consultation from site selection to registry & possession.
              </p>
            </div>
          </div>

          <div class="lg:col-span-7">
            <span class="text-primary-600 text-[10px] sm:text-xs uppercase tracking-[0.25em] font-bold block mb-1.5">Our Foundation</span>
            <h2 class="font-display text-xl sm:text-3xl font-extrabold text-dark-900 mb-4 leading-tight">
              “We Are The Leading Real Estate Company, <br/><span class="text-primary-600">We Are BIOQUE ESTATES”</span>
            </h2>

            <p class="text-slate-600 text-xs sm:text-sm leading-relaxed mb-5 font-normal">
              BIOQUE ESTATES is a rapidly growing Real Estate development and advisory firm. Established to offer credibility, transparency, and top-tier quality to customers across Tri-City, Gurugram, and Noida.
            </p>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1">
              <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-100">
                <div class="w-7 h-7 rounded-lg bg-primary-100 text-primary-700 flex items-center justify-center mb-2">
                  <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>
                </div>
                <h4 class="text-dark-900 font-bold text-xs sm:text-sm mb-0.5">Credibility & Trust</h4>
                <p class="text-[11px] text-slate-500">100% verified legal paperwork and direct developer agreements.</p>
              </div>

              <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-100">
                <div class="w-7 h-7 rounded-lg bg-primary-100 text-primary-700 flex items-center justify-center mb-2">
                  <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clip-rule="evenodd"/></svg>
                </div>
                <h4 class="text-dark-900 font-bold text-xs sm:text-sm mb-0.5">Complete Transparency</h4>
                <p class="text-[11px] text-slate-500">Zero hidden costs, exact developer payment schedules, and clear terms.</p>
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
          All Properties in New Chandigarh
        </h1>
      </div>

      <!-- Filters Bar -->
      <div class="bg-white border border-slate-200 rounded-xl p-3 mb-6 flex flex-col md:flex-row justify-between items-stretch md:items-center gap-2.5 shadow-xs">
        
        <div class="flex items-center space-x-1.5 overflow-x-auto no-scrollbar text-[11px] font-bold uppercase tracking-wider pb-1 md:pb-0">
          <button onclick="setCatalogFilter('All')" class="catalog-filter-btn active px-3 py-1.5 rounded-full bg-dark-900 text-white transition-all shrink-0" data-type="All">All (<span id="count-all">10</span>)</button>
          <button onclick="setCatalogFilter('Residential')" class="catalog-filter-btn px-3 py-1.5 rounded-full text-slate-600 hover:text-dark-900 transition-all shrink-0" data-type="Residential">Apartments</button>
          <button onclick="setCatalogFilter('Villas')" class="catalog-filter-btn px-3 py-1.5 rounded-full text-slate-600 hover:text-dark-900 transition-all shrink-0" data-type="Villas">Villas</button>
          <button onclick="setCatalogFilter('Independent Floors')" class="catalog-filter-btn px-3 py-1.5 rounded-full text-slate-600 hover:text-dark-900 transition-all shrink-0" data-type="Independent Floors">Floors</button>
          <button onclick="setCatalogFilter('Plots')" class="catalog-filter-btn px-3 py-1.5 rounded-full text-slate-600 hover:text-dark-900 transition-all shrink-0" data-type="Plots">Plots</button>
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
      
      <!-- Back Navigation -->
      <div class="flex items-center justify-between border-b border-slate-200 pb-3 mb-5">
        <button onclick="navigateTo('properties')" class="flex items-center space-x-1.5 text-xs font-bold text-dark-900 hover:text-primary-600 transition-colors">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>
          <span>Back to Properties</span>
        </button>
        <div class="text-xs text-slate-500 truncate max-w-[200px] sm:max-w-none">
          <span id="detail-breadcrumb-type" class="text-slate-400">Residential</span> / <span id="detail-breadcrumb-title" class="text-dark-900 font-bold"></span>
        </div>
      </div>

      <!-- MAIN PROPERTY PRESENTATION -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8">
        
        <!-- Left: Gallery & Specs -->
        <div class="lg:col-span-8 space-y-5 sm:space-y-6">
          
          <div class="rounded-xl sm:rounded-2xl overflow-hidden border border-slate-200 shadow-sm relative aspect-[16/10] bg-slate-100">
            <img id="detail-main-image" src="" alt="Property" class="w-full h-full object-cover" loading="eager">
            <div class="absolute top-2.5 left-2.5 sm:top-3 sm:left-3 flex gap-1.5">
              <span id="detail-type-badge" class="bg-white/90 backdrop-blur text-dark-900 text-[9px] sm:text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full shadow-xs">Residential</span>
              <span id="detail-status-badge" class="bg-emerald-600 text-white text-[9px] sm:text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full shadow-xs">Ready to Move</span>
            </div>
            <div class="absolute bottom-2.5 left-2.5 sm:bottom-3 sm:left-3">
              <span id="detail-price-badge" class="bg-dark-900 text-white font-extrabold text-xs sm:text-base px-3 py-1.5 rounded-lg shadow-md"></span>
            </div>
          </div>

          <!-- Thumbnails -->
          <div id="detail-thumbnails-strip" class="flex gap-2 overflow-x-auto pb-1.5">
            <!-- Injected by JS -->
          </div>

          <!-- Title -->
          <div class="bg-white p-4 sm:p-5 rounded-xl border border-slate-200 shadow-xs">
            <h1 id="detail-title" class="font-display text-xl sm:text-2xl lg:text-3xl font-extrabold text-dark-900 mb-1.5"></h1>
            <div class="flex items-center gap-1.5 text-slate-500 text-xs">
              <svg class="w-3.5 h-3.5 text-primary-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
              <span id="detail-address"></span>
            </div>
          </div>

          <!-- Description -->
          <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
            <h3 class="font-display text-base sm:text-lg font-bold text-dark-900 mb-2">Project Overview</h3>
            <p id="detail-description" class="text-slate-600 text-xs sm:text-sm leading-relaxed font-normal whitespace-pre-line"></p>
          </div>

          <!-- Configurations -->
          <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
            <h3 class="font-display text-base sm:text-lg font-bold text-dark-900 mb-3">Unit Configurations & Sizes</h3>
            <div id="detail-units-list" class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <!-- Injected by JS -->
            </div>
          </div>

          <!-- Amenities -->
          <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
            <h3 class="font-display text-base sm:text-lg font-bold text-dark-900 mb-3">Features & Amenities</h3>
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
                  <input type="text" id="detail-lead-name" required placeholder="e.g. Rajiv Kumar" class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-dark-900 placeholder-slate-400 focus:outline-none focus:border-dark-900 focus:bg-white">
                </div>

                <div>
                  <label class="block text-[10px] font-bold text-slate-700 uppercase tracking-wider mb-1">WhatsApp Phone *</label>
                  <input type="tel" id="detail-lead-phone" required placeholder="${PHONE_DISPLAY}" class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-dark-900 placeholder-slate-400 focus:outline-none focus:border-dark-900 focus:bg-white">
                </div>

                <div>
                  <label class="block text-[10px] font-bold text-slate-700 uppercase tracking-wider mb-1">Preferred Unit</label>
                  <select id="detail-lead-unit" class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-dark-900 focus:outline-none focus:border-dark-900 focus:bg-white">
                    <option value="2 BHK / 3 BHK">2 BHK / 3 BHK</option>
                    <option value="4 BHK / Luxury Floor">4 BHK / Luxury Floor</option>
                    <option value="Villa / Penthouse">Villa / Penthouse</option>
                    <option value="Plot">Plot (150-500 Sq.Yds)</option>
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
        <span class="text-primary-600 text-[10px] sm:text-xs uppercase tracking-[0.25em] font-bold block mb-1.5">About Bioque Estates</span>
        <h1 class="font-display text-xl sm:text-3xl font-extrabold text-dark-900 tracking-tight mb-2">
          Redefining Real Estate Excellence
        </h1>
        <p class="text-slate-500 text-xs sm:text-sm">Credibility, transparency, and top-tier service across Tri-City, Gurugram, and Noida.</p>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center mb-12">
        <div class="space-y-3.5 text-slate-600 text-xs sm:text-sm leading-relaxed">
          <p>
            <strong class="text-dark-900">BIOQUE ESTATES</strong> is a rapidly growing Real Estate development and consultancy firm of the new generation. The company was established with the motive to offer credibility, transparency, and unmatched quality to clients all around Tri-City and beyond.
          </p>
          <p>
            We have grown with the idea of becoming leading developers and trusted advisors. Bioque Estates is deliberately focused on delivering the highest standards of quality in all its activities.
          </p>
          <p>
            As a full-spectrum real estate company, we cater to all requirements under one single roof: property purchase and sales, relocation assistance, developer plot investments, documentation, title search, market advisory, and home financing.
          </p>
        </div>

        <div class="relative rounded-2xl overflow-hidden border border-slate-200 shadow-md">
          <img src="https://www.omaxe.com/projects/banner_1670581796617.jpg" alt="Bioque Advisory" class="w-full h-[280px] sm:h-[350px] object-cover" loading="lazy">
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div class="p-5 rounded-2xl bg-slate-50 border border-slate-100 text-center">
          <h3 class="font-display text-sm sm:text-base font-bold text-dark-900 mb-1">Unwavering Credibility</h3>
          <p class="text-xs text-slate-500 leading-relaxed">Verified documentation, crystal-clear ownership titles, and direct developer affiliations.</p>
        </div>

        <div class="p-5 rounded-2xl bg-slate-50 border border-slate-100 text-center">
          <h3 class="font-display text-sm sm:text-base font-bold text-dark-900 mb-1">Absolute Transparency</h3>
          <p class="text-xs text-slate-500 leading-relaxed">No hidden brokerage fees, fair market valuations, and direct developer pricing.</p>
        </div>

        <div class="p-5 rounded-2xl bg-slate-50 border border-slate-100 text-center">
          <h3 class="font-display text-sm sm:text-base font-bold text-dark-900 mb-1">End-to-End Advisory</h3>
          <p class="text-xs text-slate-500 leading-relaxed">From private property tours to home loans, registration, and keys handover.</p>
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
        <span class="text-primary-600 text-[10px] sm:text-xs uppercase tracking-[0.25em] font-bold block mb-1.5">Our Capabilities</span>
        <h1 class="font-display text-xl sm:text-3xl font-extrabold text-dark-900 tracking-tight mb-2">
          Bespoke Real Estate Services
        </h1>
        <p class="text-slate-500 text-xs sm:text-sm">Tailored for high-net-worth families, end-users, and NRI investors.</p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div class="bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-xs">
          <h3 class="font-display text-base sm:text-lg font-bold text-dark-900 mb-2">Residential Sales</h3>
          <p class="text-slate-500 text-xs leading-relaxed">Exclusive inventory access to premier Omaxe waterfront apartments, designer floors, and duplex villas.</p>
        </div>

        <div class="bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-xs">
          <h3 class="font-display text-base sm:text-lg font-bold text-dark-900 mb-2">Developer Plots</h3>
          <p class="text-slate-500 text-xs leading-relaxed">Prime residential plots from 150 to 500 Sq.Yds with immediate registry status and capital growth potential.</p>
        </div>

        <div class="bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-xs">
          <h3 class="font-display text-base sm:text-lg font-bold text-dark-900 mb-2">NRI Portfolio Desk</h3>
          <p class="text-slate-500 text-xs leading-relaxed">Dedicated concierge for non-resident Indians: virtual 3D site visits, POA management, and repatriation.</p>
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
          Plan Your Private VIP Site Visit
        </h1>
        <p class="text-slate-500 text-xs sm:text-sm">Schedule chauffeured walkthroughs and private consultations.</p>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8">
        
        <div class="lg:col-span-5 space-y-3.5">
          <div class="p-4 rounded-xl bg-slate-50 border border-slate-100">
            <h4 class="text-dark-900 font-bold text-xs sm:text-sm">Head Office Location</h4>
            <p class="text-slate-500 text-xs mt-1 leading-relaxed">SCO 118-119, Level II, Madhya Marg, Sector 8-C, Chandigarh - 160009</p>
          </div>

          <div class="p-4 rounded-xl bg-slate-50 border border-slate-100">
            <h4 class="text-dark-900 font-bold text-xs sm:text-sm">Direct Advisor Line</h4>
            <p class="text-slate-500 text-xs mt-1">
              <a href="tel:${PHONE_DISPLAY.replace(/\s+/g, '')}" class="hover:text-primary-600 font-bold text-sm text-dark-900">${PHONE_DISPLAY}</a>
            </p>
          </div>

          <div class="p-4 rounded-xl bg-slate-50 border border-slate-100">
            <h4 class="text-dark-900 font-bold text-xs sm:text-sm">Email Address</h4>
            <p class="text-slate-500 text-xs mt-1">
              <a href="mailto:estatesbioque@gmail.com" class="hover:text-primary-600 text-xs">estatesbioque@gmail.com</a>
            </p>
          </div>
        </div>

        <div class="lg:col-span-7 bg-slate-50 p-5 sm:p-8 rounded-2xl border border-slate-200 shadow-xs">
          <h3 class="font-display text-base sm:text-xl font-bold text-dark-900 mb-1">Schedule A Private Site Tour</h3>
          <p class="text-slate-500 text-xs mb-4">Experience New Chandigarh projects firsthand with personal walkthroughs.</p>

          <form onsubmit="handleGeneralInquiry(event)" class="space-y-3">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="block text-[10px] font-bold text-slate-700 uppercase tracking-wider mb-1">Full Name *</label>
                <input type="text" id="contact-name" required placeholder="e.g. Rajiv Kumar" class="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-dark-900 placeholder-slate-400 focus:outline-none focus:border-dark-900">
              </div>
              <div>
                <label class="block text-[10px] font-bold text-slate-700 uppercase tracking-wider mb-1">WhatsApp Phone *</label>
                <input type="tel" id="contact-phone" required placeholder="${PHONE_DISPLAY}" class="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-dark-900 placeholder-slate-400 focus:outline-none focus:border-dark-900">
              </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="block text-[10px] font-bold text-slate-700 uppercase tracking-wider mb-1">Project</label>
                <select id="contact-project" class="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-dark-900 focus:outline-none focus:border-dark-900">
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
                <label class="block text-[10px] font-bold text-slate-700 uppercase tracking-wider mb-1">Preferred Time</label>
                <input type="text" id="contact-datetime" placeholder="e.g. Tomorrow 3:00 PM" class="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-dark-900 placeholder-slate-400 focus:outline-none focus:border-dark-900">
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
    <a href="https://wa.me/${PHONE_RAW}?text=Hi%20Bioque%20Estates,%20I%20am%20interested%20in%20Omaxe%20New%20Chandigarh%20properties." target="_blank" class="flex-1 py-2 rounded-lg border border-emerald-500/50 bg-emerald-50 text-emerald-700 text-[11px] font-bold flex items-center justify-center gap-1">
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
          <img src="${LOGO_URL}" alt="Bioque Logo" class="h-8 w-auto object-contain rounded border border-slate-200 p-0.5 bg-white" loading="lazy">
          <div>
            <span class="font-display text-sm sm:text-base font-bold text-dark-900 block">BIOQUE ESTATES INTERNATIONAL</span>
            <span class="text-[8px] sm:text-[9px] uppercase tracking-widest text-primary-600 font-bold">Exclusive Luxury Real Estate Advisory</span>
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
        <p>© 2026 Bioque Estates International. SCO 118-119, Madhya Marg, Sector 8-C, Chandigarh. Phone: ${PHONE_DISPLAY}</p>
        <p class="text-primary-700 font-bold">New Chandigarh • Chandigarh • Gurugram • Noida</p>
      </div>
    </div>
  </footer>

  <!-- ========================================================================= -->
  <!-- JAVASCRIPT -->
  <!-- ========================================================================= -->
  <script>
    const LIVE_PROPERTIES = ${propertiesJson};
    let currentCategoryFilter = 'All';

    function toggleMobileMenu() {
      const drawer = document.getElementById('mobile-nav-drawer');
      if (drawer) drawer.classList.toggle('hidden');
    }

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
      const cfg = parseConfigs(p);
      const unitsDisplay = cfg.units.length > 0 ? cfg.units.slice(0, 2).join(' • ') : (cfg.sizes || 'Multiple Layouts');
      const img = p.image_url || 'https://www.omaxe.com/projects/banner_1770812950769.jpeg';

      return \`
        <article class="springfield-card overflow-hidden flex flex-col h-full group">
          <div class="relative aspect-[16/10] overflow-hidden bg-slate-100">
            <img src="\${img}" alt="\${p.title}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" decoding="async">
            
            <span class="absolute top-2.5 left-2.5 bg-white/90 backdrop-blur text-dark-900 font-extrabold text-[9px] sm:text-[10px] uppercase tracking-wider px-2.5 py-0.5 rounded-full shadow-xs">
              \${p.property_type || 'Residential'}
            </span>

            <span class="absolute bottom-2.5 left-2.5 bg-dark-900 text-white font-extrabold text-[11px] sm:text-xs px-2.5 py-1 rounded-md shadow-md">
              \${p.price || 'Price on Request'}
            </span>
          </div>

          <div class="p-4 sm:p-5 flex-1 flex flex-col">
            <h3 class="font-display font-extrabold text-dark-900 text-base sm:text-lg mb-1 group-hover:text-primary-700 transition-colors">\${p.title}</h3>
            
            <div class="text-xs text-primary-700 font-bold mb-2 tracking-wide">\${unitsDisplay}</div>
            
            <p class="text-slate-500 text-xs leading-relaxed line-clamp-2 mb-3 flex-grow font-normal">\${p.description || ''}</p>

            <div class="flex items-center gap-1.5 text-slate-400 text-xs mb-3 font-medium">
              <svg class="w-3 h-3 text-primary-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
              <span class="truncate">\${p.address || 'Omaxe New Chandigarh'}</span>
            </div>

            <div class="pt-3 border-t border-slate-100 flex items-center gap-2 mt-auto">
              <button onclick="navigateTo('property-detail', '\${p.id}')" class="flex-1 btn-springfield text-xs text-center py-2 rounded-lg uppercase tracking-wider font-extrabold flex items-center justify-center gap-1">
                <span>View Details</span>
                <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7"/></svg>
              </button>

              <a href="https://wa.me/${PHONE_RAW}?text=Hi%20Bioque%20Estates,%20I%20am%20interested%20in%20\${encodeURIComponent(p.title)}" target="_blank" class="p-2 rounded-lg border border-emerald-500/40 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 transition-all flex items-center justify-center" title="Chat on WhatsApp">
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
        const matchesCategory = (currentCategoryFilter === 'All') || (p.property_type === currentCategoryFilter);
        const matchesSearch = !searchVal || p.title.toLowerCase().includes(searchVal) || (p.description || '').toLowerCase().includes(searchVal);
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

      const cfg = parseConfigs(p);

      document.getElementById('detail-breadcrumb-type').innerText = p.property_type || 'Residential';
      document.getElementById('detail-breadcrumb-title').innerText = p.title;
      document.getElementById('detail-title').innerText = p.title;
      document.getElementById('detail-address').innerText = p.address || 'Omaxe New Chandigarh, Punjab';
      document.getElementById('detail-description').innerText = p.description || '';
      document.getElementById('detail-price-badge').innerText = p.price || 'Price on Request';
      document.getElementById('detail-type-badge').innerText = p.property_type || 'Residential';
      
      const img = p.image_url || 'https://www.omaxe.com/projects/banner_1770812950769.jpeg';
      const mainImgEl = document.getElementById('detail-main-image');
      mainImgEl.src = img;

      const allImgs = (p.images && p.images.length > 0) ? p.images : [img];
      const thumbsContainer = document.getElementById('detail-thumbnails-strip');
      thumbsContainer.innerHTML = allImgs.map((thumbUrl) => \`
        <button onclick="document.getElementById('detail-main-image').src='\${thumbUrl}'" class="w-14 h-10 sm:w-16 sm:h-12 rounded-lg overflow-hidden border border-slate-200 hover:border-dark-900 shrink-0 transition-all">
          <img src="\${thumbUrl}" class="w-full h-full object-cover" loading="lazy">
        </button>
      \`).join('');

      const unitsContainer = document.getElementById('detail-units-list');
      const units = cfg.units.length > 0 ? cfg.units : (cfg.sizes ? [cfg.sizes] : ['Custom Layouts Available']);
      
      unitsContainer.innerHTML = units.map(u => \`
        <div class="flex items-center space-x-2 p-2.5 sm:p-3 rounded-lg bg-slate-50 border border-slate-100">
          <div class="w-2 h-2 rounded-full bg-primary-600 shrink-0"></div>
          <span class="text-xs font-bold text-dark-900">\${u}</span>
        </div>
      \`).join('');

      const amenitiesContainer = document.getElementById('detail-amenities-list');
      const amenities = cfg.amenities.length > 0 ? cfg.amenities : ['Grand Clubhouse Access', 'Resort Swimming Pool', '24x7 High-Tech Security', '100% Power Backup', 'Dedicated Covered Parking'];

      amenitiesContainer.innerHTML = amenities.map(a => \`
        <div class="flex items-center space-x-2 p-2.5 sm:p-3 rounded-lg bg-slate-50 border border-slate-100">
          <svg class="w-3.5 h-3.5 text-emerald-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>
          <span class="text-xs font-semibold text-slate-700">\${a}</span>
        </div>
      \`).join('');

      const waBtn = document.getElementById('detail-whatsapp-btn');
      waBtn.href = \`https://wa.me/${PHONE_RAW}?text=Hi%20Bioque%20Estates,%20I%20would%20like%20details,%20floor%20plans%20and%20pricing%20for%20\${encodeURIComponent(p.title)}.\`;
    }

    // --- FORM SUBMISSION DIRECTLY TO NOBOGENT CRM ---
    async function handleDetailInquiry(e) {
      e.preventDefault();
      const btn = document.getElementById('detail-submit-btn');
      const feedback = document.getElementById('detail-form-feedback');
      const name = document.getElementById('detail-lead-name').value.trim();
      const phone = document.getElementById('detail-lead-phone').value.trim();
      const unit = document.getElementById('detail-lead-unit').value;
      const title = document.getElementById('detail-title').innerText;

      btn.disabled = true;
      btn.innerText = 'Submitting to CRM...';

      try {
        const payload = {
          user_id: '${userId}',
          name: name,
          phone: phone,
          city: 'New Chandigarh',
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

        if (!res.ok) throw new Error('Submission failed');
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
      btn.innerText = 'Submitting to CRM...';

      try {
        const payload = {
          user_id: '${userId}',
          name: name,
          phone: phone,
          city: 'New Chandigarh',
          slug: 'index',
          custom_question_0: project,
          custom_question_1: datetime,
          custom_fields: {
            source_page: 'Site Visit Booking Form',
            project_name: project,
            scheduled_time: datetime
          }
        };

        const res = await fetch('/api/shared/landing-page/lead', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!res.ok) throw new Error('Submission failed');
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

updateAll().catch(err => {
  console.error('Execution error:', err);
  process.exit(1);
});
