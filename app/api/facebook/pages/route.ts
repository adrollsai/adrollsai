import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function GET(request: Request) {
  const supabase = await createClient()
  
  // 1. Validate User
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 2. Resolve Target User ID (Handles Roles & Impersonation)
  const { searchParams } = new URL(request.url);
  const impersonateId = searchParams.get('impersonate');
  
  const { data: ownProfile } = await supabase.from('profiles').select('role, parent_id, agency_id').eq('id', user.id).single();
  let targetUserId = user.id;

  // A. Staff (Admin/Agent) automatically see their Agency's profile
  if (['admin', 'agent'].includes(ownProfile?.role || '') && (ownProfile?.parent_id || ownProfile?.agency_id)) {
      targetUserId = (ownProfile?.parent_id || ownProfile?.agency_id) as string;
  }

  // B. Impersonation (Super Admin or Agency viewing a client)
  if (impersonateId && (['super_admin', 'agency', 'admin'].includes(ownProfile?.role || ''))) {
      if (ownProfile?.role !== 'super_admin') {
          // Verify sub-account ownership
          const { data: subAccount } = await supabase
            .from('profiles')
            .select('id')
            .eq('id', impersonateId)
            .eq('agency_id', ownProfile?.agency_id || user.id)
            .single()
          if (subAccount) targetUserId = impersonateId;
      } else {
          targetUserId = impersonateId;
      }
  }

  // 3. Get Facebook Token from Target User
  const { data: profile } = await supabase
    .from('profiles')
    .select('facebook_token')
    .eq('id', targetUserId)
    .single()

  if (!profile?.facebook_token) {
    console.log(`API Error: No token found for target user ${targetUserId}`)
    return NextResponse.json({ error: 'No Facebook token found' }, { status: 400 })
  }

  const token = profile.facebook_token

  try {
    console.log("================ DEBUG FACEBOOK CONNECTION ================")
    
    // STEP A: CHECK IDENTITY (Who is logged in?)
    const meRes = await fetch(`https://graph.facebook.com/v19.0/me?access_token=${token}`)
    const meData = await meRes.json()
    
    if (meData.error) throw new Error("Identity Check Failed: " + meData.error.message)
    
    console.log(`CONNECTED USER: ${meData.name} (ID: ${meData.id})`)

    // STEP B: CHECK PERMISSIONS (Do we have business_management?)
    const permRes = await fetch(`https://graph.facebook.com/v19.0/me/permissions?access_token=${token}`)
    const permData = await permRes.json()
    
    // Log permissions nicely
    const permissions = permData.data?.map((p: any) => `${p.permission} (${p.status})`).join(', ')
    console.log("GRANTED PERMISSIONS:", permissions)

    // STEP C: FETCH PAGES (Request more fields to ensure visibility of different page types)
    const pagesRes = await fetch(`https://graph.facebook.com/v19.0/me/accounts?fields=name,id,access_token,tasks,category&limit=100&access_token=${token}`)
    const pagesData = await pagesRes.json()

    if (pagesData.error) throw new Error("Pages Fetch Failed: " + pagesData.error.message)

    console.log(`PAGES FOUND: ${pagesData.data?.length || 0}`)
    
    // Log names of pages found to verify if "Ad Rolls" is hidden or just missing
    const pageNames = pagesData.data?.map((p: any) => p.name).join(', ')
    console.log("PAGE LIST:", pageNames)
    
    console.log("===========================================================")

    return NextResponse.json({ pages: pagesData.data })

  } catch (error: any) {
    console.error("API CRASH:", error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}