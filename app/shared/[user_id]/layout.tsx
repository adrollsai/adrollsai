import { Metadata } from 'next'
import { createClient } from '@supabase/supabase-js'

// 1. Update the type definition so Next.js knows params is a Promise
type LayoutProps = {
    params: Promise<{ user_id: string }>
}

async function getProfile(identifier: string) {
    const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    let query = supabaseAdmin.from('profiles').select('id, business_name, logo_url, custom_domain, contact_number, address, mission_statement, brand_color, facebook_url, instagram_url')
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

    return {
        title: `${data.business_name} | Premium Real Estate`,
        description: `Explore premium properties, market updates, and exclusive real estate listings from ${data.business_name}. ${data.mission_statement || ''} ${data.address ? `Located in ${data.address}.` : ''}`.trim(),
        openGraph: {
            title: `${data.business_name} | Premium Real Estate`,
            description: `Explore premium properties and exclusive listings from ${data.business_name}.`,
            images: data.logo_url ? [data.logo_url] : [],
            type: 'website',
            url: baseUrl,
            siteName: data.business_name,
        },
        twitter: {
            card: 'summary_large_image',
            title: `${data.business_name} | Premium Real Estate`,
            description: `Explore premium properties from ${data.business_name}.`,
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

    // Build JSON-LD structured data for Google
    const jsonLd: any = {
        '@context': 'https://schema.org',
        '@type': 'RealEstateAgent',
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
        name: `Properties by ${profile?.business_name || 'Business'}`,
        numberOfItems: properties.length,
        itemListElement: properties.slice(0, 20).map((prop, idx) => ({
            '@type': 'ListItem',
            position: idx + 1,
            item: {
                '@type': 'RealEstateListing',
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
                    <h1>{profile.business_name} - Premium Real Estate Listings</h1>
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