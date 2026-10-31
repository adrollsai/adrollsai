import { NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { executeRecurringDebit } from '@/utils/phonepe-subscription';
import { releaseVobizNumber } from '@/utils/vobiz-helper';

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

        console.log("--- STARTING RECURRING DEBIT & CALLING LINES CLEANUP CRON ---");

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

        const results = [];

        if (profiles && profiles.length > 0) {
            console.log(`Found ${profiles.length} subscriptions to renew.`);

            for (const profile of profiles) {
                try {
                    const orderId = `RECUR-${profile.id.substring(0, 6)}-${Date.now()}`;

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
        }

        // 2. Calling Lines Cleanup: Release numbers for inactive/expired subscriptions past 72-hour grace period
        try {
            const { data: activeNumbers } = await supabaseAdmin
                .from('profiles')
                .select('id, voice_twilio_number, voice_provider, email, subscription_status, subscription_valid_until, business_info')
                .not('voice_twilio_number', 'is', null)
                .neq('voice_twilio_number', '');

            if (activeNumbers && activeNumbers.length > 0) {
                const whitelistedEmails = [
                    'rchopra489@gmail.com',
                    'infobluesquareinfra@gmail.com',
                    'khushiramrealtor@gmail.com',
                    'rajivkumaraggarwal81@gmail.com',
                    'gnrhomes97@gmail.com',
                    'alpinenesthomes01@gmail.com',
                    'meta-reviewer@nobogent.com',
                    'pawan@pipixel.io'
                ];

                const masterSid = process.env.MASTER_TWILIO_SID || process.env.DEV_TWILIO_SID;
                const masterToken = process.env.MASTER_TWILIO_TOKEN || process.env.DEV_TWILIO_TOKEN;

                for (const p of activeNumbers) {
                    const userEmail = p.email?.toLowerCase() || '';
                    if (whitelistedEmails.includes(userEmail)) continue;

                    const status = p.subscription_status?.toLowerCase() || '';
                    const isSubscriptionActive = ['active', 'trialing', 'pro', 'growth', 'enterprise'].includes(status);

                    // Check chronological validity
                    const expiryDate = p.subscription_valid_until ? new Date(p.subscription_valid_until) : null;
                    const isChronologicallyExpired = expiryDate ? (now.getTime() > expiryDate.getTime()) : false;

                    if (!isSubscriptionActive || isChronologicallyExpired) {
                        // 72-Hour Grace Period Check
                        if (expiryDate) {
                            const hoursPast = (now.getTime() - expiryDate.getTime()) / (1000 * 60 * 60);
                            if (hoursPast < 72) {
                                console.log(`[CALLING LINES CLEANUP] ${userEmail} is within 72h grace period (${Math.round(hoursPast)}h past expiry). Preserving line ${p.voice_twilio_number}.`);
                                continue;
                            }
                        }

                        console.log(`[CALLING LINES CLEANUP] Inactive subscription past grace period detected for ${userEmail}. Releasing line ${p.voice_twilio_number}...`);

                        let bi: any = {};
                        try {
                            bi = typeof p.business_info === 'string' ? JSON.parse(p.business_info) : (p.business_info || {});
                        } catch (e) {
                            bi = {};
                        }

                        const currentNum = p.voice_twilio_number;
                        const isIndianVobiz = currentNum.startsWith('+91') || p.voice_provider === 'vobiz' || !!bi.voice_vobiz_number;

                        let released = false;

                        if (isIndianVobiz) {
                            // Indian virtual number -> Vobiz carrier
                            const subAuthId = bi.voice_vobiz_auth_id || bi.kyc_data?.vobizSubAuthId || bi.voice_vobiz_sub_account_id;
                            released = await releaseVobizNumber(currentNum, subAuthId);
                        } else if (masterSid && masterToken) {
                            // Non-Indian number -> Twilio
                            released = await releaseTwilioNumber(masterSid, masterToken, currentNum);
                        } else {
                            // No provider credentials, but must release in DB
                            released = true;
                        }

                        if (released) {
                            delete bi.voice_vobiz_number;
                            delete bi.claimed_vobiz_number;

                            await supabaseAdmin
                                .from('profiles')
                                .update({
                                    old_voice_twilio_number: currentNum,
                                    voice_twilio_number: null,
                                    business_info: JSON.stringify(bi)
                                })
                                .eq('id', p.id);

                            console.log(`[CALLING LINES CLEANUP] Successfully cleared assigned number for ${userEmail}`);
                        }
                    }
                }
            }
        } catch (cleanupErr: any) {
            console.error("[CALLING LINES CLEANUP] Error running calling lines cleanup:", cleanupErr.message);
        }

        return NextResponse.json({ results });

    } catch (error: any) {
        console.error("Cron Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

async function releaseTwilioNumber(masterSid: string, masterToken: string, phoneNumber: string): Promise<boolean> {
    try {
        const basicAuth = Buffer.from(`${masterSid}:${masterToken}`).toString('base64');

        // 1. Search for the IncomingPhoneNumber SID matching the phone number
        const searchUrl = `https://api.twilio.com/2010-04-01/Accounts/${masterSid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(phoneNumber)}`;
        const searchRes = await fetch(searchUrl, {
            headers: { 'Authorization': `Basic ${basicAuth}` }
        });

        if (!searchRes.ok) {
            console.error(`[RELEASE] Failed to search number ${phoneNumber} in Twilio:`, await searchRes.text());
            return false;
        }

        const searchData = await searchRes.json();
        const incomingNumbers = searchData.incoming_phone_numbers || [];
        if (incomingNumbers.length === 0) {
            console.log(`[RELEASE] Phone number ${phoneNumber} not found in Twilio account.`);
            return true; // Already released or not owned by us
        }

        const sid = incomingNumbers[0].sid;

        // 2. Delete the phone number from Twilio account to stop being charged
        const deleteUrl = `https://api.twilio.com/2010-04-01/Accounts/${masterSid}/IncomingPhoneNumbers/${sid}.json`;
        const deleteRes = await fetch(deleteUrl, {
            method: 'DELETE',
            headers: { 'Authorization': `Basic ${basicAuth}` }
        });

        if (!deleteRes.ok) {
            console.error(`[RELEASE] Failed to delete number ${phoneNumber} (SID: ${sid}) from Twilio:`, await deleteRes.text());
            return false;
        }

        console.log(`[RELEASE] Successfully released Twilio number ${phoneNumber} (SID: ${sid}).`);
        return true;
    } catch (err) {
        console.error(`[RELEASE] Exception while releasing number ${phoneNumber}:`, err);
        return false;
    }
}
