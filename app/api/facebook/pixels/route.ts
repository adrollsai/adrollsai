import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { fetchFacebookPixels } from '@/utils/external-apis'

export async function POST(request: Request) {
  const supabase = await createClient()
  
  // 1. Auth Check
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { adAccountId, impersonateId: bodyImpersonateId } = await request.json()
  const { searchParams } = new URL(request.url)
  const queryImpersonateId = searchParams.get('impersonate')
  const impersonateId = bodyImpersonateId || queryImpersonateId

  // 2. Resolve Target User ID (Handles Roles & Impersonation)
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

  // 3. Resolve Token
  const { data: targetProfile } = await supabase
    .from('profiles')
    .select('facebook_token, agency_id, parent_id')
    .eq('id', targetUserId)
    .single()

  let token = targetProfile?.facebook_token
  if (!token) {
      token = profile?.facebook_token
  }

  if (!token && (profile?.agency_id || profile?.parent_id)) {
      const { data: parentProfile } = await supabase
          .from('profiles')
          .select('facebook_token')
          .eq('id', profile.agency_id || profile.parent_id)
          .single()
      token = parentProfile?.facebook_token
  }

  if (!token) {
    return NextResponse.json({ error: 'No Facebook token found' }, { status: 400 })
  }

  try {
    // 4. Fetch Pixels
    const pixels = await fetchFacebookPixels(token, adAccountId)
    return NextResponse.json({ pixels })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}