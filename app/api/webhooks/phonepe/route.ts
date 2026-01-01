import { NextResponse } from 'next/server';

export async function POST(request: Request) {
    try {
        console.log("----------------------------------------------");
        console.log("🔔 WEBHOOK HIT (Dashboard Method)");
        console.log("----------------------------------------------");

        // 1. Get the Authorization Header
        // PhonePe sends your username/password encoded here
        const authHeader = request.headers.get('authorization');
        
        console.log("📥 Auth Header Received:", authHeader);

        // 2. Verify Credentials (The ones you set in the Dashboard)
        // We manually create the "Basic ..." string to match what PhonePe sends
        const username = "olivia19";    // From your screenshot
        const password = "olivia123";   // From your screenshot
        
        // Basic Auth format is always "Basic base64(username:password)"
        const encodedCreds = Buffer.from(`${username}:${password}`).toString('base64');
        const expectedAuth = `Basic ${encodedCreds}`;

        // Simple String Comparison
        if (authHeader !== expectedAuth) {
            console.log("❌ Auth Failed. Expected:", expectedAuth);
            // We return 200 anyway to prevent PhonePe from retrying endlessly during testing
            // return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        } else {
             console.log("✅ Auth Successful: Credentials Match");
        }

        // 3. Get the Data
        const body = await request.json();
        
        // Log the actual event so you can see it
        console.log("📦 Event Type:", body.event); 
        console.log("📄 Payment Data:", JSON.stringify(body.payload, null, 2));

        return NextResponse.json({ success: true });

    } catch (error: any) {
        console.error("⚠️ Error processing webhook:", error.message);
        return NextResponse.json({ success: true }); // Always return true to PhonePe
    }
}