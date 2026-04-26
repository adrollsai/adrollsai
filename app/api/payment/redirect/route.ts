import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient as createAdminClient } from '@supabase/supabase-js';

const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const MERCHANT_ID = (process.env.PHONEPE_MERCHANT_ID || "PGTESTPAYUAT").replace(/['"]/g, '').trim();
const SALT_KEY = (process.env.PHONEPE_SALT_KEY || "099eb0cd-02cf-4e2a-8aca-3e6c6aff0399").replace(/['"]/g, '').trim();
const SALT_INDEX = (process.env.PHONEPE_SALT_INDEX || "1").replace(/['"]/g, '').trim();

const STATUS_URL = `https://api-preprod.phonepe.com/apis/pg-sandbox/pg/v1/status`;

export async function POST(req: Request) { return handleReturn(req); }
export async function GET(req: Request) { return handleReturn(req); }

const htmlRedirect = (url: string) => new NextResponse(`
    <!DOCTYPE html>
    <html>
        <head><title>Processing Payment...</title></head>
        <body style="background: #f8fafc; display: flex; justify-content: center; align-items: center; height: 100vh; font-family: sans-serif;">
            <h2>Verifying Payment... Redirecting...</h2>
            <script>window.location.href = "${url}";</script>
        </body>
    </html>
`, { headers: { 'Content-Type': 'text/html' } });

async function handleReturn(req: Request) {
    try {
        const url = new URL(req.url);
        let transactionId = url.searchParams.get('transactionId');
        const planId = url.searchParams.get('planId') || 'professional';
        const userId = url.searchParams.get('userId'); 
        
        // 🚨 NEW LOGIC: Retrieve the original domain (localhost or ngrok)
        const originParam = url.searchParams.get('origin');
        const targetOrigin = originParam ? decodeURIComponent(originParam) : (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000");

        if (req.method === 'POST') {
            const formData = await req.formData().catch(() => null);
            if (formData && formData.get('transactionId')) {
                transactionId = formData.get('transactionId') as string;
            }
        }

        if (!transactionId || !userId) {
            return htmlRedirect(`${targetOrigin}/dashboard/billing?payment=error`);
        }

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

        if (data.success && data.code === 'PAYMENT_SUCCESS') {
            const validUntil = new Date();
            validUntil.setMonth(validUntil.getMonth() + 1);

            await supabaseAdmin.from('profiles').update({
                subscription_plan: planId,
                subscription_status: 'active',
                subscription_valid_until: validUntil.toISOString()
            }).eq('id', userId);

            // Bouncing back to the EXACT domain the user started on!
            return htmlRedirect(`${targetOrigin}/dashboard/billing?payment=success&txnId=${transactionId}&planId=${planId}`);
        } else {
            return htmlRedirect(`${targetOrigin}/dashboard/billing?payment=failed`);
        }

    } catch (error) {
        console.error("Redirect Route Error:", error);
        // Ensure we bounce to targetOrigin even on failure
        const fallbackOrigin = (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/['"]/g, '').trim();
        return htmlRedirect(`${fallbackOrigin}/dashboard/billing?payment=error`);
    }
}