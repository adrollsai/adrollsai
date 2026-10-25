const { createClient } = require('@supabase/supabase-js');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const endpoint = (process.env.R2_ENDPOINT || '').replace(/\/adrolls-storage\/?$/, '');
const r2 = new S3Client({
  region: 'auto',
  endpoint,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const R2_BUCKET = process.env.R2_BUCKET_NAME;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;

const EMAIL = 'Info@rajinfrastructure.com';
const PASSWORD = 'RajAbhijna@2026!';
const BUSINESS_NAME = 'RAJ ABHIJNA PROPERTY DEVELOPERS PVT LTD';
const ADDRESS = '2786, 9th Cross, Adipampa road, V V Mohalla, Mysuru (Mysore), Karnataka, 570020';

async function uploadFileToR2(localPath, r2Key, contentType = 'image/jpeg') {
  const fileBuffer = fs.readFileSync(localPath);
  await r2.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: r2Key,
      Body: fileBuffer,
      ContentType: contentType,
    })
  );
  return `${R2_PUBLIC_URL}/${r2Key}`;
}

async function run() {
  console.log('--- 1. Setting up Auth user for', EMAIL);
  let userId = null;
  const { data: { users }, error: listErr } = await supabaseAdmin.auth.admin.listUsers();
  if (listErr) throw listErr;

  const existing = users.find(u => u.email?.toLowerCase() === EMAIL.toLowerCase());
  if (existing) {
    userId = existing.id;
    await supabaseAdmin.auth.admin.updateUserById(userId, {
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { role: 'client' }
    });
    console.log('✓ Updated existing auth user:', userId);
  } else {
    const { data: newUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: EMAIL,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { role: 'client' }
    });
    if (createErr) throw createErr;
    userId = newUser.user.id;
    console.log('✓ Created new auth user:', userId);
  }

  console.log('--- 2. Uploading downloaded amrita vana.jpeg to R2...');
  const downloadImagePath = path.join(process.env.USERPROFILE, 'Downloads', 'amrita vana.jpeg');
  const r2Key = `properties/${userId}/amrita-vana.jpeg`;
  const amritaImageUrl = await uploadFileToR2(downloadImagePath, r2Key, 'image/jpeg');
  console.log('✓ Amritha Vana Image uploaded:', amritaImageUrl);

  console.log('--- 3. Updating Profile with Business Details...');
  const profilePayload = {
    id: userId,
    email: EMAIL,
    business_name: BUSINESS_NAME,
    address: ADDRESS,
    role: 'admin',
    agency_id: null,
    parent_id: null,
    credits: 4000,
    subscription_plan: 'enterprise',
    subscription_status: 'active',
    subscription_valid_until: '2099-12-31T23:59:59+00:00',
    onboarding_completed: true,
    accepted_terms: true,
    currency: 'INR',
    brand_color: '#15803d',
    logo_url: amritaImageUrl,
    mission_statement: 'RAJ ABHIJNA PROPERTY DEVELOPERS PVT LTD presents Amritha Vana – Luxury Nature Living, Geodesic Dome Farm Estates & Resort Time-Share Models off Mysore-Madikeri Road.',
    business_landing_enabled: true,
    business_landing_hero_title: 'Amritha Vana – Own Your Farm. Experience Nature.',
    business_landing_hero_subtitle: 'Exclusive 40-Acre Nature Living & Luxury Geodesic Dome Farm Retreats Off Mysore - Madikeri Road',
    business_landing_show_products: true,
    client_features: ['analytics', 'inventory', 'creation', 'ads', 'crm', 'whatsapp', 'voice_agent', 'flows']
  };

  const { error: profileErr } = await supabaseAdmin.from('profiles').upsert(profilePayload);
  if (profileErr) throw profileErr;
  console.log('✓ Profile saved for:', BUSINESS_NAME);

  console.log('--- 4. Adding 2 Products to Catalogue...');
  await supabaseAdmin.from('properties').delete().eq('user_id', userId);

  const product1Desc = `AMRITHA VANA – FARM PROJECT\n\nLand Cost: ₹833 per sq. ft.\n\n1. Minimum Plot Size:\n    60 ft × 100 ft = 6,000 sq. ft.\n    Plot dimensions may vary depending on land availability.\n\n2. First 20 Sites – Special Launch Offer:\n    6,000 sq. ft. Farm Plot + Dome\n    Package Price: 50 lakhs\n\n3. After the First 20 Sites:\n    6,000 sq. ft. Farm Plot: ₹50 Lakhs\n    Dome: ₹7 Lakhs\n    Total Package Price: ₹57 Lakhs\n\nAmritha Vana – Own Your Farm. Experience Nature.\n\nLocation:\nhttps://maps.app.goo.gl/WbcQVGnhz2Bfsrwg6?g_st=iw\n\nProject is on Mysore Madikeri Road, 25 kms from Mysore Palace. Near KR Nagara Madikeri road junction, behind Coffee Day.\nTotal extent of project is 40 Acres in phase 1.\n\nProject Includes:\n• Residential farm plots with dome\n• 20 fruit trees\n• Kitchen garden\n• Gazebo\n• Fire place with seating\n• Fountain\n• Walk way`;

  const product2Desc = `Project Concept – Land + Villa + Resort Time-Share Model\n\nWe are offering a premium large land parcel of min 6000 sqft along with mushroom dome, 20 fruit trees, kitchen garden, fountain, fire place and seating, picketed fence and clear greenery partition for property with a base price of ₹50 Lakhs in a well-planned, nature-centric development.\n\nOptional:\n• Swimming pool\n• Interiors inside mushroom dome\n\nOptional Villa Construction:\n• Buyers have an option to construct a 600sq.ft premium villa @ 6000 sqft land\n• Approximate construction cost: ₹40 Lakhs\n• Villa design, quality, and specifications will be finalized jointly to ensure premium standards suitable for resort operations\n\n(Villa construction is optional. Buyers may choose only land ownership as well.)\n\n⸻\n\nResort & Time-Share Model\n\nOnce the villa is constructed, the property will be integrated into a professionally managed resort model on a time-share basis.\n\nUsage Rights for Land Owner:\n• The land/villa owner is entitled to 7 days of complimentary stay every year\n• The stay can be used personally or for family use, subject to prior booking\n\nResort Operations:\n• Remaining days in the year will be utilized for resort bookings (short stays, holidays, retreats, events, etc.)\n• The resort will be managed, marketed, and operated by the developer / operator\n• All bookings, maintenance, housekeeping, and guest management will be handled professionally\n\n⸻\n\nRevenue & Profit Sharing:\n• Income generated from resort bookings will be pooled\n• Net profits (after operational expenses) will be shared between:\n  - Land/Villa Owner\n  - Resort Operator / Developer\n• Profit-sharing ratio and settlement cycle (monthly / quarterly / annually) will be clearly defined in the agreement\n\n⸻\n\nKey Benefits to the Buyer:\n• Ownership of large premium land parcel\n• Optional villa with asset appreciation\n• Guaranteed personal usage every year\n• Passive income opportunity without day-to-day involvement\n• Hassle-free maintenance and operations\n• Ideal for second home, holiday home, or long-term investment\n\n⸻\n\nTransparency & Legal Structure:\n• Separate agreements will be executed for:\n  - Land sale\n  - Villa construction (if opted)\n  - Resort management & profit sharing\n• Complete clarity on usage rights, revenue sharing, maintenance responsibilities, exit clauses and ownership rights.`;

  const productsToInsert = [
    {
      user_id: userId,
      title: 'AMRITHA VANA – FARM PROJECT (6,000 Sq.Ft Plot + Dome)',
      price: '₹ 50 Lakhs (Launch Offer)',
      address: 'Mysore - Madikeri Road, 25 kms from Mysore Palace (Near KR Nagara Junction, Behind Coffee Day)',
      property_type: 'Farm Plot',
      status: 'Active',
      image_url: amritaImageUrl,
      images: [amritaImageUrl],
      description: product1Desc,
      configurations: JSON.stringify({
        plot_size: '60 ft × 100 ft = 6,000 sq. ft.',
        land_rate: '₹833 per sq. ft.',
        launch_offer: 'First 20 Sites: 6,000 sq.ft Plot + Dome @ ₹50 Lakhs',
        regular_pricing: 'Plot: ₹50 Lakhs + Dome: ₹7 Lakhs = ₹57 Lakhs',
        total_extent: '40 Acres in Phase 1',
        location: 'Mysore-Madikeri Road (25 km from Mysore Palace)',
        amenities: [
          'Residential Farm Plots with Dome',
          '20 Fruit Trees',
          'Kitchen Garden',
          'Gazebo',
          'Fire Place with Seating',
          'Fountain',
          'Walk Way'
        ],
        google_maps_url: 'https://maps.app.goo.gl/WbcQVGnhz2Bfsrwg6?g_st=iw'
      }),
      show_on_landing_page: true
    },
    {
      user_id: userId,
      title: 'Project Concept – Land + Villa + Resort Time-Share Model',
      price: '₹ 50 Lakhs (Land & Dome) + ₹ 40 Lakhs (Optional Villa)',
      address: 'Amritha Vana, Mysore - Madikeri Road, Karnataka',
      property_type: 'Resort Time-Share Farm',
      status: 'Active',
      image_url: amritaImageUrl,
      images: [amritaImageUrl],
      description: product2Desc,
      configurations: JSON.stringify({
        base_parcel: 'Min 6,000 sq.ft with Mushroom Dome @ ₹50 Lakhs',
        optional_villa: '600 sq.ft Premium Villa (~₹40 Lakhs)',
        resort_model: 'Professionally Managed Resort Time-Share',
        complimentary_stay: '7 Days complimentary stay every year for Owner',
        revenue_sharing: 'Pooled net rental revenue shared between Owner & Operator',
        included_amenities: [
          'Mushroom Dome',
          '20 Fruit Trees',
          'Kitchen Garden',
          'Fountain',
          'Fire Place and Seating',
          'Picketed Fence & Greenery Partition'
        ],
        optional_amenities: [
          'Swimming Pool',
          'Interiors Inside Mushroom Dome',
          '600 sq.ft Premium Villa Construction'
        ]
      }),
      show_on_landing_page: true
    }
  ];

  const { data: insertedProducts, error: prodErr } = await supabaseAdmin
    .from('properties')
    .insert(productsToInsert)
    .select();

  if (prodErr) throw prodErr;
  console.log(`✓ Inserted ${insertedProducts.length} products into catalogue.`);

  // 5. Generate and Publish the Landing Page for Amritha Vana
  console.log('--- 5. Generating and Publishing Landing Page for Amritha Vana...');
  const { generateFullHtml } = require('./update_amritha_vana_website');
  const landingHtml = generateFullHtml();


  const pages = [
    {
      user_id: userId,
      slug: 'index',
      title: 'Amritha Vana – Luxury Farm Plots & Geodesic Domes | Mysore-Madikeri Road',
      product_name: 'AMRITHA VANA – FARM PROJECT',
      html_content: landingHtml,
      property_id: insertedProducts[0].id
    },
    {
      user_id: userId,
      slug: 'amritavana',
      title: 'Amritha Vana – Own Your Farm. Experience Nature.',
      product_name: 'AMRITHA VANA – FARM PROJECT',
      html_content: landingHtml,
      property_id: insertedProducts[0].id
    }
  ];

  for (const page of pages) {
    const { error: pageErr } = await supabaseAdmin
      .from('landing_pages')
      .upsert(page, { onConflict: 'user_id,slug' });
    if (pageErr) throw pageErr;
    console.log(`✓ Published landing page for slug: "${page.slug}"`);
  }

  console.log('\n======================================================');
  console.log('🎉 RAJ ABHIJNA ACCOUNT SETUP COMPLETE');
  console.log('======================================================');
  console.log('Email:        ', EMAIL);
  console.log('Password:     ', PASSWORD);
  console.log('User ID:      ', userId);
  console.log('Business:     ', BUSINESS_NAME);
  console.log('Address:      ', ADDRESS);
  console.log('Products:     ', insertedProducts.length, 'added to Catalogue');
  console.log('Image URL:    ', amritaImageUrl);
  console.log('Landing Pages: /shared/' + userId + ' and /shared/' + userId + '/amritavana');
  console.log('======================================================');
}

function generateAmrithaVanaLandingHtml({ userId, imageUrl, businessName, address, product }) {
  return `<!DOCTYPE html>
<html lang="en" class="scroll-smooth">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0">
  <title>Amritha Vana – Farm Project | Own Your Farm. Experience Nature.</title>
  <meta name="description" content="Amritha Vana by Raj Abhijna Property Developers: 6,000 sq.ft residential farm plots with luxury geodesic dome, 20 fruit trees, gazebo & fire place. Special launch package ₹50 Lakhs on Mysore-Madikeri Road.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600;700;800;900&family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          fontFamily: {
            serif: ['Cinzel', 'Georgia', 'serif'],
            sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
          },
          colors: {
            forest: {
              50: '#f0fdf4',
              100: '#dcfce7',
              600: '#16a34a',
              700: '#15803d',
              800: '#166534',
              900: '#14532d',
              950: '#052e16',
            },
            gold: {
              300: '#fde047',
              400: '#facc15',
              500: '#eab308',
              600: '#ca8a04',
            }
          }
        }
      }
    }
  </script>
  <style>
    body { font-family: 'Plus Jakarta Sans', system-ui, sans-serif; }
    .serif-title { font-family: 'Cinzel', Georgia, serif; }
    .glass-card {
      background: rgba(255, 255, 255, 0.92);
      backdrop-filter: blur(16px);
      border: 1px solid rgba(22, 101, 52, 0.12);
    }
    .hero-gradient {
      background: linear-gradient(180deg, rgba(5,46,22,0.85) 0%, rgba(5,46,22,0.95) 100%);
    }
  </style>
</head>
<body class="bg-stone-50 text-slate-800 antialiased selection:bg-forest-700 selection:text-white">

  <!-- TOP ANNOUNCEMENT BAR -->
  <div class="bg-forest-950 text-amber-300 text-xs sm:text-sm font-semibold tracking-wider uppercase py-2.5 px-4 text-center border-b border-forest-800 flex items-center justify-center gap-2">
    <span class="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
    <span>Special Launch Offer: First 20 Sites – 6,000 Sq.Ft Farm Plot + Dome at ₹50 Lakhs</span>
  </div>

  <!-- NAVIGATION -->
  <nav class="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-stone-200">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="w-11 h-11 rounded-xl bg-forest-900 text-amber-400 flex items-center justify-center font-bold text-xl shadow-md border border-forest-800">
          AV
        </div>
        <div>
          <div class="serif-title font-bold text-lg sm:text-xl tracking-tight text-forest-950">AMRITHA VANA</div>
          <div class="text-[10px] sm:text-xs tracking-widest uppercase text-stone-500 font-medium">Raj Abhijna Property Developers</div>
        </div>
      </div>
      <div class="flex items-center gap-3">
        <a href="#enquiry-section" class="bg-forest-700 hover:bg-forest-800 text-white font-bold text-xs sm:text-sm uppercase tracking-wider px-5 py-2.5 rounded-full shadow-lg hover:shadow-xl transition-all duration-200 flex items-center gap-2">
          <span>Book Site Visit</span>
          <span>→</span>
        </a>
      </div>
    </div>
  </nav>

  <!-- HERO SECTION -->
  <section class="relative bg-forest-950 text-white overflow-hidden py-16 sm:py-24">
    <div class="absolute inset-0 opacity-20 bg-[radial-gradient(#22c55e_1px,transparent_1px)] [background-size:24px_24px]"></div>
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
        
        <div class="lg:col-span-7 space-y-6">
          <div class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-forest-900/80 border border-forest-700/60 text-emerald-300 text-xs font-bold uppercase tracking-widest">
            <span>🌿</span> 40-Acre Nature Sanctuary • Mysore - Madikeri Road
          </div>
          
          <h1 class="serif-title text-3xl sm:text-5xl lg:text-6xl font-bold leading-tight tracking-tight text-white">
            Own Your Farm.<br>
            <span class="text-amber-400">Experience Nature.</span>
          </h1>
          
          <p class="text-stone-300 text-base sm:text-lg leading-relaxed max-w-2xl">
            Escape the city chaos into an exclusive sanctuary nestled 25 kms from Mysore Palace. 
            Private 6,000 sq.ft farm plots complete with luxury geodesic dome living, 20 flourishing fruit trees, kitchen garden, stone fire pit, and gazebo.
          </p>

          <!-- KEY STATS -->
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-4 pt-4 border-t border-forest-800/80">
            <div class="p-3.5 rounded-2xl bg-forest-900/50 border border-forest-800">
              <div class="text-2xl sm:text-3xl font-extrabold text-amber-400">₹833</div>
              <div class="text-xs text-stone-400 uppercase font-semibold mt-1">Per Sq. Ft. Land Cost</div>
            </div>
            <div class="p-3.5 rounded-2xl bg-forest-900/50 border border-forest-800">
              <div class="text-2xl sm:text-3xl font-extrabold text-white">6,000 <span class="text-sm font-normal text-stone-400">Sq.Ft</span></div>
              <div class="text-xs text-stone-400 uppercase font-semibold mt-1">Min Plot Size (60x100)</div>
            </div>
            <div class="col-span-2 sm:col-span-1 p-3.5 rounded-2xl bg-forest-900/50 border border-forest-800">
              <div class="text-2xl sm:text-3xl font-extrabold text-emerald-400">₹50 L</div>
              <div class="text-xs text-stone-400 uppercase font-semibold mt-1">Launch Package (Plot + Dome)</div>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-4 pt-2">
            <a href="#enquiry-section" class="bg-amber-400 hover:bg-amber-300 text-forest-950 font-extrabold text-sm sm:text-base uppercase tracking-wider px-8 py-4 rounded-xl shadow-xl hover:shadow-2xl transition-all duration-200">
              Claim Launch Offer (First 20 Sites)
            </a>
            <a href="https://maps.app.goo.gl/WbcQVGnhz2Bfsrwg6?g_st=iw" target="_blank" rel="noopener noreferrer" class="bg-forest-900 hover:bg-forest-800 text-stone-200 border border-forest-700 font-bold text-sm sm:text-base px-6 py-4 rounded-xl transition-all flex items-center gap-2">
              <span>📍 View on Google Maps</span>
            </a>
          </div>
        </div>

        <!-- HERO POSTER IMAGE DISPLAY -->
        <div class="lg:col-span-5">
          <div class="relative rounded-3xl overflow-hidden shadow-2xl border-4 border-forest-800/60 bg-forest-900 group">
            <img 
              src="${imageUrl}" 
              alt="Amritha Vana Farm Living Luxury Geodesic Dome" 
              class="w-full h-auto object-cover group-hover:scale-105 transition-transform duration-500"
            />
            <div class="absolute bottom-0 inset-x-0 p-4 bg-gradient-to-t from-black/80 via-black/40 to-transparent text-white text-xs">
              <p class="font-bold text-amber-300">Official Project Brochure & Concept Poster</p>
              <p class="text-stone-300">Amritha Vana Farms – Off Mysore - Bilikere - Coorg Road</p>
            </div>
          </div>
        </div>

      </div>
    </div>
  </section>

  <!-- SPECIAL LAUNCH PRICING SECTION -->
  <section class="py-16 sm:py-24 bg-stone-100">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      
      <div class="text-center max-w-3xl mx-auto mb-16">
        <span class="text-forest-700 text-xs sm:text-sm font-extrabold uppercase tracking-widest">Transparent Pricing</span>
        <h2 class="serif-title text-3xl sm:text-4xl font-bold text-stone-900 mt-2">Special Launch Offer vs Regular Pricing</h2>
        <p class="text-stone-600 mt-3 text-base">Clear, fixed investment structure with substantial launch savings for early patrons.</p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-5xl mx-auto">
        
        <!-- CARD 1: LAUNCH OFFER (HIGHLIGHTED) -->
        <div class="relative bg-white rounded-3xl p-8 sm:p-10 shadow-xl border-2 border-forest-600 flex flex-col justify-between">
          <div class="absolute -top-4 right-8 bg-forest-700 text-amber-300 font-extrabold text-xs uppercase tracking-widest px-4 py-1.5 rounded-full shadow-md">
            🔥 Special Launch Offer
          </div>
          <div>
            <div class="text-xs uppercase font-extrabold tracking-widest text-forest-700">First 20 Sites Only</div>
            <h3 class="serif-title text-2xl sm:text-3xl font-bold text-slate-900 mt-2">6,000 Sq.Ft Plot + Luxury Dome</h3>
            <div class="mt-6 flex items-baseline gap-2">
              <span class="text-4xl sm:text-5xl font-black text-forest-900">₹ 50 Lakhs</span>
              <span class="text-sm font-bold text-stone-500 uppercase">All-Inclusive Package</span>
            </div>
            <p class="text-stone-600 text-sm mt-3 leading-relaxed">
              Complete ready-to-enjoy farm package including minimum 6,000 sq.ft gated plot and fully erected luxury geodesic dome tent.
            </p>

            <ul class="mt-8 space-y-3.5 text-sm text-stone-700">
              <li class="flex items-center gap-3">
                <span class="w-5 h-5 rounded-full bg-forest-100 text-forest-700 flex items-center justify-center font-bold text-xs">✓</span>
                <span><strong>6,000 sq. ft.</strong> Farm Plot (60 ft × 100 ft)</span>
              </li>
              <li class="flex items-center gap-3">
                <span class="w-5 h-5 rounded-full bg-forest-100 text-forest-700 flex items-center justify-center font-bold text-xs">✓</span>
                <span><strong>Luxury Geodesic Dome</strong> (Included complimentary)</span>
              </li>
              <li class="flex items-center gap-3">
                <span class="w-5 h-5 rounded-full bg-forest-100 text-forest-700 flex items-center justify-center font-bold text-xs">✓</span>
                <span><strong>20 Fruit Trees</strong> planted & nurtured</span>
              </li>
              <li class="flex items-center gap-3">
                <span class="w-5 h-5 rounded-full bg-forest-100 text-forest-700 flex items-center justify-center font-bold text-xs">✓</span>
                <span><strong>Private Kitchen Garden</strong> + Gazebo + Fire Place</span>
              </li>
              <li class="flex items-center gap-3">
                <span class="w-5 h-5 rounded-full bg-forest-100 text-forest-700 flex items-center justify-center font-bold text-xs">✓</span>
                <span><strong>Save ₹7,00,000</strong> over standard package price</span>
              </li>
            </ul>
          </div>

          <div class="mt-10">
            <a href="#enquiry-section" class="block w-full text-center bg-forest-700 hover:bg-forest-800 text-white font-extrabold uppercase text-sm tracking-wider py-4 rounded-xl shadow-md transition-all">
              Claim Launch Pricing Now
            </a>
          </div>
        </div>

        <!-- CARD 2: STANDARD PRICING -->
        <div class="bg-white rounded-3xl p-8 sm:p-10 shadow-md border border-stone-200 flex flex-col justify-between">
          <div>
            <div class="text-xs uppercase font-extrabold tracking-widest text-stone-500">Regular Pricing</div>
            <h3 class="serif-title text-2xl sm:text-3xl font-bold text-slate-900 mt-2">After First 20 Sites</h3>
            <div class="mt-6 flex items-baseline gap-2">
              <span class="text-4xl sm:text-5xl font-black text-slate-900">₹ 57 Lakhs</span>
              <span class="text-sm font-bold text-stone-500 uppercase">Total Package</span>
            </div>
            <p class="text-stone-600 text-sm mt-3 leading-relaxed">
              Standard price breakdown following conclusion of the first 20 pioneer site allocations.
            </p>

            <ul class="mt-8 space-y-3.5 text-sm text-stone-700">
              <li class="flex items-center gap-3">
                <span class="w-5 h-5 rounded-full bg-stone-200 text-stone-700 flex items-center justify-center font-bold text-xs">•</span>
                <span>6,000 sq. ft. Farm Plot: <strong>₹50 Lakhs</strong></span>
              </li>
              <li class="flex items-center gap-3">
                <span class="w-5 h-5 rounded-full bg-stone-200 text-stone-700 flex items-center justify-center font-bold text-xs">•</span>
                <span>Luxury Geodesic Dome: <strong>₹7 Lakhs</strong></span>
              </li>
              <li class="flex items-center gap-3">
                <span class="w-5 h-5 rounded-full bg-stone-200 text-stone-700 flex items-center justify-center font-bold text-xs">•</span>
                <span>Land Rate: <strong>₹833 per sq. ft.</strong></span>
              </li>
              <li class="flex items-center gap-3">
                <span class="w-5 h-5 rounded-full bg-stone-200 text-stone-700 flex items-center justify-center font-bold text-xs">•</span>
                <span>Full Farm Estate Amenities Included</span>
              </li>
            </ul>
          </div>

          <div class="mt-10">
            <a href="#enquiry-section" class="block w-full text-center bg-stone-900 hover:bg-stone-800 text-white font-extrabold uppercase text-sm tracking-wider py-4 rounded-xl shadow transition-all">
              Request Price Sheet
            </a>
          </div>
        </div>

      </div>

    </div>
  </section>

  <!-- AMENITIES & FEATURES -->
  <section class="py-16 sm:py-24 bg-white">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="text-center max-w-3xl mx-auto mb-16">
        <span class="text-forest-700 text-xs sm:text-sm font-extrabold uppercase tracking-widest">Master-Planned Living</span>
        <h2 class="serif-title text-3xl sm:text-4xl font-bold text-stone-900 mt-2">What Every Farm Plot Includes</h2>
        <p class="text-stone-600 mt-3 text-base">Thoughtfully engineered farm lifestyle with self-sustaining nature infrastructure.</p>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        
        <div class="p-6 rounded-2xl bg-stone-50 border border-stone-200/80 hover:border-forest-600 transition-all hover:shadow-lg">
          <div class="w-12 h-12 rounded-xl bg-forest-100 text-forest-700 flex items-center justify-center text-2xl font-bold mb-4">⛺</div>
          <h4 class="font-bold text-lg text-stone-900">Luxury Geodesic Dome</h4>
          <p class="text-stone-600 text-xs sm:text-sm mt-2 leading-relaxed">Weather-resistant, insulated dome tent with panoramic view window for modern glamping comfort.</p>
        </div>

        <div class="p-6 rounded-2xl bg-stone-50 border border-stone-200/80 hover:border-forest-600 transition-all hover:shadow-lg">
          <div class="w-12 h-12 rounded-xl bg-forest-100 text-forest-700 flex items-center justify-center text-2xl font-bold mb-4">🌳</div>
          <h4 class="font-bold text-lg text-stone-900">20 Fruit-Bearing Trees</h4>
          <p class="text-stone-600 text-xs sm:text-sm mt-2 leading-relaxed">Curated native horticulture including mango, chikoo, guava, and citrus trees planted on your plot.</p>
        </div>

        <div class="p-6 rounded-2xl bg-stone-50 border border-stone-200/80 hover:border-forest-600 transition-all hover:shadow-lg">
          <div class="w-12 h-12 rounded-xl bg-forest-100 text-forest-700 flex items-center justify-center text-2xl font-bold mb-4">🥬</div>
          <h4 class="font-bold text-lg text-stone-900">Organic Kitchen Garden</h4>
          <p class="text-stone-600 text-xs sm:text-sm mt-2 leading-relaxed">Dedicated fertile patch prepared for your own fresh organic seasonal vegetables, herbs, and greens.</p>
        </div>

        <div class="p-6 rounded-2xl bg-stone-50 border border-stone-200/80 hover:border-forest-600 transition-all hover:shadow-lg">
          <div class="w-12 h-12 rounded-xl bg-forest-100 text-forest-700 flex items-center justify-center text-2xl font-bold mb-4">🔥</div>
          <h4 class="font-bold text-lg text-stone-900">Fire Place with Seating</h4>
          <p class="text-stone-600 text-xs sm:text-sm mt-2 leading-relaxed">Rustic outdoor stone fire pit and built-in circular seating for star-gazing and cozy family evenings.</p>
        </div>

        <div class="p-6 rounded-2xl bg-stone-50 border border-stone-200/80 hover:border-forest-600 transition-all hover:shadow-lg">
          <div class="w-12 h-12 rounded-xl bg-forest-100 text-forest-700 flex items-center justify-center text-2xl font-bold mb-4">🏡</div>
          <h4 class="font-bold text-lg text-stone-900">Outdoor Gazebo</h4>
          <p class="text-stone-600 text-xs sm:text-sm mt-2 leading-relaxed">Covered wooden deck pavilion ideal for afternoon reading, open-air dining, and relaxing in nature.</p>
        </div>

        <div class="p-6 rounded-2xl bg-stone-50 border border-stone-200/80 hover:border-forest-600 transition-all hover:shadow-lg">
          <div class="w-12 h-12 rounded-xl bg-forest-100 text-forest-700 flex items-center justify-center text-2xl font-bold mb-4">⛲</div>
          <h4 class="font-bold text-lg text-stone-900">Water Fountain</h4>
          <p class="text-stone-600 text-xs sm:text-sm mt-2 leading-relaxed">Soothing landscaped water feature creating a calm, meditative ambiance throughout the farm.</p>
        </div>

        <div class="p-6 rounded-2xl bg-stone-50 border border-stone-200/80 hover:border-forest-600 transition-all hover:shadow-lg">
          <div class="w-12 h-12 rounded-xl bg-forest-100 text-forest-700 flex items-center justify-center text-2xl font-bold mb-4">🚶</div>
          <h4 class="font-bold text-lg text-stone-900">Paved Nature Walkway</h4>
          <p class="text-stone-600 text-xs sm:text-sm mt-2 leading-relaxed">Interlinked flagstone walking trails connecting plot entrances, gardens, and community nature spots.</p>
        </div>

        <div class="p-6 rounded-2xl bg-stone-50 border border-stone-200/80 hover:border-forest-600 transition-all hover:shadow-lg">
          <div class="w-12 h-12 rounded-xl bg-forest-100 text-forest-700 flex items-center justify-center text-2xl font-bold mb-4">🛡️</div>
          <h4 class="font-bold text-lg text-stone-900">Gated Green Partition</h4>
          <p class="text-stone-600 text-xs sm:text-sm mt-2 leading-relaxed">Picketed perimeter fencing with live green hedge borders offering privacy without concrete confinement.</p>
        </div>

      </div>
    </div>
  </section>

  <!-- LOCATION & CONNECTIVITY -->
  <section class="py-16 sm:py-24 bg-stone-900 text-white">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
        <div>
          <span class="text-amber-400 text-xs sm:text-sm font-extrabold uppercase tracking-widest">Prime Location</span>
          <h2 class="serif-title text-3xl sm:text-4xl font-bold text-white mt-2">
            Mysore - Madikeri Road<br>
            <span class="text-emerald-400">Gateway to Coorg</span>
          </h2>
          <p class="text-stone-300 mt-4 text-base leading-relaxed">
            Conveniently positioned on the high-growth corridor between Mysore and the hill stations of Coorg. 
            Enjoy seamless highway accessibility while remaining enveloped in uninterrupted natural tranquility.
          </p>

          <div class="mt-8 space-y-4">
            <div class="flex items-start gap-3 p-4 rounded-xl bg-stone-800/80 border border-stone-700">
              <span class="text-amber-400 font-bold text-lg">📍</span>
              <div>
                <div class="font-bold text-white text-sm sm:text-base">25 Kms from Mysore Palace</div>
                <div class="text-xs text-stone-400">Easy 30-minute drive from the heart of Mysuru city</div>
              </div>
            </div>
            <div class="flex items-start gap-3 p-4 rounded-xl bg-stone-800/80 border border-stone-700">
              <span class="text-amber-400 font-bold text-lg">☕</span>
              <div>
                <div class="font-bold text-white text-sm sm:text-base">Near KR Nagara Junction • Behind Coffee Day</div>
                <div class="text-xs text-stone-400">Established highway landmark with round-the-clock connectivity</div>
              </div>
            </div>
            <div class="flex items-start gap-3 p-4 rounded-xl bg-stone-800/80 border border-stone-700">
              <span class="text-amber-400 font-bold text-lg">🗺️</span>
              <div>
                <div class="font-bold text-white text-sm sm:text-base">40 Acres Phase 1 Master Plan</div>
                <div class="text-xs text-stone-400">Sprawling low-density development preserving natural ecology</div>
              </div>
            </div>
          </div>

          <div class="mt-8">
            <a href="https://maps.app.goo.gl/WbcQVGnhz2Bfsrwg6?g_st=iw" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm px-6 py-3.5 rounded-xl shadow-lg transition-all">
              <span>Open Exact Location on Google Maps</span>
              <span>↗</span>
            </a>
          </div>
        </div>

        <div class="bg-stone-800 p-6 sm:p-8 rounded-3xl border border-stone-700 space-y-6">
          <div class="serif-title text-xl font-bold text-white">Project Quick Facts</div>
          <div class="divide-y divide-stone-700 text-sm">
            <div class="py-3 flex justify-between">
              <span class="text-stone-400">Project Name:</span>
              <span class="font-bold text-white">Amritha Vana Farms</span>
            </div>
            <div class="py-3 flex justify-between">
              <span class="text-stone-400">Developer:</span>
              <span class="font-bold text-white">${businessName}</span>
            </div>
            <div class="py-3 flex justify-between">
              <span class="text-stone-400">Phase 1 Extent:</span>
              <span class="font-bold text-white">40 Acres</span>
            </div>
            <div class="py-3 flex justify-between">
              <span class="text-stone-400">Min Plot Size:</span>
              <span class="font-bold text-white">6,000 Sq. Ft. (60 × 100)</span>
            </div>
            <div class="py-3 flex justify-between">
              <span class="text-stone-400">Launch Package:</span>
              <span class="font-bold text-amber-400">₹50 Lakhs (First 20 Sites)</span>
            </div>
            <div class="py-3 flex justify-between">
              <span class="text-stone-400">Regular Package:</span>
              <span class="font-bold text-white">₹57 Lakhs</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  </section>

  <!-- ENQUIRY & LEAD CAPTURE FORM SECTION -->
  <section id="enquiry-section" class="py-16 sm:py-24 bg-forest-950 text-white relative">
    <div class="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
      
      <div class="bg-white text-slate-900 rounded-3xl p-8 sm:p-12 shadow-2xl border border-stone-200">
        <div class="text-center max-w-xl mx-auto mb-8">
          <span class="text-forest-700 text-xs font-extrabold uppercase tracking-widest">Exclusive Opportunity</span>
          <h3 class="serif-title text-2xl sm:text-3xl font-bold text-slate-900 mt-2">Schedule Site Visit & Secure Launch Offer</h3>
          <p class="text-stone-600 text-xs sm:text-sm mt-2">Fill the form below to receive detailed site layouts, brochure, and lock in the ₹50 Lakhs launch package for Amritha Vana.</p>
        </div>

        <form id="amrita-lead-form" class="space-y-4 max-w-md mx-auto">
          <div>
            <label class="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1.5">Full Name</label>
            <input 
              type="text" 
              name="name" 
              required 
              placeholder="e.g. Ramesh Kumar" 
              class="w-full px-4 py-3 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-forest-600 text-sm font-medium"
            />
          </div>

          <div>
            <label class="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1.5">Mobile / WhatsApp Number</label>
            <input 
              type="tel" 
              name="phone" 
              required 
              placeholder="e.g. +91 98765 43210" 
              class="w-full px-4 py-3 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-forest-600 text-sm font-medium"
            />
          </div>

          <div>
            <label class="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1.5">Your City</label>
            <input 
              type="text" 
              name="city" 
              placeholder="e.g. Mysuru / Bengaluru" 
              class="w-full px-4 py-3 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-forest-600 text-sm font-medium"
            />
          </div>

          <div>
            <label class="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1.5">I am interested in</label>
            <select name="interest" class="w-full px-4 py-3 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-forest-600 text-sm font-medium">
              <option value="Special Launch Offer (₹50 Lakhs Plot + Dome)">Special Launch Offer (₹50 Lakhs Plot + Dome)</option>
              <option value="Weekend Site Visit">Weekend Site Visit</option>
              <option value="Land + Villa + Resort Time-Share Model">Land + Villa + Resort Time-Share Model</option>
              <option value="Brochure & Price Sheet Only">Brochure & Price Sheet Only</option>
            </select>
          </div>

          <div id="form-feedback" class="hidden text-center text-sm font-semibold p-3 rounded-lg"></div>

          <button 
            type="submit" 
            id="form-submit-btn" 
            class="w-full bg-forest-700 hover:bg-forest-800 text-white font-extrabold text-sm uppercase tracking-wider py-4 rounded-xl shadow-lg transition-all duration-200 mt-2"
          >
            Submit Enquiry & Download Details
          </button>
        </form>

      </div>

    </div>
  </section>

  <!-- FOOTER -->
  <footer class="bg-forest-950 text-stone-400 py-12 border-t border-forest-900 text-xs">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
        <div>
          <div class="serif-title font-bold text-base text-white tracking-wide">${businessName}</div>
          <div class="mt-2 text-stone-400 leading-relaxed">${address}</div>
        </div>
        <div class="md:text-right space-y-1">
          <div class="text-stone-300 font-semibold">Amritha Vana – Farm Project</div>
          <div>Mysore - Madikeri Road, Karnataka</div>
          <div class="text-stone-500 pt-2">© ${new Date().getFullYear()} ${businessName}. All rights reserved.</div>
        </div>
      </div>
    </div>
  </footer>

  <script>
    document.getElementById('amrita-lead-form').addEventListener('submit', async function(e) {
      e.preventDefault();
      var form = e.target;
      var btn = document.getElementById('form-submit-btn');
      var feedback = document.getElementById('form-feedback');
      btn.disabled = true;
      btn.innerText = 'Submitting...';

      var payload = {
        user_id: '${userId}',
        name: form.name.value,
        phone: form.phone.value,
        city: form.city.value,
        custom_question_0: form.interest.value,
        slug: 'amritavana',
        source: 'Amritha Vana Landing Page'
      };

      try {
        var res = await fetch('/api/shared/landing-page/lead', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Submission failed');

        feedback.className = 'text-center text-sm font-semibold p-3 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 block';
        feedback.innerText = '✓ Thank you! Your enquiry has been received. Our team will contact you shortly with full project details.';
        form.reset();
        btn.innerText = 'Enquiry Submitted';
      } catch(err) {
        feedback.className = 'text-center text-sm font-semibold p-3 rounded-lg bg-red-50 text-red-800 border border-red-200 block';
        feedback.innerText = 'Error: ' + err.message;
        btn.disabled = false;
        btn.innerText = 'Submit Enquiry';
      }
    });
  </script>

</body>
</html>`;
}

run().catch(err => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
