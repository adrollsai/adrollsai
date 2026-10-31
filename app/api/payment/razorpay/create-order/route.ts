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
        const { planId, packageId, addonId, customAmount, customCredits, paymentType = 'one_time' } = body;

        let amountInInr = 0;
        let itemName = "";
        let purchaseType: 'subscription' | 'topup' | 'addon' = 'subscription';
        let activePlanConfig: any = null;
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

            if (planConfig.oncePerUser || normalizedPlanId === 'trial' || normalizedPlanId === '7-days-trial') {
                // Check if user has already purchased the trial package
                const { data: userProfile } = await supabase
                    .from('profiles')
                    .select('client_features, subscription_plan')
                    .eq('id', user.id)
                    .single();

                const hasUsedTrial = userProfile?.client_features?.has_purchased_trial === true ||
                    userProfile?.subscription_plan === 'trial' ||
                    userProfile?.subscription_plan === '7-days-trial';

                if (hasUsedTrial) {
                    return NextResponse.json({
                        error: "The 7-day trial package (₹999 + 18% GST) can only be purchased once per user. Please choose a monthly or annual plan."
                    }, { status: 400 });
                }

                const { count: trialTxCount } = await supabase
                    .from('credit_transactions')
                    .select('id', { count: 'exact', head: true })
                    .eq('user_id', user.id)
                    .eq('category', 'trial');

                if (trialTxCount && trialTxCount > 0) {
                    return NextResponse.json({
                        error: "The 7-day trial package (₹999 + 18% GST) has already been purchased for this account."
                    }, { status: 400 });
                }
            }

            activePlanConfig = planConfig;
            amountInInr = planConfig.totalPrice;
            itemName = planConfig.title;
            metadata = {
                ...metadata,
                type: 'subscription',
                planId: planConfig.id,
                durationMonths: planConfig.durationMonths || 0,
                durationDays: planConfig.durationDays || null,
                paymentType: paymentType,
                creditsIncluded: planConfig.creditsIncluded,
                basePrice: planConfig.basePrice,
                gstAmount: planConfig.totalPrice - planConfig.basePrice,
                isTrial: !!planConfig.oncePerUser
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

        // Fetch user profile for contact prefill
        const { data: profile } = await supabase
            .from('profiles')
            .select('full_name, phone, business_name, email')
            .eq('id', user.id)
            .single();

        // Check if this should be a Razorpay Recurring Subscription (e-Mandate / UPI Autopay)
        const isRecurringSubscription = 
            purchaseType === 'subscription' && 
            paymentType === 'recurring' && 
            !metadata.isTrial && 
            Boolean(activePlanConfig?.razorpayPlanId);

        if (isRecurringSubscription) {
            // Determine maximum cycles: 12 months = 5 cycles, 6 months = 10 cycles, 1 month = 24 cycles
            const totalCount = activePlanConfig?.durationMonths === 12 ? 5 : (activePlanConfig?.durationMonths === 6 ? 10 : 24);
            
            const subscription = await razorpay.subscriptions.create({
                plan_id: activePlanConfig!.razorpayPlanId!,
                total_count: totalCount,
                quantity: 1,
                customer_notify: 1,
                notes: {
                    ...metadata,
                    paymentType: 'recurring',
                    itemName: itemName,
                    app: 'NobogentAI'
                }
            });

            return NextResponse.json({
                success: true,
                isSubscription: true,
                subscriptionId: subscription.id,
                amount: amountInPaise,
                currency: 'INR',
                keyId: RAZORPAY_KEY_ID,
                itemName: itemName,
                purchaseType: purchaseType,
                paymentType: 'recurring',
                prefill: {
                    name: profile?.full_name || profile?.business_name || '',
                    email: profile?.email || user.email || '',
                    contact: profile?.phone || ''
                },
                notes: subscription.notes
            });
        }

        const orderOptions = {
            amount: amountInPaise,
            currency: 'INR',
            receipt: receipt,
            notes: {
                ...metadata,
                paymentType: paymentType,
                itemName: itemName,
                app: 'NobogentAI'
            }
        };

        const order = await razorpay.orders.create(orderOptions);

        return NextResponse.json({
            success: true,
            isSubscription: false,
            orderId: order.id,
            amount: order.amount,
            currency: order.currency,
            keyId: RAZORPAY_KEY_ID,
            itemName: itemName,
            purchaseType: purchaseType,
            paymentType: paymentType,
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
