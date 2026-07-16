import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function POST(req: Request) {
  try {
    const { assetUrl, text, type } = await req.json()
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    // Resolve Target User ID
    const url = new URL(req.url);
    const impersonateId = url.searchParams.get('impersonate');
    const { data: ownProfile } = await supabase.from('profiles').select('role, parent_id, agency_id').eq('id', user.id).single();
    let targetUserId = user.id;

    if (['admin', 'agent'].includes(ownProfile?.role || '') && (ownProfile?.parent_id || ownProfile?.agency_id)) {
        targetUserId = (ownProfile?.parent_id || ownProfile?.agency_id) as string;
    }

    if (impersonateId && ['super_admin', 'agency', 'admin'].includes(ownProfile?.role || '')) {
        if (ownProfile?.role !== 'super_admin') {
            const { data: subAccount } = await supabase.from('profiles').select('id').eq('id', impersonateId).eq('agency_id', user.id).single();
            if (subAccount) targetUserId = impersonateId;
            else return NextResponse.json({ error: 'Unauthorized impersonation' }, { status: 403 });
        } else {
            targetUserId = impersonateId;
        }
    }

    const { data: profile } = await supabase.from('profiles').select('linkedin_token, linkedin_id, linkedin_urn').eq('id', targetUserId).single()
    
    if (!profile?.linkedin_token || !profile?.linkedin_id) {
      return NextResponse.json({ error: impersonateId ? 'Client LinkedIn not connected' : 'LinkedIn not connected' }, { status: 400 })
    }

    const accessToken = profile.linkedin_token
    const urn = profile.linkedin_urn || `urn:li:person:${profile.linkedin_id}`

    const linkedinVersion = '202604'
    let response;

    if (assetUrl) {
      // --- LATEST 2026 VERSIONED REST API ---
      
      const isVideo = type === 'video'
      const initEndpoint = isVideo 
        ? 'https://api.linkedin.com/rest/videos?action=initializeUpload'
        : 'https://api.linkedin.com/rest/images?action=initializeUpload'

      // 1. Initialize Upload
      const initRes = await fetch(initEndpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Linkedin-Version': linkedinVersion,
          'X-Restli-Protocol-Version': '2.0.0',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          [isVideo ? 'initializeUploadRequest' : 'initializeUploadRequest']: {
            owner: urn
          }
        })
      })

      const initData = await initRes.json()
      if (!initRes.ok) throw new Error(`LinkedIn Init Error: ${initData.message || 'Failed'}`)

      const uploadUrl = isVideo 
        ? initData.value.uploadInstructions[0].uploadUrl 
        : initData.value.uploadUrl
      const assetUrn = isVideo ? initData.value.video : initData.value.image

      // 2. Fetch from R2 and Upload Binary
      const fileRes = await fetch(assetUrl)
      const fileBlob = await fileRes.arrayBuffer()

      const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': type === 'video' ? 'video/mp4' : 'image/jpeg'
        },
        body: fileBlob
      })

      if (!uploadRes.ok) throw new Error('LinkedIn Binary Upload Failed')

      // 2.5 Wait for processing (Latest docs say images are fast, but 3s is safe)
      await new Promise(resolve => setTimeout(resolve, 3000))

      // 3. Create Final Post
      response = await fetch('https://api.linkedin.com/rest/posts', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Linkedin-Version': linkedinVersion,
          'X-Restli-Protocol-Version': '2.0.0',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          author: urn,
          commentary: text,
          visibility: 'PUBLIC',
          distribution: {
            feedDistribution: 'MAIN_FEED'
          },
          content: {
            media: {
              id: assetUrn
            }
          },
          lifecycleState: 'PUBLISHED'
        })
      })
    } else {
      // TEXT ONLY POST
      response = await fetch('https://api.linkedin.com/rest/posts', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Linkedin-Version': linkedinVersion,
          'X-Restli-Protocol-Version': '2.0.0',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          author: urn,
          commentary: text,
          visibility: 'PUBLIC',
          distribution: {
            feedDistribution: 'MAIN_FEED'
          },
          lifecycleState: 'PUBLISHED'
        })
      })
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ message: 'LinkedIn API error' }))
      throw new Error(errorData.message || `LinkedIn error ${response.status}`)
    }

    // Modern API returns ID in 'x-restli-id' header
    const postId = response.headers.get('x-restli-id')

    return NextResponse.json({ success: true, postId })

  } catch (error: any) {
    console.error('LinkedIn Post Error:', error)
    
    let userMessage = error.message || 'LinkedIn posting failed'
    if (userMessage.includes('BadRequestResponseException') || userMessage.includes('duplicate')) {
      userMessage = "Duplicate Post Detected: You have already shared this content recently. Please change your caption or try a different asset."
    }

    return NextResponse.json({ error: userMessage }, { status: 500 })
  }
}
