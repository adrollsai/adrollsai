import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'
import { createClient } from '@/utils/supabase/server'
import { getGBPOptimizationProfile } from '@/utils/gbp-suite-storage'

// Helper: Convert decimal degrees to rational DMS string format for EXIF GPS IFD
function decimalToDms(coord: number): string {
  const abs = Math.abs(coord)
  const degrees = Math.floor(abs)
  const minFloat = (abs - degrees) * 60
  const minutes = Math.floor(minFloat)
  const secFloat = (minFloat - minutes) * 60
  const secondsScaled = Math.round(secFloat * 100)

  return `${degrees}/1 ${minutes}/1 ${secondsScaled}/100`
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { session } } = await supabase.auth.getSession()

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const impersonateId = searchParams.get('impersonate')
    const targetUserId = impersonateId || session.user.id

    const body = await req.json()
    const {
      imageBase64,
      latitude,
      longitude,
      altitude = 25,
      businessName: inputBusinessName,
      keywords: inputKeywords,
      description: inputDescription
    } = body

    if (!imageBase64) {
      return NextResponse.json({ error: 'No image provided for geo-tagging' }, { status: 400 })
    }

    if (latitude === undefined || longitude === undefined || isNaN(Number(latitude)) || isNaN(Number(longitude))) {
      return NextResponse.json({ error: 'Valid latitude and longitude coordinates are required' }, { status: 400 })
    }

    const latNum = Number(latitude)
    const lngNum = Number(longitude)

    // Pull profile if businessName or keywords not provided
    const profile = (await getGBPOptimizationProfile(targetUserId)) || ({} as any)
    const businessName = inputBusinessName || profile.business_name || 'Verified Local Business'
    const keywordsArr = Array.isArray(inputKeywords)
      ? inputKeywords
      : typeof inputKeywords === 'string'
      ? inputKeywords.split(',').map((k: string) => k.trim()).filter(Boolean)
      : profile.target_keywords || []
    const keywordsStr = keywordsArr.join(', ')
    const description = inputDescription || profile.description || `${businessName} in ${profile.location_address || 'local area'}`

    // Clean base64 input
    const cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '')
    const inputBuffer = Buffer.from(cleanBase64, 'base64')

    // Generate EXIF GPS tags
    const now = new Date()
    const year = now.getUTCFullYear()
    const month = String(now.getUTCMonth() + 1).padStart(2, '0')
    const day = String(now.getUTCDate()).padStart(2, '0')
    const dateStamp = `${year}:${month}:${day}`

    const hours = now.getUTCHours()
    const minutes = now.getUTCMinutes()
    const seconds = now.getUTCSeconds()
    const timeStamp = `${hours}/1 ${minutes}/1 ${seconds}/1`

    const latRef = latNum >= 0 ? 'N' : 'S'
    const lngRef = lngNum >= 0 ? 'E' : 'W'
    const latDms = decimalToDms(latNum)
    const lngDms = decimalToDms(lngNum)

    // Construct metadata injection using sharp
    const processedBuffer = await sharp(inputBuffer)
      .withMetadata({
        exif: {
          IFD0: {
            ImageDescription: `${businessName} - ${keywordsStr || 'Local Storefront'}`,
            Artist: businessName,
            Copyright: `Copyright © ${year} ${businessName}. All rights reserved.`
          },
          IFD3: {
            GPSLatitudeRef: latRef,
            GPSLatitude: latDms,
            GPSLongitudeRef: lngRef,
            GPSLongitude: lngDms,
            GPSAltitude: `${Math.round(altitude)}/1`,
            GPSTimeStamp: timeStamp,
            GPSDateStamp: dateStamp
          }
        }
      })
      .jpeg({ quality: 92, mozjpeg: true })
      .toBuffer()

    const geotaggedBase64 = `data:image/jpeg;base64,${processedBuffer.toString('base64')}`
    const sanitizedFilename = `${businessName.toLowerCase().replace(/[^a-z0-9]/g, '_')}_geotagged_${Date.now()}.jpg`

    return NextResponse.json({
      success: true,
      geotaggedImageBase64: geotaggedBase64,
      filename: sanitizedFilename,
      sizeBytes: processedBuffer.length,
      coordinates: {
        latitude: latNum,
        longitude: lngNum,
        latRef,
        lngRef,
        latDms,
        lngDms,
        altitude: Math.round(altitude)
      },
      metadata: {
        businessName,
        keywords: keywordsArr,
        description,
        timestamp: now.toISOString(),
        dateStamp
      }
    })
  } catch (err: any) {
    console.error('[GBP GEOTAG API] Error:', err)
    return NextResponse.json({ error: err.message || 'Failed to geo-tag image' }, { status: 500 })
  }
}
