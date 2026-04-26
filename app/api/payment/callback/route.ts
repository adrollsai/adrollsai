import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const SALT_KEY = (process.env.PHONEPE_SALT_KEY || "099eb0cd-02cf-4e2a-8aca-3e6c6aff0399").replace(/['"]/g, '').trim();
const SALT_INDEX = (process.env.PHONEPE_SALT_INDEX || "1").replace(/['"]/g, '').trim();
const WEBHOOK_USER = (process.env.PHONEPE_WEBHOOK_USERNAME || "").trim();
const WEBHOOK_PASS = (process.env.PHONEPE_WEBHOOK_PASSWORD || "").trim();

// Restore UUID hyphens
const formatUuid = (id: string) => {
    if (id.length === 32) {
        return `${id.slice(0,8)}-${id.slice(8,12)}-${id.slice(12,16)}-${id.slice(16,20)}-${id.slice(20)}`;
    }
    return id;
};

export async function POST(req: Request) {
    console.log("--- PHONEPE WEBHOOK TRIGGERED ---");
    try {
        // 1. Basic Auth Verification
        const authHeader = req.headers.get('authorization');
        if (authHeader && authHeader.startsWith('Basic ') && WEBHOOK_USER) {
            const auth = Buffer.from(authHeader.split(' ')[1], 'base64').toString('ascii');
            const [user, pwd] = auth.split(':');
            if (user !== WEBHOOK_USER || pwd !== WEBHOOK_PASS) {
                console.error("Webhook Error: Unauthorized Basic Auth");
                return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
            }
        }

        // 2. Safely Read Body (PREVENTS THE CRASH)
        const bodyText = await req.text();
        console.log("Raw Webhook Body received:", bodyText);

        if (!bodyText) {
            console.error("Webhook Error: Empty payload received");
            return NextResponse.json({ error: "Empty payload" }, { status: 400 });
        }

        let body;
        try {
            body = JSON.parse(bodyText);
        } catch (e) {
            console.error("Webhook Error: Could not parse JSON. Received:", bodyText);
            return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
        }

        const base64Response = body.response;
        if (!base64Response) {
            console.error("Webhook Error: Missing 'response' key in body");
            return NextResponse.json({ error: "Missing payload" }, { status: 400 });
        }

        // 3. Verify Checksum
        const signString = base64Response + SALT_KEY;
        const expectedChecksum = crypto.createHash('sha256').update(signString).digest('hex') + '###' + SALT_INDEX;
        const receivedChecksum = req.headers.get('x-verify');

        if (expectedChecksum !== receivedChecksum) {
            console.error("Webhook Signature Mismatch! Expected:", expectedChecksum, "Received:", receivedChecksum);
            return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
        }

        // 4. Decode the payload
        const decodedPayload = Buffer.from(base64Response, 'base64').toString('utf-8');
        console.log("Decoded Webhook Payload:", decodedPayload);
        const decodedResponse = JSON.parse(decodedPayload);

        // 5. Update Database if Successful
        if (decodedResponse.code === 'SUCCESS' || decodedResponse.code === 'PAYMENT_SUCCESS') {
            
            const rawUserId = decodedResponse.data.merchantUserId;
            const realUserId = formatUuid(rawUserId);
            
            const validUntil = new Date();
            validUntil.setMonth(validUntil.getMonth() + 1);

            const amountPaid = decodedResponse.data.amount / 100;
            
            let plan = 'starter';
            if (amountPaid >= 17000) plan = 'enterprise';
            else if (amountPaid >= 11000) plan = 'professional';

            console.log(`Updating Supabase for User ID: ${realUserId} to Plan: ${plan}`);

            const { error } = await supabaseAdmin.from('profiles').update({
                subscription_plan: plan,
                subscription_status: 'active',
                subscription_valid_until: validUntil.toISOString()
            }).eq('id', realUserId);

            if (error) {
                console.error("Supabase Update Error:", error);
                throw new Error("Failed to update database.");
            }

            console.log(`✅ User ${realUserId} successfully updated to active!`);
        } else {
            console.log("Payment was not successful. Code:", decodedResponse.code);
        }

        return NextResponse.json({ success: true });

    } catch (error: any) {
        console.error("Webhook Processing Catch Block Error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}