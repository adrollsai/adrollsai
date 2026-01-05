import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { createAdminClient } from '@/utils/supabase/admin'
import { sendNotification } from '@/utils/notification-helper'

export async function POST(req: Request) {
  const supabase = await createClient()
  const supabaseAdmin = createAdminClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { type, delay } = await req.json()

  // Simulate delay if requested (for background testing)
  if (delay) {
      await new Promise(resolve => setTimeout(resolve, delay * 1000))
  }

  try {
      let title = "Test Notification"
      let body = "This is a test."
      let notifType: 'system' | 'lead' | 'rivalry' | 'roi' = 'system'
      let link = '/dashboard'

      // SCENARIO SELECTOR
      switch (type) {
          case 'lead':
              title = "🔥 New Lead: Sarah Jones"
              body = "Looking for 3BHK in Indiranagar. Budget: ₹1.5 Cr."
              notifType = 'lead'
              link = '/dashboard/crm'
              break;
          
          case 'rivalry':
              title = "🚀 Rank Up!"
              body = "You just surpassed 'Urban Nest Realty' on the leaderboard! Keep pushing!"
              notifType = 'rivalry'
              link = '/dashboard?tab=leaderboard'
              break;
          
          case 'roi':
              title = "💰 High ROI Alert"
              body = "Campaign 'Summer Villa' is performing at 12x ROAS! Consider increasing budget."
              notifType = 'roi'
              link = '/dashboard/ads'
              break;
              
          default:
              title = "🔔 System Test"
              body = "Checking background sync reliability."
              notifType = 'system'
      }

      // Send using Admin client (bypasses RLS for push_subscriptions)
      await sendNotification(
          supabaseAdmin,
          user.id,
          title,
          body,
          notifType,
          link
      )

      return NextResponse.json({ success: true, message: `Sent ${notifType}` })

  } catch (error: any) {
      console.error("Test Error:", error)
      return NextResponse.json({ error: error.message }, { status: 500 })
  }
}