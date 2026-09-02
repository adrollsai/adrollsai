import { NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { 
    verifyRazorpayWebhookSignature, 
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
        const bodyText = await req.text();
        const signature = req.headers.get('x-razorpay-signature');

        if (!signature || !bodyText) {
            return NextResponse.json({ error: "Missing webhook signature or payload" }, { status: 400 });
        }

        // Verify webhook signature
        const isValid = verifyRazorpayWebhookSignature(bodyText, signature);
        if (!isValid) {
            console.error("[Razorpay Webhook Error] Invalid signature");
            return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
        }

        const eventData = JSON.parse(bodyText);
        const event = eventData.event;
        const payload = eventData.payload;

        console.log(`[Razorpay Webhook] Received event: ${event}`);

        // Handle successful payment events
        if (event === 'payment.captured' || event === 'order.paid') {
            const paymentEntity = payload?.payment?.entity || payload?.order?.entity;
            const notes = paymentEntity?.notes || {};
            const userId = notes?.userId;
            const paymentId = paymentEntity?.id || 'webhook_pay';

            if (userId) {
                const planId = (notes.planId || '').toLowerCase().trim();
                const packageId = (notes.packageId || '').toLowerCase().trim();
                const addonId = (notes.addonId || '').toLowerCase().trim();
                const customCredits = Number(notes.credits || 0);

                const { data: profile } = await supabaseAdmin
                    .from('profiles')
                    .select('*')
                    .eq('id', userId)
                    .single();

                if (profile) {
                    const currentCredits = Number(profile.credits || 0);

                    // 1. Subscription activation via webhook
                    if (planId) {
                        const planConfig = RAZORPAY_PLANS[planId];
                        const durationMonths = planConfig?.durationMonths || (notes.durationMonths ? Number(notes.durationMonths) : 1);
                        const creditsToAdd = planConfig?.creditsIncluded || (notes.creditsIncluded ? Number(notes.creditsIncluded) : 10000);
                        const planTitle = planConfig?.title || `Pro Plan (${planId})`;

                        const planValidUntil = new Date();
                        planValidUntil.setMonth(planValidUntil.getMonth() + durationMonths);

                        await supabaseAdmin
                            .from('profiles')
                            .update({
                                subscription_plan: planId,
                                subscription_status: 'active',
                                subscription_id: paymentId,
                                subscription_valid_until: planValidUntil.toISOString(),
                                credits: currentCredits + creditsToAdd
                            })
                            .eq('id', userId);

                        if (creditsToAdd > 0) {
                            await supabaseAdmin.from('credit_transactions').insert({
                                user_id: userId,
                                amount: creditsToAdd,
                                category: 'subscription',
                                description: `Activated ${planTitle} via Webhook (#${paymentId.slice(-6)})`
                            });
                        }
                        console.log(`✅ [Razorpay Webhook] Subscription activated for user ${userId}`);
                    }

                    // 2. Credits top-up via webhook
                    else if (packageId || customCredits > 0) {
                        const packageConfig = RAZORPAY_CREDIT_PACKAGES[packageId];
                        const creditsToAdd = packageConfig?.credits || customCredits;
                        const packageName = packageConfig?.name || `Credits Top-Up (${creditsToAdd} Credits)`;

                        await supabaseAdmin
                            .from('profiles')
                            .update({
                                credits: currentCredits + creditsToAdd
                            })
                            .eq('id', userId);

                        await supabaseAdmin.from('credit_transactions').insert({
                            user_id: userId,
                            amount: creditsToAdd,
                            category: 'topup',
                            description: `Recharged ${packageName} via Webhook (#${paymentId.slice(-6)})`
                        });
                        console.log(`✅ [Razorpay Webhook] Credits added (+${creditsToAdd}) for user ${userId}`);
                    }

                    // 3. Addon purchase via webhook
                    else if (addonId) {
                        const addonConfig = ADDONS[addonId as keyof typeof ADDONS];
                        if (addonConfig) {
                            const currentCount = Number(profile[addonConfig.quotaKey] || 0);
                            const increment = Number(addonConfig.amount || 1);

                            await supabaseAdmin
                                .from('profiles')
                                .update({
                                    [addonConfig.quotaKey]: currentCount + increment
                                })
                                .eq('id', userId);
                            console.log(`✅ [Razorpay Webhook] Addon ${addonId} updated for user ${userId}`);
                        }
                    }
                }
            }
        }

        return NextResponse.json({ status: 'ok', received: true });
    } catch (error: any) {
        console.error("[Razorpay Webhook Error]:", error);
        return NextResponse.json({ error: error.message || "Webhook processing error" }, { status: 500 });
    }
}
