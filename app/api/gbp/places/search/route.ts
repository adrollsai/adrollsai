import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('mode')
  if (mode === 'keywords') {
    const category = searchParams.get('category') || 'Local Business'
    const city = searchParams.get('city') || ''
    const business = searchParams.get('business') || ''
    try {
      const { fetchIntelligentKeywords } = await import('@/utils/gbp-ai-auditor')
      const keywords = await fetchIntelligentKeywords(category, city, business)
      return NextResponse.json({ success: true, keywords })
    } catch (err: any) {
      console.warn('[Keywords suggest error]:', err)
      return NextResponse.json({
        success: true,
        keywords: [
          `${category.toLowerCase()} near me`,
          city ? `best ${category.toLowerCase()} in ${city}` : `best ${category.toLowerCase()}`,
          `top rated ${category.toLowerCase()}`
        ]
      })
    }
  }

  const query = searchParams.get('q')?.trim() || ''

  if (!query || query.length < 2) {
    return NextResponse.json({ results: [] })
  }

  const googleApiKey = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY

  try {
    // 1. Google Places API (New) - High accuracy live Google Maps search
    if (googleApiKey) {
      const placesUrl = 'https://places.googleapis.com/v1/places:searchText'
      const res = await fetch(placesUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': googleApiKey,
          'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.primaryTypeDisplayName,places.photos,places.internationalPhoneNumber,places.websiteUri'
        },
        body: JSON.stringify({ textQuery: query })
      })

      if (res.ok) {
        const data = await res.json()
        if (data.places && data.places.length > 0) {
          const formatted = data.places.slice(0, 8).map((p: any) => ({
            placeId: p.id,
            name: p.displayName?.text || query,
            address: p.formattedAddress || '',
            latitude: p.location?.latitude || null,
            longitude: p.location?.longitude || null,
            rating: typeof p.rating === 'number' ? p.rating : null,
            reviewsCount: typeof p.userRatingCount === 'number' ? p.userRatingCount : 0,
            category: p.primaryTypeDisplayName?.text || 'Local Business',
            photosCount: Array.isArray(p.photos) ? p.photos.length : 0,
            phone: p.internationalPhoneNumber || '',
            website: p.websiteUri || ''
          }))
          return NextResponse.json({ results: formatted, source: 'google_places_api_new' })
        }
      } else {
        const errText = await res.text()
        console.warn('[Places API New] Error response:', res.status, errText)
      }
    }

    // 2. OpenStreetMap Nominatim fallback ONLY if Google API key is absent or fails
    const nominatimUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&addressdetails=1&limit=6`
    const res = await fetch(nominatimUrl, {
      headers: {
        'User-Agent': 'Nobogent-GBPAudit/1.0 (contact@nobogent.com)'
      }
    })

    if (res.ok) {
      const data = await res.json()
      if (Array.isArray(data) && data.length > 0) {
        const formatted = data.map((item: any, idx: number) => ({
          placeId: `osm_${item.place_id || idx}`,
          name: item.name || query,
          address: item.display_name,
          latitude: parseFloat(item.lat),
          longitude: parseFloat(item.lon),
          rating: null,
          reviewsCount: null,
          category: item.type?.replace(/_/g, ' ') || 'Commercial Business',
          photosCount: null,
          phone: '',
          website: ''
        }))
        return NextResponse.json({ results: formatted, source: 'osm' })
      }
    }
  } catch (err) {
    console.warn('[GBP Places Search] Error searching places:', err)
  }

  return NextResponse.json({ results: [] })
}

