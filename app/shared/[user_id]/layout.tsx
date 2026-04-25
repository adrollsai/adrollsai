import { Metadata } from 'next'
import { createClient } from '@/utils/supabase/server'

export async function generateMetadata({ params }: { params: { user_id: string } }): Promise<Metadata> {
    const supabase = await createClient()
    const identifier = params.user_id 

    // Check if the parameter is a domain (contains a dot) or a user ID
    let query = supabase.from('profiles').select('business_name, logo_url, custom_domain')
    if (identifier.includes('.')) {
        query = query.eq('custom_domain', identifier)
    } else {
        query = query.eq('id', identifier)
    }

    const { data } = await query.single()

    if (!data) return { title: 'Profile Not Found' }

    return {
        title: `${data.business_name} | Premium Real Estate`,
        description: `Explore premium fractional co-ownership opportunities, market updates, and exclusive real estate listings from ${data.business_name}.`,
        openGraph: {
            title: `${data.business_name} | Premium Real Estate`,
            images: data.logo_url ? [data.logo_url] : [],
            type: 'website',
        },
        alternates: {
            canonical: data.custom_domain ? `https://${data.custom_domain}` : undefined,
        },
        robots: {
            index: true,
            follow: true,
        }
    }
}

export default function SharedLayout({ children }: { children: React.ReactNode }) {
    return <>{children}</>
}