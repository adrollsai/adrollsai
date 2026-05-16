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
    
    // STEP A: CHECK IDENTITY (Who is logged in?)
    const meRes = await fetch(`https://graph.facebook.com/v19.0/me?access_token=${token}`)
    const meData = await meRes.json()
    
    if (meData.error) throw new Error("Identity Check Failed: " + meData.error.message)
    
    console.log(`CONNECTED USER: ${meData.name} (ID: ${meData.id})`)

    // STEP B: CHECK PERMISSIONS
    const permRes = await fetch(`https://graph.facebook.com/v18.0/me/permissions?access_token=${token}`)
    const permData = await permRes.json()
    const permissions = permData.data?.map((p: any) => `${p.permission} (${p.status})`).join(', ')
    const declined = permData.data?.filter((p: any) => p.status === 'declined').map((p: any) => p.permission).join(', ')
    console.log("GRANTED PERMISSIONS:", permissions)
    if (declined) console.log("DECLINED PERMISSIONS:", declined)
    
    if (!permissions.includes('business_management')) {
        console.log("CRITICAL WARNING: business_management permission is MISSING. Pages owned by Business Managers will NOT be visible.")
    }

    // 1. BROAD DISCOVERY (Query me with deep expansions)
    console.log("Running Deep Portfolio Discovery (v20.0)...")
    const broadRes = await fetch(`https://graph.facebook.com/v20.0/me?fields=id,name,accounts{name,id,access_token,tasks,category,global_brand_page_name},businesses{id,name,owned_pages{name,id,access_token,tasks},client_pages{name,id,access_token,tasks}}&access_token=${token}`)
    const broadData = await broadRes.json()
    
    let allPagesMap = new Map();

    // A. Add from me/accounts expansion
    if (broadData.accounts?.data) {
        broadData.accounts.data.forEach((p: any) => allPagesMap.set(p.id, p));
    }

    // B. Add from Businesses expansion
    if (broadData.businesses?.data) {
        broadData.businesses.data.forEach((biz: any) => {
            console.log(`Deep Scanning Business: ${biz.name} (${biz.id})`)
            if (biz.owned_pages?.data) {
                biz.owned_pages.data.forEach((p: any) => allPagesMap.set(p.id, p));
            }
            if (biz.client_pages?.data) {
                biz.client_pages.data.forEach((p: any) => allPagesMap.set(p.id, p));
            }
        });
    }

    // 2. DIRECT EDGE DISCOVERY (Fallback/Verification)
    console.log("Verifying with Direct me/accounts edge (v20.0)...")
    const directRes = await fetch(`https://graph.facebook.com/v20.0/me/accounts?fields=name,id,access_token,tasks,category&limit=250&access_token=${token}`)
    const directData = await directRes.json()
    if (directData.data) {
        directData.data.forEach((p: any) => allPagesMap.set(p.id, p));
    }

    const allPages = Array.from(allPagesMap.values());
    console.log(`TOTAL PAGES DISCOVERED: ${allPages.length}`)
    
    // Log details of all pages found
    allPages.forEach((p: any) => {
        console.log(`- Page: ${p.name} (ID: ${p.id}) Published: ${p.is_published} Tasks: ${JSON.stringify(p.tasks)}`)
    })

    // STEP E: AD ACCOUNT DEBUGGING
    console.log("Checking Ad Accounts for additional context...")
    const adAccRes = await fetch(`https://graph.facebook.com/v18.0/me/adaccounts?fields=name,id,account_status,disable_reason&access_token=${token}`)
    const adAccData = await adAccRes.json()
    console.log(`AD ACCOUNTS FOUND: ${adAccData.data?.length || 0}`)
    if (adAccData.data) {
        adAccData.data.forEach((acc: any) => {
            console.log(`- Account: ${acc.name} (ID: ${acc.id}) Status: ${acc.account_status}`)
        })
    }
    
    console.log("===========================================================")

    return NextResponse.json({ pages: allPages })

  } catch (error: any) {
    console.error("API CRASH:", error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}