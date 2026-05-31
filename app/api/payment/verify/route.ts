import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@/utils/supabase/server'; 
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { PLANS, ADDONS } from '@/utils/subscription';

const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const MERCHANT_ID = (process.env.PHONEPE_MERCHANT_ID || "").replace(/['"]/g, '').trim();
const SALT_KEY = (process.env.PHONEPE_SALT_KEY || "").replace(/['"]/g, '').trim();
const SALT_INDEX = (process.env.PHONEPE_SALT_INDEX || "").replace(/['"]/g, '').trim();

// Production Status API Url
const STATUS_URL = `https://api.phonepe.com/apis/hermes/pg/v1/status`;

export async function POST(req: Request) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { transactionId, planId, addonId } = await req.json();
        
        if (!transactionId) return NextResponse.json({ error: "Missing Transaction ID" }, { status: 400 });

        // 1. Generate Checksum for the Status Check
        const signString = `/pg/v1/status/${MERCHANT_ID}/${transactionId}` + SALT_KEY;
        const checksum = crypto.createHash('sha256').update(signString).digest('hex') + '###' + SALT_INDEX;

        // 2. Call PhonePe Status API
        const options = {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'X-VERIFY': checksum,
                'X-MERCHANT-ID': MERCHANT_ID
            }
        };

        const response = await fetch(`${STATUS_URL}/${MERCHANT_ID}/${transactionId}`, options);
        const data = await response.json();

        // 3. If PhonePe confirms it was a success, update the DB!
        if (data.success && data.code === 'PAYMENT_SUCCESS') {
            const validUntil = new Date();
            validUntil.setMonth(validUntil.getMonth() + 1);

            // 3a. Process Plan Upgrade
            if (planId) {
                const planKey = planId.toLowerCase();
                const plan = PLANS[planKey as keyof typeof PLANS];
                
                if (plan) {
                    const { error } = await supabaseAdmin.from('profiles').update({
                        subscription_plan: planKey,
                        subscription_status: 'active',
                        subscription_valid_until: validUntil.toISOString()
                    }).eq('id', user.id);

                    if (error) throw new Error("Failed to update plan database.");
                    return NextResponse.json({ success: true, message: `Successfully upgraded to ${plan.name}!` });
                }
            }

            // 3b. Process Add-on Purchase
            if (addonId) {
                const addon = ADDONS[addonId as keyof typeof ADDONS];
                if (addon) {
                    const { data: userProfile } = await supabaseAdmin
                        .from('profiles')
                        .select('*')
                        .eq('id', user.id)
                        .single();

                    if (userProfile) {
                        const currentAddonCount = userProfile[addon.quotaKey] || 0;
                        const increment = addon.amount || 1;
                        
                        const { error } = await supabaseAdmin.from('profiles').update({
                            [addon.quotaKey]: currentAddonCount + increment
                        }).eq('id', user.id);

                        if (error) throw new Error("Failed to update add-on database.");
                        return NextResponse.json({ success: true, message: `Successfully purchased ${addon.name}!` });
                    }
                }
            }

            return NextResponse.json({ success: true });
        } else {
            console.error("Payment Verification Failed:", data);
            return NextResponse.json({ success: false, message: "Payment was not successful" });
        }
    } catch (error: any) {
        console.error("Verify API Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}