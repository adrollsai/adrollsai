import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { 
    getRazorpayClient, 
    verifyRazorpaySignature, 
    RAZORPAY_PLANS, 
    RAZORPAY_CREDIT_PACKAGES 
} from '@/utils/razorpay';
import { ADDONS } from '@/utils/subscription';

const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const { 
            razorpay_order_id, 
            razorpay_payment_id, 
            razorpay_signature,
            planId,
            packageId,
            addonId,
            customCredits
        } = body;

        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            return NextResponse.json({ 
                error: "Missing Razorpay verification parameters (order_id, payment_id, signature required)" 
            }, { status: 400 });
        }

        // 1. Verify HMAC SHA256 Signature
        const isValid = verifyRazorpaySignature(
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature
        );

        if (!isValid) {
            console.error(`[Razorpay Signature Mismatch] Order: ${razorpay_order_id}, Payment: ${razorpay_payment_id}`);
            return NextResponse.json({ 
                success: false, 
                error: "Payment verification failed: Invalid digital signature." 
            }, { status: 400 });
        }

        // 2. Fetch order details from Razorpay to read verified server notes
        let orderNotes: Record<string, any> = {};
        try {
            const razorpay = getRazorpayClient();
            const orderInfo = await razorpay.orders.fetch(razorpay_order_id);
            if (orderInfo && orderInfo.notes) {
                orderNotes = orderInfo.notes;
            }
        } catch (fetchErr) {
            console.warn("[Razorpay Verify] Could not fetch order notes, falling back to request body:", fetchErr);
        }

        const effectivePlanId = (orderNotes.planId || planId || '').toLowerCase().trim();
        const effectivePackageId = (orderNotes.packageId || packageId || '').toLowerCase().trim();
        const effectiveAddonId = (orderNotes.addonId || addonId || '').toLowerCase().trim();
        const effectiveCredits = Number(orderNotes.credits || customCredits || 0);

        // Fetch current profile
        const { data: profile, error: profileErr } = await supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .single();

        if (profileErr || !profile) {
            throw new Error("User profile not found in database.");
        }

        const currentCredits = Number(profile.credits || 0);

        // --- CASE 1: SUBSCRIPTION PLAN ACTIVATION ---
        if (effectivePlanId) {
            const planConfig = RAZORPAY_PLANS[effectivePlanId] || 
                               Object.values(RAZORPAY_PLANS).find(p => p.id === effectivePlanId || p.title.toLowerCase().includes(effectivePlanId));

            const durationMonths = planConfig?.durationMonths || (orderNotes.durationMonths ? Number(orderNotes.durationMonths) : 1);
            const creditsToAdd = planConfig?.creditsIncluded || (orderNotes.creditsIncluded ? Number(orderNotes.creditsIncluded) : 10000);
            const planTitle = planConfig?.title || `Pro Plan (${effectivePlanId})`;

            const planValidUntil = new Date();
            planValidUntil.setMonth(planValidUntil.getMonth() + durationMonths);

            const newCredits = currentCredits + creditsToAdd;

            const { error: updateErr } = await supabaseAdmin
                .from('profiles')
                .update({
                    subscription_plan: effectivePlanId,
                    subscription_status: 'active',
                    subscription_id: razorpay_payment_id,
                    subscription_valid_until: planValidUntil.toISOString(),
                    credits: newCredits
                })
                .eq('id', user.id);

            if (updateErr) {
                console.error("[Razorpay Verify DB Update Error]:", updateErr);
                throw new Error("Failed to activate subscription in database.");
            }

            // Record transaction in credit_transactions ledger
            if (creditsToAdd > 0) {
                await supabaseAdmin.from('credit_transactions').insert({
                    user_id: user.id,
                    amount: creditsToAdd,
                    category: 'subscription',
                    description: `Activated ${planTitle} (Razorpay #${razorpay_payment_id.slice(-6)})`
                });
            }

            console.log(`✅ [Razorpay Success] Subscription ${effectivePlanId} activated for user ${user.id}. +${creditsToAdd} credits.`);

            return NextResponse.json({
                success: true,
                message: `Successfully activated ${planTitle}!`,
                plan: effectivePlanId,
                credits: newCredits,
                validUntil: planValidUntil.toISOString(),
                paymentId: razorpay_payment_id
            });
        }

        // --- CASE 2: CREDIT PACK TOP-UP ---
        if (effectivePackageId || effectiveCredits > 0) {
            const packageConfig = RAZORPAY_CREDIT_PACKAGES[effectivePackageId];
            const creditsToAdd = packageConfig?.credits || effectiveCredits;
            const packageName = packageConfig?.name || `Credits Top-Up (${creditsToAdd} Credits)`;

            const newCredits = currentCredits + creditsToAdd;

            const { error: updateErr } = await supabaseAdmin
                .from('profiles')
                .update({
                    credits: newCredits
                })
                .eq('id', user.id);

            if (updateErr) {
                console.error("[Razorpay Verify Credit Update Error]:", updateErr);
                throw new Error("Failed to recharge credits in database.");
            }

            // Record transaction in credit_transactions ledger
            await supabaseAdmin.from('credit_transactions').insert({
                user_id: user.id,
                amount: creditsToAdd,
                category: 'topup',
                description: `Recharged ${packageName} (Razorpay #${razorpay_payment_id.slice(-6)})`
            });

            console.log(`✅ [Razorpay Success] Credits recharged (+${creditsToAdd}) for user ${user.id}. New balance: ${newCredits}.`);

            return NextResponse.json({
                success: true,
                message: `Successfully added ${creditsToAdd.toLocaleString()} credits!`,
                credits: newCredits,
                paymentId: razorpay_payment_id
            });
        }

        // --- CASE 3: ADDON PURCHASE ---
        if (effectiveAddonId) {
            const addonConfig = ADDONS[effectiveAddonId as keyof typeof ADDONS];
            if (addonConfig) {
                const currentCount = Number(profile[addonConfig.quotaKey] || 0);
                const increment = Number(addonConfig.amount || 1);
                const newCount = currentCount + increment;

                const { error: updateErr } = await supabaseAdmin
                    .from('profiles')
                    .update({
                        [addonConfig.quotaKey]: newCount
                    })
                    .eq('id', user.id);

                if (updateErr) {
                    throw new Error("Failed to update addon quota.");
                }

                console.log(`✅ [Razorpay Success] Add-on ${effectiveAddonId} (+${increment}) added for user ${user.id}.`);

                return NextResponse.json({
                    success: true,
                    message: `Successfully purchased ${addonConfig.name}!`,
                    addon: effectiveAddonId,
                    newQuota: newCount,
                    paymentId: razorpay_payment_id
                });
            }
        }

        return NextResponse.json({
            success: true,
            message: "Payment verified successfully",
            paymentId: razorpay_payment_id
        });

    } catch (error: any) {
        console.error("[Razorpay Verify API Error]:", error);
        return NextResponse.json({
            error: error?.message || "Internal server error verifying payment."
        }, { status: 500 });
    }
}
