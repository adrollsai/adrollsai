import { NextResponse } from 'next/server'

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url)
    const q = searchParams.get('q')
    const token = searchParams.get('token')

    if (!q || !token) return NextResponse.json({ data: [] })

    try {
        const res = await fetch(`https://graph.facebook.com/v19.0/search?type=adgeolocation&q=${encodeURIComponent(q)}&access_token=${token}`)
        const data = await res.json()
        return NextResponse.json({ data: data.data || [] })
    } catch (error) {
        return NextResponse.json({ data: [] })
    }
}