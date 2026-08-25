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
    // 3. Get Facebook Token & existing selected page from Target User
    const { data: profile } = await supabase
      .from('profiles')
      .select('facebook_token, selected_page_id, selected_page_name, selected_page_token')
      .eq('id', targetUserId)
      .single()

  if (!profile?.facebook_token) {
    console.log(`API Error: No token found for target user ${targetUserId}`)
    return NextResponse.json({ error: 'No Facebook token found' }, { status: 400 })
  }

  const token = profile.facebook_token

  try {
    console.log("================ DEBUG FACEBOOK CONNECTION ================")
    const allPages: any[] = []
    const pageIdsSeen = new Set<string>()

    // 1. Standard Discovery: /me/accounts
    try {
      console.log("Fetching /me/accounts (v19.0)...")
      const pagesRes = await fetch(`https://graph.facebook.com/v19.0/me/accounts?fields=name,id,access_token,tasks,category&limit=100&access_token=${token}`)
      const pagesData = await pagesRes.json()
      if (pagesData?.data && Array.isArray(pagesData.data)) {
        for (const p of pagesData.data) {
          if (!pageIdsSeen.has(p.id)) {
            pageIdsSeen.add(p.id)
            allPages.push(p)
            console.log(`[ME ACCOUNTS] Found: ${p.name} (${p.id})`)
          }
        }
      }
    } catch (err: any) {
      console.error("Error in /me/accounts discovery:", err.message)
    }

    // 2. Granular Scopes Discovery: debug_token (Crucial for New Pages Experience & Granular OAuth)
    try {
      const appId = process.env.NEXT_PUBLIC_FACEBOOK_APP_ID
      const appSecret = process.env.FACEBOOK_CLIENT_SECRET
      if (appId && appSecret) {
        console.log("Inspecting token debug_token for granular scopes...")
        const debugRes = await fetch(`https://graph.facebook.com/debug_token?input_token=${token}&access_token=${appId}|${appSecret}`)
        const debugData = await debugRes.json()
        const granularScopes = debugData?.data?.granular_scopes || []

        const pageTargetIds = new Set<string>()
        for (const scopeObj of granularScopes) {
          if (['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'leads_retrieval', 'pages_manage_metadata', 'pages_read_user_content'].includes(scopeObj.scope)) {
            if (Array.isArray(scopeObj.target_ids)) {
              scopeObj.target_ids.forEach((id: string) => pageTargetIds.add(id))
            }
          }
        }

        console.log(`Granular scope page IDs found: ${Array.from(pageTargetIds).join(', ')}`)

        for (const pageId of pageTargetIds) {
          if (!pageIdsSeen.has(pageId)) {
            try {
              const pageRes = await fetch(`https://graph.facebook.com/v19.0/${pageId}?fields=id,name,category,access_token&access_token=${token}`)
              const pageData = await pageRes.json()
              if (pageData && pageData.id && pageData.name) {
                pageIdsSeen.add(pageData.id)
                allPages.push({
                  id: pageData.id,
                  name: pageData.name,
                  category: pageData.category || 'General',
                  access_token: pageData.access_token || token,
                  tasks: ['MANAGE', 'CREATE_CONTENT', 'MODERATE', 'ADVERTISE']
                })
                console.log(`[GRANULAR DISCOVERY] Added page: ${pageData.name} (${pageData.id})`)
              }
            } catch (pErr: any) {
              console.error(`Error querying granular page ${pageId}:`, pErr.message)
            }
          }
        }
      }
    } catch (err: any) {
      console.error("Error inspecting debug_token:", err.message)
    }

    // 3. Business Portfolio Discovery: /me/businesses
    try {
      console.log("Checking Businesses...")
      const bizRes = await fetch(`https://graph.facebook.com/v19.0/me/businesses?access_token=${token}`)
      const bizData = await bizRes.json()
      if (bizData?.data && Array.isArray(bizData.data)) {
        console.log(`BUSINESSES FOUND: ${bizData.data.length}`)
        for (const biz of bizData.data) {
          console.log(`Scanning Business: ${biz.name} (${biz.id})`)
          try {
            const ownedRes = await fetch(`https://graph.facebook.com/v19.0/${biz.id}/owned_pages?fields=name,id,access_token,tasks,category&access_token=${token}`)
            const ownedData = await ownedRes.json()
            if (ownedData?.data && Array.isArray(ownedData.data)) {
              ownedData.data.forEach((p: any) => {
                if (!pageIdsSeen.has(p.id)) {
                  pageIdsSeen.add(p.id)
                  allPages.push(p)
                  console.log(`[BIZ OWNED] Found: ${p.name}`)
                }
              })
            }
          } catch (e: any) {
            console.error(`Error fetching owned pages for biz ${biz.id}:`, e.message)
          }

          try {
            const clientRes = await fetch(`https://graph.facebook.com/v19.0/${biz.id}/client_pages?fields=name,id,access_token,tasks,category&access_token=${token}`)
            const clientData = await clientRes.json()
            if (clientData?.data && Array.isArray(clientData.data)) {
              clientData.data.forEach((p: any) => {
                if (!pageIdsSeen.has(p.id)) {
                  pageIdsSeen.add(p.id)
                  allPages.push(p)
                  console.log(`[BIZ CLIENT] Found: ${p.name}`)
                }
              })
            }
          } catch (e: any) {
            console.error(`Error fetching client pages for biz ${biz.id}:`, e.message)
          }
        }
      }
    } catch (bizErr: any) {
      console.log("Business scan skipped / no permission:", bizErr.message)
    }

    // 4. Fallback for previously selected page if present
    if (profile.selected_page_id && !pageIdsSeen.has(profile.selected_page_id)) {
      try {
        const selRes = await fetch(`https://graph.facebook.com/v19.0/${profile.selected_page_id}?fields=id,name,category,access_token&access_token=${token}`)
        const selData = await selRes.json()
        if (selData && selData.id && selData.name) {
          pageIdsSeen.add(selData.id)
          allPages.push({
            id: selData.id,
            name: selData.name,
            category: selData.category || 'General',
            access_token: selData.access_token || profile.selected_page_token || token,
            tasks: ['MANAGE', 'CREATE_CONTENT', 'MODERATE', 'ADVERTISE']
          })
          console.log(`[SAVED PAGE FALLBACK] Added page: ${selData.name} (${selData.id})`)
        }
      } catch (e: any) {
        console.error("Error fetching saved page fallback:", e.message)
      }
    }

    console.log(`TOTAL PAGES DISCOVERED: ${allPages.length}`)
    const pageNames = allPages.map((p: any) => p.name).join(', ')
    console.log("PAGE LIST:", pageNames)

    // Check Ad Accounts
    try {
      console.log("Checking Ad Accounts...")
      const adAccRes = await fetch(`https://graph.facebook.com/v19.0/me/adaccounts?fields=name,id,account_status&access_token=${token}`)
      const adAccData = await adAccRes.json()
      console.log(`AD ACCOUNTS FOUND: ${adAccData.data?.length || 0}`)
    } catch (e: any) {
      console.error("Ad accounts check error:", e.message)
    }

    console.log("===========================================================")

    return NextResponse.json({ pages: allPages })

  } catch (error: any) {
    console.error("API CRASH:", error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}