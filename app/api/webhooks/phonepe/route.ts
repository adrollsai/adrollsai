import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase Admin Client (Bypasses RLS)
// Ensure SUPABASE_SERVICE_ROLE_KEY is in your .env.local
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! 
);

export async function POST(request: Request) {
    try {
        console.log("----------------------------------------------");
        console.log("🔔 WEBHOOK RECEIVED");

        // 1. Get the Authorization Header
        const authHeader = request.headers.get('authorization');

        // 2. Verify Credentials
        const username = "admin"; 
        const password = "admin1234";
        const encodedCreds = Buffer.from(`${username}:${password}`).toString('base64');
        const expectedAuth = `Basic ${encodedCreds}`;

        if (!authHeader || authHeader !== expectedAuth) {
            console.error("❌ Auth Failed. Received:", authHeader);
            return NextResponse.json({ status: "success" }); // Return 200 to stop retries
        }

        // 3. Parse Body
        const body = await request.json();
        
        // 4. Handle 'COMPLETED' Event
        if (body.event === 'checkout.order.completed' && body.payload.state === 'COMPLETED') {
             const { merchantTransactionId, amount, transactionId } = body.payload;
             console.log(`💰 Processing Payment: ${merchantTransactionId}`);
             
             // A. Find the transaction
             const { data: transaction, error: fetchError } = await supabaseAdmin
                .from('transactions')
                .select('*')
                .eq('order_id', merchantTransactionId)
                .single();

             if (fetchError || !transaction) {
                 console.error("❌ Transaction not found:", merchantTransactionId);
                 return NextResponse.json({ status: "success" });
             }

             // B. Idempotency Check: Only process if NOT already SUCCESS
             if (transaction.status !== 'SUCCESS') {
                 
                 // C. Update Transaction Status
                 const { error: updateError } = await supabaseAdmin
                  .from('transactions')
                  .update({ 
                      status: 'SUCCESS', 
                      provider_reference_id: transactionId || 'WEBHOOK_CONFIRMED'
                  })
                  .eq('order_id', merchantTransactionId);

                 if (updateError) {
                     console.error("❌ DB Update Failed:", updateError);
                     return NextResponse.json({ status: "success" });
                 }

                 // D. Add Credits to User Profile
                 const creditsToAdd = transaction.amount / 100; // Convert Paise to Credits
                 
                 // Fetch current credits
                 const { data: profile } = await supabaseAdmin
                    .from('profiles')
                    .select('ad_credits')
                    .eq('id', transaction.user_id)
                    .single();

                 const newBalance = (profile?.ad_credits || 0) + creditsToAdd;

                 // Update profile
                 await supabaseAdmin
                    .from('profiles')
                    .update({ ad_credits: newBalance })
                    .eq('id', transaction.user_id);
                 
                 console.log(`✅ SUCCESS: Transaction ${merchantTransactionId} processed. Credits added.`);
             } else {
                 console.log("ℹ️ Transaction already marked SUCCESS. Skipping.");
             }
        } else {
            console.log(`ℹ️ Unhandled Event: ${body.event} or State: ${body.payload.state}`);
        }

        return NextResponse.json({ status: "success" });

    } catch (error: any) {
        console.error("⚠️ Webhook Error:", error.message);
        return NextResponse.json({ status: "success" });
    }
}