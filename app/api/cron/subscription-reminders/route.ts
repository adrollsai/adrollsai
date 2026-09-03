import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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
const LOW_CREDIT_THRESHOLD = 100;

// WhatsApp template names (must be approved on Nobogent WABA)
const WA_TEMPLATE_SUBSCRIPTION = 'subscription_expiry_reminder';
const WA_TEMPLATE_LOW_CREDITS = 'low_credits_alert';

function daysBetween(a: Date, b: Date): number {
    const msPerDay = 24 * 60 * 60 * 1000;
    return Math.round((b.getTime() - a.getTime()) / msPerDay);
}

function getReminderLabel(daysLeft: number): string | null {
    if (daysLeft === 7) return '7 days';
    if (daysLeft === 3) return '3 days';
    if (daysLeft === 1) return 'tomorrow';
    if (daysLeft <= 0) return 'today';
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
    templateName: string,
    params: string[]
) {
    try {
        let cleanPhone = phone.replace(/\D/g, '');
        if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone;

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

        const data = await res.json();
        if (!res.ok) {
            // Fallback to plain text if template is not approved yet
            console.warn(`[Sub Reminder WA] Template ${templateName} not approved or failed (${data.error?.message}), falling back to direct text:`, data);
            const textPayload = {
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: cleanPhone,
                type: 'text',
                text: { body: params.join('\n') }
            };
            await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(textPayload)
            });
        } else {
            console.log(`[Sub Reminder WA] Sent ${templateName} to ${cleanPhone}`);
        }
    } catch (err: any) {
        console.error(`[Sub Reminder WA Error]`, err.message);
    }
}

async function sendReminderPush(userId: string, title: string, body: string, url: string) {
    try {
        const { sendPushNotification } = await import('@/utils/notification-helper');
        await sendPushNotification(userId, title, body, url, 'subscription_reminder');
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

        console.log('[Subscription Reminders] Starting daily scan...');

        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

        // 1. Fetch recent reminder notifications sent today for deduplication
        const { data: recentNotifications } = await supabaseAdmin
            .from('notifications')
            .select('user_id, type')
            .gte('created_at', startOfToday)
            .in('type', ['subscription_reminder', 'low_credits_alert']);

        const sentSubRemindersToday = new Set<string>();
        const sentCreditAlertsToday = new Set<string>();

        if (recentNotifications) {
            for (const n of recentNotifications) {
                if (n.type === 'subscription_reminder') sentSubRemindersToday.add(n.user_id);
                if (n.type === 'low_credits_alert') sentCreditAlertsToday.add(n.user_id);
            }
        }

        // 2. Fetch profiles with active subscription validity
        const { data: profiles, error: fetchErr } = await supabaseAdmin
            .from('profiles')
            .select('id, email, business_name, credits, subscription_plan, subscription_status, subscription_valid_until, whatsapp_personal_number, contact_number, whatsapp_phone_number, whatsapp_access_token, whatsapp_phone_number_id, facebook_token')
            .not('subscription_valid_until', 'is', null);

        if (fetchErr) {
            console.error('[Subscription Reminders] Fetch error:', fetchErr);
            throw fetchErr;
        }

        // 3. Fetch profiles with low credits (< 100)
        const { data: lowCreditProfiles } = await supabaseAdmin
            .from('profiles')
            .select('id, email, business_name, credits, whatsapp_personal_number, contact_number, whatsapp_phone_number, whatsapp_access_token, whatsapp_phone_number_id, facebook_token')
            .lt('credits', LOW_CREDIT_THRESHOLD)
            .gt('credits', 0);

        let subscriptionReminders = 0;
        let creditReminders = 0;

        // --- SUBSCRIPTION EXPIRY REMINDERS ---
        if (profiles && profiles.length > 0) {
            for (const profile of profiles) {
                if (!profile.subscription_valid_until) continue;

                const expiryDate = new Date(profile.subscription_valid_until);
                const daysLeft = daysBetween(now, expiryDate);
                const reminderLabel = getReminderLabel(daysLeft);

                if (!reminderLabel) continue;

                // Dedup check
                if (sentSubRemindersToday.has(profile.id)) continue;

                const businessName = profile.business_name || 'there';
                const planName = profile.subscription_plan || 'Pro';
                const isExpired = daysLeft <= 0;

                const pushTitle = isExpired ? '⚠️ Plan Expired' : `⏰ Plan Expiring in ${reminderLabel}`;
                const pushBody = isExpired
                    ? `Your ${planName} plan has expired. Renew now to keep your campaigns active!`
                    : `Your ${planName} plan expires in ${reminderLabel}. Renew now!`;

                // 1. Send Email
                if (profile.email) {
                    const subject = isExpired
                        ? `⚠️ Your Nobogent ${planName} plan has expired`
                        : `⏰ Your Nobogent plan expires in ${reminderLabel}`;

                    const html = `
                        <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; padding: 24px; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0;">
                            <div style="text-align: center; margin-bottom: 24px;">
                                <img src="https://app.nobogent.com/nobogent-logo.png" alt="Nobogent" width="130" style="margin-bottom: 8px;" />
                            </div>
                            <h2 style="color: ${isExpired ? '#dc2626' : '#d97706'}; text-align: center; margin-bottom: 12px;">
                                ${isExpired ? '⚠️ Your Plan Has Expired' : `⏰ Your Plan Expires in ${reminderLabel}`}
                            </h2>
                            <p style="font-size: 14px; line-height: 1.6;">Hi <strong>${businessName}</strong>,</p>
                            <p style="font-size: 14px; line-height: 1.6;">${isExpired
                                ? `Your <strong>${planName}</strong> subscription has expired. Renew now to continue creating campaigns, generating AI creatives, and managing leads without interruption.`
                                : `Your <strong>${planName}</strong> subscription is set to expire in <strong>${reminderLabel}</strong>. Renew your plan to ensure uninterrupted marketing automation.`
                            }</p>
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

                // 2. Send WhatsApp
                const waPhone = profile.whatsapp_personal_number || profile.contact_number || profile.whatsapp_phone_number;
                const waToken = profile.whatsapp_access_token || profile.facebook_token || process.env.WHATSAPP_ACCESS_TOKEN;
                const waPhoneId = profile.whatsapp_phone_number_id || process.env.WHATSAPP_PHONE_NUMBER_ID;

                if (waPhone && waToken && waPhoneId) {
                    await sendReminderWhatsApp(
                        waPhone,
                        waToken,
                        waPhoneId,
                        WA_TEMPLATE_SUBSCRIPTION,
                        [businessName, planName, reminderLabel, BILLING_URL]
                    );
                }

                // 3. Send Web Push Notification
                await sendReminderPush(profile.id, pushTitle, pushBody, BILLING_URL);

                // 4. Record Notification in Database (Deduplication + In-App Feed)
                await supabaseAdmin.from('notifications').insert({
                    user_id: profile.id,
                    title: pushTitle,
                    message: pushBody,
                    type: 'subscription_reminder',
                    action_link: '/dashboard/billing',
                    is_read: false
                });

                sentSubRemindersToday.add(profile.id);
                subscriptionReminders++;
            }
        }

        // --- LOW CREDIT ALERTS ---
        if (lowCreditProfiles && lowCreditProfiles.length > 0) {
            for (const profile of lowCreditProfiles) {
                // Dedup check
                if (sentCreditAlertsToday.has(profile.id)) continue;

                const businessName = profile.business_name || 'there';
                const credits = Math.round(profile.credits || 0);

                const pushTitle = `🔋 Low Credits: ${credits} Remaining`;
                const pushBody = `Your credit balance is low (${credits} credits). Top up now to avoid service interruptions.`;

                // 1. Send Email
                if (profile.email) {
                    const subject = `🔋 Low Credit Balance: ${credits} Credits Remaining`;
                    const html = `
                        <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; padding: 24px; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0;">
                            <div style="text-align: center; margin-bottom: 24px;">
                                <img src="https://app.nobogent.com/nobogent-logo.png" alt="Nobogent" width="130" style="margin-bottom: 8px;" />
                            </div>
                            <h2 style="color: #d97706; text-align: center; margin-bottom: 12px;">⚠️ Low Credit Balance</h2>
                            <p style="font-size: 14px; line-height: 1.6;">Hi <strong>${businessName}</strong>,</p>
                            <p style="font-size: 14px; line-height: 1.6;">Your Nobogent credit balance is running low — only <strong>${credits} credits</strong> remaining.</p>
                            <p style="font-size: 14px; line-height: 1.6;">Top up your credits now to ensure voice calls, automated messaging, and campaign generations keep running seamlessly.</p>
                            <div style="text-align: center; margin: 28px 0;">
                                <a href="${USAGE_URL}" style="display: inline-block; background: linear-gradient(135deg, #4f46e5, #7c3aed); color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 14px; box-shadow: 0 4px 12px rgba(79, 70, 229, 0.25);">
                                    🔋 Top-Up Credits
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
                    await sendReminderWhatsApp(
                        waPhone,
                        waToken,
                        waPhoneId,
                        WA_TEMPLATE_LOW_CREDITS,
                        [businessName, String(credits), USAGE_URL]
                    );
                }

                // 3. Send Web Push
                await sendReminderPush(profile.id, pushTitle, pushBody, USAGE_URL);

                // 4. Record Notification in Database (Deduplication + In-App Feed)
                await supabaseAdmin.from('notifications').insert({
                    user_id: profile.id,
                    title: pushTitle,
                    message: pushBody,
                    type: 'low_credits_alert',
                    action_link: '/dashboard/usage',
                    is_read: false
                });

                sentCreditAlertsToday.add(profile.id);
                creditReminders++;
            }
        }

        console.log(`[Subscription Reminders] Scan complete. Reminders: ${subscriptionReminders}, Low-Credit: ${creditReminders}`);

        return NextResponse.json({
            success: true,
            subscriptionReminders,
            creditReminders,
            timestamp: now.toISOString()
        });

    } catch (error: any) {
        console.error('[Subscription Reminders Error]:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
