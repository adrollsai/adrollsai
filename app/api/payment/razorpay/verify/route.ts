import { NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import {
    getRazorpayClient,
    verifyRazorpaySignature,
    verifyRazorpaySubscriptionSignature,
    RAZORPAY_PLANS,
    RAZORPAY_CREDIT_PACKAGES
} from '@/utils/razorpay';
import { ADDONS } from '@/utils/subscription';
import { resolveRequestUser } from '@/utils/api-auth';
import { grantCreditsOnce, creditBalance } from '@/lib/automation/billing';

const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Verify a Razorpay payment and apply it exactly once.
 *
 * Two things this route got wrong and must not regress:
 *
 * 1. IT WAS NOT IDEMPOTENT. Every call with a valid signature added the credits
 *    again. A native app on a flaky network retries — that is normal behaviour,
 *    and it was free money. The webhook deduped via `processed_webhook_messages`;
 *    this route had nothing. Now the ledger's unique index on `ref` decides the
 *    single winner and every other caller is answered "already applied" without
 *    crediting again.
 *
 * 2. IT WAS COOKIE-ONLY. `createClient()` + `auth.getUser()` cannot be reached
 *    from the Flutter/Capacitor client at all, so the native app could take a
 *    payment and then never activate it. `resolveRequestUser` accepts
 *    `Authorization: Bearer <access_token>` as well.
 *
 * Three money objects stay separate: a subscription grants monthly credits, a
 * credit pack is a one-off top-up, an add-on raises a quota. None of them is
 * "the balance"; they all end up as ledger rows with distinct refs.
 */
export async function POST(req: Request) {
    try {
        const { user } = await resolveRequestUser(req);

        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const {
            razorpay_order_id,
            razorpay_subscription_id,
            razorpay_payment_id,
            razorpay_signature,
            planId,
            packageId,
            addonId,
            customCredits
        } = body;

        if ((!razorpay_order_id && !razorpay_subscription_id) || !razorpay_payment_id || !razorpay_signature) {
            return NextResponse.json({
                error: "Missing Razorpay verification parameters (order_id/subscription_id, payment_id, signature required)"
            }, { status: 400 });
        }

        // 1. Verify HMAC SHA256 Signature (Order vs Subscription)
        let isValid = false;
        if (razorpay_subscription_id) {
            isValid = verifyRazorpaySubscriptionSignature(
                razorpay_subscription_id,
                razorpay_payment_id,
                razorpay_signature
            );
        } else if (razorpay_order_id) {
            isValid = verifyRazorpaySignature(
                razorpay_order_id,
                razorpay_payment_id,
                razorpay_signature
            );
        }

        if (!isValid) {
            console.error(`[Razorpay Signature Mismatch] Ref: ${razorpay_subscription_id || razorpay_order_id}, Payment: ${razorpay_payment_id}`);
            return NextResponse.json({
                success: false,
                error: "Payment verification failed: Invalid digital signature."
            }, { status: 400 });
        }

        // 2. Fetch order or subscription details from Razorpay to read verified server notes
        let orderNotes: Record<string, any> = {};
        try {
            const razorpay = getRazorpayClient();
            if (razorpay_subscription_id) {
                const subInfo = await razorpay.subscriptions.fetch(razorpay_subscription_id);
                if (subInfo && subInfo.notes) {
                    orderNotes = subInfo.notes;
                }
            } else if (razorpay_order_id) {
                const orderInfo = await razorpay.orders.fetch(razorpay_order_id);
                if (orderInfo && orderInfo.notes) {
                    orderNotes = orderInfo.notes;
                }
            }
        } catch (fetchErr) {
            console.warn("[Razorpay Verify] Could not fetch notes from Razorpay, falling back to request body:", fetchErr);
        }

        const effectivePlanId = (orderNotes.planId || planId || '').toLowerCase().trim();
        const effectivePackageId = (orderNotes.packageId || packageId || '').toLowerCase().trim();
        const effectiveAddonId = (orderNotes.addonId || addonId || '').toLowerCase().trim();
        const effectiveCredits = Number(orderNotes.credits || customCredits || 0);

        // One payment id is one event. Every branch below claims this ref.
        const paymentRef = `razorpay:${razorpay_payment_id}`;

        // Fetch current profile
        const { data: profile, error: profileErr } = await supabaseAdmin
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .single();

        if (profileErr || !profile) {
            throw new Error("User profile not found in database.");
        }

        // --- CASE 1: SUBSCRIPTION PLAN ACTIVATION ---
        if (effectivePlanId) {
            const isTrial = effectivePlanId === 'trial' || effectivePlanId === '7-days-trial' || Boolean(orderNotes.isTrial);
            const effectivePaymentType = orderNotes.paymentType || body.paymentType || 'one_time';

            if (isTrial && profile.client_features?.has_purchased_trial) {
                return NextResponse.json({
                    success: false,
                    error: "This 7-day trial package has already been purchased once for this account."
                }, { status: 400 });
            }

            const planConfig = RAZORPAY_PLANS[effectivePlanId] ||
                               Object.values(RAZORPAY_PLANS).find(p => p.id === effectivePlanId || p.title.toLowerCase().includes(effectivePlanId));

            const durationMonths = planConfig?.durationMonths || (orderNotes.durationMonths ? Number(orderNotes.durationMonths) : 1);
            // Every credit figure comes from RAZORPAY_PLANS. The last-resort fallback used to be
            // `isTrial ? 2500 : 10000` — a third hardcoded table no pricing page had ever shown, so an
            // unrecognised plan silently granted 10,000 credits. A trial falls back to the trial
            // config, and anything unrecognised grants ZERO and says so, because granting a number
            // nobody priced is worse than granting none.
            const configuredCredits = planConfig?.creditsIncluded;
            const creditsToAdd =
                typeof configuredCredits === 'number'
                    ? configuredCredits
                    : orderNotes.creditsIncluded
                        ? Number(orderNotes.creditsIncluded)
                        : isTrial
                            ? RAZORPAY_PLANS['trial'].creditsIncluded
                            : 0;
            if (!planConfig && !orderNotes.creditsIncluded && !isTrial) {
                console.warn(
                    `[razorpay/verify] unknown plan "${effectivePlanId}" — granting ${creditsToAdd} credits. ` +
                        'Add it to RAZORPAY_PLANS instead of relying on a fallback.',
                );
            }
            const planTitle = planConfig?.title || (isTrial ? '7-Day Trial Pass' : `Pro Plan (${effectivePlanId})`);

            const planValidUntil = new Date();
            if (isTrial || planConfig?.durationDays) {
                const days = planConfig?.durationDays || 7;
                planValidUntil.setDate(planValidUntil.getDate() + days);
            } else {
                planValidUntil.setMonth(planValidUntil.getMonth() + durationMonths);
            }

            // Claim the payment and move the credits in one atomic step. Losing
            // this race means someone already applied it — say so, charge nothing.
            const grant = await grantCreditsOnce(supabaseAdmin, {
                userId: user.id,
                amount: creditsToAdd,
                category: isTrial ? 'trial' : 'subscription',
                description: `Activated ${planTitle} (${effectivePaymentType === 'recurring' ? 'Recurring' : 'One-Time'}) (Razorpay #${razorpay_payment_id.slice(-6)})`,
                ref: paymentRef,
            });

            if (grant.duplicate) {
                console.log(`[Razorpay Verify] Payment ${razorpay_payment_id} already applied for user ${user.id}; not crediting again.`);
                return NextResponse.json({
                    success: true,
                    message: `This payment was already applied — ${planTitle} is active.`,
                    plan: isTrial ? 'trial' : effectivePlanId,
                    credits: await creditBalance(supabaseAdmin, user.id),
                    validUntil: profile.subscription_valid_until || null,
                    paymentId: razorpay_payment_id,
                    paymentType: effectivePaymentType,
                    isTrial,
                    duplicate: true,
                });
            }

            if (!grant.granted) {
                console.error(`[Razorpay Verify] Could not apply payment ${razorpay_payment_id} for user ${user.id}`);
                return NextResponse.json({
                    success: false,
                    error: "Payment verified but could not be applied. Support has been notified — please do not pay again."
                }, { status: 500 });
            }

            const updatedClientFeatures = {
                ...(profile.client_features || {}),
                payment_type: effectivePaymentType,
                is_recurring: effectivePaymentType === 'recurring' || Boolean(razorpay_subscription_id),
                razorpay_subscription_id: razorpay_subscription_id || null,
                ...(isTrial ? {
                    has_purchased_trial: true,
                    trial_purchased_at: new Date().toISOString()
                } : {})
            };

            // Note: no `credits` write here. grantCreditsOnce already moved the
            // balance atomically; writing it again would double-count.
            const { error: updateErr } = await supabaseAdmin
                .from('profiles')
                .update({
                    subscription_plan: isTrial ? 'trial' : effectivePlanId,
                    subscription_status: isTrial ? 'trialing' : 'active',
                    subscription_id: razorpay_subscription_id || razorpay_payment_id,
                    subscription_valid_until: planValidUntil.toISOString(),
                    client_features: updatedClientFeatures
                })
                .eq('id', user.id);

            if (updateErr) {
                // The money is already in the wallet, which is the safe direction:
                // the customer has what they paid for even if plan metadata lagged.
                console.error("[Razorpay Verify DB Update Error]:", updateErr);
                console.warn(`[Razorpay Verify] Payment ${razorpay_payment_id} credited but plan metadata failed for ${user.id}. Manual reconciliation needed.`);
            }

            console.log(`✅ [Razorpay Success] Subscription ${effectivePlanId} activated for user ${user.id}. +${creditsToAdd} credits.`);

            return NextResponse.json({
                success: true,
                message: `Successfully activated ${planTitle}!`,
                plan: isTrial ? 'trial' : effectivePlanId,
                credits: grant.balance,
                validUntil: planValidUntil.toISOString(),
                paymentId: razorpay_payment_id,
                paymentType: effectivePaymentType,
                isTrial: isTrial
            });
        }

        // --- CASE 2: CREDIT PACK TOP-UP ---
        if (effectivePackageId || effectiveCredits > 0) {
            const packageConfig = RAZORPAY_CREDIT_PACKAGES[effectivePackageId];
            const creditsToAdd = packageConfig?.credits || effectiveCredits;
            const packageName = packageConfig?.name || `Credits Top-Up (${creditsToAdd} Credits)`;

            const grant = await grantCreditsOnce(supabaseAdmin, {
                userId: user.id,
                amount: creditsToAdd,
                category: 'topup',
                description: `Recharged ${packageName} (Razorpay #${razorpay_payment_id.slice(-6)})`,
                ref: paymentRef,
            });

            if (grant.duplicate) {
                console.log(`[Razorpay Verify] Top-up ${razorpay_payment_id} already applied for user ${user.id}.`);
                return NextResponse.json({
                    success: true,
                    message: `This top-up was already applied — ${creditsToAdd.toLocaleString()} credits are in your wallet.`,
                    credits: await creditBalance(supabaseAdmin, user.id),
                    paymentId: razorpay_payment_id,
                    duplicate: true,
                });
            }

            if (!grant.granted) {
                console.error(`[Razorpay Verify] Could not apply top-up ${razorpay_payment_id} for user ${user.id}`);
                return NextResponse.json({
                    success: false,
                    error: "Payment verified but the credits could not be applied. Support has been notified — please do not pay again."
                }, { status: 500 });
            }

            console.log(`✅ [Razorpay Success] Credits recharged (+${creditsToAdd}) for user ${user.id}. New balance: ${grant.balance}.`);

            return NextResponse.json({
                success: true,
                message: `Successfully added ${creditsToAdd.toLocaleString()} credits!`,
                credits: grant.balance,
                paymentId: razorpay_payment_id
            });
        }

        // --- CASE 3: ADDON PURCHASE ---
        if (effectiveAddonId) {
            const addonConfig = ADDONS[effectiveAddonId as keyof typeof ADDONS];
            if (addonConfig) {
                // An add-on raises a quota rather than adding credits, so the claim
                // is a zero-credit ledger row that still carries the payment ref.
                const claim = await grantCreditsOnce(supabaseAdmin, {
                    userId: user.id,
                    amount: 0,
                    category: 'topup',
                    description: `Add-on ${addonConfig.name} (Razorpay #${razorpay_payment_id.slice(-6)})`,
                    ref: paymentRef,
                });

                if (claim.duplicate) {
                    return NextResponse.json({
                        success: true,
                        message: `This add-on payment was already applied.`,
                        addon: effectiveAddonId,
                        newQuota: Number(profile[addonConfig.quotaKey] || 0),
                        paymentId: razorpay_payment_id,
                        duplicate: true,
                    });
                }

                if (!claim.granted) {
                    return NextResponse.json({
                        success: false,
                        error: "Payment verified but the add-on could not be applied. Support has been notified — please do not pay again."
                    }, { status: 500 });
                }

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
                    console.error("[Razorpay Verify] Add-on quota update failed:", updateErr);
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
