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

  console.log(`DEBUG ROLE: ${ownProfile?.role} AGENCY_ID: ${ownProfile?.agency_id} PARENT_ID: ${ownProfile?.parent_id}`)

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

  console.log(`FINAL RESOLVED TARGET USER ID: ${targetUserId}`)

    console.log(`FETCHING PAGES FOR TARGET USER: ${targetUserId}`)
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
    
    // DEEP DISCOVERY (Restored for Business Portfolios)
    console.log("Running Deep Discovery (v18.0)...")
    const pagesRes = await fetch(`https://graph.facebook.com/v18.0/me/accounts?fields=name,id,access_token,tasks,category&limit=100&access_token=${token}`)
    const pagesData = await pagesRes.json()
    let allPages = [...(pagesData.data || [])]

    console.log("Checking Businesses...")
    const bizRes = await fetch(`https://graph.facebook.com/v18.0/me/businesses?access_token=${token}`)
    const bizData = await bizRes.json()
    console.log(`BUSINESSES FOUND: ${bizData.data?.length || 0}`)

    if (bizData.data) {
        for (const biz of bizData.data) {
            console.log(`Scanning Business: ${biz.name} (${biz.id})`)
            const ownedRes = await fetch(`https://graph.facebook.com/v18.0/${biz.id}/owned_pages?fields=name,id,access_token,tasks&access_token=${token}`)
            const ownedData = await ownedRes.json()
            if (ownedData.data) {
                ownedData.data.forEach((p: any) => {
                    if (!allPages.find(ap => ap.id === p.id)) {
                        allPages.push(p)
                        console.log(`[BIZ OWNED] Found: ${p.name}`)
                    }
                })
            }
            const clientRes = await fetch(`https://graph.facebook.com/v18.0/${biz.id}/client_pages?fields=name,id,access_token,tasks&access_token=${token}`)
            const clientData = await clientRes.json()
            if (clientData.data) {
                clientData.data.forEach((p: any) => {
                    if (!allPages.find(ap => ap.id === p.id)) {
                        allPages.push(p)
                        console.log(`[BIZ CLIENT] Found: ${p.name}`)
                    }
                })
            }
        }
    }

    console.log(`TOTAL PAGES DISCOVERED: ${allPages.length}`)
    const pageNames = allPages.map((p: any) => p.name).join(', ')
    console.log("PAGE LIST:", pageNames)

    // STEP E: AD ACCOUNT DEBUGGING
    console.log("Checking Ad Accounts...")
    const adAccRes = await fetch(`https://graph.facebook.com/v19.0/me/adaccounts?fields=name,id,account_status&access_token=${token}`)
    const adAccData = await adAccRes.json()
    console.log(`AD ACCOUNTS FOUND: ${adAccData.data?.length || 0}`)
    
    console.log("===========================================================")

    return NextResponse.json({ pages: allPages })

  } catch (error: any) {
    console.error("API CRASH:", error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}