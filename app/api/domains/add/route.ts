import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden: Admin access required' }, { status: 403 })
  }

  try {
    const body = await request.json()
    const { domain } = body
    
    if (!domain) return NextResponse.json({ error: 'Domain is required' }, { status: 400 })

    const projectID = process.env.VERCEL_PROJECT_ID
    const teamID = process.env.VERCEL_TEAM_ID 
    const token = process.env.VERCEL_API_TOKEN

    if (!projectID || !token) {
        return NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
    }

    // Attach teamId only if it exists in your env
    const teamQuery = teamID ? `?teamId=${teamID}` : ''

    // Add Domain to Vercel Project
    const vercelResponse = await fetch(
      `https://api.vercel.com/v10/projects/${projectID}/domains${teamQuery}`,
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

    if (vercelData.error && vercelData.error.code !== 'domain_already_in_use') {
       throw new Error(vercelData.error.message)
    }

    // Update Supabase Profile
    const { error: dbError } = await supabase
      .from('profiles')
      .update({ custom_domain: domain })
      .eq('id', user.id)

    if (dbError) throw dbError

    return NextResponse.json({ 
        success: true, 
        domain: vercelData.name || domain,
        verification: vercelData.verification, 
        configured: !vercelData.misconfigured
    })

  } catch (error: any) {
    console.error('Domain Add Error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}