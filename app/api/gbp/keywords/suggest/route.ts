import { NextResponse } from 'next/server'
import { fetchIntelligentKeywords } from '@/utils/gbp-ai-auditor'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const category = searchParams.get('category') || 'Local Business'
  const city = searchParams.get('city') || ''
  const business = searchParams.get('business') || ''

  try {
    const keywords = await fetchIntelligentKeywords(category, city, business)
    return NextResponse.json({ success: true, keywords })
  } catch (err: any) {
    console.warn('[GBP Keywords API] Error generating keywords:', err)
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
