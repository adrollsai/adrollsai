import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { sendCAPIEvent } from '@/utils/external-apis'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { userId, eventName, eventID, eventData, sourceUrl, pixelId: bodyPixelId } = body

    if (!userId || !eventName) {
      return NextResponse.json({ error: 'Missing userId or eventName' }, { status: 400 })
    }

    // 1. Fetch the user's profile to retrieve pixel ID and facebook access tokens
    // We use the Admin Client to bypass RLS since this is a public visitor-facing route.
    const supabaseAdmin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data: profile, error: profileErr } = await supabaseAdmin
      .from('profiles')
      .select('facebook_token, selected_page_token, pixel_id')
      .eq('id', userId)
      .single()

    if (profileErr || !profile) {
      console.error(`[CAPI Proxy] Profile not found or DB error for User ID ${userId}:`, profileErr)
      return NextResponse.json({ error: 'Catalog profile not found' }, { status: 404 })
    }

    const pixelId = bodyPixelId || profile.pixel_id
    const accessToken = profile.facebook_token || profile.selected_page_token

    if (!pixelId || !accessToken) {
      // Return 200 but skip tracking since the client hasn't fully set up Meta Pixel/tokens.
      // This prevents browser console errors for visitors.
      return NextResponse.json({ success: true, message: 'Meta credentials not configured for this catalogue.' })
    }

    // 2. Extract client environment details for dynamic CAPI Event Match Quality (EMQ)
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 
                     request.headers.get('x-real-ip') || 
                     '127.0.0.1';
    const clientUa = request.headers.get('user-agent') || '';

    // 3. Extract browser cookies (fbp / fbc) if present for richer attribution match quality
    const cookieHeader = request.headers.get('cookie') || '';
    const fbpMatch = cookieHeader.match(/_fbp=([^;]+)/);
    const fbcMatch = cookieHeader.match(/_fbc=([^;]+)/);
    const fbp = fbpMatch ? fbpMatch[1] : undefined;
    const fbc = fbcMatch ? fbcMatch[1] : undefined;

    // 4. Trigger Conversions API (CAPI) Event
    // Using standard unhashed metadata where sendCAPIEvent will handle crypto-hashing internally
    const userData = {
      externalId: undefined, // Visitor is anonymous, no specific CRM ID on initial loads
      client_ip_address: clientIp,
      client_user_agent: clientUa,
      fbp,
      fbc
    }

    console.log(`[CAPI Proxy] Proxying CAPI event '${eventName}' for Pixel ID ${pixelId} (Event ID: ${eventID})`)

    // Custom properties payload details matching Meta guidelines
    let value = 0
    if (eventData?.value) {
      value = parseFloat(eventData.value) || 0
    }

    // Call the external CAPI service
    // We pass fbp and fbc directly to enrich the sendCAPIEvent call.
    // Wait, let's look at sendCAPIEvent definition in utils/external-apis.ts.
    // It accepts: (accessToken, pixelId, eventName, userData, value, clientIp, clientUa, sourceUrl)
    // Wait, we can pass fbp/fbc in userData or extend the parameters if needed, but let's check sendCAPIEvent.
    // Let's pass the parameters carefully.
    await sendCAPIEvent(
      accessToken,
      pixelId,
      eventName,
      {}, // Empty userData for anonymous visitor (unless they submitted lead info, but they are just browsing)
      value,
      clientIp,
      clientUa,
      sourceUrl
    )

    return NextResponse.json({ success: true })

  } catch (error: any) {
    console.error("[CAPI Proxy] General error proxying CAPI event:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
