import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { generateStampedImage } from '@/utils/stamp-helper'
import { sendDistributionEmail } from '@/utils/email-helper' // Import Helper

export async function POST(request: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { masterImageUrl, agents, sendEmail } = await request.json()

    if (!masterImageUrl || !agents || !Array.isArray(agents)) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Get Sender Name for Email
    const { data: profile } = await supabase.from('profiles').select('business_name').eq('id', user.id).single()
    const senderName = profile?.business_name || 'Partner'

    const results = []

    for (const agent of agents) {
      // 1. Generate Image
      const stampedUrl = await generateStampedImage({
        agentProfile: {
          business_name: agent.business_name,
          contact_number: agent.contact_number,
          logo_url: agent.logo_url
        },
        masterImageUrl,
        userId: user.id
      })

      // 2. Save Asset
      const { data: assetData } = await supabase.from('assets').insert({
        user_id: user.id,
        url: stampedUrl,
        type: 'image',
        status: 'Distributed', 
      }).select().single()

      // 3. Send Email (If requested AND agent has email)
      let emailResult = null
      if (sendEmail && agent.email) {
          emailResult = await sendDistributionEmail(agent.email, agent.business_name, stampedUrl, senderName)
      }

      results.push({
        agentName: agent.business_name,
        stampedUrl,
        assetId: assetData?.id,
        emailSent: emailResult?.success || false,
        emailError: emailResult?.error
      })
    }

    return NextResponse.json({ success: true, results })

  } catch (error: any) {
    console.error("Distribution Error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}