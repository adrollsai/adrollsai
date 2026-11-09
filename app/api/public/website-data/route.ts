import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function parsePriceNumber(priceStr: string | null | undefined): number {
  if (!priceStr) return 0;
  // If e.g. "1.85 Cr" -> 18500000
  const clean = priceStr.toLowerCase().replace(/,/g, '').trim();
  const crMatch = clean.match(/([\d.]+)\s*cr/);
  if (crMatch) {
    return Math.round(parseFloat(crMatch[1]) * 10000000);
  }
  const lMatch = clean.match(/([\d.]+)\s*l(akh)?/);
  if (lMatch) {
    return Math.round(parseFloat(lMatch[1]) * 100000);
  }
  const mMatch = clean.match(/([\d.]+)\s*m/);
  if (mMatch) {
    return Math.round(parseFloat(mMatch[1]) * 1000000);
  }
  const kMatch = clean.match(/([\d.]+)\s*k/);
  if (kMatch) {
    return Math.round(parseFloat(kMatch[1]) * 1000);
  }
  const digits = clean.replace(/[^0-9]/g, '');
  return parseInt(digits || '0', 10);
}

function mapPropertyType(type: string | undefined): string {
  if (!type) return 'House';
  const t = type.toLowerCase();
  if (t.includes('plot') || t.includes('land')) return 'Land';
  if (t.includes('condo') || t.includes('apartment') || t.includes('flat') || t.includes('bhk')) return 'Condo';
  if (t.includes('villa') || t.includes('bungalow') || t.includes('kothi')) return 'House';
  if (t.includes('townhouse') || t.includes('floor')) return 'Townhouse';
  if (t.includes('penthouse')) return 'Penthouse';
  return 'House';
}

function parseConfig(config: any): any {
  if (!config) return {};
  if (typeof config === 'object') return config;
  try {
    return JSON.parse(config);
  } catch {
    return {};
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const userIdParam = url.searchParams.get('userId') || url.searchParams.get('u') || url.searchParams.get('user_id');
    const domainParam = url.searchParams.get('domain');
    const hostHeader = request.headers.get('host') || '';
    const cleanHost = hostHeader.replace(/^www\./, '').split(':')[0].toLowerCase();

    // 1. Resolve Profile
    let profileQuery = supabaseAdmin
      .from('profiles')
      .select('id, business_name, business_info, logo_url, brand_color, contact_number, address, whatsapp_phone_number, custom_domain, email, mission_statement, facebook_url, instagram_url, linkedin_url, youtube_url');

    if (userIdParam) {
      profileQuery = profileQuery.eq('id', userIdParam);
    } else if (domainParam) {
      profileQuery = profileQuery.or(`custom_domain.eq.${domainParam.toLowerCase()},whitelabel_domain.eq.${domainParam.toLowerCase()}`);
    } else if (cleanHost && !cleanHost.includes('localhost') && !cleanHost.includes('nobogent.com') && !cleanHost.includes('vercel.app')) {
      profileQuery = profileQuery.or(`custom_domain.eq.${cleanHost},whitelabel_domain.eq.${cleanHost}`);
    } else {
      // Fallback: look for rchopra489@gmail.com or most recently active admin
      profileQuery = profileQuery.eq('email', 'rchopra489@gmail.com');
    }

    const { data: profile, error: profileErr } = await profileQuery.maybeSingle();

    if (profileErr || !profile) {
      return NextResponse.json({ error: 'Business profile not found' }, { status: 404 });
    }

    // 2. Fetch Active Inventory (Properties)
    // Only return active, non-archived, non-sold properties that haven't been hidden
    const { data: properties, error: propErr } = await supabaseAdmin
      .from('properties')
      .select('*')
      .eq('user_id', profile.id)
      .neq('status', 'Archived')
      .neq('status', 'Sold')
      .order('created_at', { ascending: false });

    if (propErr) {
      console.error('[Website Data API] Properties query error:', propErr);
    }

    const rawList = (properties || []).filter((p: any) => p.show_on_landing_page !== false);

    // Format properties for real-estate-template
    const formattedProperties = rawList.map((p: any, idx: number) => {
      const cfg = parseConfig(p.configurations);
      const numericPrice = parsePriceNumber(p.price);
      const addr = p.address || 'Prime City Location';
      const addrParts = addr.split(',').map((s: string) => s.trim());
      const city = addrParts.length > 1 ? addrParts[addrParts.length - 1] : (addrParts[0] || 'Luxury Enclave');
      const state = addrParts.length > 2 ? addrParts[addrParts.length - 2] : '';

      const images = Array.isArray(p.images) && p.images.length > 0
        ? p.images
        : (p.image_url ? [p.image_url] : ['assets/img/prop-01.svg']);

      const beds = cfg.beds || cfg.bedrooms || cfg.bhk || (p.title.match(/(\d+)\s*bhk/i)?.[1] ? parseInt(p.title.match(/(\d+)\s*bhk/i)![1], 10) : 3);
      const baths = cfg.baths || cfg.bathrooms || Math.max(1, beds - 1);
      const sqft = cfg.sqft || cfg.super_builtup_area || cfg.carpet_area || 2450;

      const defaultFeatures = [
        "Vastu Compliant Architecture",
        "24/7 Gated Security & Concierge",
        "Dedicated Covered Parking",
        "Clubhouse & Swimming Pool Access",
        "High-Speed Elevators",
        "Landscaped Green Parks"
      ];

      const features = Array.isArray(cfg.amenities) && cfg.amenities.length > 0
        ? cfg.amenities
        : defaultFeatures;

      const daysAgo = p.created_at
        ? Math.max(0, Math.floor((Date.now() - new Date(p.created_at).getTime()) / (1000 * 60 * 60 * 24)))
        : 2;

      return {
        id: p.id,
        mls: `NB-${p.id.substring(0, 6).toUpperCase()}`,
        title: p.title,
        address: addr,
        city: city,
        state: state || 'IN',
        zip: cfg.zip || '140110',
        price: numericPrice || 15000000,
        displayPrice: p.price || (numericPrice ? `₹${numericPrice.toLocaleString('en-IN')}` : 'Price on Request'),
        status: p.status === 'Active' ? 'For Sale' : (p.status || 'For Sale'),
        type: mapPropertyType(p.property_type || cfg.type),
        beds: beds,
        baths: baths,
        sqft: sqft,
        lotSqft: cfg.lotSqft || (sqft * 1.5),
        yearBuilt: cfg.yearBuilt || 2024,
        parking: cfg.parking || "2 Dedicated Covered Bays",
        hoa: cfg.maintenance || "Included",
        agentId: "agent-primary",
        featured: idx === 0 || !!p.featured || rawList.length <= 4,
        openHouse: cfg.openHouse || "Private Viewings Daily",
        headline: p.description ? p.description.slice(0, 120) : `${p.title} - Exclusive Luxury Residence`,
        description: p.description || `${p.title} offers uncompromising craftsmanship, contemporary architecture, and world-class living standards. Contact our private advisory desk for verified documentation, floor plans, and VIP site walkthroughs.`,
        images: images,
        features: features,
        specs: [
          { label: "Configuration", value: `${beds} BHK Luxury Residence` },
          { label: "Super Built-Up Area", value: `${sqft.toLocaleString()} sq ft` },
          { label: "Furnishing", value: cfg.furnishing || "Semi-Furnished Premium" },
          { label: "Possession", value: cfg.possession || "Ready to Move / Immediate" },
          { label: "Title / Approval", value: "RERA Approved & Clear Title" }
        ],
        days: daysAgo
      };
    });

    // 3. Brand & Site Config
    const bizName = profile.business_name || 'Nobogent Luxury Real Estate';
    const primaryColor = profile.brand_color || '#0B1220';
    const contactPhone = profile.whatsapp_phone_number || profile.contact_number || '+91 98886 26786';
    const cleanPhone = contactPhone.replace(/[^0-9+]/g, '');

    const siteConfig = {
      ownerId: profile.id,
      brand: {
        name: bizName,
        suffix: "",
        tagline: "Signature Living & Verified Investments",
        license: "RERA Approved Brokerage",
        mark: profile.logo_url || ""
      },
      colors: {
        primary: primaryColor,
        accent: "#C79A4B"
      },
      contact: {
        phone: cleanPhone,
        phoneDisplay: contactPhone,
        email: profile.email || "advisory@nobogent.com",
        address: profile.address || "Sector Prime Boulevard, Luxury Towers",
        whatsapp: cleanPhone
      },
      social: {
        facebook: profile.facebook_url || null,
        instagram: profile.instagram_url || null,
        linkedin: profile.linkedin_url || null,
        youtube: profile.youtube_url || null
      },
      forms: {
        endpoint: "/api/shared/inquiry",
        method: "POST",
        redirect: "thank-you.html",
        demoRedirect: true
      },
      agents: [
        {
          id: "agent-primary",
          name: bizName,
          role: "Managing Principal & Lead Advisor",
          phone: contactPhone,
          email: profile.email || "advisory@nobogent.com",
          photo: profile.logo_url || "assets/img/agent-1.svg",
          bio: profile.business_info || profile.mission_statement || `Lead luxury real estate advisory with extensive market intelligence, off-market inventory, and direct developer allocations.`,
          salesCount: 140,
          volume: "₹250+ Cr",
          rating: 4.95,
          activeCount: formattedProperties.length
        }
      ]
    };

    return NextResponse.json({
      success: true,
      profile: {
        id: profile.id,
        business_name: profile.business_name,
        custom_domain: profile.custom_domain,
        contact_number: profile.contact_number
      },
      site: siteConfig,
      properties: formattedProperties
    }, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120'
      }
    });

  } catch (err: any) {
    console.error('[Website Data API] Fatal Exception:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
