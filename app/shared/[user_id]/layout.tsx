import { Metadata } from 'next'
import { createClient } from '@/utils/supabase/server'

// 1. Update the type definition so Next.js knows params is a Promise
type LayoutProps = {
    params: Promise<{ user_id: string }>
}

export async function generateMetadata({ params }: LayoutProps): Promise<Metadata> {
    const supabase = await createClient()
    
    // 2. Await the params before using them (Next.js 15+ requirement)
    const resolvedParams = await params
    const identifier = resolvedParams.user_id 

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

// 3. Apply the updated type to the actual layout component as well
export default async function SharedLayout({ 
    children, 
    params 
}: { 
    children: React.ReactNode, 
    params: Promise<{ user_id: string }> 
}) {
    return <>{children}</>
}