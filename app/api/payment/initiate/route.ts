import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { setupStandardCheckoutV2 } from '@/utils/phonepe-subscription';
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
                              "http://localhost:3000";
        const appUrl = (process.env.NEXT_PUBLIC_APP_URL || currentOrigin).replace(/['"]/g, '').trim();

        // Pass planId/addonId and userId in the redirect URL so redirect/callback can parse it!
        const redirectUrl = `${appUrl}/api/payment/redirect?userId=${user.id}` +
                            (planId ? `&planId=${planId}` : `&addonId=${addonId}`);

        const baseCallbackUrl = (process.env.PHONEPE_CALLBACK_URL || "").replace(/['"]/g, '').trim();
        const callbackUrl = `${baseCallbackUrl}?userId=${user.id}` +
                            (planId ? `&planId=${planId}` : `&addonId=${addonId}`);

        // --- PHONEPE STANDARD ONE-TIME PAYLOAD ---
        const standardPayload = {
            transactionId: transactionId,
            userId: user.id,
            amountInPaise: amountInPaise,
            redirectUrl: redirectUrl,
            callbackUrl: callbackUrl
        };

        console.log(`[PhonePe Payment] Initiating standard payment for ${itemName} (₹${price}) | ${amountInPaise} Paise...`);
        const result = await setupStandardCheckoutV2(standardPayload);

        if (result.success && result.redirectUrl) {
            return NextResponse.json({ url: result.redirectUrl });
        } else {
            console.error("PhonePe Initiation Error Final:", result);
            return NextResponse.json({ 
                error: "Payment initiation failed."
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