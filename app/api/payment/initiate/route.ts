import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { setupSubscription } from '@/utils/phonepe-subscription';
import { PLANS, ADDONS } from '@/utils/subscription';

export async function POST(req: Request) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const { planId, addonId } = await req.json();
        
        let price = 0;
        let itemName = "";
        
        if (planId) {
            const planKey = planId.toLowerCase();
            const plan = PLANS[planKey as keyof typeof PLANS];
            if (!plan) return NextResponse.json({ error: "Invalid Plan ID" }, { status: 400 });
            price = plan.price;
            itemName = plan.name;
        } else if (addonId) {
            const addon = ADDONS[addonId as keyof typeof ADDONS];
            if (!addon) return NextResponse.json({ error: "Invalid Addon ID" }, { status: 400 });
            price = addon.price;
            itemName = addon.name;
        } else {
            return NextResponse.json({ error: "Missing planId or addonId" }, { status: 400 });
        }
        
        // AdRolls Transaction ID
        const transactionId = `ADR${Date.now().toString().slice(-8)}`;
        
        // Price in paise (PhonePe expects paise: 1 INR = 100 Paise)
        const amountInPaise = price * 100;

        const currentOrigin = req.headers.get('origin') || 
                              req.headers.get('referer')?.split('/').slice(0,3).join('/') || 
                              (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/['"]/g, '').trim();

        // Pass planId/addonId and userId in the redirect URL so redirect/callback can parse it!
        const redirectUrl = `${currentOrigin}/api/payment/redirect?userId=${user.id}` +
                            (planId ? `&planId=${planId}` : `&addonId=${addonId}`);

        // --- PHONEPE PAYLOAD ---
        const livePayload = {
            merchantOrderId: transactionId,
            amount: amountInPaise,
            paymentFlow: {
                type: "PG_CHECKOUT",
                merchantUrls: {
                    redirectUrl: redirectUrl, 
                    redirectMode: "GET",
                    callbackUrl: process.env.PHONEPE_CALLBACK_URL
                }
            }
        };

        console.log(`[PhonePe Payment] Initiating for ${itemName} (₹${price}) | ${amountInPaise} Paise...`);
        const data = await setupSubscription(livePayload, "/checkout/v2/pay");

        const redirectUrlFromPhonePe = data.redirectUrl || data.data?.instrumentResponse?.redirectInfo?.url;

        if (data.success && redirectUrlFromPhonePe) {
            return NextResponse.json({ url: redirectUrlFromPhonePe });
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
            hint: "Check server logs for the full PhonePe error payload."
        }, { status: 500 });
    }
}