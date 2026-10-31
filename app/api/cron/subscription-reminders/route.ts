import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { releaseVobizNumber } from '@/utils/vobiz-helper';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
);

const BILLING_URL = 'https://app.nobogent.com/dashboard/billing';
const USAGE_URL = 'https://app.nobogent.com/dashboard/usage';
const SETTINGS_URL = 'https://app.nobogent.com/dashboard/settings';
const LOW_CREDIT_THRESHOLD = 100;

// WhatsApp template names (approved on Nobogent WABA)
const WA_TEMPLATE_SUBSCRIPTION = 'subscription_expiry_reminder';
const WA_TEMPLATE_LOW_CREDITS = 'low_credits_alert';

// Master accounts that must NEVER receive subscription expiry notifications
const NEVER_NOTIFY_EXPIRY_EMAILS = [
    'rchopra489@gmail.com',
    'meta-reviewer@nobogent.com'
];

// Protected clients whose access & numbers must NEVER be blocked or released
const PROTECTED_CLIENT_EMAILS = [
    'khushiramrealtor@gmail.com',
    'rajivkumaraggarwal81@gmail.com',
    'gnrhomes97@gmail.com',
    'alpinenesthomes01@gmail.com'
];

function daysBetween(a: Date, b: Date): number {
    const msPerDay = 24 * 60 * 60 * 1000;
    return Math.round((b.getTime() - a.getTime()) / msPerDay);
}

type ExpiryStage =
    | 't7'         // 7 days left
    | 't3'         // 3 days left
    | 't1'         // 1 day left (tomorrow)
    | 'd0'         // Today
    | 'grace_d1'   // Day +1 expired: 72h grace period begins
    | 'final_d3'   // Day +3 expired: Final 24h warning before Vobiz line release
    | 'release_d4';// Day +4 expired: De-provision calling line

function determineExpiryStage(daysLeft: number, hasAssignedLine: boolean): { stage: ExpiryStage; label: string } | null {
    if (daysLeft === 7) return { stage: 't7', label: '7 days' };
    if (daysLeft === 3) return { stage: 't3', label: '3 days' };
    if (daysLeft === 1) return { stage: 't1', label: 'tomorrow' };
    if (daysLeft === 0) return { stage: 'd0', label: 'today' };
    if (daysLeft === -1) return { stage: 'grace_d1', label: 'yesterday (72h grace period active)' };
    if (daysLeft === -3) return { stage: 'final_d3', label: '3 days ago (final 24h notice)' };
    if (daysLeft <= -4 && hasAssignedLine) return { stage: 'release_d4', label: 'expired (release line)' };
    return null;
}

async function sendReminderEmail(email: string, businessName: string, subject: string, html: string) {
    try {
        const { sendGenericEmail } = await import('@/utils/email-helper');
        await sendGenericEmail(email, subject, html);
    } catch (err: any) {
        console.error(`[Sub Reminder Email Error] ${email}:`, err.message);
    }
}

async function sendReminderWhatsApp(
    phone: string,
    token: string,
    phoneId: string,
    templateName: string | null,
    params: string[],
    fallbackText?: string
) {
    try {
        let cleanPhone = phone.replace(/\D/g, '');
        if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;

        let sentViaTemplate = false;

        // Try template if provided
        if (templateName) {
            const payload = {
                messaging_product: 'whatsapp',
                to: cleanPhone,
                type: 'template',
                template: {
                    name: templateName,
                    language: { code: 'en_US' },
                    components: [
                        {
                            type: 'body',
                            parameters: params.map(text => ({ type: 'text', text }))
                        }
                    ]
                }
            };

            const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                sentViaTemplate = true;
                console.log(`[Sub Reminder WA] Sent template ${templateName} to ${cleanPhone}`);
            } else {
                const data = await res.json().catch(() => ({}));
                console.warn(`[Sub Reminder WA] Template ${templateName} failed (${data.error?.message}), falling back to direct text:`, data);
            }
        }

        // Direct text fallback or custom text alert
        if (!sentViaTemplate) {
            const body = fallbackText || params.join('\n');
            const textPayload = {
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: cleanPhone,
                type: 'text',
                text: { body }
            };
            const textRes = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(textPayload)
            });
            if (textRes.ok) {
                console.log(`[Sub Reminder WA] Sent direct text fallback to ${cleanPhone}`);
            } else {
                const textErr = await textRes.json().catch(() => ({}));
                console.warn(`[Sub Reminder WA] Direct text failed for ${cleanPhone}:`, textErr);
            }
        }
    } catch (err: any) {
        console.error(`[Sub Reminder WA Error]`, err.message);
    }
}

async function sendReminderPush(userId: string, title: string, body: string, url: string, type: string = 'subscription_reminder') {
    try {
        const { sendPushNotification } = await import('@/utils/notification-helper');
        await sendPushNotification(userId, title, body, url, type);
    } catch (err: any) {
        console.error(`[Sub Reminder Push Error]`, err.message);
    }
}

export async function GET(request: Request) {
    try {
        const url = new URL(request.url);
        const authHeader = request.headers.get('Authorization');
        const cronSecret = url.searchParams.get('cronSecret') || (authHeader ? authHeader.replace('Bearer ', '') : null);

        if (process.env.CRON_SECRET && cronSecret !== process.env.CRON_SECRET) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        console.log('[Subscription Reminders] Starting daily scan with Indian Vobiz telephony & grace period rules...');

        const now = new Date();
        // 20-hour window for deduplication to prevent re-sending the same stage on repeated cron triggers
        const twentyHoursAgo = new Date(now.getTime() - 20 * 60 * 60 * 1000).toISOString();

        // 1. Fetch recent reminder notifications for deduplication
        const { data: recentNotifications } = await supabaseAdmin
            .from('notifications')
            .select('user_id, type')
            .gte('created_at', twentyHoursAgo);

        const sentNotifications = new Set<string>();
        if (recentNotifications) {
            for (const n of recentNotifications) {
                sentNotifications.add(`${n.user_id}:${n.type}`);
            }
        }

        // 2. Fetch profiles with active subscription validity
        const { data: profiles, error: fetchErr } = await supabaseAdmin
            .from('profiles')
            .select('id, email, business_name, credits, subscription_plan, subscription_status, subscription_valid_until, voice_twilio_number, voice_provider, business_info, whatsapp_personal_number, contact_number, whatsapp_phone_number, whatsapp_access_token, whatsapp_phone_number_id, facebook_token')
            .not('subscription_valid_until', 'is', null);

        if (fetchErr) {
            console.error('[Subscription Reminders] Fetch error:', fetchErr);
            throw fetchErr;
        }

        let subscriptionReminders = 0;
        let gracePeriodReminders = 0;
        let releasedNumbers = 0;
        let creditReminders = 0;
        let tokenExpiryAlerts = 0;

        // --- 1. SUBSCRIPTION EXPIRY & GRACE PERIOD REMINDERS ---
        if (profiles && profiles.length > 0) {
            for (const profile of profiles) {
                if (!profile.subscription_valid_until) continue;

                const userEmail = profile.email?.toLowerCase() || '';
                if (NEVER_NOTIFY_EXPIRY_EMAILS.includes(userEmail)) continue;

                const expiryDate = new Date(profile.subscription_valid_until);
                const daysLeft = daysBetween(now, expiryDate);
                const hasAssignedLine = !!(profile.voice_twilio_number && profile.voice_twilio_number.trim() !== '');

                const stageInfo = determineExpiryStage(daysLeft, hasAssignedLine);
                if (!stageInfo) continue;

                const { stage, label } = stageInfo;
                const dedupKey = `${profile.id}:sub_stage_${stage}`;

                if (sentNotifications.has(dedupKey)) continue;

                const isProtectedClient = PROTECTED_CLIENT_EMAILS.includes(userEmail);
                const isPastDue = daysLeft < 0;

                // Protected clients must never receive panic expired notices or have calling lines released
                if (isProtectedClient && isPastDue) continue;

                const businessName = profile.business_name || 'there';
                const planName = profile.subscription_plan || 'Pro';
                const assignedNumber = profile.voice_twilio_number || '';

                let bi: any = {};
                try {
                    bi = typeof profile.business_info === 'string' ? JSON.parse(profile.business_info) : (profile.business_info || {});
                } catch (e) {
                    bi = {};
                }

                // WhatsApp credentials
                const waPhone = profile.whatsapp_personal_number || profile.contact_number || profile.whatsapp_phone_number;
                const waToken = profile.whatsapp_access_token || profile.facebook_token || process.env.WHATSAPP_ACCESS_TOKEN;
                const waPhoneId = profile.whatsapp_phone_number_id || process.env.WHATSAPP_PHONE_NUMBER_ID;

                // ==================== STAGE T-7, T-3, T-1, D-0 ====================
                if (['t7', 't3', 't1', 'd0'].includes(stage)) {
                    const isToday = stage === 'd0';
                    const pushTitle = isToday ? '⚠️ Plan Expires Today' : `⏰ Plan Expiring in ${label}`;
                    const pushBody = isToday
                        ? `Your ${planName} plan expires today. Renew now to avoid pause in AI calls and campaigns!`
                        : `Your ${planName} plan expires in ${label}. Renew now to keep automated marketing running!`;

                    // Email
                    if (profile.email) {
                        const subject = isToday
                            ? `⚠️ Your Nobogent ${planName} Plan Expires Today`
                            : `⏰ Your Nobogent Plan Expires in ${label}`;
                        const html = `
                            <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; padding: 24px; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0;">
                                <div style="text-align: center; margin-bottom: 24px;">
                                    <img src="https://app.nobogent.com/nobogent-logo.png" alt="Nobogent" width="130" style="margin-bottom: 8px;" />
                                </div>
                                <h2 style="color: ${isToday ? '#dc2626' : '#d97706'}; text-align: center; margin-bottom: 12px;">
                                    ${isToday ? '⚠️ Your Plan Expires Today' : `⏰ Your Plan Expires in ${label}`}
                                </h2>
                                <p style="font-size: 14px; line-height: 1.6;">Hi <strong>${businessName}</strong>,</p>
                                <p style="font-size: 14px; line-height: 1.6;">Your <strong>${planName}</strong> subscription is scheduled to expire ${isToday ? '<strong>today</strong>' : `in <strong>${label}</strong>`}.</p>
                                <p style="font-size: 14px; line-height: 1.6;">Renew now to ensure zero downtime in your Meta ad campaigns, AI voice agents, and lead automations.</p>
                                <div style="text-align: center; margin: 28px 0;">
                                    <a href="${BILLING_URL}" style="display: inline-block; background: linear-gradient(135deg, #4f46e5, #7c3aed); color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 14px; box-shadow: 0 4px 12px rgba(79, 70, 229, 0.25);">
                                        💳 Renew Subscription
                                    </a>
                                </div>
                                <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 24px 0;" />
                                <p style="font-size: 12px; color: #94a3b8; text-align: center; margin: 0;">
                                    Nobogent AI Marketing Engine • <a href="${BILLING_URL}" style="color: #6366f1; text-decoration: none;">Manage Billing</a>
                                </p>
                            </div>
                        `;
                        await sendReminderEmail(profile.email, businessName, subject, html);
                    }

                    // WhatsApp
                    if (waPhone && waToken && waPhoneId) {
                        const fallbackText = `Hi ${businessName},\n\n⏰ *Nobogent Plan Reminder*\nYour *${planName}* plan expires *${label}*.\n\nRenew your plan now to prevent pauses in AI voice calls and active campaigns:\n👉 ${BILLING_URL}`;
                        await sendReminderWhatsApp(
                            waPhone,
                            waToken,
                            waPhoneId,
                            WA_TEMPLATE_SUBSCRIPTION,
                            [businessName, planName, label, BILLING_URL],
                            fallbackText
                        );
                    }

                    // Web Push
                    await sendReminderPush(profile.id, pushTitle, pushBody, BILLING_URL, 'subscription_reminder');

                    // In-App Notification Feed
                    await supabaseAdmin.from('notifications').insert({
                        user_id: profile.id,
                        title: pushTitle,
                        message: pushBody,
                        type: `sub_stage_${stage}`,
                        action_link: '/dashboard/billing',
                        is_read: false
                    });

                    sentNotifications.add(dedupKey);
                    subscriptionReminders++;
                }

                // ==================== STAGE GRACE D+1 (72h Grace Period) ====================
                else if (stage === 'grace_d1') {
                    const pushTitle = '⚠️ Plan Expired: 72h Grace Period Active';
                    const pushBody = `Your plan has expired. Campaigns are paused. You have 72 hours to renew before your dedicated Indian Vobiz calling line is permanently unassigned.`;

                    // Email
                    if (profile.email) {
                        const subject = '⚠️ Plan Expired: 72-Hour Grace Period to Preserve Your Vobiz Calling Line';
                        const html = `
                            <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; padding: 24px; background: #ffffff; border-radius: 16px; border: 1px solid #fecaca;">
                                <div style="text-align: center; margin-bottom: 24px;">
                                    <img src="https://app.nobogent.com/nobogent-logo.png" alt="Nobogent" width="130" style="margin-bottom: 8px;" />
                                </div>
                                <h2 style="color: #dc2626; text-align: center; margin-bottom: 12px;">⚠️ Plan Expired — 72h Grace Period Active</h2>
                                <p style="font-size: 14px; line-height: 1.6;">Hi <strong>${businessName}</strong>,</p>
                                <p style="font-size: 14px; line-height: 1.6;">Your Nobogent <strong>${planName}</strong> plan has expired, and your automated campaigns & outbound AI voice calling have been temporarily paused.</p>
                                ${assignedNumber ? `
                                    <div style="background: #fff7ed; border: 1px solid #fdba74; padding: 14px 18px; border-radius: 12px; margin: 16px 0;">
                                        <p style="margin: 0; font-size: 13px; color: #9a3412;">
                                            🛡️ <strong>Preserve Your Dedicated Caller ID:</strong><br/>
                                            Your assigned Indian virtual line <strong>${assignedNumber}</strong> (Vobiz) is reserved for the next <strong>72 hours</strong>. Renew now to prevent it from being unassigned and returned to the carrier pool.
                                        </p>
                                    </div>
                                ` : ''}
                                <div style="text-align: center; margin: 28px 0;">
                                    <a href="${BILLING_URL}" style="display: inline-block; background: #dc2626; color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 14px; box-shadow: 0 4px 12px rgba(220, 38, 38, 0.25);">
                                        ⚡ Renew Now to Restore Services
                                    </a>
                                </div>
                                <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 24px 0;" />
                                <p style="font-size: 12px; color: #94a3b8; text-align: center; margin: 0;">
                                    Nobogent AI Marketing Engine • <a href="${BILLING_URL}" style="color: #6366f1; text-decoration: none;">Manage Billing</a>
                                </p>
                            </div>
                        `;
                        await sendReminderEmail(profile.email, businessName, subject, html);
                    }

                    // WhatsApp
                    if (waPhone && waToken && waPhoneId) {
                        const fallbackText = `Hi ${businessName},\n\n⚠️ *Your Nobogent Plan Expired*\nActive campaigns and voice automations are temporarily paused.\n\n🛡️ *72-Hour Grace Period Active*:\nYour dedicated Indian virtual caller ID ${assignedNumber ? `(*${assignedNumber}*)` : ''} is reserved for 72 hours. Renew now to avoid losing your dedicated number:\n👉 ${BILLING_URL}`;
                        await sendReminderWhatsApp(waPhone, waToken, waPhoneId, null, [], fallbackText);
                    }

                    await sendReminderPush(profile.id, pushTitle, pushBody, BILLING_URL, 'subscription_reminder');

                    await supabaseAdmin.from('notifications').insert({
                        user_id: profile.id,
                        title: pushTitle,
                        message: pushBody,
                        type: `sub_stage_${stage}`,
                        action_link: '/dashboard/billing',
                        is_read: false
                    });

                    sentNotifications.add(dedupKey);
                    gracePeriodReminders++;
                }

                // ==================== STAGE FINAL WARNING D+3 (Final 24h) ====================
                else if (stage === 'final_d3') {
                    const pushTitle = '🚨 Final Notice: Caller ID Releasing in 24h';
                    const pushBody = `CRITICAL: Your dedicated Indian Vobiz line (${assignedNumber}) will be permanently released tomorrow. Renew immediately to protect your number!`;

                    // Email
                    if (profile.email) {
                        const subject = '🚨 Final Notice: Your Dedicated Calling Line Will Be Released in 24 Hours';
                        const html = `
                            <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; padding: 24px; background: #ffffff; border-radius: 16px; border: 2px solid #ef4444;">
                                <div style="text-align: center; margin-bottom: 24px;">
                                    <img src="https://app.nobogent.com/nobogent-logo.png" alt="Nobogent" width="130" style="margin-bottom: 8px;" />
                                </div>
                                <h2 style="color: #b91c1c; text-align: center; margin-bottom: 12px;">🚨 Final 24-Hour Notice</h2>
                                <p style="font-size: 14px; line-height: 1.6;">Hi <strong>${businessName}</strong>,</p>
                                <p style="font-size: 14px; line-height: 1.6;">This is your final notice before resource de-allocation. Your subscription has been expired for 3 days.</p>
                                <div style="background: #fef2f2; border: 1px solid #f87171; padding: 14px 18px; border-radius: 12px; margin: 16px 0;">
                                    <p style="margin: 0; font-size: 13px; color: #991b1b; font-weight: 600;">
                                        ⚠️ Your dedicated Indian calling line <strong>${assignedNumber}</strong> (Vobiz) will be permanently released to the carrier pool in <strong>24 hours</strong>.
                                    </p>
                                    <p style="margin: 8px 0 0; font-size: 12px; color: #7f1d1d;">
                                        Once released, this number cannot be recovered, and future callbacks from past marketing campaigns will be lost.
                                    </p>
                                </div>
                                <div style="text-align: center; margin: 28px 0;">
                                    <a href="${BILLING_URL}" style="display: inline-block; background: #b91c1c; color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 14px; box-shadow: 0 4px 12px rgba(185, 28, 28, 0.35);">
                                        🚨 Renew Immediately & Keep Caller ID
                                    </a>
                                </div>
                                <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 24px 0;" />
                                <p style="font-size: 12px; color: #94a3b8; text-align: center; margin: 0;">
                                    Nobogent AI Marketing Engine • <a href="${BILLING_URL}" style="color: #6366f1; text-decoration: none;">Manage Billing</a>
                                </p>
                            </div>
                        `;
                        await sendReminderEmail(profile.email, businessName, subject, html);
                    }

                    // WhatsApp
                    if (waPhone && waToken && waPhoneId) {
                        const fallbackText = `🚨 *FINAL 24-HOUR NOTICE*\n\nHi ${businessName},\nYour dedicated Indian virtual calling line (*${assignedNumber}*) will be permanently released to the telecom carrier tomorrow due to plan expiration.\n\nOnce released, this number cannot be recovered.\n\nRenew your plan now to protect your caller ID:\n👉 ${BILLING_URL}`;
                        await sendReminderWhatsApp(waPhone, waToken, waPhoneId, null, [], fallbackText);
                    }

                    await sendReminderPush(profile.id, pushTitle, pushBody, BILLING_URL, 'subscription_reminder');

                    await supabaseAdmin.from('notifications').insert({
                        user_id: profile.id,
                        title: pushTitle,
                        message: pushBody,
                        type: `sub_stage_${stage}`,
                        action_link: '/dashboard/billing',
                        is_read: false
                    });

                    sentNotifications.add(dedupKey);
                    gracePeriodReminders++;
                }

                // ==================== STAGE LINE RELEASE D+4 (Grace Ended) ====================
                else if (stage === 'release_d4' && assignedNumber) {
                    console.log(`[Subscription Reminders] Grace period ended for ${profile.email}. Releasing calling number ${assignedNumber}...`);

                    const isIndianVobiz = assignedNumber.startsWith('+91') || profile.voice_provider === 'vobiz' || !!bi.voice_vobiz_number;
                    const subAuthId = bi.voice_vobiz_auth_id || bi.kyc_data?.vobizSubAuthId || bi.voice_vobiz_sub_account_id;

                    let releasedSuccessfully = false;

                    if (isIndianVobiz) {
                        // De-provision via Vobiz API
                        releasedSuccessfully = await releaseVobizNumber(assignedNumber, subAuthId);
                    } else {
                        // International Twilio line fallback
                        const masterSid = process.env.MASTER_TWILIO_SID || process.env.DEV_TWILIO_SID;
                        const masterToken = process.env.MASTER_TWILIO_TOKEN || process.env.DEV_TWILIO_TOKEN;
                        if (masterSid && masterToken) {
                            try {
                                const basicAuth = Buffer.from(`${masterSid}:${masterToken}`).toString('base64');
                                const searchRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${masterSid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(assignedNumber)}`, {
                                    headers: { 'Authorization': `Basic ${basicAuth}` }
                                });
                                const searchData = await searchRes.json().catch(() => ({}));
                                const incomingNumbers = searchData.incoming_phone_numbers || [];
                                if (incomingNumbers.length > 0) {
                                    const sid = incomingNumbers[0].sid;
                                    await fetch(`https://api.twilio.com/2010-04-01/Accounts/${masterSid}/IncomingPhoneNumbers/${sid}.json`, {
                                        method: 'DELETE',
                                        headers: { 'Authorization': `Basic ${basicAuth}` }
                                    });
                                }
                                releasedSuccessfully = true;
                            } catch (e: any) {
                                console.warn('[Line Release Twilio Error]:', e.message);
                            }
                        }
                    }

                    // Update profile database: archive to old_voice_twilio_number and reset line
                    delete bi.voice_vobiz_number;
                    delete bi.claimed_vobiz_number;

                    await supabaseAdmin.from('profiles').update({
                        old_voice_twilio_number: assignedNumber,
                        voice_twilio_number: null,
                        business_info: JSON.stringify(bi)
                    }).eq('id', profile.id);

                    // Notify user that line was released
                    const pushTitle = '📵 Dedicated Calling Line Released';
                    const pushBody = `Your dedicated calling line (${assignedNumber}) has been released due to plan expiration. Re-subscribe anytime to claim a new number.`;

                    if (profile.email) {
                        const subject = '📵 Dedicated Calling Line Released - Nobogent';
                        const html = `
                            <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; padding: 24px; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0;">
                                <div style="text-align: center; margin-bottom: 24px;">
                                    <img src="https://app.nobogent.com/nobogent-logo.png" alt="Nobogent" width="130" style="margin-bottom: 8px;" />
                                </div>
                                <h2 style="color: #64748b; text-align: center; margin-bottom: 12px;">📵 Calling Line Released</h2>
                                <p style="font-size: 14px; line-height: 1.6;">Hi <strong>${businessName}</strong>,</p>
                                <p style="font-size: 14px; line-height: 1.6;">Because your subscription remained inactive following the 72-hour grace period, your virtual calling number <strong>${assignedNumber}</strong> has been released back to the telecom provider.</p>
                                <p style="font-size: 14px; line-height: 1.6;">Your lead history, CRM contacts, and marketing creative assets remain safe. You can re-activate your plan at any time and select a fresh virtual calling line.</p>
                                <div style="text-align: center; margin: 28px 0;">
                                    <a href="${BILLING_URL}" style="display: inline-block; background: #4f46e5; color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 14px;">
                                        ⚡ Re-Activate Plan
                                    </a>
                                </div>
                            </div>
                        `;
                        await sendReminderEmail(profile.email, businessName, subject, html);
                    }

                    if (waPhone && waToken && waPhoneId) {
                        const text = `Hi ${businessName},\n\n📵 Your dedicated calling line *${assignedNumber}* has been released due to plan expiration.\n\nYour CRM data and assets are safe. You can re-activate your subscription at any time to claim a new number:\n👉 ${BILLING_URL}`;
                        await sendReminderWhatsApp(waPhone, waToken, waPhoneId, null, [], text);
                    }

                    await sendReminderPush(profile.id, pushTitle, pushBody, BILLING_URL, 'subscription_reminder');

                    await supabaseAdmin.from('notifications').insert({
                        user_id: profile.id,
                        title: pushTitle,
                        message: pushBody,
                        type: `sub_stage_${stage}`,
                        action_link: '/dashboard/billing',
                        is_read: false
                    });

                    sentNotifications.add(dedupKey);
                    releasedNumbers++;
                }
            }
        }

        // --- 2. CREDIT BALANCE ALERTS (LOW & ZERO CREDITS) ---
        const { data: creditProfiles } = await supabaseAdmin
            .from('profiles')
            .select('id, email, business_name, credits, whatsapp_personal_number, contact_number, whatsapp_phone_number, whatsapp_access_token, whatsapp_phone_number_id, facebook_token')
            .lt('credits', LOW_CREDIT_THRESHOLD);

        if (creditProfiles && creditProfiles.length > 0) {
            for (const profile of creditProfiles) {
                const userEmail = profile.email?.toLowerCase() || '';
                if (NEVER_NOTIFY_EXPIRY_EMAILS.includes(userEmail)) continue;

                const credits = Math.round(profile.credits || 0);
                const isZero = credits <= 0;
                const alertType = isZero ? 'zero_credits_alert' : 'low_credits_alert';
                const dedupKey = `${profile.id}:${alertType}`;

                if (sentNotifications.has(dedupKey)) continue;

                const businessName = profile.business_name || 'there';
                const pushTitle = isZero
                    ? '🛑 Zero Credits: AI Calling & Automations Paused'
                    : `🔋 Low Credits: ${credits} Remaining`;
                const pushBody = isZero
                    ? 'Your credit balance is 0. Outbound AI voice calls, WhatsApp messages, and generations are paused. Top up now to resume.'
                    : `Your credit balance is low (${credits} credits). Top up now to avoid service interruptions.`;

                // 1. Send Email
                if (profile.email) {
                    const subject = isZero
                        ? '🛑 Action Required: Nobogent Credits Exhausted (0 Remaining)'
                        : `🔋 Low Credit Balance: ${credits} Credits Remaining`;
                    const html = `
                        <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; padding: 24px; background: #ffffff; border-radius: 16px; border: 1px solid ${isZero ? '#fecaca' : '#fef08a'};">
                            <div style="text-align: center; margin-bottom: 24px;">
                                <img src="https://app.nobogent.com/nobogent-logo.png" alt="Nobogent" width="130" style="margin-bottom: 8px;" />
                            </div>
                            <h2 style="color: ${isZero ? '#dc2626' : '#d97706'}; text-align: center; margin-bottom: 12px;">
                                ${isZero ? '🛑 Credits Exhausted' : '⚠️ Low Credit Balance'}
                            </h2>
                            <p style="font-size: 14px; line-height: 1.6;">Hi <strong>${businessName}</strong>,</p>
                            <p style="font-size: 14px; line-height: 1.6;">
                                ${isZero
                                    ? 'Your Nobogent credit balance is now <strong>0 credits</strong>. Automated AI phone calls and outbound marketing automations are currently paused.'
                                    : `Your Nobogent credit balance is running low — only <strong>${credits} credits</strong> remaining.`
                                }
                            </p>
                            <div style="text-align: center; margin: 28px 0;">
                                <a href="${USAGE_URL}" style="display: inline-block; background: ${isZero ? '#dc2626' : 'linear-gradient(135deg, #4f46e5, #7c3aed)'}; color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 14px; box-shadow: 0 4px 12px rgba(79, 70, 229, 0.25);">
                                    🔋 Top-Up Credits Now
                                </a>
                            </div>
                            <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 24px 0;" />
                            <p style="font-size: 12px; color: #94a3b8; text-align: center; margin: 0;">
                                Nobogent AI Marketing Engine • <a href="${USAGE_URL}" style="color: #6366f1; text-decoration: none;">View Usage & Ledger</a>
                            </p>
                        </div>
                    `;
                    await sendReminderEmail(profile.email, businessName, subject, html);
                }

                // 2. Send WhatsApp
                const waPhone = profile.whatsapp_personal_number || profile.contact_number || profile.whatsapp_phone_number;
                const waToken = profile.whatsapp_access_token || profile.facebook_token || process.env.WHATSAPP_ACCESS_TOKEN;
                const waPhoneId = profile.whatsapp_phone_number_id || process.env.WHATSAPP_PHONE_NUMBER_ID;

                if (waPhone && waToken && waPhoneId) {
                    if (isZero) {
                        const directText = `Hi ${businessName},\n\n🛑 *Nobogent Alert: Zero Credits Remaining*\nYour voice call engine and automations have paused because your credit balance is 0.\n\nTop up your wallet now to resume AI calling:\n👉 ${USAGE_URL}`;
                        await sendReminderWhatsApp(waPhone, waToken, waPhoneId, null, [], directText);
                    } else {
                        await sendReminderWhatsApp(
                            waPhone,
                            waToken,
                            waPhoneId,
                            WA_TEMPLATE_LOW_CREDITS,
                            [businessName, String(credits), USAGE_URL]
                        );
                    }
                }

                // 3. Web Push
                await sendReminderPush(profile.id, pushTitle, pushBody, USAGE_URL, 'low_credits_alert');

                // 4. Record Notification in Database
                await supabaseAdmin.from('notifications').insert({
                    user_id: profile.id,
                    title: pushTitle,
                    message: pushBody,
                    type: alertType,
                    action_link: '/dashboard/usage',
                    is_read: false
                });

                sentNotifications.add(dedupKey);
                creditReminders++;
            }
        }

        // --- 3. META / FACEBOOK ACCESS TOKEN EXPIRY CHECK ---
        const { data: metaProfiles } = await supabaseAdmin
            .from('profiles')
            .select('id, email, business_name, facebook_token, whatsapp_personal_number, contact_number, whatsapp_phone_number, whatsapp_access_token, whatsapp_phone_number_id')
            .not('facebook_token', 'is', null);

        if (metaProfiles && metaProfiles.length > 0) {
            for (const profile of metaProfiles) {
                const userEmail = profile.email?.toLowerCase() || '';
                if (NEVER_NOTIFY_EXPIRY_EMAILS.includes(userEmail)) continue;

                const tokenDedupKey = `${profile.id}:meta_token_expired`;
                if (sentNotifications.has(tokenDedupKey)) continue;

                try {
                    // Check Meta Graph API
                    const fbRes = await fetch(`https://graph.facebook.com/v20.0/me?access_token=${profile.facebook_token}`);
                    if (!fbRes.ok) {
                        const fbErr = await fbRes.json().catch(() => ({}));
                        const errorCode = fbErr.error?.code;
                        // Error 190 = Invalid OAuth 2.0 Access Token (expired, session revoked, password changed)
                        if (errorCode === 190) {
                            console.warn(`[Subscription Reminders] Meta access token expired for user ${profile.id} (${profile.email}):`, fbErr.error?.message);

                            const businessName = profile.business_name || 'there';
                            const pushTitle = '⚠️ Meta Facebook Connection Expired';
                            const pushBody = 'Your Meta Facebook session has expired. Lead syncing is paused. Reconnect in Settings.';

                            // 1. Email
                            if (profile.email) {
                                const subject = '⚠️ Action Required: Reconnect Your Meta Facebook Account';
                                const html = `
                                    <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; padding: 24px; background: #ffffff; border-radius: 16px; border: 1px solid #fecaca;">
                                        <div style="text-align: center; margin-bottom: 24px;">
                                            <img src="https://app.nobogent.com/nobogent-logo.png" alt="Nobogent" width="130" style="margin-bottom: 8px;" />
                                        </div>
                                        <h2 style="color: #dc2626; text-align: center; margin-bottom: 12px;">⚠️ Meta Connection Expired</h2>
                                        <p style="font-size: 14px; line-height: 1.6;">Hi <strong>${businessName}</strong>,</p>
                                        <p style="font-size: 14px; line-height: 1.6;">Your connected Meta (Facebook) access token has expired or was invalidated by Meta.</p>
                                        <p style="font-size: 14px; line-height: 1.6;"><strong>Impact:</strong> Fresh lead sync from your Facebook Lead Ads is currently on hold until you reconnect.</p>
                                        <div style="text-align: center; margin: 28px 0;">
                                            <a href="${SETTINGS_URL}" style="display: inline-block; background: #1877f2; color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 14px;">
                                                🔗 Reconnect Meta Facebook
                                            </a>
                                        </div>
                                    </div>
                                `;
                                await sendReminderEmail(profile.email, businessName, subject, html);
                            }

                            // 2. WhatsApp
                            const waPhone = profile.whatsapp_personal_number || profile.contact_number || profile.whatsapp_phone_number;
                            const waToken = profile.whatsapp_access_token || process.env.WHATSAPP_ACCESS_TOKEN;
                            const waPhoneId = profile.whatsapp_phone_number_id || process.env.WHATSAPP_PHONE_NUMBER_ID;

                            if (waPhone && waToken && waPhoneId) {
                                const directText = `Hi ${businessName},\n\n⚠️ *Meta Connection Expired*\nYour Facebook connection has expired, pausing new lead syncing from your Meta Lead Ads.\n\nPlease visit Settings to reconnect in 10 seconds:\n👉 ${SETTINGS_URL}`;
                                await sendReminderWhatsApp(waPhone, waToken, waPhoneId, null, [], directText);
                            }

                            // 3. Web Push
                            await sendReminderPush(profile.id, pushTitle, pushBody, SETTINGS_URL, 'meta_token_expired');

                            // 4. In-App Notification
                            await supabaseAdmin.from('notifications').insert({
                                user_id: profile.id,
                                title: pushTitle,
                                message: pushBody,
                                type: 'meta_token_expired',
                                action_link: '/dashboard/settings',
                                is_read: false
                            });

                            sentNotifications.add(tokenDedupKey);
                            tokenExpiryAlerts++;
                        }
                    }
                } catch (e: any) {
                    // Non-fatal network check error
                }
            }
        }

        console.log(`[Subscription Reminders] Complete. Sub Reminders: ${subscriptionReminders}, Grace: ${gracePeriodReminders}, Released Lines: ${releasedNumbers}, Low Credits: ${creditReminders}, Token Expired: ${tokenExpiryAlerts}`);

        return NextResponse.json({
            success: true,
            subscriptionReminders,
            gracePeriodReminders,
            releasedNumbers,
            creditReminders,
            tokenExpiryAlerts,
            timestamp: now.toISOString()
        });

    } catch (error: any) {
        console.error('[Subscription Reminders Error]:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
