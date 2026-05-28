import { NextResponse } from 'next/server'
import { createClient as createServerClient } from '@/utils/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { GoogleGenerativeAI } from '@google/generative-ai'

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()
    
    // 1. Authenticate user
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { targetUserId, updates } = body

    if (!targetUserId || !updates) {
      return NextResponse.json({ error: 'Missing targetUserId or updates' }, { status: 400 })
    }

    // 2. Validate permissions of requester
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, agency_id, parent_id')
      .eq('id', user.id)
      .single()

    let authorized = false

    // Check if updating own profile
    if (targetUserId === user.id) {
      authorized = true
    }

    // Check if staff/impersonation rights exist
    if (!authorized) {
      const currentAuthRole = profile?.role || 'admin'
      
      // If agency/admin/agent, verify the target is their sub-account
      if (['super_admin', 'agency', 'admin', 'agent'].includes(currentAuthRole)) {
        if (currentAuthRole !== 'super_admin') {
          const { data: subAccount } = await supabase
            .from('profiles')
            .select('id')
            .eq('id', targetUserId)
            .eq('agency_id', profile?.agency_id || user.id)
            .single()
          
          if (subAccount) {
            authorized = true
          }
        } else {
          // Super admin is authorized for everything
          authorized = true
        }
      }
    }

    if (!authorized) {
      return NextResponse.json({ error: 'Forbidden: Unauthorized profile update' }, { status: 403 })
    }

    // Remove any fields that should not be updated via profile page
    const allowedUpdates = { ...updates }
    delete allowedUpdates.id
    delete allowedUpdates.created_at
    delete allowedUpdates.role
    delete allowedUpdates.agency_id
    delete allowedUpdates.parent_id

    // 3. Perform update using service role client to bypass RLS restrictions
    const supabaseAdmin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Check if character_url has changed and needs analysis
    if (updates.character_url !== undefined) {
      try {
        const { data: existingProfile } = await supabaseAdmin
          .from('profiles')
          .select('character_url, character_description')
          .eq('id', targetUserId)
          .single()

        if (!existingProfile || existingProfile.character_url !== updates.character_url) {
          console.log(`[Profile Update API] Character URL changed from "${existingProfile?.character_url || ''}" to "${updates.character_url}". Starting Gemini Vision analysis...`)
          if (updates.character_url) {
            const mediaRes = await fetch(updates.character_url)
            if (mediaRes.ok) {
              const buffer = Buffer.from(await mediaRes.arrayBuffer())
              const detectedMimeType = mediaRes.headers.get('content-type') || 'image/jpeg'
              // Detect if this is a video based on URL pattern or mimeType
              const isVideo = detectedMimeType.startsWith('video/') || /\.(mp4|webm|mov)/i.test(updates.character_url) || updates.character_url.includes('video')
              const mimeType = isVideo ? (detectedMimeType.startsWith('video/') ? detectedMimeType : 'video/mp4') : detectedMimeType

              console.log(`[Profile Update API] Detected media type: ${mimeType} (isVideo: ${isVideo})`)

              const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY!)
              const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" })

              const prompt = `You are a casting director. Analyze this profile character ${isVideo ? 'video' : 'photo'} and describe their exact gender (e.g. 'male' or 'female'), ethnicity/appearance, age range, hair style/color, expression, clothing style, and background environment in a short single paragraph of under 40 words. Focus strictly on their physical appearance (e.g., 'A professional young Indian man with short black hair, clean-shaven, wearing a suit and smiling warmly'). Do not add any conversational intro or metadata.`

              const result = await model.generateContent([
                prompt,
                {
                  inlineData: {
                    data: buffer.toString('base64'),
                    mimeType
                  }
                }
              ])

              const desc = result.response.text()?.trim()
              if (desc) {
                console.log(`[Profile Update API] Character analyzed successfully: ${desc}`)
                allowedUpdates.character_description = desc
              }
            } else {
              console.error(`[Profile Update API] Failed to fetch character media from ${updates.character_url}`)
            }
          } else {
            // If character_url was set to null/empty, clear the description too
            allowedUpdates.character_description = null
          }
        }
      } catch (analysisError) {
        console.error("[Profile Update API] Character media analysis failed:", analysisError)
      }
    }

    const { data, error } = await supabaseAdmin
      .from('profiles')
      .update(allowedUpdates)
      .eq('id', targetUserId)
      .select()
      .single()

    if (error) {
      console.error("[Profile Update API] Database update error:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, profile: data })

  } catch (error: any) {
    console.error("[Profile Update API] General error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
