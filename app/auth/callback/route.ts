import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

// --- DUMMY DATA FOR NEW USERS ---
const DUMMY_PROPERTIES = [
  {
    title: "Luxury 3BHK Apartment",
    address: "VIP Road, Zirakpur",
    price: "₹85 Lakh",
    status: "Active",
    property_type: "Residential",
    description: "Spacious 3BHK with modern amenities, pool view, and modular kitchen. Located on the main VIP road near bustling markets.",
    image_url: "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?q=80&w=1000&auto=format&fit=crop",
    images: ["https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?q=80&w=1000&auto=format&fit=crop"]
  },
  {
    title: "Commercial Showroom (Bay Shop)",
    address: "Sector 82, JLPL, Mohali",
    price: "₹1.5 Cr",
    status: "Active",
    property_type: "Commercial",
    description: "Premium double-storey showroom in the heart of the industrial hub. Ideal for retail or office space.",
    image_url: "https://images.unsplash.com/photo-1497366216548-37526070297c?q=80&w=1000&auto=format&fit=crop",
    images: ["https://images.unsplash.com/photo-1497366216548-37526070297c?q=80&w=1000&auto=format&fit=crop"]
  },
  {
    title: "4BHK Designer Villa",
    address: "Aerocity, Block C, Mohali",
    price: "₹2.25 Cr",
    status: "Active",
    property_type: "Residential",
    description: "Ultra-modern villa near the International Airport. Features Italian marble flooring, home automation, and a private garden.",
    image_url: "https://images.unsplash.com/photo-1600596542815-2250c385e311?q=80&w=1000&auto=format&fit=crop",
    images: ["https://images.unsplash.com/photo-1600596542815-2250c385e311?q=80&w=1000&auto=format&fit=crop"]
  },
  {
    title: "2BHK Affordable Flat",
    address: "Dhakoli, Zirakpur",
    price: "₹45 Lakh",
    status: "Active",
    property_type: "Residential",
    description: "Ready to move in 2BHK flat in a gated society with 24/7 security and power backup. Great for small families.",
    image_url: "https://images.unsplash.com/photo-1560185007-cde436f6a4d0?q=80&w=1000&auto=format&fit=crop",
    images: ["https://images.unsplash.com/photo-1560185007-cde436f6a4d0?q=80&w=1000&auto=format&fit=crop"]
  },
  {
    title: "Industrial Plot (500 Sq Yd)",
    address: "JLPL Industrial Area, Mohali",
    price: "₹3 Cr",
    status: "Active",
    property_type: "Plots",
    description: "Prime industrial plot located on a wide road. Clear title, immediate registry available.",
    image_url: "https://images.unsplash.com/photo-1504307651254-35680f356dfd?q=80&w=1000&auto=format&fit=crop",
    images: ["https://images.unsplash.com/photo-1504307651254-35680f356dfd?q=80&w=1000&auto=format&fit=crop"]
  },
  {
    title: "Studio Apartment (Furnished)",
    address: "Kharar - Landran Road",
    price: "₹28 Lakh",
    status: "Active",
    property_type: "Residential",
    description: "Fully furnished studio apartment near Chandigarh University. Excellent rental yield potential.",
    image_url: "https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?q=80&w=1000&auto=format&fit=crop",
    images: ["https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?q=80&w=1000&auto=format&fit=crop"]
  },
  {
    title: "Furnished Office Space",
    address: "Bestech Business Tower, Mohali",
    price: "₹75 Lakh",
    status: "Active",
    property_type: "Commercial",
    description: "1000 sq ft office space, fully furnished with cabins and workstations. Ready for lease or self-use.",
    image_url: "https://images.unsplash.com/photo-1497215728101-856f4ea42174?q=80&w=1000&auto=format&fit=crop",
    images: ["https://images.unsplash.com/photo-1497215728101-856f4ea42174?q=80&w=1000&auto=format&fit=crop"]
  },
  {
    title: "5BHK Independent Kothi",
    address: "Phase 7, Mohali",
    price: "₹4.1 Cr",
    status: "Active",
    property_type: "Residential",
    description: "Corner kothi in a prime residential sector. Newly renovated with ample parking and terrace garden.",
    image_url: "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?q=80&w=1000&auto=format&fit=crop",
    images: ["https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?q=80&w=1000&auto=format&fit=crop"]
  },
  {
    title: "High Street Retail Shop",
    address: "PR7 Road, Zirakpur",
    price: "₹60 Lakh",
    status: "Active",
    property_type: "Commercial",
    description: "Ground floor retail shop in a high-footfall mall. Brand lease available.",
    image_url: "https://images.unsplash.com/photo-1519643381401-22c77e60520e?q=80&w=1000&auto=format&fit=crop",
    images: ["https://images.unsplash.com/photo-1519643381401-22c77e60520e?q=80&w=1000&auto=format&fit=crop"]
  },
  {
    title: "Farmhouse Land (2 Kanal)",
    address: "New Chandigarh",
    price: "₹5.5 Cr",
    status: "Active",
    property_type: "Plots",
    description: "Exclusive farmhouse land with scenic views. Gated community with club house access.",
    image_url: "https://images.unsplash.com/photo-1500382017468-9049fed747ef?q=80&w=1000&auto=format&fit=crop",
    images: ["https://images.unsplash.com/photo-1500382017468-9049fed747ef?q=80&w=1000&auto=format&fit=crop"]
  }
]

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  
  // 1. Capture Provider Tag (custom param we pass during login)
  const provider = searchParams.get('provider') 
  const next = searchParams.get('next') ?? '/dashboard'
  
  const errorCode = searchParams.get('error_code')
  const errorDescription = searchParams.get('error_description')
  if (errorCode) {
    return NextResponse.redirect(`${origin}${next}?error=${encodeURIComponent(errorDescription || 'Unknown Error')}`)
  }

  if (code) {
    const supabase = await createClient()
    const { error, data } = await supabase.auth.exchangeCodeForSession(code)
    
    if (!error && data?.session) {
      const token = data.session.provider_token
      const refreshToken = data.session.provider_refresh_token
      const userId = data.session.user.id

      // --- TOKEN UPDATES (EXISTING LOGIC) ---
      if (token) {
        const updates: any = {}
        
        if (provider === 'facebook' && token.startsWith('EAA')) {
            console.log("✅ Saving Facebook Token...")
            updates.facebook_token = token
        } 
        else if (provider === 'linkedin_oidc') {
            console.log("✅ Saving LinkedIn Token...")
            updates.linkedin_token = token
        }
        else if (provider === 'google_business') {
            console.log("✅ Saving Google Business Tokens...")
            updates.google_business_token = token
            if (refreshToken) {
                updates.google_business_refresh_token = refreshToken
            }
        }
        else if (provider === 'youtube') {
            console.log("✅ Saving YouTube Tokens...")
            updates.youtube_token = token
            if (refreshToken) {
                updates.youtube_refresh_token = refreshToken
            } else {
                console.warn("⚠️ No Refresh Token received for YouTube! Automation may expire.")
            }
        }

        if (Object.keys(updates).length > 0) {
            await supabase.from('profiles').update(updates).eq('id', userId)
        }
      }

      // --- 🟢 NEW: SEED DUMMY DATA FOR NEW USERS ---
      try {
        // Check if user has any properties
        const { count } = await supabase
          .from('properties')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)

        // If count is 0, this is likely a new user. Insert dummy data.
        if (count === 0) {
          console.log(`🆕 New User detected (ID: ${userId}). Seeding 10 Dummy Properties...`)
          
          const dummyData = DUMMY_PROPERTIES.map(prop => ({
            ...prop,
            user_id: userId
          }))

          const { error: seedError } = await supabase.from('properties').insert(dummyData)
          
          if (seedError) {
            console.error("❌ Failed to seed dummy properties:", seedError)
          } else {
            console.log("✅ Dummy properties seeded successfully!")
          }
        }
      } catch (err) {
        console.error("Error in seeding logic:", err)
      }
      // ---------------------------------------------
      
      const forwardedHost = request.headers.get('x-forwarded-host') 
      const isLocalEnv = origin.includes('localhost')
      
      if (isLocalEnv) {
        return NextResponse.redirect(`${origin}${next}`)
      } else if (forwardedHost) {
        return NextResponse.redirect(`https://${forwardedHost}${next}`)
      } else {
        return NextResponse.redirect(`${origin}${next}`)
      }
    }
  }

  return NextResponse.redirect(`${origin}${next}?error=Authentication failed`)
}