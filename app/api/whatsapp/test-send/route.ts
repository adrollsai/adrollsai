import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { sendWhatsAppTemplate } from '@/utils/external-apis'

export async function POST(request: Request) {
  const supabase = await createClient()

  // 1. Validate User (Must be logged in)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { to } = await request.json()

    if (!to) {
      return NextResponse.json({ error: 'Missing phone number' }, { status: 400 })
    }

    // Sanitize Phone Number (Remove non-digits)
    const sanitizedTo = to.replace(/\D/g, '');
    
    if (sanitizedTo.length < 10) {
        return NextResponse.json({ error: 'Invalid phone number format.' }, { status: 400 })
    }

    // 2. Fetch User's WhatsApp Credentials from Database
    const { data: profile } = await supabase
      .from('profiles')
      .select('whatsapp_access_token, whatsapp_phone_number_id')
      .eq('id', user.id)
      .single()

    if (!profile?.whatsapp_access_token || !profile?.whatsapp_phone_number_id) {
      return NextResponse.json({ error: 'WhatsApp is not connected for this user' }, { status: 400 })
    }

    console.log(`[Test Send] Sending 'hello_world' from ID ${profile.whatsapp_phone_number_id} to ${sanitizedTo}...`);
    
    // 3. Send the "hello_world" Template
    const response = await sendWhatsAppTemplate(
      profile.whatsapp_access_token,
      profile.whatsapp_phone_number_id,
      sanitizedTo,
      "welcome_msg", // <--- CHANGE THIS to your actual template name
      "en"
    )

    return NextResponse.json({ success: true, data: response })

  } catch (error: any) {
    console.error("Test Send Error:", error.message)
    
    // Friendly error for the Whitelist issue
    if (error.message.includes('133010')) {
        return NextResponse.json({ 
            error: "Meta Restriction: The recipient number is not in your Allowed Test List. Since you are in Development Mode, you must add this number in the Meta Dashboard > WhatsApp > API Setup." 
        }, { status: 400 })
    }

    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}