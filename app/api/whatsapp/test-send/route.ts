import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { sendWhatsAppTemplate } from '@/utils/external-apis' // Import the NEW function

export async function POST(request: Request) {
  const supabase = await createClient()

  // 1. Validate User
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { to } = await request.json() // We ignore 'message' for now, we use a fixed template

    if (!to) {
      return NextResponse.json({ error: 'Missing phone number' }, { status: 400 })
    }

    // --- Sanitize Phone Number ---
    const sanitizedTo = to.replace(/\D/g, '');
    
    if (sanitizedTo.length < 10) {
        return NextResponse.json({ error: 'Invalid phone number format.' }, { status: 400 })
    }

    // 2. Fetch User's WhatsApp Credentials
    const { data: profile } = await supabase
      .from('profiles')
      .select('whatsapp_access_token, whatsapp_phone_number_id')
      .eq('id', user.id)
      .single()

    if (!profile?.whatsapp_access_token || !profile?.whatsapp_phone_number_id) {
      return NextResponse.json({ error: 'WhatsApp is not connected for this user' }, { status: 400 })
    }

    // 3. Send the "hello_world" Template
    // This bypasses the 24-hour session rule for testing.
    console.log(`Sending 'hello_world' template to ${sanitizedTo}...`);
    
    const response = await sendWhatsAppTemplate(
      profile.whatsapp_access_token,
      profile.whatsapp_phone_number_id,
      sanitizedTo,
      "hello_world", // The universal test template
      "en_US"
    )

    return NextResponse.json({ success: true, data: response })

  } catch (error: any) {
    console.error("Test Send Error:", error.message)
    
    // Check for the specific #133010 error again
    if (error.message.includes('133010')) {
        return NextResponse.json({ 
            error: "Still seeing 'Account not registered'? This confirms the number is not in your Test Whitelist. Please go to Meta App Dashboard > WhatsApp > API Setup and ensure the number is added exactly as: " + error.message 
        }, { status: 400 })
    }

    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}