import { NextResponse } from 'next/server';

export async function POST(request: Request) {
    try {
        console.log("----------------------------------------------");
        console.log("🔔 DASHBOARD WEBHOOK TRIGGERED");
        console.log("----------------------------------------------");

        // 1. Get the Authorization Header
        // PhonePe sends "Basic base64(username:password)"
        const authHeader = request.headers.get('authorization');

        // 2. Verify Credentials (from your Dashboard Screenshot)
        const username = "admin"; 
        const password = "admin1234";
        
        // Create the expected Basic Auth string
        const encodedCreds = Buffer.from(`${username}:${password}`).toString('base64');
        const expectedAuth = `Basic ${encodedCreds}`;

        // 3. Authenticate
        if (!authHeader || authHeader !== expectedAuth) {
            console.error("❌ Auth Failed!");
            console.log("   Received:", authHeader);
            console.log("   Expected:", expectedAuth);
            // In Test Mode, we still return 200 to prevent retries, but log the error
            return NextResponse.json({ status: "success" }); 
        }

        console.log("✅ Authorization Successful");

        // 4. Parse the Body (It is PLAIN JSON in this version, not Base64)
        const body = await request.json();
        
        console.log("📦 Event:", body.event);
        console.log("📄 Payload:", JSON.stringify(body.payload, null, 2));

        // 5. Handle Database Update
        // Note: The Dashboard Webhook uses "state" (e.g., 'COMPLETED'), not "code"
        if (body.event === 'checkout.order.completed' && body.payload.state === 'COMPLETED') {
             const { merchantTransactionId, amount } = body.payload;
             console.log(`💰 Payment Success: ${merchantTransactionId} for ₹${amount / 100}`);
             
             // TODO: Add your Supabase update logic here
        }

        return NextResponse.json({ status: "success" });

    } catch (error: any) {
        console.error("⚠️ Webhook Error:", error.message);
        return NextResponse.json({ status: "success" });
    }
}