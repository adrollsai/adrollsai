import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { setupSubscription } from '@/utils/phonepe-subscription';

export async function POST(req: Request) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { planId } = await req.json();
        
        // For testing, we use Rs. 5 (500 paise). In production, this would be the plan price.
        const TEST_AMOUNT = 500; 
        
        const safeUserId = user.id.replace(/-/g, '');
        const transactionId = `SUB-TXN-${safeUserId.substring(0,6)}-${Date.now()}`;
        const subscriptionId = `SUB-${safeUserId.substring(0,6)}-${Date.now()}`;

        const currentOrigin = req.headers.get('origin') || 
                              req.headers.get('referer')?.split('/').slice(0,3).join('/') || 
                              (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/['"]/g, '').trim();

        // --- PHONEPE STANDARD CHECKOUT SUBSCRIPTION SETUP (CORRECT DOUBLE NESTING) ---
        const payload = {
            merchantOrderId: transactionId,
            amount: TEST_AMOUNT, 
            
            paymentFlow: {
                type: "SUBSCRIPTION_CHECKOUT_SETUP",
                merchantUrls: {
                    redirectUrl: `${currentOrigin}/api/payment/redirect?planId=${planId}&userId=${user.id}&subscriptionId=${subscriptionId}`,
                    redirectMode: "POST",
                    callbackUrl: process.env.PHONEPE_CALLBACK_URL
                },
                subscriptionDetails: {
                    subscriptionType: "RECURRING",
                    merchantSubscriptionId: subscriptionId,
                    authWorkflowType: "TRANSACTION", 
                    amountType: "FIXED",
                    maxAmount: TEST_AMOUNT, // Required for setup
                    frequency: "MONTHLY",
                    productType: "UPI_MANDATE", // Standard for V2 Autopay
                    expireAt: Math.floor((Date.now() + (5 * 365 * 24 * 60 * 60 * 1000))), // 5 years
                }
            }
        };

        const data = await setupSubscription(payload, "/checkout/v2/pay");

        if (data.success && data.data?.instrumentResponse?.redirectInfo?.url) {
            return NextResponse.json({ url: data.data.instrumentResponse.redirectInfo.url });
        } else {
            console.error("PhonePe Subscription Setup Error:", data);
            throw new Error(data.message || "Subscription setup failed.");
        }

    } catch (error: any) {
        console.error("Payment Initiation Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}