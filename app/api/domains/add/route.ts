// app/api/domains/add/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  
  // 1. Verify User is Admin
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Check if user is an admin in their organization
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, organization_id')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin' || !profile?.organization_id) {
    return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 })
  }

  try {
    const body = await request.json()
    const { domain } = body
    
    if (!domain) return NextResponse.json({ error: 'Domain is required' }, { status: 400 })

    // 2. Call Vercel API to Add Domain
    const projectID = process.env.VERCEL_PROJECT_ID
    const teamID = process.env.VERCEL_TEAM_ID
    const token = process.env.VERCEL_API_TOKEN

    if (!projectID || !token) {
        console.error("Missing Vercel Env Vars");
        return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
    }

    // Add Domain to Vercel Project
    const vercelResponse = await fetch(
      `https://api.vercel.com/v10/projects/${projectID}/domains?teamId=${teamID}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: domain }),
      }
    )

    const vercelData = await vercelResponse.json()

    if (vercelData.error) {
       // Handle specific Vercel errors (like domain already exists, which is fine)
       if (vercelData.error.code !== 'domain_already_in_use') {
          throw new Error(vercelData.error.message)
       }
    }

    // 3. Update Supabase (Only if Vercel accepts it)
    const { error: dbError } = await supabase
      .from('organizations')
      .update({ custom_domain: domain })
      .eq('id', profile.organization_id)

    if (dbError) throw dbError

    // 4. Return instructions to Frontend
    return NextResponse.json({ 
        success: true, 
        domain: vercelData.name || domain,
        // Send back DNS info if verification is needed
        verification: vercelData.verification, 
        configured: !vercelData.misconfigured
    })

  } catch (error: any) {
    console.error('Domain Add Error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}