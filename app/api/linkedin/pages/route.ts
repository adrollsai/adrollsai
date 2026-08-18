import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function GET(req: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Resolve Target User ID (including impersonation)
    const url = new URL(req.url)
    const impersonateId = url.searchParams.get('impersonate')
    
    const { data: ownProfile } = await supabase
      .from('profiles')
      .select('role, parent_id, agency_id')
      .eq('id', user.id)
      .single()

    let targetUserId = user.id
    if (['admin', 'agent'].includes(ownProfile?.role || '') && (ownProfile?.parent_id || ownProfile?.agency_id)) {
      targetUserId = (ownProfile?.parent_id || ownProfile?.agency_id) as string
    }

    if (impersonateId && ['super_admin', 'agency', 'admin'].includes(ownProfile?.role || '')) {
      if (ownProfile?.role !== 'super_admin') {
        const { data: subAccount } = await supabase
          .from('profiles')
          .select('id')
          .eq('id', impersonateId)
          .eq('agency_id', user.id)
          .single()
        if (subAccount) targetUserId = impersonateId
      } else {
        targetUserId = impersonateId
      }
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('linkedin_token, linkedin_id')
      .eq('id', targetUserId)
      .single()

    if (!profile?.linkedin_token) {
      return NextResponse.json({ pages: [] })
    }

    const accessToken = profile.linkedin_token

    // 1. Fetch organization ACLs using official v2 API
    const aclRes = await fetch('https://api.linkedin.com/v2/organizationalEntityAcls?q=roleAssignee', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'X-Restli-Protocol-Version': '2.0.0',
      }
    })

    const aclData = await aclRes.json()

    if (!aclRes.ok) {
      console.error('[LINKEDIN PAGES] ACL Fetch failed:', aclData)
      return NextResponse.json({ 
        error: aclData.message || 'Failed to fetch LinkedIn organizations',
        status: aclRes.status
      }, { status: aclRes.status })
    }

    const adminAcls = (aclData.elements || []).filter(
      (acl: any) => acl.role === 'ADMINISTRATOR' && acl.state === 'APPROVED'
    )

    const pages = []

    // 2. Fetch details for each organization
    for (const acl of (aclData.elements || [])) {
      try {
        const orgUrn = acl.organizationalTarget || acl.organization
        if (!orgUrn) continue
        const orgId = orgUrn.split(':').pop()
        
        const orgRes = await fetch(`https://api.linkedin.com/v2/organizations/${orgId}`, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'X-Restli-Protocol-Version': '2.0.0',
          }
        })
        
        if (orgRes.ok) {
          const orgData = await orgRes.json()
          pages.push({
            id: orgUrn,
            name: orgData.localizedName || orgData.vanityName || `Organization ${orgId}`
          })
        } else {
          pages.push({
            id: orgUrn,
            name: `LinkedIn Organization (${orgId})`
          })
        }
      } catch (err) {
        console.error('[LINKEDIN PAGES] Error fetching org details:', err)
      }
    }

    return NextResponse.json({ pages })
  } catch (error: any) {
    console.error('[LINKEDIN PAGES] Error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
