import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function POST(request: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { videoUrl, title, description } = body

  const { data: profile } = await supabase
    .from('profiles')
    .select('youtube_token')
    .eq('id', user.id)
    .single()

  if (!profile?.youtube_token) {
    return NextResponse.json({ error: 'No YouTube account linked.' }, { status: 400 })
  }

  try {
    const n8nResponse = await fetch(process.env.N8N_YOUTUBE_WEBHOOK_URL!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accessToken: profile.youtube_token,
        videoUrl,
        title,
        description
      }),
    })

    if (!n8nResponse.ok) {
      const text = await n8nResponse.text()
      throw new Error(`n8n error: ${text}`)
    }

    const result = await n8nResponse.json()
    return NextResponse.json(result)

  } catch (error: any) {
    console.error(error)
    return NextResponse.json({ error: error.message || 'Posting failed' }, { status: 500 })
  }
}