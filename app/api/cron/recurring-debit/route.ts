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

        // 2. Twilio Calling Lines Cleanup: Release numbers for inactive/expired subscriptions
        const masterSid = process.env.MASTER_TWILIO_SID || process.env.DEV_TWILIO_SID;
        const masterToken = process.env.MASTER_TWILIO_TOKEN || process.env.DEV_TWILIO_TOKEN;

        if (masterSid && masterToken) {
            try {
                // Find all profiles that have an assigned voice number
                const { data: activeNumbers } = await supabaseAdmin
                    .from('profiles')
                    .select('id, voice_twilio_number, email, subscription_status')
                    .not('voice_twilio_number', 'is', null)
                    .neq('voice_twilio_number', '');

                if (activeNumbers && activeNumbers.length > 0) {
                    const whitelistedEmails = ['rchopra489@gmail.com', 'infobluesquareinfra@gmail.com', 'khushiramrealtor@gmail.com'];
                    
                    for (const p of activeNumbers) {
                        // Skip whitelisted master accounts
                        if (whitelistedEmails.includes(p.email || '')) continue;
                        
                        const status = p.subscription_status?.toLowerCase() || '';
                        const isSubscriptionActive = ['active', 'trialing', 'pro', 'growth'].includes(status);
                        
                        if (!isSubscriptionActive) {
                            console.log(`[SUBSCRIPTION CLEANUP] Inactive subscription detected for ${p.email} (Status: ${status}). Releasing number ${p.voice_twilio_number}...`);
                            
                            const released = await releaseTwilioNumber(masterSid, masterToken, p.voice_twilio_number);
                            if (released) {
                                // Backup number into old_voice_twilio_number and clear current voice_twilio_number
                                await supabaseAdmin
                                    .from('profiles')
                                    .update({
                                        old_voice_twilio_number: p.voice_twilio_number,
                                        voice_twilio_number: null
                                    })
                                    .eq('id', p.id);
                            }
                        }
                    }
                }
            } catch (cleanupErr) {
                console.error("[SUBSCRIPTION CLEANUP] Error running calling lines cleanup:", cleanupErr);
            }
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

