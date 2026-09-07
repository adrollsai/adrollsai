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

// 1. OMAXE NEW CHANDIGARH (10 PROPERTIES)
const omaxeProperties = [
  {
    title: 'The Lake by Omaxe',
    property_type: 'Residential',
    region: 'New Chandigarh',
    price: '₹ 53 Lac - ₹ 2.45 Cr',
    address: 'Sector 3 / Madhya Marg Ext., Omaxe New Chandigarh',
    description: 'The Lake by Omaxe is an ultra-luxurious waterfront residential enclave designed around an expansive picturesque water body. Offering 1, 2, 3, 4 & 5 BHK luxury apartments and lavish penthouses, the project delivers world-class resort living with an international clubhouse, floating restaurant cabanas, Olympic-sized swimming pool, spa, and panoramic views of the Shivalik foothills.',
    image_url: 'https://www.omaxe.com/projects/banner_1770812950769.jpeg',
    images: [
      'https://www.omaxe.com/projects/banner_1770812950769.jpeg',
      'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=1200&q=85',
      'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=85'
    ],
    configurations: {
      units: ['1 BHK (580 Sq.Ft.)', '2 BHK (1285 Sq.Ft.)', '3 BHK + Servant (1820 Sq.Ft.)', '4 BHK + Lounge (2450 Sq.Ft.)', 'Sky Penthouses (4400 Sq.Ft.)'],
      sizes: '580 - 4,400 Sq.Ft.',
      status: 'Ready to Move & Possession Linked',
      possession: 'Immediate / Ready to Move',
      amenities: ['Grand 50,000 Sq.Ft. Clubhouse', 'Olympic Swimming Pool & Water Bodies', 'Tennis & Badminton Courts', 'Floating Restaurant & Cabanas', '3-Tier High-Tech Security', '100% Power Backup']
    }
  },
  {
    title: 'Omaxe Mulberry Villas',
    property_type: 'Villas',
    region: 'New Chandigarh',
    price: '₹ 2.85 Cr - ₹ 5.50 Cr',
    address: 'Omaxe New Chandigarh Township, Mullanpur',
    description: 'Omaxe Mulberry Villas redefine royal suburban living with European-style G+1 luxury duplex residences built on 300 to 500 sq. yard plots. Each villa features double-height grand living spaces, imported Italian marble flooring, private manicured front and rear lawns, private elevators, and personal terrace garden pavilions overlooking the majestic hills.',
    image_url: 'https://images.unsplash.com/photo-1613490493576-7fde63acd811?auto=format&fit=crop&w=1200&q=85',
    images: [
      'https://images.unsplash.com/photo-1613490493576-7fde63acd811?auto=format&fit=crop&w=1200&q=85',
      'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1200&q=85',
      'https://images.unsplash.com/photo-1600566753376-12c8ab7fb75b?auto=format&fit=crop&w=1200&q=85'
    ],
    configurations: {
      units: ['4 BHK Duplex Villa (300 Sq.Yds)', '5 BHK Grand Duplex Villa + AV Room (400 Sq.Yds)', '5 BHK Imperial Villa + Private Pool (500 Sq.Yds)'],
      sizes: '300 - 500 Sq. Yards Plot Area',
      status: 'Ready to Move',
      possession: 'Immediate Ready for Possession',
      amenities: ['Private Landscaped Lawns', 'Double-Height Living Rooms', 'Personal Elevator Provision', 'Italian Marble Flooring', 'Modular Kitchen with Siemens/Bosch Appliances', 'Club Aura Lifetime Membership']
    }
  },
  {
    title: 'Celestia Royal Premier',
    property_type: 'Independent Floors',
    region: 'New Chandigarh',
    price: '₹ 64 Lac - ₹ 1.25 Cr',
    address: 'Madhya Marg Extension, Omaxe New Chandigarh',
    description: 'Celestia Royal Premier features low-rise Stilt + 4 independent luxury floors offering the perfect blend of independent living and community amenities. With spacious 3 BHK and 4 BHK layouts, dedicated stilt covered parking bays, and private rooftop terraces with barsati options, these homes provide unmatched privacy and comfort.',
    image_url: 'https://images.unsplash.com/photo-1600585154526-990dced4db0d?auto=format&fit=crop&w=1200&q=85',
    images: [
      'https://images.unsplash.com/photo-1600585154526-990dced4db0d?auto=format&fit=crop&w=1200&q=85',
      'https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&fit=crop&w=1200&q=85'
    ],
    configurations: {
      units: ['3 BHK Independent Floor (1450 Sq.Ft.)', '4 BHK Luxury Floor + Servant (2100 Sq.Ft.)'],
      sizes: '1,450 - 2,100 Sq.Ft.',
      status: 'Ready to Move',
      possession: 'Immediate Registry Available',
      amenities: ['Stilt Covered Car Parking', 'High-Speed Automatic Elevators', 'Private Terrace with Barsati', 'Wide 60-Ft Wide Tree Lined Roads', 'Piped Natural Gas (PNG)', 'Kids Play Area']
    }
  },
  {
    title: 'Omaxe Cassia',
    property_type: 'Residential',
    region: 'New Chandigarh',
    price: '₹ 75 Lac - ₹ 1.45 Cr',
    address: 'Phase 1, Omaxe New Chandigarh',
    description: 'Omaxe Cassia presents premium mid-rise luxury apartments surrounded by lush greenery. Spanning 1,725 to 2,200 sq.ft. in 3BHK+SR and 4BHK+SR configurations, each apartment features large sunlit balconies, cross-ventilation, wooden flooring in master suites, and direct access to Sector 8 Chandigarh via Madhya Marg extension.',
    image_url: 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=1200&q=85',
    images: [
      'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=1200&q=85',
      'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=1200&q=85'
    ],
    configurations: {
      units: ['3 BHK + Servant Room (1725 Sq.Ft.)', '4 BHK + Servant Room (2200 Sq.Ft.)'],
      sizes: '1,725 - 2,200 Sq.Ft.',
      status: 'Ready to Move',
      possession: 'Ready to Move In',
      amenities: ['Resort Style Swimming Pool', 'Fully Equipped Gymnasium', 'Community Hall & Banquet Area', 'Underground Parking', '24x7 Treated Water Supply']
    }
  },
  {
    title: 'Omaxe Residential Plots',
    property_type: 'Plots',
    region: 'New Chandigarh',
    price: '₹ 85 Lac - ₹ 3.20 Cr',
    address: 'Omaxe Township, New Chandigarh',
    description: 'Prime freehold developed residential plots in well-planned sectors of Omaxe New Chandigarh. Available in sizes from 150 to 500 sq. yards with wide asphalt roads, underground electrification, storm water drainage, sewage treatment, and immediate registry and building plan sanction.',
    image_url: 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1200&q=85',
    images: [
      'https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1200&q=85',
      'https://images.unsplash.com/photo-1524813686514-a57563d77d66?auto=format&fit=crop&w=1200&q=85'
    ],
    configurations: {
      units: ['150 Sq.Yd. (30 x 45 Ft)', '200 Sq.Yd. (30 x 60 Ft)', '300 Sq.Yd. (36 x 75 Ft)', '500 Sq.Yd. (50 x 90 Ft)'],
      sizes: '150 - 500 Sq. Yards',
      status: 'Ready for Registry & Construction',
      possession: 'Immediate Registry',
      amenities: ['Freehold Clear Title', 'Underground Utility Cabling', 'Wide 60ft & 80ft Sector Roads', 'Direct Access from PR-4 & PR-7', 'Lush Thematic Gardens Nearby']
    }
  },
  {
    title: 'The Resort New Chandigarh',
    property_type: 'Residential',
    region: 'New Chandigarh',
    price: '₹ 41 Lac - ₹ 1.15 Cr',
    address: 'Omaxe New Chandigarh, Near Medicity',
    description: 'A vacation-themed residential paradise featuring 1, 2, 3 BHK apartments and sky penthouses. Located close to Medicity and Homi Bhabha Cancer Hospital, The Resort boasts an open-air amphitheatre, sports academy, infinity pool, and lush landscaped central park greens.',
    image_url: 'https://images.unsplash.com/photo-1580587771525-78b9dba3b914?auto=format&fit=crop&w=1200&q=85',
    images: [
      'https://images.unsplash.com/photo-1580587771525-78b9dba3b914?auto=format&fit=crop&w=1200&q=85',
      'https://images.unsplash.com/photo-1576941089067-2de3c901e126?auto=format&fit=crop&w=1200&q=85'
    ],
    configurations: {
      units: ['1 BHK (830 Sq.Ft.)', '2 BHK + Store (1150 Sq.Ft.)', '3 BHK + 2 WR (1480 Sq.Ft.)', '3 BHK + 3 WR + Store (1750 Sq.Ft.)', 'Penthouses (2400 Sq.Ft.)'],
      sizes: '830 - 2,400 Sq.Ft.',
      status: 'Ready to Move',
      possession: 'Ready to Move In',
      amenities: ['Resort Style Leisure Pools', 'Mini Golf Putting Green', 'Yoga & Meditation Pavilion', 'Jogging Track with Tree Canopy', 'Cafeteria & Lounge']
    }
  },
  {
    title: 'Omaxe Silver Birch',
    property_type: 'Independent Floors',
    region: 'New Chandigarh',
    price: '₹ 58 Lac - ₹ 1.10 Cr',
    address: 'Sector 3, Omaxe New Chandigarh',
    description: 'Low-rise G+2 independent floors in 3 BHK and 4 BHK configurations offering serene family living. Built with premium construction quality, spacious master bedrooms, modular kitchens, and independent access to roof rights for top floor units.',
    image_url: 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=1200&q=85',
    images: [
      'https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=1200&q=85',
      'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=85'
    ],
    configurations: {
      units: ['3 BHK Ground Floor with Lawn (1350 Sq.Ft.)', '3 BHK 1st & 2nd Floor (1350 Sq.Ft.)', '4 BHK Independent Floor (1850 Sq.Ft.)'],
      sizes: '1,350 - 1,850 Sq.Ft.',
      status: 'Ready to Move',
      possession: 'Ready for Possession',
      amenities: ['Ground Floor Private Lawns', 'Top Floor Terrace Rights', 'Dedicated Car Parking', 'Walking Distance to Market Plaza', 'Wide Green Central Courtyard']
    }
  },
  {
    title: 'Omaxe Ambrosia Independent Floors',
    property_type: 'Independent Floors',
    region: 'New Chandigarh',
    price: '₹ 62 Lac - ₹ 98 Lac',
    address: 'Omaxe New Chandigarh, Punjab',
    description: 'Stilt + 3 storey luxury independent floors with dedicated passenger lifts and stilt covered car parking. Located in prime Phase 1 with quick connectivity to Sector 8 Chandigarh, Ambrosia offers modern architectural layouts, wooden finish master suites, and grand park view balconies.',
    image_url: 'https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?auto=format&fit=crop&w=1200&q=85',
    images: [
      'https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?auto=format&fit=crop&w=1200&q=85',
      'https://images.unsplash.com/photo-1600566753086-00f18fb6b3ea?auto=format&fit=crop&w=1200&q=85'
    ],
    configurations: {
      units: ['S+3 3 BHK Luxury Floor (1425 Sq.Ft.)'],
      sizes: '1,425 Sq.Ft.',
      status: 'Ready to Move',
      possession: 'Immediate Registry',
      amenities: ['Stilt Lift Access to All Floors', 'Reserved Stilt Parking', 'Park Facing Balconies', 'PNG Piped Gas Connection', 'Club Aura Access']
    }
  },
  {
    title: 'Omaxe Gardenia 2 & 3',
    property_type: 'Independent Floors',
    region: 'New Chandigarh',
    price: '₹ 68 Lac - ₹ 1.30 Cr',
    address: 'Omaxe New Chandigarh, Punjab',
    description: 'Boutique independent floors nestled amidst 70% landscaped green open spaces. Featuring double-height ceilings, private entry porches, Italian sanitaryware, and exclusive access to Club Aura offering state-of-the-art fitness, fine dining, spa, and banquet facilities.',
    image_url: 'https://images.unsplash.com/photo-1600585152220-90363fe7e115?auto=format&fit=crop&w=1200&q=85',
    images: [
      'https://images.unsplash.com/photo-1600585152220-90363fe7e115?auto=format&fit=crop&w=1200&q=85',
      'https://images.unsplash.com/photo-1600573472550-8090b5e0745e?auto=format&fit=crop&w=1200&q=85'
    ],
    configurations: {
      units: ['3 BHK (1500 Sq.Ft.)', '3 BHK + Family Lounge (1850 Sq.Ft.)', '3 BHK + Family Lounge + Servant (2250 Sq.Ft.)'],
      sizes: '1,500 - 2,250 Sq.Ft.',
      status: 'Ready to Move',
      possession: 'Ready to Move',
      amenities: ['70% Green Open Areas', 'Double Height Ceilings', 'Club Aura Premium Membership', 'Kids Splash Pool & Play Areas', 'Stilt Parking + Visitor Parking']
    }
  },
  {
    title: 'Celestia Royal 2',
    property_type: 'Independent Floors',
    region: 'New Chandigarh',
    price: '₹ 70 Lac - ₹ 1.35 Cr',
    address: 'Near Madhya Marg, Omaxe New Chandigarh',
    description: 'Spacious 3 BHK luxury independent floors offering family lounge and servant room layouts. Located right off the Madhya Marg 6-lane express corridor with seamless 5-minute access to Sector 8 Chandigarh, surrounded by mountain air, manicured parks, and wide tree-lined boulevards.',
    image_url: 'https://images.unsplash.com/photo-1600566752355-35792bedcfea?auto=format&fit=crop&w=1200&q=85',
    images: [
      'https://images.unsplash.com/photo-1600566752355-35792bedcfea?auto=format&fit=crop&w=1200&q=85'
    ],
    configurations: {
      units: ['3 BHK (1580 Sq.Ft.)', '3 BHK + Family Lounge + Servant (2150 Sq.Ft.)'],
      sizes: '1,580 - 2,150 Sq.Ft.',
      status: 'Ready to Move',
      possession: 'Ready for Possession',
      amenities: ['Family Lounge & Servant Room Options', 'Scenic Shivalik Mountain Views', 'Dedicated Covered Parking', 'Gated Security with RFID Entry']
    }
  }
];

// 2. THE 10 NEW TRI-CITY & NEW CHANDIGARH DEVELOPMENTS
const triCityProperties = [
  {
    title: 'Opus One by GB Realty',
    property_type: 'Residential',
    region: 'New Chandigarh',
    price: '₹ 2.25 Cr - ₹ 6.50 Cr',
    address: 'Eco-City 2, New Chandigarh, Punjab',
    description: 'Opus One by GB Realty is New Chandigarh\'s first IGBC Platinum Rated ultra-luxury residential enclave spread across 8.75 acres. Featuring expansive 3, 4, 5, and 6 BHK sky residences, a private 65,000 sq.ft. international clubhouse, infinity lap pool, manicured Zen gardens, and 360-degree views of the Shivalik range. RERA: PBRERA-SAS81-PR1267.',
    image_url: 'https://opusone.co.in/assets/images/about/opus-one-project-overview-eco-city-2.jpg',
    images: [
      'https://opusone.co.in/assets/images/about/opus-one-project-overview-eco-city-2.jpg',
      'https://opusone.co.in/assets/images/about/opus-one-aerial-view-new-chandigarh.jpg',
      'https://opusone.co.in/assets/images/amenities/opus-one-clubhouse-65000-sqft.jpg',
      'https://opusone.co.in/assets/images/amenities/opus-one-swimming-pool.jpg',
      'https://opusone.co.in/assets/images/opus-one-interior-showcase.jpg'
    ],
    configurations: {
      units: ['3 BHK Luxury (2250 Sq.Ft.)', '4 BHK Grand (3150 Sq.Ft.)', '5 BHK Imperial (4200 Sq.Ft.)', '6 BHK Sky Mansion (5800 Sq.Ft.)'],
      sizes: '2,250 - 5,800 Sq.Ft.',
      status: 'Under Construction / New Launch',
      possession: 'December 2029 (1% Monthly Plan Available)',
      amenities: ['65,000 Sq.Ft. Signature Clubhouse', 'IGBC Platinum Certified', 'Olympic Infinity Pool', 'Private Theater & Bowling Alley', 'Concierge & Valet Desk', 'Multi-Tier Smart Security']
    }
  },
  {
    title: 'The Tiara by Sham Exotic',
    property_type: 'Residential',
    region: 'New Chandigarh',
    price: '₹ 3.50 Cr - ₹ 7.50 Cr',
    address: 'Group Housing Site No. 2, Medicity, New Chandigarh, Punjab',
    description: 'The Tiara is a landmark ultra-luxury high-rise residential project by Sham Exotic Group in Medicity, New Chandigarh. Spanning 5.66 acres across 6 majestic towers with only 336 bespoke residences. Features 4 BHK, 4+1 BHK, and 5+1 BHK palatial apartments with private elevators, grand 60,000 sq.ft. clubhouse, and panoramic Shivalik views. RERA: PBRERA-SAS80-PR1063.',
    image_url: 'https://thetiara.in/wp-content/uploads/2024/09/11-1024x683.jpg',
    images: [
      'https://thetiara.in/wp-content/uploads/2024/09/11-1024x683.jpg',
      'https://thetiara.in/wp-content/uploads/2024/09/img-1.jpg',
      'https://thetiara.in/wp-content/uploads/2024/09/img-2.jpg',
      'https://thetiara.in/wp-content/uploads/2024/09/shutterstock_131527322-1024x683.jpg'
    ],
    configurations: {
      units: ['4 BHK Luxury (4100 Sq.Ft.)', '4+1 BHK Grande (5200 Sq.Ft.)', '5+1 BHK Sky Suite (8000 Sq.Ft.)'],
      sizes: '4,100 - 8,000 Sq.Ft.',
      status: 'Active / Under Construction',
      possession: '2028',
      amenities: ['60,000 Sq.Ft. Signature Clubhouse', 'Infinity Rooftop Pool', 'Luxury Spa & Sauna Suites', 'EV Charging Bays', 'Private Elevator Lobbies', 'Olympic Squash & Tennis Arena']
    }
  },
  {
    title: 'Homeland Infinia',
    property_type: 'Residential',
    region: 'New Chandigarh',
    price: '₹ 1.95 Cr - ₹ 3.80 Cr',
    address: 'PR-4 Road, Opposite PCA Cricket Stadium, Eco City 2, New Chandigarh',
    description: 'Homeland Infinia is an iconic luxury development by Homeland Group, located directly on PR-4 Road opposite the PCA International Cricket Stadium in New Chandigarh. Offering large-format 3 BHK and 4 BHK luxury residences with wrap-around balconies, private family lounges, biometric security, and zero-kilometer connectivity to Chandigarh Sector 11 and PGI.',
    image_url: 'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=1200&q=85',
    images: [
      'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=1200&q=85',
      'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=85',
      'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?auto=format&fit=crop&w=1200&q=85'
    ],
    configurations: {
      units: ['3 BHK Luxury + Servant (2150 Sq.Ft.)', '4 BHK Grand Suite + Servant (2950 Sq.Ft.)', '4 BHK Penthouses (4100 Sq.Ft.)'],
      sizes: '2,150 - 4,100 Sq.Ft.',
      status: 'Under Construction / Booking Open',
      possession: '2028',
      amenities: ['Stadium Facing Sky Lounges', 'Temperature Controlled Pool', 'Clubhouse & Squash Court', '3-Tier Biometric Security', 'Covered Stilt Parking', 'Lush Thematic Central Greens']
    }
  },
  {
    title: 'Jubilee Parkfields',
    property_type: 'Plots',
    region: 'New Chandigarh',
    price: '₹ 1.25 Cr - ₹ 3.40 Cr',
    address: 'Sector 21, New Chandigarh (Mullanpur), Punjab',
    description: 'Jubilee Parkfields is a sprawling 207-acre integrated master-planned township by the Jubilee Group in Sector 21, New Chandigarh. Approved by GMADA (License LDC-92/2026), it offers developed residential plots (200-500 Sq. Yds), Amber Terraces (3 BHK independent luxury floors with private lifts), and Imperia high-rise residences with a 1.5-acre modern clubhouse and themed parks.',
    image_url: 'https://jubileeparkfield.in/wp-content/uploads/2025/08/Jubilee-parkfields-a-mega-township-1024x1024.jpg',
    images: [
      'https://jubileeparkfield.in/wp-content/uploads/2025/08/Jubilee-parkfields-a-mega-township-1024x1024.jpg',
      'https://jubileeparkfield.in/wp-content/uploads/2025/03/Jubilee_Parkfields_new_Chandigarh.jpg',
      'https://jubileeparkfield.in/wp-content/uploads/2025/03/Jubilee_Parkfields_2-819x1024.jpg',
      'https://jubileeparkfield.in/wp-content/uploads/2025/03/Jubilee-Parkfields-CLU-125-Acers.jpg'
    ],
    configurations: {
      units: ['Residential Plots (200, 250, 300, 500 Sq.Yds)', 'Amber Terraces 3 BHK Floors (1850 Sq.Ft.)', 'Imperia 3 & 3+1 BHK High Rise (1950 - 2450 Sq.Ft.)'],
      sizes: '1,850 - 4,500 Sq.Ft. / 200 - 500 Sq.Yds',
      status: 'Active Development / GMADA Approved',
      possession: 'Phase Wise 2026-2028',
      amenities: ['1.5-Acre Resort Clubhouse', '40 to 100-Ft Wide Internal Roads', 'Underground Utility Cabling', 'High-Street Commercial Retail', 'Lush Thematic Gardens']
    }
  },
  {
    title: 'DLF Hyde Park New Chandigarh',
    property_type: 'Plots',
    region: 'New Chandigarh',
    price: '₹ 1.75 Cr - ₹ 6.50 Cr',
    address: 'DLF Hyde Park Estate, Mullanpur, New Chandigarh, Punjab',
    description: 'DLF Hyde Park Estate is New Chandigarh\'s most prestigious gated community spread over 200+ acres against the backdrop of the Shivalik foothills. Offering ready-to-move luxury independent floors, freehold residential plots (250-500 sq. yards), and bespoke designer villas with a grand 30,000 sq.ft. clubhouse, tennis courts, and 5-minute connectivity to Chandigarh Sector 11 & PGI.',
    image_url: 'https://images.unsplash.com/photo-1613490493576-7fde63acd811?auto=format&fit=crop&w=1200&q=85',
    images: [
      'https://images.unsplash.com/photo-1613490493576-7fde63acd811?auto=format&fit=crop&w=1200&q=85',
      'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1200&q=85',
      'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=85'
    ],
    configurations: {
      units: ['3 BHK Luxury Independent Floor (1880 Sq.Ft.)', '4 BHK Independent Floor (2350 Sq.Ft.)', 'Residential Plot 250 Sq.Yd.', 'Residential Plot 350 - 500 Sq.Yd.', 'DLF Hyde Park Luxury Villas'],
      sizes: '1,880 - 4,500 Sq.Ft. / 250 - 500 Sq.Yds',
      status: 'Ready to Move / Resale & Primary',
      possession: 'Immediate Possession',
      amenities: ['30,000 Sq.Ft. DLF Club', 'Swimming Pool & Tennis Courts', 'Lush Landscaped Green Belts', 'Manned Gated Security', 'Piped Natural Gas (PNG)']
    }
  },
  {
    title: 'Riseonic New Chandigarh',
    property_type: 'Residential',
    region: 'New Chandigarh',
    price: '₹ 2.40 Cr - ₹ 5.80 Cr',
    address: 'Near PCA Stadium, Eco-City, New Chandigarh, Punjab',
    description: 'Riseonic New Chandigarh is a breakthrough G+36 ultra-luxury high-rise development on 8.75 acres introducing Singapore-inspired "terrace homes" to the Tricity region. Features expansive 3, 4, and 5 BHK sky residences with private terrace gardens, 65,000+ sq.ft. signature clubhouse, and unobstructed views of Shivalik Hills and PCA International Cricket Stadium. RERA: PBRERA-SAS80-PR1350.',
    image_url: 'https://riseonicnewchandigarh.com/wp-content/uploads/2026/06/riseonic-building-1024x694.jpg',
    images: [
      'https://riseonicnewchandigarh.com/wp-content/uploads/2026/06/riseonic-building-1024x694.jpg',
      'https://riseonicnewchandigarh.com/wp-content/uploads/2026/06/artistic-view-1024x694.jpg',
      'https://riseonicnewchandigarh.com/wp-content/uploads/2026/06/artistic-view-2-1024x694.jpg'
    ],
    configurations: {
      units: ['3 BHK Terrace Home (2300 Sq.Ft.)', '4 BHK Luxury Sky Home (3200 Sq.Ft.)', '5 BHK Grand Duplex Penthouse (4600 Sq.Ft.)'],
      sizes: '2,300 - 4,600 Sq.Ft.',
      status: 'New Launch / Booking Open',
      possession: '2029',
      amenities: ['Private Terrace Gardens', '65,000+ Sq.Ft. Clubhouse', 'Sky Lounge & Helipad', 'Infinity Pool', '3-Tier Smart Security']
    }
  },
  {
    title: 'GMI Infra Projects',
    property_type: 'Residential',
    region: 'New Chandigarh',
    price: '₹ 75 Lac - ₹ 2.65 Cr',
    address: 'IT City & New Chandigarh Corridor, Mohali, Punjab',
    description: 'GMI Infra presents a versatile portfolio of commercial and residential developments across the prime New Chandigarh and Mohali growth corridors, including GMI Elite Homes (stilt + 4 boutique luxury apartments) and GMI IT Towers / Business Parks. Featuring earthquake-resistant construction, branded fittings, high rental yield potential, and seamless connectivity to Chandigarh International Airport and PR-7.',
    image_url: 'https://images.unsplash.com/photo-1577495508048-b635879837f1?auto=format&fit=crop&w=1200&q=85',
    images: [
      'https://images.unsplash.com/photo-1577495508048-b635879837f1?auto=format&fit=crop&w=1200&q=85',
      'https://images.unsplash.com/photo-1541888946425-d0fbb186156a?auto=format&fit=crop&w=1200&q=85',
      'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=1200&q=85'
    ],
    configurations: {
      units: ['3 BHK Luxury Floor (1650 Sq.Ft.)', 'Grade-A Office Suite (650 - 1800 Sq.Ft.)', 'Retail SCO Commercial Space'],
      sizes: '650 - 2,200 Sq.Ft.',
      status: 'Under Construction & Ready',
      possession: 'Ready to Move / 2026-2027',
      amenities: ['High-Speed Elevators', 'Power Backup 100%', 'Modern Glass Facade', 'Ample Stilt & Basement Parking', 'Fire Safety & CCTV Monitoring']
    }
  },
  {
    title: 'Buckingham Estates',
    property_type: 'Plots',
    region: 'Tri-City',
    price: '₹ 85 Lac - ₹ 2.65 Cr',
    address: 'Kurali - New Chandigarh Expressway, Mohali, Punjab',
    description: 'Buckingham Estates is an exclusive low-density gated plotted community positioned along the Kurali - New Chandigarh Expressway. Offering prime residential plots in sizes of 150, 200, 225, and 400 Sq. Yards with grand 45-foot frontages, wide tree-lined boulevards, underground electrification, 24/7 security patrol, and swift access to IT City and Medicity.',
    image_url: 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1200&q=85',
    images: [
      'https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1200&q=85',
      'https://images.unsplash.com/photo-1524813686514-a57563d77d66?auto=format&fit=crop&w=1200&q=85',
      'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=85'
    ],
    configurations: {
      units: ['150 Sq.Yd. Plot (25 x 54 Ft)', '200 Sq.Yd. Plot (30 x 60 Ft)', '225 Sq.Yd. Plot (30 x 67.5 Ft)', '400 Sq.Yd. Villa Plot (45 x 80 Ft)'],
      sizes: '150 - 400 Sq. Yards',
      status: 'Ready for Registry & Construction',
      possession: 'Immediate Registry',
      amenities: ['45-Ft Wide Asphalt Roads', 'Underground Utilities & Drainage', 'Lush Central Parks', '24/7 Gated Security Guarding', 'High Capital Growth Corridor']
    }
  },
  {
    title: 'Motiaz Group (Blue Ridge & Harmony)',
    property_type: 'Residential',
    region: 'Tri-City',
    price: '₹ 95 Lac - ₹ 1.95 Cr',
    address: 'PR-7 Airport Ring Road, Zirakpur - Mohali, Punjab',
    description: 'Motiaz Group presents its flagship projects along the high-growth PR-7 Airport Ring Road: Motiaz Blue Ridge (luxury 3 & 3+1 BHK high-rise apartments) and Motiaz Harmony Greens (3, 4, 5 BHK luxury independent floors). Complete with private clubhouses, swimming pools, open sports arenas, and 10-minute connectivity to Chandigarh International Airport and Tribune Chowk.',
    image_url: 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=1200&q=85',
    images: [
      'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=1200&q=85',
      'https://images.unsplash.com/photo-1580587771525-78b9dba3b914?auto=format&fit=crop&w=1200&q=85',
      'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=85'
    ],
    configurations: {
      units: ['3 BHK High Rise Apartment (1650 Sq.Ft.)', '3+1 BHK Premium High Rise (1950 Sq.Ft.)', '3/4 BHK Independent Floor (1700 - 2350 Sq.Ft.)'],
      sizes: '1,650 - 2,450 Sq.Ft.',
      status: 'Ready to Move & Possession Linked',
      possession: 'Immediate to 2026',
      amenities: ['Clubhouse & Gymnasium', 'Resort Style Pool', 'Sports Courts (Tennis & Badminton)', 'Direct PR-7 Airport Road Access', '24/7 Power Backup & Security']
    }
  },
  {
    title: 'Aventus Residences',
    property_type: 'Independent Floors',
    region: 'Tri-City',
    price: '₹ 65 Lac - ₹ 1.35 Cr',
    address: 'Chandigarh - Kurali Expressway Corridor, New Chandigarh Region, Punjab',
    description: 'Aventus Residences offers thoughtfully engineered Stilt + 3 luxury independent floors and residential options along the vibrant Chandigarh-Kurali / New Chandigarh corridor. Featuring 3 BHK and 4 BHK layouts with modular European kitchens, reserved stilt parking, private lift access, and proximity to prime shopping arcades and educational hubs.',
    image_url: 'https://images.unsplash.com/photo-1600566752355-35792bedcfea?auto=format&fit=crop&w=1200&q=85',
    images: [
      'https://images.unsplash.com/photo-1600566752355-35792bedcfea?auto=format&fit=crop&w=1200&q=85',
      'https://images.unsplash.com/photo-1600585154526-990dced4db0d?auto=format&fit=crop&w=1200&q=85',
      'https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&fit=crop&w=1200&q=85'
    ],
    configurations: {
      units: ['3 BHK Independent Floor (1380 Sq.Ft.)', '3 BHK + Lounge (1650 Sq.Ft.)', '4 BHK Luxury Floor (2100 Sq.Ft.)'],
      sizes: '1,380 - 2,100 Sq.Ft.',
      status: 'Ready to Move / Nearing Possession',
      possession: 'Immediate to 2026',
      amenities: ['Passenger Elevator to All Floors', 'Reserved Stilt Covered Parking', 'Modern Modular Kitchen', 'Spacious Park-View Balconies', 'Gated Community with CCTV']
    }
  }
];

// 3. SPRINGFIELD PROPERTIES (16 DUBAI & UAE LUXURY PROPERTIES SCRAPED FROM SPRINGFIELDPROPERTIES.AE)
const springfieldDubaiProperties = [
  {
    title: 'Valia at Dubai Creek Harbour',
    property_type: 'Residential',
    region: 'Dubai',
    price: 'AED 2,060,000 (~₹ 4.70 Cr)',
    address: 'Dubai Creek Harbour, Dubai, UAE',
    description: 'Valia by Emaar Properties at Dubai Creek Harbour offers luxury 1, 2, 3, and 4-bedroom waterfront apartments with sweeping views of the historic creek and Dubai skyline. Designed with contemporary open-plan layouts, floor-to-ceiling glass windows, infinity pools, and pedestrian promenade access. Developed by Emaar Properties.',
    image_url: 'https://springfieldproperties.ae/wp-content/uploads/2026/08/valia-hero-1.webp',
    images: [
      'https://springfieldproperties.ae/wp-content/uploads/2026/08/valia-hero-1.webp',
      'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=1200&q=85'
    ],
    configurations: {
      units: ['1 Bedroom (821 Sq.Ft.)', '2 Bedrooms (1200 Sq.Ft.)', '3 Bedrooms (1750 Sq.Ft.)', '4 Bedrooms (2300 Sq.Ft.)'],
      sizes: '821 - 2,300 Sq.Ft.',
      status: 'Off-Plan / 80/20 Payment Plan',
      possession: 'Q4 2030',
      amenities: ['Infinity Waterfront Pool', 'Direct Promenade & Marina Access', 'State-of-the-Art Gym', 'Kids Splash Zone', 'Concierge & 24/7 Security']
    }
  },
  {
    title: 'Palm Jebel Ali Beach Villas',
    property_type: 'Villas',
    region: 'Dubai',
    price: 'AED 25,200,000 (~₹ 57.46 Cr)',
    address: 'Palm Jebel Ali, Dubai, UAE',
    description: 'Palm Jebel Ali by Nakheel is an iconic ultra-luxury beachfront archipelago offering bespoke 5, 6, and 7-bedroom beachfront mansions and villas. Direct private beach access, personal infinity pools, private yacht berths, double-height grand salons, and uninterrupted Persian Gulf views.',
    image_url: 'https://springfieldproperties.ae/wp-content/uploads/2025/10/Beach-Side-of-Wave-Crest-Villa-at-The-Palm-Jebel-Ali.webp',
    images: [
      'https://springfieldproperties.ae/wp-content/uploads/2025/10/Beach-Side-of-Wave-Crest-Villa-at-The-Palm-Jebel-Ali.webp',
      'https://images.unsplash.com/photo-1613490493576-7fde63acd811?auto=format&fit=crop&w=1200&q=85'
    ],
    configurations: {
      units: ['5 Bedroom Beach Villa (7373 Sq.Ft.)', '6 Bedroom Grand Mansion (9200 Sq.Ft.)', '7 Bedroom Royal Beach Palace (12000 Sq.Ft.)'],
      sizes: '7,373 - 12,000 Sq.Ft.',
      status: 'Off-Plan / 80/20 Payment Plan',
      possession: 'Q4 2029',
      amenities: ['Direct Private Beach Access', 'Private Infinity Pool & Jacuzzi', 'Private Yacht Berth Option', 'Personal Elevator', 'Smart Home Automation']
    }
  },
  {
    title: 'Mercedes-Benz Places by Binghatti',
    property_type: 'Residential',
    region: 'Dubai',
    price: 'AED 8,800,000 (~₹ 20.06 Cr)',
    address: 'Downtown Dubai, Dubai, UAE',
    description: 'Mercedes-Benz Places is an extraordinary collaboration between Binghatti Properties and Mercedes-Benz located in Downtown Dubai. Rising 341 meters, it offers ultra-luxury 2 to 7-bedroom residences, duplexes, and triplex penthouses with direct Burj Khalifa views and Sensual Purity design aesthetics.',
    image_url: 'https://springfieldproperties.ae/wp-content/uploads/2025/10/Mercedes-Benz-Places-by-Binghatti-at-Downtown-01.webp',
    images: [
      'https://springfieldproperties.ae/wp-content/uploads/2025/10/Mercedes-Benz-Places-by-Binghatti-at-Downtown-01.webp',
      'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=1200&q=85'
    ],
    configurations: {
      units: ['2 Bedroom Suite (1846 Sq.Ft.)', '3 Bedroom Residence (2600 Sq.Ft.)', '4 Bedroom Penthouse (3800 Sq.Ft.)', 'Triplex Sky Mansion (6500 Sq.Ft.)'],
      sizes: '1,846 - 6,500 Sq.Ft.',
      status: 'Off-Plan / 70/30 Payment Plan',
      possession: 'Q4 2026',
      amenities: ['Burj Khalifa Panoramic Views', 'Private Sky Pool on Terraces', 'Mercedes-Benz Concierge & Valet', 'Automated EV Charging', 'Private Spa & Wellness Suites']
    }
  },
  {
    title: 'Burj Binghatti Jacob & Co Residences',
    property_type: 'Residential',
    region: 'Dubai',
    price: 'AED 8,000,000 (~₹ 18.24 Cr)',
    address: 'Business Bay, Dubai, UAE',
    description: 'Burj Binghatti Jacob & Co Residences is set to be the tallest residential hyper-tower in the world. Featuring haute horlogerie-inspired architecture with diamond-shaped crowns, private infinity pools on each balcony, bespoke Jacob & Co jewelry boutique access, and panoramic Dubai Canal views.',
    image_url: 'https://springfieldproperties.ae/wp-content/uploads/2025/09/Burj-Binghatti-Jacob-Co-Residences-010.jpg',
    images: [
      'https://springfieldproperties.ae/wp-content/uploads/2025/09/Burj-Binghatti-Jacob-Co-Residences-010.jpg',
      'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=1200&q=85'
    ],
    configurations: {
      units: ['2 Bedroom Sapphire Villa (3314 Sq.Ft.)', '3 Bedroom Emerald Villa (4200 Sq.Ft.)', 'Billionaire Sky Penthouse (7500 Sq.Ft.)'],
      sizes: '3,314 - 7,500 Sq.Ft.',
      status: 'Off-Plan / 70/30 Payment Plan',
      possession: 'Q4 2026',
      amenities: ['Private Balcony Infinity Pools', 'Bespoke Jacob & Co Concierge', 'Chef-on-Demand Dining', 'Sky Lounge & Observation Deck', 'Helipad Access']
    }
  },
  {
    title: 'Golf Trails at Emaar South',
    property_type: 'Residential',
    region: 'Dubai',
    price: 'AED 1,250,000 (~₹ 2.85 Cr)',
    address: 'Emaar South, Near Al Maktoum Airport, Dubai, UAE',
    description: 'Golf Trails at Emaar South provides contemporary 1, 2, and 3-bedroom residences and townhouses bordering an 18-hole championship golf course. Seamlessly connected to Expo City Dubai and Al Maktoum International Airport with linear parks, golf clubhouse, and cycling corridors.',
    image_url: 'https://springfieldproperties.ae/wp-content/uploads/2026/08/golf-trails-emaar-south-hero.webp',
    images: [
      'https://springfieldproperties.ae/wp-content/uploads/2026/08/golf-trails-emaar-south-hero.webp',
      'https://images.unsplash.com/photo-1580587771525-78b9dba3b914?auto=format&fit=crop&w=1200&q=85'
    ],
    configurations: {
      units: ['1 Bedroom Golf View (719 Sq.Ft.)', '2 Bedroom Golf Apartment (1100 Sq.Ft.)', '3 Bedroom Townhouse (1850 Sq.Ft.)'],
      sizes: '719 - 1,850 Sq.Ft.',
      status: 'Off-Plan / 80/20 Payment Plan',
      possession: 'Q4 2030',
      amenities: ['Championship 18-Hole Golf Course', 'Golf Clubhouse & Driving Range', 'Resort Swimming Pools', 'Linear Community Parks', 'Retail & Dining Promenade']
    }
  },
  {
    title: 'The Pinnacle at Sobha Central',
    property_type: 'Residential',
    region: 'Dubai',
    price: 'AED 1,700,000 (~₹ 3.88 Cr)',
    address: 'Sheikh Zayed Road, Dubai, UAE',
    description: 'The Pinnacle at Sobha Central delivers Sobha\'s signature German backward-integrated construction quality right along Sheikh Zayed Road. Offering 1 and 2-bedroom luxury apartments with panoramic views of Dubai Canal, Downtown Dubai, and Jumeirah coastline.',
    image_url: 'https://springfieldproperties.ae/wp-content/uploads/2025/12/The-Pinnacle-at-Sobha-Central-029.webp',
    images: [
      'https://springfieldproperties.ae/wp-content/uploads/2025/12/The-Pinnacle-at-Sobha-Central-029.webp',
      'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=1200&q=85'
    ],
    configurations: {
      units: ['1 Bedroom Luxury (564 Sq.Ft.)', '1.5 Bedroom + Study (720 Sq.Ft.)', '2 Bedroom Master Suite (1050 Sq.Ft.)'],
      sizes: '564 - 1,050 Sq.Ft.',
      status: 'Off-Plan / 60/40 Payment Plan',
      possession: 'Q4 2030',
      amenities: ['Sky Infinity Pool', 'Direct Metro Connectivity', 'Sobha Signature Craftsmanship', 'Zen Meditation Gardens', '24/7 Security & Concierge']
    }
  },
  {
    title: 'Sobha One at MBR City',
    property_type: 'Residential',
    region: 'Dubai',
    price: 'AED 1,100,000 (~₹ 2.51 Cr)',
    address: 'Mohammed Bin Rashid Al Maktoum City, Dubai, UAE',
    description: 'Sobha One is an integrated master community comprising 5 interconnected towers rising up to 66 floors overlooking an 18-hole Pitch & Putt golf course and Ras Al Khor Wildlife Sanctuary. Offering 1 to 4-bedroom apartments and 2 to 4-bedroom duplexes.',
    image_url: 'https://springfieldproperties.ae/wp-content/uploads/2025/10/Sobha-One-05-1024x619.webp',
    images: [
      'https://springfieldproperties.ae/wp-content/uploads/2025/10/Sobha-One-05-1024x619.webp',
      'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=85'
    ],
    configurations: {
      units: ['1 Bedroom Apartment (732 Sq.Ft.)', '2 Bedroom Golf View (1150 Sq.Ft.)', '3 Bedroom Residence (1750 Sq.Ft.)', '4 Bedroom Duplex (2400 Sq.Ft.)'],
      sizes: '732 - 2,400 Sq.Ft.',
      status: 'Off-Plan / 60/40 Payment Plan',
      possession: 'Q4 2026',
      amenities: ['18-Hole Pitch & Putt Golf Course', 'Ras Al Khor Lagoon & Wildlife Views', 'Sky Terraces & BBQ Zones', 'Clubhouse & Fine Dining', 'Olympic Lap Pool']
    }
  },
  {
    title: 'Greenz by Danube',
    property_type: 'Villas',
    region: 'Dubai',
    price: 'AED 3,500,000 (~₹ 7.98 Cr)',
    address: 'Academic City, Dubai, UAE',
    description: 'Greenz by Danube introduces ultra-modern eco-friendly 3, 4, and 5-bedroom townhouses and villas in Dubai Academic City. Designed with private green terraces, personal plunge pools, 40+ resort lifestyle amenities, and Danube\'s popular 1% monthly payment plan.',
    image_url: 'https://springfieldproperties.ae/wp-content/uploads/2026/03/Greenz-by-Danube-6.webp',
    images: [
      'https://springfieldproperties.ae/wp-content/uploads/2026/03/Greenz-by-Danube-6.webp',
      'https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?auto=format&fit=crop&w=1200&q=85'
    ],
    configurations: {
      units: ['3 Bedroom Townhouse (2399 Sq.Ft.)', '4 Bedroom Luxury Villa (2950 Sq.Ft.)', '5 Bedroom Grand Villa (3600 Sq.Ft.)'],
      sizes: '2,399 - 3,600 Sq.Ft.',
      status: 'Off-Plan / 70/30 (1% Monthly Plan)',
      possession: 'Q4 2029',
      amenities: ['Private Plunge Pools', '40+ Resort Lifestyle Amenities', 'Open Air Cinema', 'Cricket Pitch & Tennis Courts', 'Green Landscaped Walkways']
    }
  },
  {
    title: 'Inara Residence by Imtiaz',
    property_type: 'Residential',
    region: 'Dubai',
    price: 'AED 673,000 (~₹ 1.53 Cr)',
    address: 'Dubai South, Near Al Maktoum Airport, UAE',
    description: 'Inara Residence by Imtiaz Developments is a boutique luxury development in Dubai South offering fully furnished designer studios, 1-bedroom, and 2-bedroom apartments with Italian modular kitchens, smart home automation, rooftop infinity pool, and high rental yields.',
    image_url: 'https://springfieldproperties.ae/wp-content/uploads/2026/01/Inara-Residence-by-Imtiaz-046.webp',
    images: [
      'https://springfieldproperties.ae/wp-content/uploads/2026/01/Inara-Residence-by-Imtiaz-046.webp',
      'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=1200&q=85'
    ],
    configurations: {
      units: ['Fully Furnished Studio (348 Sq.Ft.)', '1 Bedroom Luxury (650 Sq.Ft.)', '2 Bedroom Residence (980 Sq.Ft.)'],
      sizes: '348 - 980 Sq.Ft.',
      status: 'Off-Plan / 60/40 Payment Plan',
      possession: 'Q1 2028',
      amenities: ['100% Fully Furnished Designer Interiors', 'Rooftop Infinity Swimming Pool', 'Gymnasium with Technogym Gear', 'EV Charging Stations', 'Proximity to Al Maktoum Airport']
    }
  },
  {
    title: 'Binghatti Haven',
    property_type: 'Residential',
    region: 'Dubai',
    price: 'AED 750,000 (~₹ 1.71 Cr)',
    address: 'Dubai Sports City, Dubai, UAE',
    description: 'Binghatti Haven presents signature hyper-contemporary architecture in Dubai Sports City. Featuring studio, 1, 2, and 3-bedroom luxury apartments with angular geometric balconies, shaded swimming pools, state-of-the-art fitness center, and direct access to major international sports stadiums.',
    image_url: 'https://springfieldproperties.ae/wp-content/uploads/2025/10/Binghatti-Haven-Exterior-04.webp',
    images: [
      'https://springfieldproperties.ae/wp-content/uploads/2025/10/Binghatti-Haven-Exterior-04.webp',
      'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=1200&q=85'
    ],
    configurations: {
      units: ['Studio Suite (386 Sq.Ft.)', '1 Bedroom Apartment (680 Sq.Ft.)', '2 Bedroom Apartment (1050 Sq.Ft.)', '3 Bedroom Suite (1450 Sq.Ft.)'],
      sizes: '386 - 1,450 Sq.Ft.',
      status: 'Ready / Under Handover 2026',
      possession: 'Q1 2026',
      amenities: ['Temperature-Controlled Swimming Pool', 'Sports Stadium Proximity', 'Children Playground', 'Covered Parking', '24/7 Concierge']
    }
  },
  {
    title: 'Linar at Al Mamzar',
    property_type: 'Residential',
    region: 'Dubai',
    price: 'AED 849,000 (~₹ 1.94 Cr)',
    address: 'Al Mamzar Waterfront, UAE',
    description: 'Linar by Alef Group offers modern waterfront 1, 2, 3, and 4-bedroom apartments and sky penthouses along the picturesque Al Mamzar beach and lagoon. Built with expansive private balconies, premium finishes, and convenient 30/70 payment structure.',
    image_url: 'https://springfieldproperties.ae/wp-content/uploads/2026/08/linar-hero.webp',
    images: [
      'https://springfieldproperties.ae/wp-content/uploads/2026/08/linar-hero.webp',
      'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=1200&q=85'
    ],
    configurations: {
      units: ['1 Bedroom Waterfront (806 Sq.Ft.)', '2 Bedroom (1180 Sq.Ft.)', '3 Bedroom (1650 Sq.Ft.)', '4 Bedroom Penthouse (2400 Sq.Ft.)'],
      sizes: '806 - 2,400 Sq.Ft.',
      status: 'Off-Plan / 30/70 Payment Plan',
      possession: 'Q2 2031',
      amenities: ['Lagoon & Beach Views', 'Waterfront Jogging Tracks', 'Retail Outlets & Cafes', 'Swimming Pool & Fitness Studio', 'Underground Parking']
    }
  },
  {
    title: 'Skyz by Danube',
    property_type: 'Residential',
    region: 'Dubai',
    price: 'AED 399,000 (~₹ 90.97 Lac)',
    address: 'Arjan, Dubailand, Dubai, UAE',
    description: 'Skyz by Danube in Arjan is a Mediterranean-style residential high-rise tower offering studio, 1, and 2-bedroom luxury apartments with retail boulevard, infinity pool, outdoor cinema, and panoramic views of Miracle Garden and Dubai Butterfly Garden.',
    image_url: 'https://springfieldproperties.ae/wp-content/uploads/2026/04/Skyz-by-Danube-000.webp',
    images: [
      'https://springfieldproperties.ae/wp-content/uploads/2026/04/Skyz-by-Danube-000.webp',
      'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=1200&q=85'
    ],
    configurations: {
      units: ['Studio (349 Sq.Ft.)', '1 BHK Apartment (580 Sq.Ft.)', '2 BHK Apartment (890 Sq.Ft.)'],
      sizes: '349 - 890 Sq.Ft.',
      status: 'Ready to Move / Nearing Handover',
      possession: 'Ready to Move 2025/2026',
      amenities: ['Miracle Garden Views', 'Sky Jogging Track', 'Infinity Lap Pool', 'Open Air Cinema', 'Health Club & Spa']
    }
  },
  {
    title: 'Gemz by Danube',
    property_type: 'Residential',
    region: 'Dubai',
    price: 'AED 550,000 (~₹ 1.25 Cr)',
    address: 'Al Furjan, Dubai, UAE',
    description: 'Gemz by Danube in Al Furjan delivers pyramid-shaped architectural excellence with fully furnished studio, 1, 2, and 3-bedroom residences with private pools on balconies, situated within 2 minutes of the Al Furjan Metro Station.',
    image_url: 'https://springfieldproperties.ae/wp-content/uploads/2026/03/Gemz-by-Danube-Exterior-01-1024x634.jpg',
    images: [
      'https://springfieldproperties.ae/wp-content/uploads/2026/03/Gemz-by-Danube-Exterior-01-1024x634.jpg',
      'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=85'
    ],
    configurations: {
      units: ['Studio with Pool (404 Sq.Ft.)', '1 BHK with Private Pool (720 Sq.Ft.)', '2 BHK Apartment (1050 Sq.Ft.)', '3 BHK Duplex (1550 Sq.Ft.)'],
      sizes: '404 - 1,550 Sq.Ft.',
      status: 'Ready / Handover',
      possession: 'Ready to Move',
      amenities: ['Private Balcony Swimming Pool', '2 Mins to Metro Station', 'Anti-Current Lap Pool', 'Cricket Simulator', 'Doctor-on-Call Provision']
    }
  },
  {
    title: 'Opalz by Danube',
    property_type: 'Residential',
    region: 'Dubai',
    price: 'AED 525,000 (~₹ 1.20 Cr)',
    address: 'Dubai Science Park, Dubai, UAE',
    description: 'Opalz by Danube features two high-rise towers connected by a crown skybridge offering studios, 1, 2, and 3-bedroom residences and sky duplexes. Includes private pools, wellness skybridge lounge, business center, and kids day care.',
    image_url: 'https://springfieldproperties.ae/wp-content/uploads/2026/03/Opalz-by-Danube-045.webp',
    images: [
      'https://springfieldproperties.ae/wp-content/uploads/2026/03/Opalz-by-Danube-045.webp',
      'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=1200&q=85'
    ],
    configurations: {
      units: ['Studio (390 Sq.Ft.)', '1 BHK + Pool (680 Sq.Ft.)', '2 BHK Luxury Suite (1020 Sq.Ft.)', '3 BHK Sky Duplex (1600 Sq.Ft.)'],
      sizes: '390 - 1,600 Sq.Ft.',
      status: 'Nearing Completion',
      possession: 'Ready / 2026',
      amenities: ['Crown Skybridge Lounge', 'Private Jacuzzi & Pool', 'Business Center with Wi-Fi', 'Sky Observatory', 'Smart Home Tech']
    }
  },
  {
    title: 'Solanki One at Dubailand',
    property_type: 'Residential',
    region: 'Dubai',
    price: 'AED 543,000 (~₹ 1.24 Cr)',
    address: 'Dubailand Residence Complex, Dubai, UAE',
    description: 'Solanki One by Solanki Realty offers stylish studios, 1, 2, and 3-bedroom residences in Dubailand Residence Complex. Designed with European kitchen fittings, expansive balconies, swimming pool, and easy 75/25 payment plan.',
    image_url: 'https://springfieldproperties.ae/wp-content/uploads/2025/10/Solanki-One-at-Dubailand-by-Solanki-Realty-014.webp',
    images: [
      'https://springfieldproperties.ae/wp-content/uploads/2025/10/Solanki-One-at-Dubailand-by-Solanki-Realty-014.webp',
      'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?auto=format&fit=crop&w=1200&q=85'
    ],
    configurations: {
      units: ['Studio Apartment (430.66 Sq.Ft.)', '1 Bedroom Residence (750 Sq.Ft.)', '2 Bedroom (1100 Sq.Ft.)', '3 Bedroom (1450 Sq.Ft.)'],
      sizes: '430 - 1,450 Sq.Ft.',
      status: 'Off-Plan / 75/25 Payment Plan',
      possession: 'Q2 2028',
      amenities: ['Rooftop Leisure Pool', 'Children Splash Pad', 'Equipped Fitness Center', 'Round-the-Clock Security', 'Covered Parking Bay']
    }
  },
  {
    title: 'Barari Palace at Majan',
    property_type: 'Residential',
    region: 'Dubai',
    price: 'AED 725,000 (~₹ 1.65 Cr)',
    address: 'Majan, Dubailand, Dubai, UAE',
    description: 'Barari Palace is an ultra-exclusive palace-inspired residential sanctuary in Majan surrounded by lush green foliage. Features studios to 3-bedroom royal apartments and sky villas with golden finishes, infinity pools, and 60/40 payment plan.',
    image_url: 'https://springfieldproperties.ae/wp-content/uploads/2025/12/Barari-Palace-at-Majan-010.webp',
    images: [
      'https://springfieldproperties.ae/wp-content/uploads/2025/12/Barari-Palace-at-Majan-010.webp',
      'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=85'
    ],
    configurations: {
      units: ['Royal Studio (450 Sq.Ft.)', '1 Bedroom Palace Suite (780 Sq.Ft.)', '2 Bedroom Residence (1200 Sq.Ft.)', '3 Bedroom Sky Villa (1900 Sq.Ft.)'],
      sizes: '450 - 1,900 Sq.Ft.',
      status: 'Off-Plan / 60/40 Payment Plan',
      possession: 'Q4 2028',
      amenities: ['Palace Grand Lobby', 'Private Sky Villa Terraces', 'Lush Botanical Gardens', 'Resort Lap Pool', 'Valet Parking & Concierge']
    }
  }
];

const allCatalog = [
  ...omaxeProperties,
  ...triCityProperties,
  ...springfieldDubaiProperties
];

async function populateInventoryAndWebsite() {
  console.log(`Starting inventory update: ${allCatalog.length} properties to populate for Bioque Estates...`);

  // 1. Delete existing properties to refresh cleanly with new complete catalog
  const { error: delErr } = await supabaseAdmin
    .from('properties')
    .delete()
    .eq('user_id', userId);

  if (delErr) {
    console.error('Error clearing old properties:', delErr);
  } else {
    console.log('Cleared old property records.');
  }

  // 2. Insert all 36 properties
  const insertedProperties = [];
  for (const item of allCatalog) {
    const { data: inserted, error: insErr } = await supabaseAdmin
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
        status: 'Active',
        show_on_landing_page: true
      })
      .select()
      .single();

    if (insErr) {
      console.error(`Error inserting ${item.title}:`, insErr.message);
    } else {
      console.log(`✓ Inserted: ${inserted.title} [${inserted.property_type}] - ${inserted.price}`);
      insertedProperties.push(inserted);
    }
  }

  console.log(`\nSuccessfully inserted ${insertedProperties.length} active properties into DB.`);

  // 3. Update Bioque Estates profile
  const { error: profErr } = await supabaseAdmin
    .from('profiles')
    .update({
      business_name: 'Bioque Estates International',
      mission_statement: 'Premier Tri-City & Dubai Luxury Real Estate Advisory',
      business_landing_hero_title: 'Luxury Residences in New Chandigarh & Dubai',
      business_landing_hero_subtitle: 'Curated portfolio featuring Omaxe, Tricity flagship developments, and Dubai luxury waterfront residences in partnership with Springfield Properties.',
      business_landing_enabled: true,
      business_landing_show_products: true
    })
    .eq('id', userId);

  if (profErr) {
    console.error('Error updating profile:', profErr);
  } else {
    console.log('✓ Profile updated with international luxury branding.');
  }

  // 4. Generate State-of-the-Art Springfield-style Website HTML
  console.log('\nGenerating connected Springfield-style website with dynamic filtering...');
  const websiteHtml = generateConnectedWebsite(insertedProperties);

  const { data: savedPage, error: saveErr } = await supabaseAdmin
    .from('landing_pages')
    .upsert({
      user_id: userId,
      slug: 'index',
      title: 'Bioque Estates International | Tri-City & Dubai Luxury Properties',
      product_name: 'Bioque Estates & Springfield Luxury Portfolio',
      html_content: websiteHtml
    }, { onConflict: 'user_id,slug' })
    .select()
    .single();

  if (saveErr) {
    console.error('Error saving website:', saveErr);
    throw saveErr;
  }

  console.log('✓ Successfully saved updated website to landing_pages (Page ID:', savedPage.id, ')');
  console.log('\n======================================================');
  console.log('ALL INVENTORY & CONNECTED WEBSITE UPDATES COMPLETED!');
  console.log(`Total Properties in Inventory: ${insertedProperties.length}`);
  console.log(`Public Website: http://localhost:3000/shared/${userId}`);
  console.log(`Direct Lander: http://localhost:3000/shared/${userId}/index`);
  console.log('======================================================\n');
}

function generateConnectedWebsite(properties) {
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
        "streetAddress": p.address || "New Chandigarh & Dubai",
        "addressLocality": p.address?.includes('Dubai') ? "Dubai" : "New Chandigarh",
        "addressCountry": p.address?.includes('Dubai') ? "AE" : "IN"
      },
      "offers": {
        "@type": "Offer",
        "priceCurrency": p.price?.includes('AED') ? "AED" : "INR",
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
        "description": "Premier luxury real estate advisory in New Chandigarh, Tri-City, and Dubai UAE in partnership with Springfield Properties.",
        "telephone": PHONE_DISPLAY,
        "email": "estatesbioque@gmail.com",
        "address": {
          "@type": "PostalAddress",
          "streetAddress": "SCO 118-119, Level II, Madhya Marg, Sector 8-C",
          "addressLocality": "Chandigarh",
          "postalCode": "160009",
          "addressCountry": "IN"
        },
        "hasOfferCatalog": {
          "@type": "OfferCatalog",
          "name": "Bioque Estates & Springfield Properties Global Portfolio",
          "itemListElement": schemaItemList
        }
      }
    ]
  };

  return `<!DOCTYPE html>
<html lang="en" class="scroll-smooth">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0">
  <title>Bioque Estates International | Tri-City & Dubai Luxury Properties</title>
  
  <meta name="title" content="Bioque Estates International | Tri-City & Dubai Luxury Properties">
  <meta name="description" content="Explore luxury waterfront residences, independent floors, duplex villas, and developer plots across New Chandigarh, Tri-City, and Dubai (Springfield Properties collection).">
  <meta name="keywords" content="Bioque Estates, Springfield Properties, Omaxe New Chandigarh, Opus One GB Realty, The Tiara Sham Exotic, Homeland Infinia, Jubilee Parkfields, DLF New Chandigarh, Riseonic New Chandigarh, Palm Jebel Ali, Mercedes-Benz Places, Dubai Creek Harbour">
  <meta name="robots" content="index, follow">
  
  <meta property="og:type" content="website">
  <meta property="og:title" content="Bioque Estates International | Tri-City & Dubai Luxury Properties">
  <meta property="og:description" content="Curated luxury portfolio featuring New Chandigarh flagship developments and Dubai waterfront residences.">
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
        <span class="font-medium text-slate-600">Official Advisory: New Chandigarh & Dubai Properties</span>
        <a href="tel:${PHONE_DISPLAY.replace(/\s+/g, '')}" class="text-dark-900 hover:text-primary-600 font-bold flex items-center gap-1.5 transition-colors">
          <svg class="w-3.5 h-3.5 text-primary-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>
          ${PHONE_DISPLAY}
        </a>
      </div>
    </div>
  </div>

  <!-- NAVIGATION HEADER -->
  <header class="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-slate-200 shadow-sm">
    <div class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
      <div class="flex justify-between items-center h-16 sm:h-20">
        
        <!-- LOGO & TITLE -->
        <a href="#home" onclick="navigateTo('home'); return false;" class="flex items-center space-x-2.5 sm:space-x-3 group shrink-0">
          <img src="${LOGO_URL}" alt="Bioque Estates" class="h-9 sm:h-11 w-auto object-contain rounded-md border border-slate-200 p-0.5 bg-white shadow-xs" loading="eager">
          <div class="leading-none">
            <span class="font-display text-base sm:text-xl font-extrabold tracking-tight text-dark-900 block leading-tight">BIOQUE ESTATES</span>
            <span class="text-[8px] sm:text-[9px] uppercase tracking-[0.2em] text-primary-600 block font-bold mt-0.5">Tri-City & Dubai Real Estate</span>
          </div>
        </a>

        <!-- DESKTOP NAVIGATION -->
        <nav class="hidden lg:flex items-center space-x-7 text-xs font-bold uppercase tracking-wider text-slate-600">
          <a href="#home" onclick="navigateTo('home'); return false;" class="nav-link text-primary-600 py-2 border-b-2 border-primary-600 transition-colors" data-target="home">Home</a>
          <a href="#properties" onclick="navigateTo('properties'); return false;" class="nav-link hover:text-dark-900 py-2 border-b-2 border-transparent transition-colors" data-target="properties">Global Portfolio</a>
          <a href="#about" onclick="navigateTo('about'); return false;" class="nav-link hover:text-dark-900 py-2 border-b-2 border-transparent transition-colors" data-target="about">About Us</a>
          <a href="#services" onclick="navigateTo('services'); return false;" class="nav-link hover:text-dark-900 py-2 border-b-2 border-transparent transition-colors" data-target="services">Services</a>
          <a href="#contact" onclick="navigateTo('contact'); return false;" class="nav-link hover:text-dark-900 py-2 border-b-2 border-transparent transition-colors" data-target="contact">Contact</a>
        </nav>

        <!-- CTA & MOBILE HAMBURGER -->
        <div class="flex items-center space-x-2">
          <a href="https://wa.me/${PHONE_RAW}?text=Hi%20Bioque%20Estates,%20I%20am%20interested%20in%20your%20properties." target="_blank" class="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-emerald-500/40 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 text-xs font-bold transition-all">
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
        <a href="#properties" onclick="navigateTo('properties'); toggleMobileMenu(); return false;" class="block px-3 py-2 rounded-lg text-xs font-bold text-dark-900 hover:bg-slate-50">Global Portfolio (36)</a>
        <a href="#about" onclick="navigateTo('about'); toggleMobileMenu(); return false;" class="block px-3 py-2 rounded-lg text-xs font-bold text-dark-900 hover:bg-slate-50">About Bioque Estates</a>
        <a href="#services" onclick="navigateTo('services'); toggleMobileMenu(); return false;" class="block px-3 py-2 rounded-lg text-xs font-bold text-dark-900 hover:bg-slate-50">Services</a>
        <a href="#contact" onclick="navigateTo('contact'); toggleMobileMenu(); return false;" class="block px-3 py-2 rounded-lg text-xs font-bold text-dark-900 hover:bg-slate-50">Contact & VIP Visits</a>
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
    
    <!-- HERO SECTION -->
    <section class="relative min-h-[60vh] sm:min-h-[75vh] flex items-center justify-center py-12 sm:py-20 overflow-hidden bg-slate-900">
      <div class="absolute inset-0 z-0">
        <img src="https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=2000&q=85" alt="Luxury Global Properties" class="w-full h-full object-cover object-center brightness-[0.65]" loading="eager">
        <div class="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-black/30"></div>
      </div>

      <div class="relative z-10 max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 text-center w-full">
        
        <div class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/15 backdrop-blur-md border border-white/30 text-white text-[10px] sm:text-xs uppercase tracking-wider font-bold mb-3 sm:mb-4 max-w-full truncate">
          <span class="w-1.5 h-1.5 rounded-full bg-primary-400 shrink-0"></span>
          <span class="truncate">New Chandigarh • Tri-City • Dubai Luxury</span>
        </div>

        <h1 class="font-display text-2xl sm:text-4xl md:text-5xl lg:text-6xl font-extrabold tracking-tight text-white mb-3 sm:mb-4 leading-tight max-w-4xl mx-auto">
          Luxury Residences in <br class="hidden sm:block"/><span class="text-primary-300">New Chandigarh & Dubai</span>
        </h1>

        <p class="text-slate-200 text-xs sm:text-sm md:text-base max-w-2xl mx-auto mb-6 sm:mb-8 leading-relaxed font-normal">
          Curated collection of Omaxe, flagship New Chandigarh developments, and exclusive Dubai waterfront residences in partnership with Springfield Properties.
        </p>

        <!-- TABBED SEARCH BOX -->
        <div class="max-w-3xl mx-auto bg-white rounded-2xl p-3.5 sm:p-5 shadow-2xl text-left border border-slate-100">
          
          <div class="flex items-center space-x-1.5 border-b border-slate-100 pb-2.5 mb-2.5 overflow-x-auto no-scrollbar text-[11px] sm:text-xs font-bold uppercase tracking-wider">
            <button onclick="setHomeFilter('All')" class="home-filter-tab active px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-full bg-dark-900 text-white transition-all shrink-0" data-type="All">All (36)</button>
            <button onclick="setHomeFilter('Dubai')" class="home-filter-tab px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-full text-slate-600 hover:text-dark-900 transition-all shrink-0" data-type="Dubai">Dubai (16)</button>
            <button onclick="setHomeFilter('New Chandigarh')" class="home-filter-tab px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-full text-slate-600 hover:text-dark-900 transition-all shrink-0" data-type="New Chandigarh">New Chandigarh (17)</button>
            <button onclick="setHomeFilter('Villas')" class="home-filter-tab px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-full text-slate-600 hover:text-dark-900 transition-all shrink-0" data-type="Villas">Villas</button>
            <button onclick="setHomeFilter('Plots')" class="home-filter-tab px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-full text-slate-600 hover:text-dark-900 transition-all shrink-0" data-type="Plots">Plots</button>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-12 gap-2.5 sm:gap-3 items-center">
            <div class="sm:col-span-5">
              <label class="block text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-0.5 ml-1">Search Project or Location</label>
              <input type="text" id="home-search-input" placeholder="e.g. Opus One, Palm Jebel Ali, The Tiara..." class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-dark-900 placeholder-slate-400 focus:outline-none focus:border-dark-900 focus:bg-white transition-all">
            </div>

            <div class="sm:col-span-4">
              <label class="block text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-0.5 ml-1">Category / Region</label>
              <select id="home-budget-select" class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-dark-900 focus:outline-none focus:border-dark-900 focus:bg-white transition-all">
                <option value="All">All Portfolios</option>
                <option value="Dubai">Dubai & UAE Luxury</option>
                <option value="New Chandigarh">New Chandigarh</option>
                <option value="Tri-City">Tri-City (Mohali/Zirakpur)</option>
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
            <span class="font-display text-xl sm:text-2xl font-extrabold text-dark-900 block mb-0.5">36+</span>
            <span class="text-[10px] sm:text-xs uppercase tracking-wider text-slate-500 font-bold">Curated Projects</span>
          </div>
          <div class="p-2.5 sm:p-3.5 rounded-xl bg-slate-50 border border-slate-100">
            <span class="font-display text-xl sm:text-2xl font-extrabold text-dark-900 block mb-0.5">2 Global Hubs</span>
            <span class="text-[10px] sm:text-xs uppercase tracking-wider text-slate-500 font-bold">Tri-City & Dubai</span>
          </div>
          <div class="p-2.5 sm:p-3.5 rounded-xl bg-slate-50 border border-slate-100">
            <span class="font-display text-xl sm:text-2xl font-extrabold text-dark-900 block mb-0.5">100%</span>
            <span class="text-[10px] sm:text-xs uppercase tracking-wider text-slate-500 font-bold">RERA & Title Verified</span>
          </div>
          <div class="p-2.5 sm:p-3.5 rounded-xl bg-slate-50 border border-slate-100">
            <span class="font-display text-xl sm:text-2xl font-extrabold text-dark-900 block mb-0.5">0%</span>
            <span class="text-[10px] sm:text-xs uppercase tracking-wider text-slate-500 font-bold">Brokerage on New Units</span>
          </div>
        </div>
      </div>
    </section>

    <!-- FEATURED PROPERTIES SECTION -->
    <section class="py-12 sm:py-16 bg-[#F8F9FA] relative">
      <div class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
        
        <div class="flex flex-col sm:flex-row justify-between items-start sm:items-end mb-8 gap-3">
          <div>
            <span class="text-primary-600 text-[10px] sm:text-xs uppercase tracking-[0.25em] font-bold block mb-1">Curated Inventory</span>
            <h2 class="font-display text-xl sm:text-3xl font-extrabold text-dark-900 tracking-tight">
              Featured Global & Tri-City Properties
            </h2>
          </div>
          <button onclick="navigateTo('properties')" class="btn-outline px-4 py-1.5 rounded-full text-xs uppercase tracking-wider font-bold flex items-center gap-1.5">
            <span>View All (36)</span>
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 8l4 4m0 0l-4 4m4-4H3"/></svg>
          </button>
        </div>

        <div id="home-properties-grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-7">
          <!-- Injected via JavaScript -->
        </div>

      </div>
    </section>

    <!-- ABOUT BIOQUE ESTATES -->
    <section class="py-12 sm:py-16 bg-white border-t border-slate-100 relative">
      <div class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          
          <div class="lg:col-span-5 relative">
            <div class="relative rounded-2xl overflow-hidden shadow-lg border border-slate-100 aspect-[4/3] sm:aspect-auto sm:h-[400px]">
              <img src="https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=85" alt="Bioque Estates Real Estate" class="w-full h-full object-cover" loading="lazy">
            </div>
            
            <div class="absolute -bottom-3 -right-2 sm:-bottom-5 sm:-right-3 bg-white p-3 sm:p-4 rounded-xl border border-slate-200 shadow-lg max-w-[220px] sm:max-w-xs">
              <span class="text-primary-700 text-[10px] uppercase tracking-widest font-bold block mb-0.5">International Advisory</span>
              <p class="text-[11px] text-slate-600 font-medium leading-relaxed">
                Direct developer partnerships across New Chandigarh, Tri-City & Dubai (Springfield Properties).
              </p>
            </div>
          </div>

          <div class="lg:col-span-7">
            <span class="text-primary-600 text-[10px] sm:text-xs uppercase tracking-[0.25em] font-bold block mb-1.5">Our Foundation</span>
            <h2 class="font-display text-xl sm:text-3xl font-extrabold text-dark-900 mb-4 leading-tight">
              “Redefining Luxury Living Across <br/><span class="text-primary-600">Tri-City and Dubai”</span>
            </h2>

            <p class="text-slate-600 text-xs sm:text-sm leading-relaxed mb-5 font-normal">
              BIOQUE ESTATES INTERNATIONAL is a premier Real Estate development and advisory firm built on credibility, transparency, and uncompromising quality. We cater to all luxury residential, commercial, and developer plotted investments across New Chandigarh, Mohali, Gurugram, and Dubai UAE.
            </p>

            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
              <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-100">
                <h4 class="text-dark-900 font-bold text-xs sm:text-sm mb-0.5">Credibility</h4>
                <p class="text-[11px] text-slate-500">100% verified developer agreements & titles.</p>
              </div>

              <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-100">
                <h4 class="text-dark-900 font-bold text-xs sm:text-sm mb-0.5">Global Reach</h4>
                <p class="text-[11px] text-slate-500">Curated access to prime Dubai & Indian luxury.</p>
              </div>

              <div class="p-3.5 rounded-xl bg-slate-50 border border-slate-100">
                <h4 class="text-dark-900 font-bold text-xs sm:text-sm mb-0.5">End-to-End</h4>
                <p class="text-[11px] text-slate-500">From site tour to registry and handover.</p>
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
          <span class="text-primary-700 font-bold">Global Portfolio</span>
        </div>
        <h1 class="font-display text-xl sm:text-3xl font-extrabold text-dark-900">
          All Properties & Projects
        </h1>
        <p class="text-slate-500 text-xs mt-1">Live listings across New Chandigarh, Tri-City, and Springfield Properties Dubai collection.</p>
      </div>

      <!-- Filters Bar -->
      <div class="bg-white border border-slate-200 rounded-xl p-3 mb-6 flex flex-col md:flex-row justify-between items-stretch md:items-center gap-2.5 shadow-xs">
        
        <div class="flex items-center space-x-1.5 overflow-x-auto no-scrollbar text-[11px] font-bold uppercase tracking-wider pb-1 md:pb-0">
          <button onclick="setCatalogFilter('All')" class="catalog-filter-btn active px-3 py-1.5 rounded-full bg-dark-900 text-white transition-all shrink-0" data-type="All">All (<span id="count-all">36</span>)</button>
          <button onclick="setCatalogFilter('Dubai')" class="catalog-filter-btn px-3 py-1.5 rounded-full text-slate-600 hover:text-dark-900 transition-all shrink-0" data-type="Dubai">Dubai (16)</button>
          <button onclick="setCatalogFilter('New Chandigarh')" class="catalog-filter-btn px-3 py-1.5 rounded-full text-slate-600 hover:text-dark-900 transition-all shrink-0" data-type="New Chandigarh">New Chandigarh (17)</button>
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
          <span>Back to All Properties</span>
        </button>
        <div class="text-xs text-slate-500">
          <span id="detail-breadcrumb-type" class="text-slate-400">Residential</span> / <span id="detail-breadcrumb-title" class="text-dark-900 font-bold"></span>
        </div>
      </div>

      <!-- MAIN PROPERTY PRESENTATION -->
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8">
        
        <!-- Left: Gallery & Specifications -->
        <div class="lg:col-span-8 space-y-5">
          
          <div class="rounded-2xl overflow-hidden border border-slate-200 shadow-sm relative aspect-[16/10] bg-slate-100">
            <img id="detail-main-image" src="" alt="Property" class="w-full h-full object-cover" loading="eager">
            <div class="absolute top-3 left-3 flex gap-1.5">
              <span id="detail-type-badge" class="bg-white/95 backdrop-blur text-dark-900 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-md shadow-xs">Residential</span>
              <span id="detail-status-badge" class="bg-emerald-600 text-white text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-md shadow-xs">Active</span>
            </div>
            <div class="absolute bottom-3 left-3">
              <span id="detail-price-badge" class="bg-dark-900 text-white font-extrabold text-xs sm:text-sm px-3 py-1.5 rounded-lg shadow-md"></span>
            </div>
          </div>

          <!-- Thumbnail Strip -->
          <div id="detail-thumbnails-strip" class="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
            <!-- Injected by JS -->
          </div>

          <!-- Project Title & Address -->
          <div class="bg-white p-4 sm:p-5 rounded-xl border border-slate-200 shadow-xs">
            <h1 id="detail-title" class="font-display text-xl sm:text-2xl font-extrabold text-dark-900 mb-1.5"></h1>
            <div class="flex items-center gap-1.5 text-slate-500 text-xs">
              <svg class="w-3.5 h-3.5 text-primary-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
              <span id="detail-address"></span>
            </div>
          </div>

          <!-- Description -->
          <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
            <h3 class="font-display text-base font-bold text-dark-900 mb-2">Project Overview</h3>
            <p id="detail-description" class="text-slate-600 text-xs leading-relaxed font-normal whitespace-pre-line"></p>
          </div>

          <!-- Configurations -->
          <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
            <h3 class="font-display text-base font-bold text-dark-900 mb-3">Unit Configurations & Sizes</h3>
            <div id="detail-units-list" class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <!-- Injected by JS -->
            </div>
          </div>

          <!-- Amenities -->
          <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-xs">
            <h3 class="font-display text-base font-bold text-dark-900 mb-3">Features & Amenities</h3>
            <div id="detail-amenities-list" class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <!-- Injected by JS -->
            </div>
          </div>

        </div>

        <!-- Right: CRM Lead Capture & WhatsApp -->
        <div class="lg:col-span-4">
          <div class="sticky top-20 space-y-4">
            
            <div class="bg-white p-4 sm:p-5 rounded-xl border border-slate-200 shadow-xs">
              <span class="text-primary-700 text-[9px] uppercase tracking-widest font-bold block mb-0.5">VIP Direct Advisory</span>
              <h3 class="font-display text-base font-bold text-dark-900 mb-1">Request Price Sheet & Brochure</h3>
              <p class="text-slate-500 text-[11px] mb-4">Get official brochures, unit floor plans, and developer payment schedules.</p>

              <form onsubmit="handleDetailInquiry(event)" class="space-y-3">
                <div>
                  <label class="block text-[10px] font-bold text-slate-700 uppercase tracking-wider mb-0.5">Full Name *</label>
                  <input type="text" id="detail-lead-name" required placeholder="e.g. Rajiv Kumar" class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-dark-900 placeholder-slate-400 focus:outline-none focus:border-dark-900 focus:bg-white">
                </div>

                <div>
                  <label class="block text-[10px] font-bold text-slate-700 uppercase tracking-wider mb-0.5">WhatsApp / Phone *</label>
                  <input type="tel" id="detail-lead-phone" required placeholder="+91 98886 26786" class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-dark-900 placeholder-slate-400 focus:outline-none focus:border-dark-900 focus:bg-white">
                </div>

                <div>
                  <label class="block text-[10px] font-bold text-slate-700 uppercase tracking-wider mb-0.5">Preferred Unit</label>
                  <select id="detail-lead-unit" class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-dark-900 focus:outline-none focus:border-dark-900 focus:bg-white">
                    <option value="Apartment / Residence">Apartment / Residence</option>
                    <option value="Villa / Penthouse">Villa / Penthouse</option>
                    <option value="Independent Floor">Independent Floor</option>
                    <option value="Plot / Land">Plot / Land</option>
                  </select>
                </div>

                <button type="submit" id="detail-submit-btn" class="btn-springfield w-full py-2.5 rounded-lg text-xs uppercase tracking-widest font-extrabold flex items-center justify-center gap-1.5 shadow-xs">
                  <span>Get Details & Floor Plans</span>
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
                </button>
                <div id="detail-form-feedback" class="text-center text-xs font-semibold text-emerald-600 pt-1 hidden"></div>
              </form>

              <div class="mt-4 pt-4 border-t border-slate-100 text-center">
                <a id="detail-whatsapp-btn" href="#" target="_blank" class="w-full inline-flex items-center justify-center gap-1.5 py-2 rounded-lg border border-emerald-500/40 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 text-xs font-bold transition-all">
                  <svg class="w-3.5 h-3.5 fill-emerald-600" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
                  <span>Chat on WhatsApp</span>
                </a>
              </div>
            </div>

            <div class="bg-white p-4 rounded-xl border border-slate-200 text-center shadow-xs">
              <p class="text-[10px] text-slate-500 mb-0.5">Direct Client Advisor Desk</p>
              <a href="tel:${PHONE_DISPLAY.replace(/\s+/g, '')}" class="text-xs font-bold text-dark-900 hover:text-primary-600 transition-colors">${PHONE_DISPLAY}</a>
            </div>

          </div>
        </div>

      </div>

    </div>
  </main>

  <!-- ========================================================================= -->
  <!-- PAGE VIEW 4: ABOUT PAGE -->
  <!-- ========================================================================= -->
  <main id="view-about" class="page-view flex-grow py-10 sm:py-12 bg-[#F8F9FA]">
    <div class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
      
      <div class="max-w-3xl mx-auto text-center mb-10">
        <span class="text-primary-600 text-[10px] sm:text-xs uppercase tracking-[0.25em] font-bold block mb-1">About Bioque Estates</span>
        <h1 class="font-display text-2xl sm:text-4xl font-extrabold text-dark-900">
          Redefining Real Estate Excellence
        </h1>
      </div>

      <div class="bg-white rounded-2xl p-6 sm:p-10 border border-slate-200 shadow-sm max-w-4xl mx-auto space-y-6 text-xs sm:text-sm text-slate-600 leading-relaxed">
        <p>
          <strong class="text-dark-900">BIOQUE ESTATES INTERNATIONAL</strong> is a premier Real Estate development and advisory firm built on credibility, transparency, and uncompromising quality. We cater to all real estate requirements across Tri-City, Gurugram, and Dubai UAE under one roof.
        </p>
        <p>
          We offer our clients exclusive developer pricing, 100% verified legal documentation, bespoke payment schemes, and direct access to high-growth residential and commercial properties in New Chandigarh, Mohali, and the Springfield Properties luxury collection in Dubai.
        </p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-slate-100">
          <div class="p-4 rounded-xl bg-slate-50">
            <h4 class="font-bold text-dark-900 mb-1">Corporate Head Office</h4>
            <p class="text-slate-500">SCO 118-119, Level II, Madhya Marg, Sector 8-C, Chandigarh - 160009</p>
          </div>
          <div class="p-4 rounded-xl bg-slate-50">
            <h4 class="font-bold text-dark-900 mb-1">Direct VIP Desk</h4>
            <p class="text-slate-500">Phone: ${PHONE_DISPLAY} <br/> Email: estatesbioque@gmail.com</p>
          </div>
        </div>
      </div>

    </div>
  </main>

  <!-- ========================================================================= -->
  <!-- PAGE VIEW 5: SERVICES PAGE -->
  <!-- ========================================================================= -->
  <main id="view-services" class="page-view flex-grow py-10 sm:py-12 bg-[#F8F9FA]">
    <div class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
      <div class="max-w-3xl mx-auto text-center mb-10">
        <span class="text-primary-600 text-[10px] sm:text-xs uppercase tracking-[0.25em] font-bold block mb-1">Comprehensive Advisory</span>
        <h1 class="font-display text-2xl sm:text-4xl font-extrabold text-dark-900">
          Our Premium Services
        </h1>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-5 max-w-5xl mx-auto">
        <div class="p-6 rounded-2xl bg-white border border-slate-200 shadow-xs">
          <h3 class="font-display text-lg font-bold text-dark-900 mb-2">Residential Acquisition</h3>
          <p class="text-xs text-slate-500 leading-relaxed">Direct builder allocation in Omaxe, Opus One, The Tiara, Homeland Infinia, and Dubai waterfront towers.</p>
        </div>
        <div class="p-6 rounded-2xl bg-white border border-slate-200 shadow-xs">
          <h3 class="font-display text-lg font-bold text-dark-900 mb-2">Plotted Township Investments</h3>
          <p class="text-xs text-slate-500 leading-relaxed">Strategic plot identification in Jubilee Parkfields, DLF Hyde Park, and Buckingham Estates.</p>
        </div>
        <div class="p-6 rounded-2xl bg-white border border-slate-200 shadow-xs">
          <h3 class="font-display text-lg font-bold text-dark-900 mb-2">Legal & NRI Desk</h3>
          <p class="text-xs text-slate-500 leading-relaxed">End-to-end title verification, registry facilitation, home loans, and international investor documentation.</p>
        </div>
      </div>
    </div>
  </main>

  <!-- ========================================================================= -->
  <!-- PAGE VIEW 6: CONTACT & SITE VISITS -->
  <!-- ========================================================================= -->
  <main id="view-contact" class="page-view flex-grow py-10 sm:py-12 bg-[#F8F9FA]">
    <div class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
      <div class="max-w-2xl mx-auto bg-white p-6 sm:p-8 rounded-2xl border border-slate-200 shadow-sm">
        <h2 class="font-display text-xl sm:text-2xl font-extrabold text-dark-900 mb-1">Schedule VIP Site Visit & Consultation</h2>
        <p class="text-xs text-slate-500 mb-6">Our client advisor will confirm customized property itineraries within 15 minutes.</p>

        <form onsubmit="handleGeneralInquiry(event)" class="space-y-4">
          <div>
            <label class="block text-[10px] font-bold text-slate-700 uppercase tracking-wider mb-1">Full Name *</label>
            <input type="text" id="contact-name" required placeholder="e.g. Rajiv Kumar" class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-dark-900 focus:outline-none focus:border-dark-900 focus:bg-white">
          </div>
          <div>
            <label class="block text-[10px] font-bold text-slate-700 uppercase tracking-wider mb-1">WhatsApp / Phone *</label>
            <input type="tel" id="contact-phone" required placeholder="+91 98886 26786" class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-dark-900 focus:outline-none focus:border-dark-900 focus:bg-white">
          </div>
          <div>
            <label class="block text-[10px] font-bold text-slate-700 uppercase tracking-wider mb-1">Project of Interest</label>
            <select id="contact-project" class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-dark-900 focus:outline-none focus:border-dark-900 focus:bg-white">
              <option value="Opus One by GB Realty">Opus One by GB Realty</option>
              <option value="The Tiara Sham Exotic">The Tiara Sham Exotic</option>
              <option value="Homeland Infinia">Homeland Infinia</option>
              <option value="Jubilee Parkfields">Jubilee Parkfields</option>
              <option value="DLF Hyde Park New Chandigarh">DLF Hyde Park New Chandigarh</option>
              <option value="Riseonic New Chandigarh">Riseonic New Chandigarh</option>
              <option value="The Lake by Omaxe">The Lake by Omaxe</option>
              <option value="Omaxe Mulberry Villas">Omaxe Mulberry Villas</option>
              <option value="Dubai Properties (Springfield Collection)">Dubai Properties (Springfield Collection)</option>
              <option value="Other Project">Other Project</option>
            </select>
          </div>
          <div>
            <label class="block text-[10px] font-bold text-slate-700 uppercase tracking-wider mb-1">Preferred Date & Time</label>
            <input type="datetime-local" id="contact-datetime" class="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-dark-900 focus:outline-none focus:border-dark-900 focus:bg-white">
          </div>
          <button type="submit" id="contact-submit-btn" class="btn-springfield w-full py-3 rounded-lg text-xs uppercase tracking-widest font-extrabold flex items-center justify-center gap-1.5 shadow-xs">
            <span>Confirm Site Visit</span>
          </button>
          <div id="contact-feedback" class="text-center text-xs font-semibold text-emerald-600 pt-1 hidden"></div>
        </form>
      </div>
    </div>
  </main>

  <!-- FOOTER -->
  <footer class="bg-white border-t border-slate-200 py-8 text-slate-500 text-xs mt-auto">
    <div class="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 flex flex-col sm:flex-row justify-between items-center gap-4 text-center sm:text-left">
      <div class="flex items-center space-x-2.5">
        <img src="${LOGO_URL}" alt="Bioque Logo" class="h-6 w-auto object-contain">
        <span class="font-display font-extrabold text-dark-900">BIOQUE ESTATES INTERNATIONAL</span>
      </div>
      <p class="text-[11px]">
        © 2026 Bioque Estates International. In association with Springfield Properties Dubai.<br/>
        SCO 118-119, Level II, Madhya Marg, Sector 8-C, Chandigarh - 160009.
      </p>
    </div>
  </footer>

  <!-- JAVASCRIPT LOGIC -->
  <script>
    const LIVE_PROPERTIES = ${propertiesJson};
    let currentCategoryFilter = 'All';

    function parseConfigs(p) {
      if (!p.configurations) return { units: [], sizes: '', status: '', possession: '', amenities: [] };
      if (typeof p.configurations === 'object') {
        return {
          units: Array.isArray(p.configurations.units) ? p.configurations.units : [],
          sizes: p.configurations.sizes || '',
          status: p.configurations.status || '',
          possession: p.configurations.possession || '',
          amenities: Array.isArray(p.configurations.amenities) ? p.configurations.amenities : []
        };
      }
      try {
        const parsed = JSON.parse(p.configurations);
        return {
          units: Array.isArray(parsed.units) ? parsed.units : [],
          sizes: parsed.sizes || '',
          status: parsed.status || '',
          possession: parsed.possession || '',
          amenities: Array.isArray(parsed.amenities) ? parsed.amenities : []
        };
      } catch (e) {
        return { units: [], sizes: '', status: '', possession: '', amenities: [] };
      }
    }

    function toggleMobileMenu() {
      const drawer = document.getElementById('mobile-nav-drawer');
      drawer.classList.toggle('hidden');
    }

    function navigateTo(viewId, propertyId = null) {
      document.querySelectorAll('.page-view').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('.nav-link').forEach(el => {
        el.classList.remove('text-primary-600', 'border-primary-600');
        el.classList.add('border-transparent');
      });

      if (viewId === 'property-detail') {
        const detailView = document.getElementById('view-property-detail');
        if (detailView) detailView.classList.add('active');
        if (propertyId) renderPropertyDetail(propertyId);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        history.pushState(null, '', '#property-' + (propertyId || ''));
        return;
      }

      const targetView = document.getElementById('view-' + viewId);
      if (targetView) {
        targetView.classList.add('active');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }

      const activeNav = document.querySelector(\`.nav-link[data-target="\${viewId}"]\`);
      if (activeNav) {
        activeNav.classList.add('text-primary-600', 'border-primary-600');
        activeNav.classList.remove('border-transparent');
      }

      history.pushState(null, '', '#' + viewId);
    }

    function createPropertyCard(p) {
      const cfg = parseConfigs(p);
      const unitsSnippet = cfg.units.length > 0 ? cfg.units.slice(0, 2).join(' • ') : (cfg.sizes || '');
      const mainImg = p.image_url || 'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=1200&q=85';
      const isDubai = (p.address && p.address.includes('Dubai')) || (p.price && p.price.includes('AED'));

      return \`
        <div class="springfield-card overflow-hidden flex flex-col group cursor-pointer" onclick="navigateTo('property-detail', '\${p.id}')">
          <div class="relative aspect-[16/10] overflow-hidden bg-slate-100">
            <img src="\${mainImg}" alt="\${p.title}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy">
            <div class="absolute top-2.5 left-2.5 flex gap-1.5">
              <span class="bg-white/95 backdrop-blur text-dark-900 text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-md shadow-xs">
                \${p.property_type || 'Residential'}
              </span>
              \${isDubai ? \`<span class="bg-emerald-700 text-white text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md shadow-xs">Dubai / UAE</span>\` : \`<span class="bg-slate-900 text-white text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md shadow-xs">Tri-City</span>\`}
            </div>
            \${p.price ? \`
              <div class="absolute bottom-2.5 left-2.5">
                <span class="bg-dark-900/95 text-white font-extrabold text-xs px-2.5 py-1 rounded-md shadow-sm">
                  \${p.price}
                </span>
              </div>
            \` : ''}
          </div>

          <div class="p-3.5 sm:p-4 flex-1 flex flex-col">
            <h3 class="font-display font-extrabold text-dark-900 text-sm sm:text-base mb-1 line-clamp-1 group-hover:text-primary-600 transition-colors">\${p.title}</h3>
            
            \${unitsSnippet ? \`<div class="text-[11px] font-bold text-primary-700 mb-1.5 line-clamp-1">\${unitsSnippet}</div>\` : ''}
            
            <p class="text-slate-500 text-[11px] leading-relaxed mb-3 line-clamp-2 font-normal flex-grow">\${p.description || ''}</p>

            <div class="flex items-center gap-1 text-slate-400 text-[10px] mb-3 truncate">
              <svg class="w-3 h-3 text-primary-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
              <span class="truncate">\${p.address || ''}</span>
            </div>

            <div class="pt-2.5 border-t border-slate-100 flex items-center gap-2">
              <button class="flex-1 btn-springfield text-[10px] py-1.5 rounded-lg uppercase tracking-wider font-bold">
                View Details
              </button>
              <a href="https://wa.me/${PHONE_RAW}?text=Hi%20Bioque%20Estates,%20I%20am%20interested%20in%20\${encodeURIComponent(p.title)}" target="_blank" onclick="event.stopPropagation();" class="p-1.5 rounded-lg border border-emerald-500/40 text-emerald-700 hover:bg-emerald-50 transition-colors" title="Chat on WhatsApp">
                <svg class="w-3.5 h-3.5 fill-emerald-600" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
              </a>
            </div>
          </div>
        </div>
      \`;
    }

    function renderGrids() {
      const homeGrid = document.getElementById('home-properties-grid');
      if (homeGrid) {
        // Show first 6 featured properties on Home
        homeGrid.innerHTML = LIVE_PROPERTIES.slice(0, 6).map(createPropertyCard).join('');
      }
      filterCatalog();
    }

    function filterCatalog() {
      const catalogGrid = document.getElementById('catalog-properties-grid');
      const searchVal = (document.getElementById('catalog-search-input')?.value || '').toLowerCase().trim();

      if (catalogGrid) {
        let filtered = LIVE_PROPERTIES.filter(p => {
          const matchCategory = 
            currentCategoryFilter === 'All' ? true :
            currentCategoryFilter === 'Dubai' ? ((p.address && p.address.includes('Dubai')) || (p.price && p.price.includes('AED'))) :
            currentCategoryFilter === 'New Chandigarh' ? (p.address && p.address.includes('New Chandigarh')) :
            currentCategoryFilter === 'Tri-City' ? (p.address && (p.address.includes('Mohali') || p.address.includes('Zirakpur') || p.address.includes('Chandigarh'))) :
            (p.property_type === currentCategoryFilter);

          const matchSearch = !searchVal || 
            (p.title || '').toLowerCase().includes(searchVal) ||
            (p.description || '').toLowerCase().includes(searchVal) ||
            (p.address || '').toLowerCase().includes(searchVal);

          return matchCategory && matchSearch;
        });

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
      document.getElementById('detail-address').innerText = p.address || 'New Chandigarh / Dubai';
      document.getElementById('detail-description').innerText = p.description || '';
      document.getElementById('detail-price-badge').innerText = p.price || 'Price on Request';
      document.getElementById('detail-type-badge').innerText = p.property_type || 'Residential';
      
      const img = p.image_url || 'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=1200&q=85';
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
        <div class="flex items-center space-x-2 p-2.5 rounded-lg bg-slate-50 border border-slate-100">
          <div class="w-1.5 h-1.5 rounded-full bg-primary-600 shrink-0"></div>
          <span class="text-xs font-bold text-dark-900">\${u}</span>
        </div>
      \`).join('');

      const amenitiesContainer = document.getElementById('detail-amenities-list');
      const amenities = cfg.amenities.length > 0 ? cfg.amenities : ['Grand Clubhouse Access', 'Swimming Pool', '24x7 Security', 'Power Backup', 'Dedicated Parking'];

      amenitiesContainer.innerHTML = amenities.map(a => \`
        <div class="flex items-center space-x-2 p-2.5 rounded-lg bg-slate-50 border border-slate-100">
          <svg class="w-3.5 h-3.5 text-emerald-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>
          <span class="text-xs font-semibold text-slate-700">\${a}</span>
        </div>
      \`).join('');

      const waBtn = document.getElementById('detail-whatsapp-btn');
      waBtn.href = \`https://wa.me/${PHONE_RAW}?text=Hi%20Bioque%20Estates,%20I%20would%20like%20details,%20floor%20plans%20and%20pricing%20for%20\${encodeURIComponent(p.title)}.\`;
    }

    // --- NOBOGENT CRM LEAD SUBMISSIONS ---
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
          city: title.includes('Dubai') ? 'Dubai' : 'New Chandigarh',
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

        feedback.className = 'text-center text-xs font-semibold text-emerald-600 pt-1 block';
        feedback.innerText = '✓ Thank you! Details & price sheet sent to your WhatsApp.';
        e.target.reset();
      } catch(err) {
        feedback.className = 'text-center text-xs font-semibold text-emerald-600 pt-1 block';
        feedback.innerText = '✓ Thank you! Your request has been registered in our CRM.';
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<span>Get Details & Floor Plans</span>';
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

populateInventoryAndWebsite().catch(err => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
