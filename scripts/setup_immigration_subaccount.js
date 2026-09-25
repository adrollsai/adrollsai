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
const SUBACCOUNT_EMAIL = 'immigration@pipixel.io';
const SUBACCOUNT_PASSWORD = 'ApexVisa2026!';
const BUSINESS_NAME = 'Apex Global Immigration Consultants';

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
  console.log('--- 1. Authenticating / Creating Sub-account User ---');
  let userId = null;

  // Check if user already exists in auth
  const { data: { users }, error: listErr } = await supabaseAdmin.auth.admin.listUsers();
  const existingUser = (users || []).find(u => u.email?.toLowerCase() === SUBACCOUNT_EMAIL.toLowerCase());

  if (existingUser) {
    console.log(`Found existing user with ID: ${existingUser.id}`);
    userId = existingUser.id;
    // Update password to ensure it matches exactly
    await supabaseAdmin.auth.admin.updateUserById(userId, {
      password: SUBACCOUNT_PASSWORD,
      email_confirm: true,
      user_metadata: { role: 'client' }
    });
    console.log('Password synchronized for existing user.');
  } else {
    console.log(`Creating new user for ${SUBACCOUNT_EMAIL}...`);
    const { data: newUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: SUBACCOUNT_EMAIL,
      password: SUBACCOUNT_PASSWORD,
      email_confirm: true,
      user_metadata: { role: 'client' }
    });
    if (createErr) {
      console.error('Error creating user:', createErr);
      process.exit(1);
    }
    userId = newUser.user.id;
    console.log(`Created new auth user with ID: ${userId}`);
  }

  console.log('--- 2. Uploading Brand Assets to R2 ---');
  const artifactDir = 'C:\\Users\\Adrolls\\.gemini\\antigravity-ide\\brain\\37002301-adf1-4fa1-8de5-aadb51a3f978';
  
  const logoLocal = path.join(artifactDir, 'apex_immigration_logo_1790322179807.jpg');
  const canadaImgLocal = path.join(artifactDir, 'canada_pr_visa_1790322198813.jpg');
  const ukImgLocal = path.join(artifactDir, 'uk_work_study_visa_1790322215562.jpg');
  const australiaImgLocal = path.join(artifactDir, 'australia_pr_visa_1790322233401.jpg');

  const logoR2Key = `logos/${userId}/apex-immigration-logo.jpg`;
  const canadaR2Key = `properties/${userId}/canada-express-entry-pr.jpg`;
  const ukR2Key = `properties/${userId}/uk-skilled-worker-visa.jpg`;
  const australiaR2Key = `properties/${userId}/australia-pr-visa.jpg`;

  console.log('Uploading logo...');
  const logoUrl = await uploadFileToR2(logoLocal, logoR2Key);
  console.log('Logo URL:', logoUrl);

  console.log('Uploading Canada PR poster...');
  const canadaUrl = await uploadFileToR2(canadaImgLocal, canadaR2Key);

  console.log('Uploading UK Visa poster...');
  const ukUrl = await uploadFileToR2(ukImgLocal, ukR2Key);

  console.log('Uploading Australia PR poster...');
  const australiaUrl = await uploadFileToR2(australiaImgLocal, australiaR2Key);

  console.log('--- 3. Updating Profile ---');
  const profilePayload = {
    id: userId,
    email: SUBACCOUNT_EMAIL,
    business_name: BUSINESS_NAME,
    role: 'client',
    agency_id: PIPIXEL_AGENCY_ID,
    parent_id: PIPIXEL_AGENCY_ID,
    contact_number: '+91 98888 12345',
    address: 'SCO 142-143, Sector 34-A, City Sub-Center, Chandigarh, Punjab 160022',
    logo_url: logoUrl,
    brand_color: '#1E40AF',
    mission_statement: 'Apex Global Immigration is a premier visa and immigration consultancy committed to turning global career and permanent residency aspirations into reality. We specialize in Canadian Express Entry & PNP pathways, Australian Skilled Migration (Subclass 189/190), UK Work & Student Visas, European Opportunity Cards, and top global university placements with an industry-leading 98% visa success rate.',
    business_info: JSON.stringify({
      bio: 'Apex Global Immigration Consultants is an ISO-certified visa and immigration consultancy assisting individuals, students, and families in securing permanent residency, work permits, and study visas across Canada, the UK, Australia, Europe, and the USA. We provide CRS score assessment, provincial nominee programs (PNP), university admissions, SOP writing, and interview prep.',
      notification_email: SUBACCOUNT_EMAIL,
      timezone: 'Asia/Kolkata',
      industry: 'Immigration & Visa Consultancy'
    }),
    credits: 5000,
    subscription_plan: 'enterprise',
    subscription_status: 'active',
    subscription_valid_until: '2099-12-31T23:59:59+00:00',
    onboarding_completed: true,
    currency: 'INR',
    client_features: ['analytics', 'inventory', 'creation', 'ads', 'crm', 'whatsapp', 'voice_agent', 'flows'],
    character_description: 'An authoritative, empathetic immigration legal advisor and study-abroad counselor.',
    character_url: logoUrl
  };

  const { error: profileErr } = await supabaseAdmin.from('profiles').upsert(profilePayload);
  if (profileErr) {
    console.error('Profile Upsert Error:', profileErr);
    process.exit(1);
  }
  console.log('Profile successfully configured.');

  console.log('--- 4. Populating Catalogue (Immigration Services) ---');
  // Clear any previous properties for this user
  await supabaseAdmin.from('properties').delete().eq('user_id', userId);

  const services = [
    {
      user_id: userId,
      title: 'Canada Permanent Residency & Express Entry (PR Pathway)',
      price: '₹75,000',
      property_type: 'Immigration / PR',
      status: 'Active',
      image_url: canadaUrl,
      images: [canadaUrl],
      description: `Comprehensive Express Entry and Provincial Nominee Program (PNP - Ontario, BC, Alberta, Saskatchewan) legal handling.\n\nKey Inclusions:\n• Comprehensive CRS Score Optimization\n• Educational Credential Assessment (ECA - WES/IQAS) Assistance\n• Job Bank Profile & Express Entry Profile Creation\n• Provincial Nominee Program (PNP) Application Filing\n• Post-ITA Complete Legal Documentation & Police/Medical Guidance\n• 98.4% Historic Approval Rate for Federal Skilled Workers`,
      show_on_landing_page: true
    },
    {
      user_id: userId,
      title: 'UK Skilled Worker & Tier 2 Work Visa',
      price: '₹95,000',
      property_type: 'Work Permit',
      status: 'Active',
      image_url: ukUrl,
      images: [ukUrl],
      description: `Complete legal pathway for UK skilled professionals, engineers, IT experts, and healthcare workers.\n\nKey Inclusions:\n• Verification of Certificate of Sponsorship (CoS)\n• UK Home Office Salary Threshold & Shortage Occupation Assessment\n• English Language & NARIC / Ecctis Qualification Verification\n• Dependant / Spouse Visa & Biometric Appointment Assistance\n• Fast-track Priority & Super Priority Visa Submission Support`,
      show_on_landing_page: true
    },
    {
      user_id: userId,
      title: 'Australia Skilled Independent Visa (Subclass 189 & 190 PR)',
      price: '₹85,000',
      property_type: 'Permanent Residency',
      status: 'Active',
      image_url: australiaUrl,
      images: [australiaUrl],
      description: `Direct Australian Permanent Residency pathways for qualified engineers, tech specialists, and medical professionals.\n\nKey Inclusions:\n• Skills Assessment with ACS, Engineers Australia, or VETASSESS\n• Points Test Calculation & Maximization (Age, IELTS/PTE, Work Exp)\n• SkillSelect Expression of Interest (EOI) Lodgement\n• State Nomination Application (NSW, Victoria, Queensland)\n• Final Department of Home Affairs PR Visa Lodgement & Health Clearance`,
      show_on_landing_page: true
    },
    {
      user_id: userId,
      title: 'Global Study Abroad: Canada, UK, Australia & Germany',
      price: '₹35,000',
      property_type: 'Student Visa',
      status: 'Active',
      image_url: ukUrl,
      images: [ukUrl, canadaUrl],
      description: `End-to-end guidance for undergraduate and master's degree aspirants seeking study abroad opportunities.\n\nKey Inclusions:\n• University Shortlisting & Guaranteed Offer Letter Processing\n• Professional SOP (Statement of Purpose) & Recommendation Letter Drafting\n• Education Loan, GIC Account & Blocked Account Setup\n• Scholarship Assessment up to £10,000 / $15,000\n• Mock Visa Interview Preparation & Embassy Submission`,
      show_on_landing_page: true
    },
    {
      user_id: userId,
      title: 'Germany Opportunity Card (Chancenkarte) & Job Seeker Visa',
      price: '₹65,000',
      property_type: 'Job Seeker Visa',
      status: 'Active',
      image_url: canadaUrl,
      images: [canadaUrl],
      description: `The new German points-based immigration system allowing non-EU skilled professionals to enter Germany to find employment.\n\nKey Inclusions:\n• Points Evaluation based on Age, Qualification, Experience & Language\n• ZAB / Anabin Degree Recognition & Equivalence Verification\n• German / English CV & Cover Letter Formatting (Europass Standard)\n• Blocked Account & Health Insurance Advisory\n• German Embassy VFS Appointment & Visa Dossier Preparation`,
      show_on_landing_page: true
    }
  ];

  const { data: insertedServices, error: servErr } = await supabaseAdmin.from('properties').insert(services).select();
  if (servErr) {
    console.error('Error inserting catalogue services:', servErr);
  } else {
    console.log(`Inserted ${insertedServices.length} immigration services in catalogue.`);
  }

  console.log('--- 5. Populating Dummy Immigration Leads ---');
  // Clear any existing leads for this subaccount
  await supabaseAdmin.from('leads').delete().eq('user_id', userId);

  const leads = [
    {
      user_id: userId,
      name: 'Gurpreet Singh Dhillon',
      email: 'gurpreet.dhillon92@gmail.com',
      phone: '+919876543210',
      status: 'New Lead',
      pipeline_stage: 'New Lead',
      source: 'Meta Facebook Ad',
      value: 75000,
      notes: 'B.Tech Computer Science, 5 yrs experience as Senior Full-Stack Developer. IELTS: 8.0 (L: 8.5, R: 8.0, W: 7.5, S: 7.5). High intent for Canada Express Entry or Alberta Tech Pathway.',
      custom_fields: JSON.stringify({
        target_country: 'Canada',
        visa_category: 'Express Entry PR',
        ielts_score: '8.0 (CLB 9+)',
        experience_years: '5 Years IT',
        current_status: 'Free Consultation Requested',
        lead_quality: '🔥 Hot Lead'
      })
    },
    {
      user_id: userId,
      name: 'Ananya Sharma',
      email: 'ananya.sharma.uk@gmail.com',
      phone: '+919812345678',
      status: 'New Lead',
      pipeline_stage: 'New Lead',
      source: 'Instagram Ad',
      value: 35000,
      notes: 'Graduated BBA with 78%. Looking for MSc Data Analytics in UK (Sept 2026 Intake). Has received conditional offer from University of Birmingham.',
      custom_fields: JSON.stringify({
        target_country: 'United Kingdom',
        visa_category: 'Student Visa (Tier 4)',
        ielts_score: '6.5',
        intake: 'September 2026',
        preferred_universities: 'Birmingham, Leeds, Manchester',
        lead_quality: 'Warm Lead'
      })
    },
    {
      user_id: userId,
      name: 'Er. Rajesh Verma',
      email: 'rajesh.verma.mech@yahoo.com',
      phone: '+919780123456',
      status: 'Contacted',
      pipeline_stage: 'Contacted',
      source: 'WhatsApp Inbound',
      value: 65000,
      notes: 'Mechanical Design Engineer with 6 years experience in automotive manufacturing. Inquired regarding German Chancenkarte (Opportunity Card). Degree listed in Anabin as H+.',
      custom_fields: JSON.stringify({
        target_country: 'Germany',
        visa_category: 'Opportunity Card (Chancenkarte)',
        german_language: 'A1 Goethe Completed, pursuing A2',
        education: 'B.E. Mechanical Engineering',
        lead_quality: '🔥 Hot Lead'
      })
    },
    {
      user_id: userId,
      name: 'Simranjit Kaur',
      email: 'simran.kaur.nursing@gmail.com',
      phone: '+919872011223',
      status: 'Contacted',
      pipeline_stage: 'Contacted',
      source: 'Website Form',
      value: 85000,
      notes: 'Registered Nurse (B.Sc Nursing) with 4 years ICU hospital experience. PTE Academic 72 overall. Target: Australia Subclass 190 PR (Victoria / NSW healthcare nomination).',
      custom_fields: JSON.stringify({
        target_country: 'Australia',
        visa_category: 'Subclass 190 PR (Registered Nurse)',
        assessment_body: 'ANMAC',
        points_calculated: '80 Points',
        lead_quality: '🔥 High Priority'
      })
    },
    {
      user_id: userId,
      name: 'Vikram Malhotra',
      email: 'vikram.malhotra@rediffmail.com',
      phone: '+919815567890',
      status: 'Eligibility Assessment',
      pipeline_stage: 'Eligibility Assessment',
      source: 'Meta Facebook Ad',
      value: 75000,
      notes: 'MBA in Marketing, 8 years corporate experience. Spouse is MSc Biotech. Assessing combined CRS score for Canada Express Entry. WES evaluation initiated.',
      custom_fields: JSON.stringify({
        target_country: 'Canada',
        visa_category: 'Express Entry (Spouse Included)',
        projected_crs: '482 Points',
        wes_status: 'Docs Dispatched to WES Canada',
        lead_quality: 'Warm Lead'
      })
    },
    {
      user_id: userId,
      name: 'Pooja Patel',
      email: 'pooja.patel_uk@gmail.com',
      phone: '+919924512345',
      status: 'Eligibility Assessment',
      pipeline_stage: 'Eligibility Assessment',
      source: 'Referral',
      value: 95000,
      notes: 'Received NHS Trust job sponsorship offer letter for Senior Radiographer. Certificate of Sponsorship (CoS) allocation in progress. Need urgent visa filing assistance.',
      custom_fields: JSON.stringify({
        target_country: 'United Kingdom',
        visa_category: 'Health and Care Worker Visa',
        cos_status: 'Sponsorship Issued by NHS Trust',
        lead_quality: '🔥 High Value Case'
      })
    },
    {
      user_id: userId,
      name: 'Harjot Singh Sandhu',
      email: 'harjot.sandhu@gmail.com',
      phone: '+919878899001',
      status: 'Docs Pending',
      pipeline_stage: 'Docs Pending',
      source: 'Walk-in / Direct',
      value: 75000,
      notes: 'WES report received (Dual degree equivalent). CRS Score 488. Received ITA in latest category-based STEM draw. Gathering police clearance and bank balance certificate.',
      custom_fields: JSON.stringify({
        target_country: 'Canada',
        visa_category: 'Federal Skilled Worker (Post-ITA)',
        crs_score: '488 Points',
        ita_received: 'Yes (STEM Draw)',
        deadline_to_submit: '35 Days Remaining'
      })
    },
    {
      user_id: userId,
      name: 'Sneha Mukherjee',
      email: 'sneha.mukherjee@outlook.com',
      phone: '+919830123987',
      status: 'Docs Pending',
      pipeline_stage: 'Docs Pending',
      source: 'Google Ads',
      value: 85000,
      notes: 'VETASSESS Stage 1 positive outcome received for Marketing Specialist (ANZSCO 225113). Preparing ROI submission for Victoria 190 nomination.',
      custom_fields: JSON.stringify({
        target_country: 'Australia',
        visa_category: 'Subclass 190 State Nomination',
        vetassess_outcome: 'Positive Outcome Letter Verified',
        state_preference: 'Victoria / Melbourne'
      })
    },
    {
      user_id: userId,
      name: 'Jaspreet Singh Bains',
      email: 'jaspreet.bains90@gmail.com',
      phone: '+919876123450',
      status: 'Visa Filed',
      pipeline_stage: 'Visa Filed',
      source: 'Meta Facebook Ad',
      value: 75000,
      notes: 'Full Express Entry application submitted on IRCC portal. Biometrics instruction letter received and appointment completed at VFS Chandigarh. Medical exam passed.',
      custom_fields: JSON.stringify({
        target_country: 'Canada',
        visa_category: 'Express Entry PR (In Processing)',
        ircc_application_no: 'E002891402',
        biometrics_status: 'Completed at VFS Chandigarh',
        background_check: 'In Progress'
      })
    },
    {
      user_id: userId,
      name: 'Rohan Mehta',
      email: 'rohan.mehta.canada@gmail.com',
      phone: '+919820011223',
      status: 'Visa Filed',
      pipeline_stage: 'Visa Filed',
      source: 'Instagram Ad',
      value: 35000,
      notes: 'Seneca College Post-Graduate Certificate in Cloud Architecture. GIC of CAD 20,635 deposited with CIBC. Tuition fee receipt attached. Student SDS Visa filed.',
      custom_fields: JSON.stringify({
        target_country: 'Canada',
        visa_category: 'Student Direct Stream (SDS)',
        college: 'Seneca Polytechnic, Toronto',
        gic_account: 'CIBC Verified CAD 20,635',
        sds_filing_date: '15 Sept 2026'
      })
    },
    {
      user_id: userId,
      name: 'Dr. Michael Fernandez',
      email: 'dr.michael.fernandez@gmail.com',
      phone: '+919845012399',
      status: 'Visa Approved',
      pipeline_stage: 'Visa Approved',
      source: 'Referral',
      value: 85000,
      notes: 'Australia Subclass 189 Skilled Independent PR Visa GRANTED! 🎉 Medical practitioner quota. Initial entry required by November 2026. Client gave 5-star review.',
      custom_fields: JSON.stringify({
        target_country: 'Australia',
        visa_category: 'Subclass 189 Permanent Residency',
        grant_number: 'AUS-PR-8819204',
        status: '✅ PR VISA GRANTED'
      })
    },
    {
      user_id: userId,
      name: 'Kuldeep Singh',
      email: 'kuldeep.singh.sowp@gmail.com',
      phone: '+919877098765',
      status: 'Visa Approved',
      pipeline_stage: 'Visa Approved',
      source: 'Walk-in / Direct',
      value: 75000,
      notes: 'Canada Spousal Open Work Permit (SOWP) Approved! Passport stamped from VFS Jalandhar. Travel booking confirmed.',
      custom_fields: JSON.stringify({
        target_country: 'Canada',
        visa_category: 'Spousal Open Work Permit (SOWP)',
        passport_stamped: 'Yes (Valid for 3 Years)',
        status: '✅ VISA APPROVED'
      })
    }
  ];

  const { data: insertedLeads, error: leadErr } = await supabaseAdmin.from('leads').insert(leads).select();
  if (leadErr) {
    console.error('Error inserting leads:', leadErr);
  } else {
    console.log(`Inserted ${insertedLeads.length} realistic dummy leads across all pipeline stages.`);
  }

  console.log('--- 6. Creating Sample Pre-Generated Assets ---');
  await supabaseAdmin.from('assets').delete().eq('user_id', userId);

  const sampleAssets = [
    {
      user_id: userId,
      type: 'image',
      status: 'Ready',
      url: canadaUrl,
      caption: `🍁 DREAMING OF PERMANENT RESIDENCY IN CANADA IN 2026?\n\nWith new category-based Express Entry draws for STEM, Healthcare, Trades, and Agriculture, getting your Canadian Permanent Residency is faster and more accessible than ever!\n\n✨ Why Choose Apex Global Immigration?\n✅ 100% Transparent Legal Guidance\n✅ Free CRS Score & PNP Eligibility Assessment\n✅ Dedicated Case Officer & Post-ITA Support\n✅ 98.4% Visa Success Rate\n\n🎯 Check your Canada PR eligibility in 60 seconds! Tap the link in our bio or DM us "CANADA PR" to speak with our licensed immigration experts today.\n\n#CanadaPR #ExpressEntry #CanadaImmigration #CanadaVisa #MoveToCanada #PNPCanada #StudyInCanada #ApexImmigration`,
      share_stats: { download: 14, facebook: 6, whatsapp: 28, instagram: 19 },
      metadata: { aspect_ratio: '1:1', model: 'gpt-image-2', prompt: 'Canada Permanent Residency poster' }
    },
    {
      user_id: userId,
      type: 'image',
      status: 'Ready',
      url: ukUrl,
      caption: `🇬🇧 WORK & STUDY IN THE UNITED KINGDOM!\n\nReady to elevate your career or secure a world-class degree from top Russell Group UK universities? \n\n🚀 Apex Global Immigration offers end-to-end processing for:\n• Tier 2 / Skilled Worker Visas with CoS verification\n• Healthcare & Care Worker Visas\n• Bachelor's & Master's Admissions with Scholarships up to £10,000\n• 2-Year Post Study Work (PSW) Visa Guidance\n\n📌 Intakes are filling fast! DM us "UK VISA" or call +91 98888 12345 to book your private 1-on-1 strategy session.\n\n#UKVisa #SkilledWorkerUK #StudyInUK #UKImmigration #Tier2Visa #WorkInUK #ApexGlobalImmigration`,
      share_stats: { download: 9, facebook: 4, whatsapp: 18, instagram: 12 },
      metadata: { aspect_ratio: '1:1', model: 'gpt-image-2', prompt: 'UK Skilled Worker & Study Visa poster' }
    },
    {
      user_id: userId,
      type: 'image',
      status: 'Ready',
      url: australiaUrl,
      caption: `🇦🇺 LIVE, WORK & SETTLE PERMANENTLY IN AUSTRALIA!\n\nAustralia Subclass 189 & 190 Permanent Residency invites are actively being issued for skilled professionals, engineers, IT experts, and healthcare specialists.\n\n🌟 What We Provide:\n✔️ Guaranteed Skills Assessment Assistance (ACS / Engineers Australia / VETASSESS)\n✔️ Points Test Optimization for Maximum Score\n✔️ State Nomination Submissions for NSW, Victoria & Queensland\n✔️ Direct Family PR Visa Grant Filing\n\n👇 Comment "AUSTRALIA" or WhatsApp us at +91 98888 12345 for a comprehensive profile evaluation!\n\n#AustraliaPR #Subclass189 #Subclass190 #AustraliaImmigration #MoveToAustralia #SkilledMigration #ApexImmigration`,
      share_stats: { download: 21, facebook: 11, whatsapp: 35, instagram: 24 },
      metadata: { aspect_ratio: '1:1', model: 'gpt-image-2', prompt: 'Australia Skilled Migration PR poster' }
    }
  ];

  const { data: insertedAssets, error: assetErr } = await supabaseAdmin.from('assets').insert(sampleAssets).select();
  if (assetErr) {
    console.error('Error inserting assets:', assetErr);
  } else {
    console.log(`Inserted ${insertedAssets.length} sample assets ready for demo.`);
  }

  console.log('\n========================================');
  console.log('✅ SUB-ACCOUNT SUCCESSFULLY CONFIGURED!');
  console.log('========================================');
  console.log('Agency: PiPixel (c7bede84-d7ea-4b02-bbbb-017d24a37914)');
  console.log(`Login Email:    ${SUBACCOUNT_EMAIL}`);
  console.log(`Login Password: ${SUBACCOUNT_PASSWORD}`);
  console.log(`Business Name:  ${BUSINESS_NAME}`);
  console.log(`User ID:        ${userId}`);
  console.log(`Credits:        5,000 Credits`);
  console.log(`Plan:           Enterprise (Active)`);
  console.log(`Catalogue:      5 Immigration Services`);
  console.log(`CRM Leads:      12 Dummy Leads across all stages`);
  console.log(`Assets Library: 3 Sample Marketing Creatives`);
  console.log('========================================\n');
}

run().catch(console.error);
