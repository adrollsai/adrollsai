import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

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

        // --- HANDLE SUBSCRIPTION SETUP SUCCESS ---
        if (decodedResponse.code === 'SUCCESS' || decodedResponse.code === 'SUBSCRIPTION_SUCCESS' || decodedResponse.code === 'PAYMENT_SUCCESS') {
            
            const merchantUserId = decodedResponse.data.merchantUserId;
            const subscriptionId = decodedResponse.data.merchantSubscriptionId;
            const amountPaid = (decodedResponse.data.amount || 0) / 100;
            
            // If we have a merchantUserId, it's likely a standard PG or Auth flow
            // If it's a UUID (has hyphens), Supabase uses it directly
            const userId = merchantUserId; 

            if (userId) {
                const validUntil = new Date();
                validUntil.setMonth(validUntil.getMonth() + 1);

                await supabaseAdmin.from('profiles').update({
                    subscription_status: 'active',
                    subscription_id: subscriptionId,
                    subscription_valid_until: validUntil.toISOString()
                }).eq('id', userId);

                console.log(`✅ Webhook: User ${userId} updated to active with SubID: ${subscriptionId}`);
            }
        }

        return NextResponse.json({ success: true });

    } catch (error: any) {
        console.error("Webhook Error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}