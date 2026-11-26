import { Metadata } from 'next'
import { createClient } from '@supabase/supabase-js'
import { catalogueSharingFor } from '@/lib/automation/catalogue-cta'

// 1. Update the type definition so Next.js knows params is a Promise
type LayoutProps = {
    params: Promise<{ user_id: string }>
}

async function getProfile(identifier: string) {
    const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    let query = supabaseAdmin.from('profiles').select('id, business_name, industry, logo_url, custom_domain, contact_number, address, mission_statement, brand_color, facebook_url, instagram_url')
    if (identifier.includes('.')) {
        query = query.eq('custom_domain', identifier)
    } else {
        query = query.eq('id', identifier)
    }

    const { data } = await query.single()
    return data
}

async function getProperties(userId: string) {
    const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data } = await supabaseAdmin
        .from('properties')
        .select('id, title, description, price, address, image_url, property_type')
        .eq('user_id', userId)
        .neq('status', 'Archived')
        .neq('status', 'Sold')
        .limit(50)

    return data || []
}

export async function generateMetadata({ params }: LayoutProps): Promise<Metadata> {
    const resolvedParams = await params
    const identifier = resolvedParams.user_id 

    const data = await getProfile(identifier)

    if (!data) return { title: 'Profile Not Found' }

    const baseUrl = data.custom_domain 
        ? `https://${data.custom_domain}` 
        : `https://app.nobogent.com/shared/${data.id}`

    /**
     * THE PUBLIC PAGE IS NOT A REAL ESTATE PAGE.
     *
     * This title, its Open Graph twin, its Twitter twin and the description all said "Premium Real Estate"
     * for EVERY tenant — measured on production: a film academy's catalogue served the page title
     * "Procolor Film Academy - Premium Real Estate Listings" and described "exclusive real estate listings"
     * to Google. The owner's instruction has been the same each time: nothing property-specific for a
     * business that does not sell property. The noun now comes from what the account actually sells.
     */
    const sharing = catalogueSharingFor(data)
    const title = `${data.business_name} | ${sharing.titleNoun}`
    const description =
        `${sharing.descriptionLead} from ${data.business_name}. ${data.mission_statement || ''} ${data.address ? `Located in ${data.address}.` : ''}`.trim()

    return {
        title,
        description,
        openGraph: {
            title,
            description,
            images: data.logo_url ? [data.logo_url] : [],
            type: 'website',
            url: baseUrl,
            siteName: data.business_name,
        },
        twitter: {
            card: 'summary_large_image',
            title,
            description,
        },
        alternates: {
            canonical: baseUrl,
        },
        robots: {
            index: true,
            follow: true,
            googleBot: {
                index: true,
                follow: true,
                'max-image-preview': 'large',
                'max-snippet': -1,
            },
        }
    }
}

// 2. Apply the updated type to the actual layout component as well
export default async function SharedLayout({ 
    children, 
    params 
}: { 
    children: React.ReactNode, 
    params: Promise<{ user_id: string }>
}) {
    const resolvedParams = await params
    const identifier = resolvedParams.user_id

    const profile = await getProfile(identifier)
    const properties = profile ? await getProperties(profile.id) : []

    /**
     * Structured data follows the business, not the template.
     *
     * This block declared EVERY tenant a `RealEstateAgent` listing `RealEstateListing`s, so a film academy
     * told Google it was an estate agent. The sharing words and schema types now come from what the account
     * sells (`catalogueSharingFor`), and only a real estate account emits property schema at all.
     */
    const sharing = catalogueSharingFor({
        industry: (profile as any)?.industry,
        businessName: profile?.business_name,
        rowTypes: (properties || []).map((p: any) => p?.property_type),
    })

    // Build JSON-LD structured data for Google
    const jsonLd: any = {
        '@context': 'https://schema.org',
        '@type': sharing.schemaType,
        name: profile?.business_name || 'Business',
        url: profile?.custom_domain 
            ? `https://${profile.custom_domain}` 
            : `https://app.nobogent.com/shared/${identifier}`,
        ...(profile?.logo_url && { logo: profile.logo_url }),
        ...(profile?.contact_number && { telephone: profile.contact_number }),
        ...(profile?.address && { address: { '@type': 'PostalAddress', streetAddress: profile.address } }),
        ...(profile?.mission_statement && { description: profile.mission_statement }),
    }

    // Add property listings as ItemList
    const itemListJsonLd = properties.length > 0 ? {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        name: `${sharing.listNoun} ${profile?.business_name || 'Business'}`,
        numberOfItems: properties.length,
        itemListElement: properties.slice(0, 20).map((prop, idx) => ({
            '@type': 'ListItem',
            position: idx + 1,
            item: {
                '@type': sharing.itemType,
                name: prop.title,
                description: prop.description?.slice(0, 200),
                ...(prop.price && { offers: { '@type': 'Offer', price: prop.price, priceCurrency: 'INR' } }),
                ...(prop.image_url && { image: prop.image_url }),
                ...(prop.address && { address: { '@type': 'PostalAddress', streetAddress: prop.address } }),
            }
        }))
    } : null

    return (
        <>
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
            />
            {itemListJsonLd && (
                <script
                    type="application/ld+json"
                    dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd) }}
                />
            )}
            {/* Server-rendered SEO content for crawlers (visually hidden but crawlable) */}
            {profile && (
                <div style={{ position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap' }}>
                    <h1>{profile.business_name} - {sharing.heading}</h1>
                    {profile.mission_statement && <p>{profile.mission_statement}</p>}
                    {profile.address && <p>Location: {profile.address}</p>}
                    {profile.contact_number && <p>Contact: {profile.contact_number}</p>}
                    {properties.length > 0 && (
                        <ul>
                            {properties.slice(0, 20).map(p => (
                                <li key={p.id}>
                                    <h2>{p.title}</h2>
                                    {p.price && <span>Price: {p.price}</span>}
                                    {p.address && <span> - {p.address}</span>}
                                    {p.description && <p>{p.description.slice(0, 300)}</p>}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
            {children}
        </>
    )
}