import { NextResponse } from 'next/server';
import axios from 'axios';
import { createClient } from '@/utils/supabase/server';

export async function POST(request: Request) {
  try {
    const { orderId } = await request.json();

    // 1. Get OAuth Token (V2)
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

    // 2. Call PhonePe V2 STATUS API
    const statusResponse = await axios.get(
      `${process.env.PHONEPE_BASE_URL}/checkout/v2/order/${orderId}/status`,
      {
        headers: {
            'Authorization': `O-Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'X-MERCHANT-ID': process.env.PHONEPE_MERCHANT_ID, // <--- ADDED THIS HEADER
        },
      }
    );

    const paymentState = statusResponse.data.state; 

    // 3. Update Supabase & Fulfill
    const supabase = await createClient();
    
    const { data: transaction } = await supabase
        .from('transactions')
        .select('*')
        .eq('order_id', orderId)
        .single();

    if (!transaction) {
        return NextResponse.json({ status: 'ERROR', message: 'Transaction not found' });
    }

    if (paymentState === 'COMPLETED') {
        
        if (transaction.status !== 'SUCCESS') {
            
            // A. Mark as SUCCESS
            await supabase
              .from('transactions')
              .update({ 
                  status: 'SUCCESS', 
                  provider_reference_id: statusResponse.data.id || 'N/A' 
              })
              .eq('order_id', orderId);

            // B. Add Credits
            const creditsToAdd = transaction.amount / 100;
            
            const { data: profile } = await supabase
                .from('profiles')
                .select('ad_credits')
                .eq('id', transaction.user_id)
                .single();
                
            const newBalance = (profile?.ad_credits || 0) + creditsToAdd;
            
            await supabase
                .from('profiles')
                .update({ ad_credits: newBalance })
                .eq('id', transaction.user_id);
        }
        
        return NextResponse.json({ status: 'SUCCESS' });

    } else if (paymentState === 'FAILED') {
        await supabase
          .from('transactions')
          .update({ status: 'FAILED' })
          .eq('order_id', orderId);
          
        return NextResponse.json({ status: 'FAILED' });
    } else {
        return NextResponse.json({ status: 'PENDING' });
    }

  } catch (error: any) {
    console.error("Status Check Error:", error.response?.data || error.message);
    return NextResponse.json({ status: 'ERROR', error: error.message }, { status: 500 });
  }
}