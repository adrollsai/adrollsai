import { NextResponse } from 'next/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { getSubscriptionStatus } from '@/utils/phonepe-subscription';

const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) { return handleReturn(req); }
export async function GET(req: Request) { return handleReturn(req); }

const htmlRedirect = (url: string) => new NextResponse(`
    <!DOCTYPE html>
    <html>
        <head><title>Processing Subscription...</title></head>
        <body style="background: #f8fafc; display: flex; justify-content: center; align-items: center; height: 100vh; font-family: sans-serif;">
            <div style="text-align: center;">
                <h2 style="color: #0f172a;">Activating Your Subscription...</h2>
                <p style="color: #64748b;">Please don't close this window.</p>
            </div>
            <script>window.location.href = "${url}";</script>
        </body>
    </html>
`, { headers: { 'Content-Type': 'text/html' } });

async function handleReturn(req: Request) {
    try {
        const url = new URL(req.url);
        const planId = url.searchParams.get('planId') || 'Early Bird Plan';
        const userId = url.searchParams.get('userId'); 
        const subscriptionId = url.searchParams.get('subscriptionId');
        
        const targetOrigin = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/['"]/g, '').trim();

        if (!subscriptionId || !userId) {
            return htmlRedirect(`${targetOrigin}/dashboard/billing?payment=error`);
        }

        // --- VERIFY SUBSCRIPTION STATUS ---
        const statusData = await getSubscriptionStatus(subscriptionId);

        // PhonePe Subscription States: ACTIVE, PENDING, FAILED
        if (statusData.success && (statusData.data?.state === 'ACTIVE' || statusData.data?.state === 'COMPLETED')) {
            const validUntil = new Date();
            validUntil.setMonth(validUntil.getMonth() + 1);

            await supabaseAdmin.from('profiles').update({
                subscription_plan: planId,
                subscription_status: 'active',
                subscription_id: subscriptionId, // Store this for recurring debits!
                subscription_valid_until: validUntil.toISOString()
            }).eq('id', userId);

            return htmlRedirect(`${targetOrigin}/dashboard/billing?payment=success&subId=${subscriptionId}&planId=${planId}`);
        } else {
            console.error("Subscription Verification Failed:", statusData);
            return htmlRedirect(`${targetOrigin}/dashboard/billing?payment=failed&reason=${statusData.message || 'setup_incomplete'}`);
        }

    } catch (error) {
        console.error("Redirect Route Error:", error);
        const fallbackOrigin = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/['"]/g, '').trim();
        return htmlRedirect(`${fallbackOrigin}/dashboard/billing?payment=error`);
    }
}