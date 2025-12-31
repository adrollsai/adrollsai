import { NextResponse } from 'next/server';
import axios from 'axios';
import { createClient } from '@/utils/supabase/server'; 

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { amount, adId } = body; 

    // 1. Authenticate User
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 2. Generate Unique Order ID
    const merchantTransactionId = `ORDER_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    // 3. SAVE "PENDING" TRANSACTION TO DB
    const { error: dbError } = await supabase
      .from('transactions')
      .insert({
        order_id: merchantTransactionId,
        user_id: user.id,
        ad_id: adId,
        amount: amount * 100, // Store in paise
        status: 'PENDING'
      });

    if (dbError) {
      console.error("DB Error:", dbError);
      return NextResponse.json({ error: 'Failed to create order' }, { status: 500 });
    }

    // 4. GET PHONEPE TOKEN (V2)
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

    // 5. INITIATE PAYMENT (V2 PAYLOAD)
    // Docs: https://developer.phonepe.com/v1/reference/pay-api-v2
    const payload = {
      merchantId: process.env.PHONEPE_MERCHANT_ID,
      merchantOrderId: merchantTransactionId, // Mandatory in V2
      merchantTransactionId: merchantTransactionId,
      merchantUserId: user.id,
      amount: amount * 100,
      mobileNumber: "9999999999", // Often required in Sandbox
      paymentFlow: {
        type: "PG_CHECKOUT",
        message: "AdRolls Payment",
        merchantUrls: {
           redirectUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/payment/check?orderId=${merchantTransactionId}`,
           // In V2, redirectUrl is passed here inside merchantUrls
        }
      }
    };

    const payResponse = await axios.post(
      `${process.env.PHONEPE_BASE_URL}/checkout/v2/pay`,
      payload,
      {
        headers: {
          'Authorization': `O-Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    // 6. HANDLE RESPONSE (V2 FORMAT)
    // The V2 response typically puts the URL at `data.redirectUrl`
    const redirectUrl = payResponse.data?.redirectUrl || payResponse.data?.data?.redirectUrl;
    
    if (!redirectUrl) {
       console.error("PhonePe V2 Response:", JSON.stringify(payResponse.data, null, 2));
       throw new Error("Redirect URL not found in PhonePe response");
    }

    return NextResponse.json({ url: redirectUrl });

  } catch (error: any) {
    console.error("PhonePe Error:", error.response?.data || error.message);
    return NextResponse.json(
      { error: error.response?.data?.message || 'Payment initiation failed' },
      { status: 500 }
    );
  }
}