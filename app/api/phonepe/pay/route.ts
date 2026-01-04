import { NextResponse } from 'next/server';
import axios from 'axios';
import { createClient } from '@/utils/supabase/server'; 

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { amount, adId } = body; // adId is optional

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const merchantTransactionId = `TOPUP_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    // ------------------------------------------------------------------
    // 1. CONFIGURATION: Explicitly define your Webhook URL
    // ------------------------------------------------------------------
    // REPLACE 'https://your-id.ngrok-free.app' with your ACTUAL Ngrok URL from the terminal
    const NGROK_URL = "https://unincidental-supersarcastic-irvin.ngrok-free.dev"; 
    
    // Construct the full callback URL
    const callbackUrl = `https://webhook.site/7b59408f-d17b-4f69-8cde-a00a28f722c9`;

    console.log("🔥 Initiating Payment...");
    console.log("🔗 Callback URL set to:", callbackUrl);

    // 2. Create DB entry (Transaction PENDING)
    const { error: dbError } = await supabase
      .from('transactions')
      .insert({
        order_id: merchantTransactionId,
        user_id: user.id,
        ad_id: adId || null, 
        amount: amount * 100, 
        status: 'PENDING',
      });

    if (dbError) throw new Error(dbError.message);

    // 3. Get PhonePe OAuth Token
    const tokenResponse = await axios.post(
      `${process.env.PHONEPE_BASE_URL}/v1/oauth/token`,
      {
        client_id: process.env.PHONEPE_CLIENT_ID,
        client_secret: process.env.PHONEPE_CLIENT_SECRET,
        grant_type: 'client_credentials',
        client_version: '1' 
      },
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    const accessToken = tokenResponse.data.access_token;

    // 4. Construct Payload with EXPLICIT callbackUrl
    const payload = {
      merchantId: process.env.PHONEPE_MERCHANT_ID,
      merchantOrderId: merchantTransactionId,
      merchantTransactionId: merchantTransactionId,
      merchantUserId: user.id,
      amount: amount * 100,
      
      // CRITICAL FIX: Explicitly tell PhonePe where to hit
      callbackUrl: callbackUrl, 
      
      mobileNumber: "9999999999", 
      paymentFlow: {
        type: "PG_CHECKOUT",
        message: adId ? "Ad Purchase" : "Wallet Top Up",
        merchantUrls: {
           // This is where the USER is redirected in the browser
           redirectUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/payment/check?orderId=${merchantTransactionId}`,
        }
      }
    };

    // 5. Send Payment Request
    const payResponse = await axios.post(
      `${process.env.PHONEPE_BASE_URL}/checkout/v2/pay`,
      payload,
      { 
        headers: { 
            'Authorization': `O-Bearer ${accessToken}`, 
            'Content-Type': 'application/json',
            // CRITICAL FIX: Some API versions look for this header
            'X-CALLBACK-URL': callbackUrl 
        } 
      }
    );

    const redirectUrl = payResponse.data?.redirectUrl || payResponse.data?.data?.redirectUrl;
    return NextResponse.json({ url: redirectUrl });

  } catch (error: any) {
    console.error("❌ PhonePe Error:", error.response?.data || error.message);
    return NextResponse.json({ error: 'Payment initiation failed' }, { status: 500 });
  }
}