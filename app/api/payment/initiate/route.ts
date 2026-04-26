import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@/utils/supabase/server';

// 1. HARDCODED YOUR EXACT CREDENTIALS TO BYPASS ANY CACHE ISSUES
const MERCHANT_ID = "PGTESTPAYUAT";
const SALT_KEY = "099eb0cd-02cf-4e2a-8aca-3e6c6aff0399";
const SALT_INDEX = "1";

const BASE_URL = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").trim();
const CALLBACK_URL = (process.env.PHONEPE_CALLBACK_URL || "").trim();

// 2. THE ONLY ENDPOINT ALLOWED FOR PGTESTPAYUAT
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
        
        // Strip hyphens for PhonePe safety
        const safeUserId = user.id.replace(/-/g, '');
        const transactionId = `TXN-${safeUserId.substring(0,6)}-${Date.now()}`;

        // STANDARD PAYLOAD (No recurring tags allowed here)
        const payload = {
            merchantId: MERCHANT_ID,
            merchantTransactionId: transactionId,
            merchantUserId: safeUserId,
            amount: totalAmount,
            redirectUrl: `${BASE_URL}/dashboard/billing?payment=success`,
            redirectMode: "REDIRECT",
            callbackUrl: CALLBACK_URL,
            mobileNumber: "9999999999", 
            paymentInstrument: {
                type: "PAY_PAGE"
            }
        };

        const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64');
        
        // CHECKSUM
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
            console.error("PhonePe API Error:", data);
            throw new Error(data.message || "Payment initiation failed.");
        }

    } catch (error: any) {
        console.error("Payment Initiation Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}