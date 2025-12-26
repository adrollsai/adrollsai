import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'
import { sendWhatsAppTemplate } from '@/utils/external-apis'

export async function POST(request: Request) {
  const supabase = await createClient()

  // 1. Validate User
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  
  // FIX: Declare variable HERE so it is visible in both try and catch blocks
  let sanitizedTo = ''; 

  try {
    const { to } = await request.json()

    if (!to) {
      return NextResponse.json({ error: 'Missing phone number' }, { status: 400 })
    }

    // FIX: Assign value here (remove 'const')
    sanitizedTo = to.replace(/\D/g, '');
    
    if (sanitizedTo.length < 10) {
        return NextResponse.json({ error: 'Invalid phone number format.' }, { status: 400 })
    }

    // --- 🚀 DEV BYPASS START ---
    const devPhoneId = process.env.DEV_WHATSAPP_PHONE_ID;
    const devToken = process.env.DEV_WHATSAPP_ACCESS_TOKEN;

    let accessToken = "";
    let phoneNumberId = "";

    if (devPhoneId && devToken) {
        console.log("⚠️ USING DEV OVERRIDE CREDENTIALS ⚠️");
        phoneNumberId = devPhoneId;
        accessToken = devToken;
    } else {
        const { data: profile } = await supabase
          .from('profiles')
          .select('whatsapp_access_token, whatsapp_phone_number_id')
          .eq('id', user.id)
          .single()

        if (!profile?.whatsapp_access_token || !profile?.whatsapp_phone_number_id) {
          return NextResponse.json({ error: 'WhatsApp is not connected for this user' }, { status: 400 })
        }
        
        phoneNumberId = profile.whatsapp_phone_number_id;
        accessToken = profile.whatsapp_access_token;
    }
    // --- 🚀 DEV BYPASS END ---

    console.log(`Sending 'hello_world' template to ${sanitizedTo} from ID ${phoneNumberId}...`);
    
    const response = await sendWhatsAppTemplate(
      accessToken,
      phoneNumberId,
      sanitizedTo,
      "hello_world", 
      "en_US"
    )

    return NextResponse.json({ success: true, data: response })

  } catch (error: any) {
    console.error("Test Send Error:", error.message)
    
    if (error.message.includes('133010')) {
        return NextResponse.json({ 
            // Now 'sanitizedTo' is accessible here!
            error: "Dev Mode Error: The recipient number is not in your Test Whitelist. Go to Meta Dashboard > WhatsApp > API Setup and add: " + sanitizedTo 
        }, { status: 400 })
    }

    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}