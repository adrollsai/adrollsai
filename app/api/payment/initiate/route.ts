import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@/utils/supabase/server';

const MERCHANT_ID = (process.env.PHONEPE_MERCHANT_ID || "PGTESTPAYUAT").replace(/['"]/g, '').trim();
const SALT_KEY = (process.env.PHONEPE_SALT_KEY || "099eb0cd-02cf-4e2a-8aca-3e6c6aff0399").replace(/['"]/g, '').trim();
const SALT_INDEX = (process.env.PHONEPE_SALT_INDEX || "1").replace(/['"]/g, '').trim();

const CALLBACK_URL = (process.env.PHONEPE_CALLBACK_URL || "").replace(/['"]/g, '').trim();

const API_PATH = "/pg/v1/pay";
const PHONEPE_URL = `https://api-preprod.phonepe.com/apis/pg-sandbox${API_PATH}`;

const PLANS = {
    'starter': 4999,
    'professional': 9999,
    'enterprise': 14999
};

export async function POST(req: Request) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { planId } = await req.json();
        const basePrice = PLANS[planId as keyof typeof PLANS];
        if (!basePrice) return NextResponse.json({ error: "Invalid Plan" }, { status: 400 });

        const gst = basePrice * 0.18;
        const totalAmount = Math.round((basePrice + gst) * 100); 
        
        const safeUserId = user.id.replace(/-/g, '');
        const transactionId = `TXN-${safeUserId.substring(0,6)}-${Date.now()}`;

        // 🚨 NEW LOGIC: Identify if the user is on localhost or ngrok right now
        const currentOrigin = req.headers.get('origin') || 
                              req.headers.get('referer')?.split('/').slice(0,3).join('/') || 
                              (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/['"]/g, '').trim();

        const payload = {
            merchantId: MERCHANT_ID,
            merchantTransactionId: transactionId,
            merchantUserId: safeUserId,
            amount: totalAmount,
            
            // We append '&origin=' so the redirect route remembers where you came from
            redirectUrl: `${currentOrigin}/api/payment/redirect?planId=${planId}&userId=${user.id}&origin=${encodeURIComponent(currentOrigin)}`,
            redirectMode: "POST",
            
            callbackUrl: CALLBACK_URL, // Webhook MUST stay on Ngrok to work
            mobileNumber: "9999999999", 
            paymentInstrument: {
                type: "PAY_PAGE"
            }
        };

        const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64');
        const signString = base64Payload + API_PATH + SALT_KEY;
        const checksum = crypto.createHash('sha256').update(signString).digest('hex') + '###' + SALT_INDEX;

        const response = await fetch(PHONEPE_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-VERIFY': checksum,
                'accept': 'application/json'
            },
            body: JSON.stringify({ request: base64Payload })
        });

        const data = await response.json();

        if (data.success && data.data?.instrumentResponse?.redirectInfo?.url) {
            return NextResponse.json({ url: data.data.instrumentResponse.redirectInfo.url });
        } else {
            throw new Error(data.message || "Payment initiation failed.");
        }

    } catch (error: any) {
        console.error("Payment Initiation Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}