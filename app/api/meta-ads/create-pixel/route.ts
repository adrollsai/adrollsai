import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function POST(request: Request) {
    try {
        const body = await request.json()
        const { adAccountId, pixelName, impersonateId } = body
        
        if (!adAccountId) {
            return NextResponse.json({ error: 'adAccountId is required' }, { status: 400 })
        }

        const supabase = await createClient()

        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

        const { data: profile } = await supabase.from('profiles').select('role, facebook_token, agency_id, parent_id').eq('id', user.id).single()
        
        let targetUserId = (['admin', 'agent'].includes(profile?.role || '') && (profile?.agency_id || profile?.parent_id)) 
          ? (profile.agency_id || profile.parent_id) 
          : user.id

        if (impersonateId) {
            if (['super_admin', 'agency', 'admin'].includes(profile?.role || '')) {
                if (profile?.role !== 'super_admin') {
                    const isParent = (profile?.agency_id === impersonateId || profile?.parent_id === impersonateId);
                    const { data: subAccount } = await supabase
                      .from('profiles')
                      .select('id')
                      .eq('id', impersonateId)
                      .eq('agency_id', profile?.agency_id || user.id)
                      .single()

                    if (isParent || subAccount) {
                        targetUserId = impersonateId
                    } else {
                        return NextResponse.json({ error: 'Unauthorized impersonation' }, { status: 403 })
                    }
                } else {
                    targetUserId = impersonateId
                }
            } else {
                return NextResponse.json({ error: 'Unauthorized impersonation' }, { status: 403 })
            }
        }

        const { data: targetProfile } = await supabase
          .from('profiles')
          .select('facebook_token')
          .eq('id', targetUserId)
          .single()

        let token = targetProfile?.facebook_token
        if (!token && (profile?.agency_id || profile?.parent_id)) {
            const { data: parentProfile } = await supabase
                .from('profiles')
                .select('facebook_token')
                .eq('id', profile.agency_id || profile.parent_id)
                .single()
            token = parentProfile?.facebook_token
        }

        if (!token) return NextResponse.json({ error: 'No Facebook access token found for target user' }, { status: 400 })

        // 1. Create Pixel on Meta Graph API
        const name = pixelName || 'AdRolls Auto-Generated Pixel'
        const metaRes = await fetch(`https://graph.facebook.com/v19.0/${adAccountId}/adspixels`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name,
                access_token: token
            })
        })

        const metaData = await metaRes.json()

        if (metaData.error) {
            console.error("[create-pixel API] Meta Graph API error:", metaData.error)
            return NextResponse.json({ error: metaData.error.message || 'Meta API error' }, { status: 400 })
        }

        const newPixelId = metaData.id

        // 2. Save new Pixel ID in target profile database row
        const { error: updateError } = await supabase
            .from('profiles')
            .update({ pixel_id: newPixelId })
            .eq('id', targetUserId)

        if (updateError) {
            console.error("[create-pixel API] Supabase update error:", updateError)
            return NextResponse.json({ error: 'Failed to update user profile with new Pixel ID' }, { status: 500 })
        }

        return NextResponse.json({ success: true, pixelId: newPixelId })
    } catch (e: any) {
        console.error("[create-pixel API] Unexpected error:", e)
        return NextResponse.json({ error: e.message }, { status: 500 })
    }
}
