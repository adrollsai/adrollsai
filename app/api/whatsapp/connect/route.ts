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
    const appSecret = process.env.FACEBOOK_CLIENT_SECRET;

    if (!appSecret) {
        return NextResponse.json({ error: "Server Misconfiguration: FACEBOOK_CLIENT_SECRET is missing" }, { status: 500 });
    }

    // 2. Exchange Code for User Access Token
    const tokenUrl = `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&code=${code}&redirect_uri=`; 
    
    const tokenRes = await fetch(tokenUrl);
    const tokenData = await tokenRes.json();

    if (tokenData.error) {
        console.error("Token Exchange Error:", tokenData.error);
        return NextResponse.json({ error: `Facebook Connection Failed: ${tokenData.error.message}` }, { status: 400 });
    }

    const userAccessToken = tokenData.access_token;
    console.log(`[Debug] User Access Token Obtained.`);

    
    // 3. Smart Discovery (The "X-Ray" Method)
    let finalWabaId = waba_id;
    let finalPhoneId = phone_number_id;

    if (!finalWabaId || !finalPhoneId) {
        console.log("[Debug] IDs missing. generating App Token for deep inspection...");

        // A. Generate APP Access Token (Client Credentials)
        // This is required to fully inspect the user token's granular permissions
        const appTokenUrl = `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&grant_type=client_credentials`;
        const appTokenRes = await fetch(appTokenUrl);
        const appTokenData = await appTokenRes.json();
        const appAccessToken = appTokenData.access_token;

        if (!appAccessToken) {
            console.error("[Debug] Failed to get App Access Token");
            return NextResponse.json({ error: "Server Error: Could not generate App Token for inspection." }, { status: 500 });
        }

        // B. Inspect the User Token using the App Token
        const debugUrl = `https://graph.facebook.com/v19.0/debug_token?input_token=${userAccessToken}&access_token=${appAccessToken}`;
        const debugRes = await fetch(debugUrl);
        const debugData = await debugRes.json();

        // C. Find the WABA ID in Granular Scopes
        const wabaIdsToScan = new Set<string>();
        
        if (debugData.data && debugData.data.granular_scopes) {
            const scopes = debugData.data.granular_scopes;
            // Look for management permission
            const wabaScope = scopes.find((s: any) => s.scope === 'whatsapp_business_management');
            
            if (wabaScope && wabaScope.target_ids) {
                console.log(`[Debug] Found Target WABA IDs via Inspection: ${wabaScope.target_ids}`);
                wabaScope.target_ids.forEach((id: string) => wabaIdsToScan.add(id));
            }
        }

        // D. Fallback: If inspection failed, try the old 'me/businesses' scan one last time
        if (wabaIdsToScan.size === 0) {
            console.log("[Debug] No granular scopes found. Trying legacy scan...");
            // Attempt to list businesses manually
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

        console.log(`[Debug] Total WABAs to check: ${wabaIdsToScan.size}`);

        // E. Find the Phone Number
        for (const wabaId of Array.from(wabaIdsToScan)) {
            console.log(`[Debug] Checking Phone Numbers for WABA: ${wabaId}`);
            
            const phoneRes = await fetch(`https://graph.facebook.com/v19.0/${wabaId}/phone_numbers?access_token=${userAccessToken}`);
            const phoneData = await phoneRes.json();

            if (phoneData.data && phoneData.data.length > 0) {
                finalWabaId = wabaId;
                finalPhoneId = phoneData.data[0].id;
                console.log(`[Debug] MATCH FOUND! WABA: ${finalWabaId}, Phone: ${finalPhoneId}`);
                break;
            }
        }

        if (!finalWabaId || !finalPhoneId) {
             console.log("[Debug] Inspection complete but no phone number found.");
             // Dump debug data to terminal to help you if this fails
             console.log("[Debug] Full Token Dump:", JSON.stringify(debugData, null, 2));
             return NextResponse.json({ error: "Connected to Facebook, but could not detect a WhatsApp Phone Number. Please check your Meta Business Manager." }, { status: 400 });
        }
    }

    // 4. Save to Database
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