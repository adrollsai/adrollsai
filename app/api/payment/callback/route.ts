import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { PLANS, ADDONS } from '@/utils/subscription';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
    console.log("--- PHONEPE WEBHOOK TRIGGERED ---");
    try {
        // --- 1. BASIC AUTH VERIFICATION (V2 Standard) ---
        const authHeader = req.headers.get('authorization');
        const expectedUser = process.env.PHONEPE_WEBHOOK_USERNAME;
        const expectedPass = process.env.PHONEPE_WEBHOOK_PASSWORD;

        if (authHeader && authHeader.startsWith('Basic ') && expectedUser) {
            const auth = Buffer.from(authHeader.split(' ')[1], 'base64').toString('ascii');
            const [user, pwd] = auth.split(':');
            if (user !== expectedUser || pwd !== expectedPass) {
                console.error("Webhook Error: Unauthorized Basic Auth");
                return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
            }
        }

        const bodyText = await req.text();
        if (!bodyText) return NextResponse.json({ error: "Empty payload" }, { status: 400 });

        let decodedResponse;
        try {
            const body = JSON.parse(bodyText);
            
            // Handle both legacy base64 'response' and direct V2 JSON
            if (body.response) {
                const decodedPayload = Buffer.from(body.response, 'base64').toString('utf-8');
                decodedResponse = JSON.parse(decodedPayload);
            } else {
                decodedResponse = body;
            }
        } catch (e) {
            return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
        }
        
        console.log("Webhook Decoded:", JSON.stringify(decodedResponse, null, 2));

        const url = new URL(req.url);
        const planId = url.searchParams.get('planId');
        const addonId = url.searchParams.get('addonId');
        const queryUserId = url.searchParams.get('userId');

        const event = decodedResponse.event;
        const payload = decodedResponse.payload || decodedResponse.data || {};
        
        const state = payload.state || decodedResponse.code;
        const isSuccess = event === 'checkout.order.completed' || state === 'COMPLETED' || state === 'SUCCESS' || state === 'PAYMENT_SUCCESS' || state === 'SUBSCRIPTION_SUCCESS';

        // --- HANDLE PAYMENT SUCCESS ---
        if (isSuccess) {
            const merchantUserId = payload.merchantUserId || decodedResponse.data?.merchantUserId || queryUserId;
            const subscriptionId = payload.merchantSubscriptionId || decodedResponse.data?.merchantSubscriptionId || '';
            const userId = merchantUserId; 

            if (userId) {
                const validUntil = new Date();
                validUntil.setMonth(validUntil.getMonth() + 1);

                if (planId) {
                    const planKey = planId.toLowerCase();
                    const plan = PLANS[planKey as keyof typeof PLANS];
                    if (plan) {
                        await supabaseAdmin.from('profiles').update({
                            subscription_plan: planKey,
                            subscription_status: 'active',
                            subscription_id: subscriptionId || null,
                            subscription_valid_until: validUntil.toISOString()
                        }).eq('id', userId);
                        console.log(`✅ Webhook: Plan updated to ${planKey} for user ${userId}`);
                    }
                } else if (addonId) {
                    const addon = ADDONS[addonId as keyof typeof ADDONS];
                    if (addon) {
                        const { data: userProfile } = await supabaseAdmin
                            .from('profiles')
                            .select('*')
                            .eq('id', userId)
                            .single();

                        if (userProfile) {
                            const currentAddonCount = userProfile[addon.quotaKey] || 0;
                            const increment = addon.amount || 1;
                            
                            await supabaseAdmin.from('profiles').update({
                                [addon.quotaKey]: currentAddonCount + increment
                            }).eq('id', userId);
                            console.log(`✅ Webhook: Add-on ${addonId} purchased (+${increment}) for user ${userId}`);
                        }
                    }
                } else {
                    // Fallback default status update
                    await supabaseAdmin.from('profiles').update({
                        subscription_status: 'active',
                        subscription_id: subscriptionId || null,
                        subscription_valid_until: validUntil.toISOString()
                    }).eq('id', userId);
                    console.log(`✅ Webhook: Default subscription/payment activated for user ${userId}`);
                }
            }
        }

        return NextResponse.json({ success: true });

    } catch (error: any) {
        console.error("Webhook Error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}