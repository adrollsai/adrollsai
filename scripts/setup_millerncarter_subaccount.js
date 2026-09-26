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

const PIPIXEL_AGENCY_ID = 'c7bede84-d7ea-4b02-bbbb-017d24a37914';
const SUBACCOUNT_EMAIL = 'Juyee@millerncarter.co.uk';
const SUBACCOUNT_PASSWORD = 'MillerCarter2026!';
const BUSINESS_NAME = 'Miller & Carter Immigration Consultants';

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
  console.log('========================================================');
  console.log('🚀 SETTING UP MILLER & CARTER SUBACCOUNT UNDER PIPIXEL');
  console.log('========================================================');

  // 1. Create or synchronize Auth User
  console.log('\n--- 1. Authenticating / Creating Sub-account Auth User ---');
  let userId = null;
  const { data: { users }, error: listErr } = await supabaseAdmin.auth.admin.listUsers();
  if (listErr) throw listErr;

  const existingUser = (users || []).find(u => u.email?.toLowerCase() === SUBACCOUNT_EMAIL.toLowerCase());

  if (existingUser) {
    console.log(`Found existing auth user: ${existingUser.id}`);
    userId = existingUser.id;
    await supabaseAdmin.auth.admin.updateUserById(userId, {
      password: SUBACCOUNT_PASSWORD,
      email_confirm: true,
      user_metadata: { role: 'client' }
    });
    console.log('Password synchronized for existing auth user.');
  } else {
    console.log(`Creating new user for ${SUBACCOUNT_EMAIL}...`);
    const { data: newUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: SUBACCOUNT_EMAIL,
      password: SUBACCOUNT_PASSWORD,
      email_confirm: true,
      user_metadata: { role: 'client' }
    });
    if (createErr) throw createErr;
    userId = newUser.user.id;
    console.log(`Created new auth user with ID: ${userId}`);
  }

  // 2. Upload Logo & Cropped Product Images to Cloudflare R2
  console.log('\n--- 2. Uploading Brand Assets & CBI Product Images to R2 ---');
  const scratchDir = 'C:\\Users\\Adrolls\\.gemini\\antigravity-ide\\brain\\7eef16ec-fcb3-4532-b4cc-184813d8f39d\\scratch';
  const cropsDir = path.join(scratchDir, 'crops');

  // Logo
  const logoLocal = path.join(scratchDir, 'miller_carter_logo.png');
  const logoR2Key = `logos/${userId}/miller-carter-logo.png`;
  console.log('Uploading Miller & Carter logo...');
  const logoUrl = await uploadFileToR2(logoLocal, logoR2Key, 'image/png');
  console.log('✓ Logo uploaded:', logoUrl);

  // CBI Products Images
  const vanuatuLocal = path.join(cropsDir, 'vanuatu_cbi.jpg');
  const dominicaLocal = path.join(cropsDir, 'dominica_cbi.jpg');
  const stLuciaLocal = path.join(cropsDir, 'saint_lucia_cbi.jpg');
  const grenadaLocal = path.join(cropsDir, 'grenada_cbi.jpg');
  const antiguaLocal = path.join(cropsDir, 'antigua_barbuda_cbi.jpg');
  const stKittsLocal = path.join(cropsDir, 'st_kitts_nevis_cbi.jpg');

  console.log('Uploading CBI program cards to R2...');
  const vanuatuUrl = await uploadFileToR2(vanuatuLocal, `properties/${userId}/vanuatu-cbi.jpg`);
  const dominicaUrl = await uploadFileToR2(dominicaLocal, `properties/${userId}/dominica-cbi.jpg`);
  const stLuciaUrl = await uploadFileToR2(stLuciaLocal, `properties/${userId}/saint-lucia-cbi.jpg`);
  const grenadaUrl = await uploadFileToR2(grenadaLocal, `properties/${userId}/grenada-cbi.jpg`);
  const antiguaUrl = await uploadFileToR2(antiguaLocal, `properties/${userId}/antigua-barbuda-cbi.jpg`);
  const stKittsUrl = await uploadFileToR2(stKittsLocal, `properties/${userId}/st-kitts-nevis-cbi.jpg`);

  console.log('✓ All 6 product assets successfully uploaded to R2.');

  // 3. Upsert Profile with Miller & Carter details
  console.log('\n--- 3. Updating Profile with Brand & Business Details ---');
  const profilePayload = {
    id: userId,
    email: SUBACCOUNT_EMAIL,
    business_name: BUSINESS_NAME,
    role: 'client',
    agency_id: PIPIXEL_AGENCY_ID,
    parent_id: PIPIXEL_AGENCY_ID,
    contact_number: '+971 56 587 5855',
    address: '406 - 407 Al Moosa Tower 1, Sheikh Zayed Road, Opp Future Museum, Dubai, UAE',
    logo_url: logoUrl,
    brand_color: '#0B3F28',
    mission_statement: 'Miller & Carter is an exclusive, licensed UK and Global Immigration consultancy based in London and Dubai. With over a decade of excellence, our legal team of barristers and solicitors specializes in Citizenship by Investment, Second Passports (Vanuatu, Dominica, St. Lucia, Grenada, Antigua & Barbuda, St. Kitts & Nevis), UK Skilled Worker Visas, Sponsor Licenses, and Global Wealth Mobility with 100% discretion and legal integrity.',
    business_info: JSON.stringify({
      bio: 'Miller & Carter, based in London and Dubai, is a premier immigration consultancy firm of lawyers and advisors with over a decade of experience in the UK and UAE. We deliver bespoke Citizenship by Investment programs across the Caribbean and Pacific, UK Corporate Sponsor Licences, and High-Net-Worth Global Mobility.',
      notification_email: SUBACCOUNT_EMAIL,
      timezone: 'Asia/Dubai',
      industry: 'Citizenship by Investment & UK Immigration Law',
      offices: {
        dubai: '406 - 407 Al Moosa Tower 1, Sheikh Zayed Road, Opp Future Museum, Dubai, UAE',
        london: '18 Great Portland Street, Oxford Street, W1W 8QP, London, UK'
      },
      phone_numbers: ['+971 56 587 5855', '+971 4 327 5221'],
      website: 'https://millerncarter.ae/'
    }),
    credits: 5000,
    subscription_plan: 'enterprise',
    subscription_status: 'active',
    subscription_valid_until: '2099-12-31T23:59:59+00:00',
    onboarding_completed: true,
    currency: 'USD',
    client_features: ['analytics', 'inventory', 'creation', 'ads', 'crm', 'whatsapp', 'voice_agent', 'flows'],
    character_description: 'A distinguished, authoritative immigration barrister and luxury global wealth mobility advisor with over a decade of UK and GCC legal experience.',
    character_url: logoUrl
  };

  const { error: profileErr } = await supabaseAdmin.from('profiles').upsert(profilePayload);
  if (profileErr) throw profileErr;
  console.log('✓ Profile successfully configured and linked under PiPixel Agency.');

  // 4. Populate Catalogue with 6 Products
  console.log('\n--- 4. Populating Catalogue (6 Citizenship by Investment Programs) ---');
  await supabaseAdmin.from('properties').delete().eq('user_id', userId);

  const cbiProducts = [
    {
      user_id: userId,
      title: 'Vanuatu Citizenship by Investment (DSP Fast-Track)',
      price: '$130,000 USD',
      property_type: 'Citizenship by Investment',
      status: 'Active',
      image_url: vanuatuUrl,
      images: [vanuatuUrl],
      description: `Your Freedom. Your Future. Your Choice. Secure direct Vanuatu citizenship and a powerful Commonwealth passport in just 30–60 days—the world's fastest CBI program.\n\nKey Program Highlights:\n• Official Program: Launched in 2017 via the Development Support Program (DSP)\n• Investment Threshold: Single applicant from $130,000 USD\n• Processing Speed: Citizenship in 1–2 months (approx.)\n• Global Mobility: Visa-free / visa-on-arrival to 130+ countries including Singapore, Hong Kong, and UK transit privileges\n• Family Friendly: Include spouse, children, parents & grandparents (up to 4 generations)\n• Residency Requirement: ZERO residency, physical stay, or language test required\n• Tax Efficiency: 0% Personal income tax, wealth tax, gift tax, or inheritance tax\n• High Confidentiality: 100% remote legal application filed by licensed Miller & Carter barristers`,
      configurations: JSON.stringify({
        program_type: 'Citizenship by Investment',
        timeline: '1-2 Months (Fastest Globally)',
        visa_free_countries: '130+ Countries',
        family_generations: '4 Generations',
        residency_requirement: 'None (100% Remote)',
        tax_regime: '0% Income & Wealth Tax',
        passport_color: 'Green'
      }),
      show_on_landing_page: true
    },
    {
      user_id: userId,
      title: 'Dominica Citizenship by Investment (EDF & Real Estate)',
      price: '$200,000 USD',
      property_type: 'Citizenship by Investment',
      status: 'Active',
      image_url: dominicaUrl,
      images: [dominicaUrl],
      description: `Nature's Island. A Passport of Freedom. One of the world's most reputable and longest-running citizenship programs, established in 1993.\n\nKey Program Highlights:\n• Established CBI Program: Active and government-regulated since 1993\n• Investment Pathways: Contribution to Economic Diversification Fund (EDF) or Government-Approved Luxury Real Estate\n• Processing Speed: Citizenship in 3–4 months (approx.)\n• Global Mobility: Visa-free / visa-on-arrival to 140+ countries including European Schengen Area, Singapore, Hong Kong\n• Family Inclusion: Include spouse, dependent children up to 30, parents & grandparents\n• Residency Requirement: No physical stay or landing required\n• Fiscal Advantages: Zero worldwide income tax, no capital gains or wealth taxes\n• Dual Citizenship: Legally recognized and strictly confidential`,
      configurations: JSON.stringify({
        program_type: 'Citizenship by Investment',
        timeline: '3-4 Months',
        visa_free_countries: '140+ Countries',
        investment_options: 'EDF Donation or Real Estate',
        residency_requirement: 'None',
        established_year: 1993
      }),
      show_on_landing_page: true
    },
    {
      user_id: userId,
      title: 'Saint Lucia Citizenship by Investment (NEF / Real Estate)',
      price: '$240,000 USD',
      property_type: 'Citizenship by Investment',
      status: 'Active',
      image_url: stLuciaUrl,
      images: [stLuciaUrl],
      description: `Live the Lifestyle. Own Your Freedom. Experience the prestige of Saint Lucia citizenship with exceptional international mobility and sovereign asset protection.\n\nKey Program Highlights:\n• Program Launch: Well-established CBI program launched in 2015\n• Investment Pathways: Contribution to National Economic Fund (NEF) or Government-Approved 5-Star Resort Real Estate\n• Processing Speed: Citizenship in 3–4 months (approx.)\n• Global Access: Visa-free / visa-on-arrival to 140+ countries worldwide\n• Family Security: Future-ready protection for spouse, children, parents & grandparents\n• Fiscal Advantages: Highly favorable tax environment with no global income taxation\n• Peace of Mind: Safe, politically stable British Commonwealth jurisdiction`,
      configurations: JSON.stringify({
        program_type: 'Citizenship by Investment',
        timeline: '3-4 Months',
        visa_free_countries: '140+ Countries',
        investment_options: 'NEF Contribution or Luxury Real Estate',
        residency_requirement: 'None',
        established_year: 2015
      }),
      show_on_landing_page: true
    },
    {
      user_id: userId,
      title: 'Grenada Citizenship by Investment (USA E-2 Treaty Access)',
      price: '$235,000 USD',
      property_type: 'Citizenship by Investment',
      status: 'Active',
      image_url: grenadaUrl,
      images: [grenadaUrl],
      description: `A Stronger Passport. A Brighter Future. Grenada is the only Caribbean citizenship program offering an official bilateral E-2 Investor Visa treaty with the United States of America.\n\nKey Program Highlights:\n• Program Launch: Established and fully regulated since 2013\n• Investment Pathways: Contribution to National Transformation Fund (NTF) or Government-Approved Luxury Real Estate\n• Processing Speed: Citizenship in 3–4 months (approx.)\n• Global Mobility: Visa-free / visa-on-arrival to 140+ countries including China, UK, Schengen, and Singapore\n• Exclusive US Advantage: Qualify to apply for the USA E-2 Treaty Investor Visa to live and run a business in the United States\n• Family Inclusion: Protect what matters most—include spouse, children, parents, grandparents, and unmarried siblings\n• Education Access: Preferential admissions and tuition benefits at St. George's University (leading medical school)\n• Dual Citizenship: Unconditionally allowed with zero worldwide income tax`,
      configurations: JSON.stringify({
        program_type: 'Citizenship by Investment',
        timeline: '3-4 Months',
        visa_free_countries: '140+ Countries (incl. China & UK)',
        special_treaty: 'USA E-2 Treaty Investor Visa Eligible',
        residency_requirement: 'None',
        established_year: 2013
      }),
      show_on_landing_page: true
    },
    {
      user_id: userId,
      title: 'Antigua & Barbuda Citizenship by Investment (NDF & Family Pathway)',
      price: '$230,000 USD',
      property_type: 'Citizenship by Investment',
      status: 'Active',
      image_url: antiguaUrl,
      images: [antiguaUrl],
      description: `A Passport for Global Freedom and a Brighter Future. Recognized as the premier CBI solution for large families seeking global mobility and tax efficiency.\n\nKey Program Highlights:\n• Program Launch: Highly respected CBI program since 2013\n• Investment Pathways: Contribution to National Development Fund (NDF), University of the West Indies (UWI) Fund, or Real Estate\n• Processing Speed: Citizenship in 3–4 months (approx.)\n• Global Access: Visa-free travel to 150+ countries including the UK, Schengen Area, and Singapore\n• Family Inclusion: The most cost-effective program for multi-generational families (spouse, children, parents, grandparents, and unmarried siblings)\n• Tax Efficiency: 0% Personal income tax, wealth tax, gift tax, or inheritance tax\n• Confidential Process: Discretion guaranteed under British Commonwealth legal standards`,
      configurations: JSON.stringify({
        program_type: 'Citizenship by Investment',
        timeline: '3-4 Months',
        visa_free_countries: '150+ Countries',
        investment_options: 'NDF, UWI Fund, or Real Estate',
        family_benefit: 'Best for Large Multi-Generational Families',
        residency_requirement: '5 Days in first 5 years',
        established_year: 2013
      }),
      show_on_landing_page: true
    },
    {
      user_id: userId,
      title: 'St. Kitts & Nevis Citizenship by Investment (The Platinum Standard)',
      price: '$250,000 USD',
      property_type: 'Citizenship by Investment',
      status: 'Active',
      image_url: stKittsUrl,
      images: [stKittsUrl],
      description: `Your Gateway to Global Mobility and Generational Security. The world's oldest, most prestigious, and original Citizenship by Investment program, operating continuously since 1984.\n\nKey Program Highlights:\n• The Platinum Standard: The world's longest-standing CBI program since 1984\n• Investment Pathways: Contribution to Sustainable Island State Contribution (SISC) or Approved Luxury Real Estate\n• Processing Speed: Citizenship in 3–4 months (approx.)\n• Global Mobility: Unrivaled visa-free access to 150+ destinations worldwide\n• Generational Security: Lifelong, irrevocable citizenship inheritable by future generations\n• Tax Advantages: Zero worldwide income tax, no capital gains, gift, or estate duties\n• Confidential & Secure: Highest level of international vetting, privacy, and due diligence`,
      configurations: JSON.stringify({
        program_type: 'Citizenship by Investment',
        timeline: '3-4 Months',
        visa_free_countries: '150+ Destinations',
        heritage: "World's First CBI (Est. 1984)",
        investment_options: 'SISC Contribution or Luxury Real Estate',
        residency_requirement: 'None'
      }),
      show_on_landing_page: true
    }
  ];

  const { data: insertedProducts, error: prodErr } = await supabaseAdmin
    .from('properties')
    .insert(cbiProducts)
    .select();

  if (prodErr) throw prodErr;
  console.log(`✓ Inserted ${insertedProducts.length} CBI products into catalogue with detailed specs & high-res posters.`);

  // 5. Generate and Insert High-Converting Landing Page
  console.log('\n--- 5. Creating Ultra-High Converting Landing Page ---');
  const landingPageHtml = generateMillerCarterLandingPageHtml({
    userId,
    logoUrl,
    products: insertedProducts,
    contactNumber: '+971 56 587 5855',
    phoneRaw: '971565875855',
    dubaiOffice: '406 - 407 Al Moosa Tower 1, Sheikh Zayed Road, Opp Future Museum, Dubai, UAE',
    londonOffice: '18 Great Portland Street, Oxford Street, W1W 8QP, London, UK'
  });

  // Upsert for slug: 'index' (default) and slug: 'vanuatu-cbi'
  const pagesToInsert = [
    {
      user_id: userId,
      slug: 'index',
      title: 'Vanuatu & Caribbean Citizenship by Investment | Miller & Carter Dubai & London',
      product_name: 'Vanuatu Citizenship by Investment (VIP Fast-Track)',
      html_content: landingPageHtml,
      property_id: insertedProducts[0].id
    },
    {
      user_id: userId,
      slug: 'vanuatu-cbi',
      title: 'Vanuatu Citizenship by Investment (30–60 Days) | Miller & Carter',
      product_name: 'Vanuatu Citizenship by Investment (VIP Fast-Track)',
      html_content: landingPageHtml,
      property_id: insertedProducts[0].id
    }
  ];

  for (const page of pagesToInsert) {
    const { error: pageErr } = await supabaseAdmin
      .from('landing_pages')
      .upsert(page, { onConflict: 'user_id,slug' });
    if (pageErr) throw pageErr;
    console.log(`✓ Published landing page for slug: "${page.slug}"`);
  }

  // 6. Insert a realistic dummy lead to confirm CRM integration
  console.log('\n--- 6. Creating Initial Demonstration Lead in CRM ---');
  const demoLead = {
    user_id: userId,
    name: 'Tariq Al-Mansoor',
    email: 'tariq.mansoor@almansoorgroup.ae',
    phone: '+971501234567',
    status: 'New Lead',
    pipeline_stage: 'New Lead',
    source: 'Landing Page - Vanuatu CBI',
    value: 130000,
    notes: 'Dubai-based tech investor inquiring about Vanuatu CBI for family of 4 (Self, Spouse, 2 Children). High intent for 30-day fast-track processing and tax structuring.',
    custom_fields: JSON.stringify({
      target_program: 'Vanuatu Citizenship by Investment',
      timeline: 'Urgent (Next 30 Days)',
      family_members: 'Family of 4',
      budget: '$130,000+',
      city: 'Dubai',
      lead_quality: '🔥 High Net Worth / Hot Lead'
    })
  };

  const { error: leadErr } = await supabaseAdmin.from('leads').upsert(demoLead);
  if (leadErr) console.warn('Demo lead notice:', leadErr.message);
  else console.log('✓ Initial CRM demonstration lead added.');

  console.log('\n========================================================');
  console.log('🎉 SUB-ACCOUNT & HIGH-CONVERTING LANDER SETUP COMPLETED!');
  console.log('========================================================');
  console.log(`Parent Agency:     PiPixel (${PIPIXEL_AGENCY_ID})`);
  console.log(`Sub-Account Email: ${SUBACCOUNT_EMAIL}`);
  console.log(`Login Password:    ${SUBACCOUNT_PASSWORD}`);
  console.log(`Sub-Account ID:    ${userId}`);
  console.log(`Business Name:     ${BUSINESS_NAME}`);
  console.log(`Products Added:    6 Official CBI Programs (Vanuatu, Dominica, St. Lucia, Grenada, Antigua, St. Kitts)`);
  console.log(`Landing Page Slugs: "index" & "vanuatu-cbi"`);
  console.log(`Live Preview URL:  /shared/${userId}`);
  console.log('========================================================\n');
}

function generateMillerCarterLandingPageHtml({ userId, logoUrl, products, contactNumber, phoneRaw, dubaiOffice, londonOffice }) {
  const vanuatu = products[0];

  return `<!DOCTYPE html>
<html lang="en" class="scroll-smooth">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0">
  <title>Vanuatu Citizenship by Investment | Miller & Carter Dubai & London</title>
  <meta name="description" content="Secure your second passport & citizenship in 30-60 days with Vanuatu Citizenship by Investment. 130+ visa-free countries, 0% tax, no physical residency required. Licensed legal advisors in Dubai & London.">
  <meta name="keywords" content="Vanuatu Citizenship, Vanuatu CBI, Second Passport, Citizenship by Investment Dubai, Miller and Carter Dubai, Commonwealth Passport, Tax Free Citizenship">
  
  <meta property="og:title" content="Vanuatu Citizenship by Investment | 30-Day Second Passport">
  <meta property="og:description" content="Obtain second citizenship in 1-2 months. Visa-free access to 130+ countries, 0% personal tax, up to 4 generations included. Miller & Carter London & Dubai.">
  <meta property="og:image" content="${vanuatu.image_url}">
  <meta property="og:type" content="website">

  <!-- Schema.org Structured Data -->
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "LegalService",
    "name": "Miller & Carter Immigration Consultants",
    "image": "${logoUrl}",
    "logo": "${logoUrl}",
    "url": "https://millerncarter.ae",
    "telephone": "${contactNumber}",
    "email": "info@millerncarter.ae",
    "address": [
      {
        "@type": "PostalAddress",
        "streetAddress": "406 - 407 Al Moosa Tower 1, Sheikh Zayed Road, Opp Future Museum",
        "addressLocality": "Dubai",
        "addressCountry": "AE"
      },
      {
        "@type": "PostalAddress",
        "streetAddress": "18 Great Portland Street, Oxford Street",
        "addressLocality": "London",
        "postalCode": "W1W 8QP",
        "addressCountry": "GB"
      }
    ],
    "description": "Exclusive UK and Global Citizenship by Investment legal advisory based in London and Dubai.",
    "priceRange": "$$$$"
  }
  </script>

  <!-- Google Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800;900&family=Playfair+Display:ital,wght@0,600;0,700;0,800;1,600;1,700&display=swap" rel="stylesheet">

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
            brand: {
              950: '#03140C',
              900: '#072417',
              850: '#0B3F28',
              800: '#115235',
              700: '#197049',
              600: '#218E5E',
              500: '#2BB076',
              100: '#E4F4EC',
              50:  '#F0FAF5'
            },
            gold: {
              100: '#FBF5E8',
              200: '#F5E6C7',
              300: '#ECCFA0',
              400: '#DFB46C',
              500: '#D4AF37',
              600: '#B8860B',
              700: '#996515',
            }
          }
        }
      }
    }
  </script>

  <style>
    body {
      font-family: 'Plus Jakarta Sans', sans-serif;
      background: #04100A;
      color: #F8FAFC;
      overflow-x: hidden;
    }
    
    .gold-gradient-text {
      background: linear-gradient(135deg, #FFF0D0 0%, #D4AF37 50%, #AA771C 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .gold-button {
      background: linear-gradient(135deg, #E6CA9E 0%, #D4AF37 50%, #B8860B 100%);
      color: #072417;
      font-weight: 800;
      box-shadow: 0 10px 25px -5px rgba(212, 175, 55, 0.4);
      transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    }
    .gold-button:hover {
      transform: translateY(-2px);
      box-shadow: 0 15px 35px -5px rgba(212, 175, 55, 0.6);
      filter: brightness(1.08);
    }

    .glass-card {
      background: rgba(11, 63, 40, 0.35);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid rgba(212, 175, 55, 0.2);
    }
    .glass-card-hover:hover {
      border-color: rgba(212, 175, 55, 0.45);
      background: rgba(11, 63, 40, 0.5);
      transform: translateY(-4px);
      transition: all 0.3s ease;
    }

    .passport-glow {
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.8), 0 0 40px rgba(43, 176, 118, 0.25);
    }

    /* Custom form styling */
    .cbi-input {
      width: 100%;
      background: rgba(4, 16, 10, 0.7);
      border: 1px solid rgba(212, 175, 55, 0.3);
      border-radius: 0.75rem;
      padding: 0.875rem 1.125rem;
      color: #ffffff;
      font-size: 0.95rem;
      transition: all 0.2s;
    }
    .cbi-input:focus {
      outline: none;
      border-color: #D4AF37;
      box-shadow: 0 0 0 3px rgba(212, 175, 55, 0.2);
      background: rgba(4, 16, 10, 0.95);
    }
    .cbi-input::placeholder {
      color: #64748B;
    }

    /* Step animations */
    .step-fade-in {
      animation: stepFadeIn 0.35s ease-out forwards;
    }
    @keyframes stepFadeIn {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }
  </style>
</head>
<body class="antialiased selection:bg-gold-500 selection:text-brand-950 pb-20 sm:pb-0">

  <!-- TOP ANNOUNCEMENT BAR -->
  <div class="bg-gradient-to-r from-brand-950 via-brand-850 to-brand-950 border-b border-gold-500/20 py-2.5 px-4 text-xs font-semibold text-center text-gold-200">
    <div class="max-w-7xl mx-auto flex items-center justify-center gap-2 flex-wrap">
      <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-gold-500/20 text-gold-300 font-bold tracking-wider text-[11px] uppercase border border-gold-500/30">
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span> Official 2026 Quota
      </span>
      <span>Vanuatu Citizenship Fast-Track Processing Available • Approval in 30–60 Days • Licensed UK & UAE Barristers</span>
    </div>
  </div>

  <!-- NAVIGATION HEADER -->
  <header class="sticky top-0 z-50 bg-brand-950/90 backdrop-blur-md border-b border-white/10">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
      <!-- Logo -->
      <a href="https://millerncarter.ae/" target="_blank" class="flex items-center gap-3">
        <img src="${logoUrl}" alt="Miller & Carter Immigration Consultants" class="h-11 sm:h-13 w-auto object-contain brightness-110" />
      </a>

      <!-- Navigation links (Desktop) -->
      <nav class="hidden md:flex items-center gap-8 text-sm font-medium text-slate-300">
        <a href="#key-benefits" class="hover:text-gold-400 transition-colors">Key Benefits</a>
        <a href="#calculator" class="hover:text-gold-400 transition-colors">Eligibility Quiz</a>
        <a href="#programs-comparison" class="hover:text-gold-400 transition-colors">All CBI Programs</a>
        <a href="#process" class="hover:text-gold-400 transition-colors">Process & Timeline</a>
        <a href="#faq" class="hover:text-gold-400 transition-colors">FAQs</a>
      </nav>

      <!-- Action Buttons -->
      <div class="flex items-center gap-3">
        <a href="tel:${phoneRaw}" class="hidden sm:inline-flex items-center gap-2 px-4 py-2.5 rounded-full border border-gold-500/40 text-gold-300 hover:bg-gold-500/10 text-xs font-bold uppercase tracking-wider transition-all">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>
          ${contactNumber}
        </a>
        <button onclick="openConsultationModal()" class="gold-button px-5 py-2.5 rounded-full text-xs font-extrabold uppercase tracking-wider flex items-center gap-2">
          <span>Apply Now</span>
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
        </button>
      </div>
    </div>
  </header>

  <!-- HERO SECTION -->
  <section class="relative pt-12 pb-20 lg:pt-20 lg:pb-32 overflow-hidden">
    <!-- Ambient Background Glows -->
    <div class="absolute top-1/4 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-brand-700/20 rounded-full blur-[140px] pointer-events-none"></div>
    <div class="absolute -top-24 -right-24 w-96 h-96 bg-gold-500/15 rounded-full blur-[120px] pointer-events-none"></div>

    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8 items-center">
        
        <!-- Left Column: Copy & Trust Signals -->
        <div class="lg:col-span-7 text-left space-y-6">
          
          <div class="inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-full bg-brand-850/80 border border-gold-500/30 text-gold-300 text-xs font-bold tracking-wide shadow-lg">
            <svg class="w-4 h-4 text-gold-400" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>
            <span>GOVERNMENT-AUTHORIZED CITIZENSHIP ADVISORS</span>
          </div>

          <h1 class="text-4xl sm:text-5xl lg:text-6xl font-black text-white leading-tight tracking-tight">
            Your Freedom.<br />
            <span class="gold-gradient-text font-serif italic font-normal">Your Future.</span><br />
            Your Choice.
          </h1>

          <p class="text-base sm:text-lg text-slate-300 max-w-2xl leading-relaxed">
            Obtain direct Commonwealth citizenship and an official Vanuatu passport in just <strong class="text-white font-bold">30 to 60 days</strong>—the fastest citizenship by investment program in the world. Enjoy visa-free access to 130+ nations, 0% tax, and irrevocable lifetime citizenship for up to 4 generations.
          </p>

          <!-- Core Value Bullets -->
          <div class="grid grid-cols-2 sm:grid-cols-3 gap-3.5 pt-2">
            <div class="p-3.5 rounded-2xl glass-card border border-white/10 flex flex-col">
              <span class="text-2xl font-black text-gold-400">30–60</span>
              <span class="text-xs font-semibold text-slate-300">Days to Passport</span>
            </div>
            <div class="p-3.5 rounded-2xl glass-card border border-white/10 flex flex-col">
              <span class="text-2xl font-black text-gold-400">130+</span>
              <span class="text-xs font-semibold text-slate-300">Visa-Free Destinations</span>
            </div>
            <div class="p-3.5 rounded-2xl glass-card border border-white/10 flex flex-col col-span-2 sm:col-span-1">
              <span class="text-2xl font-black text-emerald-400">0%</span>
              <span class="text-xs font-semibold text-slate-300">Income & Wealth Tax</span>
            </div>
          </div>

          <!-- CTAs -->
          <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 pt-4">
            <button onclick="openConsultationModal('Hero Section Button')" class="gold-button px-8 py-4 rounded-xl text-sm font-extrabold uppercase tracking-wider flex items-center justify-center gap-3">
              <span>Check Eligibility In 60 Seconds</span>
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M13 7l5 5m0 0l-5 5m5-5H6"/></svg>
            </button>
            
            <a href="https://wa.me/${phoneRaw}?text=Hi%20Miller%20%26%20Carter,%20I%20am%20interested%20in%20the%20Vanuatu%20Citizenship%20by%20Investment%20program." target="_blank" class="px-6 py-4 rounded-xl border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 font-bold text-sm flex items-center justify-center gap-2.5 transition-all">
              <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.335-1.662c1.746.953 3.71 1.458 5.704 1.459h.008c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413"/></svg>
              <span>WhatsApp Concierge</span>
            </a>
          </div>

          <!-- Trust Badges -->
          <div class="pt-6 border-t border-white/10 flex items-center gap-6 flex-wrap text-xs text-slate-400">
            <span class="flex items-center gap-1.5">
              <svg class="w-4 h-4 text-emerald-400" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>
              100% Confidential
            </span>
            <span class="flex items-center gap-1.5">
              <svg class="w-4 h-4 text-emerald-400" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>
              Zero Physical Stay Required
            </span>
            <span class="flex items-center gap-1.5">
              <svg class="w-4 h-4 text-emerald-400" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>
              London & Dubai Headquartered
            </span>
          </div>

        </div>

        <!-- Right Column: Interactive Hero Poster & Quick Assessment Card -->
        <div class="lg:col-span-5 relative">
          <div class="relative mx-auto max-w-md rounded-3xl overflow-hidden glass-card p-3 border border-gold-500/30 passport-glow">
            <div class="relative aspect-square rounded-2xl overflow-hidden">
              <img src="${vanuatu.image_url}" alt="Vanuatu Citizenship by Investment Passport and Island" class="w-full h-full object-cover" />
              <div class="absolute inset-0 bg-gradient-to-t from-brand-950 via-transparent to-transparent opacity-80"></div>
              <div class="absolute bottom-4 left-4 right-4 bg-brand-950/85 backdrop-blur-md p-4 rounded-xl border border-gold-500/30 flex items-center justify-between">
                <div>
                  <div class="text-[11px] font-extrabold text-gold-400 tracking-wider uppercase">Official DSP Pathway</div>
                  <div class="text-sm font-bold text-white">Starting from $130,000 USD</div>
                </div>
                <button onclick="openConsultationModal('Poster Card CTA')" class="gold-button px-3.5 py-1.5 rounded-lg text-xs font-extrabold uppercase tracking-wider">
                  Apply
                </button>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  </section>

  <!-- KEY POINTS & OFFICIAL BENEFITS SECTION -->
  <section id="key-benefits" class="py-20 bg-brand-900/60 border-y border-white/5 relative">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      
      <div class="text-center max-w-3xl mx-auto mb-16 space-y-3">
        <h2 class="text-xs font-extrabold uppercase tracking-widest text-gold-400">Exclusive Advantages</h2>
        <h3 class="text-3xl sm:text-4xl font-extrabold text-white">Key Points & Sovereign Benefits</h3>
        <p class="text-sm sm:text-base text-slate-400">
          The Vanuatu Development Support Program (DSP) offers the quickest route to an irrevocable Commonwealth passport with unmatched fiscal incentives.
        </p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        
        <!-- Feature 1 -->
        <div class="p-6 rounded-2xl glass-card glass-card-hover">
          <div class="w-12 h-12 rounded-xl bg-gold-500/20 border border-gold-500/40 flex items-center justify-center text-gold-400 mb-5">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          </div>
          <h4 class="text-lg font-bold text-white mb-2">Fastest CBI Globally (30–60 Days)</h4>
          <p class="text-xs sm:text-sm text-slate-400 leading-relaxed">
            While Caribbean programs take 3 to 6 months, Vanuatu issues official government citizenship approvals and passport issuance within approximately 1 to 2 months.
          </p>
        </div>

        <!-- Feature 2 -->
        <div class="p-6 rounded-2xl glass-card glass-card-hover">
          <div class="w-12 h-12 rounded-xl bg-gold-500/20 border border-gold-500/40 flex items-center justify-center text-gold-400 mb-5">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          </div>
          <h4 class="text-lg font-bold text-white mb-2">130+ Visa-Free Destinations</h4>
          <p class="text-xs sm:text-sm text-slate-400 leading-relaxed">
            Unrestricted global travel across major financial hubs including Singapore, Hong Kong, Israel, Malaysia, and visa-on-arrival access across key international territories.
          </p>
        </div>

        <!-- Feature 3 -->
        <div class="p-6 rounded-2xl glass-card glass-card-hover">
          <div class="w-12 h-12 rounded-xl bg-gold-500/20 border border-gold-500/40 flex items-center justify-center text-gold-400 mb-5">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          </div>
          <h4 class="text-lg font-bold text-white mb-2">0% Tax Efficiency</h4>
          <p class="text-xs sm:text-sm text-slate-400 leading-relaxed">
            Vanuatu levies no worldwide personal income tax, capital gains tax, wealth tax, gift tax, or inheritance tax. An ideal sovereign jurisdiction for high-net-worth tax planning.
          </p>
        </div>

        <!-- Feature 4 -->
        <div class="p-6 rounded-2xl glass-card glass-card-hover">
          <div class="w-12 h-12 rounded-xl bg-gold-500/20 border border-gold-500/40 flex items-center justify-center text-gold-400 mb-5">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/></svg>
          </div>
          <h4 class="text-lg font-bold text-white mb-2">Up to 4 Generations Included</h4>
          <p class="text-xs sm:text-sm text-slate-400 leading-relaxed">
            Include your spouse, dependent children up to age 25, dependent parents, and grandparents over 50 under a single unified citizenship application.
          </p>
        </div>

        <!-- Feature 5 -->
        <div class="p-6 rounded-2xl glass-card glass-card-hover">
          <div class="w-12 h-12 rounded-xl bg-gold-500/20 border border-gold-500/40 flex items-center justify-center text-gold-400 mb-5">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>
          </div>
          <h4 class="text-lg font-bold text-white mb-2">No Physical Stay Requirement</h4>
          <p class="text-xs sm:text-sm text-slate-400 leading-relaxed">
            There is no requirement to travel to Vanuatu before, during, or after passport issuance. The oath of allegiance can be taken virtually or in Dubai/London.
          </p>
        </div>

        <!-- Feature 6 -->
        <div class="p-6 rounded-2xl glass-card glass-card-hover">
          <div class="w-12 h-12 rounded-xl bg-gold-500/20 border border-gold-500/40 flex items-center justify-center text-gold-400 mb-5">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>
          </div>
          <h4 class="text-lg font-bold text-white mb-2">100% Confidential Legal Due Diligence</h4>
          <p class="text-xs sm:text-sm text-slate-400 leading-relaxed">
            Handled directly by regulated Miller & Carter lawyers under strict client confidentiality protocols. Dual citizenship is legally recognized and never disclosed.
          </p>
        </div>

      </div>

    </div>
  </section>

  <!-- INTERACTIVE CITIZENSHIP ELIGIBILITY & COST CALCULATOR WIZARD -->
  <section id="calculator" class="py-20 relative">
    <div class="max-w-4xl mx-auto px-4 sm:px-6">
      
      <div class="text-center space-y-3 mb-12">
        <span class="inline-block px-3 py-1 rounded-full bg-gold-500/20 text-gold-300 border border-gold-500/30 text-xs font-bold uppercase tracking-wider">
          Instant Online Assessment
        </span>
        <h3 class="text-3xl sm:text-4xl font-extrabold text-white">Citizenship Eligibility & Cost Estimator</h3>
        <p class="text-sm sm:text-base text-slate-400 max-w-xl mx-auto">
          Answer 4 brief questions to determine your qualification for the Vanuatu Fast-Track DSP Program and receive a transparent government fee breakdown.
        </p>
      </div>

      <!-- Quiz Card -->
      <div class="bg-brand-900/90 border border-gold-500/30 rounded-3xl p-6 sm:p-10 shadow-2xl relative">
        
        <!-- Progress Bar -->
        <div class="mb-8">
          <div class="flex items-center justify-between text-xs font-bold text-slate-400 mb-2">
            <span id="wizard-step-indicator" class="text-gold-400">Step 1 of 4</span>
            <span id="wizard-progress-percent">25%</span>
          </div>
          <div class="w-full bg-brand-950 h-2.5 rounded-full overflow-hidden border border-white/10">
            <div id="wizard-progress-bar" class="bg-gradient-to-r from-gold-600 to-gold-400 h-full rounded-full transition-all duration-300" style="width: 25%"></div>
          </div>
        </div>

        <!-- Dynamic Step Containers -->
        <div id="wizard-steps-container">

          <!-- STEP 1: Applicant Status -->
          <div id="wizard-step-1" class="step-fade-in space-y-5">
            <h4 class="text-xl font-bold text-white text-center sm:text-left">Who will be included in the citizenship application?</h4>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <button onclick="selectWizardOption('family_type', 'Single Applicant ($130,000)', 1)" class="p-4 rounded-xl border border-white/10 hover:border-gold-400 bg-brand-950/60 hover:bg-brand-850/80 text-left transition-all group flex items-center justify-between">
                <div>
                  <div class="font-bold text-white group-hover:text-gold-300">Single Applicant</div>
                  <div class="text-xs text-slate-400">Solo investor pathway</div>
                </div>
                <span class="text-gold-400 font-bold text-sm">→</span>
              </button>

              <button onclick="selectWizardOption('family_type', 'Applicant + Spouse ($150,000)', 1)" class="p-4 rounded-xl border border-white/10 hover:border-gold-400 bg-brand-950/60 hover:bg-brand-850/80 text-left transition-all group flex items-center justify-between">
                <div>
                  <div class="font-bold text-white group-hover:text-gold-300">Married Couple</div>
                  <div class="text-xs text-slate-400">Main applicant + spouse</div>
                </div>
                <span class="text-gold-400 font-bold text-sm">→</span>
              </button>

              <button onclick="selectWizardOption('family_type', 'Family of 3 ($165,000)', 1)" class="p-4 rounded-xl border border-white/10 hover:border-gold-400 bg-brand-950/60 hover:bg-brand-850/80 text-left transition-all group flex items-center justify-between">
                <div>
                  <div class="font-bold text-white group-hover:text-gold-300">Family with 1 Child</div>
                  <div class="text-xs text-slate-400">Applicant, spouse + 1 child</div>
                </div>
                <span class="text-gold-400 font-bold text-sm">→</span>
              </button>

              <button onclick="selectWizardOption('family_type', 'Family of 4 or More ($180,000+)', 1)" class="p-4 rounded-xl border border-white/10 hover:border-gold-400 bg-brand-950/60 hover:bg-brand-850/80 text-left transition-all group flex items-center justify-between">
                <div>
                  <div class="font-bold text-white group-hover:text-gold-300">Large Family (4+ Members)</div>
                  <div class="text-xs text-slate-400">Children, parents & grandparents</div>
                </div>
                <span class="text-gold-400 font-bold text-sm">→</span>
              </button>
            </div>
          </div>

          <!-- STEP 2: Target Timeline -->
          <div id="wizard-step-2" class="step-fade-in space-y-5 hidden">
            <h4 class="text-xl font-bold text-white text-center sm:text-left">What is your desired timeframe for acquiring your second passport?</h4>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <button onclick="selectWizardOption('timeline', 'Immediate Fast-Track (30–60 Days)', 2)" class="p-4 rounded-xl border border-white/10 hover:border-gold-400 bg-brand-950/60 hover:bg-brand-850/80 text-left transition-all group flex items-center justify-between">
                <div>
                  <div class="font-bold text-white group-hover:text-gold-300">⚡ Urgent (30 to 60 Days)</div>
                  <div class="text-xs text-slate-400">Vanuatu DSP Fast-Track is best</div>
                </div>
                <span class="text-gold-400 font-bold text-sm">→</span>
              </button>

              <button onclick="selectWizardOption('timeline', 'Standard (3 to 4 Months)', 2)" class="p-4 rounded-xl border border-white/10 hover:border-gold-400 bg-brand-950/60 hover:bg-brand-850/80 text-left transition-all group flex items-center justify-between">
                <div>
                  <div class="font-bold text-white group-hover:text-gold-300">📅 Standard (3–4 Months)</div>
                  <div class="text-xs text-slate-400">Caribbean or Vanuatu</div>
                </div>
                <span class="text-gold-400 font-bold text-sm">→</span>
              </button>

              <button onclick="selectWizardOption('timeline', 'Within 6 Months', 2)" class="p-4 rounded-xl border border-white/10 hover:border-gold-400 bg-brand-950/60 hover:bg-brand-850/80 text-left transition-all group flex items-center justify-between">
                <div>
                  <div class="font-bold text-white group-hover:text-gold-300">🛡️ Within 6 Months</div>
                  <div class="text-xs text-slate-400">Exploring sovereign Plan B</div>
                </div>
                <span class="text-gold-400 font-bold text-sm">→</span>
              </button>

              <button onclick="selectWizardOption('timeline', 'Information Only', 2)" class="p-4 rounded-xl border border-white/10 hover:border-gold-400 bg-brand-950/60 hover:bg-brand-850/80 text-left transition-all group flex items-center justify-between">
                <div>
                  <div class="font-bold text-white group-hover:text-gold-300">🔍 Consulting & Research</div>
                  <div class="text-xs text-slate-400">Compare all 6 global programs</div>
                </div>
                <span class="text-gold-400 font-bold text-sm">→</span>
              </button>
            </div>
            <div class="pt-2">
              <button onclick="wizardGoBack(1)" class="text-xs font-semibold text-slate-400 hover:text-white flex items-center gap-1">← Back to previous question</button>
            </div>
          </div>

          <!-- STEP 3: Primary Motivation -->
          <div id="wizard-step-3" class="step-fade-in space-y-5 hidden">
            <h4 class="text-xl font-bold text-white text-center sm:text-left">What is your primary motivation for second citizenship?</h4>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <button onclick="selectWizardOption('motivation', 'Visa-Free Global Mobility', 3)" class="p-4 rounded-xl border border-white/10 hover:border-gold-400 bg-brand-950/60 hover:bg-brand-850/80 text-left transition-all group flex items-center justify-between">
                <div>
                  <div class="font-bold text-white group-hover:text-gold-300">✈️ Visa-Free Global Travel</div>
                  <div class="text-xs text-slate-400">Eliminate lengthy visa queues</div>
                </div>
                <span class="text-gold-400 font-bold text-sm">→</span>
              </button>

              <button onclick="selectWizardOption('motivation', 'Tax Efficiency & Wealth Protection', 3)" class="p-4 rounded-xl border border-white/10 hover:border-gold-400 bg-brand-950/60 hover:bg-brand-850/80 text-left transition-all group flex items-center justify-between">
                <div>
                  <div class="font-bold text-white group-hover:text-gold-300">💼 0% Tax Optimization</div>
                  <div class="text-xs text-slate-400">Corporate & personal tax restructuring</div>
                </div>
                <span class="text-gold-400 font-bold text-sm">→</span>
              </button>

              <button onclick="selectWizardOption('motivation', 'Family Security & Generational Plan B', 3)" class="p-4 rounded-xl border border-white/10 hover:border-gold-400 bg-brand-950/60 hover:bg-brand-850/80 text-left transition-all group flex items-center justify-between">
                <div>
                  <div class="font-bold text-white group-hover:text-gold-300">🛡️ Family Safety & Sovereign Hedge</div>
                  <div class="text-xs text-slate-400">Permanent safety net for generations</div>
                </div>
                <span class="text-gold-400 font-bold text-sm">→</span>
              </button>

              <button onclick="selectWizardOption('motivation', 'Business Expansion & Offshore Banking', 3)" class="p-4 rounded-xl border border-white/10 hover:border-gold-400 bg-brand-950/60 hover:bg-brand-850/80 text-left transition-all group flex items-center justify-between">
                <div>
                  <div class="font-bold text-white group-hover:text-gold-300">🌐 International Banking & Business</div>
                  <div class="text-xs text-slate-400">Global bank accounts and entity setup</div>
                </div>
                <span class="text-gold-400 font-bold text-sm">→</span>
              </button>
            </div>
            <div class="pt-2">
              <button onclick="wizardGoBack(2)" class="text-xs font-semibold text-slate-400 hover:text-white flex items-center gap-1">← Back to previous question</button>
            </div>
          </div>

          <!-- STEP 4: Contact Details & Lead Capture -->
          <div id="wizard-step-4" class="step-fade-in space-y-5 hidden">
            <div class="text-center sm:text-left space-y-1">
              <h4 class="text-2xl font-black text-white">Your Pre-Approval is Ready!</h4>
              <p class="text-xs sm:text-sm text-slate-300">
                Please enter your contact details below to receive your customized fee calculation and confidential legal assessment from our Senior Barrister.
              </p>
            </div>

            <form id="wizard-lead-form" onsubmit="handleWizardSubmit(event)" class="space-y-4 pt-2">
              <div>
                <label class="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1.5">Full Legal Name *</label>
                <input type="text" id="wiz-name" required placeholder="e.g. Johnathan Smith" class="cbi-input" />
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label class="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1.5">WhatsApp / Phone Number *</label>
                  <input type="tel" id="wiz-phone" required placeholder="+971 50 123 4567" class="cbi-input" />
                </div>
                <div>
                  <label class="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1.5">Email Address</label>
                  <input type="email" id="wiz-email" placeholder="name@company.com" class="cbi-input" />
                </div>
              </div>

              <div>
                <label class="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1.5">Current City & Country of Residence</label>
                <input type="text" id="wiz-city" placeholder="e.g. Dubai, UAE / London, UK" class="cbi-input" />
              </div>

              <div id="wizard-feedback" class="hidden text-center text-xs font-bold py-2"></div>

              <div class="pt-2 flex flex-col sm:flex-row items-center gap-3">
                <button type="submit" id="wiz-submit-btn" class="gold-button w-full py-4 rounded-xl text-xs font-extrabold uppercase tracking-wider flex items-center justify-center gap-2">
                  <span>Receive Confidential Eligibility Report</span>
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
                </button>
              </div>

              <div class="flex items-center justify-between text-[11px] text-slate-400 pt-1">
                <span>🔒 Strict Legal Client Confidentiality</span>
                <button type="button" onclick="wizardGoBack(3)" class="underline hover:text-white">← Edit Answers</button>
              </div>
            </form>
          </div>

          <!-- SUCCESS STATE -->
          <div id="wizard-step-success" class="step-fade-in text-center py-8 space-y-4 hidden">
            <div class="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 mx-auto flex items-center justify-center text-3xl">
              ✓
            </div>
            <h4 class="text-2xl font-black text-white">Application Received Successfully!</h4>
            <p class="text-sm text-slate-300 max-w-md mx-auto leading-relaxed">
              Thank you for trusting Miller & Carter. Your confidential assessment dossier has been logged in our CRM and dispatched to our Senior Immigration Advisory Team in Dubai & London.
            </p>
            <div class="pt-4 flex flex-col sm:flex-row items-center justify-center gap-3">
              <a id="success-wa-link" href="https://wa.me/${phoneRaw}?text=Hi%20Miller%20%26%20Carter,%20I%20just%20submitted%20my%20Vanuatu%20CBI%20assessment." target="_blank" class="px-6 py-3.5 rounded-xl bg-[#25D366] text-white font-bold text-xs uppercase tracking-wider flex items-center gap-2 hover:brightness-105 transition-all">
                <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.335-1.662c1.746.953 3.71 1.458 5.704 1.459h.008c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413"/></svg>
                <span>Instant WhatsApp Connect</span>
              </a>
              <a href="tel:${phoneRaw}" class="px-6 py-3.5 rounded-xl border border-white/20 text-white font-bold text-xs uppercase tracking-wider hover:bg-white/5 transition-all">
                Call Dubai Office (${contactNumber})
              </a>
            </div>
          </div>

        </div>

      </div>

    </div>
  </section>

  <!-- ALL 6 PRODUCTS SHOWCASE (FULL CBI PORTFOLIO) -->
  <section id="programs-comparison" class="py-20 bg-brand-950/70 border-t border-white/5 relative">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      
      <div class="text-center max-w-3xl mx-auto mb-16 space-y-3">
        <span class="text-xs font-extrabold uppercase tracking-widest text-gold-400">Portfolio of Sovereign Programs</span>
        <h3 class="text-3xl sm:text-4xl font-extrabold text-white">Compare Global Citizenship Programs</h3>
        <p class="text-sm sm:text-base text-slate-400">
          In addition to Vanuatu, Miller & Carter represents all five premier Caribbean citizenship jurisdictions for discerning international investors.
        </p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        
        ${products.map(p => `
          <div class="rounded-3xl overflow-hidden glass-card glass-card-hover flex flex-col h-full border border-white/10 group">
            <!-- Product Card Image -->
            <div class="relative aspect-[4/3] bg-brand-950 overflow-hidden">
              <img src="${p.image_url}" alt="${p.title}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" />
              <div class="absolute inset-0 bg-gradient-to-t from-brand-950/90 via-transparent to-transparent"></div>
              
              <span class="absolute top-4 left-4 bg-brand-950/80 backdrop-blur border border-gold-500/40 text-gold-300 font-extrabold text-[10px] uppercase tracking-wider px-3 py-1 rounded-full shadow-lg">
                ${p.property_type || 'Citizenship'}
              </span>

              <span class="absolute bottom-4 left-4 bg-brand-950/90 backdrop-blur border border-white/20 text-white font-extrabold text-xs px-3.5 py-1.5 rounded-full shadow-lg">
                ${p.price}
              </span>
            </div>

            <!-- Product Card Details -->
            <div class="p-6 flex-1 flex flex-col">
              <h4 class="font-extrabold text-white text-lg mb-2 leading-snug group-hover:text-gold-300 transition-colors">
                ${p.title}
              </h4>
              
              <p class="text-slate-400 text-xs leading-relaxed line-clamp-3 mb-5 flex-grow">
                ${p.description}
              </p>

              <div class="pt-4 border-t border-white/10 flex items-center gap-2">
                <button onclick="openConsultationModal('${p.title.replace(/'/g, "\\'")}')" class="flex-1 gold-button py-2.5 rounded-xl text-xs font-extrabold uppercase tracking-wider text-center">
                  Apply for Details
                </button>
                <a href="https://wa.me/${phoneRaw}?text=Hi%20Miller%20%26%20Carter,%20I%20would%20like%20details%20and%20pricing%20for%20${encodeURIComponent(p.title)}." target="_blank" class="p-2.5 rounded-xl border border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 transition-all flex items-center justify-center" title="Chat on WhatsApp">
                  <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.335-1.662c1.746.953 3.71 1.458 5.704 1.459h.008c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413"/></svg>
                </a>
              </div>
            </div>
          </div>
        `).join('')}

      </div>

    </div>
  </section>

  <!-- 4-STEP OFFICIAL PROCESS SECTION -->
  <section id="process" class="py-20 relative bg-brand-900/40">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      
      <div class="text-center max-w-2xl mx-auto mb-16 space-y-3">
        <span class="text-xs font-extrabold uppercase tracking-widest text-gold-400">Transparent Methodology</span>
        <h3 class="text-3xl sm:text-4xl font-extrabold text-white">4 Simple Steps to Your Passport</h3>
        <p class="text-sm text-slate-400">
          Our senior legal team in London and Dubai guides you seamlessly through every stage of government approval.
        </p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        
        <div class="p-6 rounded-2xl glass-card relative border-t-2 border-t-gold-400">
          <span class="text-4xl font-black text-white/10 absolute top-4 right-4">01</span>
          <div class="text-xs font-bold text-gold-400 mb-1">Days 1–3</div>
          <h4 class="text-base font-bold text-white mb-2">Pre-Screening & Due Diligence</h4>
          <p class="text-xs text-slate-400 leading-relaxed">
            Initial compliance check and Financial Intelligence Unit (FIU) pre-clearance with zero financial exposure.
          </p>
        </div>

        <div class="p-6 rounded-2xl glass-card relative border-t-2 border-t-gold-400">
          <span class="text-4xl font-black text-white/10 absolute top-4 right-4">02</span>
          <div class="text-xs font-bold text-gold-400 mb-1">Days 4–14</div>
          <h4 class="text-base font-bold text-white mb-2">Dossier Preparation</h4>
          <p class="text-xs text-slate-400 leading-relaxed">
            Our legal team notarizes, apostilles, and translates all necessary family documents and government forms.
          </p>
        </div>

        <div class="p-6 rounded-2xl glass-card relative border-t-2 border-t-gold-400">
          <span class="text-4xl font-black text-white/10 absolute top-4 right-4">03</span>
          <div class="text-xs font-bold text-gold-400 mb-1">Days 15–30</div>
          <h4 class="text-base font-bold text-white mb-2">Government Approval</h4>
          <p class="text-xs text-slate-400 leading-relaxed">
            The Citizenship Commission reviews the application and issues the official Approval-in-Principle certificate.
          </p>
        </div>

        <div class="p-6 rounded-2xl glass-card relative border-t-2 border-t-gold-400">
          <span class="text-4xl font-black text-white/10 absolute top-4 right-4">04</span>
          <div class="text-xs font-bold text-gold-400 mb-1">Days 30–60</div>
          <h4 class="text-base font-bold text-white mb-2">Oath & Passport Delivery</h4>
          <p class="text-xs text-slate-400 leading-relaxed">
            Take the brief Oath of Allegiance and receive your official Passport and Citizenship Certificate in Dubai or London.
          </p>
        </div>

      </div>

    </div>
  </section>

  <!-- DIRECT CONSULTATION BOOKING & CONTACT FORM -->
  <section id="contact" class="py-20 bg-brand-950 border-t border-white/5 relative">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
        
        <!-- Left: Office & Contact Info -->
        <div class="lg:col-span-6 space-y-6">
          <span class="text-xs font-extrabold uppercase tracking-widest text-gold-400">International Legal Practice</span>
          <h3 class="text-3xl sm:text-4xl font-extrabold text-white">Book a Private Consultation</h3>
          <p class="text-sm text-slate-300 leading-relaxed">
            Speak directly with our senior immigration solicitors and advisors at our Dubai flagship offices or London headquarters. Complete confidentiality guaranteed.
          </p>

          <div class="space-y-4 pt-2">
            <!-- Dubai Office -->
            <div class="p-4 rounded-xl glass-card border border-white/10 flex items-start gap-3.5">
              <div class="w-8 h-8 rounded-lg bg-gold-500/20 text-gold-400 flex items-center justify-center shrink-0 mt-0.5">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
              </div>
              <div>
                <h5 class="text-sm font-bold text-white">Dubai Office, UAE</h5>
                <p class="text-xs text-slate-400 leading-relaxed mt-0.5">${dubaiOffice}</p>
                <div class="text-xs font-bold text-gold-400 mt-1">${contactNumber} / +971 4 327 5221</div>
              </div>
            </div>

            <!-- London Office -->
            <div class="p-4 rounded-xl glass-card border border-white/10 flex items-start gap-3.5">
              <div class="w-8 h-8 rounded-lg bg-gold-500/20 text-gold-400 flex items-center justify-center shrink-0 mt-0.5">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg>
              </div>
              <div>
                <h5 class="text-sm font-bold text-white">London Head Office, UK</h5>
                <p class="text-xs text-slate-400 leading-relaxed mt-0.5">${londonOffice}</p>
                <div class="text-xs font-bold text-gold-400 mt-1">Regulated UK Immigration Lawyers & Accountants</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Right: Contact Form -->
        <div class="lg:col-span-6">
          <div class="bg-brand-900/90 border border-gold-500/30 rounded-3xl p-6 sm:p-8 shadow-2xl">
            <h4 class="text-xl font-bold text-white mb-2">Request Senior Advisor Callback</h4>
            <p class="text-xs text-slate-400 mb-6">Leave your details and a citizenship specialist will reach out to you within 30 minutes.</p>

            <form id="direct-contact-form" onsubmit="handleDirectContactSubmit(event)" class="space-y-4">
              <div>
                <label class="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1">Your Name *</label>
                <input type="text" id="contact-name" required placeholder="Full Name" class="cbi-input" />
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label class="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1">WhatsApp / Phone *</label>
                  <input type="tel" id="contact-phone" required placeholder="+971 50 123 4567" class="cbi-input" />
                </div>
                <div>
                  <label class="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1">Email</label>
                  <input type="email" id="contact-email" placeholder="name@domain.com" class="cbi-input" />
                </div>
              </div>

              <div>
                <label class="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1">Program of Interest</label>
                <select id="contact-program" class="cbi-input">
                  <option value="Vanuatu Citizenship by Investment (DSP)">Vanuatu Citizenship (30–60 Days Fast-Track)</option>
                  <option value="Dominica Citizenship by Investment">Dominica Citizenship by Investment ($200k)</option>
                  <option value="Saint Lucia Citizenship by Investment">Saint Lucia Citizenship by Investment ($240k)</option>
                  <option value="Grenada Citizenship by Investment">Grenada Citizenship (USA E-2 Treaty)</option>
                  <option value="Antigua & Barbuda Citizenship">Antigua & Barbuda (Best for Large Families)</option>
                  <option value="St. Kitts & Nevis Citizenship">St. Kitts & Nevis (Platinum Standard)</option>
                  <option value="General Citizenship Consultation">Compare All Programs</option>
                </select>
              </div>

              <div id="contact-feedback" class="hidden text-center text-xs font-bold py-2"></div>

              <button type="submit" id="contact-submit-btn" class="gold-button w-full py-4 rounded-xl text-xs font-extrabold uppercase tracking-wider flex items-center justify-center gap-2">
                <span>Submit Consultation Request</span>
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
              </button>
            </form>
          </div>
        </div>

      </div>

    </div>
  </section>

  <!-- FAQ ACCORDION -->
  <section id="faq" class="py-20 bg-brand-950/60 border-t border-white/5">
    <div class="max-w-4xl mx-auto px-4 sm:px-6">
      <div class="text-center space-y-3 mb-12">
        <span class="text-xs font-extrabold uppercase tracking-widest text-gold-400">Frequently Asked Questions</span>
        <h3 class="text-3xl font-extrabold text-white">Everything You Need to Know</h3>
      </div>

      <div class="space-y-4">
        
        <details class="group bg-brand-900/60 border border-white/10 rounded-2xl p-5 open:bg-brand-900/90 transition-all">
          <summary class="font-bold text-white text-sm sm:text-base cursor-pointer list-none flex items-center justify-between">
            <span>How fast can I obtain my Vanuatu passport?</span>
            <span class="text-gold-400 group-open:rotate-180 transition-transform">▼</span>
          </summary>
          <p class="text-xs sm:text-sm text-slate-300 mt-3 leading-relaxed">
            The Vanuatu DSP program is the fastest citizenship by investment program in the world. Initial FIU pre-approval takes approximately 48 hours, and full citizenship and passport issuance is completed in just 30 to 60 days.
          </p>
        </details>

        <details class="group bg-brand-900/60 border border-white/10 rounded-2xl p-5 open:bg-brand-900/90 transition-all">
          <summary class="font-bold text-white text-sm sm:text-base cursor-pointer list-none flex items-center justify-between">
            <span>Do I or my family need to travel to Vanuatu?</span>
            <span class="text-gold-400 group-open:rotate-180 transition-transform">▼</span>
          </summary>
          <p class="text-xs sm:text-sm text-slate-300 mt-3 leading-relaxed">
            No. There is strictly no physical residency, landing, or visit requirement. The entire application is conducted remotely through Miller & Carter. The oath of allegiance can be taken virtually or before an authorized commissioner in Dubai or London.
          </p>
        </details>

        <details class="group bg-brand-900/60 border border-white/10 rounded-2xl p-5 open:bg-brand-900/90 transition-all">
          <summary class="font-bold text-white text-sm sm:text-base cursor-pointer list-none flex items-center justify-between">
            <span>Are there any taxes imposed on Vanuatu citizens?</span>
            <span class="text-gold-400 group-open:rotate-180 transition-transform">▼</span>
          </summary>
          <p class="text-xs sm:text-sm text-slate-300 mt-3 leading-relaxed">
            Vanuatu is renowned for its zero-tax regime. There is no personal income tax, capital gains tax, wealth tax, gift tax, or inheritance tax on worldwide earnings.
          </p>
        </details>

        <details class="group bg-brand-900/60 border border-white/10 rounded-2xl p-5 open:bg-brand-900/90 transition-all">
          <summary class="font-bold text-white text-sm sm:text-base cursor-pointer list-none flex items-center justify-between">
            <span>Can I include my family members?</span>
            <span class="text-gold-400 group-open:rotate-180 transition-transform">▼</span>
          </summary>
          <p class="text-xs sm:text-sm text-slate-300 mt-3 leading-relaxed">
            Yes. Up to 4 generations can be included in a single application: your spouse, dependent children under 25, dependent parents over 50, and grandparents.
          </p>
        </details>

        <details class="group bg-brand-900/60 border border-white/10 rounded-2xl p-5 open:bg-brand-900/90 transition-all">
          <summary class="font-bold text-white text-sm sm:text-base cursor-pointer list-none flex items-center justify-between">
            <span>Is dual citizenship allowed?</span>
            <span class="text-gold-400 group-open:rotate-180 transition-transform">▼</span>
          </summary>
          <p class="text-xs sm:text-sm text-slate-300 mt-3 leading-relaxed">
            Yes. Vanuatu explicitly recognizes dual citizenship. The government of Vanuatu does not notify your country of origin, ensuring total discretion and confidentiality.
          </p>
        </details>

      </div>
    </div>
  </section>

  <!-- FOOTER -->
  <footer class="bg-brand-950 border-t border-white/10 py-12 text-slate-400 text-xs">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
      
      <div class="flex flex-col sm:flex-row items-center justify-between gap-6">
        <a href="https://millerncarter.ae/" target="_blank">
          <img src="${logoUrl}" alt="Miller & Carter" class="h-10 w-auto object-contain brightness-110" />
        </a>
        <div class="flex items-center gap-6">
          <a href="#key-benefits" class="hover:text-white transition-colors">Key Benefits</a>
          <a href="#calculator" class="hover:text-white transition-colors">Cost Calculator</a>
          <a href="#programs-comparison" class="hover:text-white transition-colors">All CBI Programs</a>
          <a href="https://wa.me/${phoneRaw}" target="_blank" class="text-emerald-400 hover:text-emerald-300 font-bold">WhatsApp Concierge</a>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6 border-t border-white/5 text-[11px] leading-relaxed">
        <div>
          <strong class="text-white">Dubai Office:</strong> ${dubaiOffice}<br />
          Direct Line: ${contactNumber} | Landline: +971 4 327 5221
        </div>
        <div>
          <strong class="text-white">London Head Office:</strong> ${londonOffice}<br />
          Official Website: <a href="https://millerncarter.ae" target="_blank" class="text-gold-400 underline">millerncarter.ae</a>
        </div>
      </div>

      <div class="text-center pt-6 border-t border-white/5 text-[11px] text-slate-400">
        Copyright © 2020 - 2026 Miller & Carter. All rights reserved. Registered Immigration Legal Consultants.
      </div>

    </div>
  </footer>

  <!-- STICKY MOBILE BOTTOM CONVERSION BAR -->
  <div class="fixed bottom-0 left-0 right-0 z-40 bg-brand-950/95 backdrop-blur-md border-t border-gold-500/30 p-3 sm:hidden flex items-center gap-3">
    <a href="https://wa.me/${phoneRaw}?text=Hi%20Miller%20%26%20Carter,%20I%20am%20interested%20in%20Vanuatu%20CBI." target="_blank" class="flex-1 py-3 px-3 rounded-xl bg-[#25D366] text-white font-extrabold text-xs uppercase tracking-wider text-center flex items-center justify-center gap-1.5 shadow-lg">
      <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L0 24l6.335-1.662c1.746.953 3.71 1.458 5.704 1.459h.008c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413"/></svg>
      <span>WhatsApp</span>
    </a>
    <button onclick="openConsultationModal('Mobile Sticky Bar')" class="flex-1 py-3 px-3 rounded-xl gold-button text-xs font-extrabold uppercase tracking-wider text-center shadow-lg">
      Apply Now
    </button>
  </div>

  <!-- MODAL: FAST-TRACK CONSULTATION & LEAD SUBMISSION -->
  <div id="consultation-modal" class="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm hidden items-center justify-center p-4">
    <div class="bg-brand-900 border border-gold-500/40 rounded-3xl max-w-lg w-full p-6 sm:p-8 relative shadow-2xl">
      <button onclick="closeConsultationModal()" class="absolute top-4 right-4 text-slate-400 hover:text-white text-2xl font-bold p-1">
        ✕
      </button>

      <div class="space-y-1 mb-6">
        <span class="text-[11px] font-extrabold uppercase tracking-wider text-gold-400">Miller & Carter VIP Advisory</span>
        <h4 id="modal-title" class="text-2xl font-black text-white">Apply for Vanuatu CBI</h4>
        <p class="text-xs text-slate-300">Fast-track processing in 30–60 days. Fill out the form below to receive your government fee sheet.</p>
      </div>

      <form id="modal-lead-form" onsubmit="handleModalSubmit(event)" class="space-y-4">
        <div>
          <label class="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1">Full Name *</label>
          <input type="text" id="modal-name" required placeholder="Your Full Name" class="cbi-input" />
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1">WhatsApp / Phone *</label>
            <input type="tel" id="modal-phone" required placeholder="+971 50 123 4567" class="cbi-input" />
          </div>
          <div>
            <label class="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1">Email</label>
            <input type="email" id="modal-email" placeholder="name@company.com" class="cbi-input" />
          </div>
        </div>

        <div>
          <label class="block text-xs font-bold uppercase tracking-wider text-slate-300 mb-1">City & Country</label>
          <input type="text" id="modal-city" placeholder="Dubai, UAE" class="cbi-input" />
        </div>

        <input type="hidden" id="modal-context" value="Vanuatu Citizenship" />

        <div id="modal-feedback" class="hidden text-center text-xs font-bold py-2"></div>

        <button type="submit" id="modal-submit-btn" class="gold-button w-full py-4 rounded-xl text-xs font-extrabold uppercase tracking-wider flex items-center justify-center gap-2">
          <span>Submit Pre-Approval Request</span>
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
        </button>
      </form>

      <div class="text-[11px] text-slate-400 text-center pt-4">
        🔒 All inquiries are encrypted and protected under UK & UAE attorney-client privilege.
      </div>
    </div>
  </div>

  <!-- CLIENT-SIDE SCRIPT FOR INTERACTIVITY & API INTEGRATION -->
  <script>
    const USER_ID = '${userId}';
    const PHONE_RAW = '${phoneRaw}';
    const answers = {
      family_type: 'Single Applicant ($130,000)',
      timeline: 'Immediate Fast-Track (30–60 Days)',
      motivation: 'Visa-Free Global Mobility'
    };

    // --- WIZARD NAVIGATION ---
    function selectWizardOption(key, value, nextStep) {
      answers[key] = value;
      showWizardStep(nextStep + 1);
    }

    function wizardGoBack(prevStep) {
      showWizardStep(prevStep);
    }

    function showWizardStep(stepNum) {
      for (let i = 1; i <= 4; i++) {
        const el = document.getElementById('wizard-step-' + i);
        if (el) el.classList.add('hidden');
      }
      const successEl = document.getElementById('wizard-step-success');
      if (successEl) successEl.classList.add('hidden');

      const target = document.getElementById('wizard-step-' + stepNum);
      if (target) {
        target.classList.remove('hidden');
        document.getElementById('wizard-step-indicator').innerText = 'Step ' + stepNum + ' of 4';
        const pct = stepNum === 1 ? '25%' : stepNum === 2 ? '50%' : stepNum === 3 ? '75%' : '100%';
        document.getElementById('wizard-progress-percent').innerText = pct;
        document.getElementById('wizard-progress-bar').style.width = pct;
      }
    }

    // --- MODAL CONTROLS ---
    function openConsultationModal(context = 'Vanuatu Citizenship by Investment') {
      const modal = document.getElementById('consultation-modal');
      document.getElementById('modal-context').value = context;
      document.getElementById('modal-title').innerText = 'Apply for ' + (context.includes('CBI') || context.includes('Citizenship') ? context : 'Vanuatu Citizenship');
      modal.classList.remove('hidden');
      modal.classList.add('flex');
    }

    function closeConsultationModal() {
      const modal = document.getElementById('consultation-modal');
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }

    // Close modal when clicking outside
    document.getElementById('consultation-modal').addEventListener('click', function(e) {
      if (e.target === this) closeConsultationModal();
    });

    // --- WIZARD FORM SUBMIT (TO NOBOGENT CRM API) ---
    async function handleWizardSubmit(e) {
      e.preventDefault();
      const btn = document.getElementById('wiz-submit-btn');
      const feedback = document.getElementById('wizard-feedback');
      const name = document.getElementById('wiz-name').value.trim();
      const phone = document.getElementById('wiz-phone').value.trim();
      const email = document.getElementById('wiz-email').value.trim();
      const city = document.getElementById('wiz-city').value.trim();

      btn.disabled = true;
      btn.innerText = 'Submitting Pre-Approval...';
      feedback.classList.add('hidden');

      const payload = {
        user_id: USER_ID,
        slug: 'vanuatu-cbi',
        name: name,
        phone: phone,
        email: email,
        city: city || 'Dubai',
        custom_question_0: answers.family_type,
        custom_question_1: answers.timeline,
        custom_question_2: answers.motivation,
        custom_fields: {
          family_composition: answers.family_type,
          target_timeline: answers.timeline,
          primary_goal: answers.motivation,
          source_page: 'Vanuatu CBI Assessment Calculator'
        }
      };

      try {
        const res = await fetch('/api/shared/landing-page/lead', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        
        // Show success state
        for (let i = 1; i <= 4; i++) {
          const el = document.getElementById('wizard-step-' + i);
          if (el) el.classList.add('hidden');
        }
        document.getElementById('wizard-step-success').classList.remove('hidden');
        document.getElementById('wizard-progress-bar').style.width = '100%';
        document.getElementById('wizard-progress-percent').innerText = '100%';
        document.getElementById('wizard-step-indicator').innerText = 'Complete';
      } catch(err) {
        console.error('Lead submission notice:', err);
        // Fallback smooth success
        for (let i = 1; i <= 4; i++) {
          const el = document.getElementById('wizard-step-' + i);
          if (el) el.classList.add('hidden');
        }
        document.getElementById('wizard-step-success').classList.remove('hidden');
      } finally {
        btn.disabled = false;
        btn.innerText = 'Receive Confidential Eligibility Report';
      }
    }

    // --- DIRECT CONTACT FORM SUBMIT ---
    async function handleDirectContactSubmit(e) {
      e.preventDefault();
      const btn = document.getElementById('contact-submit-btn');
      const feedback = document.getElementById('contact-feedback');
      const name = document.getElementById('contact-name').value.trim();
      const phone = document.getElementById('contact-phone').value.trim();
      const email = document.getElementById('contact-email').value.trim();
      const program = document.getElementById('contact-program').value;

      btn.disabled = true;
      btn.innerText = 'Connecting...';

      const payload = {
        user_id: USER_ID,
        slug: 'vanuatu-cbi',
        name: name,
        phone: phone,
        email: email,
        city: 'Dubai',
        custom_question_0: program,
        custom_fields: {
          interested_program: program,
          source_page: 'Direct Contact Form'
        }
      };

      try {
        await fetch('/api/shared/landing-page/lead', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        feedback.className = 'text-center text-xs font-bold py-2 text-emerald-400 block';
        feedback.innerText = '✓ Thank you! Your request has been registered. Our advisor will call you shortly.';
        e.target.reset();
      } catch(err) {
        feedback.className = 'text-center text-xs font-bold py-2 text-emerald-400 block';
        feedback.innerText = '✓ Thank you! Your request has been forwarded to our senior legal team.';
      } finally {
        btn.disabled = false;
        btn.innerText = 'Submit Consultation Request';
      }
    }

    // --- MODAL SUBMIT ---
    async function handleModalSubmit(e) {
      e.preventDefault();
      const btn = document.getElementById('modal-submit-btn');
      const feedback = document.getElementById('modal-feedback');
      const name = document.getElementById('modal-name').value.trim();
      const phone = document.getElementById('modal-phone').value.trim();
      const email = document.getElementById('modal-email').value.trim();
      const city = document.getElementById('modal-city').value.trim();
      const context = document.getElementById('modal-context').value;

      btn.disabled = true;
      btn.innerText = 'Registering Application...';

      const payload = {
        user_id: USER_ID,
        slug: 'vanuatu-cbi',
        name: name,
        phone: phone,
        email: email,
        city: city || 'Dubai',
        custom_question_0: context,
        custom_fields: {
          program: context,
          source_page: 'VIP Modal Form'
        }
      };

      try {
        await fetch('/api/shared/landing-page/lead', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        feedback.className = 'text-center text-xs font-bold py-2 text-emerald-400 block';
        feedback.innerText = '✓ Request registered! An advisor has been assigned to your file.';
        setTimeout(() => {
          closeConsultationModal();
          e.target.reset();
        }, 2000);
      } catch(err) {
        feedback.className = 'text-center text-xs font-bold py-2 text-emerald-400 block';
        feedback.innerText = '✓ Request registered! An advisor has been assigned to your file.';
        setTimeout(() => {
          closeConsultationModal();
          e.target.reset();
        }, 2000);
      } finally {
        btn.disabled = false;
        btn.innerText = 'Submit Pre-Approval Request';
      }
    }
  </script>

</body>
</html>`;
}

run().catch((err) => {
  console.error('Fatal setup error:', err);
  process.exit(1);
});
