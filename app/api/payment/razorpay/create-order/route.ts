import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { getRazorpayClient, RAZORPAY_PLANS, RAZORPAY_CREDIT_PACKAGES, RAZORPAY_KEY_ID } from '@/utils/razorpay';
import { ADDONS } from '@/utils/subscription';

export async function POST(req: Request) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: "Unauthorized. Please log in to proceed." }, { status: 401 });
        }

        const body = await req.json();
        const { planId, packageId, addonId, customAmount, customCredits } = body;

        let amountInInr = 0;
        let itemName = "";
        let purchaseType: 'subscription' | 'topup' | 'addon' = 'subscription';
        let metadata: Record<string, any> = {
            userId: user.id,
            userEmail: user.email || ''
        };

        if (planId) {
            purchaseType = 'subscription';
            const normalizedPlanId = planId.toLowerCase().trim();
            const planConfig = RAZORPAY_PLANS[normalizedPlanId] || Object.values(RAZORPAY_PLANS).find(p => p.title.toLowerCase().includes(normalizedPlanId));
            
            if (!planConfig) {
                return NextResponse.json({ error: `Invalid Subscription Plan: ${planId}` }, { status: 400 });
            }

            amountInInr = planConfig.totalPrice;
            itemName = planConfig.title;
            metadata = {
                ...metadata,
                type: 'subscription',
                planId: planConfig.id,
                durationMonths: planConfig.durationMonths,
                creditsIncluded: planConfig.creditsIncluded,
                basePrice: planConfig.basePrice,
                gstAmount: planConfig.totalPrice - planConfig.basePrice
            };
        } else if (packageId) {
            purchaseType = 'topup';
            const normalizedPackageId = packageId.toLowerCase().trim();
            const packageConfig = RAZORPAY_CREDIT_PACKAGES[normalizedPackageId];

            if (!packageConfig) {
                return NextResponse.json({ error: `Invalid Credits Package: ${packageId}` }, { status: 400 });
            }

            amountInInr = packageConfig.amount;
            itemName = packageConfig.name;
            metadata = {
                ...metadata,
                type: 'topup',
                packageId: packageConfig.id,
                credits: packageConfig.credits,
                basePrice: packageConfig.basePrice,
                gstAmount: packageConfig.amount - packageConfig.basePrice
            };
        } else if (addonId) {
            purchaseType = 'addon';
            const addonConfig = ADDONS[addonId as keyof typeof ADDONS];

            if (!addonConfig) {
                return NextResponse.json({ error: `Invalid Addon: ${addonId}` }, { status: 400 });
            }

            const basePrice = addonConfig.price;
            amountInInr = Math.round(basePrice * 1.18);
            itemName = `${addonConfig.name} (+18% GST)`;
            metadata = {
                ...metadata,
                type: 'addon',
                addonId: addonId,
                quotaKey: addonConfig.quotaKey,
                amount: addonConfig.amount,
                basePrice: basePrice,
                gstAmount: amountInInr - basePrice
            };
        } else if (customAmount && customCredits) {
            purchaseType = 'topup';
            const basePrice = Number(customAmount);
            amountInInr = Math.round(basePrice * 1.18);
            itemName = `Custom Recharge (${customCredits} Credits + 18% GST)`;
            metadata = {
                ...metadata,
                type: 'topup',
                credits: Number(customCredits),
                basePrice: basePrice,
                gstAmount: amountInInr - basePrice
            };
        } else {
            return NextResponse.json({ error: "Missing purchase item (planId, packageId, or addonId required)" }, { status: 400 });
        }

        if (amountInInr <= 0) {
            return NextResponse.json({ error: "Invalid payment amount" }, { status: 400 });
        }

        // Razorpay accepts amount in paise (1 INR = 100 paise)
        const amountInPaise = Math.round(amountInInr * 100);
        const receipt = `rcpt_${Date.now().toString().slice(-8)}_${Math.random().toString(36).substring(2, 6)}`;

        const razorpay = getRazorpayClient();
        const orderOptions = {
            amount: amountInPaise,
            currency: 'INR',
            receipt: receipt,
            notes: {
                ...metadata,
                itemName: itemName,
                app: 'NobogentAI'
            }
        };

        const order = await razorpay.orders.create(orderOptions);

        // Fetch user profile for contact prefill
        const { data: profile } = await supabase
            .from('profiles')
            .select('full_name, phone, business_name, email')
            .eq('id', user.id)
            .single();

        return NextResponse.json({
            success: true,
            orderId: order.id,
            amount: order.amount,
            currency: order.currency,
            keyId: RAZORPAY_KEY_ID,
            itemName: itemName,
            purchaseType: purchaseType,
            prefill: {
                name: profile?.full_name || profile?.business_name || '',
                email: profile?.email || user.email || '',
                contact: profile?.phone || ''
            },
            notes: order.notes
        });

    } catch (error: any) {
        console.error("[Razorpay Create Order Error]:", error);
        return NextResponse.json({
            error: error?.message || "Failed to initiate Razorpay order.",
            details: error?.error || null
        }, { status: 500 });
    }
}
