export interface ReferenceTemplate {
    id: string;
    index: number;
    name: string;
    category: string;
    libraryCategory: 'high_converting' | 'premium';
    badge: string;
    description: string;
    url: string;
    fallbackImage: string;
}

const TEMPLATE_METADATA = [
    { name: 'DAMAC Waterfront Luxury', cat: 'Waterfront', libCat: 'high_converting' as const, badge: 'WATERFRONT LUXURY', desc: 'Waterfront living with gold accents and developer branding' },
    { name: 'Emirates Direct Response Villa', cat: 'Direct Response', libCat: 'high_converting' as const, badge: 'EXCLUSIVE DIRECT OFFER', desc: 'Direct response flyer with prominent pricing ribbon' },
    { name: 'Architectural Digest Editorial', cat: 'Editorial', libCat: 'premium' as const, badge: 'ARCHITECTURAL DIGEST', desc: 'Travertine textures, refined typography, ambient warm lighting' },
    { name: 'Dubai Dark Mode Penthouse', cat: 'Dark Mode', libCat: 'high_converting' as const, badge: 'ULTRA LUXURY SUITE', desc: 'Obsidian dark aesthetic with golden highlights and skyline view' },
    { name: 'High-ROI Palm Investment', cat: 'High ROI', libCat: 'high_converting' as const, badge: 'HIGHEST RENTAL YIELD', desc: 'Investor flyer emphasizing 0% tax and guaranteed returns' },
    { name: 'Marbella Contemporary Villa', cat: 'Resort Villa', libCat: 'premium' as const, badge: 'CONTEMPORARY RESORT', desc: 'Mediterranean aesthetic with organic arches and generous white space' },
    { name: 'Downtown Skyline Residence', cat: 'Skyline Living', libCat: 'premium' as const, badge: 'PRIME CITY VIEW', desc: 'Panoramic downtown skyline with modern glass architectural framing' },
    { name: 'Golf Course Signature Mansion', cat: 'Golf Living', libCat: 'high_converting' as const, badge: 'SIGNATURE FAIRWAY', desc: 'Lush green fairway views and prestige private clubhouse privilege' },
    { name: 'Minimalist Monolithic Estate', cat: 'Minimalist', libCat: 'premium' as const, badge: 'CURATED MINIMALISM', desc: 'Pristine minimalist composition focusing on pure geometry' },
    { name: 'Mediterranean Sunset Haven', cat: 'Coastal Living', libCat: 'premium' as const, badge: 'SUNSET HORIZON', desc: 'Warm dusk light with private infinity edge pool framing' },
    { name: 'Creek Harbour Horizon Tower', cat: 'Waterfront', libCat: 'premium' as const, badge: 'HARBOUR FRONT', desc: 'Iconic water canal and marina promenade luxury living' },
    { name: 'Private Beachfront Sanctuary', cat: 'Beachfront', libCat: 'high_converting' as const, badge: 'PRIVATE BEACH ACCESS', desc: 'Direct white sand beach access with azure sea backdrop' },
    { name: 'Bespoke Travertine Villa', cat: 'Architectural', libCat: 'high_converting' as const, badge: 'BESPOKE TRAVERTINE', desc: 'Artisanal stone craftsmanship and bespoke architectural details' },
    { name: 'Ultra Luxury Palm Villa', cat: 'Ultra Luxury', libCat: 'high_converting' as const, badge: 'EXCLUSIVE PALM ACCESS', desc: 'Frond-facing elite villa with double-height ceiling lobby' },
    { name: 'High-Yield Off-Plan Flyer', cat: 'High ROI', libCat: 'premium' as const, badge: '0% TAX • HIGH YIELD', desc: 'Compelling ROI statistics and flexible installment schedule' },
    { name: 'Royal Horizon Sky Penthouse', cat: 'Skyline Living', libCat: 'premium' as const, badge: 'PANORAMIC SKY VISTA', desc: 'Top-floor penthouse with 360-degree metropolitan vista' },
    { name: 'Elysian Hillside Retreat', cat: 'Resort Living', libCat: 'premium' as const, badge: 'PRIVATE HILL RETREAT', desc: 'Secluded hilltop retreat with private forest canopy deck' },
    { name: 'Executive Direct-Offer Suite', cat: 'Direct Response', libCat: 'high_converting' as const, badge: 'LIMITED INAUGURAL LAUNCH', desc: 'High urgency direct-action layout with instant WhatsApp CTA' },
    { name: 'Golden Hour Oasis Villa', cat: 'Luxury Villa', libCat: 'premium' as const, badge: 'PRIVATE POOL OASIS', desc: 'Subtropical landscaped gardens with private illuminated pool' },
    { name: 'Metropolitan Signature Tower', cat: 'Urban Luxury', libCat: 'high_converting' as const, badge: 'METRO CONNECTED', desc: 'Ultra-connected central business district sky residence' },
    { name: 'Grand Botanical Residence', cat: 'Nature Living', libCat: 'premium' as const, badge: 'BOTANICAL ENCLAVE', desc: 'Lush vertical gardens, biophilic luxury and shaded terraces' },
    { name: 'Boutique Canal-Front Suite', cat: 'Waterfront', libCat: 'high_converting' as const, badge: 'WATERFRONT CANAL', desc: 'Boutique low-rise canal architecture with private boat docking' },
    { name: 'Prestige Private Enclave', cat: 'Ultra Luxury', libCat: 'premium' as const, badge: 'VIP GATED COMMUNITY', desc: '24/7 guarded private enclave for high-net-worth families' },
    { name: 'Investor Direct Launch Ad', cat: 'High ROI', libCat: 'high_converting' as const, badge: '100% FREEHOLD TITLE', desc: 'Clear legal title and direct developer pricing guarantee' },
    { name: 'Contemporary Minimal Villa', cat: 'Minimalist', libCat: 'premium' as const, badge: 'ARCHITECTURAL PURITY', desc: 'Floor-to-ceiling glass walls and floating cantilever terraces' },
    { name: 'Cote dAzur Coastal Manor', cat: 'Coastal Living', libCat: 'premium' as const, badge: 'MEDITERRANEAN CHARM', desc: 'Riviera-inspired stone colonnade and pergola dining terrace' },
    { name: 'Verdant Valley Luxury Plot', cat: 'Estate Plots', libCat: 'high_converting' as const, badge: 'LANDSCAPED HAVEN', desc: 'Customizable freehold land plots with luxury infrastructure' },
    { name: 'Palatial Grand Courtyard', cat: 'Royal Mansions', libCat: 'premium' as const, badge: 'PALATIAL LIVING', desc: 'Symmetrical royal courtyard with water fountains and marble portico' },
    { name: 'Inaugural Launch Flyer', cat: 'Direct Response', libCat: 'high_converting' as const, badge: 'SPECIAL LAUNCH PRICE', desc: 'First-mover advantage pricing ribbon and private inspection RSVP' },
    { name: 'Sky Villa Private Deck', cat: 'Skyline Living', libCat: 'premium' as const, badge: 'DOUBLE HEIGHT CEILINGS', desc: 'Duplex sky villa with private plunge pool on the 40th floor' },
    { name: 'Zen Organic Timber Villa', cat: 'Organic Modern', libCat: 'premium' as const, badge: 'BIOPHILIC ARCHITECTURE', desc: 'Teak and cedar wood finishes with tranquil water garden' },
    { name: 'Capital Towers VIP Release', cat: 'Urban Luxury', libCat: 'high_converting' as const, badge: 'FLEXIBLE PAYMENT PLAN', desc: 'Post-handover payment plan badge with high rental demand' },
    { name: 'Riviera Waterfront Haven', cat: 'Waterfront', libCat: 'premium' as const, badge: 'PRIVATE MARINA BERTH', desc: 'Yacht club membership included with private marina slipway' },
    { name: 'Golden Sands Resort Villa', cat: 'Resort Villa', libCat: 'high_converting' as const, badge: 'FIVE STAR AMENITIES', desc: 'Hotel-serviced luxury villa with 24-hour private butler' },
    { name: 'Signature Crown Penthouse', cat: 'Ultra Luxury', libCat: 'premium' as const, badge: 'THE CROWN RESIDENCE', desc: 'The most prestigious residence on the top two floors of the tower' }
];

export const ALL_REFERENCE_TEMPLATES: ReferenceTemplate[] = TEMPLATE_METADATA.map((meta, i) => {
    const url = `https://pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev/reference-creatives/dubai/pinterest_pin_1793111079523_${i}.jpg`;
    return {
        id: `pinterest_pin_${i}`,
        index: i,
        name: meta.name,
        category: meta.cat,
        libraryCategory: meta.libCat,
        badge: meta.badge,
        description: meta.desc,
        url,
        fallbackImage: url
    };
});

export const REFERENCE_TEMPLATES_MAP: Record<string, ReferenceTemplate> = {};

// Register all 35 templates by ID and index
ALL_REFERENCE_TEMPLATES.forEach(t => {
    REFERENCE_TEMPLATES_MAP[t.id] = t;
    REFERENCE_TEMPLATES_MAP[String(t.index)] = t;
    REFERENCE_TEMPLATES_MAP[t.url] = t;
});

// Register legacy aliases for backward compatibility
if (ALL_REFERENCE_TEMPLATES[0]) REFERENCE_TEMPLATES_MAP['pinterest_damac_island'] = ALL_REFERENCE_TEMPLATES[0];
if (ALL_REFERENCE_TEMPLATES[1]) REFERENCE_TEMPLATES_MAP['pinterest_emirates_villa'] = ALL_REFERENCE_TEMPLATES[1];
if (ALL_REFERENCE_TEMPLATES[2]) REFERENCE_TEMPLATES_MAP['pinterest_luxury_architectural'] = ALL_REFERENCE_TEMPLATES[2];
if (ALL_REFERENCE_TEMPLATES[3]) REFERENCE_TEMPLATES_MAP['pinterest_property_showcase'] = ALL_REFERENCE_TEMPLATES[3];
if (ALL_REFERENCE_TEMPLATES[4]) REFERENCE_TEMPLATES_MAP['pinterest_investment_flyer'] = ALL_REFERENCE_TEMPLATES[4];
if (ALL_REFERENCE_TEMPLATES[5]) REFERENCE_TEMPLATES_MAP['pinterest_marbella_villa'] = ALL_REFERENCE_TEMPLATES[5];

/**
 * Returns a matching ReferenceTemplate or falls back to the default (0: DAMAC Waterfront Luxury)
 */
export function getReferenceTemplate(idOrUrl?: string): ReferenceTemplate {
    if (!idOrUrl) return ALL_REFERENCE_TEMPLATES[0];
    if (REFERENCE_TEMPLATES_MAP[idOrUrl]) return REFERENCE_TEMPLATES_MAP[idOrUrl];
    
    // Fuzzy match on URL ending (e.g. "..._14.jpg")
    const match = idOrUrl.match(/pinterest_pin_1793111079523_(\d+)\.jpg/);
    if (match) {
        const idx = parseInt(match[1], 10);
        if (ALL_REFERENCE_TEMPLATES[idx]) return ALL_REFERENCE_TEMPLATES[idx];
    }
    
    return ALL_REFERENCE_TEMPLATES[0];
}

/**
 * Returns a random ReferenceTemplate, optionally chosen from a provided subset of template IDs/URLs
 */
export function getRandomReferenceTemplate(subset?: string[]): ReferenceTemplate {
    if (subset && subset.length > 0) {
        const randomId = subset[Math.floor(Math.random() * subset.length)];
        return getReferenceTemplate(randomId);
    }
    const randomIndex = Math.floor(Math.random() * ALL_REFERENCE_TEMPLATES.length);
    return ALL_REFERENCE_TEMPLATES[randomIndex];
}


