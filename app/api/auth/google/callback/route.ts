import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const stateStr = searchParams.get('state')

  if (!code || !stateStr) {
    return new Response("Missing code or state parameters", { status: 400 })
  }

  try {
    const state = JSON.parse(stateStr)
    const { userId, redirectUriOrigin, flow, campaignSlug } = state

    const clientId = process.env.GOOGLE_CLIENT_ID
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET
    const isLocal = redirectUriOrigin && (redirectUriOrigin.includes('localhost') || redirectUriOrigin.includes('127.0.0.1'))
    const redirectUri = isLocal
      ? `${redirectUriOrigin}/api/auth/google/callback`
      : (process.env.GOOGLE_REDIRECT_URI || 'https://app.nobogent.com/api/auth/google/callback')

    if (!clientId || !clientSecret) {
      return new Response("GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is not configured.", { status: 500 })
    }

    // Exchange auth code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    })

    const tokenData = await tokenRes.json()

    if (tokenData.error) {
      console.error("[Google OAuth Callback] Token exchange failed:", tokenData)
      return new Response(`Token exchange failed: ${tokenData.error_description || tokenData.error}`, { status: 500 })
    }

    const { access_token, refresh_token } = tokenData

    // --- GBP Audit OAuth Flow ---
    if (flow === 'gbp_audit') {
      let userEmail = ''
      let userName = ''
      let businessTitle = ''
      let businessAddress = ''
      let placeId = ''
      let latitude: number | null = null
      let longitude: number | null = null
      let rating: number | null = null
      let reviewsCount: number | null = null
      let photosCount: number | null = null
      let category = ''
      let phone = ''
      let website = ''
      let hasGbp = false

      // 1. Fetch user profile info
      try {
        const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
          headers: { Authorization: `Bearer ${access_token}` }
        })
        if (userInfoRes.ok) {
          const userInfo = await userInfoRes.json()
          userEmail = userInfo.email || ''
          userName = userInfo.name || ''
        }
      } catch (err) {
        console.warn('[Google GBP Callback] Error fetching userinfo:', err)
      }

      // 2. Fetch GBP accounts & verified business locations
      try {
        console.log('[Google GBP Callback] Calling accounts API with access_token...')
        const accountsRes = await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', {
          headers: { Authorization: `Bearer ${access_token}` }
        })
        const accountsText = await accountsRes.text()
        console.log('[Google GBP Callback] Accounts API response status:', accountsRes.status, 'Body:', accountsText)
        
        try {
          const fs = await import('fs')
          fs.appendFileSync('gbp_callback_debug.log', `[${new Date().toISOString()}] Accounts API: status=${accountsRes.status}, body=${accountsText}\n`)
        } catch {}

        if (accountsRes.ok) {
          const accData = JSON.parse(accountsText)
          const primaryAccount = accData.accounts?.[0]
          if (primaryAccount) {
            console.log('[Google GBP Callback] Found primary account:', primaryAccount.name, 'Fetching locations...')
            const locRes = await fetch(`https://mybusinessbusinessinformation.googleapis.com/v1/${primaryAccount.name}/locations?readMask=name,title,storefrontAddress,phoneNumbers,categories,latlng,websiteUri,metadata,regularHours`, {
              headers: { Authorization: `Bearer ${access_token}` }
            })
            const locText = await locRes.text()
            console.log('[Google GBP Callback] Locations API response status:', locRes.status, 'Body:', locText)

            if (locRes.ok) {
              const locData = JSON.parse(locText)
              const primaryLoc = locData.locations?.[0]
              if (primaryLoc) {
                hasGbp = true
                businessTitle = primaryLoc.title || ''
                if (primaryLoc.storefrontAddress?.addressLines) {
                  const parts = [
                    ...primaryLoc.storefrontAddress.addressLines,
                    primaryLoc.storefrontAddress.locality,
                    primaryLoc.storefrontAddress.administrativeArea,
                    primaryLoc.storefrontAddress.postalCode
                  ].filter(Boolean)
                  businessAddress = parts.join(', ')
                }
                if (primaryLoc.metadata?.placeId) {
                  placeId = primaryLoc.metadata.placeId
                }
                if (primaryLoc.latlng?.latitude && primaryLoc.latlng?.longitude) {
                  latitude = primaryLoc.latlng.latitude
                  longitude = primaryLoc.latlng.longitude
                }
                if (primaryLoc.phoneNumbers?.primaryPhone) {
                  phone = primaryLoc.phoneNumbers.primaryPhone
                }
                if (primaryLoc.websiteUri) {
                  website = primaryLoc.websiteUri
                }
                if (primaryLoc.categories?.primaryCategory?.displayName) {
                  category = primaryLoc.categories.primaryCategory.displayName
                }
              }
            }
          }
        }
      } catch (locErr) {
        console.warn('[Google GBP Callback] Error reading GBP locations:', locErr)
      }

      // 3. Enrich with live Google Places API (New) metrics (rating, reviews, photos)
      const placesApiKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY || 'AIzaSyAeaeCS8ie8Xli59EzKoE3bccubS8h0NNA'
      try {
        if (placeId) {
          const placeRes = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
            headers: {
              'X-Goog-Api-Key': placesApiKey,
              'X-Goog-FieldMask': 'id,displayName,formattedAddress,location,rating,userRatingCount,primaryTypeDisplayName,photos,websiteUri,internationalPhoneNumber'
            }
          })
          if (placeRes.ok) {
            const p = await placeRes.json()
            if (typeof p.rating === 'number') rating = p.rating
            if (typeof p.userRatingCount === 'number') reviewsCount = p.userRatingCount
            if (Array.isArray(p.photos)) photosCount = p.photos.length
            if (p.location?.latitude && !latitude) latitude = p.location.latitude
            if (p.location?.longitude && !longitude) longitude = p.location.longitude
            if (p.formattedAddress && !businessAddress) businessAddress = p.formattedAddress
            if (p.internationalPhoneNumber && !phone) phone = p.internationalPhoneNumber
            if (p.websiteUri && !website) website = p.websiteUri
            if (p.primaryTypeDisplayName?.text && !category) category = p.primaryTypeDisplayName.text
          }
        }
        
        // If placeId was not found yet via GBP management API, search Google Places for businessTitle or userName or email handle (e.g. "Nobogent")
        const queryName = (businessTitle || userName || (userEmail ? userEmail.split('@')[0] : '') || '').trim()
        if (!placeId && queryName && queryName.length > 1) {
          console.log(`[Google GBP Callback] Auto-searching Places API for queryName: "${queryName}"...`)
          const searchRes = await fetch('https://places.googleapis.com/v1/places:searchText', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Goog-Api-Key': placesApiKey,
              'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.primaryTypeDisplayName,places.photos,places.internationalPhoneNumber,places.websiteUri'
            },
            body: JSON.stringify({ textQuery: queryName })
          })
          if (searchRes.ok) {
            const sData = await searchRes.json()
            const p = sData.places?.[0]
            if (p) {
              console.log(`[Google GBP Callback] Found matching place for "${queryName}":`, p.displayName?.text, p.id)
              placeId = p.id
              businessTitle = p.displayName?.text || queryName
              businessAddress = p.formattedAddress || businessAddress
              if (p.location?.latitude) latitude = p.location.latitude
              if (p.location?.longitude) longitude = p.location.longitude
              if (typeof p.rating === 'number') rating = p.rating
              if (typeof p.userRatingCount === 'number') reviewsCount = p.userRatingCount
              if (Array.isArray(p.photos)) photosCount = p.photos.length
              if (p.internationalPhoneNumber) phone = p.internationalPhoneNumber
              if (p.websiteUri) website = p.websiteUri
              if (p.primaryTypeDisplayName?.text) category = p.primaryTypeDisplayName.text
              hasGbp = true
            }
          }
        }
      } catch (placeErr) {
        console.warn('[Google GBP Callback] Error enriching from Places API:', placeErr)
      }

      const auditParams = new URLSearchParams({
        connected: 'true',
        email: userEmail,
        name: userName,
        business: businessTitle || userName || (userEmail ? userEmail.split('@')[0] : ''),
        address: businessAddress || '',
        placeId: placeId || '',
        lat: latitude ? String(latitude) : '',
        lng: longitude ? String(longitude) : '',
        rating: rating !== null ? String(rating) : '',
        reviewsCount: reviewsCount !== null ? String(reviewsCount) : '',
        photosCount: photosCount !== null ? String(photosCount) : '',
        category: category || '',
        phone: phone || '',
        website: website || '',
        hasGbp: hasGbp ? 'true' : 'false',
        ownerVerified: 'true'
      })

      const targetSlug = campaignSlug || 'nobogent'
      const returnOrigin = redirectUriOrigin || 'https://app.nobogent.com'
      return NextResponse.redirect(`${returnOrigin}/audit/${targetSlug}?${auditParams.toString()}`)
    }

    // --- Standard Google Calendar Flow ---
    // Save refresh_token to profiles table in Supabase
    // We use service role to bypass RLS since callback is a public route
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const updates: any = {
      google_booking_enabled: true
    }

    if (refresh_token) {
      updates.google_refresh_token = refresh_token
    }

    const { error: dbError } = await supabaseAdmin
      .from('profiles')
      .update(updates)
      .eq('id', userId)

    if (dbError) throw dbError

    console.log(`[Google OAuth Callback] Successfully linked calendar for User ID: ${userId}`)

    // Redirect user back to dashboard profile Connection Settings page
    const returnOrigin = redirectUriOrigin || 'https://app.nobogent.com'
    return NextResponse.redirect(`${returnOrigin}/dashboard/profile`)

  } catch (err: any) {
    console.error("[Google OAuth Callback] Fatal Error:", err)
    return new Response(`Authentication Error: ${err.message}`, { status: 500 })
  }
}
