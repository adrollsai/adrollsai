const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const EMAIL = 'rajivkumaraggarwal81@gmail.com';
const PASSWORD = 'Bioque@2026';
const CREDITS = 1500;

async function setupBioqueAccount() {
  console.log('--- 1. Creating / Resolving User Account ---');
  let userId = null;

  // Check if user already exists in auth
  const { data: userList } = await supabaseAdmin.auth.admin.listUsers();
  const existingUser = userList?.users?.find(u => u.email?.toLowerCase() === EMAIL.toLowerCase());

  if (existingUser) {
    console.log(`User already exists with ID: ${existingUser.id}. Updating password...`);
    userId = existingUser.id;
    const { error: pwdErr } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { role: 'admin' }
    });
    if (pwdErr) console.error('Password update error:', pwdErr);
    else console.log('Password successfully synced to Bioque@2026');
  } else {
    console.log(`Creating new user account for ${EMAIL}...`);
    const { data: createData, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: EMAIL,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { role: 'admin' }
    });

    if (createErr) {
      throw new Error(`Failed to create auth user: ${createErr.message}`);
    }
    userId = createData.user.id;
    console.log(`Successfully created user: ${userId}`);
  }

  console.log('--- 2. Upserting Profile Information ---');
  const profilePayload = {
    id: userId,
    email: EMAIL,
    business_name: 'Bioque Estates',
    full_name: 'Rajiv Kumar Aggarwal',
    contact_number: '+91 99887 72999',
    address: 'SCO 118-119, Level II, Madhya Marg, Sector 8-C, Chandigarh - 160009',
    mission_statement: 'Redefining Real Estate Excellence Across Tri-City and Beyond',
    business_info: 'BIOQUE ESTATES is a rapidly growing Real Estate development and advisory firm built on credibility, transparency, and uncompromising quality. We cater to all real estate needs across Tri-City, Gurugram, and Noida under one roof—luxury residential sales, commercial investments, developer plots, documentation, and property management.',
    brand_color: '#0A192F',
    role: 'admin',
    credits: CREDITS,
    currency: 'INR',
    business_landing_enabled: true,
    business_landing_hero_title: 'Luxury Residences & Plots in New Chandigarh',
    business_landing_hero_subtitle: 'Exclusive Omaxe New Chandigarh inventory curated by Bioque Estates International',
    business_landing_show_products: true,
    onboarding_completed: true,
    logo_url: 'https://images.unsplash.com/photo-1560518883-ce09059eeffa?auto=format&fit=crop&w=400&q=80',
    avatar_url: 'https://images.unsplash.com/photo-1560250097-0b93528c311a?auto=format&fit=crop&w=400&q=80',
    selected_text_llm: 'gemini'
  };

  const { data: profileData, error: profileErr } = await supabaseAdmin
    .from('profiles')
    .upsert(profilePayload, { onConflict: 'id' })
    .select()
    .single();

  if (profileErr) {
    console.error('Profile upsert error:', profileErr);
    throw profileErr;
  }
  console.log('Profile successfully configured:', profileData.business_name, `Credits: ${profileData.credits}`);

  // Also record a credit transaction entry
  try {
    await supabaseAdmin.from('credit_transactions').insert({
      user_id: userId,
      amount: CREDITS,
      type: 'bonus',
      description: 'Account activation credit grant (1500 Nobo Credits)'
    });
    console.log('Credit transaction logged.');
  } catch (e) {
    console.log('Credit transaction notice:', e.message);
  }

  console.log('--- 3. Populating Omaxe New Chandigarh Inventory ---');
  // Clear any old properties for this user first
  await supabaseAdmin.from('properties').delete().eq('user_id', userId);

  const inventoryItems = [
    {
      title: 'The Lake by Omaxe',
      property_type: 'Residential',
      price: '₹ 53 Lac - ₹ 2.45 Cr',
      address: 'Sector 3 / Madhya Marg Ext., Omaxe New Chandigarh, Punjab',
      description: 'Ultra-luxurious waterfront living featuring 1, 2, 3, 4 & 5 BHK high-rise residences and penthouses. Designed around a picturesque water body with international lifestyle clubhouse, olympic swimming pool, floating cabanas, and world-class sports arenas.',
      image_url: 'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=1200&q=80',
      images: [
        'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1200&q=80'
      ],
      configurations: {
        units: ['1 BHK', '2 BHK', '3 BHK', '3 BHK + Servant', '4 BHK + Lounge', 'Penthouse'],
        sizes: '580 - 4400 Sq.Ft.',
        status: 'Ready to Move / Possession Linked'
      },
      status: 'Active',
      show_on_landing_page: true
    },
    {
      title: 'Omaxe Mulberry Villas',
      property_type: 'Residential',
      price: '₹ 2.85 Cr - ₹ 5.50 Cr',
      address: 'Omaxe New Chandigarh Township, Mullanpur, Punjab',
      description: 'Exclusive G+1 European architecture duplex luxury villas spread across 300 to 500 sq. yards. Features private landscaped lawns, expansive double-height living spaces, modular Italian kitchens, and personal terrace lounges overlooking Shivalik hills.',
      image_url: 'https://images.unsplash.com/photo-1613490493576-7fde63acd811?auto=format&fit=crop&w=1200&q=80',
      images: [
        'https://images.unsplash.com/photo-1613490493576-7fde63acd811?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1600566753376-12c8ab7fb75b?auto=format&fit=crop&w=1200&q=80'
      ],
      configurations: {
        units: ['4 BHK Luxury Villa', '5 BHK Grand Villa + Home Theatre'],
        sizes: '300 - 500 Sq. Yds Plot Area',
        status: 'Ready to Move'
      },
      status: 'Active',
      show_on_landing_page: true
    },
    {
      title: 'Celestia Royal Premier',
      property_type: 'Residential',
      price: '₹ 64 Lac - ₹ 1.25 Cr',
      address: 'Madhya Marg Extension, Omaxe New Chandigarh, Punjab',
      description: 'Stilt + 4 independent floors offering spacious 3 BHK and 4 BHK layouts with high-speed elevator access, dedicated stilt covered parking, and private terrace options. Combines the freedom of an independent floor with gated security.',
      image_url: 'https://images.unsplash.com/photo-1600585154526-990dced4db0d?auto=format&fit=crop&w=1200&q=80',
      images: [
        'https://images.unsplash.com/photo-1600585154526-990dced4db0d?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&fit=crop&w=1200&q=80'
      ],
      configurations: {
        units: ['3 BHK Independent Floor', '4 BHK Independent Floor'],
        sizes: '1450 - 2100 Sq.Ft.',
        status: 'Ready to Move'
      },
      status: 'Active',
      show_on_landing_page: true
    },
    {
      title: 'Omaxe Cassia',
      property_type: 'Residential',
      price: '₹ 75 Lac - ₹ 1.45 Cr',
      address: 'Phase 1, Omaxe New Chandigarh, Punjab',
      description: 'Thoughtfully designed 3BHK+SR and 4BHK+SR premium apartments spanning 1725 to 2200 sq.ft. Complete with contemporary fittings, panoramic green vistas, 3-tier security, and direct connectivity to Chandigarh Sector 8.',
      image_url: 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=1200&q=80',
      images: [
        'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=1200&q=80'
      ],
      configurations: {
        units: ['3 BHK + Servant', '4 BHK + Servant'],
        sizes: '1725 - 2200 Sq.Ft.',
        status: 'Ready to Move'
      },
      status: 'Active',
      show_on_landing_page: true
    },
    {
      title: 'Omaxe Residential Plots',
      property_type: 'Plots',
      price: '₹ 85 Lac - ₹ 3.20 Cr',
      address: 'Omaxe Township, New Chandigarh, Punjab',
      description: 'Freehold developed residential plots in prime sectors of New Chandigarh. Wide 60-ft wide tree-lined boulevards, underground cabling, piped gas line, round-the-clock water supply, and immediate registry/construction status.',
      image_url: 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1200&q=80',
      images: [
        'https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1524813686514-a57563d77d66?auto=format&fit=crop&w=1200&q=80'
      ],
      configurations: {
        units: ['150 Sq.Yd.', '200 Sq.Yd.', '300 Sq.Yd.', '500 Sq.Yd.'],
        sizes: '150 - 500 Sq. Yards',
        status: 'Ready for Registry & Construction'
      },
      status: 'Active',
      show_on_landing_page: true
    },
    {
      title: 'The Resort New Chandigarh',
      property_type: 'Residential',
      price: '₹ 41 Lac - ₹ 1.15 Cr',
      address: 'Omaxe New Chandigarh, Near Medicity, Punjab',
      description: 'Resort-themed living offering 1, 2, 3 BHK luxury residences and penthouses. Enjoy a rejuvenating vacation ambiance every day with lush central park greens, open-air amphitheatre, sports courts, and temperature controlled swimming pool.',
      image_url: 'https://images.unsplash.com/photo-1580587771525-78b9dba3b914?auto=format&fit=crop&w=1200&q=80',
      images: [
        'https://images.unsplash.com/photo-1580587771525-78b9dba3b914?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1576941089067-2de3c901e126?auto=format&fit=crop&w=1200&q=80'
      ],
      configurations: {
        units: ['1 BHK', '2 BHK + Store', '3 BHK + 2 WR', '3 BHK + 3 WR + Store', 'Penthouses'],
        sizes: '830 - 2400 Sq.Ft.',
        status: 'Ready to Move'
      },
      status: 'Active',
      show_on_landing_page: true
    },
    {
      title: 'Omaxe Silver Birch',
      property_type: 'Residential',
      price: '₹ 58 Lac - ₹ 1.10 Cr',
      address: 'Sector 3, Omaxe New Chandigarh, Punjab',
      description: 'Low-rise G+2 independent floors in 3 BHK and 4 BHK configurations. Designed with ample natural ventilation, individual terraces, dedicated parking bays, and direct access to neighbourhood shopping arcade.',
      image_url: 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=1200&q=80',
      images: [
        'https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=80'
      ],
      configurations: {
        units: ['3 BHK (G+2)', '4 BHK (G+2)'],
        sizes: '1350 - 1850 Sq.Ft.',
        status: 'Ready to Move'
      },
      status: 'Active',
      show_on_landing_page: true
    },
    {
      title: 'Omaxe Ambrosia Independent Floors',
      property_type: 'Residential',
      price: '₹ 62 Lac - ₹ 98 Lac',
      address: 'Omaxe New Chandigarh, Punjab',
      description: 'Stilt + 3 Storey low-rise 3 BHK apartments with private lift and reserved stilt parking. Exquisite interiors with wooden flooring in master bedroom, modern sanitaryware, and lush green park view balconies.',
      image_url: 'https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?auto=format&fit=crop&w=1200&q=80',
      images: [
        'https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1600566753086-00f18fb6b3ea?auto=format&fit=crop&w=1200&q=80'
      ],
      configurations: {
        units: ['S+3 3 BHK Independent Floors'],
        sizes: '1425 Sq.Ft.',
        status: 'Ready to Move'
      },
      status: 'Active',
      show_on_landing_page: true
    },
    {
      title: 'Omaxe Gardenia 2 & 3',
      property_type: 'Residential',
      price: '₹ 68 Lac - ₹ 1.30 Cr',
      address: 'Omaxe New Chandigarh, Punjab',
      description: 'Premium boutique floors nestled amidst 70% landscaped green open spaces. Features double-height lobbies, private porches, and exclusive membership to Club Aura offering fitness, dining, and spa facilities.',
      image_url: 'https://images.unsplash.com/photo-1600585152220-90363fe7e115?auto=format&fit=crop&w=1200&q=80',
      images: [
        'https://images.unsplash.com/photo-1600585152220-90363fe7e115?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1600573472550-8090b5e0745e?auto=format&fit=crop&w=1200&q=80'
      ],
      configurations: {
        units: ['3 BHK', '3 BHK + Family Lounge', '3 BHK + Lounge + Servant Room'],
        sizes: '1500 - 2250 Sq.Ft.',
        status: 'Ready to Move'
      },
      status: 'Active',
      show_on_landing_page: true
    },
    {
      title: 'Celestia Royal 2',
      property_type: 'Residential',
      price: '₹ 70 Lac - ₹ 1.35 Cr',
      address: 'Near Madhya Marg, Omaxe New Chandigarh, Punjab',
      description: 'Spacious 3 BHK luxury floors with family lounge and servant room options. Seamless connectivity to Sector 8 Chandigarh, surrounded by verdant green parks, wide asphalt roads, and tranquil mountain breezes.',
      image_url: 'https://images.unsplash.com/photo-1600566752355-35792bedcfea?auto=format&fit=crop&w=1200&q=80',
      images: [
        'https://images.unsplash.com/photo-1600566752355-35792bedcfea?auto=format&fit=crop&w=1200&q=80'
      ],
      configurations: {
        units: ['3 BHK', '3 BHK + Family Lounge + Servant'],
        sizes: '1580 - 2150 Sq.Ft.',
        status: 'Ready to Move'
      },
      status: 'Active',
      show_on_landing_page: true
    }
  ];

  for (const item of inventoryItems) {
    const { data: insertedProp, error: insertErr } = await supabaseAdmin
      .from('properties')
      .insert({
        user_id: userId,
        title: item.title,
        property_type: item.property_type,
        price: item.price,
        address: item.address,
        description: item.description,
        image_url: item.image_url,
        images: item.images,
        configurations: item.configurations,
        status: item.status,
        show_on_landing_page: item.show_on_landing_page
      })
      .select()
      .single();

    if (insertErr) {
      console.error(`Error inserting ${item.title}:`, insertErr);
    } else {
      console.log(`Inserted inventory: ${insertedProp.title} (${insertedProp.id})`);
    }
  }

  console.log('--- 4. Creating Dynamic Luxury Business Website ---');
  // Build state-of-the-art website HTML following Springfield Properties (Dubai luxury aesthetic)
  const websiteHtml = generateSpringfieldStyleWebsite(userId);

  // Save to landing_pages table with slug 'index'
  const { data: pageRecord, error: pageErr } = await supabaseAdmin
    .from('landing_pages')
    .upsert({
      user_id: userId,
      slug: 'index',
      title: 'Bioque Estates International | Luxury Real Estate & Advisory',
      product_name: 'Bioque Estates Portfolio',
      html_content: websiteHtml
    }, { onConflict: 'user_id,slug' })
    .select()
    .single();

  if (pageErr) {
    console.error('Failed to save website to landing_pages:', pageErr);
    throw pageErr;
  }

  console.log('Landing page index record created:', pageRecord.id);
  console.log('\n=============================================');
  console.log('ALL TASKS COMPLETED SUCCESSFULLY!');
  console.log(`Account Email: ${EMAIL}`);
  console.log(`Account Password: ${PASSWORD}`);
  console.log(`Account Credits: ${CREDITS}`);
  console.log(`User ID: ${userId}`);
  console.log(`Public Website Link: http://localhost:3000/shared/${userId}`);
  console.log(`Landing Page Direct: http://localhost:3000/shared/${userId}/index`);
  console.log('=============================================\n');
}

function generateSpringfieldStyleWebsite(userId) {
  return `<!DOCTYPE html>
<html lang="en" class="scroll-smooth">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Bioque Estates International | Luxury Real Estate & Property Advisory</title>
  <meta name="description" content="Bioque Estates International is a premier luxury real estate advisory firm delivering exceptional residences, villas, floors, and investment plots across New Chandigarh, Chandigarh, Gurugram, and Noida.">
  
  <!-- Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700;800;900&family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  
  <!-- Tailwind CSS CDN -->
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          fontFamily: {
            serif: ['Cinzel', 'serif'],
            sans: ['Plus Jakarta Sans', 'sans-serif'],
          },
          colors: {
            gold: {
              300: '#E6CA9E',
              400: '#D4AF37',
              500: '#C5A880',
              600: '#9E7E46',
            },
            navy: {
              900: '#070C18',
              850: '#0B132B',
              800: '#111E38',
              700: '#1C2E4A',
            }
          }
        }
      }
    }
  </script>
  
  <style>
    body {
      font-family: 'Plus Jakarta Sans', sans-serif;
      background-color: #070C18;
      color: #F3F4F6;
      overflow-x: hidden;
    }
    .heading-serif {
      font-family: 'Cinzel', serif;
    }
    .gold-gradient-text {
      background: linear-gradient(135deg, #FFF6E5 0%, #D4AF37 50%, #AA7C11 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .gold-border-gradient {
      border-image: linear-gradient(to right, #D4AF37, rgba(212, 175, 55, 0.1)) 1;
    }
    .glass-dark {
      background: rgba(11, 19, 43, 0.75);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid rgba(212, 175, 55, 0.15);
    }
    .glass-card {
      background: rgba(17, 30, 56, 0.6);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.07);
      transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .glass-card:hover {
      transform: translateY(-6px);
      border-color: rgba(212, 175, 55, 0.4);
      box-shadow: 0 20px 40px -15px rgba(212, 175, 55, 0.15);
    }
    .gold-btn {
      background: linear-gradient(135deg, #D4AF37 0%, #B8860B 100%);
      color: #070C18;
      font-weight: 700;
      letter-spacing: 0.08em;
      transition: all 0.3s ease;
    }
    .gold-btn:hover {
      filter: brightness(1.15);
      box-shadow: 0 8px 25px rgba(212, 175, 55, 0.35);
      transform: translateY(-2px);
    }
    .gold-outline-btn {
      border: 1px solid #D4AF37;
      color: #D4AF37;
      transition: all 0.3s ease;
    }
    .gold-outline-btn:hover {
      background: rgba(212, 175, 55, 0.15);
      border-color: #FFF6E5;
      color: #FFF6E5;
    }
    /* Custom Scrollbar */
    ::-webkit-scrollbar {
      width: 8px;
    }
    ::-webkit-scrollbar-track {
      background: #070C18;
    }
    ::-webkit-scrollbar-thumb {
      background: #1C2E4A;
      border-radius: 4px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: #D4AF37;
    }
  </style>
</head>
<body class="selection:bg-gold-500 selection:text-navy-900">

  <!-- TOP BAR -->
  <div class="bg-navy-900/90 border-b border-white/5 text-xs py-2.5 px-4 sm:px-8 hidden md:block">
    <div class="max-w-7xl mx-auto flex justify-between items-center text-slate-400">
      <div class="flex items-center space-x-6">
        <span class="flex items-center gap-2">
          <svg class="w-3.5 h-3.5 text-gold-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
          SCO 118-119, Level II, Madhya Marg, Sector 8-C, Chandigarh
        </span>
        <span class="flex items-center gap-2">
          <svg class="w-3.5 h-3.5 text-gold-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
          estatesbioque@gmail.com
        </span>
      </div>
      <div class="flex items-center space-x-4">
        <span class="text-gold-400 font-medium">Direct VIP Desk:</span>
        <a href="tel:+919988772999" class="text-white hover:text-gold-400 font-bold transition-colors">+91 99887 72999</a>
      </div>
    </div>
  </div>

  <!-- NAVIGATION HEADER -->
  <header class="sticky top-0 z-50 glass-dark border-b border-gold-500/20 shadow-2xl">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="flex justify-between items-center h-20 sm:h-24">
        
        <!-- BRAND LOGO -->
        <a href="#hero" class="flex items-center space-x-3 group">
          <div class="w-11 h-11 sm:w-12 sm:h-12 rounded-xl bg-gradient-to-br from-gold-400 via-gold-500 to-navy-900 p-[1.5px] shadow-lg shadow-gold-500/10">
            <div class="w-full h-full bg-navy-900 rounded-[10px] flex items-center justify-center">
              <span class="heading-serif font-black text-xl text-gold-400 group-hover:scale-110 transition-transform">B</span>
            </div>
          </div>
          <div>
            <span class="heading-serif text-lg sm:text-2xl font-bold tracking-wider text-white block">BIOQUE ESTATES</span>
            <span class="text-[9px] uppercase tracking-[0.25em] text-gold-400 block font-semibold">International Real Estate</span>
          </div>
        </a>

        <!-- DESKTOP NAV -->
        <nav class="hidden lg:flex items-center space-x-8 text-sm font-medium">
          <a href="#hero" class="text-white hover:text-gold-400 transition-colors uppercase tracking-widest text-xs font-semibold">Home</a>
          <a href="#inventory" class="text-slate-300 hover:text-gold-400 transition-colors uppercase tracking-widest text-xs font-semibold">Featured Inventory</a>
          <a href="#about" class="text-slate-300 hover:text-gold-400 transition-colors uppercase tracking-widest text-xs font-semibold">About Bioque</a>
          <a href="#services" class="text-slate-300 hover:text-gold-400 transition-colors uppercase tracking-widest text-xs font-semibold">Services</a>
          <a href="#contact" class="text-slate-300 hover:text-gold-400 transition-colors uppercase tracking-widest text-xs font-semibold">Contact</a>
        </nav>

        <!-- CTA ACTIONS -->
        <div class="flex items-center space-x-3">
          <a href="https://wa.me/919988772999?text=Hi%20Bioque%20Estates,%20I%20am%20interested%20in%20Omaxe%20New%20Chandigarh%20properties." target="_blank" class="hidden sm:inline-flex items-center gap-2 px-4 py-2.5 rounded-full border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 text-xs font-bold tracking-wide transition-all shadow-sm">
            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
            WhatsApp
          </a>
          <a href="#contact" class="gold-btn px-5 py-2.5 sm:px-6 sm:py-3 rounded-full text-xs uppercase tracking-wider font-extrabold flex items-center gap-2">
            <span>Book Visit</span>
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
          </a>
        </div>
      </div>
    </div>
  </header>

  <!-- HERO SECTION -->
  <section id="hero" class="relative min-h-[90vh] flex items-center justify-center overflow-hidden py-24 sm:py-32">
    <!-- Cinematic Background Image with Overlay -->
    <div class="absolute inset-0 z-0">
      <img src="https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=2000&q=90" alt="Luxury Architecture" class="w-full h-full object-cover object-center scale-105 animate-pulse duration-10000">
      <div class="absolute inset-0 bg-gradient-to-t from-navy-900 via-navy-900/80 to-navy-900/60"></div>
      <div class="absolute inset-0 bg-radial-at-c from-transparent via-navy-900/40 to-navy-900"></div>
    </div>

    <div class="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
      
      <!-- Luxury Badge -->
      <div class="inline-flex items-center gap-2.5 px-4 py-2 rounded-full glass-dark border border-gold-400/30 text-gold-300 text-xs uppercase tracking-[0.2em] font-bold mb-8 shadow-xl">
        <span class="w-2 h-2 rounded-full bg-gold-400 animate-ping"></span>
        <span>Curated Omaxe New Chandigarh Portfolio</span>
      </div>

      <!-- Main Headline -->
      <h1 class="heading-serif text-3xl sm:text-5xl md:text-7xl font-bold tracking-tight text-white mb-6 leading-[1.15] max-w-5xl mx-auto">
        Redefining <span class="gold-gradient-text">Real Estate Excellence</span> in New Chandigarh
      </h1>

      <!-- Subtitle -->
      <p class="text-slate-300 text-base sm:text-xl font-normal max-w-3xl mx-auto mb-10 leading-relaxed">
        Experience high-end waterfront apartments, independent designer floors, luxury duplex villas, and premium developed plots by Bioque Estates International.
      </p>

      <!-- Action Buttons -->
      <div class="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-6 mb-16">
        <a href="#inventory" class="gold-btn w-full sm:w-auto px-8 py-4 rounded-full text-sm uppercase tracking-widest font-extrabold flex items-center justify-center gap-3">
          <span>Explore Inventory</span>
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 14l-7 7m0 0l-7-7m7 7V3"/></svg>
        </a>
        <a href="#contact" class="gold-outline-btn w-full sm:w-auto px-8 py-4 rounded-full text-sm uppercase tracking-widest font-extrabold flex items-center justify-center gap-3">
          <span>Schedule VIP Consultation</span>
        </a>
      </div>

      <!-- Key Performance Numbers Strip -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-8 max-w-4xl mx-auto pt-8 border-t border-white/10">
        <div class="p-4 rounded-2xl glass-dark">
          <span class="heading-serif text-2xl sm:text-3xl font-bold text-gold-400 block mb-1">100%</span>
          <span class="text-xs uppercase tracking-wider text-slate-400 font-semibold">Credibility & Trust</span>
        </div>
        <div class="p-4 rounded-2xl glass-dark">
          <span class="heading-serif text-2xl sm:text-3xl font-bold text-gold-400 block mb-1">13+</span>
          <span class="text-xs uppercase tracking-wider text-slate-400 font-semibold">Omaxe Projects</span>
        </div>
        <div class="p-4 rounded-2xl glass-dark">
          <span class="heading-serif text-2xl sm:text-3xl font-bold text-gold-400 block mb-1">0%</span>
          <span class="text-xs uppercase tracking-wider text-slate-400 font-semibold">Brokerage on New Bookings</span>
        </div>
        <div class="p-4 rounded-2xl glass-dark">
          <span class="heading-serif text-2xl sm:text-3xl font-bold text-gold-400 block mb-1">24/7</span>
          <span class="text-xs uppercase tracking-wider text-slate-400 font-semibold">VIP Advisory Desk</span>
        </div>
      </div>

    </div>
  </section>

  <!-- DYNAMIC INVENTORY SECTION (CONNECTED TO NOBOGENT APP INVENTORY) -->
  <section id="inventory" class="py-24 bg-navy-850 relative border-t border-b border-white/5">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      
      <!-- Section Header -->
      <div class="flex flex-col md:flex-row justify-between items-start md:items-end mb-16 gap-6">
        <div>
          <span class="text-gold-400 text-xs uppercase tracking-[0.25em] font-bold block mb-2">Prime Real Estate Catalog</span>
          <h2 class="heading-serif text-3xl sm:text-5xl font-bold text-white tracking-tight">
            Featured <span class="gold-gradient-text">Omaxe Properties</span>
          </h2>
        </div>
        <p class="text-slate-400 text-sm max-w-md">
          Live inventory synced directly from Bioque Estates portfolio. Explore premium residential units, floors, and plots in New Chandigarh.
        </p>
      </div>

      <!-- DYNAMIC PRODUCTS CONTAINER: NOBOGENT AUTO-INJECTS AND DYNAMICALLY UPDATES THIS BLOCK -->
      <div id="business-products-container">
        <!-- Live synced products loaded dynamically from database -->
      </div>

    </div>
  </section>

  <!-- ABOUT BIOQUE ESTATES SECTION -->
  <section id="about" class="py-24 bg-navy-900 relative">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-center">
        
        <!-- Left Visuals -->
        <div class="lg:col-span-5 relative">
          <div class="relative rounded-3xl overflow-hidden shadow-2xl border border-gold-500/30">
            <img src="https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=80" alt="Bioque Estates Real Estate" class="w-full h-[520px] object-cover">
            <div class="absolute inset-0 bg-gradient-to-t from-navy-900 via-transparent to-transparent"></div>
          </div>
          
          <!-- Floating Credential Card -->
          <div class="absolute -bottom-6 -right-4 sm:-right-6 glass-dark p-6 rounded-2xl border border-gold-400/40 shadow-2xl max-w-xs">
            <div class="flex items-center space-x-3 mb-2">
              <div class="w-8 h-8 rounded-full bg-gold-400/20 flex items-center justify-center text-gold-400">
                <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>
              </div>
              <span class="text-xs uppercase tracking-widest text-gold-300 font-bold">Uncompromising Quality</span>
            </div>
            <p class="text-xs text-slate-300 leading-relaxed font-medium">
              Delivering transparency, trust, and exceptional real estate solutions across Tri-City and beyond.
            </p>
          </div>
        </div>

        <!-- Right Content -->
        <div class="lg:col-span-7">
          <span class="text-gold-400 text-xs uppercase tracking-[0.25em] font-bold block mb-3">About The Company</span>
          <h2 class="heading-serif text-3xl sm:text-4xl lg:text-5xl font-bold text-white mb-6 leading-tight">
            “We Are The Leading Real Estate Company, <br/><span class="gold-gradient-text">We Are BIOQUE ESTATES”</span>
          </h2>
          
          <div class="space-y-4 text-slate-300 text-sm sm:text-base leading-relaxed mb-8">
            <p>
              <strong class="text-white">BIOQUE ESTATES</strong> is a rapidly growing new-generation Real Estate development and advisory firm. Established to offer credibility, transparency, and top-tier quality to discerning home seekers and investors across Tri-City (Chandigarh, New Chandigarh, Mohali, Panchkula, Zirakpur), Gurugram, and Noida.
            </p>
            <p>
              We stand tall on the foundation of our core values—delivering quality real estate spaces, ensuring customer delight, and redefining modern lifestyles.
            </p>
            <p>
              As a full-suite property partner, we cater to all requirements under one single roof: property acquisition, developer plot selection, luxury villa investments, documentation, legal due-diligence, and financing assistance.
            </p>
          </div>

          <!-- Value Pillars -->
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-6 border-t border-white/10">
            <div class="p-4 rounded-xl glass-card">
              <h4 class="font-bold text-white text-sm mb-1">Credibility</h4>
              <p class="text-xs text-slate-400">100% verified titles & builder agreements.</p>
            </div>
            <div class="p-4 rounded-xl glass-card">
              <h4 class="font-bold text-white text-sm mb-1">Transparency</h4>
              <p class="text-xs text-slate-400">Honest pricing with zero hidden fees.</p>
            </div>
            <div class="p-4 rounded-xl glass-card">
              <h4 class="font-bold text-white text-sm mb-1">End-to-End</h4>
              <p class="text-xs text-slate-400">From site tour to registry & possession.</p>
            </div>
          </div>

        </div>

      </div>
    </div>
  </section>

  <!-- COMPREHENSIVE SERVICES -->
  <section id="services" class="py-24 bg-navy-850 relative border-t border-white/5">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      
      <div class="text-center max-w-3xl mx-auto mb-16">
        <span class="text-gold-400 text-xs uppercase tracking-[0.25em] font-bold block mb-2">Our Expertise</span>
        <h2 class="heading-serif text-3xl sm:text-5xl font-bold text-white tracking-tight mb-4">
          Complete <span class="gold-gradient-text">Real Estate Solutions</span>
        </h2>
        <p class="text-slate-400 text-sm">Everything you need for seamless property transactions and high-yield wealth creation.</p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        
        <div class="p-8 rounded-3xl glass-card border border-white/5 flex flex-col">
          <div class="w-12 h-12 rounded-2xl bg-gold-400/10 border border-gold-400/30 flex items-center justify-center text-gold-400 mb-6">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>
          </div>
          <h3 class="heading-serif text-xl font-bold text-white mb-3">Residential Sales & Purchase</h3>
          <p class="text-slate-400 text-xs leading-relaxed flex-grow">Curated access to luxury apartments, independent floors, and bespoke villas in New Chandigarh.</p>
        </div>

        <div class="p-8 rounded-3xl glass-card border border-white/5 flex flex-col">
          <div class="w-12 h-12 rounded-2xl bg-gold-400/10 border border-gold-400/30 flex items-center justify-center text-gold-400 mb-6">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
          </div>
          <h3 class="heading-serif text-xl font-bold text-white mb-3">Investment & Plot Advisory</h3>
          <p class="text-slate-400 text-xs leading-relaxed flex-grow">Strategic plot identification with high capital appreciation potential across emerging corridors.</p>
        </div>

        <div class="p-8 rounded-3xl glass-card border border-white/5 flex flex-col">
          <div class="w-12 h-12 rounded-2xl bg-gold-400/10 border border-gold-400/30 flex items-center justify-center text-gold-400 mb-6">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
          </div>
          <h3 class="heading-serif text-xl font-bold text-white mb-3">Documentation & Legal Due Diligence</h3>
          <p class="text-slate-400 text-xs leading-relaxed flex-grow">Complete title clearance, agreement drafting, registry facilitation, and smooth home loan clearances.</p>
        </div>

      </div>

    </div>
  </section>

  <!-- VIP INQUIRY & CONTACT SECTION -->
  <section id="contact" class="py-24 bg-navy-900 relative">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-12 items-start">
        
        <!-- Contact Details -->
        <div class="lg:col-span-5 space-y-8">
          <div>
            <span class="text-gold-400 text-xs uppercase tracking-[0.25em] font-bold block mb-2">Connect Directly</span>
            <h2 class="heading-serif text-3xl sm:text-5xl font-bold text-white tracking-tight mb-4">
              Plan Your <span class="gold-gradient-text">Private Site Tour</span>
            </h2>
            <p class="text-slate-400 text-sm leading-relaxed">
              Experience Omaxe New Chandigarh firsthand. Our senior advisors will arrange private site tours, floor plan presentations, and payment plan discussions.
            </p>
          </div>

          <div class="space-y-6">
            <div class="flex items-start space-x-4 p-5 rounded-2xl glass-card">
              <div class="w-10 h-10 rounded-xl bg-gold-400/20 text-gold-400 flex items-center justify-center shrink-0">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
              </div>
              <div>
                <h4 class="text-white font-bold text-sm">Corporate Office</h4>
                <p class="text-slate-400 text-xs mt-1 leading-relaxed">SCO 118-119, Level II, Madhya Marg, Sector 8-C, Chandigarh - 160009</p>
              </div>
            </div>

            <div class="flex items-start space-x-4 p-5 rounded-2xl glass-card">
              <div class="w-10 h-10 rounded-xl bg-gold-400/20 text-gold-400 flex items-center justify-center shrink-0">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>
              </div>
              <div>
                <h4 class="text-white font-bold text-sm">Direct Phone</h4>
                <p class="text-slate-400 text-xs mt-1"><a href="tel:+919988772999" class="hover:text-gold-400 transition-colors font-semibold">+91 99887 72999</a></p>
              </div>
            </div>

            <div class="flex items-start space-x-4 p-5 rounded-2xl glass-card">
              <div class="w-10 h-10 rounded-xl bg-gold-400/20 text-gold-400 flex items-center justify-center shrink-0">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
              </div>
              <div>
                <h4 class="text-white font-bold text-sm">Email Inquiries</h4>
                <p class="text-slate-400 text-xs mt-1"><a href="mailto:estatesbioque@gmail.com" class="hover:text-gold-400 transition-colors">estatesbioque@gmail.com</a></p>
              </div>
            </div>
          </div>

        </div>

        <!-- Interactive Lead Form -->
        <div class="lg:col-span-7 glass-dark p-8 sm:p-12 rounded-3xl border border-gold-500/30 shadow-2xl">
          <h3 class="heading-serif text-2xl font-bold text-white mb-2">Request Exclusive Pricing & Brochure</h3>
          <p class="text-slate-400 text-xs mb-8">Fill in your preferences and our client advisor will connect with customized options within 15 minutes.</p>

          <form id="contact-form" class="space-y-5" onsubmit="handleInquirySubmit(event)">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <label class="block text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-2">Full Name *</label>
                <input type="text" id="lead-name" required placeholder="e.g. Rajiv Kumar" class="w-full bg-navy-900 border border-white/10 rounded-xl px-4 py-3.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-gold-400 transition-colors">
              </div>
              <div>
                <label class="block text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-2">WhatsApp / Phone *</label>
                <input type="tel" id="lead-phone" required placeholder="+91 98765 43210" class="w-full bg-navy-900 border border-white/10 rounded-xl px-4 py-3.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-gold-400 transition-colors">
              </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <label class="block text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-2">Preferred Project</label>
                <select id="lead-project" class="w-full bg-navy-900 border border-white/10 rounded-xl px-4 py-3.5 text-sm text-white focus:outline-none focus:border-gold-400 transition-colors">
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
                <label class="block text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-2">Budget Range</label>
                <select id="lead-budget" class="w-full bg-navy-900 border border-white/10 rounded-xl px-4 py-3.5 text-sm text-white focus:outline-none focus:border-gold-400 transition-colors">
                  <option value="₹ 50 Lac - ₹ 1 Cr">₹ 50 Lac - ₹ 1 Cr</option>
                  <option value="₹ 1 Cr - ₹ 2.5 Cr">₹ 1 Cr - ₹ 2.5 Cr</option>
                  <option value="₹ 2.5 Cr - ₹ 5 Cr+">₹ 2.5 Cr - ₹ 5 Cr+</option>
                </select>
              </div>
            </div>

            <div>
              <label class="block text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-2">Message or Requirement (Optional)</label>
              <textarea id="lead-msg" rows="3" placeholder="Tell us if you need floor plans, site visit schedule, or immediate possession..." class="w-full bg-navy-900 border border-white/10 rounded-xl px-4 py-3.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-gold-400 transition-colors"></textarea>
            </div>

            <button type="submit" id="submit-btn" class="gold-btn w-full py-4 rounded-xl text-xs uppercase tracking-widest font-extrabold flex items-center justify-center gap-2">
              <span>Submit & Get Instant Details</span>
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
            </button>
            <div id="form-feedback" class="text-center text-xs font-semibold hidden pt-2"></div>
          </form>

        </div>

      </div>

    </div>
  </section>

  <!-- FOOTER -->
  <footer class="bg-navy-900 border-t border-white/10 py-12 text-slate-400 text-xs">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row justify-between items-center gap-6">
      <div class="flex items-center space-x-3">
        <span class="heading-serif text-lg font-bold text-white">BIOQUE ESTATES INTERNATIONAL</span>
      </div>
      <p class="text-center sm:text-right">
        © 2026 Bioque Estates International. All rights reserved. <br/>
        SCO 118-119, Level II, Madhya Marg, Sector 8-C, Chandigarh.
      </p>
    </div>
  </footer>

  <script>
    async function handleInquirySubmit(e) {
      e.preventDefault();
      const btn = document.getElementById('submit-btn');
      const feedback = document.getElementById('form-feedback');
      const name = document.getElementById('lead-name').value.trim();
      const phone = document.getElementById('lead-phone').value.trim();
      const project = document.getElementById('lead-project').value;
      const budget = document.getElementById('lead-budget').value;
      const message = document.getElementById('lead-msg').value.trim();

      btn.disabled = true;
      btn.innerText = 'Submitting...';

      try {
        const payload = {
          user_id: '${userId}',
          name: name,
          phone: phone,
          city: 'Chandigarh / Tri-City',
          product_name: project,
          notes: 'Budget: ' + budget + ' | Message: ' + message
        };

        const res = await fetch('/api/shared/landing-page/lead', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        feedback.className = 'text-center text-xs font-semibold text-emerald-400 pt-2 block';
        feedback.innerText = 'Thank you! Your inquiry has been received. Our advisory team will reach out shortly.';
        document.getElementById('contact-form').reset();
      } catch (err) {
        feedback.className = 'text-center text-xs font-semibold text-red-400 pt-2 block';
        feedback.innerText = 'Thank you! Your inquiry has been noted. We will contact you soon.';
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<span>Submit & Get Instant Details</span>';
      }
    }
  </script>

</body>
</html>`;
}

setupBioqueAccount().catch(err => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
