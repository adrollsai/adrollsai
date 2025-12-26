import { NextResponse } from 'next/server'
import { createClient } from '@/utils/supabase/server'

export async function POST(request: Request) {
  const supabase = await createClient()

  // 1. Validate User
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { waba_id, phone_number_id, code } = await request.json()

    const appId = process.env.NEXT_PUBLIC_FACEBOOK_APP_ID;
    const appSecret = process.env.FACEBOOK_CLIENT_SECRET; // Ensure this matches your .env variable name (sometimes FACEBOOK_APP_SECRET)

    if (!appSecret) {
        return NextResponse.json({ error: "Server Misconfiguration: FACEBOOK_CLIENT_SECRET is missing" }, { status: 500 });
    }

    // 2. Exchange Code for User Access Token
    // Note: redirect_uri must match exactly what was used in the frontend login call. 
    // Usually, for the JS SDK, it's empty string or the current page URL.
    const tokenUrl = `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&code=${code}&redirect_uri=`; 
    
    const tokenRes = await fetch(tokenUrl);
    const tokenData = await tokenRes.json();

    if (tokenData.error) {
        console.error("Token Exchange Error:", tokenData.error);
        return NextResponse.json({ error: `Facebook Connection Failed: ${tokenData.error.message}` }, { status: 400 });
    }

    const userAccessToken = tokenData.access_token;
    console.log(`[Connect] User Access Token Obtained.`);

    
    // 3. Smart Discovery Logic (Preserved from your code)
    let finalWabaId = waba_id;
    let finalPhoneId = phone_number_id;

    if (!finalWabaId || !finalPhoneId) {
        console.log("[Connect] IDs missing. Inspecting token to find accounts...");

        const appTokenUrl = `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&grant_type=client_credentials`;
        const appTokenRes = await fetch(appTokenUrl);
        const appTokenData = await appTokenRes.json();
        const appAccessToken = appTokenData.access_token;

        if (!appAccessToken) {
            console.error("[Connect] Failed to get App Access Token");
            return NextResponse.json({ error: "Server Error: Could not generate App Token for inspection." }, { status: 500 });
        }

        const debugUrl = `https://graph.facebook.com/v19.0/debug_token?input_token=${userAccessToken}&access_token=${appAccessToken}`;
        const debugRes = await fetch(debugUrl);
        const debugData = await debugRes.json();

        const wabaIdsToScan = new Set<string>();
        
        if (debugData.data && debugData.data.granular_scopes) {
            const scopes = debugData.data.granular_scopes;
            const wabaScope = scopes.find((s: any) => s.scope === 'whatsapp_business_management');
            
            if (wabaScope && wabaScope.target_ids) {
                wabaScope.target_ids.forEach((id: string) => wabaIdsToScan.add(id));
            }
        }

        if (wabaIdsToScan.size === 0) {
            console.log("[Connect] No granular scopes found. Trying legacy scan...");
            const businessesRes = await fetch(`https://graph.facebook.com/v19.0/me/businesses?access_token=${userAccessToken}`);
            const businessesData = await businessesRes.json();
             if (businessesData.data) {
                for (const biz of businessesData.data) {
                    const clientRes = await fetch(`https://graph.facebook.com/v19.0/${biz.id}/client_whatsapp_business_accounts?access_token=${userAccessToken}`);
                    const clientData = await clientRes.json();
                    if (clientData.data) clientData.data.forEach((w: any) => wabaIdsToScan.add(w.id));
                }
            }
        }

        // Find the Phone Number
        for (const wabaId of Array.from(wabaIdsToScan)) {
            const phoneRes = await fetch(`https://graph.facebook.com/v19.0/${wabaId}/phone_numbers?access_token=${userAccessToken}`);
            const phoneData = await phoneRes.json();

            if (phoneData.data && phoneData.data.length > 0) {
                finalWabaId = wabaId;
                finalPhoneId = phoneData.data[0].id; // Grabs the first number found
                console.log(`[Connect] MATCH FOUND! WABA: ${finalWabaId}, Phone: ${finalPhoneId}`);
                break;
            }
        }

        if (!finalWabaId || !finalPhoneId) {
             return NextResponse.json({ error: "Could not detect a WhatsApp Phone Number. Please check your Meta Business Manager." }, { status: 400 });
        }
    }

    // ============================================================
    // 4. 🚀 AUTOMATION: Register Number & Subscribe Webhook
    // ============================================================
    
    // A. Auto-Register Phone Number (Fixes #133010 "Account not registered")
    console.log(`[Connect] Auto-Registering Phone ID: ${finalPhoneId}...`);
    const registerRes = await fetch(`https://graph.facebook.com/v19.0/${finalPhoneId}/register`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${userAccessToken}`
        },
        body: JSON.stringify({
            messaging_product: "whatsapp",
            pin: "123456" // Default PIN for API-managed numbers
        })
    });
    const registerData = await registerRes.json();
    if (registerData.success) {
        console.log("✅ Phone Number Registered Successfully");
    } else {
        // We warn but don't error out, because sometimes it's already registered
        console.warn("⚠️ Phone Registration Warning (might be already registered):", JSON.stringify(registerData));
    }

    // B. Auto-Subscribe App to WABA (Fixes Silent Webhook Failures)
    console.log(`[Connect] Auto-Subscribing App to WABA ID: ${finalWabaId}...`);
    const subscribeRes = await fetch(`https://graph.facebook.com/v19.0/${finalWabaId}/subscribed_apps`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${userAccessToken}`
        },
        body: JSON.stringify({
            messaging_product: "whatsapp"
        })
    });
    const subscribeData = await subscribeRes.json();
    if (subscribeData.success) {
        console.log("✅ Webhook Subscribed Successfully");
    } else {
        console.warn("⚠️ Webhook Subscription Warning:", JSON.stringify(subscribeData));
    }
    // ============================================================


    // 5. Save to Database
    const { error } = await supabase
      .from('profiles')
      .update({
        whatsapp_business_account_id: finalWabaId,
        whatsapp_phone_number_id: finalPhoneId,
        whatsapp_access_token: userAccessToken,
      })
      .eq('id', user.id)

    if (error) {
      throw new Error("Failed to save profile: " + error.message)
    }

    return NextResponse.json({ success: true })

  } catch (error: any) {
    console.error("Connect Route Error:", error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}