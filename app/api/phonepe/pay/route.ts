import { NextResponse } from 'next/server';
import axios from 'axios';
import { createClient } from '@/utils/supabase/server'; 

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { amount, adId } = body; // adId is now OPTIONAL

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const merchantTransactionId = `TOPUP_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    // Create DB entry (ad_id can be null)
    const { error: dbError } = await supabase
      .from('transactions')
      .insert({
        order_id: merchantTransactionId,
        user_id: user.id,
        ad_id: adId || null, 
        amount: amount * 100, 
        status: 'PENDING',
        // Note: You might want to add 'description' field if your table supports it
      });

    if (dbError) throw new Error(dbError.message);

    // ... (PhonePe Token Logic - Same as before) ...
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

    // ... (Payment Initiation - Same as before) ...
    const payload = {
      merchantId: process.env.PHONEPE_MERCHANT_ID,
      merchantOrderId: merchantTransactionId,
      merchantTransactionId: merchantTransactionId,
      merchantUserId: user.id,
      amount: amount * 100,
      mobileNumber: "9999999999", 
      paymentFlow: {
        type: "PG_CHECKOUT",
        message: adId ? "Ad Purchase" : "Wallet Top Up",
        merchantUrls: {
           redirectUrl: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/payment/check?orderId=${merchantTransactionId}`,
        }
      }
    };

    const payResponse = await axios.post(
      `${process.env.PHONEPE_BASE_URL}/checkout/v2/pay`,
      payload,
      { headers: { 'Authorization': `O-Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
    );

    const redirectUrl = payResponse.data?.redirectUrl || payResponse.data?.data?.redirectUrl;
    return NextResponse.json({ url: redirectUrl });

  } catch (error: any) {
    console.error("PhonePe Error:", error.response?.data || error.message);
    return NextResponse.json({ error: 'Payment initiation failed' }, { status: 500 });
  }
}