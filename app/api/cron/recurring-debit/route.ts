import { NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { executeRecurringDebit } from '@/utils/phonepe-subscription';

const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const PLAN_PRICE_PAISE = 999900; // Rs. 9,999 * 100

export async function GET(req: Request) {
    try {
        // --- AUTH CHECK FOR CRON ---
        const authHeader = req.headers.get('authorization');
        if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
            return new Response('Unauthorized', { status: 401 });
        }

        console.log("--- STARTING RECURRING DEBIT CRON ---");

        // 1. Find users whose subscription is ACTIVE but VALID_UNTIL is in the past (or expiring within 24h)
        const now = new Date();
        const tomorrow = new Date();
        tomorrow.setHours(tomorrow.getHours() + 24);

        const { data: profiles, error } = await supabaseAdmin
            .from('profiles')
            .select('id, subscription_id, subscription_plan')
            .eq('subscription_status', 'active')
            .not('subscription_id', 'is', null)
            .lte('subscription_valid_until', tomorrow.toISOString());

        if (error) throw error;
        if (!profiles || profiles.length === 0) {
            return NextResponse.json({ message: "No subscriptions due for renewal." });
        }

        console.log(`Found ${profiles.length} subscriptions to renew.`);

        const results = [];

        for (const profile of profiles) {
            try {
                const orderId = `RECUR-${profile.id.substring(0,6)}-${Date.now()}`;
                
                // Execute Debit
                const debitResult = await executeRecurringDebit({
                    merchantOrderId: orderId,
                    amount: PLAN_PRICE_PAISE,
                    merchantSubscriptionId: profile.subscription_id
                });

                if (debitResult.success) {
                    const newValidUntil = new Date();
                    newValidUntil.setMonth(newValidUntil.getMonth() + 1);

                    await supabaseAdmin.from('profiles').update({
                        subscription_valid_until: newValidUntil.toISOString()
                    }).eq('id', profile.id);

                    results.push({ userId: profile.id, status: 'success' });
                } else {
                    console.error(`Debit failed for user ${profile.id}:`, debitResult);
                    results.push({ userId: profile.id, status: 'failed', error: debitResult.message });
                }
            } catch (err: any) {
                console.error(`Error processing renewal for ${profile.id}:`, err);
                results.push({ userId: profile.id, status: 'error', error: err.message });
            }
        }

        return NextResponse.json({ results });

    } catch (error: any) {
        console.error("Cron Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
