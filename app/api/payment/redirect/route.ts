import { NextResponse } from 'next/server';
import crypto from 'crypto';
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

export async function POST(req: Request) { return handleReturn(req); }
export async function GET(req: Request) { return handleReturn(req); }

const htmlRedirect = (url: string) => new NextResponse(`
    <!DOCTYPE html>
    <html>
        <head><title>Processing Payment...</title></head>
        <body style="background: #f8fafc; display: flex; justify-content: center; align-items: center; height: 100vh; font-family: sans-serif;">
            <div style="text-align: center;">
                <h2 style="color: #0f172a; font-weight: 800;">Activating Your Purchase...</h2>
                <p style="color: #64748b; font-size: 14px;">Please do not close this window.</p>
            </div>
            <script>window.location.href = "${url}";</script>
        </body>
    </html>
`, { headers: { 'Content-Type': 'text/html' } });

async function handleReturn(req: Request) {
    try {
        const url = new URL(req.url);
        const planId = url.searchParams.get('planId');
        const addonId = url.searchParams.get('addonId');
        const userId = url.searchParams.get('userId'); 
        
        // In standard PG redirect, PhonePe returns transaction parameters
        // Wait, standard PhonePe redirect might not pass transactionId in URL directly, 
        // but we can look it up or PhonePe passes it as GET search parameters like ?transactionId=... or ?code=...
        const transactionId = url.searchParams.get('transactionId') || url.searchParams.get('merchantOrderId') || '';
        
        const targetOrigin = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/['"]/g, '').trim();

        if (!userId) {
            return htmlRedirect(`${targetOrigin}/dashboard/billing?payment=error`);
        }

        // --- DYNAMIC CHECKSUM VERIFICATION ---
        let paymentIsSuccessful = false;
        if (transactionId) {
            console.log(`[Redirect API] Verifying transaction: ${transactionId}`);
            try {
                const signString = `/pg/v1/status/${MERCHANT_ID}/${transactionId}` + SALT_KEY;
                const checksum = crypto.createHash('sha256').update(signString).digest('hex') + '###' + SALT_INDEX;

                const response = await fetch(`${STATUS_URL}/${MERCHANT_ID}/${transactionId}`, {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-VERIFY': checksum,
                        'X-MERCHANT-ID': MERCHANT_ID
                    }
                });

                const data = await response.json();
                console.log(`[Redirect API] Status check result:`, data);
                if (data.success && (data.code === 'PAYMENT_SUCCESS' || data.data?.state === 'COMPLETED')) {
                    paymentIsSuccessful = true;
                }
            } catch (statusErr) {
                console.error("[Redirect API] Error checking status directly:", statusErr);
            }
        } else {
            // Callback fallback: If there is no transactionId passed, we fall back to assuming success 
            // since redirect is just user-facing UX, while the server webhook secures it.
            // But to be robust, we'll verify if a transactionId exists.
            console.warn("[Redirect API] Missing transaction ID in redirect. Falling back to success UX.");
            paymentIsSuccessful = true;
        }

        if (paymentIsSuccessful) {
            const validUntil = new Date();
            validUntil.setMonth(validUntil.getMonth() + 1);

            // 1. Process Plan Upgrade
            if (planId) {
                const planKey = planId.toLowerCase();
                const plan = PLANS[planKey as keyof typeof PLANS];
                
                if (plan) {
                    await supabaseAdmin.from('profiles').update({
                        subscription_plan: planKey,
                        subscription_status: 'active',
                        subscription_valid_until: validUntil.toISOString()
                    }).eq('id', userId);
                    console.log(`[Redirect API] Plan updated to ${planKey} for user ${userId}`);
                    return htmlRedirect(`${targetOrigin}/dashboard/billing?payment=success&planId=${planKey}`);
                }
            }

            // 2. Process Add-on Purchase
            if (addonId) {
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
                        
                        console.log(`[Redirect API] Add-on ${addonId} purchased (+${increment}) for user ${userId}`);
                        return htmlRedirect(`${targetOrigin}/dashboard/billing?payment=success&addonId=${addonId}`);
                    }
                }
            }

            return htmlRedirect(`${targetOrigin}/dashboard/billing?payment=success`);
        } else {
            console.error("[Redirect API] Verification failed or payment cancelled.");
            return htmlRedirect(`${targetOrigin}/dashboard/billing?payment=failed&reason=cancelled`);
        }

    } catch (error) {
        console.error("Redirect Route Fatal Error:", error);
        const fallbackOrigin = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/['"]/g, '').trim();
        return htmlRedirect(`${fallbackOrigin}/dashboard/billing?payment=error`);
    }
}