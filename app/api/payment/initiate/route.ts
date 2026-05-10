import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { setupSubscription } from '@/utils/phonepe-subscription';

export async function POST(req: Request) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { planId } = await req.json();
        
        // For testing, we use Rs. 10 (1000 paise).
        const TEST_AMOUNT = 1000; 
        
        // Use a much simpler transaction ID format
        const transactionId = `T${Date.now().toString().slice(-8)}`;

        const currentOrigin = req.headers.get('origin') || 
                              req.headers.get('referer')?.split('/').slice(0,3).join('/') || 
                              (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/['"]/g, '').trim();

        // --- PHONEPE CLEAN ENTERPRISE SPEC ---
        const oneTimePayload = {
            merchantOrderId: transactionId,
            amount: TEST_AMOUNT,
            paymentFlow: {
                type: "PG_CHECKOUT",
                merchantUrls: {
                    redirectUrl: "https://www.google.com", 
                    redirectMode: "GET",
                    callbackUrl: process.env.PHONEPE_CALLBACK_URL
                }
            }
        };

        console.log("Attempting PhonePe One-time Payment Setup...");
        const data = await setupSubscription(oneTimePayload, "/checkout/v2/pay");

        const redirectUrl = data.redirectUrl || data.data?.instrumentResponse?.redirectInfo?.url;

        if (data.success && redirectUrl) {
            return NextResponse.json({ url: redirectUrl });
        } else {
            console.error("PhonePe Initiation Error Final:", JSON.stringify(data, null, 2));
            return NextResponse.json({ 
                error: data.message || "Payment initiation failed.",
                details: data 
            }, { status: 400 });
        }

    } catch (error: any) {
        console.error("Payment Initiation Error:", error);
        return NextResponse.json({ 
            error: error.message,
            hint: error.message?.includes("Subscription not enabled") 
                ? "Contact PhonePe to enable Autopay/Subscriptions for your MID." 
                : "Check the 'details' field in this response or server logs for the full PhonePe error payload."
        }, { status: 500 });
    }
}