import { createClient } from '@supabase/supabase-js' // Import directly to guarantee fresh client
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const propertyId = searchParams.get('propertyId')

    if (!propertyId) return NextResponse.json({ error: "Property ID required" }, { status: 400 })

    // 1. Create Direct Admin Client (Bypass ALL RLS)
    // We recreate it here to ensure no stale session issues
    const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { persistSession: false } }
    )

    // 2. Fetch Property
    const { data: property } = await supabaseAdmin
        .from('properties')
        .select('*')
        .eq('id', propertyId)
        .single()

    // 3. Fetch Fractions
    const { data: fractions, error: fracError } = await supabaseAdmin
      .from('fractions')
      .select(`
        *,
        customer_holdings (
            id,
            user_id,
            purchase_price,
            documents,
            profiles ( email, business_name, contact_number )
        )
      `)
      .eq('property_id', propertyId)
      .order('fraction_number', { ascending: true })

    if (fracError) throw fracError

    // DEBUG LOG: Check your terminal to see if profiles are null here
    console.log("Fractions Data:", JSON.stringify(fractions[0], null, 2))

    return NextResponse.json({ property, fractions })

  } catch (error: any) {
    console.error("API Error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}